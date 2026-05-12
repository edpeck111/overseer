# ADR-0002: Hand-rolled reactive state store (~100 LOC)

**Status:** Accepted (Sprint 0)

## Context

UI needs a small reactive store for the status strip, breadcrumb, and
module state. nanostores / valtio / zustand all add a dependency.

## Decision

Hand-roll a tiny store at `shell/src/state/store.js` (~100 LOC). Get,
set, subscribe, and a `dispatch(action)` helper for the optimistic-UI
pattern in P8.

## Consequences

- Zero JS deps for state — keeps the bundle small.
- We own the API; we know its semantics under offline / mesh latency.
- Loss of ecosystem (devtools, middleware) — acceptable for v3.
