# OVERSEER v3 — status board

**Last updated:** end of Sprints 14 + 15, Cowork session.

---

## TL;DR

  - Branch `v3-redesign` is **~60+ commits past `origin/main`**, all local.
  - Sprints **0–15 done**; Sprint 16 (Dragon's Tale) is the next gate.
  - Push when convenient: `git push -u origin v3-redesign`
  - All gates passing: **258 Python tests + 117 jsdom smoke**, no failures.
  - Bundle ~243 KB unminified (~45 KB gzipped estimate).

---

## How to push

From `C:\Source\Overseer\`:

```
git push -u origin v3-redesign
```

---

## Per-sprint completion

| Sprint | Title                                  | Status   | Gate |
|--------|----------------------------------------|----------|------|
| 0      | Repo migration + dev environment       | done     | ✓ |
| 1      | Chrome + HOME                          | done     | ✓ |
| 2      | Transport layer + OMP foundation       | done     | ✓ |
| 3      | POWER (canary)                         | done     | ✓ |
| 4      | Static-shell discipline                | done     | ✓ |
| 5      | KNOWLEDGE refresh                      | done     | ✓ |
| 6      | COMMS refresh + boards                 | done     | ✓ |
| 7      | MEDICAL wizard reflow                  | done     | ✓ |
| 8      | NAVIGATION refresh + sextant text-map  | done     | ✓ |
| 9      | LOG                                    | done     | ✓ |
| 10     | INVENTORY                              | done     | ✓ |
| 11     | TIMELINE                               | done     | ✓ |
| 12     | AUSPICE part A (astronomy)             | done     | ✓ |
| 13     | AUSPICE part B (divination + journal)  | done     | ✓ |
| 14     | SIGNAL                                 | done     | ✓ |
| 15     | RECREATION foundation                  | done     | ✓ |
| 16     | RECREATION: Dragon's Tale              | pending  | — |
| 17     | SYSTEM polish + HELP                   | pending  | — |
| 18+    | Polish, optional modules, hardware     | pending  | — |

---

## Gate evidence at end of Sprint 15

```
$ pytest tests/unit/         -> 258 passed (0 failed)
$ node tools/smoke-shell.mjs -> 117 PASS, 0 FAIL

Bundle: shell/public/dist/main.{js,css}
  main.js  ~243 KB unminified
  main.css  ~67 KB unminified
```

Test breakdown:
  - 178 carried (Sprints 0-13 baseline)
  - +40 new  (test_signal.py Sprint 14: passes/decode/air/aprs/scan/bands/captures/routes)
  - +40 new  (test_recreation.py Sprint 15: fortune/wiki/reader/chess/zork/games/routes)

Smoke breakdown:
  - 95 carried (Sprints 1-13 baseline)
  - +10 new   (SIGNAL: passes/air/aprs/bands + tab switching)
  - +12 new   (RECREATION: fortune/wiki/games + tab switching)

Also fixed in this session:
  - esbuild IIFE `--global-name` flag dropped: `var __overseer = (()=>{})()` was
    overwriting `window.__overseer` with undefined. Plain `--format=iife` lets
    the internal `window.__overseer = ctx` assignment stick correctly.
  - signal.js integer fields wrapped in String() before passing to el()
  - Tab click listeners added to signal.js + recreation.js (pattern from auspice.js)

---

## Sprint 14 deliverables (SIGNAL)

`server/modules/signal_.py` (266 lines):
  - Env flags: OVERSEER_SIGNAL_SDR, _LORA, _ADSB, _APRS (all synthetic default)
  - Synthetic seed: 4 sat passes (NOAA-15/18/19 + ISS), 3 ADS-B tracks,
    3 APRS packets, 5 spectrum bands (2m/70cm/HF/VHF/UHF), 64-bucket noise floor
  - weather_passes() / weather_decode() / air_tracks() / aprs_feed()
  - spectrum_scan() / captures_list() / bands_list() / mesh_nodes()
  - mesh_nodes() delegates to comms.nodes_list() (shared store)
  - 8 REST routes under /api/s/*

`shell/src/modules/signal.{js,css}`:
  - W(weather): sat pass table (SAT/FREQ/AOS/LOS/EL/DIR) + DECODE trigger
  - A(air): ADS-B track table with squawk 7700 emergency highlight
  - P(aprs): packet feed sorted newest-first with age display
  - M(mesh): LoRa mesh node list (delegates to /api/s/mesh)
  - S(scan): ASCII waterfall bar chart (64 buckets, band selector)
  - B(bands): band reference table (freq_lo/freq_hi/unit)

Amber sub-theme (.screen-signal):
  - --accent: #ffb347, --accent-dim: #c07820, --accent-glow

---

## Sprint 15 deliverables (RECREATION)

`server/modules/recreation.py` (340 lines):
  - 30 prepper/stoic fortune quotes built-in
  - Zork-lite: 6 rooms (bunker_entrance/command_room/dormitory/store_room/
    supply_shaft/comms_hub), full command parser (look/go/take/examine/i/quit/help)
  - Chess: ASCII FEN board renderer, move recording (no engine — synthetic)
  - Wiki roulette: 8 stub survival/comms articles
  - Reader progress: 0.0-1.0 position + bookmark, sorted by updated
  - Game registry: chess/zork/wiki/fortune/reader (available) +
    dragon/trader (coming Sprint 16)
  - 9 REST routes under /api/r/*

`shell/src/modules/recreation.{js,css}`:
  - F(fortune): draw button -> blockquote with prepper quote
  - W(wiki): spin button -> article title + summary + source
  - G(games): game registry grid with available/coming-soon states
  - C(chess): ASCII board, move input, PGN list, new game
  - Z(zork): scrolling adventure terminal, room/inv tracking
  - R(reader): progress bars per article with bookmark display

Green sub-theme (.screen-recreation):
  - --accent: #6dcc6d, --accent-dim: #3a8a3a, --accent-glow

---

## ADRs 0001–0013 in place

All in `docs/architecture-decisions/`. See Sprint 8 STATUS for full table.

---

## Things parked

- Brotli dict ctypes shim (ADR-0010)
- JS-side Brotli v0x02 (wait on browser support)
- Real model swaps — env flags ready (OVERSEER_SIGNAL_SDR=rtlsdr etc.)
- COMMS forward secrecy — python-doubleratchet (ADR-0012)
- Cardputer firmware
- `.git/` cruft + `.trash_local/` cleanup

---

## Ready for Sprint 16 (Dragon's Tale)

Placeholder entry already in game registry (id: "dragon", hotkey: D).
Full text adventure with branching narrative, inventory, combat — see
`docs/02-MODULE-CATALOG.md` RECREATION section for full spec.
