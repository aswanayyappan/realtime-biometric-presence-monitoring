import React, { useRef, useState, useEffect, useCallback } from 'react';

type ConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

interface RecognitionResult {
  identity: string;
  confidence: number;
  isUnknown: boolean;
}

/**
 * Phone Camera — production mobile camera capture page.
 *
 * Captures frames from the phone's front camera via getUserMedia,
 * encodes as JPEG, sends over WebSocket to the backend for face recognition.
 *
 * Production hardening:
 * - WebSocket auto-reconnect with exponential backoff
 * - Backpressure: skips frames when WS buffer is congested
 * - Wake Lock API: prevents screen sleep during streaming
 * - Recognition result feedback: shows who was detected on the phone
 * - Canvas context caching: avoids per-frame re-acquisition
 * - Payload size guard: caps frame size to prevent OOM
 * - Proper cleanup on unmount and visibility change
 */
export default function PhoneCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const streamingRef = useRef(false); // Stable ref for callbacks

  const [streaming, setStreaming] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>('DISCONNECTED');
  const [fps, setFps] = useState(0);
  const [framesSent, setFramesSent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<RecognitionResult | null>(null);
  const [droppedFrames, setDroppedFrames] = useState(0);

  // Keep streamingRef in sync
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);

  // ── WebSocket URL ──────────────────────────────────────
  const getWsUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${window.location.host}/ws`;
  }, []);

  // ── Wake Lock (prevent screen sleep) ───────────────────
  const acquireWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch {
      // Wake Lock not supported or denied — non-critical
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }, []);

  // ── Camera ─────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 960 },
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch (err: any) {
      const msg = err.name === 'NotAllowedError'
        ? 'Camera permission denied. Please allow camera access in your browser settings.'
        : err.name === 'NotFoundError'
        ? 'No camera found on this device.'
        : `Camera error: ${err.message}`;
      setError(msg);
      setCameraReady(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  // ── WebSocket with auto-reconnect ──────────────────────
  const connectWs = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;

    setWsStatus('CONNECTING');
    const ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      setWsStatus('CONNECTED');
      reconnectAttemptRef.current = 0;
      wsRef.current = ws;
    };

    ws.onclose = () => {
      setWsStatus('DISCONNECTED');
      wsRef.current = null;

      // Auto-reconnect if still streaming
      if (streamingRef.current) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 8000);
        reconnectAttemptRef.current++;
        reconnectTimerRef.current = setTimeout(() => {
          if (streamingRef.current) connectWs();
        }, delay);
      }
    };

    ws.onerror = () => {
      // onclose will fire after this — reconnect handled there
    };

    // Listen for recognition results to show feedback on phone
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'recognition' && Array.isArray(msg.faces)) {
          const activeFaces = msg.faces.filter((f: any) => !f.cooldown_skipped);
          if (activeFaces.length > 0) {
            const face = activeFaces[0];
            setLastResult({
              identity: face.identity,
              confidence: face.confidence,
              isUnknown: face.is_unknown,
            });
          }
        }
      } catch {
        // Ignore parse errors
      }
    };
  }, [getWsUrl]);

  const disconnectWs = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsStatus('DISCONNECTED');
  }, []);

  // ── Frame capture with backpressure ────────────────────
  const captureAndSend = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ws = wsRef.current;

    if (!video || !canvas || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (video.readyState < 2) return;

    // Backpressure: skip frame if WS send buffer > 100KB
    if (ws.bufferedAmount > 100_000) {
      setDroppedFrames((prev) => prev + 1);
      return;
    }

    // Cache canvas context
    if (!ctxRef.current) {
      canvas.width = 640;
      canvas.height = 480;
      ctxRef.current = canvas.getContext('2d', { willReadFrequently: false });
    }
    const ctx = ctxRef.current;
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, 640, 480);
    const base64 = canvas.toDataURL('image/jpeg', 0.5);

    // Payload size guard: drop frames > 200KB base64
    if (base64.length > 200_000) {
      setDroppedFrames((prev) => prev + 1);
      return;
    }

    ws.send(JSON.stringify({ type: 'frame', data: base64 }));
    setFramesSent((prev) => prev + 1);
  }, []);

  // ── Start / Stop streaming ─────────────────────────────
  const startStreaming = useCallback(async () => {
    setError(null);
    setLastResult(null);
    setDroppedFrames(0);
    setFramesSent(0);
    await startCamera();
    connectWs();
    await acquireWakeLock();
    setStreaming(true);
  }, [startCamera, connectWs, acquireWakeLock]);

  const stopStreaming = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    stopCamera();
    disconnectWs();
    releaseWakeLock();
    setStreaming(false);
    setFps(0);
    setLastResult(null);
    ctxRef.current = null;
  }, [stopCamera, disconnectWs, releaseWakeLock]);

  // ── Frame capture loop ─────────────────────────────────
  useEffect(() => {
    if (streaming && cameraReady && wsStatus === 'CONNECTED') {
      const targetFps = 5;
      const interval = 1000 / targetFps;
      let lastFpsTime = Date.now();
      let fpsCount = 0;

      intervalRef.current = setInterval(() => {
        captureAndSend();
        fpsCount++;
        const now = Date.now();
        if (now - lastFpsTime >= 1000) {
          setFps(fpsCount);
          fpsCount = 0;
          lastFpsTime = now;
        }
      }, interval);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }
  }, [streaming, cameraReady, wsStatus, captureAndSend]);

  // ── Cleanup on unmount ─────────────────────────────────
  useEffect(() => {
    return () => { stopStreaming(); };
  }, []);

  // ── Re-acquire wake lock on visibility change ──────────
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible' && streamingRef.current) {
        acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [acquireWakeLock]);

  // ── Render ─────────────────────────────────────────────
  const statusColor = {
    DISCONNECTED: '#ef4444',
    CONNECTING: '#f59e0b',
    CONNECTED: '#22c55e',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      color: '#e2e8f0',
      fontFamily: "'Inter', -apple-system, sans-serif",
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <header style={{
        padding: '16px 20px',
        borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
          }}>
            📷
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Phone Camera</h1>
            <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>Face Recognition Stream</p>
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          borderRadius: '20px',
          background: 'rgba(15, 23, 42, 0.6)',
          border: '1px solid rgba(148, 163, 184, 0.15)',
          fontSize: '12px',
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: statusColor[wsStatus],
            boxShadow: `0 0 6px ${statusColor[wsStatus]}`,
            animation: wsStatus === 'CONNECTED' ? 'none' : 'pulse 1.5s infinite',
          }} />
          {wsStatus}
        </div>
      </header>

      {/* Video Preview */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        gap: '16px',
      }}>
        <div style={{
          position: 'relative',
          width: '100%',
          maxWidth: '480px',
          aspectRatio: '4/3',
          borderRadius: '16px',
          overflow: 'hidden',
          background: '#0f172a',
          border: streaming
            ? '2px solid rgba(99, 102, 241, 0.5)'
            : '2px solid rgba(148, 163, 184, 0.15)',
          boxShadow: streaming
            ? '0 0 30px rgba(99, 102, 241, 0.15)'
            : 'none',
        }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: 'scaleX(-1)',
            }}
          />

          {/* Scanning overlay */}
          {streaming && cameraReady && (
            <div style={{
              position: 'absolute',
              inset: 0,
              border: '3px solid rgba(99, 102, 241, 0.4)',
              borderRadius: '14px',
              pointerEvents: 'none',
            }}>
              {[
                { top: '8px', left: '8px', borderTop: '3px solid #6366f1', borderLeft: '3px solid #6366f1' },
                { top: '8px', right: '8px', borderTop: '3px solid #6366f1', borderRight: '3px solid #6366f1' },
                { bottom: '8px', left: '8px', borderBottom: '3px solid #6366f1', borderLeft: '3px solid #6366f1' },
                { bottom: '8px', right: '8px', borderBottom: '3px solid #6366f1', borderRight: '3px solid #6366f1' },
              ].map((pos, i) => (
                <div key={i} style={{
                  position: 'absolute',
                  width: '24px',
                  height: '24px',
                  ...pos,
                }} />
              ))}
            </div>
          )}

          {/* Recognition result overlay on video */}
          {streaming && lastResult && (
            <div style={{
              position: 'absolute',
              bottom: '12px',
              left: '12px',
              right: '12px',
              padding: '10px 14px',
              borderRadius: '10px',
              background: lastResult.isUnknown
                ? 'rgba(239, 68, 68, 0.85)'
                : 'rgba(34, 197, 94, 0.85)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '14px',
              fontWeight: 600,
              color: '#fff',
              pointerEvents: 'none',
            }}>
              <span>{lastResult.isUnknown ? '❓ UNKNOWN' : `✅ ${lastResult.identity}`}</span>
              <span style={{ fontSize: '12px', opacity: 0.9 }}>
                {lastResult.isUnknown ? '' : `${Math.round(lastResult.confidence * 100)}%`}
              </span>
            </div>
          )}

          {/* Not streaming placeholder */}
          {!streaming && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(15, 23, 42, 0.85)',
              gap: '12px',
            }}>
              <div style={{ fontSize: '48px' }}>📱</div>
              <p style={{ fontSize: '14px', color: '#94a3b8', textAlign: 'center', padding: '0 20px' }}>
                Tap <strong>Start Streaming</strong> to begin face recognition
              </p>
            </div>
          )}
        </div>

        {/* Hidden canvas */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* Stats bar */}
        {streaming && (
          <div style={{
            display: 'flex',
            gap: '16px',
            padding: '10px 20px',
            borderRadius: '12px',
            background: 'rgba(30, 41, 59, 0.8)',
            border: '1px solid rgba(148, 163, 184, 0.1)',
            fontSize: '13px',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}>
            <div>
              <span style={{ color: '#94a3b8' }}>FPS: </span>
              <span style={{ color: '#22c55e', fontWeight: 600 }}>{fps}</span>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Sent: </span>
              <span style={{ fontWeight: 600 }}>{framesSent}</span>
            </div>
            {droppedFrames > 0 && (
              <div>
                <span style={{ color: '#94a3b8' }}>Dropped: </span>
                <span style={{ color: '#f59e0b', fontWeight: 600 }}>{droppedFrames}</span>
              </div>
            )}
            <div>
              <span style={{ color: '#94a3b8' }}>WS: </span>
              <span style={{ color: statusColor[wsStatus], fontWeight: 600 }}>{wsStatus}</span>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            padding: '12px 16px',
            borderRadius: '10px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            fontSize: '13px',
            maxWidth: '480px',
            width: '100%',
          }}>
            ⚠️ {error}
          </div>
        )}
      </div>

      {/* Action Button */}
      <div style={{
        padding: '16px 20px 32px',
        display: 'flex',
        justifyContent: 'center',
      }}>
        <button
          onClick={streaming ? stopStreaming : startStreaming}
          style={{
            width: '100%',
            maxWidth: '480px',
            padding: '16px',
            borderRadius: '14px',
            border: 'none',
            fontSize: '16px',
            fontWeight: 600,
            cursor: 'pointer',
            color: '#fff',
            background: streaming
              ? 'linear-gradient(135deg, #ef4444, #dc2626)'
              : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            boxShadow: streaming
              ? '0 4px 20px rgba(239, 68, 68, 0.3)'
              : '0 4px 20px rgba(99, 102, 241, 0.3)',
            transition: 'all 0.2s ease',
          }}
        >
          {streaming ? '⏹ Stop Streaming' : '▶ Start Streaming'}
        </button>
      </div>

      {!streaming && (
        <div style={{
          padding: '0 20px 24px',
          textAlign: 'center',
          fontSize: '12px',
          color: '#64748b',
        }}>
          <p>Open the <strong>Dashboard</strong> on your PC to see recognition results in real-time.</p>
        </div>
      )}
    </div>
  );
}
