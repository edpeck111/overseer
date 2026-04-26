# 04 — IMPLEMENTATION PLAN

> Suggested sprint ordering, what to keep from v2, what to throw away, migration notes.

---

## 1. What to keep from v2

The v2 codebase has good bones. Don't rewrite for the sake of rewriting.

### Keep with minor changes

- **`server.py` Flask app structure.** Routes change; the architecture is fine. Refactor into a `server/` package with module per domain rather than one 1366-line file.
- **SQLite schema.** Existing tables (`users`, `messages`, `contacts`, `blocks`, `waypoints`, `admin_pin`, `archives`) are well-designed. Add columns + new tables; don't drop existing.
- **Kiwix integration.** `search_kiwix()` and `library_*` endpoints are solid. Wrap them in a cleaner module but keep the kiwix-serve approach.
- **MBTiles tile server.** `serve_tile()` works fine. Move to `server/maps.py`, no functional change.
- **Medical triage decision trees.** ~1000 LOC in `medical.js` encodes real decision trees. Extract data → `shell/data/triage.json`, render with new wizard component.
- **Sound files.** All 8 key WAVs + UI structure for sound toggling. Keep.
- **Service worker.** Currently minimal in `static/sw.js`; expand for PWA + offline.
- **PWA manifest.** Update theme color, icons stay.
- **Setup scripts.** `setup.sh`, `deploy.sh`, `download_tiles.py` — keep, possibly tweak paths.
- **Operator identity / keypair UI.** The structure exists in v2 admin panel. Audit the actual crypto (likely a stub) and replace, but the registration flow stays.

### Throw away

- **Current HTML monolith.** `templates/index.html` is 506 lines of intertwined module markup. Replace entirely with the new shell — single-page, loaded once, everything client-rendered after.
- **Per-module CSS files.** `comms.css`, `core.css`, `knowledge.css` etc are reasonable but written against v2 markup. New design system supersedes them. Use the visual reference's CSS as the new base.
- **Per-module JS files.** Same — new state machine architecture. Mine them for triage trees and a few helpers, otherwise rewrite.
- **The boot splash with click-to-init.** Keep the boot-log idea but make it 2-3s authentic, not interactive.
- **PIN entry on a square keypad.** Replace with inline prompt.
- **The dashboard cards on HOME.** Replaced by the new menu + side-stack pattern.
- **The library "BROWSE / SEARCH" tab toggle.** Replaced by Miller columns.
- **Hardcoded `MODEL = "qwen2.5:7b-instruct-q4_K_M"` in server.py.** Move to settings table, runtime-switchable.
- **The encryption stub** (likely just storing keypairs without using them). Replace with real ratchet.

---

## 2. Repo structure (target)

