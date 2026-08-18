'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const GATE_KEY = 'aniflix_cid_verified';

export function useGateCheck() {
  const [verified, setVerified] = useState<boolean | null>(null);
  useEffect(() => {
    setVerified(localStorage.getItem(GATE_KEY) === 'true');
  }, []);
  const markVerified = () => { localStorage.setItem(GATE_KEY, 'true'); setVerified(true); };
  return { verified, markVerified };
}

export default function GateScreen({ onVerified }: { onVerified: () => void }) {
  const [input, setInput] = useState('');
  const [shake, setShake] = useState(false);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 800);
  }, []);

  const handleSubmit = () => {
    const clean = input.trim().toLowerCase().replace(/[''`]/g, "'");
    if (clean === "i'm back" || clean === "im back" || clean === "i am back") {
      setSuccess(true);
      setTimeout(onVerified, 1500);
    } else {
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <div className="fixed inset-0 z-[999] bg-[#06060c] flex items-center justify-center overflow-hidden">
      {/* Background ambient */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-pink-600/8 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-fuchsia-600/5 rounded-full blur-[150px]" />
      </div>

      <AnimatePresence mode="wait">
        {!success ? (
          <motion.div
            key="gate"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30, scale: 0.95 }}
            transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
            className="relative z-10 text-center px-6 max-w-md w-full"
          >
            {/* Logo */}
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200, damping: 15 }}
              className="mx-auto mb-8 w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500 flex items-center justify-center shadow-2xl shadow-purple-500/30"
            >
              <svg viewBox="0 0 24 24" fill="white" className="w-8 h-8 ml-1">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            </motion.div>

            {/* Title */}
            <motion.h1
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-3xl sm:text-4xl font-extrabold mb-3"
            >
              <span className="bg-gradient-to-r from-purple-300 via-fuchsia-300 to-pink-300 bg-clip-text text-transparent">
                Hello there~
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="text-white/40 text-sm mb-8 leading-relaxed"
            >
              Prove you&apos;re Cid to start watching.<br />
              <span className="text-white/25 text-xs">Say the code word to get in.</span>
            </motion.p>

            {/* Input */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, x: shake ? [0, -8, 8, -6, 6, -3, 3, 0] : 0 }}
              transition={{ delay: 0.8, x: { duration: 0.4 } }}
              className="relative"
            >
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="Type the code word..."
                className="w-full bg-white/[0.04] border border-white/10 rounded-2xl px-5 py-4 text-base text-center text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/40 focus:ring-2 focus:ring-purple-500/10 transition-all"
                autoComplete="off"
                autoCapitalize="off"
              />
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-purple-500/5 via-transparent to-pink-500/5 pointer-events-none" />
            </motion.div>

            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              onClick={handleSubmit}
              className="mt-4 w-full py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white font-semibold text-sm shadow-xl shadow-purple-600/20 hover:shadow-purple-500/30 transition-all active:scale-[0.98]"
            >
              Let me in
            </motion.button>

            {shake && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-3 text-red-400/70 text-xs"
              >
                That&apos;s not it~ try again
              </motion.p>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className="relative z-10 text-center"
          >
            <motion.div
              animate={{ scale: [1, 1.2, 1], rotate: [0, 10, -10, 0] }}
              transition={{ duration: 0.6 }}
              className="mx-auto mb-6 w-20 h-20 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-2xl shadow-green-500/30"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-10 h-10">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </motion.div>
            <motion.h2
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-2xl font-bold text-white mb-2"
            >
              Welcome back, Cid~
            </motion.h2>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-white/40 text-sm"
            >
              I knew it was you
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
