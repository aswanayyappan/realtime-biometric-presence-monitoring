import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardBody } from './Card';
import { WSPayload } from '../hooks/useMonitoringSocket';

interface DetectionEvent {
  id: string;
  type: 'PRESENT' | 'AWAY';
  time: string;
  confidence: number;
}

export function DetectionsPanel({ payload }: { payload: WSPayload | null }) {
  const [events, setEvents] = useState<DetectionEvent[]>([]);
  const [lastPresence, setLastPresence] = useState<string | null>(null);

  useEffect(() => {
    if (!payload) return;
    
    // Create an event when presence changes
    if (payload.presence !== lastPresence && (payload.presence === 'PRESENT' || payload.presence === 'AWAY')) {
      const newEvent: DetectionEvent = {
        id: Math.random().toString(36).substr(2, 9),
        type: payload.presence,
        time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        confidence: payload.confidence
      };
      
      setEvents(prev => [newEvent, ...prev].slice(0, 10)); // Keep last 10
      setLastPresence(payload.presence);
    }
  }, [payload, lastPresence]);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          Recent Detections
        </CardTitle>
        <div className="font-mono text-[10px] text-muted-foreground">
          {events.length} events
        </div>
      </CardHeader>
      
      <CardBody className="p-3">
        <div className="flex flex-col gap-2 max-h-[260px] overflow-y-auto pr-1">
          {events.length === 0 ? (
            <div className="font-mono text-[11px] text-muted-foreground text-center py-5 tracking-wider">
              Awaiting detections…
            </div>
          ) : (
            events.map((ev) => (
              <div key={ev.id} className="flex items-center gap-2.5 p-2 bg-accent/30 border border-border rounded-md animate-in fade-in slide-in-from-top-2 duration-300">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 shadow-sm ${
                  ev.type === 'PRESENT' ? 'bg-green-500 shadow-green-500/50' : 'bg-red-500 shadow-red-500/50'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground truncate">
                    {ev.type === 'PRESENT' ? 'Subject Detected' : 'Subject Lost'}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {ev.time}
                  </div>
                </div>
                <div className={`font-mono text-[11px] font-semibold shrink-0 ${
                  ev.confidence > 0.8 ? 'text-green-500' :
                  ev.confidence > 0.5 ? 'text-amber-500' : 'text-red-500'
                }`}>
                  {Math.round(ev.confidence * 100)}%
                </div>
              </div>
            ))
          )}
        </div>
      </CardBody>
    </Card>
  );
}