// Service Worker for Baz Trade Assistant PWA
// Strategy: Network-first for everything — always get latest from server.
// Handles: caching, push notifications, notification tap.

const CACHE_NAME = 'baz-v2';

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

// ────────── Push Notifications ──────────

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'New Lead', {
      body: data.body || 'You have a new job lead',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: data.data || {},
      tag: data.data?.job_id || 'lead',  // collapse duplicate notifications for same job
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = '/static/trade-dashboard.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If dashboard is already open, focus it
      for (const client of windowClients) {
        if (client.url.includes('trade-dashboard') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(url);
    })
  );
});
