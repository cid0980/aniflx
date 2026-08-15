/**
 * Browser localStorage-based watch history for Cid
 * Tracks: what anime watched, which episode, timestamp within episode, when last watched
 */

export interface WatchEntry {
  animeId: number;
  title: string;
  image: string;
  episodeNum: number;
  totalEpisodes: number | null;
  timestamp: number; // seconds into the episode
  lastWatched: number; // Date.now()
  anidbId?: string;
}

const STORAGE_KEY = 'aniflix_cid_history';

function getAll(): WatchEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveAll(entries: WatchEntry[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function getHistory(): WatchEntry[] {
  return getAll().sort((a, b) => b.lastWatched - a.lastWatched);
}

export function getLastWatched(): WatchEntry | null {
  const all = getHistory();
  return all.length > 0 ? all[0] : null;
}

export function upsertWatch(entry: WatchEntry) {
  const all = getAll();
  const idx = all.findIndex(e => e.animeId === entry.animeId);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...entry };
  } else {
    all.push(entry);
  }
  saveAll(all);
}

export function updateTimestamp(animeId: number, episodeNum: number, timestamp: number) {
  const all = getAll();
  const idx = all.findIndex(e => e.animeId === animeId);
  if (idx >= 0) {
    all[idx].timestamp = timestamp;
    all[idx].episodeNum = episodeNum;
    all[idx].lastWatched = Date.now();
    saveAll(all);
  }
}

export function removeWatch(animeId: number) {
  const all = getAll().filter(e => e.animeId !== animeId);
  saveAll(all);
}

export function clearHistory() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
