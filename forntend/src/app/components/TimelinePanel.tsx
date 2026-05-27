import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardBody } from './Card';
import { WSPayload } from '../hooks/useMonitoringSocket';

export function TimelinePanel({ payload }: { payload: WSPayload | null }) {
  // A real implementation would fetch timeline history from backend.
  // Here we just render a static timeline outline and update the "current" block.
  
  const [blocks, setBlocks] = useState<string[]>(Array(60).fill('absent'));
  
  useEffect(() => {
    if (payload?.presence === 'PRESENT') {
      setBlocks(prev => {
        const next = [...prev];
        next[next.length - 1] = 'present';
        return next;
      });
    } else if (payload?.presence === 'AWAY') {
      setBlocks(prev => {
        const next = [...prev];
        next[next.length - 1] = 'absent';
        return next;
      });
    }
  }, [payload]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Activity Timeline</CardTitle>
        <div className="font-mono text-[10px] text-muted-foreground">
          {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </CardHeader>
      
      <CardBody className="p-3 md:p-4">
        <div className="pt-1">
          <div className="flex gap-0.5 h-7 mb-1.5">
            {blocks.map((state, i) => {
              const isCurrent = i === blocks.length - 1;
              return (
                <div 
                  key={i}
                  className={`flex-1 rounded-sm cursor-pointer transition-all hover:opacity-75 hover:scale-y-110 relative group ${
                    state === 'present' ? 'bg-green-500/65' : 
                    state === 'partial' ? 'bg-amber-500/60' :
                    isCurrent && payload ? 'bg-cyan-400/80 animate-pulse' :
                    'bg-accent/50'
                  }`}
                >
                  <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-card border border-border rounded text-[9.5px] text-muted-foreground whitespace-nowrap z-20 pointer-events-none">
                    {isCurrent ? 'Now' : `Block ${i+1}`}
                  </div>
                </div>
              );
            })}
          </div>
          
          <div className="flex justify-between font-mono text-[9px] text-muted-foreground px-px mb-2.5">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>NOW</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4 mt-2">
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <div className="w-2 h-2 rounded-sm bg-green-500/65" />
            <span>Present</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <div className="w-2 h-2 rounded-sm bg-amber-500/60" />
            <span>Partial</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <div className="w-2 h-2 rounded-sm bg-accent/50" />
            <span>Away</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <div className="w-2 h-2 rounded-sm bg-cyan-400/80" />
            <span>Current</span>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}