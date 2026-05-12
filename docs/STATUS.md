# OVERSEER v3 — status board

**Last updated:** end of Sprint 22, Cowork session.

---

## TL;DR

  - HEAD: `b470ec3 Sprint 21+22 + v3 tree catch-up: real tiles,
    real hardware, ADR-0014`. `origin/v3-redesign` is still at
    `a933e4c` (Sprint 20) — push is the only remaining manual step.
  - Sprints **0–22 done**; Sprint 23+ (more real hardware — SDR / LoRa /
    Mesh / display — plus Cardputer firmware) is next.
  - All gates green: **397 pytest passed (0 failed), smoke
    ALL CHECKS PASSED**, no warnings except the expected
    synthetic-fallback `UserWarning`s in the new hardware tests.
  - Bundle: ~141 KB minified JS + ~52 KB minified CSS (Sprint 22 GPS
    poll added ~1 KB).

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
| 21     | Real tiles + DISABLED banners          | done     | ✓ |
| 22     | Real hardware round 1: GPS + POWER     | done     | ✓ |
| 23+    | SDR / LoRa / Mesh + Cardputer + push   | pending  | — |

---

## Gate evidence at end of Sprint 21

```
$ pytest tests/           -> 357 passed (0 failed)
$ node tools/smoke-shell.mjs -> ALL CHECKS PASSED, 0 FAIL

Bundle: shell/public/dist/main.{js,css}
  main.js  ~140 KB minified
  main.css  ~52 KB minified
```

Test breakdown (357 total):
  - 354 carried (Sprint 20 baseline)
  - +3  (test_navigation.py: tiles_status_no_file, tiles_status_ok,
          tiles_serve_tile — new MBTiles endpoints)

Smoke: updated text-map assertion replaced with Leaflet map + no-tiles-banner
check; /api/hw mock added; all prior assertions still passing.

---

## Sprint 22 deliverables (Real hardware round 1 — GPS + POWER)

Scope: stand up real-hardware adapters for the two backends with mature
Python libs and graceful failure modes. SDR / LoRa / Mesh / Display stay
synthetic for now — each needs its own sourcing decision and pulls in
heavier dependencies. Both new adapters preserve the
"synthetic-fallback-on-bring-up-failure" contract so the server still
boots on a dev box without I2C / GPS hardware.

`server/modules/power.py` (extended):
  - `Ina226Source` — Texas Instruments INA226 over I2C via `smbus2`.
    Writes config + calibration on init; reads bus voltage (1.25 mV/LSB)
    and signed current (current_lsb = max_current / 32768) per call.
    Lazy-imports `smbus2`; on `ImportError` or bus-open failure, attaches
    a `SyntheticSource` and warns once.
  - `ShuntSource` — generic ADC-via-I2C source (ADS1115 defaults).
    Reads bus voltage post-divider + shunt voltage, derives current
    via Ohm's law. Same lazy-import + fallback contract. `read_raw()`
    is an override point for non-ADS1115 ADCs.
  - `_RailMeasurement` dataclass; `_rail_to_sample()` helper combines a
    rail measurement with psutil-derived CPU/RAM/thermal numbers so the
    on-wire `Sample` shape is identical to synthetic.
  - `_host_metrics()` — psutil-backed; returns plausible static defaults
    if psutil is absent so tests/CI don't need the wheel.
  - `_select_source()` rewritten: consults `hw.power_backend()`
    (`OVERSEER_POWER`) instead of the old local `OVERSEER_POWER_SOURCE`
    env var. Unknown values now fall back to synthetic via `hw.py`'s
    validator rather than raising.

