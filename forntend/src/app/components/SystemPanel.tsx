import React from 'react';
import { Card, CardHeader, CardTitle, CardBody } from './Card';
import { WSPayload, WSStatus } from '../hooks/useMonitoringSocket';
import { Video, Wifi, Cpu, Activity, Clock } from 'lucide-react';

export function SystemPanel({ wsStatus, payload }: { wsStatus: WSStatus; payload: WSPayload | null }) {
  
  const SysItem = ({ icon, label, value, state }: { icon: React.ReactNode; label: string; value: string; state: 'ok' | 'warn' | 'err' | 'dim' }) => (
    <div className="flex items-center gap-2.5">
      <div className="w-[15px] h-[15px] text-muted-foreground shrink-0 flex items-center justify-center">
        {icon}
      </div>
      <span className="text-xs text-muted-foreground flex-1">{label}</span>
      <span className={`font-mono text-[10.5px] font-medium ${
        state === 'ok' ? 'text-green-500' :
        state === 'warn' ? 'text-amber-500' :
        state === 'err' ? 'text-red-500' : 'text-muted-foreground'
      }`}>
        {value}
      </span>
    </div>
  );

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>System Status</CardTitle>
      </CardHeader>
      
      <CardBody>
        <div className="flex flex-col gap-3">
          <SysItem 
            icon={<Video className="w-full h-full" strokeWidth={1.5} />} 
            label="Webcam" 
            value="ACTIVE" 
            state="ok" 
          />
          <SysItem 
            icon={<Wifi className="w-full h-full" strokeWidth={1.5} />} 
            label="WebSocket" 
            value={wsStatus} 
            state={wsStatus === 'CONNECTED' ? 'ok' : wsStatus === 'CONNECTING' ? 'warn' : 'err'} 
          />
          <SysItem 
            icon={<Cpu className="w-full h-full" strokeWidth={1.5} />} 
            label="AI Worker" 
            value={payload ? 'RUNNING' : 'STOPPED'} 
            state={payload ? 'ok' : 'err'} 
          />
          <SysItem 
            icon={<Clock className="w-full h-full" strokeWidth={1.5} />} 
            label="Latency" 
            value={payload ? `${payload.latency} ms` : '— ms'} 
            state="dim" 
          />
          <SysItem 
            icon={<Activity className="w-full h-full" strokeWidth={1.5} />} 
            label="Frame Rate" 
            value={payload ? `${payload.fps} fps` : '0 fps'} 
            state="dim" 
          />
        </div>
        
        <div className="flex items-center gap-2 pt-2 border-t border-border mt-3">
          <span className="font-mono text-[9px] text-muted-foreground tracking-wider flex-1">AI LOAD</span>
          <div className="flex-[2] h-0.5 bg-accent/50 rounded-full overflow-hidden">
            <div 
              className="h-full bg-cyan-400 transition-all duration-500 rounded-full" 
              style={{ width: payload ? `${Math.min(100, Math.max(10, payload.confidence * 60))}%` : '0%' }}
            />
          </div>
          <span className="font-mono text-[10px] text-muted-foreground ml-2">
            {payload ? `${Math.round(Math.min(100, Math.max(10, payload.confidence * 60)))}%` : '0%'}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}