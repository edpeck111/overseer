# CLAUDE.md — OVERSEER

Mesh-native, low-bandwidth, text-mode prepper intelligence system. See `README.md` for the
folder map. This file covers how to work in the repo.

## Orientation — read first

1. `docs/STATUS.md` — the sprint board, latest deliverables, current test counts, and what is
   blocked on hardware. This is the source of truth for where the project is. Don't rely on
   memory or this file for sprint numbers.
2. `docs/01-DESIGN-SPEC.md` (principles P1–P11), then `02-MODULE-CATALOG.md`, then
   `04-IMPLEMENTATION-PLAN.md` (sprint plan and target layout).
3. `docs/architecture-decisions/` — ADRs 0001–0016. Read the relevant one before changing
   anything it covers. The load-bearing ones:
   - 0009 / 0015 — sextant text rendering is the system-wide default (see below)
   - 0014 — hardware-adapter pattern
   - 0016 — Meshtastic as the LoRa transport. No custom LoRa framing without arguing against it.

## Branches

- `main` — v2 (Flask monolith, `legacy_server.py`). Bug fixes only.
- `v3-redesign` — v3 work, sprint-numbered. This is where development happens.
- Remote: `origin` → GitHub `edpeck111/overseer`.

## Layout in one breath

- `server/` — v3 Flask package. `python -m server` serves on `:6100`, with the shell at `/v3/`.
  One file per UI module in `server/modules/`. OMP protocol lives in `server/omp/`. The backend
  selector is `server/hw.py`. SQLite migrations are in `server/migrations/`.
- `shell/` — v3 static client (vanilla JS + JSDoc, plain CSS, hand-rolled store, esbuild).
  Modules are in `shell/src/modules/`. The sextant rasterizer is in `shell/src/sextant/`.
- `tools/` — `smoke-shell.mjs` (jsdom shell smoke test), `sim-mesh.py`, `lora-spike.py`
  (23b bench), `download_tiles.py`, seeders.
- `deploy/` — setup/start scripts, `systemd/overseer.service` (OPi5), `cardputer/`.
- v2 leftovers kept in-tree: `legacy_server.py`, `lora_*.py`, `crypto_utils.py`,
  `train_dictionary.py`, `games/`, `meshtastic/`, `relay/`, `templates/`, `static/`.

## Quality gates — both must pass before a sprint commit

```bash
pytest tests/
node tools/smoke-shell.mjs
```

- Rebuild the shell after any `shell/src` change: `cd shell && npm run build`. Output goes to
  `shell/public/dist/main.{js,css,*.map}`, which **is tracked**. Commit it. `.gz`/`.old` variants
  are gitignored.
- Bundle budget: roughly 140 KB minified JS and 52 KB minified CSS. Flag significant growth.
- Lint and format are ruff (line length 100), prettier, and pyright via `.pre-commit-config.yaml`.
- Known Windows quirk: `tests/unit/test_sextant.py::test_python_renders_are_stable` can fail
  with a cp1252 codec error. It is unrelated to most changes, but say so if it shows up.

## Dependency pins

- Root `node_modules` pins `jsdom@^26.1.0`. **Do not upgrade to jsdom@29.** It pulls in
  `html-encoding-sniffer@6`, which CJS-requires the ESM `@exodus/bytes` and breaks smoke on
  Node 20.
- Optional hardware libs (`smbus2`, `pyserial`, `meshtastic`, `pyrtlsdr`, …) are lazy-imported
  and are **not** in `requirements.txt` until a hardware gate confirms the version.

## Conventions

### Sextant ASCII is the default graphics primitive
Maps, tarot, moon phases, antenna patterns and other visuals render through the sextant
Unicode-block rasterizer by default. Graphical renderers (Leaflet, canvas, images) are opt-in
WiFi-only alternatives, never the default. Sprint 21 silently flipped NAVIGATION to Leaflet,
and Sprint 22.6 / ADR-0015 reverted it. Don't repeat that.

### Hardware adapters (ADR-0014)
1. Adapter classes live in the module that consumes them (e.g. `Ina226Source` in
   `server/modules/power.py`), not in a `server/hw/` sub-package.
2. Optional deps are lazy-imported inside `__post_init__`. `ImportError` falls back.
3. Any bring-up or read failure attaches an embedded synthetic source and warns once
   (`UserWarning`). **The server must never crash from missing hardware.**
4. Pick the main backend through `hw.*_backend()` (`OVERSEER_POWER`, `OVERSEER_GPS`,
   `OVERSEER_LORA`, …). Never read `os.environ` directly for it. Auxiliary knobs
   (`OVERSEER_GPS_DEVICE`, `OVERSEER_LORA_DEVICE`, `MBTILES_PATH`) are fine at module level.
5. Each adapter exposes `last_error: str | None`.
6. Real and synthetic backends produce an identical wire shape. The shell learns "synthetic"
   only via `/api/hw` `_synthetic` flags, which drive the DISABLED banner.
7. Cross-platform serial defaults: `/dev/ttyUSB0` on Linux, `COM3` on Windows,
   `/dev/tty.usbserial` on macOS.
8. Reference implementations: `server/modules/power.py`, `server/modules/navigation.py`,
   `server/omp/lora_transport.py`. Reference tests: `tests/unit/test_hw_power.py`,
   `test_hw_gps.py`, `test_lora_transport.py` (fake-bus injection, fallback assertions).
   Expect about 200–400 LOC and about 20 unit tests per backend.

### Sprints and commits
- Commit messages are `Sprint N: <title>`. Consecutive sprints touching the same files can share
  a commit (`Sprint 12+13: …`). Don't split them artificially.
- Every sprint adds a `## Sprint N deliverables` section to `docs/STATUS.md` (what landed, what
  it does NOT land, and gate evidence) and updates the TL;DR and the per-sprint table.
- Hardware-gated sprints ship "sw-done". The on-air or device evidence gets pasted into a
  `## Sprint N … gate evidence` block in STATUS.md once Ted runs it.
- New architecture decisions get the next-numbered ADR in `docs/architecture-decisions/`.

## People and lanes

- **Ted** owns the hardware: radio bring-up, on-air and device gates, and the Cardputer
  firmware (Sprint 23c–e, ESP-IDF). Don't write firmware unasked. Build the OPi5 side and the
  bench tooling, and leave the gate run to Ted.
- `c:\source\tracker` is the sibling Rust audio engine that TRACKER (Sprint 24) ports from.
  It is early-stage, so port concepts and the TOML grammar, not a pinned commit.

## Housekeeping

- Root-level `.fuse_hidden*`, `_git_commit_sprint*.bat`, and `pytest-cache-files-*` are
  gitignored artefacts. `.trash_local/` holds rejected work. Leave them unless asked to clean up.
- `keys/`, `kiwix/`, `zim/`, `sounds/`, `data/`, and `*.mbtiles` are runtime assets, not source.
  Never commit them.