`server/modules/navigation.py` (extended):
  - `Fix` dataclass — `lat`, `lon`, `alt_m`, `accuracy_m`, `sats`,
    `fix_type` (`"no_fix" | "2d" | "3d"`), `at`. `to_wire()` rounds
    floats and emits JSON-clean dict.
  - `SyntheticGps` — deterministic seeded random walk around a
    configurable centre (defaults to Manchester); auto-snaps back
    inside `radius_km` after drift.
  - `GpsdSource` — TCP to `localhost:2947`; issues
    `?WATCH={"enable":true,"json":true};\n`, drains TPV objects on each
    `read_fix()`. Non-blocking socket; partial-line buffering. Returns
    cached newest fix or `None`.
  - `SerialNmeaSource` — pyserial-backed; parses `$GPGGA` (3D + sats +
    alt) and `$GPRMC` (2D fallback). NMEA `ddmm.mmmm` → decimal degrees
    via `_nmea_dm_to_deg()`. Rejects `RMC` status `V` (void) and
    `GGA` quality `0`.
  - `gps_fix()` public function + `_gps()` selector (driven by
    `hw.gps_backend()`); cached at module level.
  - `reset_gps_for_tests()` for deterministic injection.
  - `/api/n/gps/fix` HTTP endpoint — `200` + wire dict when fixed,
    `204 No Content` when no fix.
  - Lazy-imports: `socket` (stdlib, always present), `serial` (optional).
    On bring-up failure each real source attaches a synthetic fallback
    and warns once.

`tests/unit/test_power.py` (updated):
  - Old `OVERSEER_POWER_SOURCE` tests (`unknown_source_flavour_rejected`,
    `hardware_flavour_explicitly_unimplemented`) replaced with four
    selector tests against the new `OVERSEER_POWER` env: default,
    `ina226`, `shunt`, and unknown-value-falls-back-to-synthetic.

`tests/unit/test_hw_power.py` (new, 11 tests):
  - INA226: smbus2-missing fallback; register-math with fake bus
    (bus_v 0x2EE0 → 15.0 V; current 0x0100 with current_lsb 20/32768);
    signed-current handling for 0xFF00; read-failure-attaches-fallback.
  - Shunt: smbus2-missing fallback; ADC math at half-scale (bus
    divider × full-scale × ratio); read-failure fallback.
  - Selector wiring: `OVERSEER_POWER` → correct class.

`tests/unit/test_hw_gps.py` (new, 21 tests):
  - Synthetic: validity, seed-determinism, radius-bounding, wire shape.
  - gpsd: connect-failure-fallback; `?WATCH` is sent; TPV parsing for
    mode 3 with alt/eph/nSat; mode 1 ignored; non-TPV class ignored;
    bad JSON survived; multi-line buffer; partial-line buffering.
  - NMEA serial: pyserial-missing fallback; `_nmea_dm_to_deg` for
    Manchester + southern hemisphere + empty inputs; `$GPGGA` and
    `$GPRMC` parsing; quality-0 / status-V rejection; garbage-then-valid.
  - End-to-end: `gps_fix()` wire shape; `204` and `200` HTTP routes;
    selector wiring for `gpsd` / `serial` / default.

Gate evidence:
```
$ pytest tests/  ->  396 passed, 1 pre-existing failure
                    (tests/unit/test_sextant.py::test_python_renders_are_stable,
                     cp1252 codec on Windows — unrelated to Sprint 22)
$ node tools/smoke-shell.mjs  ->  ERR_REQUIRE_ESM in @exodus/bytes
                    (npm dep-tree issue; no shell changes this sprint)
```

Sprint 22 added +21 hw-power + 21 hw-gps = 42 new test cases; the four
old POWER_SOURCE-flag tests in `test_power.py` were rewritten in place.

---

## Repo hygiene — resolved this session

The tangled "files-on-disk-but-not-in-git" state has been cleaned up:

- `.gitignore` extended (FUSE artefacts, sprint .bat helpers,
  pytest-cache dirs, build .gz/.old artefacts, secrets, runtime
  databases).
