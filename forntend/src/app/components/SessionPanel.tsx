import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardBody } from './Card';
import { WSPayload } from '../hooks/useMonitoringSocket';

export function SessionPanel({ payload }: { payload: WSPayload | null }) {
  const [uptime, setUptime] = useState(0);
  const [sessionTime, setSessionTime] = useState(0);
  
  // Only update time if active
  useEffect(() => {
    const timer = setInterval(() => {
      setUptime(prev => prev + 1);
      if (payload?.presence === 'PRESENT') {
        setSessionTime(prev => prev + 1);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [payload?.presence]);

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session & Uptime</CardTitle>
        <div className="font-mono text-[10px] text-muted-foreground tracking-wider">
          {payload ? 'ACTIVE' : 'IDLE'}
        </div>
      </CardHeader>
      
      <CardBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex flex-col gap-1 py-1">
            <div className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.11em]">Session Time</div>
            <div className="font-mono text-2xl font-medium tracking-wide text-foreground">{formatTime(sessionTime)}</div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {sessionTime > 0 ? 'Active session' : 'Not started'}
            </div>
          </div>
          
          <div className="flex flex-col gap-1 py-1 relative before:absolute before:-left-2 before:top-1/2 before:-translate-y-1/2 before:h-8 before:w-px before:bg-border max-md:before:hidden">
            <div className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.11em]">Monitoring Uptime</div>
            <div className="font-mono text-2xl font-medium tracking-wide text-foreground">{formatTime(uptime)}</div>
            <div className="font-mono text-[10px] text-muted-foreground">Since launch</div>
          </div>
          
          <div className="flex flex-col gap-1 py-1 relative before:absolute before:-left-2 before:top-1/2 before:-translate-y-1/2 before:h-8 before:w-px before:bg-border max-md:before:hidden">
            <div className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.11em]">Last Detected</div>
            <div className="font-mono text-2xl font-medium tracking-wide text-foreground">
              {payload?.presence === 'PRESENT' ? 'NOW' : '—'}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {payload ? 'Active WS Stream' : 'No data'}
            </div>
          </div>
          
          <div className="flex flex-col gap-1 py-1 relative before:absolute before:-left-2 before:top-1/2 before:-translate-y-1/2 before:h-8 before:w-px before:bg-border max-md:before:hidden">
            <div className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.11em]">Frames Analyzed</div>
            <div className="font-mono text-2xl font-medium tracking-wide text-foreground">
              {payload ? (uptime * payload.fps).toLocaleString() : '0'}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {payload?.fps || 0} fps avg
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}