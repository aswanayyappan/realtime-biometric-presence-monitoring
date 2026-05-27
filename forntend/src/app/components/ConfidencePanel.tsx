import React, { useEffect, useState, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardBody } from './Card';
import { WSPayload, IdentityStabilityState } from '../hooks/useMonitoringSocket';

interface ConfidencePanelProps {
  payload: WSPayload | null;
  stableConfidence: number;
  stabilityState: IdentityStabilityState;
}

export function ConfidencePanel({ payload, stableConfidence, stabilityState }: ConfidencePanelProps) {
  // Use EMA-smoothed stableConfidence when confirmed; show 0 otherwise
  const displayConfidence = stabilityState === 'CONFIRMED' ? stableConfidence : 0;
  const pct = Math.round(displayConfidence * 100);

  // Rolling sparkline — stores last 50 stable confidence readings
  const [history, setHistory] = useState<number[]>(Array(50).fill(0));
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (stabilityState === 'CONFIRMED' && stableConfidence > 0) {
      setHistory(prev => {
        const next = [...prev, stableConfidence];
        if (next.length > 50) return next.slice(next.length - 50);
        return next;
      });
    } else if (stabilityState === 'IDLE') {
      // Reset graph when face fully clears
      setHistory(Array(50).fill(0));
    }
  }, [stableConfidence, stabilityState]);

  // Draw sparkline
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Colour based on stability
    const lineColor = stabilityState === 'CONFIRMED' ? '#22c55e' :
                      stabilityState === 'TENTATIVE' ? '#fbbf24' :
                      '#e8a000';
    const fillTop   = stabilityState === 'CONFIRMED' ? 'rgba(34,197,94,0.2)' :
                      stabilityState === 'TENTATIVE' ? 'rgba(251,191,36,0.2)' :
                      'rgba(232,160,0,0.2)';

    ctx.beginPath();
    const step = W / (history.length - 1 || 1);
    ctx.moveTo(0, H - history[0] * H);
    for (let i = 1; i < history.length; i++) {
      ctx.lineTo(i * step, H - history[i] * H);
    }
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Fill under sparkline
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, fillTop);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fill();
  }, [history, stabilityState]);

  const barColor = stabilityState === 'CONFIRMED' ? 'bg-green-500' :
                   stabilityState === 'TENTATIVE' ? 'bg-amber-400' :
                   'bg-amber-500';

  const pctColor = stabilityState === 'CONFIRMED' ? 'text-green-400' :
                   stabilityState === 'TENTATIVE' ? 'text-amber-400' :
                   'text-foreground';

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>AI Confidence</CardTitle>
        <div className="font-mono text-[10px] text-muted-foreground tracking-wider">
          {stabilityState === 'CONFIRMED' ? 'EMA SMOOTHED' :
           stabilityState === 'TENTATIVE' ? 'VERIFYING'   :
           payload ? 'INACTIVE' : 'NO DATA'}
        </div>
      </CardHeader>

      <CardBody className="pb-3">
        <div className="flex items-baseline gap-1 mb-1.5">
          <div className={`font-mono text-4xl font-light leading-none transition-colors ${pctColor}`}>
            {pct}
          </div>
          <div className="font-mono text-sm text-muted-foreground">%</div>
          {stabilityState === 'CONFIRMED' && (
            <div className="ml-auto font-mono text-[9px] text-green-500 tracking-widest">LOCKED</div>
          )}
        </div>

        <div className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest mb-2.5">
          {stabilityState === 'CONFIRMED' ? 'Stable Match Confidence' :
           stabilityState === 'TENTATIVE' ? 'Awaiting Confirmation'   :
           'Match Confidence'}
        </div>

        <div className="h-[3px] bg-accent/50 rounded overflow-hidden mb-1">
          <div
            className={`h-full ${barColor} rounded transition-all duration-500 ease-out`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Threshold markers */}
        <div className="flex justify-between font-mono text-[9px] text-muted-foreground mb-2.5">
          <span>0%</span>
          <span>ACCEPT 60%</span>
          <span>CONFIRM 72%</span>
          <span>100%</span>
        </div>

        {/* Sparkline */}
        <div className="h-10 relative overflow-hidden mt-auto">
          <canvas
            ref={canvasRef}
            width={300}
            height={40}
            className="w-full h-full block"
          />
        </div>
      </CardBody>
    </Card>
  );
}