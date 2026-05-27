import React from 'react';
import { cn } from '../../lib/utils';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("bg-card text-card-foreground border border-border rounded-[var(--radius)] overflow-hidden flex flex-col", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between px-4 py-3 border-b border-border", className)}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground", className)}>
      {children}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("p-4 flex-1 flex flex-col", className)}>
      {children}
    </div>
  );
}