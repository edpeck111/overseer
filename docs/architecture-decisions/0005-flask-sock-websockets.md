# ADR-0005: WebSocket multiplexer via flask-sock

**Status:** Accepted (Sprint 0)

## Context

The backend needs a WebSocket layer (Sprint 2 transport, Sprint 3
POWER live samples, Sprint 6 COMMS deliveries). Options: flask-sock
(matches our Flask app), pure `websockets` (async refactor), Sanic /
Quart (full async stack).

## Decision

**flask-sock**. Stays in the Flask request lifecycle, no async refactor.

## Consequences

- One ws hub at `server/ws.py`, registered as a Flask blueprint.
- Concurrency is process+thread, not async — fine for OPi5 scale.
- If we later need true async at scale, this is the seam to swap.
