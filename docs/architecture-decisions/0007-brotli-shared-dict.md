# ADR-0007: Brotli envelope with shared dictionary

**Status:** Accepted (Sprint 0)

## Context

LoRa SF7 has tight bandwidth. Brotli with a shared dictionary tuned to
Overseer outputs gives the best size for our payloads.

## Decision

- Backend: Python `brotli` package, dictionary loaded from
  `server/omp/dictionary.bin` (built by `tools/build-dictionary.py`).
- Frontend: native `CompressionStream` where the browser supports
  Brotli (Chrome 119+, Firefox 113+, Safari 17.4+); `brotli-wasm`
  fallback for older clients.

## Consequences

- Dictionary is part of the release artefact; rebuilt before each tag.
- `tools/build-dictionary.py` runs in CI so the binary stays in sync
  with response shape changes.
- Older browsers pay a 200 KB wasm cost; newer ones pay nothing.