```
overseer/
├── README.md
├── requirements.txt
├── pyproject.toml
├── server/
│   ├── __init__.py
│   ├── app.py                  Flask app factory
│   ├── config.py
│   ├── db.py                   SQLite + migrations
│   ├── auth.py                 PIN + signed challenges
│   ├── ws.py                   WebSocket hub
│   ├── omp/
│   │   ├── server.py           OMP request handler
│   │   ├── opcodes.py          enum + dispatch table
│   │   ├── codec.py            Brotli + MessagePack + dict
│   │   └── dictionary.bin      pre-built shared dict
│   ├── modules/
│   │   ├── knowledge.py
│   │   ├── comms.py
│   │   ├── medical.py
│   │   ├── navigation.py
│   │   ├── power.py
│   │   ├── log.py
│   │   ├── inventory.py
│   │   ├── recreation.py
│   │   ├── signal_.py
│   │   ├── timeline.py
│   │   ├── system.py
│   │   └── help.py
│   ├── llm/
│   │   ├── ollama.py           Ollama wrapper
│   │   ├── embeddings.py       sqlite-vss helper
│   │   ├── whisper.py          STT
│   │   └── piper.py            TTS
│   ├── crypto/
│   │   ├── ratchet.py          Signal-style double ratchet
│   │   ├── keys.py             ed25519 + x25519
│   │   └── envelope.py         message signing/encryption
│   └── plugins/                hot-reloadable plugin loader
│
├── shell/                      The static client bundle
│   ├── package.json
│   ├── vite.config.js          (or esbuild — TBD; keep small)
│   ├── public/
│   │   ├── manifest.json
│   │   ├── sw.js
│   │   └── icons/
│   ├── src/
│   │   ├── main.js             entry point
│   │   ├── state/              shared state (tiny store)
│   │   ├── transport/          HTTP / OMP adapters
│   │   ├── chrome/             status strip, breadcrumb, hotkey bar
│   │   ├── palette/            command palette
│   │   ├── modules/
│   │   │   ├── home.js
│   │   │   ├── knowledge.js
│   │   │   ├── comms.js
│   │   │   └── ... (one per module)
│   │   ├── components/         reusable: menu-item, msg-row, tile, bar, sparkline
│   │   ├── styles/             tokens + layouts (one CSS per module)
│   │   ├── data/
│   │   │   ├── triage.json
│   │   │   ├── help.json
│   │   │   ├── lore.json
│   │   │   └── fortune.txt
│   │   └── crypto/             same ratchet, in JS
│   └── dist/                   built bundle, ≤ 2MB target
│
├── tools/
│   ├── sim-mesh.py             OMP transport simulator
│   ├── sim-operators.py        multi-operator sim
│   ├── build-dictionary.py     Brotli dict generator
│   └── seed-data.py            sample data for dev
│
├── data/                       runtime data (gitignored)
│   ├── overseer.sqlite
│   ├── snapshots/
│   ├── plugins/
│   └── archives/               ZIM mount point
│
├── deploy/
│   ├── setup.sh                first-boot OPi5 setup
│   ├── deploy.sh               update from git pull
│   ├── start_overseer.sh
│   ├── start_kiwix.sh
│   └── systemd/                .service files
│
├── docs/
│   ├── 01-DESIGN-SPEC.md       (these handoff files, kept in repo)
│   ├── 02-MODULE-CATALOG.md
│   ├── 03-MESH-ARCHITECTURE.md
│   ├── 04-IMPLEMENTATION-PLAN.md
│   ├── 05-OMP-PROTOCOL.md
│   └── architecture-decisions/ ADRs
│
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/                    Playwright against dev OPi5 or simulator
```

---

## 3. Sprint plan

Numbered sprints, each one shippable on its own. I'd estimate 1-2 weeks per sprint at relaxed pace; faster if Ted's full-time on it.

### Sprint 0 — Repo migration & dev environment

- New repo structure as above
- Git history preserved (the current repo becomes the base)
- `setup.sh` updated for new structure
- Vite or esbuild build for shell (whichever is lighter)
- Pre-commit hooks: ruff + prettier + typecheck (mypy or pyright)
- CI on a tagged release at minimum
- Replicate v2 behaviour via the new structure but with new entry points

**Gate:** shell builds, server starts, existing v2 functionality reachable through compatibility shims.

### Sprint 1 — Chrome + HOME

The visual reference is your starting point.

- Status strip component, all 8 segments, wired to a state store
- Breadcrumb component
- Hotkey bar component
- Command palette overlay
- HOME screen rendered from a module registry
- Routing: each module key (`K`, `C`...) selects a module view
- All static, no real data yet — placeholder values that *look* live

**Gate:** open the app, navigate the menu with hotkeys, palette opens with `:`, looks like the visual reference at every breakpoint.

### Sprint 2 — Transport layer + OMP foundation

- `HttpTransport` adapter implementing the full request shape
- `OmpTransport` stub with a simulator backend
- Shared state store wired so component re-renders happen on transport events
- WebSocket multiplexer on backend
- Optimistic UI helper: every action goes through `dispatch(action)` which updates state immediately and queues the network call
- OMP codec (Brotli + MsgPack), dictionary build script
- Cache classes (STATIC/STABLE/WARM/HOT/EXPENSIVE) implemented in transport

