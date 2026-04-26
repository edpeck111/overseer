# ADR-0008: Cache class TTLs

**Status:** Accepted (Sprint 2)
**Deciders:** Ted (delegated); recorded by author of Sprint 2 transport work

## Context

`docs/03-MESH-ARCHITECTURE.md` §5 defines five cache classes — STATIC,
STABLE, WARM, HOT, EXPENSIVE — with rough TTL guidance per class on
WiFi vs. mesh. Sprint 2 (transport + OMP) needs concrete numbers
codified in the transport adapters so cache behaviour is consistent
across components and across the WiFi/mesh transports. Without
codified numbers the values would drift across modules as each lands
in its own sprint.

## Decision

The frontend transport layer ships with the following constants, in
ms, available as `CACHE_CLASS[name].ttl` (WiFi) and
`CACHE_CLASS[name].ttlMesh`:

| Class      | WiFi TTL    | Mesh TTL    | Polling (WiFi / mesh)        | Notes                                                            |
|------------|-------------|-------------|------------------------------|------------------------------------------------------------------|
| STATIC     | ∞           | ∞           | none                         | Ships in shell; never refetched. Drugs DB, fortune, triage trees. |
| STABLE     | 60 s        | 1 h         | on-focus / on-refresh        | Operator profile, contacts, waypoints, module manifests.          |
| WARM       | 30 s        | 5 min       | 60 s / 10 min                | Inbox headers, log entries, board listings.                       |
| HOT        | live (WS)   | 30 s        | (push) / 30 s polled         | Power samples, current chat, mesh node states.                    |
| EXPENSIVE  | per-query   | per-query   | none                         | LLM responses, library article fetches, photo analysis.           |

Concrete ms values used in code:

```js
export const CACHE_CLASS = {
  STATIC:    { ttl: Infinity, ttlMesh: Infinity, poll: 0,           pollMesh: 0       },
  STABLE:    { ttl:    60_000, ttlMesh: 3_600_000, poll: 0,           pollMesh: 0       },
  WARM:      { ttl:    30_000, ttlMesh:   300_000, poll:    60_000,   pollMesh: 600_000 },
  HOT:       { ttl:         0, ttlMesh:    30_000, poll:         0,   pollMesh:  30_000 },  // 0 = always WS
  EXPENSIVE: { ttl:         0, ttlMesh:         0, poll:         0,   pollMesh:       0 },  // never cached
};
```

**Stale-while-revalidate everywhere.** Cached responses are returned
immediately with an `as-of <age>` annotation (P9: cached data is
honest data). A background refetch fires if TTL is exceeded; the new
value swaps in when it arrives.

**Mesh adjustment on transport switch.** The transport adapter inspects
`detectTransport()` once at boot and selects `ttl` vs. `ttlMesh` per
class. There is no continuous re-tuning during a session — that would
add complexity for marginal gain, since switching transports mid-
session is rare and STALE-WHILE-REVALIDATE absorbs the rough edges.

## Why these numbers

**STATIC (∞):** content has no server-side authoritative state — it's
shipped in the static shell and changes only on shell version bump.
Re-fetch is wasted bytes.

**STABLE (60 s WiFi / 1 h mesh):** infrequently-mutating user data.
60 s on WiFi keeps the UI responsive to changes another operator made
(e.g. new contact accepted) without thrashing. On mesh, 1 h is a
deliberate trade — operators rarely add waypoints faster than that,
and a stale waypoint is preferable to bandwidth burn.

**WARM (30 s WiFi / 5 min mesh):** content where freshness matters
within a working session but isn't time-critical. Inbox headers can
genuinely be 30 s stale on WiFi (the WS push covers the live case).
On mesh, 5 min matches §13's "inbox poll every 5 min" budget.

**HOT (live WS / 30 s mesh):** real-time data — power telemetry,
in-flight chat tokens, mesh node RSSI updates. On WiFi it streams
over WebSocket; the cache TTL of 0 means cache miss on every read,
but reads are rare because the UI is reading from the WS-fed store,
not from `transport.request()`. On mesh, 30 s is the polling cadence
(no WS); this matches the §13 "status ping every 60 s" budget while
giving twice the resolution for the sensor-like data class.

**EXPENSIVE (per-query):** LLM responses are unique per query and
shouldn't be cached at the transport layer (chat history is the
right place to cache them, and that's a higher-level concern). Same
for library article fetches — Sprint 5 will introduce a separate
LRU at the module layer.

## Consequences

- **Predictable bandwidth.** §13's daily-operator budget (~25-50 KB
  on mesh) holds because polling intervals are bounded.
- **`as-of` stamps appear often on mesh, rarely on WiFi.** That's the
  honest UX (P9). Users learn that mesh sessions have a slight lag.
- **Tests must respect the constants.** `tools/sim-mesh.py` injects
  packet drops; the transport's SWR-with-as-of-stamp behaviour is
  testable with deterministic clocks (Sprint 2 codifies the constants;
  Sprint 4 will write the SWR-under-loss tests).
- **Tuning later is cheap.** All values live in one place
  (`shell/src/transport/cache_classes.js`). An ADR-0008 rev (or a
  superseding ADR) bumps the table and the constants follow.

## Revisit triggers

- Real telemetry shows daily mesh bandwidth >= 75% of §13 budget on a
  typical operator day → halve polling cadence on WARM/HOT.
- Multiple operators report stale waypoints causing field confusion
  → STABLE mesh TTL down from 1 h to 15 min.
- Power module telemetry users say 30 s mesh polling is too coarse →
  consider HOT mesh polling at 15 s with bandwidth cost noted.
