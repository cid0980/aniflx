'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import TechnicalError from '@/components/TechnicalError';
import VideoPlayer from '@/components/VideoPlayer';
import { safeFetch } from '@/lib/client-fetch';
import type { ApiError } from '@/lib/client-fetch';
import { getHistory, getLastWatched, upsertWatch, updateTimestamp, removeWatch, timeAgo } from '@/lib/watch-history';
import type { WatchEntry } from '@/lib/watch-history';
import { getAnimeEpisodes } from '@/lib/offline-store';

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
  currentLang?: string; availableLangs?: Array<{ code: string; name: string }>;
}

type AppView = 'home' | 'search' | 'detail' | 'player';

const GREETINGS = [
  "Hey there, Cid~ welcome back", "Finally! I was waiting for you, Cid",
  "There you are~ took you long enough", "Cid! I saved your spot, don't worry",
  "About time you showed up, Cid~",
];
const LOADING_MSGS = [
  "Getting that ready for you~", "Hold on, almost there...",
  "Just a moment, Cid~", "Working on it, be right back~",
];
const DROP_MSGS = [
  "you're not dropping this one... right?", "don't even think about dropping this",
  "finish this one for me, okay?", "I'll be disappointed if you drop this~",
];

function randomPick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// ── SVG Icons ──
const I = {
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>,
  play: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><polygon points="5,3 19,12 5,21"/></svg>,
  playLg: <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 ml-0.5"><polygon points="5,3 19,12 5,21"/></svg>,
  download: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  star: <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 text-amber-400"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  x: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg>,
  warn: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  heart: <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-pink-500"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  chevDown: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><polyline points="6 9 12 15 18 9"/></svg>,
  chevUp: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><polyline points="18 15 12 9 6 15"/></svg>,
};

