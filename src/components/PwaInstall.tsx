'use client';

import { useEffect, useMemo, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches ||
    // @ts-expect-error iOS Safari property
    window.navigator.standalone === true;
}

export default function PwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
      setShowIosHelp(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const canShow = useMemo(() => !installed, [installed]);

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => null);
      return;
    }

    if (isIos()) {
      setShowIosHelp((v) => !v);
    }
  };

  if (!canShow) return null;

  return (
    <div className="relative">
      <button
        onClick={handleInstall}
        className="rounded-full border border-purple-400/25 bg-purple-500/15 px-3 py-1.5 text-xs font-medium text-purple-200 backdrop-blur hover:bg-purple-500/25 transition-colors"
      >
        Install
      </button>

      {showIosHelp && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl border border-white/10 bg-[#14141f] p-3 text-xs text-white/70 shadow-2xl">
          <div className="mb-1 font-semibold text-white">Install on iPhone</div>
          <div>
            Tap <span className="text-white">Share</span> in Safari, then choose <span className="text-white">Add to Home Screen</span>.
          </div>
        </div>
      )}
    </div>
  );
}
