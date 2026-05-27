import React from 'react';
import { Card, CardHeader, CardTitle, CardBody } from './Card';
import { WSPayload, IdentityStabilityState } from '../hooks/useMonitoringSocket';

interface PresencePanelProps {
  payload: WSPayload | null;
  stabilityState: IdentityStabilityState;
  stableIdentity: string | null;
  stableConfidence: number;
}

export function PresencePanel({
  payload,
  stabilityState,
  stableIdentity,
  stableConfidence,
}: PresencePanelProps) {
  const presence = payload?.presence || 'UNKNOWN';

  // Orb colour driven by stability state, not raw presence
  const orbGreen  = 'rgba(34,197,94,0.25)';
  const orbAmber  = 'rgba(251,191,36,0.25)';
  const orbRed    = 'rgba(239,68,68,0.25)';
  const orbNeutral = 'rgba(113,113,122,0.2)';

  const orbColor = 
    stabilityState === 'CONFIRMED' ? orbGreen :
    stabilityState === 'TENTATIVE' ? orbAmber :
    stabilityState === 'LOST'      ? orbRed   :
    presence === 'AWAY'            ? orbRed   :
    orbNeutral;

  const orbBorder = 
    stabilityState === 'CONFIRMED' ? 'rgba(34,197,94,0.4)'  :
    stabilityState === 'TENTATIVE' ? 'rgba(251,191,36,0.4)' :
    stabilityState === 'LOST'      ? 'rgba(239,68,68,0.4)'  :
    presence === 'AWAY'            ? 'rgba(239,68,68,0.4)'  :
    'rgba(113,113,122,0.3)';

  const stateColor =
    stabilityState === 'CONFIRMED' ? 'text-green-500'        :
    stabilityState === 'TENTATIVE' ? 'text-amber-400'        :
    stabilityState === 'LOST'      ? 'text-red-400'          :
    presence === 'AWAY'            ? 'text-red-500'          :
    'text-muted-foreground';

  // Label shown under the orb
  const identityLabel = (() => {
    if (stabilityState === 'CONFIRMED' && stableIdentity) {
      return stableIdentity.toUpperCase();
    }
    if (stabilityState === 'TENTATIVE') return 'VERIFYING…';
    if (stabilityState === 'LOST')      return 'LOST';
    if (presence === 'AWAY')            return 'AWAY';
    return 'UNKNOWN';
  })();

  // Small badge to show temporal stability status
  const badge = (() => {
    if (stabilityState === 'CONFIRMED') return { label: '🔒 LOCKED', cls: 'text-green-500' };
    if (stabilityState === 'TENTATIVE') return { label: '⏳ VERIFYING', cls: 'text-amber-400' };
    if (stabilityState === 'LOST')      return { label: '⚠ LOST (grace)', cls: 'text-red-400' };
    return null;
  })();

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          Presence State
        </CardTitle>
        <div className="font-mono text-[10px] text-muted-foreground tracking-wider">
          {payload ? 'LIVE' : '—'}
        </div>
      </CardHeader>

      <CardBody className="items-center px-4 py-6 gap-4">
        <div className="relative w-20 h-20">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center relative z-10 transition-all duration-500 shadow-xl"
            style={{
              background: `radial-gradient(circle at 40% 40%, ${orbColor}, transparent)`,
              boxShadow: `0 0 0 1px ${orbBorder}, 0 0 20px ${orbColor}`,
            }}
          >
            <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" className={`w-8 h-8 transition-colors duration-500 ${stateColor}`}>
              <circle cx="16" cy="12" r="5" />
              <path d="M6 28c0-5.5 4.5-10 10-10s10 4.5 10 10" />
            </svg>
          </div>
          {stabilityState === 'CONFIRMED' && (
            <div className="absolute -inset-1.5 rounded-full border border-green-500/20 animate-[ping_2.5s_ease-in-out_infinite]" />
          )}
          {stabilityState === 'TENTATIVE' && (
            <div className="absolute -inset-1.5 rounded-full border border-amber-400/30 animate-[ping_1.2s_ease-in-out_infinite]" />
          )}
        </div>

        <div className={`font-mono text-base font-semibold tracking-[0.18em] transition-colors duration-400 ${stateColor} text-center`}>
          {identityLabel}
        </div>

        {badge && (
          <div className={`font-mono text-[9px] tracking-widest ${badge.cls} -mt-3`}>
            {badge.label}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 w-full mt-2">
          <div className="bg-accent/30 border border-border rounded-md p-2">
            <div className="font-mono text-[8.5px] text-muted-foreground uppercase tracking-widest mb-0.5">State</div>
            <div className={`font-mono text-[11px] font-semibold tracking-wide ${stateColor}`}>
              {stabilityState}
            </div>
          </div>
          <div className="bg-accent/30 border border-border rounded-md p-2">
            <div className="font-mono text-[8.5px] text-muted-foreground uppercase tracking-widest mb-0.5">Accuracy</div>
            <div className="font-mono text-[15px] font-semibold tracking-wide text-foreground">
              {stabilityState === 'CONFIRMED' ? `${Math.round(stableConfidence * 100)}%` : '—'}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}