import React from 'react';
import { WSStatus } from '../hooks/useMonitoringSocket';

export function Navbar({ status, time }: { status: WSStatus; time: Date }) {
  const isConnected = status === 'CONNECTED';
  
  return (
    <header className="h-14 bg-card border-b border-border flex items-center px-4 md:px-6 gap-4 shrink-0 z-10">
      <div className="font-mono text-sm tracking-wide flex items-center gap-2 text-muted-foreground">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="8" cy="8" r="5" />
          <circle cx="8" cy="8" r="2" />
        </svg>
        <span>SENTINEL</span>
        <span className="opacity-50">/</span>
        <em className="not-italic text-foreground">Dashboard</em>
      </div>
      
      <div className="flex-1" />
      
      <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/50 border border-border rounded-full font-mono text-[10.5px] font-medium text-foreground tracking-wider cursor-default">
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        <span>MONITORING</span>
      </div>
      
      <div className={`flex items-center gap-2 px-3 py-1.5 bg-card border rounded-full font-mono text-[10.5px] tracking-wide transition-colors ${
        isConnected ? 'border-green-500/25 text-green-600' : 'border-border text-muted-foreground'
      }`}>
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
          isConnected ? 'bg-green-500' : 'bg-muted-foreground'
        }`} />
        <span>{status}</span>
      </div>
      
      <div className="font-mono text-xs text-muted-foreground tracking-widest min-w-[80px] text-right">
        {time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
    </header>
  );
}