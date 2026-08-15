const SW_VERSION = 'cid-anime-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never interfere with API/video streaming routes.
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname !== self.location.hostname
  ) {
    return;
  }

  // Network-first for app shell pages/assets.
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open(SW_VERSION);
      const cached = await cache.match(event.request);
      return (
        cached ||
        new Response('Offline', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        })
      );
    })
  );
});
