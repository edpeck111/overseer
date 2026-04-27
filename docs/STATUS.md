# OVERSEER v3 — status board

**Last updated:** end of Sprint 8, autonomous run, paused for Ted.

---

## TL;DR

  - Branch `v3-redesign` is **50 commits past `origin/main`**, all local.
  - Sprints **0–8 done**; Sprint 9 (LOG) is the next gate.
  - Nothing pushed during the autonomous runs (two sessions stacked
    without push) — Ted pushes from Windows when convenient.
  - All gates passing: **80 Python tests + 46 jsdom smoke + 11 sextant
    parity + 3 sim-mesh integration**, no failures.
  - Bundle 30 KB gzipped (budget 2 MB).

---

## How to push when you're back at Windows

From `C:\Source\Overseer\`:

```
git push -u origin v3-redesign
```

That's it. Branch tracks `origin/v3-redesign` after the first push;
subsequent pushes are plain `git push`. No PRs were opened — keep the
branch as a long-running rebase target per the design plan.

---

## Per-sprint completion

| Sprint | Title                                  | Status   | Commits | Gate |
|--------|----------------------------------------|----------|---------|------|
| 0      | Repo migration + dev environment       | done     | 6       | ✓ |
| 1      | Chrome + HOME                          | done     | 8       | ✓ |
| 2      | Transport layer + OMP foundation       | done     | 9       | ✓ |
| 3      | POWER (canary)                         | done     | 4       | ✓ |
| 4      | Static-shell discipline                | done     | 10      | ✓ |
| 5      | KNOWLEDGE refresh                      | done     | 3       | ✓ |
| 6      | COMMS refresh + boards                 | done     | 4       | ✓ |
| 7      | MEDICAL wizard reflow                  | done     | 2       | ✓ |
| 8      | NAVIGATION refresh + sextant text-map  | done     | 2       | ✓ |
| 9      | LOG                                    | pending  |         | — |
| 10     | INVENTORY                              | pending  |         | — |
| 11     | TIMELINE                               | pending  |         | — |
| 12     | AUSPICE part A (astronomy)             | pending  |         | — |
| 13     | AUSPICE part B (divination + journal)  | pending  |         | — |
| 14     | SIGNAL                                 | pending  |         | — |
| 15     | RECREATION foundation                  | pending  |         | — |
| 16     | RECREATION: Dragon's Tale              | pending  |         | — |
| 17     | SYSTEM polish + HELP                   | pending  |         | — |
| 18+    | Polish, optional modules, hardware     | pending  |         | — |

(8a, the dedicated TEXT MAP sprint, was folded into Sprint 8 because
the sextant primitive shipped clean enough in Sprint 4 that NAVIGATION
just imports it. The `sextant text-map` deliverable is met by
`shell/src/modules/navigation.js`'s map sub-screen.)

---

## Gate evidence at end of Sprint 8

```
$ pytest                                  → 80 passed (unit + integration)
$ npm run smoke (jsdom)                   → 46 PASS, 0 FAIL
$ node tests/fixtures/sextant_js_parity   → 11 pass, 0 fail
$ python tools/sample-remote-op.py        → 5/5 OMP roundtrips through sim-mesh

Bundle: shell/public/dist/main.{js,css}
  main.js  gz: ~30 KB
  main.css gz: ~5 KB
  combined gz: ~35 KB     (budget: 2 MB)
