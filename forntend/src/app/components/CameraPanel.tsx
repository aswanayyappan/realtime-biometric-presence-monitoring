import React, { useEffect, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardBody } from './Card';
import { WSPayload } from '../hooks/useMonitoringSocket';

export function CameraPanel({ payload }: { payload: WSPayload | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.warn('Camera error:', err);
      setError('Camera access denied or unavailable.');
    }
  };

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  // Draw bounding boxes driven purely by backend payload
  useEffect(() => {
    if (!canvasRef.current || !videoRef.current || !payload?.box) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Match canvas to video dimensions
    const W = videoRef.current.videoWidth || 1280;
    const H = videoRef.current.videoHeight || 720;
    
    if (canvasRef.current.width !== W) canvasRef.current.width = W;
    if (canvasRef.current.height !== H) canvasRef.current.height = H;

    ctx.clearRect(0, 0, W, H);

    const alpha = Math.min(payload.confidence * 1.2, 1);
    
    // Draw from WS payload bounding box
    // Assuming backend returns normalized coordinates (0 to 1)
    const { x, y, w, h } = payload.box;
    const fx = x * W;
    const fy = y * H;
    const fw = w * W;
    const fh = h * H;

    ctx.save();
    ctx.globalAlpha = alpha * 0.7;
    ctx.strokeStyle = '#00d9f5';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.rect(fx, fy, fw, fh);
    ctx.stroke();
    
    // Confidence label
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#00d9f5';
    ctx.fillText(`${Math.round(payload.confidence * 100)}% MATCH`, fx, fy - 10);
    ctx.font = '9px monospace';
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillText(payload.identity || 'UNKNOWN', fx, fy + fh + 14);
    
    ctx.restore();
    
  }, [payload]);

  return (
    <Card className={`h-full ${stream ? 'border-cyan-500/20 shadow-[0_0_30px_rgba(0,217,245,0.06)]' : ''}`}>
      <CardHeader>
        <CardTitle>
          <div className={`w-1.5 h-1.5 rounded-full ${stream ? 'bg-red-500 animate-pulse' : 'bg-muted-foreground'}`} />
          Live Camera Feed
        </CardTitle>
        <div className="font-mono text-[10px] text-muted-foreground tracking-wider">
          {stream && videoRef.current ? `${videoRef.current.videoWidth}×${videoRef.current.videoHeight}` : '—'}
        </div>
      </CardHeader>

      <div className="relative bg-black aspect-video overflow-hidden flex-1 min-h-[300px]">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-400 ${stream ? 'opacity-100' : 'opacity-0'}`} 
        />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
        
        {stream && (
          <>
            <div className="absolute inset-0 pointer-events-none z-10 opacity-30" style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.2) 2px, rgba(0,0,0,0.2) 4px)' }} />
            
            <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2 py-1 bg-black/60 backdrop-blur-sm border border-white/10 rounded font-mono text-[9.5px] font-medium text-white/75 tracking-widest">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span>REC</span>
            </div>
            
            <div className="absolute bottom-3 left-3 z-20 font-mono text-[9px] text-white/50 tracking-wider">
              {payload ? `${payload.fps} fps · ${payload.latency}ms` : 'Waiting for WS payload...'}
            </div>
            
            {payload?.identity && payload.confidence > 0.7 && (
              <div className="absolute bottom-3 right-3 z-20 font-mono text-[9px] text-cyan-400/80 tracking-widest">
                ID CONFIRMED
              </div>
            )}
          </>
        )}

        {!stream && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-card/90">
            {error ? (
              <div className="text-center font-mono text-sm text-destructive">{error}</div>
            ) : (
              <>
                <svg className="text-muted-foreground/40 w-12 h-12" viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <rect x="4" y="12" width="36" height="28" rx="4"/>
                  <circle cx="22" cy="26" r="7"/>
                  <path d="M40 20l8-6v24l-8-6"/>
                </svg>
                <div className="font-mono text-xs text-muted-foreground tracking-wider text-center leading-relaxed">
                  Camera access required<br/>for presence monitoring
                </div>
                <button 
                  onClick={initCamera}
                  className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-black rounded font-mono text-xs font-semibold tracking-wider transition-all"
                >
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5,3 13,8 5,13" fill="currentColor" stroke="none"/>
                  </svg>
                  INITIALIZE MONITOR
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center flex-wrap gap-4 px-4 py-2 border-t border-border bg-card">
        <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <span>FPS</span>
          <span className="opacity-30 mx-0.5">·</span>
          <span className="text-foreground font-medium">{payload ? payload.fps : '—'}</span>
        </div>
        <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <span>LATENCY</span>
          <span className="opacity-30 mx-0.5">·</span>
          <span className="text-foreground font-medium">{payload ? payload.latency : '—'}</span>
        </div>
        <div className="flex items-center gap-1 ml-auto font-mono text-[10px] text-muted-foreground">
          <span>AI ENGINE</span>
          <span className="opacity-30 mx-0.5">·</span>
          <span className={`font-medium ${payload ? 'text-green-500' : 'text-muted-foreground'}`}>
            {payload ? 'ACTIVE' : 'OFFLINE'}
          </span>
        </div>
      </div>
    </Card>
  );
}