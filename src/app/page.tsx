'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import TechnicalError from '@/components/TechnicalError';
import VideoPlayer from '@/components/VideoPlayer';
import { safeFetch } from '@/lib/client-fetch';
import type { ApiError } from '@/lib/client-fetch';
import { getHistory, getLastWatched, upsertWatch, updateTimestamp, removeWatch, timeAgo } from '@/lib/watch-history';
import type { WatchEntry } from '@/lib/watch-history';

interface AnimeResult {
  id: number; title: string; titleJp: string | null; image: string; banner: string | null;
  format: string | null; episodes: number | null; status: string | null; score: number | null;
  year: number | null; genres: string[]; description: string | null;
}
interface AnimeDetail extends AnimeResult {
  studios: string[]; season: string | null; duration: number | null; source: string | null;
  anidbId?: string; anidbSlug?: string;
  providerEpisodes?: Array<{ id: number; number: number; filler: boolean }>;
}
interface StreamSource { url: string; quality: string; isM3U8: boolean; }
interface StreamData {
  sources: StreamSource[]; subtitles: Array<{ lang: string; url: string }>;
  headers?: Record<string, string>; provider: string;
}

type AppView = 'home' | 'search' | 'detail' | 'player';

const GREETINGS = [
  "Welcome back Cid 💜", "Missed you Cid~ 💕", "There you are, Cid ✨",
  "Hey cutie, welcome back 💫", "Cid's back! Finally~ 🌸",
];
const LOADING_MSGS = [
  "Hold on Cid, getting that for you~", "One sec babe, loading...",
  "Wait Cid, it's coming~ ✨", "Almost there, don't go anywhere 💜",
];
const DROP_MSGS = [
  "or you gonna drop this one too? 😏", "don't you dare drop another one 😤",
  "you better finish this time 💅", "no dropping allowed, Cid 🙅‍♀️",
];

