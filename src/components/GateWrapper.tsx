'use client';

import { ReactNode } from 'react';
import GateScreen, { useGateCheck } from './GateScreen';

export default function GateWrapper({ children }: { children: ReactNode }) {
  const { verified, markVerified } = useGateCheck();

  // Still loading from localStorage
  if (verified === null) {
    return (
      <div className="fixed inset-0 bg-[#06060c] flex items-center justify-center">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center animate-pulse">
          <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4 ml-0.5"><polygon points="5,3 19,12 5,21" /></svg>
        </div>
      </div>
    );
  }

  if (!verified) {
    return <GateScreen onVerified={markVerified} />;
  }

  return <>{children}</>;
}
