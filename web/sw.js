// Service Worker for Baz Trade Assistant PWA
// Strategy: Network-first for everything — always get latest from server.
// The SW exists primarily to satisfy iOS PWA install requirements
// and provide a basic offline fallback.

const CACHE_NAME = 'baz-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET and SSE/streaming requests
  if (request.method !== 'GET' || request.headers.get('accept') === 'text/event-stream') {
    return;
  }

  // Network-first: always try server, fall back to cache
  event.respondWith(
    fetch(request)
      .then(response => {
        // Cache successful responses for offline fallback
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
