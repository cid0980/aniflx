'use client';

import { useState } from 'react';

interface ApiError {
  type: string;
  message: string;
  technical: string;
  statusCode?: number;
  raw?: string;
}

export default function TechnicalError({
  error,
  onRetry,
  onCfChallenge,
}: {
  error: ApiError;
  onRetry?: () => void;
  onCfChallenge?: () => void;
}) {
  const [showTechnical, setShowTechnical] = useState(false);

  const isCfError =
    error.type === 'CLOUDFLARE_CHALLENGE' ||
    error.type === 'AA_CRYPTO_MISSING';

  const getIcon = () => {
    switch (error.type) {
      case 'CLOUDFLARE_CHALLENGE':
      case 'AA_CRYPTO_MISSING':
        return '🛡️';
      case 'NETWORK_ERROR':
        return '🌐';
      case 'NO_SOURCES':
        return '📭';
      case 'PROVIDER_ERROR':
        return '⚡';
      default:
        return '⚠️';
    }
  };

  const getColor = () => {
    if (isCfError) return 'border-amber-500/40 bg-amber-950/30';
    return 'border-red-500/30 bg-red-950/20';
  };

  const getTextColor = () => {
    if (isCfError) return 'text-amber-200';
    return 'text-red-300';
  };

  return (
    <div className={`rounded-xl border p-5 fade-in ${getColor()}`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0 mt-0.5">{getIcon()}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className={`font-semibold text-base ${getTextColor()}`}>
              {error.message}
            </h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/50 font-mono">
              {error.type}
            </span>
          </div>

          {isCfError && (
            <p className="text-sm text-amber-300/80 mb-3">
              The upstream API is protected by Cloudflare. You need to solve a
              CAPTCHA challenge to verify you&apos;re human. Click the button
              below to open the challenge.
            </p>
          )}

          <div className="flex flex-wrap gap-2 mt-3">
            {isCfError && onCfChallenge && (
              <button
                onClick={onCfChallenge}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium transition-colors pulse-glow"
              >
                🛡️ Solve Cloudflare Challenge
              </button>
            )}
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-colors"
              >
                ↻ Retry
              </button>
            )}
            <button
              onClick={() => setShowTechnical(!showTechnical)}
              className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm font-medium transition-colors"
            >
              {showTechnical ? '▾ Hide' : '▸ Show'} Technical Details
            </button>
          </div>

          {showTechnical && (
            <div className="mt-3 p-3 rounded-lg bg-black/40 border border-white/5 fade-in">
              <div className="font-mono text-xs text-white/50 space-y-2">
                <div>
                  <span className="text-white/30">TYPE:</span>{' '}
                  <span className="text-white/70">{error.type}</span>
                </div>
                {error.statusCode && (
                  <div>
                    <span className="text-white/30">HTTP STATUS:</span>{' '}
                    <span className="text-white/70">{error.statusCode}</span>
                  </div>
                )}
                <div>
                  <span className="text-white/30">DETAILS:</span>
                  <pre className="text-white/60 whitespace-pre-wrap break-all mt-1 text-[11px] leading-relaxed">
                    {error.technical}
                  </pre>
                </div>
                {error.raw && (
                  <div>
                    <span className="text-white/30">RAW RESPONSE:</span>
                    <pre className="text-white/40 whitespace-pre-wrap break-all mt-1 text-[11px] leading-relaxed max-h-32 overflow-auto">
                      {error.raw}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
