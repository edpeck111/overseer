// Cache class constants — codified per ADR-0008.
//
// Single source of truth for TTLs and polling cadences across the
// HttpTransport (WiFi) and OmpTransport (mesh). Mesh values selected
// once at boot from detectTransport().

export const CACHE_CLASS = Object.freeze({
  STATIC:    Object.freeze({ ttl: Infinity, ttlMesh: Infinity, poll:      0, pollMesh:        0 }),
  STABLE:    Object.freeze({ ttl:    60_000, ttlMesh: 3_600_000, poll:     0, pollMesh:        0 }),
  WARM:      Object.freeze({ ttl:    30_000, ttlMesh:   300_000, poll: 60_000, pollMesh:  600_000 }),
  HOT:       Object.freeze({ ttl:         0, ttlMesh:    30_000, poll:     0, pollMesh:   30_000 }),
  EXPENSIVE: Object.freeze({ ttl:         0, ttlMesh:         0, poll:     0, pollMesh:        0 }),
});

/** Resolve TTL for a class given the active transport ('wifi' | 'mesh'). */
export function ttlFor(cls, transportKind) {
  const c = CACHE_CLASS[cls] || CACHE_CLASS.WARM;
  return transportKind === "mesh" ? c.ttlMesh : c.ttl;
}

export function pollFor(cls, transportKind) {
  const c = CACHE_CLASS[cls] || CACHE_CLASS.WARM;
  return transportKind === "mesh" ? c.pollMesh : c.poll;
}
