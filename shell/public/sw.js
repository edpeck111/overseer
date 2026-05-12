// OVERSEER v3 service worker.
//
// Sprint 4 implementation per ADR-0008 cache classes + Ted's bypass
// directives. Strategies:
//
//   STATIC      cacheFirst         shell bundle, manifest, icons, fonts
//   STABLE      staleWhileRevalidate, TTL 60s WiFi / 1h mesh
//   WARM        staleWhileRevalidate, TTL 30s WiFi / 5min mesh
//   HOT         networkOnly        live data; WS push is the cache
//   EXPENSIVE   networkOnly        LLM, library article fetch
//   networkOnly (forced) for:
//     - any non-GET method (POST/PUT/PATCH/DELETE)
//     - any path matching /(auth|login|token|secret|admin)/
//     - any response setting a Set-Cookie header
//
// On unknown paths we default to networkOnly — safer to be slow than
// to serve stale auth or write-side responses.

const CACHE_VERSION = "overseer-v3-sprint4";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE    = `${CACHE_VERSION}-api`;

// Pre-cached on install. Hashed bundle paths (Sprint 4+ esbuild) would
// land here too; for now the bundle is at the unhashed dist/main.{js,css}.
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/dist/main.js",
  "/dist/main.css",
];

// Path-prefix → cache class. Modules add their entries as they ship.
// Anything not matched gets the safe default ('networkOnly').
const CACHE_CLASS_BY_PREFIX = [
  // POWER (Sprint 3/4)
  ["/api/p/now",     "HOT"],
  ["/api/p/history", "WARM"],
  ["/api/p/radio",   "STABLE"],
  ["/api/p/storage", "STABLE"],
  // COMMS (Sprint 6) — placeholder entries for the surfaces already known
  ["/api/c/inbox",   "WARM"],
  ["/api/c/sent",    "STABLE"],
  ["/api/c/net",     "WARM"],
  // SYSTEM/admin handled via the bypass regex; no entry here.
];

const TTL_MS = {
  STATIC:    Infinity,
  STABLE:    60_000,
  WARM:      30_000,
  HOT:       0,
  EXPENSIVE: 0,
};

// Bypass rules — networkOnly for these paths regardless of cache class.
const BYPASS_REGEX = /\/(auth|login|token|secret|admin)\b/i;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// --------------------------------------------------------------------- //
// Lifecycle
// --------------------------------------------------------------------- //

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(PRECACHE_URLS).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Drop old versioned caches.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// --------------------------------------------------------------------- //
// Fetch routing
// --------------------------------------------------------------------- //

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Same-origin only — third-party assets (fonts CDN) bypass the SW.
  if (url.origin !== self.location.origin) return;

  // Forced bypass: mutating methods + auth/admin/secret paths.
  if (MUTATING_METHODS.has(req.method)) return;
  if (BYPASS_REGEX.test(url.pathname))  return;

  if (url.pathname === "/" || url.pathname === "/index.html") {
    event.respondWith(_staticFirst(req));
    return;
  }
  if (url.pathname.startsWith("/dist/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname === "/manifest.json") {
    event.respondWith(_staticFirst(req));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    const cls = _classOf(url.pathname);
    if (cls === "HOT" || cls === "EXPENSIVE" || cls === null) {
      // Default unknown to networkOnly (safer than stale).
      return;   // letting the SW fall through == networkOnly
    }
    event.respondWith(_swr(req, cls));
    return;
  }

  // Any other path: leave the network alone.
});

// --------------------------------------------------------------------- //
// Strategies
// --------------------------------------------------------------------- //

async function _staticFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function _swr(req, cls) {
  const cache = await caches.open(API_CACHE);
  const hit = await cache.match(req);
  const ttl = TTL_MS[cls] ?? 0;

  // Background revalidate
  const fresh = fetch(req).then((res) => {
    // Don't cache responses with Set-Cookie — those are session-bound.
    if (res.ok && !res.headers.get("Set-Cookie")) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  }).catch((e) => {
    if (hit) return hit;
    throw e;
  });

  if (!hit) return fresh;
  // If hit is fresh enough, return immediately and let revalidate happen
  // in background. We ignore SW timing precision — Date.now() at hit
  // creation time isn't preserved; we use the Date header when present.
  const dateHeader = hit.headers.get("Date");
  const age = dateHeader ? (Date.now() - new Date(dateHeader).getTime()) : Infinity;
  if (age < ttl) return hit;
  // Stale: return the cached response now, kick off revalidate.
  fresh.catch(() => {});  // promote to bg even if caller doesn't await
  return hit;
}

function _classOf(pathname) {
  for (const [prefix, cls] of CACHE_CLASS_BY_PREFIX) {
    if (pathname.startsWith(prefix)) return cls;
  }
  return null;
}
