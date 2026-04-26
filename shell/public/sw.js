// Service worker. Sprint 4 (static-shell discipline) wires up cache
// strategies per cache class (STATIC/STABLE/WARM/HOT/EXPENSIVE).
// For Sprint 0 this is a no-op so registration succeeds.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Sprint 4: route per cache class. For now, fall through to network.
});