export default function HomePage() {
  const [view, setView] = useState<AppView>('home');
  const [greeting] = useState(() => randomPick(GREETINGS));

  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);

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
  const [audioLang, setAudioLang] = useState<string>('eng');
  const [availableLangs, setAvailableLangs] = useState<Array<{ code: string; name: string }>>([]);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

  // History
  const [history, setHistory] = useState<WatchEntry[]>([]);
  const [lastWatched, setLastWatched] = useState<WatchEntry | null>(null);

  const refreshHistory = useCallback(() => { setHistory(getHistory()); setLastWatched(getLastWatched()); }, []);

  const loadBrowse = useCallback(async (tab: string, page: number, append: boolean) => {
    setBrowseLoading(true);
    const r = await safeFetch<{ results: AnimeResult[]; hasNextPage: boolean }>(`/api/browse?sort=${tab}&page=${page}`);
    if (r.ok && r.data?.results) {
      setBrowseResults(prev => append ? [...prev, ...r.data!.results.filter(a => !prev.some(p => p.id === a.id))] : r.data!.results);
      setBrowseHasMore(r.data.hasNextPage || false);
    } else { if (!append) setBrowseResults([]); setBrowseHasMore(false); }
    setBrowseLoading(false);
  }, []);

  useEffect(() => { refreshHistory(); loadBrowse('recent', 1, false); }, [refreshHistory, loadBrowse]);

  const switchBrowseTab = useCallback((tab: BrowseTab) => { setBrowseTab(tab); setBrowsePage(1); setBrowseResults([]); loadBrowse(tab, 1, false); }, [loadBrowse]);
  const loadMoreBrowse = useCallback(() => { const next = browsePage + 1; setBrowsePage(next); loadBrowse(browseTab, next, true); }, [browsePage, browseTab, loadBrowse]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true); setSearchError(null); setSearchResults([]); setHasSearched(true);
    const r = await safeFetch<{ results: AnimeResult[] }>(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`);
    if (!r.ok) setSearchError(r.error!); else setSearchResults(r.data?.results || []);
    setSearchLoading(false);
  }, [searchQuery]);

  const openAnime = useCallback(async (anime: AnimeResult) => {
    setView('detail'); setDetailLoading(true); setDetailError(null); setSelectedAnime(null);
    setStreamData(null); setStreamError(null);
    const r = await safeFetch<{ anime: AnimeDetail }>(`/api/anime/${anime.id}`);
    if (!r.ok) setDetailError(r.error!); else setSelectedAnime(r.data!.anime);
    setDetailLoading(false);
  }, []);

  const playEpisode = useCallback(async (ep: number, options?: { seamless?: boolean }) => {
    if (!selectedAnime) return;
    const seamless = !!options?.seamless;
    if (!seamless) setSelectedEp(ep);
    setView('player'); setStreamError(null); setStreamLoading(!seamless); setStreamTransitioning(seamless);
    if (!seamless) setStreamData(null);
    const hist = getHistory().find(h => h.animeId === selectedAnime.id);
    const nextResumeTime = hist && hist.episodeNum === ep ? hist.timestamp : 0;
    setResumeTime(nextResumeTime);
    const params = new URLSearchParams();
    params.set('title', selectedAnime.title);
    if (selectedAnime.anidbId) params.set('anidbId', selectedAnime.anidbId);
    params.set('lang', audioLang);
    const r = await safeFetch<{ stream: StreamData }>(`/api/stream/${selectedAnime.id}/${ep}?${params.toString()}`);
    if (!r.ok) { setStreamError(r.error!); }
    else {
      setSelectedEp(ep); setResumeTime(nextResumeTime); setStreamData(r.data!.stream);
      if (r.data!.stream.availableLangs) setAvailableLangs(r.data!.stream.availableLangs);
      if (r.data!.stream.currentLang) setAudioLang(r.data!.stream.currentLang);
      upsertWatch({ animeId: selectedAnime.id, title: selectedAnime.title, image: selectedAnime.image,
        episodeNum: ep, totalEpisodes: selectedAnime.providerEpisodes?.length || selectedAnime.episodes,
        timestamp: 0, lastWatched: Date.now(), anidbId: selectedAnime.anidbId });
      refreshHistory();
    }
    setStreamLoading(false); setStreamTransitioning(false);
  }, [selectedAnime, refreshHistory, audioLang]);

  const getEpisodeNumbers = (anime: AnimeDetail | null): number[] => {
    if (!anime) return [];
    if (anime.providerEpisodes?.length) return anime.providerEpisodes.map(e => e.number);
    if (anime.episodes && anime.episodes > 0) return Array.from({ length: anime.episodes }, (_, i) => i + 1);
    return [];
  };

  const getNextEpisode = useCallback((): number | undefined => {
    if (!selectedAnime) return undefined;
    const eps = getEpisodeNumbers(selectedAnime);
    const idx = eps.indexOf(selectedEp);
    return idx >= 0 ? eps[idx + 1] : undefined;
  }, [selectedAnime, selectedEp]);

  const handleNextEpisode = useCallback(() => { const n = getNextEpisode(); if (n) playEpisode(n, { seamless: true }); }, [getNextEpisode, playEpisode]);
  const handleEpisodeEnded = useCallback(() => { const n = getNextEpisode(); if (!n) { /* last ep */ } }, [getNextEpisode]);
  const handleTimeUpdate = useCallback((time: number) => { if (selectedAnime) updateTimestamp(selectedAnime.id, selectedEp, time); }, [selectedAnime, selectedEp]);

  const switchLang = useCallback((lang: string) => {
    setAudioLang(lang);
    if (selectedAnime) {
      const ep = selectedEp;
      const params = new URLSearchParams();
      params.set('title', selectedAnime.title);
      if (selectedAnime.anidbId) params.set('anidbId', selectedAnime.anidbId);
      params.set('lang', lang);
      setStreamLoading(true);
      safeFetch<{ stream: StreamData }>(`/api/stream/${selectedAnime.id}/${ep}?${params.toString()}`).then(r => {
        if (r.ok && r.data?.stream) { setStreamData(r.data.stream); if (r.data.stream.availableLangs) setAvailableLangs(r.data.stream.availableLangs); }
        setStreamLoading(false);
      });
    }
  }, [selectedAnime, selectedEp]);

  const handleRemoveHistory = useCallback((id: number) => { removeWatch(id); refreshHistory(); }, [refreshHistory]);

  const continueLastWatched = useCallback(async () => {
    if (!lastWatched) return;
    const a: AnimeResult = { id: lastWatched.animeId, title: lastWatched.title, image: lastWatched.image, titleJp: null, banner: null, format: null, episodes: lastWatched.totalEpisodes, status: null, score: null, year: null, genres: [], description: null };
    await openAnime(a);
  }, [lastWatched, openAnime]);

  const pendingAutoPlay = useRef(false);
  useEffect(() => {
    if (pendingAutoPlay.current && selectedAnime && !detailLoading) {
      pendingAutoPlay.current = false;
      const hist = getHistory().find(h => h.animeId === selectedAnime.id);
      if (hist) playEpisode(hist.episodeNum);
    }
  }, [selectedAnime, detailLoading, playEpisode]);

  const continueAndPlay = useCallback(async () => { pendingAutoPlay.current = true; await continueLastWatched(); }, [continueLastWatched]);

  const goHome = useCallback(() => {
    setView('home'); setStreamData(null); setStreamError(null);
    setHasSearched(false); setSearchResults([]); setSearchQuery('');
    refreshHistory();
  }, [refreshHistory]);

  const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '').replace(/\n/g, ' ').trim();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Confirm Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setConfirmDialog(null)}>
          <div className="bg-[#14142a] rounded-t-2xl sm:rounded-2xl border border-white/[0.06] p-5 mx-0 sm:mx-4 max-w-sm w-full shadow-2xl slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-red-500/10 text-red-400 shrink-0">{I.warn}</div>
              <div className="pt-1">
                <p className="text-sm font-semibold text-white/90 mb-1">Remove from history?</p>
                <p className="text-xs text-white/40">{confirmDialog.message}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDialog(null)} className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 text-sm font-medium transition-colors">Cancel</button>
              <button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors">Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#08080e]/95 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 h-13 flex items-center justify-between">
          <button onClick={goHome} className="flex items-center gap-2 hover:opacity-80 transition-opacity group">
            <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:shadow-purple-500/40 transition-shadow gradient-shift">
              {I.playLg}
            </div>
            <span className="text-sm font-extrabold bg-gradient-to-r from-purple-300 via-fuchsia-300 to-pink-300 bg-clip-text text-transparent">AniFlix</span>
          </button>
          <button onClick={() => { setView('search'); setHasSearched(false); setSearchResults([]); }}
            className="p-2.5 rounded-xl hover:bg-white/5 transition-colors text-white/40 hover:text-white/70">{I.search}</button>
        </div>
      </header>

      {/* Breadcrumbs */}
      {(view === 'detail' || view === 'player') && (
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-1.5 w-full">
          <div className="flex items-center gap-1.5 text-xs text-white/40 overflow-hidden">
            <button onClick={goHome} className="hover:text-white/70 shrink-0">Home</button>
            {selectedAnime && <><span>/</span><button onClick={() => { setView('detail'); setStreamData(null); setStreamError(null); }} className="hover:text-white/70 truncate max-w-[150px] sm:max-w-[250px]">{selectedAnime.title}</button></>}
            {view === 'player' && <><span>/</span><span className="text-purple-400 shrink-0">Ep {selectedEp}</span></>}
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex-1 w-full">

        {/* ── HOME ── */}
        {view === 'home' && (
          <div className="space-y-6 fade-in">
            <div className="pt-6 pb-2">
              <h1 className="text-2xl sm:text-3xl font-extrabold glow-text slide-up">
                <span className="bg-gradient-to-r from-purple-300 via-fuchsia-300 to-pink-300 bg-clip-text text-transparent">{greeting}</span>
              </h1>
              {lastWatched && (
                <p className="text-white/35 text-sm mt-2 fade-in">
                  You were watching <span className="text-purple-400 font-medium">{lastWatched.title}</span> · ep {lastWatched.episodeNum} · {timeAgo(lastWatched.lastWatched)}
                </p>
              )}
            </div>

            {lastWatched && (
              <div className="rounded-2xl bg-gradient-to-r from-purple-950/40 via-fuchsia-950/30 to-pink-950/20 border border-purple-500/10 p-4 slide-up card-glow">
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    <img src={lastWatched.image} alt="" className="w-14 h-20 sm:w-16 sm:h-24 rounded-xl object-cover border border-white/10" />
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-t from-purple-900/50 to-transparent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-purple-400/80 font-semibold uppercase tracking-widest mb-0.5">Continue watching</p>
                    <h3 className="font-bold text-white text-sm sm:text-base truncate">{lastWatched.title}</h3>
                    <p className="text-xs text-white/35 mt-0.5">Episode {lastWatched.episodeNum} {lastWatched.totalEpisodes ? `of ${lastWatched.totalEpisodes}` : ''}</p>
                    <p className="text-[10px] text-pink-400/40 mt-1 italic">{randomPick(DROP_MSGS)}</p>
                  </div>
                  <button onClick={continueAndPlay} className="shrink-0 w-11 h-11 rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white flex items-center justify-center transition-all shadow-lg shadow-purple-600/25 hover:shadow-purple-500/40 hover:scale-105 active:scale-95">
                    {I.playLg}
                  </button>
                </div>
              </div>
            )}

            {history.length > 0 && (
              <HistorySection history={history}
                onOpen={(h) => { const a: AnimeResult = { id: h.animeId, title: h.title, image: h.image, titleJp: null, banner: null, format: null, episodes: h.totalEpisodes, status: null, score: null, year: null, genres: [], description: null }; openAnime(a); }}
                onRemove={(id, title) => setConfirmDialog({ message: `Remove "${title}" from your history?`, onConfirm: () => handleRemoveHistory(id) })} />
            )}

            <div>
              <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1 no-scrollbar">
                {([['recent', 'New Releases'], ['trending', 'Airing Now'], ['popular', 'Popular'], ['top', 'Top Rated']] as const).map(([key, label]) => (
                  <button key={key} onClick={() => switchBrowseTab(key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${browseTab === key ? 'bg-purple-600 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {browseResults.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-3">
                  {browseResults.map(a => <AnimeCard key={a.id} anime={a} onClick={() => openAnime(a)} watched={history.some(h => h.animeId === a.id)} />)}
                </div>
              )}
              {browseLoading && browseResults.length === 0 && <div className="text-center py-10 text-white/30 text-sm">{randomPick(LOADING_MSGS)}</div>}
              {browseHasMore && (
                <button onPointerUp={(e) => { e.stopPropagation(); if (!browseLoading) loadMoreBrowse(); }} disabled={browseLoading}
                  className="mt-4 w-full py-3.5 rounded-xl bg-white/5 active:bg-white/10 text-white/40 text-sm font-medium transition-colors disabled:opacity-30 touch-manipulation select-none">
                  {browseLoading ? randomPick(LOADING_MSGS) : 'Show me more~'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── SEARCH ── */}
        {view === 'search' && (
          <div className="space-y-4 fade-in">
            <div className="pt-2"><p className="text-white/35 text-sm">What are we watching next, Cid?</p></div>
            <div className="flex gap-2">
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()} placeholder="Search anime..." autoFocus
                className="flex-1 bg-[#1a1a2e] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-purple-500/50 transition-all" />
              <button onClick={handleSearch} disabled={searchLoading || !searchQuery.trim()}
                className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-medium transition-colors">
                {searchLoading ? '...' : 'Go'}
              </button>
            </div>
            {searchError && <TechnicalError error={searchError} onRetry={handleSearch} />}
            {searchResults.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-3">
                {searchResults.map(a => <AnimeCard key={a.id} anime={a} onClick={() => openAnime(a)} watched={history.some(h => h.animeId === a.id)} />)}
              </div>
            )}
            {hasSearched && !searchLoading && !searchError && searchResults.length === 0 && (
              <p className="text-center text-white/30 py-6 text-sm">Nothing found — try something else, Cid</p>
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
                <div className="relative rounded-xl overflow-hidden">
                  {selectedAnime.banner && (
                    <div className="h-36 sm:h-52 relative">
                      <img src={selectedAnime.banner} alt="" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0f]/60 to-transparent" />
                    </div>
                  )}
                  <div className={`flex gap-3 sm:gap-4 ${selectedAnime.banner ? '-mt-16 relative z-10 px-3 sm:px-4' : ''}`}>
                    <img src={selectedAnime.image} alt={selectedAnime.title} className="w-20 sm:w-28 rounded-xl shadow-2xl border border-white/10 shrink-0" />
                    <div className="flex-1 min-w-0 pt-1">
                      <h1 className="text-base sm:text-xl font-bold text-white leading-tight">{selectedAnime.title}</h1>
                      {selectedAnime.titleJp && <p className="text-[11px] text-white/30 mt-0.5">{selectedAnime.titleJp}</p>}
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {selectedAnime.format && <Badge>{selectedAnime.format}</Badge>}
                        {selectedAnime.year && <Badge>{selectedAnime.year}</Badge>}
                        {selectedAnime.status && <Badge>{selectedAnime.status}</Badge>}
                        {selectedAnime.score && <Badge><span className="inline-flex items-center gap-0.5">{I.star} {selectedAnime.score}%</span></Badge>}
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
                      <button onClick={() => playEpisode(1)} className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium flex items-center gap-2">{I.play} Play Episode 1</button>
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
              <p className="text-purple-400 text-xs font-medium">Episode {selectedEp}{getEpisodeNumbers(selectedAnime).length ? ` · ${getEpisodeNumbers(selectedAnime).length} available` : ''}</p>
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
                    onError={err => setStreamError(err)} onTimeUpdate={handleTimeUpdate} onEnded={handleEpisodeEnded}
                    onNextEpisode={handleNextEpisode} hasNextEpisode={!!nextEp} nextEpisodeNum={nextEp}
                    initialTime={resumeTime} transitioning={streamTransitioning}
                  />
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    <button onClick={() => {
                      if (downloadStatus === 'downloading') return;
                      setDownloadStatus('downloading');
                      const iframe = document.createElement('iframe');
                      iframe.style.display = 'none';
                      iframe.src = `/api/download?url=${encodeURIComponent(streamUrl)}&name=${encodeURIComponent(`${selectedAnime.title} - Episode ${selectedEp}`)}`;
                      document.body.appendChild(iframe);
                      setTimeout(() => { setDownloadStatus('done'); setTimeout(() => setDownloadStatus(null), 4000); }, 3000);
                      setTimeout(() => { try { document.body.removeChild(iframe); } catch {} }, 60000);
                    }} disabled={downloadStatus === 'downloading'}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${downloadStatus === 'downloading' ? 'bg-purple-600/20 text-purple-300' : 'bg-white/5 hover:bg-white/10 text-white/50 hover:text-white'}`}>
                      {downloadStatus === 'downloading' ? <><span className="inline-block w-3 h-3 border border-purple-400 border-t-transparent rounded-full spinner" /> Downloading...</>
                        : <>{I.download} Download Ep {selectedEp}</>}
                    </button>
                    <span className="text-[10px] text-white/20">{streamData.provider}</span>
                  </div>
                  {downloadStatus === 'done' && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-900/20 border border-green-500/10 text-green-300 text-xs font-medium fade-in">
                      {I.check} Download started — check your downloads, Cid
                    </div>
                  )}
                  {availableLangs.length > 1 && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[10px] text-white/30">Audio:</span>
                      {availableLangs.map(l => (
                        <button key={l.code} onClick={() => switchLang(l.code)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${audioLang === l.code ? 'bg-purple-600 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}>
                          {l.code === 'eng' ? 'English Dub' : l.code === 'jpn' ? 'Japanese Sub' : l.name}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
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
                          {prevEp && <button onClick={() => playEpisode(prevEp)} className="px-2.5 py-1 rounded bg-white/5 text-[10px] text-white/40 hover:bg-white/10">Prev</button>}
                          {nextEp && <button onClick={() => playEpisode(nextEp)} className="px-2.5 py-1 rounded bg-purple-600/30 text-[10px] text-purple-300 hover:bg-purple-600/50">Next</button>}
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

      <footer className="border-t border-white/[0.03] py-4 mt-auto">
        <div className="max-w-6xl mx-auto px-3 text-center text-[10px] text-white/10 flex items-center justify-center gap-1">
          Made with {I.heart} just for Cid
        </div>
      </footer>
    </div>
  );
}

function AnimeCard({ anime, onClick, watched }: { anime: AnimeResult; onClick: () => void; watched?: boolean }) {
  return (
    <button onClick={onClick} className="text-left group">
      <div className="aspect-[2/3] rounded-xl overflow-hidden bg-[#16162a] border border-white/[0.04] group-hover:border-purple-500/20 transition-all relative card-glow">
        {anime.image && <img src={anime.image} alt={anime.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
        {watched && <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-purple-400 ring-2 ring-black/60 shadow-lg shadow-purple-500/30" />}
        {anime.score && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-black/70 backdrop-blur-sm border border-white/[0.06]">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5 text-amber-400"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            <span className="text-[9px] text-white/80 font-medium">{anime.score}%</span>
          </div>
        )}
      </div>
      <h3 className="mt-1 text-[11px] sm:text-xs font-medium text-white/70 group-hover:text-purple-300 transition-colors line-clamp-2 leading-tight">{anime.title}</h3>
      <div className="flex items-center gap-1 mt-0.5">
        {anime.year && <span className="text-[9px] text-white/25">{anime.year}</span>}
        {anime.episodes && <span className="text-[9px] text-white/25">· {anime.episodes}ep</span>}
      </div>
    </button>
  );
}

function HistorySection({ history, onOpen, onRemove }: {
  history: WatchEntry[];
  onOpen: (h: WatchEntry) => void;
  onRemove: (id: number, title: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? history : history.slice(0, 5);
  return (
    <div>
      <h2 className="text-sm font-semibold text-white/50 mb-2 flex items-center gap-1.5">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        History
      </h2>
      <div className="space-y-1">
        {shown.map(h => (
          <div key={h.animeId} className="flex items-center gap-2.5 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
            <img src={h.image} alt="" className="w-10 h-14 rounded object-cover border border-white/5 shrink-0 cursor-pointer" onClick={() => onOpen(h)} />
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpen(h)}>
              <p className="text-sm text-white/70 truncate">{h.title}</p>
              <p className="text-[10px] text-white/30">Ep {h.episodeNum} · {timeAgo(h.lastWatched)}</p>
            </div>
            <button onClick={() => onRemove(h.animeId, h.title)} className="p-1.5 rounded hover:bg-red-600/20 text-white/15 hover:text-red-400 transition-all shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        ))}
      </div>
      {history.length > 5 && (
        <button onClick={() => setExpanded(!expanded)}
          className="mt-2 w-full py-2 rounded-lg bg-white/[0.03] text-white/30 text-xs font-medium hover:bg-white/[0.06] transition-colors flex items-center justify-center gap-1">
          {expanded ? <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><polyline points="18 15 12 9 6 15"/></svg> Show less</> :
            <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><polyline points="6 9 12 15 18 9"/></svg> See more ({history.length - 5})</>}
        </button>
      )}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/50">{children}</span>;
}

function Spinner() {
  return <svg className="spinner w-7 h-7 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" opacity="0.75" /></svg>;
}