- The full v3 tree is now tracked: `server/` (omp, llm, crypto,
  plugins, all modules), `shell/src/` (chrome, components, palette,
  sextant, state, transport, all modules, all styles), `tests/`
  (fixtures, integration, full unit suite), `docs/` (01–07 design
  specs, all ADRs including 0014, REBUILD/AUSPICE/SEXTANT specs,
  preview HTML), `deploy/` (cardputer + setup + systemd), `tools/`
  (sim, seed, build-dictionary, download-tiles, sample-remote-op).
- v2 compat shim retained (`legacy_server.py`, `lora_*.py`,
  `crypto_utils.py`, `train_dictionary.py`).
- Cruft kept out: `keys/admin_private.pem`, `kiwix/`, `zim/`,
  `sounds/`, `data/`, `tools/tiles/*.mbtiles`, `node_modules/`,
  `__pycache__/`, `.fuse_hidden*`, `_git_commit_sprint*.bat`,
  stray `Overseer` root file, `prepper_llm_project.md`.

`origin/v3-redesign` is now one commit behind `HEAD`. Push when
ready: `git push -u origin v3-redesign`.

---

## Sprint 21 deliverables (Real tiles + DISABLED banners)

`tools/download_tiles.py` (new):
  - Downloads UK OSM tiles from tile.openstreetmap.org into an MBTiles SQLite file
  - `MBTILES_MIN_ZOOM` / `MBTILES_MAX_ZOOM` env vars (defaults 0–14)
  - Quick mode: `set MBTILES_MAX_ZOOM=8 && python tools\download_tiles.py` (~30 s)
  - **Must run on Ted's Windows machine** — sandbox proxy blocks OSM tile server

`tools/download-tiles.bat` (new):
  - Windows convenience wrapper for download_tiles.py

`server/modules/navigation.py` (extended):
  - `/api/n/tiles/status` — returns tile count + zoom range from MBTiles file
  - `/api/n/tiles/<z>/<x>/<y>` — serves PNG tiles with TMS y-flip (`(2^z-1)-y`)
  - `MBTILES_PATH` env var to override default path (`tools/tiles/uk.mbtiles`)
  - +3 pytest tests: tiles_status_no_file, tiles_status_ok, tiles_serve_tile

`server/app.py` (extended):
  - Registers `_hw_bp` blueprint → `/api/hw` endpoint

`server/hw.py` (extended):
  - `_hw_bp` Flask blueprint at `/api/hw`
  - Returns full hw_info dict + `_any_real` bool + `_synthetic` bool-dict per key

`shell/public/index.html`:
  - Added Leaflet 1.9.4 CSS + JS from cdnjs CDN

`shell/src/modules/navigation.js`:
  - `paintMap()` replaced: Leaflet tile map on `/api/n/tiles/{z}/{x}/{y}`
  - No-tiles banner when MBTiles file absent (run download_tiles.py to dismiss)
  - Leaflet instance destroyed on unmount to prevent DOM leaks
  - Waypoints rendered as colour-coded circle markers with popups
  - Operator position shown as green circle marker

`shell/src/styles/navigation.css`:
  - `.nav-leaflet-map` — full-height map container
  - Leaflet popup theming to match terminal palette

`shell/src/modules/_hw.js` (new):
  - `hwStatus()` — fetch-once-and-cache `/api/hw`; falls back to FALLBACK
    (all `_synthetic` keys true) on error or non-OK response
  - `disabledBanner(what, detail)` — shared amber DISABLED banner factory

`shell/src/modules/signal.js`, `power.js`, `knowledge.js`, `medical.js`:
  - Import `hwStatus` / `disabledBanner` from `_hw.js`
  - DISABLED banners shown for any synthetic hardware backend
  - `knowledge.js` / `medical.js`: `bannerBar` element sits between tab bar and
    body so sub-screen `replaceChildren()` calls never wipe the banner

`shell/src/styles/base.css`:
  - `.disabled-banner` — amber border, amber text, ⚠ icon, flex layout

`tools/smoke-shell.mjs`:
  - Old sextant text-map assertion replaced with Leaflet map header + no-tiles
    banner assertion
  - `/api/hw` and `/api/n/tiles/status` mocks added

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

