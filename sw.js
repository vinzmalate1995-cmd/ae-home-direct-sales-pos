/* ============================================================
   AE HOME POS — sw.js (Service Worker)
   ============================================================ */

const CACHE_NAME = 'ae-pos-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap',
];

// Install: cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip Google Apps Script requests (always network)
  if (url.hostname.includes('script.google.com')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(res => {
        if (res.ok && event.request.method === 'GET') {
          const cloned = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        }
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