```

---

## Architecture decisions (ADRs 0001–0013)

All in `docs/architecture-decisions/`. Each is reversible via a
follow-on ADR if you disagree.

| #    | Title                                              | Sprint | One-liner |
|------|----------------------------------------------------|--------|-----------|
| 0001 | esbuild over Vite                                  | 0      | Bundle is small + simple. |
| 0002 | Hand-rolled ~100 LOC state store                   | 0      | Zero JS deps. |
| 0003 | Vanilla JS + JSDoc, no TypeScript                  | 0      | No transpile. |
| 0004 | Plain CSS + custom properties                      | 0      | One file per component. |
| 0005 | flask-sock for WebSocket                           | 0      | Stays in Flask request lifecycle. |
| 0006 | MessagePack via msgpack/msgpackr                   | 0      | OMP body codec choice. |
| 0007 | Brotli with shared dictionary                      | 0      | Wire compression target. |
| 0008 | Cache-class TTLs (STATIC/STABLE/WARM/HOT/EXPENSIVE) | 2     | Concrete ms values. |
| 0009 | Sextant rasterizer is a system-wide primitive      | 2 plan | NAV/AUSPICE/SIGNAL all import it. |
| 0010 | Brotli backend: brotlicffi server, deferred client | 4      | JS stays v0x01 in WiFi shell. |
| 0011 | KNOWLEDGE backend: sqlite-vec + synthetic-first    | 5      | Real Ollama / nomic / whisper / piper swap via env flag. |
| 0012 | COMMS crypto: real AEAD, synthetic ratchet         | 6      | python-doubleratchet swap target; wire format final. |
| 0013 | NAVIGATION backend: synthetic-first across the board | 8    | Routing/elevation/tiles/terrain — all env-flag swaps. |

---

## Things parked for your call

Nothing genuinely blocking, just things that benefit from your
judgment when you're back:

- **Brotli dictionary on the wire (Python side).** ADR-0010. The dict
  artifact is built; runtime use waits on a small ctypes shim against
  `libbrotlienc.so` (or upstream `brotlicffi` binding). ~60-80 LOC
  when you want it.
- **JS-side Brotli (v0x02 in the browser).** ADR-0010. Migration
  trigger is native CompressionStream Level-2 + dict support across
  Firefox + Safari. Currently only Chrome 124+ has it; revisit on
  caniuse refresh.
- **Real model swap-in** — KNOWLEDGE (Ollama qwen2.5:7b, nomic
  embedder), MEDICAL (Qwen2-VL for photo triage), NAVIGATION (real
  routing engine + SRTM elevation). All gated by env flags — flip
  when the OPi5 has weights + data on disk.
- **COMMS forward secrecy** — `python-doubleratchet` swap. ADR-0012.
  Wire format already final; the JS counterpart needs to land at the
  same time.
- **Cardputer firmware.** `deploy/cardputer/` ships scaffolding; ESP-
  IDF firmware is your domain.
- **`.git/` cruft from the hostile-mount workaround.** Lock files +
  tmp objects accumulated from the rename-instead-of-delete pattern.
  Safe to clean from Windows when convenient.
- **`.trash_local/`** — graveyard from filesystem workarounds. Already
  gitignored; eyeball before deleting in case anything looks
  salvageable; shouldn't.

---

## Working memory updates worth knowing

The autonomous run didn't update `.auto-memory/MEMORY.md` (read-only
mount). Substantive learnings to fold in:

- v3-redesign now 50 commits past origin/main. Sprints 0–8 done.
- All synthetic backends use the `OVERSEER_<MODULE>_<KIND>=synthetic|...`
  env-flag pattern. Real swap is a single env-var flip per backend.
- Sextant rasterizer is production-tested in NAVIGATION's text-map
  (Sprint 8) — JS port matches the Python prototype byte-for-byte.
- Crypto: real ed25519/x25519/AESGCM via pyca/cryptography is in
  place; synthetic ratchet has the swap interface for `python-
  doubleratchet`. ADR-0012.
- Triage trees ported from v2 medical.js to `shell/src/data/triage.json`
  via `node eval` of the source object literal — lossless. 10 trees.

---

## Ready for Sprint 9 when Ted resumes

Sprint 9 (LOG) per `docs/04-IMPLEMENTATION-PLAN.md`:

  - Today sub-screen with quick-entry input
  - Entry kinds + auto-typed tags
  - Photos + OCR
  - GPS + weather auto-attach
  - Daily LLM summary (scheduled job at 22:00)
  - Browse / search past entries
  - Export markdown
  - Hooks from other modules into log auto-events

Gate: type 5 entries, see them tagged correctly; complete a triage
and see auto-log entry appear; receive a comms message and see
auto-entry; daily summary generated and editable.

The pattern is by now familiar — synthetic OCR + synthetic weather
behind env flags; LLM summary uses the existing KNOWLEDGE Ollama
wrapper; auto-event hooks subscribe to MEDICAL run-end and COMMS
inbox-arrived events via the WS pub/sub from Sprint 4.
