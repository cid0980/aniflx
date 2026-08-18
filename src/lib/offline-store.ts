/**
 * Offline episode storage — uses IndexedDB to store downloaded video blobs.
 * Supports background download tracking, ordered episode lists, delete, and offline playback.
 */

const DB_NAME = 'cid_anime_offline';
const DB_VERSION = 1;
const STORE_NAME = 'episodes';

export interface OfflineEpisode {
  key: string;            // `${animeId}_${epNum}`
  animeId: number;
  animeTitle: string;
  animeImage: string;
  episodeNum: number;
  blob: Blob;
  size: number;           // bytes
  downloadedAt: number;   // Date.now()
}

export interface DownloadProgress {
  key: string;
  animeId: number;
  episodeNum: number;
  progress: number;       // 0-100
  downloaded: number;     // bytes received so far
  speed: number;          // bytes per second
  eta: number;            // seconds remaining estimate
  status: 'preparing' | 'downloading' | 'saving' | 'done' | 'error';
  error?: string;
}

// ── IndexedDB helpers ──

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('animeId', 'animeId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveEpisode(ep: OfflineEpisode): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(ep);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getEpisode(animeId: number, epNum: number): Promise<OfflineEpisode | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(`${animeId}_${epNum}`);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteEpisode(animeId: number, epNum: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(`${animeId}_${epNum}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteAnimeEpisodes(animeId: number): Promise<void> {
  const all = await getAnimeEpisodes(animeId);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const ep of all) store.delete(ep.key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAnimeEpisodes(animeId: number): Promise<Omit<OfflineEpisode, 'blob'>[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const idx = tx.objectStore(STORE_NAME).index('animeId');
    const req = idx.getAll(animeId);
    req.onsuccess = () => {
      const results = (req.result || []).map((r: OfflineEpisode) => ({
        key: r.key, animeId: r.animeId, animeTitle: r.animeTitle,
        animeImage: r.animeImage, episodeNum: r.episodeNum,
        size: r.size, downloadedAt: r.downloadedAt,
      }));
      results.sort((a: { episodeNum: number }, b: { episodeNum: number }) => a.episodeNum - b.episodeNum);
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllOffline(): Promise<Omit<OfflineEpisode, 'blob'>[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const results = (req.result || []).map((r: OfflineEpisode) => ({
        key: r.key, animeId: r.animeId, animeTitle: r.animeTitle,
        animeImage: r.animeImage, episodeNum: r.episodeNum,
        size: r.size, downloadedAt: r.downloadedAt,
      }));
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

export function isEpisodeDownloaded(animeId: number, epNum: number): Promise<boolean> {
  return getEpisode(animeId, epNum).then(e => !!e);
}

/**
 * Check if any background downloads completed while the tab was closed.
 * Call this on app startup to refresh the offline episode list.
 */
export async function recoverBackgroundDownloads(): Promise<number> {
  try {
    const all = await getAllOffline();
    return all.length;
  } catch {
    return 0;
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── Download manager (runs in main thread, background-friendly) ──

type ProgressCallback = (p: DownloadProgress) => void;
const activeDownloads = new Map<string, AbortController>();

export function isDownloading(animeId: number, epNum: number): boolean {
  return activeDownloads.has(`${animeId}_${epNum}`);
}

export function cancelDownload(animeId: number, epNum: number): void {
  const key = `${animeId}_${epNum}`;
  activeDownloads.get(key)?.abort();
  activeDownloads.delete(key);
}

export async function downloadEpisode(
  animeId: number,
  animeTitle: string,
  animeImage: string,
  episodeNum: number,
  downloadUrl: string,
  onProgress: ProgressCallback
): Promise<void> {
  const key = `${animeId}_${episodeNum}`;

  const emit = (p: Partial<DownloadProgress>) => {
    onProgress({ key, animeId, episodeNum, progress: 0, downloaded: 0, speed: 0, eta: 0, status: 'preparing', ...p });
  };

  // Try service worker background download first
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    try {
      emit({ status: 'preparing', progress: 0 });
      activeDownloads.set(key, new AbortController()); // Track as active

      // Listen for SW messages
      const handler = (event: MessageEvent) => {
        const msg = event.data;
        if (!msg || msg.key !== key) return;
        if (msg.type === 'DOWNLOAD_PROGRESS') {
          const elapsed = 1; // SW doesn't track start time easily
          emit({ status: 'downloading', progress: Math.min(95, Math.round(msg.received / (100 * 1024 * 1024) * 100)), downloaded: msg.received, speed: 0, eta: 0 });
        } else if (msg.type === 'DOWNLOAD_DONE') {
          emit({ status: 'done', progress: 100, downloaded: msg.size });
          navigator.serviceWorker.removeEventListener('message', handler);
          activeDownloads.delete(key);
        } else if (msg.type === 'DOWNLOAD_ERROR') {
          emit({ status: 'error', error: msg.error || 'Background download failed' });
          navigator.serviceWorker.removeEventListener('message', handler);
          activeDownloads.delete(key);
        }
      };
      navigator.serviceWorker.addEventListener('message', handler);

      navigator.serviceWorker.controller.postMessage({
        type: 'START_DOWNLOAD',
        data: { key, url: downloadUrl, animeId, episodeNum, animeTitle, animeImage },
      });
      return;
    } catch { /* SW failed, fall through to main thread */ }
  }

  // Fallback: main thread download
  const abortController = new AbortController();
  activeDownloads.set(key, abortController);

  try {
    emit({ status: 'preparing', progress: 0 });

    // Get segment count
    let totalSegments = 0;
    try {
      const infoRes = await fetch(downloadUrl + '&info=1', { signal: abortController.signal });
      const info = await infoRes.json();
      totalSegments = info.segments || 0;
    } catch { /* proceed without */ }

    emit({ status: 'downloading', progress: 0 });
    const res = await fetch(downloadUrl, { signal: abortController.signal });
    if (!res.ok || !res.body) throw new Error(`Server returned ${res.status}`);

    const serverSegments = Number(res.headers.get('x-total-segments') || 0);
    if (serverSegments > 0) totalSegments = serverSegments;

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    const startTime = Date.now();
    let lastEmit = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;

      const now = Date.now();
      if (now - lastEmit > 300) {
        lastEmit = now;
        const elapsed = (now - startTime) / 1000;
        const speed = elapsed > 0 ? received / elapsed : 0;
        const estimatedTotal = totalSegments > 0 ? totalSegments * 1.1 * 1024 * 1024 : 100 * 1024 * 1024;
        const pct = Math.min(95, Math.round((received / estimatedTotal) * 100));
        const eta = speed > 0 ? Math.max(0, Math.round((estimatedTotal - received) / speed)) : 0;
        emit({ status: 'downloading', progress: pct, downloaded: received, speed, eta });
      }
    }

    emit({ status: 'saving', progress: 97, downloaded: received, speed: 0, eta: 0 });
    const blob = new Blob(chunks as BlobPart[], { type: 'video/mp2t' });

    await saveEpisode({ key, animeId, animeTitle, animeImage, episodeNum, blob, size: blob.size, downloadedAt: Date.now() });

    emit({ status: 'done', progress: 100, downloaded: blob.size, speed: 0, eta: 0 });
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? 'Download cancelled'
      : (e as Error).message?.includes('Failed to fetch') ? 'Network error — check your connection'
      : (e as Error).message?.includes('status') ? `Server error: ${(e as Error).message}`
      : `Download failed: ${(e as Error).message}`;
    emit({ status: 'error', progress: 0, error: msg });
  } finally {
    activeDownloads.delete(key);
  }
}