**Gate:** mesh simulator can serve a roundtrip; HOME's `MESH:●●○` indicator reacts to simulated mesh health changes; optimistic action queues drain correctly.

### Sprint 3 — POWER (canary module)

POWER is the smallest real module. Build it end-to-end as a canary for the architecture before attacking complex modules.

- `server/modules/power.py` reading from a `power_sample` table
- Background sampler writing every 30s
- Sparkline component (Unicode block characters)
- Tile component
- Bar component
- All four tiles populated with real data
- WebSocket push for live updates

**Gate:** open POWER on phone WiFi, see real data, sparklines update live, transition to mesh simulator and see graceful degradation to polled updates.

### Sprint 4 — Static shell discipline (critical, often skipped)

Before more modules, harden the shell-vs-API split.

- Build process produces a single deployable shell bundle ≤ 2MB
- Service worker pre-caches the bundle
- Service worker strategies per cache class
- Offline mode: shell loads + works with cached data when OPi5 unreachable
- Cardputer flash image: same shell + a stub OMP bridge
- Sample remote-operator session on the mesh simulator

**Gate:** disconnect phone from OPi5; UI still loads, shows cached data with `as-of` stamps, queues outbound actions; reconnect and queue drains.

### Sprint 5 — KNOWLEDGE refresh

- New chat sub-screen with MUD-style scrolling log
- Slash commands
- New library Miller-columns layout
- Background embeddings indexer (sqlite-vss)
- Hybrid retrieval (BM25 + vector)
- Citations clickable
- Branching (data model + UI tree view)
- Whisper.cpp integration for voice input
- Piper TTS for output (optional toggle)

**Gate:** ask a question, get a streamed answer with citations, click a citation to jump to library, fork the conversation, see branches in the tree view.

### Sprint 6 — COMMS refresh + boards

- Three-pane layout
- Inbox/Sent/Drafts/Archive/Outbox folders
- Boards (`/general /intel /trade /swap /sos`)
- Net pane with mesh node list
- Compose with optimistic send
- Delivery state badges
- Real Signal-ratchet implementation (lift to JS too)
- Mesh routing: messages forward through nodes
- Markdown rendering in message body
- Attachment support (photos, voice notes)

**Gate:** two simulated operators exchange encrypted messages over the mesh simulator with multi-hop routing; ratchet state survives across reconnects; board posts visible to all.

### Sprint 7 — MEDICAL wizard reflow

- Wizard renderer (question-card sequence)
- Triage trees migrated from v2 to `shell/data/triage.json`
- Triage run / step persistence
- Replayable runs in History sub-screen
- Dose calculator
- Drug interaction database
- Reference search (uses Knowledge library backend)
- Photo-assisted triage (Qwen2-VL on RK3588 NPU) — defer if VLM setup complex

**Gate:** complete a bleeding triage; see the run replayable in history; calculate a paracetamol dose with interactions; reference search returns a WikiMed article.

### Sprint 8 — NAVIGATION refresh

- Two-pane MC-style waypoints
- Compass sub-screen (text-only nearest waypoints)
- Map sub-screen (Leaflet kept from v2, restyled)
- Offline routing (GraphHopper or Valhalla)
- Elevation profiles (SRTM data)
- Line-of-sight calc
- Drawing mode for overlays
- Dead reckoning (IMU integration; phone-only)

**Gate:** add a waypoint via GPS capture, route to it, see elevation profile, draw a no-go zone overlay.

### Sprint 9 — LOG

- Today sub-screen with quick-entry input
- Entry kinds + auto-typed tags
- Photos + OCR
- GPS + weather auto-attach
- Daily LLM summary (scheduled job at 22:00)
- Browse/search past entries
- Export markdown
- Hooks from other modules into log auto-events

**Gate:** type 5 entries, see them tagged correctly; complete a triage and see auto-log entry appear; receive a comms message and see auto-entry; daily summary generated and editable.

### Sprint 10 — INVENTORY

