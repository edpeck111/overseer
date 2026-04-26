// Service worker placeholder. Sprint 4 (Static-shell discipline) implements:
//   - Pre-cache shell on install
//   - cacheFirst for /static/*
//   - staleWhileRevalidate for /api/* STABLE/WARM
//   - networkOnly for HOT and EXPENSIVE
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
