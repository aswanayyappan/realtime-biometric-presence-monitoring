import { useEffect, useState, useRef, useCallback } from "react";

export type PresenceState = "PRESENT" | "AWAY" | "UNKNOWN";

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WSPayload {
  presence: PresenceState;
  confidence: number;
  fps: number;
  latency: number;
  identity: string;
  timestamp: number;
  box?: BoundingBox;
}

export type WSStatus = "CONNECTING" | "CONNECTED" | "DISCONNECTED";

/**
 * Identity stability states — prevents UI flickering from single-frame misclassifications.
 *
 *  IDLE        → first event for a new identity  → TENTATIVE
 *  TENTATIVE   → same identity confirmed again   → CONFIRMED
 *  CONFIRMED   → identity disappears             → LOST (2s grace)
 *  LOST        → grace expires OR new identity   → IDLE
 *
 * Components bind to `stableIdentity` (CONFIRMED only).
 * `rawIdentity` exposes the latest reading for debug display.
 */
export type IdentityStabilityState = "IDLE" | "TENTATIVE" | "CONFIRMED" | "LOST";

export interface MonitoringState {
  status: WSStatus;
  data: WSPayload | null;
  stabilityState: IdentityStabilityState;
  stableIdentity: string | null;     // Only set in CONFIRMED state
  rawIdentity: string | null;         // Latest raw reading (always up to date)
  stableConfidence: number;           // EMA-smoothed confidence (CONFIRMED only)
}

const LOST_GRACE_MS = 2000;           // Stay CONFIRMED for 2s after face disappears
const TENTATIVE_CONFIRM_MS = 400;     // Min time between first and confirming event
const WS_RECONNECT_BASE_MS = 1000;
const WS_RECONNECT_MAX_MS  = 10000;

export function useMonitoringSocket(url: string): MonitoringState {
  const [status, setStatus] = useState<WSStatus>("DISCONNECTED");
  const [data, setData] = useState<WSPayload | null>(null);

  // Identity stability state machine
  const [stabilityState, setStabilityState] = useState<IdentityStabilityState>("IDLE");
  const [stableIdentity, setStableIdentity] = useState<string | null>(null);
  const [stableConfidence, setStableConfidence] = useState(0);
  const [rawIdentity, setRawIdentity] = useState<string | null>(null);

  // Internal refs (don't trigger re-render)
  const tentativeIdentityRef = useRef<string | null>(null);
  const tentativeTimestampRef = useRef<number>(0);
  const lostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearLostTimer = useCallback(() => {
    if (lostTimerRef.current) {
      clearTimeout(lostTimerRef.current);
      lostTimerRef.current = null;
    }
  }, []);

  /**
   * Feed a new raw identity reading into the state machine.
   * Called on every recognition event from the backend.
   */
  const advanceStateMachine = useCallback((
    incomingIdentity: string | null,
    incomingConfidence: number,
  ) => {
    if (!mountedRef.current) return;

    const now = Date.now();
    const isPresent = incomingIdentity !== null && incomingIdentity !== "UNKNOWN";

    if (!isPresent) {
      // Face absent or unknown
      setRawIdentity(incomingIdentity);
      setStabilityState(prev => {
        if (prev === "CONFIRMED") {
          // Start LOST grace period — don't immediately clear
          clearLostTimer();
          lostTimerRef.current = setTimeout(() => {
            if (!mountedRef.current) return;
            setStabilityState("IDLE");
            setStableIdentity(null);
            setStableConfidence(0);
            tentativeIdentityRef.current = null;
          }, LOST_GRACE_MS);
          return "LOST";
        }
        if (prev === "TENTATIVE") {
          tentativeIdentityRef.current = null;
          return "IDLE";
        }
        return prev; // IDLE or LOST — stay
      });
      return;
    }

    // Face is present and recognized
    setRawIdentity(incomingIdentity);
    clearLostTimer(); // Cancel any pending LOST→IDLE transition

    setStabilityState(prev => {
      if (prev === "IDLE" || prev === "LOST") {
        // Start tentative window
        tentativeIdentityRef.current = incomingIdentity;
        tentativeTimestampRef.current = now;
        return "TENTATIVE";
      }

      if (prev === "TENTATIVE") {
        if (
          incomingIdentity === tentativeIdentityRef.current &&
          now - tentativeTimestampRef.current >= TENTATIVE_CONFIRM_MS
        ) {
          // Confirmed! Lock in.
          setStableIdentity(incomingIdentity);
          setStableConfidence(incomingConfidence);
          return "CONFIRMED";
        }

        if (incomingIdentity !== tentativeIdentityRef.current) {
          // Different identity came in — restart tentative window
          tentativeIdentityRef.current = incomingIdentity;
          tentativeTimestampRef.current = now;
        }
        return "TENTATIVE";
      }

      if (prev === "CONFIRMED") {
        if (incomingIdentity !== stableIdentity) {
          // Identity switch — restart tentative rather than instant switch
          tentativeIdentityRef.current = incomingIdentity;
          tentativeTimestampRef.current = now;
          return "TENTATIVE";
        }
        // Same confirmed identity — update smoothed confidence
        setStableConfidence(c => parseFloat((0.35 * incomingConfidence + 0.65 * c).toFixed(4)));
        return "CONFIRMED";
      }

      return prev;
    });
  }, [clearLostTimer, stableIdentity]);

  // ── WebSocket connection ─────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;
    if (!mountedRef.current) return;

    setStatus("CONNECTING");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus("CONNECTED");
      reconnectAttemptRef.current = 0;
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setStatus("DISCONNECTED");
      wsRef.current = null;
      // Auto-reconnect with exponential backoff
      const delay = Math.min(
        WS_RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current),
        WS_RECONNECT_MAX_MS,
      );
      reconnectAttemptRef.current++;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose fires after this — reconnect handled there
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const raw = JSON.parse(event.data);

        if (raw.type === "recognition") {
          const faces = raw.faces || [];
          // Use first non-unknown face if any, else null
          const knownFace = faces.find((f: any) => !f.is_unknown && f.state === "confirmed");
          const anyFace  = faces[0] || null;
          const face = knownFace || anyFace;

          let box: BoundingBox | undefined;
          if (face?.bbox) {
            const [x1, y1, x2, y2] = face.bbox;
            const camW = 640;
            const camH = 480;
            box = { x: x1 / camW, y: y1 / camH, w: (x2 - x1) / camW, h: (y2 - y1) / camH };
          }

          const hasFace = !!face && !face.is_unknown && face.state === "confirmed";
          const incomingIdentity = hasFace ? face.identity : null;
          const incomingConf    = face?.confidence ?? 0;

          const payload: WSPayload = {
            presence: hasFace ? "PRESENT" : "AWAY",
            confidence: incomingConf,
            identity: incomingIdentity ?? "UNKNOWN",
            fps: raw.camera_fps || 0,
            latency: face?.inference_ms ?? 0,
            timestamp: raw.timestamp || Date.now(),
            box,
          };

          setData(payload);
          advanceStateMachine(incomingIdentity, incomingConf);

        } else if (raw.type === "connected") {
          setData({
            presence: "UNKNOWN",
            confidence: 0,
            identity: "UNKNOWN",
            fps: 0,
            latency: 0,
            timestamp: raw.timestamp || Date.now(),
          });
          advanceStateMachine(null, 0);
        }
      } catch (err) {
        console.error("Failed to parse WS message", err);
      }
    };
  }, [url, advanceStateMachine]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      clearLostTimer();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect, clearLostTimer]);

  return {
    status,
    data,
    stabilityState,
    stableIdentity,
    rawIdentity,
    stableConfidence,
  };
}