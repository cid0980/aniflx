'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';

interface StreamData {
  url: string;
  isHLS: boolean;
  sourceName: string;
  all: { res: string; url: string }[];
}

interface ApiError {
  type: string;
  message: string;
  technical: string;
  statusCode?: number;
  raw?: string;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export default function VideoPlayer({
  streamData,
  onError,
  onTimeUpdate,
  onEnded,
  initialTime,
}: {
  streamData: StreamData;
  onError: (error: ApiError) => void;
  onTimeUpdate?: (time: number) => void;
  onEnded?: () => void;
  initialTime?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedQuality, setSelectedQuality] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hlsError, setHlsError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [skipIndicator, setSkipIndicator] = useState<{ side: 'left' | 'right'; key: number } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });
  const seekedToInitial = useRef(false);

  const qualities = streamData.all.length > 0 ? streamData.all : [{ res: 'auto', url: streamData.url }];

  // Double-tap to skip 10s
  const handleDoubleTap = useCallback((clientX: number) => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container) return;
    const rect = container.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    if (clientX < mid) {
      video.currentTime = Math.max(0, video.currentTime - 10);
      setSkipIndicator({ side: 'left', key: Date.now() });
    } else {
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
      setSkipIndicator({ side: 'right', key: Date.now() });
    }
    setTimeout(() => setSkipIndicator(null), 600);
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const now = Date.now();
    const touch = e.changedTouches[0];
    const prev = lastTapRef.current;
    if (now - prev.time < 300 && Math.abs(touch.clientX - prev.x) < 50) {
      e.preventDefault();
      handleDoubleTap(touch.clientX);
      lastTapRef.current = { time: 0, x: 0 };
    } else {
      lastTapRef.current = { time: now, x: touch.clientX };
    }
  }, [handleDoubleTap]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    handleDoubleTap(e.clientX);
  }, [handleDoubleTap]);

  // Speed change
  const changeSpeed = useCallback((s: number) => {
    setSpeed(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
    setShowSpeedMenu(false);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, []);

  // Load video
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setLoading(true);
    setHlsError(null);
    seekedToInitial.current = false;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    const currentUrl = qualities[selectedQuality]?.url || streamData.url;
    const isHLS = streamData.isHLS || currentUrl.includes('.m3u8');

    const onReady = () => {
      setLoading(false);
      video.playbackRate = speed;
      if (!seekedToInitial.current && initialTime && initialTime > 5) {
        video.currentTime = initialTime;
        seekedToInitial.current = true;
      }
      video.play().catch(() => {});
    };

    if (isHLS) {
      const proxiedUrl = `/api/hlsproxy?url=${encodeURIComponent(currentUrl)}`;
      if (Hls.isSupported()) {
        const hls = new Hls({
          fragLoadingMaxRetry: 5,
          manifestLoadingMaxRetry: 5,
          levelLoadingMaxRetry: 5,
          fragLoadingTimeOut: 30000,
          manifestLoadingTimeOut: 20000,
          levelLoadingTimeOut: 20000,
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setHlsError(`HLS error: ${data.type}/${data.details}`);
            onError({ type: 'PROVIDER_ERROR', message: `Playback failed (${data.details})`, technical: `HLS: ${data.type}/${data.details}` });
            hls.destroy();
          }
        });
        hls.on(Hls.Events.MANIFEST_PARSED, onReady);
        hls.loadSource(proxiedUrl);
        hls.attachMedia(video);
        hlsRef.current = hls;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = proxiedUrl;
        video.addEventListener('loadedmetadata', onReady, { once: true });
      }
    } else {
      video.src = `/api/proxy?url=${encodeURIComponent(currentUrl)}`;
      video.addEventListener('loadedmetadata', onReady, { once: true });
      video.addEventListener('error', () => {
        setHlsError(`Video error: ${video.error?.message}`);
        onError({ type: 'PROVIDER_ERROR', message: 'Video failed to load', technical: `Code ${video.error?.code}` });
      }, { once: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuality, streamData]);

  // Time update + ended callbacks
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let lastReport = 0;
    const handleTime = () => {
      const now = Math.floor(video.currentTime);
      if (now !== lastReport && now % 5 === 0) { lastReport = now; onTimeUpdate?.(now); }
    };
    const handleEnd = () => { onEnded?.(); };
    video.addEventListener('timeupdate', handleTime);
    video.addEventListener('ended', handleEnd);
    return () => { video.removeEventListener('timeupdate', handleTime); video.removeEventListener('ended', handleEnd); };
  }, [onTimeUpdate, onEnded]);

  return (
    <div className="space-y-2 fade-in">
      <div ref={containerRef} className="relative bg-black rounded-xl overflow-hidden aspect-video touch-manipulation select-none"
        onDoubleClick={handleDoubleClick} onTouchEnd={handleTouchEnd}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
            <div className="flex flex-col items-center gap-2">
              <svg className="spinner w-8 h-8 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" opacity="0.75" />
              </svg>
              <span className="text-white/50 text-xs">Hang on Cid...</span>
            </div>
          </div>
        )}
        {/* Skip indicators */}
        {skipIndicator && (
          <div className={`absolute top-1/2 -translate-y-1/2 z-20 pointer-events-none fade-in ${skipIndicator.side === 'left' ? 'left-8' : 'right-8'}`}>
            <div className="bg-black/60 rounded-full px-4 py-2 text-white text-sm font-medium backdrop-blur-sm">
              {skipIndicator.side === 'left' ? '⏪ -10s' : '⏩ +10s'}
            </div>
          </div>
        )}
        <video ref={videoRef} className="w-full h-full" controls playsInline crossOrigin="anonymous" />
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Quality */}
        {qualities.length > 1 && qualities.map((q, i) => (
          <button key={i} onClick={() => setSelectedQuality(i)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${selectedQuality === i ? 'bg-indigo-600 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}>
            {q.res}
          </button>
        ))}

        <div className="flex-1" />

        {/* Speed */}
        <div className="relative">
          <button onClick={() => setShowSpeedMenu(!showSpeedMenu)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white/5 text-white/40 hover:bg-white/10 transition-colors">
            {speed}x
          </button>
          {showSpeedMenu && (
            <div className="absolute bottom-full right-0 mb-1 bg-[#1a1a2e] border border-white/10 rounded-lg overflow-hidden shadow-xl z-30">
              {SPEEDS.map(s => (
                <button key={s} onClick={() => changeSpeed(s)}
                  className={`block w-full px-4 py-1.5 text-xs text-left transition-colors ${s === speed ? 'bg-indigo-600 text-white' : 'text-white/60 hover:bg-white/10'}`}>
                  {s}x
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-[10px] text-white/20">Double-tap sides to skip 10s • {streamData.sourceName}</p>
      {hlsError && <div className="p-2 rounded-lg bg-red-950/30 border border-red-500/20 text-[10px] font-mono text-red-300/60 break-all">{hlsError}</div>}
    </div>
  );
}