- Three-pane browse (categories / items / detail)
- UPC scan via phone camera
- UPC database (offline, ~1GB)
- Burn-rate analytics
- Expiry alerts
- Pack optimizer
- Mission templates

**Gate:** scan 5 items, mark some consumed, see burn-rate prediction, run pack optimizer for "48h patrol".

### Sprint 11 — TIMELINE

- Unified events query (UNION ALL across modules)
- Filters by kind, who, range
- Causal threading (events ±15min)
- Markdown export

**Gate:** view 72h timeline showing entries from at least 5 different modules; filter by kind; export to markdown.

### Sprint 12 — SIGNAL

- LoRa daemon integration (meshtasticd already running)
- Mesh node detail (extends Comms net pane)
- LoRa packet log
- RTL-SDR integration (defer if hardware not yet acquired)
- ADS-B (dump1090 → ADS-B tracks)
- APRS feed
- NOAA APT decode
- Spectrum waterfall

**Gate:** spectrum waterfall shows real LoRa traffic; mesh nodes update live with RSSI; NOAA pass schedule visible.

### Sprint 13 — RECREATION foundation

- Game registry + harness
- Fortune
- Wiki Roulette
- Reader (paged ZIM article reader)
- Chess vs bundled engine
- Zork / z-machine player

**Gate:** play chess against the AI; read a Gutenberg book over multiple sessions with progress saved.

### Sprint 14 — RECREATION: Dragon's Tale

Its own sprint because of multiplayer complexity.

- Single-player core: town, forest, inn, training, dragon palace
- Stats, levels, weapons, armor, gold, gems
- Daily turn limits
- Master fights for level-up
- LORD-style flirt/marriage system using comms backend
- Cross-operator PvP: when nodes see each other on mesh, they sync game state and allow forest battles
- Persistent state via CRDTs

**Gate:** two simulated operators reach level 5, fight each other in the forest, one wins gold from the other, state syncs both ways.

### Sprint 15 — SYSTEM polish + HELP

- Themes (5 presets)
- Font switcher
- Snapshots + restore
- Plugin loader
- Tail logs
- Help & Xtras module fully populated
- Easter eggs (`:fortune`, `:matrix`, Konami)

**Gate:** switch theme, restore from snapshot, write a tiny plugin and hot-reload it, find the easter eggs.

### Sprint 16+ — Polish, optional modules, hardware integration

