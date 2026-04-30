# OVERSEER v3 — status board

**Last updated:** end of Sprint 20, Cowork session.

---

## TL;DR

  - Branch `v3-redesign` is **all local**.
  - Sprints **0–20 done**; Sprint 21+ (real hardware, Cardputer, push) is next.
  - Push when convenient: `git push -u origin v3-redesign`
  - All gates passing: **354 Python tests + 121 jsdom smoke**, no failures.
  - Bundle ~139 KB minified JS + ~52 KB minified CSS.

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
| 16     | RECREATION: Dragon's Tale              | done     | ✓ |
| 17     | SYSTEM + HELP                          | done     | ✓ |
| 18     | SQLite persistence foundation          | done     | ✓ |
| 19     | TRADER (TradeWars-lite barter game)    | done     | ✓ |
| 20     | Polish: COMMS SQLite + hardware layer  | done     | ✓ |
| 21+    | Real hardware, Cardputer, push         | pending  | — |

---

## Gate evidence at end of Sprint 20

```
$ pytest tests/unit/         -> 354 passed (0 failed)
$ node tools/smoke-shell.mjs -> 121 PASS, 0 FAIL

Bundle: shell/public/dist/main.{js,css}
  main.js  139 KB minified
  main.css  52 KB minified
```

Test breakdown (354 total):
  - 333 carried (Sprints 0-19 baseline)
  - +12  (test_comms.py: 3 new persistence tests; 9 existing passing)
  - +18  (test_hw.py Sprint 20: defaults/env-overrides/hw_info)

Smoke unchanged at 121 (no new shell sub-screens this sprint).

---

## Sprint 20 deliverables (Polish: COMMS SQLite + hardware layer)

`server/migrations/015_comms.sql`:
  - `comms_operator` — callsign registry
  - `comms_message` — message rows with serialised envelope JSON
  - `comms_board_post` — board posts with body + metadata

`server/modules/comms.py` (hybrid SQLite migration):
  - `register_operator()` writes to `comms_operator`
  - `send_message()` writes envelope via `to_wire()` to `comms_message`
  - `mark_read()` updates `state` column in `comms_message`
  - `post_to_board()` writes to `comms_board_post`
  - `reset_for_tests()` calls `reset_tables(...)` + clears in-memory dicts
  - `_messages` dict stays as in-memory cache (crypto objects can't go in DB)
  - All 9 existing comms tests pass unchanged

`server/hw.py` (new):
  - `sdr_backend()` — OVERSEER_SDR env var → rtlsdr / hackrf / airspy / synthetic
  - `lora_backend()` — OVERSEER_LORA → sx1262 / sx1278 / rylr998 / synthetic
  - `mesh_backend()` — OVERSEER_MESH → meshtastic / hamlib / synthetic
  - `gps_backend()` — OVERSEER_GPS → gpsd / serial / synthetic
  - `power_backend()` — OVERSEER_POWER → ina226 / shunt / synthetic
  - `display_backend()` — OVERSEER_DISPLAY → epaper / hdmi / headless
  - `hw_info()` — snapshot dict of all backends
  - `any_real_hardware()` — True if any non-synthetic backend active
  - Unknown env values fall back to default with a warning

`tests/unit/test_comms.py` (extended to 12 tests):
  - +3 persistence tests: message_written_to_db, mark_read_updates_db,
    board_post_written_to_db

`tests/unit/test_hw.py` (new, 18 tests):
  - TestDefaults (6): all defaults correct
  - TestEnvOverrides (8): each backend, unknown value warning, case-insensitive
  - TestHwInfo (4): all keys, defaults, any_real_hardware false/true

`.gitignore`:
  - Added `.fuse_hidden*` (Linux FUSE mount artefacts)

---

## ADRs 0001–0013 in place

All in `docs/architecture-decisions/`. See Sprint 8 STATUS for full table.

---

## Things parked

- Brotli dict ctypes shim (ADR-0010)
- JS-side Brotli v0x02 (wait on browser support)
- COMMS forward secrecy — python-doubleratchet (ADR-0012)
- COMMS `_messages` in-memory cache — crypto objects require live ratchet state
- Real hardware backends — env flags in `server/hw.py`, stubs ready to swap in
- Cardputer firmware (Ted writes this against the OPi5 backend)
- `.git/` cruft + `.trash_local/` cleanup

