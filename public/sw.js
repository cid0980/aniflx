const SW_VERSION = 'cid-anime-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Track background downloads
const bgDownloads = new Map(); // key -> { url, animeId, episodeNum, animeTitle, animeImage }

self.addEventListener('message', async (event) => {
  const { type, data } = event.data || {};

  if (type === 'START_DOWNLOAD') {
    const { key, url, animeId, episodeNum, animeTitle, animeImage } = data;
    bgDownloads.set(key, { url, animeId, episodeNum, animeTitle, animeImage, status: 'downloading' });

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;

        // Notify all clients of progress
        const clients = await self.clients.matchAll();
        for (const client of clients) {
          client.postMessage({
            type: 'DOWNLOAD_PROGRESS',
            key, animeId, episodeNum, received,
            status: 'downloading',
          });
        }
      }

      // Combine into blob
      const blob = new Blob(chunks, { type: 'video/mp2t' });

      // Store in IndexedDB from service worker
      await saveToIDB(key, { key, animeId, animeTitle, animeImage, episodeNum, blob, size: blob.size, downloadedAt: Date.now() });

      bgDownloads.set(key, { ...bgDownloads.get(key), status: 'done' });

      const clients = await self.clients.matchAll();
      for (const client of clients) {
        client.postMessage({ type: 'DOWNLOAD_DONE', key, animeId, episodeNum, size: blob.size });
      }
    } catch (e) {
      bgDownloads.set(key, { ...bgDownloads.get(key), status: 'error' });
      const clients = await self.clients.matchAll();
      for (const client of clients) {
        client.postMessage({ type: 'DOWNLOAD_ERROR', key, animeId, episodeNum, error: e.message });
      }
    }
  }

  if (type === 'CANCEL_DOWNLOAD') {
    // Can't easily cancel a fetch in SW — just remove from tracking
    bgDownloads.delete(data.key);
  }
});

// IndexedDB helper for service worker context
function saveToIDB(key, episode) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cid_anime_offline', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('episodes')) {
        const store = db.createObjectStore('episodes', { keyPath: 'key' });
        store.createIndex('animeId', 'animeId', { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('episodes', 'readwrite');
      tx.objectStore('episodes').put(episode);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

// Don't intercept API or streaming requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.hostname !== self.location.hostname) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
