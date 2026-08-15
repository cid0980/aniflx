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

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 4, 10];

export default function VideoPlayer({
  streamData, onError, onTimeUpdate, onEnded, onNextEpisode,
  initialTime, hasNextEpisode, nextEpisodeNum, transitioning,
}: {
  streamData: StreamData;
  onError: (error: ApiError) => void;
  onTimeUpdate?: (time: number) => void;
  onEnded?: () => void;
  onNextEpisode?: () => void;
  initialTime?: number;
  hasNextEpisode?: boolean;
  nextEpisodeNum?: number;
  transitioning?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [hlsError, setHlsError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showNextEpPrompt, setShowNextEpPrompt] = useState(false);
  const [skipIndicator, setSkipIndicator] = useState<{ side: 'left' | 'right'; key: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [longPressScrub, setLongPressScrub] = useState<{ active: boolean; time: number } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });
  const seekedToInitial = useRef(false);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextEpTriggered = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<{ x: number; time: number } | null>(null);

  useEffect(() => { nextEpTriggered.current = false; setShowNextEpPrompt(false); }, [streamData]);

  // Track fullscreen + auto-rotate to landscape
  useEffect(() => {
    const h = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      // Auto-rotate on mobile
      try {
        const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };
        if (so?.lock) {
          if (fs) {
            so.lock('landscape').catch(() => {});
          } else {
            so.unlock?.();
          }
        }
      } catch { /* orientation API not supported */ }
    };
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  // Prevent context menu on the player (stops "copy" popup on long press)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener('contextmenu', prevent);
    return () => el.removeEventListener('contextmenu', prevent);
  }, []);

  const flashControls = useCallback(() => {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (!videoRef.current?.paused) { setShowControls(false); setShowSpeedMenu(false); }
    }, 3500);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }, []);

  // ── Seek bar: precise click/touch/drag ──
  const seekToPosition = useCallback((clientX: number) => {
    const v = videoRef.current;
    const bar = seekBarRef.current;
    if (!v || !bar || !v.duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = pct * v.duration;
    setCurrentTime(pct * v.duration);
  }, []);

  const onSeekMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); e.preventDefault();
    setIsSeeking(true);
    seekToPosition(e.clientX);
    const onMove = (ev: MouseEvent) => { seekToPosition(ev.clientX); };
    const onUp = () => { setIsSeeking(false); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [seekToPosition]);

  const onSeekTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setIsSeeking(true);
    seekToPosition(e.touches[0].clientX);
    const bar = seekBarRef.current;
    if (!bar) return;
    const onMove = (ev: TouchEvent) => { ev.preventDefault(); seekToPosition(ev.touches[0].clientX); };
    const onEnd = () => { setIsSeeking(false); bar.removeEventListener('touchmove', onMove); bar.removeEventListener('touchend', onEnd); };
    bar.addEventListener('touchmove', onMove, { passive: false });
    bar.addEventListener('touchend', onEnd);
  }, [seekToPosition]);

  // ── Double-tap to skip 10s ──
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

  // ── Long press + drag to scrub (mobile) ──
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-ctrl]')) return;

    // Prevent browser default (text selection, context menu on long press)
    e.preventDefault();

    const touch = e.touches[0];
    const video = videoRef.current;
    if (!video) return;

    longPressStart.current = { x: touch.clientX, time: video.currentTime };

    // Start long press timer
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      // Long press activated — enter scrub mode
      setLongPressScrub({ active: true, time: video.currentTime });
      setShowControls(true);
    }, 400);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const video = videoRef.current;
    const container = containerRef.current;
    const start = longPressStart.current;
    if (!video || !container || !start) return;

    const dx = touch.clientX - start.x;

    // If moved too much before long press activates, cancel long press
    if (!longPressScrub?.active && Math.abs(dx) > 15) {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      return;
    }

    // If scrub mode is active, drag to seek
    if (longPressScrub?.active && video.duration) {
      e.preventDefault();
      const containerWidth = container.getBoundingClientRect().width;
      // 1 full container width swipe = 120 seconds of scrub
      const secondsPerPixel = 120 / containerWidth;
      const newTime = Math.max(0, Math.min(video.duration, start.time + dx * secondsPerPixel));
      video.currentTime = newTime;
      setCurrentTime(newTime);
      setLongPressScrub({ active: true, time: newTime });
    }
  }, [longPressScrub]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Cancel long press timer
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }

    // If we were scrubbing, just end it
    if (longPressScrub?.active) {
      setLongPressScrub(null);
      longPressStart.current = null;
      return;
    }

    longPressStart.current = null;

    // Otherwise handle as double-tap / single-tap
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-ctrl]')) return;
    const now = Date.now();
    const touch = e.changedTouches[0];
    const prev = lastTapRef.current;
    if (now - prev.time < 300 && Math.abs(touch.clientX - prev.x) < 50) {
      e.preventDefault();
      handleDoubleTap(touch.clientX);
      lastTapRef.current = { time: 0, x: 0 };
    } else {
      lastTapRef.current = { time: now, x: touch.clientX };
      flashControls();
    }
  }, [handleDoubleTap, flashControls, longPressScrub]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-ctrl]')) return;
    e.preventDefault();
    handleDoubleTap(e.clientX);
  }, [handleDoubleTap]);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-ctrl]')) return;
    flashControls();
  }, [flashControls]);

  const changeSpeed = useCallback((s: number) => {
    setSpeed(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
    setShowSpeedMenu(false);
    flashControls();
  }, [flashControls]);

  const handleNextEpisode = useCallback(() => {
    if (nextEpTriggered.current) return;
    nextEpTriggered.current = true;
    setShowNextEpPrompt(false);
    onNextEpisode?.();
  }, [onNextEpisode]);

  const fmt = (s: number) => { const m = Math.floor(s / 60); return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`; };

  // Cleanup
  useEffect(() => {
    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, []);

  // Load video
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setLoading(true); setHlsError(null); seekedToInitial.current = false;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    const url = streamData.url;
    const isHLS = streamData.isHLS || url.includes('.m3u8');
    const onReady = () => {
      setLoading(false);
      video.playbackRate = speed;
      if (!seekedToInitial.current && initialTime && initialTime > 5) { video.currentTime = initialTime; seekedToInitial.current = true; }
      video.play().catch(() => {});
    };
    if (isHLS) {
      const p = `/api/hlsproxy?url=${encodeURIComponent(url)}`;
      if (Hls.isSupported()) {
        const hls = new Hls({ fragLoadingMaxRetry: 5, manifestLoadingMaxRetry: 5, levelLoadingMaxRetry: 5, fragLoadingTimeOut: 30000, manifestLoadingTimeOut: 20000, levelLoadingTimeOut: 20000 });
        hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { setHlsError(`HLS: ${d.type}/${d.details}`); onError({ type: 'PROVIDER_ERROR', message: `Playback failed (${d.details})`, technical: `HLS: ${d.type}/${d.details}` }); hls.destroy(); } });
        hls.on(Hls.Events.MANIFEST_PARSED, onReady);
        hls.loadSource(p); hls.attachMedia(video); hlsRef.current = hls;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = p; video.addEventListener('loadedmetadata', onReady, { once: true }); }
    } else {
      video.src = `/api/proxy?url=${encodeURIComponent(url)}`;
      video.addEventListener('loadedmetadata', onReady, { once: true });
      video.addEventListener('error', () => { setHlsError(`Video error: ${video.error?.message}`); onError({ type: 'PROVIDER_ERROR', message: 'Video failed', technical: `${video.error?.code}` }); }, { once: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamData]);

  // Video events
  useEffect(() => {
    const video = videoRef.current; if (!video) return;
    let lastReport = 0;
    const onTime = () => {
      if (!isSeeking && !longPressScrub?.active) setCurrentTime(video.currentTime);
      const now = Math.floor(video.currentTime);
      if (now !== lastReport && now % 5 === 0) { lastReport = now; onTimeUpdate?.(now); }
      if (hasNextEpisode && video.duration && video.duration > 40) { const rem = video.duration - video.currentTime; setShowNextEpPrompt(rem <= 40 && rem > 0); }
    };
    const onDur = () => setDuration(video.duration || 0);
    const onPlay = () => { setIsPaused(false); flashControls(); };
    const onPause = () => { setIsPaused(true); setShowControls(true); };
    const onEnd = () => { if (hasNextEpisode && !nextEpTriggered.current) { nextEpTriggered.current = true; setShowNextEpPrompt(false); onNextEpisode?.(); } else { onEnded?.(); } };
    video.addEventListener('timeupdate', onTime); video.addEventListener('durationchange', onDur);
    video.addEventListener('play', onPlay); video.addEventListener('pause', onPause); video.addEventListener('ended', onEnd);
    return () => { video.removeEventListener('timeupdate', onTime); video.removeEventListener('durationchange', onDur); video.removeEventListener('play', onPlay); video.removeEventListener('pause', onPause); video.removeEventListener('ended', onEnd); };
  }, [onTimeUpdate, onEnded, onNextEpisode, hasNextEpisode, flashControls, isSeeking]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="space-y-1 fade-in">
      <div ref={containerRef}
        className={`relative bg-black overflow-hidden touch-manipulation select-none ${isFullscreen ? 'w-screen h-screen' : 'aspect-video rounded-xl'}`}
        onClick={handleContainerClick} onDoubleClick={handleDoubleClick}
        onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
        onMouseMove={flashControls}
        style={{
          ...(isFullscreen ? { position: 'fixed', inset: 0, zIndex: 9999 } as const : {}),
          WebkitUserSelect: 'none', userSelect: 'none',
          WebkitTouchCallout: 'none',
        } as React.CSSProperties}>

        <video ref={videoRef} className="w-full h-full object-contain bg-black" playsInline crossOrigin="anonymous" />

        {/* Loading spinner */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20">
            <div className="flex flex-col items-center gap-2">
              <svg className="spinner w-8 h-8 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" opacity="0.75" /></svg>
              <span className="text-white/50 text-xs">Hang on Cid...</span>
            </div>
          </div>
        )}

        {/* Transitioning to next ep overlay */}
        {transitioning && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20 pointer-events-none">
            <div className="flex flex-col items-center gap-2 rounded-2xl bg-black/60 px-5 py-4 backdrop-blur-md border border-white/10">
              <svg className="spinner w-7 h-7 text-purple-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" opacity="0.75" /></svg>
              <span className="text-white/85 text-sm font-medium">Loading next episode…</span>
              {nextEpisodeNum && <span className="text-white/45 text-xs">Ep {nextEpisodeNum}</span>}
            </div>
          </div>
        )}

        {/* Long-press scrub indicator */}
        {longPressScrub?.active && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
            <div className="bg-black/80 rounded-2xl px-5 py-3 backdrop-blur-md border border-white/10 flex flex-col items-center gap-1">
              <span className="text-white font-mono text-lg font-bold tabular-nums">{fmt(longPressScrub.time)}</span>
              <span className="text-white/40 text-[10px]">↔ drag to scrub</span>
            </div>
          </div>
        )}

        {/* Skip 10s indicators */}
        {skipIndicator && (
          <div className={`absolute top-1/2 -translate-y-1/2 z-30 pointer-events-none fade-in ${skipIndicator.side === 'left' ? 'left-4 sm:left-10' : 'right-4 sm:right-10'}`}>
            <div className="bg-black/70 rounded-full px-4 py-2 text-white text-sm font-medium backdrop-blur-sm">
              {skipIndicator.side === 'left' ? '⏪ 10s' : '⏩ 10s'}
            </div>
          </div>
        )}

        {/* Center play button when paused */}
        {showControls && !loading && isPaused && (
          <button className="absolute inset-0 z-10 flex items-center justify-center" onClick={(e) => { e.stopPropagation(); togglePlay(); flashControls(); }}>
            <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="white" className="w-8 h-8 ml-1"><polygon points="5,3 19,12 5,21" /></svg>
            </div>
          </button>
        )}

        {/* Top bar: speed control */}
        <div className={`absolute top-0 left-0 right-0 z-30 p-2 sm:p-3 flex justify-end transition-opacity duration-300 pointer-events-none ${showControls ? 'opacity-100' : 'opacity-0'}`}>
          <div className="relative pointer-events-auto">
            <button onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(!showSpeedMenu); flashControls(); }}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-black/60 text-white hover:bg-black/80 backdrop-blur-sm border border-white/10">
              {speed}x
            </button>
            {showSpeedMenu && (
              <div className="absolute top-full right-0 mt-1 bg-black/90 border border-white/15 rounded-lg overflow-hidden shadow-2xl backdrop-blur-md" onClick={e => e.stopPropagation()}>
                {SPEEDS.map(s => (
                  <button key={s} onClick={() => changeSpeed(s)}
                    className={`block w-full px-5 py-2.5 text-sm text-left whitespace-nowrap ${s === speed ? 'bg-purple-600 text-white font-bold' : 'text-white/70 hover:bg-white/10'}`}>
                    {s}x{s === 1 ? ' normal' : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Near-end next episode popup */}
        {showNextEpPrompt && hasNextEpisode && (
          <div className="absolute bottom-20 sm:bottom-24 right-3 sm:right-4 z-30 fade-in pointer-events-auto">
            <button onClick={(e) => { e.stopPropagation(); handleNextEpisode(); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold shadow-2xl border border-purple-400/30"
              style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}>
              Next: Ep {nextEpisodeNum} ▶
            </button>
          </div>
        )}

        {/* ── BOTTOM CONTROLS ── */}
        <div className={`absolute bottom-0 left-0 right-0 z-30 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
          style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.9))' }}>

          {/* Seek bar — uses ref for precise position calc, supports drag */}
          <div data-ctrl ref={seekBarRef}
            className="px-3 sm:px-4 pt-5 pb-1.5 cursor-pointer group"
            onMouseDown={onSeekMouseDown} onTouchStart={onSeekTouchStart}>
            <div className="relative h-1 group-hover:h-2 group-active:h-2 bg-white/20 rounded-full transition-all">
              <div className="absolute left-0 top-0 h-full bg-purple-500 rounded-full" style={{ width: `${progress}%` }} />
              <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-lg scale-0 group-hover:scale-100 group-active:scale-100 transition-transform"
                style={{ left: `calc(${progress}% - 7px)` }} />
            </div>
          </div>

          {/* Button row */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 px-3 sm:px-4 pb-2.5 sm:pb-3 pointer-events-auto">
            {/* Play/Pause */}
            <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="text-white hover:text-purple-300 p-1">
              {isPaused
                ? <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><polygon points="5,3 19,12 5,21" /></svg>
                : <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><rect x="5" y="3" width="4" height="18" /><rect x="15" y="3" width="4" height="18" /></svg>
              }
            </button>

            {/* Next episode button — always visible if there's a next ep */}
            {hasNextEpisode && (
              <button onClick={(e) => { e.stopPropagation(); handleNextEpisode(); }}
                className="text-white/70 hover:text-white p-1" title={`Next: Ep ${nextEpisodeNum}`}>
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
              </button>
            )}

            {/* Time */}
            <span className="text-white/50 text-[10px] sm:text-xs font-mono tabular-nums ml-1">
              {fmt(currentTime)} / {fmt(duration)}
            </span>

            <div className="flex-1" />

            {/* Fullscreen */}
            <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} className="text-white/60 hover:text-white p-1">
              {isFullscreen
                ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" /></svg>
                : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
              }
            </button>
          </div>
        </div>
      </div>

      {/* Below player (outside fullscreen only) */}
      {!isFullscreen && (
        <>
          <p className="text-[10px] text-white/15 px-1">Double-tap sides to skip 10s • {streamData.sourceName}</p>
          {hlsError && <div className="p-2 rounded-lg bg-red-950/30 border border-red-500/20 text-[10px] font-mono text-red-300/60 break-all">{hlsError}</div>}
        </>
      )}
    </div>
  );
}