- Cardputer firmware (Ted's domain; backend cooperates)
- M5StickC PLUS2 firmware (status display)
- INTEL, RITUAL, ARCHIVE optional modules
- Performance pass: bundle size, render perf, embedding index size
- Accessibility pass
- Documentation
- v3.0.0 release

---

## 4. Database migration

V2 → V3 migration via numbered SQL scripts in `server/migrations/`:

```
001_baseline.sql              v2 schema as captured
002_chat_sessions.sql         knowledge tables
003_archive_chunks.sql        embeddings tables
004_messages_v3.sql           board, parent_id, delivery_state, signature
005_mesh_nodes.sql            mesh_node table
006_triage_runs.sql           triage history tables
007_drugs.sql                 drug + dose_calc tables
008_log_entries.sql           log + daily_summary
009_inventory.sql             inv_* tables
010_game_state.sql            game_state + game_event
011_power_samples.sql         power_sample
012_settings.sql              key-value settings + snapshots + plugins
013_overlays.sql              map_overlay + route_cache
014_attachments.sql           attachment table
```

Each migration is forward-only. Migration runner stamps `schema_migrations(version, applied_at)`.

`server/db.py` has a `migrate()` function called at startup. Backup the DB before applying anything new.

---

## 5. Performance budgets

Set early so they don't get violated quietly:

| Metric | Target | Hard limit |
|---|---|---|
| Shell bundle (gzipped) | ≤ 1.5 MB | ≤ 2 MB |
| Time to first interactive | ≤ 1s on phone | ≤ 2s |
| Time to first LLM token (WiFi) | ≤ 2s | ≤ 5s |
| Time to first LLM token (mesh SF7) | ≤ 5s | ≤ 15s |
| Memory footprint of OPi5 backend (steady) | ≤ 7 GB inc Ollama | ≤ 9 GB |
| Frame time during real-time POWER updates | ≤ 16ms | ≤ 33ms |
| OMP packet roundtrip (mesh sim, no congestion) | ≤ 200ms | ≤ 1s |
| Cardputer cold boot to first menu | ≤ 5s | ≤ 10s |

Track these in CI where possible.

---

## 6. Hardware milestones (Ted's track)

Per the v2 project notes, hardware acquisition is staggered. Backend should not block on it:

| Milestone | What works |
|---|---|
| **Today** (no new hardware) | Develop on existing Windows machine + v2 OPi or any Linux box |
| **OPi 5 Max acquired** | First real deployment; full LLM speed |
| **Cardputer-Adv acquired** | Cardputer firmware development begins |
| **LoRa hat acquired** | OMP-over-LoRa real testing begins |
| **RTL-SDR acquired** | SIGNAL module SDR features unlocked |
| **M5StickC sensors** | Optional environmental telemetry |

Sprints 1-11 don't require any hardware Ted hasn't planned. Sprint 12 (SIGNAL) gates on RTL-SDR + LoRa hat.

---

## 7. Decisions to make early

Things to settle in Sprint 0 to avoid churn later:

1. **Build tool for shell:** Vite (richer dev experience) or esbuild (faster, smaller). Recommendation: esbuild — keeps dependency tree small, aligns with the prepper/minimal ethos.

2. **State store:** nanostores, valtio, or hand-rolled? Recommendation: hand-rolled, ~100 lines. Avoids dependency, matches the keep-it-simple aesthetic.

3. **TypeScript or JS?** Recommendation: vanilla JS with JSDoc types. Smaller output, no transpile step.

4. **CSS approach:** plain CSS (with custom properties) or a tiny utility framework? Recommendation: plain CSS, organized by component. The visual reference already demonstrates the pattern.

5. **WebSocket library on backend:** flask-sock, websockets, or async refactor? Recommendation: flask-sock — fits the existing Flask architecture without rewriting.

6. **MessagePack lib:** Python `msgpack`, JS `msgpackr`. Both well-maintained.

7. **Brotli with shared dict:** Python `brotli` + JS `brotli-wasm` or native browser compression. Browser CompressionStream API supports Brotli — use it where available, fallback to wasm.

These decisions go in `docs/architecture-decisions/` as ADRs once made.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Shell bundle bloats past 2MB | Set CI budget. Audit deps. Lazy-load modules if needed. |
| Embeddings index too large for NVMe headroom | Use 384-dim instead of 768; aggressive chunking; INT8 quantization |
| Real-time updates overwhelm mesh | Cache classes throttle aggressively on mesh; dynamic backoff |
| Crypto bugs in custom ratchet | Use libsodium primitives only; reference Signal's published spec; test vectors |
| LLM responses can't compress well over mesh | Vocabulary dictionary tuned to Overseer outputs; consider semantic compression (response codes for canned answers) |
| Cardputer firmware too complex for ESP32 | Strip to OMP bridge only; don't render UI on the device, only forward to phone |
| Multi-operator state conflicts | CRDTs for game state; last-write-wins for trivia; explicit merge UI for genuine conflicts |
| User loses operator key | Recovery via OPi5 admin panel; key rotation supported in protocol |

---

## 9. The first commit

```
overseer-v3-handoff/         (this folder)
├── 00-VISUAL-REFERENCE.html
├── 01-DESIGN-SPEC.md
├── 02-MODULE-CATALOG.md
├── 03-MESH-ARCHITECTURE.md
├── 04-IMPLEMENTATION-PLAN.md
├── 05-OMP-PROTOCOL.md
└── README.md
```

Drop into the v2 repo as `docs/v3-handoff/`. Make a long-running branch `v3-redesign`. Sprint 0 is the first PR; everything else stacks.

---

End of implementation plan. Continue to `05-OMP-PROTOCOL.md`.
