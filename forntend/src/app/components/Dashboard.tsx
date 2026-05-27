import React, { useEffect, useState, useRef } from 'react';
import { useMonitoringSocket } from '../hooks/useMonitoringSocket';
import { CameraPanel } from './CameraPanel';
import { PresencePanel } from './PresencePanel';
import { ConfidencePanel } from './ConfidencePanel';
import { SessionPanel } from './SessionPanel';
import { DetectionsPanel } from './DetectionsPanel';
import { SystemPanel } from './SystemPanel';
import { TimelinePanel } from './TimelinePanel';
import { Navbar } from './Navbar';

export default function Dashboard() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${wsProtocol}://${window.location.host}/ws`;
  const { status, data, stabilityState, stableIdentity, stableConfidence } = useMonitoringSocket(wsUrl);

  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Text-to-Speech — only fires on CONFIRMED identity ───────────────────
  // Binds to stableIdentity (not raw data.identity) to prevent false triggers.
  const lastSpokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (stabilityState === 'CONFIRMED' && stableIdentity) {
      // Only speak once per new confirmed identity
      if (stableIdentity !== lastSpokenRef.current) {
        lastSpokenRef.current = stableIdentity;

        window.speechSynthesis.cancel();

        const textToSpeak = stableIdentity === 'UNKNOWN'
          ? 'Unknown person detected'
          : stableIdentity;

        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
      }
    } else if (stabilityState === 'IDLE') {
      // Reset when face fully leaves so we greet them again on return
      lastSpokenRef.current = null;
    }
  }, [stabilityState, stableIdentity]);

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <Navbar status={status} time={time} />

      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 max-w-7xl mx-auto">
          {/* Top section */}
          <div className="lg:col-start-1 lg:row-span-2">
            <CameraPanel payload={data} />
          </div>
          <div className="lg:col-start-2 lg:row-start-1">
            <PresencePanel
              payload={data}
              stabilityState={stabilityState}
              stableIdentity={stableIdentity}
              stableConfidence={stableConfidence}
            />
          </div>
          <div className="lg:col-start-2 lg:row-start-2">
            <ConfidencePanel
              payload={data}
              stableConfidence={stableConfidence}
              stabilityState={stabilityState}
            />
          </div>

          {/* Middle section */}
          <div className="lg:col-span-2 lg:row-start-3">
            <SessionPanel payload={data} />
          </div>

          {/* Bottom Section */}
          <div className="lg:col-start-1 lg:row-start-4">
            <DetectionsPanel payload={data} />
          </div>
          <div className="lg:col-start-2 lg:row-start-4">
            <SystemPanel wsStatus={status} payload={data} />
          </div>

          {/* Timeline Section */}
          <div className="lg:col-span-2 lg:row-start-5">
            <TimelinePanel payload={data} />
          </div>
        </div>
      </div>
    </div>
  );
}