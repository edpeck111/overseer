// O.V.E.R.S.E.E.R. Service Worker
// Caches static assets for offline access; API calls always go to network

const CACHE_NAME = 'overseer-v1';
const STATIC_ASSETS = [
  '/',
  '/static/css/core.css',
  '/static/css/knowledge.css',
  '/static/css/comms.css',
  '/static/css/system.css',
  '/static/js/core.js',
  '/static/js/knowledge.js',
  '/static/js/comms.js',
  '/static/js/system.js',
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png'
];

// Pre-cache static assets on install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Clean old caches on activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy: network-first for API/dynamic, cache-first for static
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API calls, POST requests, sound files: always network
  if (event.request.method !== 'GET' ||
      url.pathname.startsWith('/query') ||
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/admin/') ||
      url.pathname.startsWith('/comms/') ||
      url.pathname.startsWith('/library/') ||
      url.pathname.startsWith('/status') ||
      url.pathname.startsWith('/boot') ||
      url.pathname.startsWith('/sounds/')) {
    return;
  }

  // Static assets: cache-first, fallback to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