function randomPick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export default function HomePage() {
  const [view, setView] = useState<AppView>('home');
  const [greeting] = useState(() => randomPick(GREETINGS));

  // Browse
  type BrowseTab = 'trending' | 'recent' | 'popular' | 'top';
  const [browseTab, setBrowseTab] = useState<BrowseTab>('recent');
  const [browseResults, setBrowseResults] = useState<AnimeResult[]>([]);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [browseHasMore, setBrowseHasMore] = useState(true);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AnimeResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<ApiError | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Detail
  const [selectedAnime, setSelectedAnime] = useState<AnimeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<ApiError | null>(null);

  // Player
  const [selectedEp, setSelectedEp] = useState(1);
  const [streamData, setStreamData] = useState<StreamData | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamTransitioning, setStreamTransitioning] = useState(false);
  const [streamError, setStreamError] = useState<ApiError | null>(null);
  const [resumeTime, setResumeTime] = useState(0);

  // History
  const [history, setHistory] = useState<WatchEntry[]>([]);
  const [lastWatched, setLastWatched] = useState<WatchEntry | null>(null);

  // Refresh history
  const refreshHistory = useCallback(() => {
    setHistory(getHistory());
    setLastWatched(getLastWatched());
  }, []);

  // Load browse results
  const loadBrowse = useCallback(async (tab: string, page: number, append: boolean) => {
    setBrowseLoading(true);
    const r = await safeFetch<{ results: AnimeResult[]; hasNextPage: boolean }>(`/api/browse?sort=${tab}&page=${page}`);
    if (r.ok && r.data?.results) {
      setBrowseResults(prev => append ? [...prev, ...r.data!.results.filter(a => !prev.some(p => p.id === a.id))] : r.data!.results);
      setBrowseHasMore(r.data.hasNextPage || false);
    } else {
      if (!append) setBrowseResults([]);
      setBrowseHasMore(false);
    }
    setBrowseLoading(false);
  }, []);

  // Load on mount
  useEffect(() => {
    refreshHistory();
    loadBrowse('recent', 1, false);
  }, [refreshHistory, loadBrowse]);

  // Switch browse tab
  const switchBrowseTab = useCallback((tab: BrowseTab) => {
    setBrowseTab(tab);
    setBrowsePage(1);
    setBrowseResults([]);
    loadBrowse(tab, 1, false);
  }, [loadBrowse]);

  // Load more
  const loadMoreBrowse = useCallback(() => {
    const next = browsePage + 1;
    setBrowsePage(next);
    loadBrowse(browseTab, next, true);
  }, [browsePage, browseTab, loadBrowse]);

  // Search
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true); setSearchError(null); setSearchResults([]); setHasSearched(true);
    const r = await safeFetch<{ results: AnimeResult[] }>(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`);
    if (!r.ok) setSearchError(r.error!); else setSearchResults(r.data?.results || []);
    setSearchLoading(false);
  }, [searchQuery]);

  // Open anime
  const openAnime = useCallback(async (anime: AnimeResult) => {
    setView('detail'); setDetailLoading(true); setDetailError(null); setSelectedAnime(null);
    setStreamData(null); setStreamError(null);
    const r = await safeFetch<{ anime: AnimeDetail }>(`/api/anime/${anime.id}`);
    if (!r.ok) setDetailError(r.error!); else setSelectedAnime(r.data!.anime);
    setDetailLoading(false);
  }, []);

  // Play episode
  const playEpisode = useCallback(async (ep: number, options?: { seamless?: boolean }) => {
    if (!selectedAnime) return;
    const seamless = !!options?.seamless;

    if (!seamless) {
      setSelectedEp(ep);
    }
    setView('player');
    setStreamError(null);
    setStreamLoading(!seamless);
    setStreamTransitioning(seamless);
    if (!seamless) {
      setStreamData(null);
    }

    // Check if we have a saved timestamp for this ep
    const hist = getHistory().find(h => h.animeId === selectedAnime.id);
    const nextResumeTime = hist && hist.episodeNum === ep ? hist.timestamp : 0;
    setResumeTime(nextResumeTime);

    const params = new URLSearchParams();
    params.set('title', selectedAnime.title);
    if (selectedAnime.anidbId) params.set('anidbId', selectedAnime.anidbId);
    const r = await safeFetch<{ stream: StreamData }>(`/api/stream/${selectedAnime.id}/${ep}?${params.toString()}`);
    if (!r.ok) {
      setStreamError(r.error!);
    } else {
      setSelectedEp(ep);
      setResumeTime(nextResumeTime);
      setStreamData(r.data!.stream);
      // Save to history
      upsertWatch({
        animeId: selectedAnime.id, title: selectedAnime.title, image: selectedAnime.image,
        episodeNum: ep, totalEpisodes: selectedAnime.providerEpisodes?.length || selectedAnime.episodes, timestamp: 0,
        lastWatched: Date.now(), anidbId: selectedAnime.anidbId,
      });
      refreshHistory();
    }
    setStreamLoading(false);
    setStreamTransitioning(false);
  }, [selectedAnime, refreshHistory]);

  // Next episode helpers
  const getNextEpisode = useCallback((): number | undefined => {
    if (!selectedAnime) return undefined;
    const episodeNumbers = getEpisodeNumbers(selectedAnime);
    const currentIndex = episodeNumbers.indexOf(selectedEp);
    return currentIndex >= 0 ? episodeNumbers[currentIndex + 1] : undefined;
  }, [selectedAnime, selectedEp]);

  // Auto-next / manual next episode — seamless, stays in player view
  const handleNextEpisode = useCallback(() => {
    const nextEp = getNextEpisode();
    if (nextEp) playEpisode(nextEp, { seamless: true });
  }, [getNextEpisode, playEpisode]);

  // Fallback for when episode truly ends and there's no next
  const handleEpisodeEnded = useCallback(() => {
    const nextEp = getNextEpisode();
    if (!nextEp) {
      // No more episodes — do nothing, let user navigate
    }
  }, [getNextEpisode]);

  // Save timestamp
  const handleTimeUpdate = useCallback((time: number) => {
    if (selectedAnime) updateTimestamp(selectedAnime.id, selectedEp, time);
  }, [selectedAnime, selectedEp]);

  // Remove from history
  const handleRemoveHistory = useCallback((animeId: number) => {
    removeWatch(animeId);
    refreshHistory();
  }, [refreshHistory]);

  // Continue last watched
  const continueLastWatched = useCallback(async () => {
    if (!lastWatched) return;
    const fakeAnime: AnimeResult = { id: lastWatched.animeId, title: lastWatched.title, image: lastWatched.image,
      titleJp: null, banner: null, format: null, episodes: lastWatched.totalEpisodes, status: null,
      score: null, year: null, genres: [], description: null };
    await openAnime(fakeAnime);
  }, [lastWatched, openAnime]);

  // After detail loads, if coming from continue, auto-play
  const pendingAutoPlay = useRef(false);
  useEffect(() => {
    if (pendingAutoPlay.current && selectedAnime && !detailLoading) {
      pendingAutoPlay.current = false;
      const hist = getHistory().find(h => h.animeId === selectedAnime.id);
      if (hist) playEpisode(hist.episodeNum);
    }
  }, [selectedAnime, detailLoading, playEpisode]);

  const continueAndPlay = useCallback(async () => {
    pendingAutoPlay.current = true;
    await continueLastWatched();
  }, [continueLastWatched]);

  const goHome = useCallback(() => {
    setView('home'); setStreamData(null); setStreamError(null);
    setHasSearched(false); setSearchResults([]); setSearchQuery('');
    refreshHistory();
  }, [refreshHistory]);

  const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '').replace(/\n/g, ' ').trim();

  const getEpisodeNumbers = (anime: AnimeDetail | null): number[] => {
    if (!anime) return [];
    if (anime.providerEpisodes?.length) {
      return anime.providerEpisodes.map((e) => e.number);
    }
    if (anime.episodes && anime.episodes > 0) {
      return Array.from({ length: anime.episodes }, (_, i) => i + 1);
    }
    return [];
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a0a0f]/90 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 h-12 flex items-center justify-between">
          <button onClick={goHome} className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
            <span className="text-lg">💜</span>
            <span className="text-base font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">Cid&apos;s Anime</span>
          </button>
          <button onClick={() => { setView('search'); setHasSearched(false); setSearchResults([]); }}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors text-white/40 text-sm">🔍</button>
        </div>
      </header>

      {/* Breadcrumbs */}
      {(view === 'detail' || view === 'player') && (
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-1.5 w-full">
          <div className="flex items-center gap-1.5 text-xs text-white/40 overflow-hidden">
            <button onClick={goHome} className="hover:text-white/70 shrink-0">Home</button>
            {selectedAnime && <>
              <span>/</span>
              <button onClick={() => { setView('detail'); setStreamData(null); setStreamError(null); }}
                className="hover:text-white/70 truncate max-w-[150px] sm:max-w-[250px]">{selectedAnime.title}</button>
            </>}
            {view === 'player' && <><span>/</span><span className="text-pink-400 shrink-0">Ep {selectedEp}</span></>}
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex-1 w-full">

        {/* ── HOME ── */}
        {view === 'home' && (
          <div className="space-y-6 fade-in">
            {/* Greeting */}
            <div className="pt-4 pb-2">
              <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-indigo-400 bg-clip-text text-transparent">
                {greeting}
              </h1>
              {lastWatched && (
                <p className="text-white/40 text-sm mt-1">
                  You were watching <span className="text-pink-300">{lastWatched.title}</span> ep {lastWatched.episodeNum} · {timeAgo(lastWatched.lastWatched)}
                </p>
              )}
            </div>

            {/* Continue watching */}
            {lastWatched && (
              <div className="rounded-xl bg-gradient-to-r from-purple-900/30 to-pink-900/20 border border-purple-500/20 p-4">
                <div className="flex items-center gap-3">
                  <img src={lastWatched.image} alt="" className="w-14 h-20 sm:w-16 sm:h-24 rounded-lg object-cover border border-white/10 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-purple-300/80">Shall we continue? 💜</p>
                    <h3 className="font-semibold text-white text-sm sm:text-base truncate">{lastWatched.title}</h3>
                    <p className="text-xs text-white/40">Episode {lastWatched.episodeNum} {lastWatched.totalEpisodes ? `/ ${lastWatched.totalEpisodes}` : ''}</p>
                    <p className="text-[10px] text-white/25 mt-0.5 italic">{randomPick(DROP_MSGS)}</p>
                  </div>
                  <button onClick={continueAndPlay}
                    className="shrink-0 px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors">
                    ▶ Play
                  </button>
                </div>
              </div>
            )}

            {/* Watch history */}
            {history.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-white/50 mb-2">Your history 📖</h2>
                <div className="space-y-1.5">
                  {history.slice(0, 10).map(h => (
                    <div key={h.animeId} className="flex items-center gap-2.5 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors group">
                      <img src={h.image} alt="" className="w-10 h-14 rounded object-cover border border-white/5 shrink-0 cursor-pointer"
                        onClick={() => { const a: AnimeResult = { id: h.animeId, title: h.title, image: h.image, titleJp: null, banner: null, format: null, episodes: h.totalEpisodes, status: null, score: null, year: null, genres: [], description: null }; openAnime(a); }} />
                      <div className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => { const a: AnimeResult = { id: h.animeId, title: h.title, image: h.image, titleJp: null, banner: null, format: null, episodes: h.totalEpisodes, status: null, score: null, year: null, genres: [], description: null }; openAnime(a); }}>
                        <p className="text-sm text-white/70 truncate">{h.title}</p>
                        <p className="text-[10px] text-white/30">Ep {h.episodeNum} · {timeAgo(h.lastWatched)}</p>
                      </div>
                      <button onClick={() => handleRemoveHistory(h.animeId)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-600/20 text-white/20 hover:text-red-400 transition-all text-xs shrink-0"
                        title="Remove">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Browse anime */}
            <div>
              <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1 no-scrollbar">
                {([['recent', '🆕 New Releases'], ['trending', '🔥 Airing Now'], ['popular', '💫 Popular'], ['top', '⭐ Top Rated']] as const).map(([key, label]) => (
                  <button key={key} onClick={() => switchBrowseTab(key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${browseTab === key ? 'bg-purple-600 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {browseResults.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-3">
                  {browseResults.map(a => <AnimeCard key={a.id} anime={a} onClick={() => openAnime(a)} watched={history.some(h => h.animeId === a.id)} />)}
                </div>
              )}
              {browseLoading && browseResults.length === 0 && (
                <div className="text-center py-10 text-white/30 text-sm">{randomPick(LOADING_MSGS)}</div>
              )}
              {browseHasMore && (
                <button onClick={loadMoreBrowse} disabled={browseLoading}
                  className="mt-4 w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/8 text-white/40 text-sm font-medium transition-colors disabled:opacity-30">
                  {browseLoading ? randomPick(LOADING_MSGS) : 'Show me more~ 💜'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── SEARCH ── */}
        {view === 'search' && (
          <div className="space-y-4 fade-in">
            <div className="pt-2">
              <p className="text-white/40 text-sm">What are we watching next, Cid? 🔍</p>
            </div>
            <div className="flex gap-2">
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()} placeholder="Search anime..."
                autoFocus
                className="flex-1 bg-[#1a1a2e] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-purple-500/50 transition-all" />
              <button onClick={handleSearch} disabled={searchLoading || !searchQuery.trim()}
                className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-medium transition-colors">
                {searchLoading ? '...' : 'Go'}
              </button>
            </div>
            {searchError && <TechnicalError error={searchError} onRetry={handleSearch} />}
            {searchResults.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-3">
                {searchResults.map(a => <AnimeCard key={a.id} anime={a} onClick={() => openAnime(a)} watched={history.some(h => h.animeId === a.id)} />)}
              </div>
            )}
            {hasSearched && !searchLoading && !searchError && searchResults.length === 0 && (
              <p className="text-center text-white/30 py-6 text-sm">Nothing found~ try something else Cid</p>
            )}
          </div>
        )}

        {/* ── DETAIL ── */}
        {view === 'detail' && (
          <div className="fade-in">
            {detailLoading && <div className="flex flex-col items-center justify-center py-16 gap-2"><Spinner /><span className="text-white/30 text-xs">{randomPick(LOADING_MSGS)}</span></div>}
            {detailError && <TechnicalError error={detailError} onRetry={() => selectedAnime && openAnime(selectedAnime)} />}
            {selectedAnime && !detailLoading && (
              <div className="space-y-4">
                {/* Banner */}
                <div className="relative rounded-xl overflow-hidden">
                  {selectedAnime.banner && (
                    <div className="h-36 sm:h-52 relative">
                      <img src={selectedAnime.banner} alt="" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0f]/60 to-transparent" />
                    </div>
                  )}
                  <div className={`flex gap-3 sm:gap-4 ${selectedAnime.banner ? '-mt-16 relative z-10 px-3 sm:px-4' : ''}`}>
                    <img src={selectedAnime.image} alt={selectedAnime.title}
                      className="w-20 sm:w-28 rounded-xl shadow-2xl border border-white/10 shrink-0" />
                    <div className="flex-1 min-w-0 pt-1">
                      <h1 className="text-base sm:text-xl font-bold text-white leading-tight">{selectedAnime.title}</h1>
                      {selectedAnime.titleJp && <p className="text-[11px] text-white/30 mt-0.5">{selectedAnime.titleJp}</p>}
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {selectedAnime.format && <Badge>{selectedAnime.format}</Badge>}
                        {selectedAnime.year && <Badge>{selectedAnime.year}</Badge>}
                        {selectedAnime.status && <Badge>{selectedAnime.status}</Badge>}
                        {selectedAnime.score && <Badge>⭐ {selectedAnime.score}%</Badge>}
                        {selectedAnime.episodes && <Badge>{selectedAnime.episodes} eps</Badge>}
                      </div>
                      {selectedAnime.genres.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">{selectedAnime.genres.slice(0, 5).map(g =>
                          <span key={g} className="text-[9px] px-1.5 py-0.5 rounded bg-purple-600/20 text-purple-300">{g}</span>
                        )}</div>
                      )}
                    </div>
                  </div>
                </div>
                {selectedAnime.description && (
                  <p className="text-xs text-white/40 leading-relaxed">{stripHtml(selectedAnime.description).slice(0, 300)}{stripHtml(selectedAnime.description).length > 300 ? '...' : ''}</p>
                )}
                {/* Episodes */}
                <div>
                  <h2 className="text-sm font-semibold text-white/60 mb-2">Episodes</h2>
                  {(() => {
                    const histEntry = history.find(h => h.animeId === selectedAnime.id);
                    const watchedEp = histEntry?.episodeNum || 0;
                    const episodeNumbers = getEpisodeNumbers(selectedAnime);
                    return episodeNumbers.length > 0 ? (
                      <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-1.5">
                        {episodeNumbers.map(ep => (
                          <button key={ep} onClick={() => playEpisode(ep)}
                            className={`py-1.5 rounded-lg text-xs font-medium transition-all border ${
                              ep === watchedEp ? 'bg-purple-600 border-purple-500 text-white' :
                              ep < watchedEp ? 'bg-white/[0.03] border-white/5 text-white/30' :
                              'bg-[#1a1a2e] border-white/5 hover:border-purple-500/30 hover:bg-purple-600/20 text-white/60 hover:text-white'
                            }`}>{ep}</button>
                        ))}
                      </div>
                    ) : (
                      <button onClick={() => playEpisode(1)} className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium">▶ Play Episode 1</button>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PLAYER ── */}
        {view === 'player' && selectedAnime && (
          <div className="space-y-3 fade-in">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white">{selectedAnime.title}</h2>
              <p className="text-pink-400 text-xs font-medium">Episode {selectedEp}{getEpisodeNumbers(selectedAnime).length ? ` • ${getEpisodeNumbers(selectedAnime).length} available` : ''}</p>
            </div>
            {streamLoading && !streamData && (
              <div className="aspect-video bg-[#1a1a2e] rounded-xl flex items-center justify-center">
                <div className="flex flex-col items-center gap-2"><Spinner /><span className="text-white/30 text-xs">{randomPick(LOADING_MSGS)}</span></div>
              </div>
            )}
            {streamError && <TechnicalError error={streamError} onRetry={() => playEpisode(selectedEp)} />}
            {streamData && (() => {
              const nextEp = getNextEpisode();
              const streamUrl = streamData.sources[0]?.url || '';
              return (
                <>
                  <VideoPlayer
                    streamData={{ url: streamUrl, isHLS: streamData.sources[0]?.isM3U8 || false, sourceName: streamData.provider, all: streamData.sources.map(s => ({ res: s.quality, url: s.url })) }}
                    onError={err => setStreamError(err)}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={handleEpisodeEnded}
                    onNextEpisode={handleNextEpisode}
                    hasNextEpisode={!!nextEp}
                    nextEpisodeNum={nextEp}
                    initialTime={resumeTime}
                    transitioning={streamTransitioning}
                  />
                  {/* Download button */}
                  <div className="flex items-center gap-2 pt-1">
                    <a href={`/api/download?url=${encodeURIComponent(streamUrl)}&name=${encodeURIComponent(`${selectedAnime.title} - Episode ${selectedEp}`)}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white text-xs font-medium transition-colors">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      Download Ep {selectedEp}
                    </a>
                    <span className="text-[10px] text-white/20">{streamData.provider}</span>
                  </div>
                </>
              );
            })()}
            {/* Episode nav */}
            {getEpisodeNumbers(selectedAnime).length > 1 && (
              <div className="pt-3 border-t border-white/5">
                {(() => {
                  const episodeNumbers = getEpisodeNumbers(selectedAnime);
                  const currentIndex = episodeNumbers.indexOf(selectedEp);
                  const prevEp = currentIndex > 0 ? episodeNumbers[currentIndex - 1] : undefined;
                  const nextEp = currentIndex >= 0 ? episodeNumbers[currentIndex + 1] : undefined;
                  return (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-white/30">Episodes</span>
                        <div className="flex gap-1.5">
                          {prevEp && <button onClick={() => playEpisode(prevEp)} className="px-2 py-0.5 rounded bg-white/5 text-[10px] text-white/40 hover:bg-white/10">← Prev</button>}
                          {nextEp && <button onClick={() => playEpisode(nextEp)} className="px-2 py-0.5 rounded bg-purple-600/30 text-[10px] text-purple-300 hover:bg-purple-600/50">Next →</button>}
                        </div>
                      </div>
                      <div className="flex gap-1 flex-wrap max-h-20 overflow-auto">
                        {episodeNumbers.map(ep => (
                          <button key={ep} onClick={() => playEpisode(ep)}
                            className={`py-0.5 px-2 rounded text-[10px] font-medium transition-all ${ep === selectedEp ? 'bg-purple-600 text-white' : 'bg-white/5 text-white/30 hover:bg-white/10'}`}>{ep}</button>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-white/5 py-3 mt-auto">
        <div className="max-w-6xl mx-auto px-3 text-center text-[10px] text-white/15">
          Made with 💜 just for Cid
        </div>
      </footer>
    </div>
  );
}

function AnimeCard({ anime, onClick, watched }: { anime: AnimeResult; onClick: () => void; watched?: boolean }) {
  return (
    <button onClick={onClick} className="text-left group">
      <div className="aspect-[2/3] rounded-lg overflow-hidden bg-[#1a1a2e] border border-white/5 group-hover:border-purple-500/30 transition-all relative">
        {anime.image && <img src={anime.image} alt={anime.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        {watched && <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-purple-500" title="Watched" />}
        <div className="absolute bottom-0 left-0 right-0 p-1.5">
          {anime.score && <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-600/80 text-white inline-block">⭐ {anime.score}%</span>}
        </div>
      </div>
      <h3 className="mt-1 text-[11px] sm:text-xs font-medium text-white/70 group-hover:text-purple-300 transition-colors line-clamp-2 leading-tight">{anime.title}</h3>
      <div className="flex items-center gap-1 mt-0.5">
        {anime.year && <span className="text-[9px] text-white/25">{anime.year}</span>}
        {anime.episodes && <span className="text-[9px] text-white/25">· {anime.episodes}ep</span>}
      </div>
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/50">{children}</span>;
}

function Spinner() {
  return <svg className="spinner w-7 h-7 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" opacity="0.75" /></svg>;
}
