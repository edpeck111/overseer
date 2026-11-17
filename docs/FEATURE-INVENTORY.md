# OVERSEER — feature inventory (pre-redesign audit)

**Audited:** 2026-11-17, against `v3-redesign` @ `bc2ed97`. This was a read-only audit of `server/`,
`shell/`, `legacy_server.py`, the v2 root files and every doc in `docs/`.

**Purpose:** the input for a from-scratch redesign. Tick **Keep** on the features to carry forward,
then plan the new architecture and UI around the ticked set.

**Status key**

| Status | Meaning |
|---|---|
| **REAL** | Works end to end with real data, a real algorithm or real hardware |
| **PARTIAL** | Real core, but with significant gaps (e.g. state only in memory, half the paths fake) |
| **SYNTH** | Only canned or demo data, or a synthetic fallback; no real backend wired |
| **STUB** | A placeholder, a docstring, or NotImplementedError |
| **SPEC** | Specified in the docs, but no code exists |
| **v2** | Exists only in the v2 code (`legacy_server.py` / root files), never ported to v3 |

---

## Decisions — feature pick, 2026-11-17

These were chosen through the picker in chat, and this list replaces the Keep checkboxes below.
Anything not listed here is **dropped** from the redesign.

**Modules kept:** Knowledge, Comms, Medical, Navigation, Log, Inventory, Auspice, Recreation,
System and help, Rebuild *(new)*, Intel / Ritual / Archive *(new)*.
**Modules dropped:** Power, Timeline, Signal (SDR), Tracker.

| Area | Keep |
|---|---|
| AI (NPU) | Library chat with citations · Semantic search · Summaries and tagging · AI over LoRa |
| Knowledge | Kiwix ZIM library · Branching chat sessions · Saved articles |
| Comms | Encrypted DMs · Signed boards · Contacts and blocking · Mesh node list · Forward secrecy · Attachments |
| Medical | Triage trees · Triage history · Dose calculator · Full drug database · Drug interactions |
| Navigation | Waypoints · Compass · GPS · Sextant text map · Graphical map (opt-in) · Overlays · SRTM elevation · Line of sight · Routing · Text tiles over mesh |
| Auspice | Sky and planets · Almanac · Natal chart · Tarot · I Ching · Runes · Encrypted journal · Sextant tarot art |
| Recreation | Fortune · Wiki roulette · Chess · Trader · Morse trainer · Survival scenarios · v2 puzzle games |
| System | System info · Users and auth · Settings · Real backups · Themes · Plugins · Easter eggs |
| Mesh and devices | OMP over Meshtastic · Large-message fragmentation · Phone offline app |
| UI | Keyboard-first hotkeys · Command palette · Terminal and CRT look · Sextant graphics default · Status strip always visible |

**Dropped:**
- AI: voice in, voice out, photo understanding
- Games: Bunker adventure, Dragon's Tale
- Inventory: pack optimiser, barcode scan
- Devices: Pi Zero relay, e-paper (the Cardputer field relay is deferred to a later phase, not dropped)
- Power: power telemetry and power-aware AI downgrade
- Timeline: the unified timeline

**Follow-up answers (same day):**
1. **Log:** keep the journal, quick entries, auto-events and markdown export. **Inventory:** keep stock
   tracking, expiry and low-stock alerts, and burn rate. Pack optimiser and barcode scan are dropped.
2. **Power monitoring is dropped entirely.** There is no battery telemetry, and the INA226/shunt
   adapters aren't carried forward. The status strip shows mesh, AI, clock and unread instead.
3. **Phones get touch as a secondary input.** The design stays keyboard-first, but every hotkey
   action must also be tappable.
4. **The field relay is deferred, not dropped.** A custom relay (Cardputer or similar) is a later
   phase. Until it exists, LoRa features (AI over LoRa, mesh comms) are built and tested
   box-to-box or with a laptop and a USB Meshtastic radio (`tools/lora-spike.py` style). The
   OMP-over-Meshtastic design should leave room for the relay as a client.

**Dependencies to plan around:**
- **Fragmentation** comes first on the mesh. AI over LoRa, attachments and text tiles all need it.
- **The OMP fragment-flag clash** in the spec has to be resolved before fragmentation can be built.
- **Kiwix** underpins library chat, semantic search, saved articles and wiki roulette.
- **The NPU inference layer** underpins chat, search, and summaries and tagging.
- **Forward secrecy** needs a matching double-ratchet library on both the JS and Python sides.
- **Users and auth** must exist before multi-user comms, contacts and blocking, or the encrypted journal.
- **Rebuild and Intel / Ritual / Archive** were never built. They need specs (Rebuild has one, REBUILD-SPEC-v2)
  and hand-written content.

---

## 0. The honest summary

- **Plumbing: good.** The OMP codec, the Meshtastic transport, the hardware-adapter pattern
  (ADR-0014), the SQLite migration runner, WebSocket pub/sub, the sextant rasterizer, the chrome
  and palette, and the transport contract with cache classes and outbox are all real and tested.
- **Intelligence: none.** `server/llm/*.py` are 4–6 line stubs. The only working LLM path
  in the whole repo is v2's `/query` (Kiwix + Ollama, on CPU). **Nothing touches the RK3588 NPU.**
- **Mesh: wired to one module.** Only POWER goes through the transport layer. The other modules make
  about 92 raw `fetch()` calls, so mesh mode, caching, offline outbox and "as-of" stamps don't
  reach them. Only 5 of about 120 OMP opcodes have handlers, and fragmentation was never built.
- **Persistence: patchy.** Several modules keep their state in memory only. Comms loses all identities
  on restart, because private keys are never stored. `db.migrate()` is only called by the tests,
  not at server boot.
- **UI: solid foundations, broken input.** Module hotkeys hijack letters typed into text fields,
  there are three different key-handling patterns, HOME is hardcoded, and nothing can be clicked
  or tapped. The PWA's offline mode is broken.
- **Real and worth keeping as-is:** MEDICAL triage trees, INVENTORY, LOG, TIMELINE, the AUSPICE
  astronomy maths, the GPS and POWER hardware adapters, and the text games.

---

## 1. Feature inventory by module

### KNOWLEDGE — offline reference + AI Q&A

| Keep | Feature | Status | Notes |
|---|---|---|---|
| [ ] | AI chat with citations `[N]` | SYNTH (v3) / v2 | v3 matches keywords to 3 canned answers. v2 `/query` does real retrieval: keyword extraction → Kiwix search → Ollama, with streamed replies |
| [ ] | Branching chat sessions (`/branch`, `/cite`, `/forget`) | PARTIAL | Session tree is SQLite, chat sessions are in memory. Replies are not actually streamed in the shell |
| [ ] | Library browse (archives › articles › preview) | SYNTH (v3) / v2 | v3 uses a hardcoded 3-archive corpus. v2 has a real Kiwix ZIM browser with search, random and about 25 ZIM labels |
| [ ] | Kiwix lifecycle (start/status) | v2 | `/api/start-kiwix`, `/api/kiwix-status` |
| [ ] | Embeddings + hybrid search (BM25 + vector, sqlite-vec) | STUB/SPEC | ADR-0011. The `archive_chunk` + FTS5 tables exist but are unused |
| [ ] | Voice in (Whisper) / voice out (Piper) | STUB/SPEC | `server/llm/whisper.py`, `piper.py` are docstrings |

### COMMS — encrypted messaging over mesh

| Keep | Feature | Status | Notes |
|---|---|---|---|
| [ ] | Direct messages (X25519 + HKDF + AES-GCM, Ed25519 signing) | PARTIAL | Crypto is real. **`decrypt()` never verifies the signature.** Everything is in memory; SQLite is written but never read. No mesh delivery: messages are marked "delivered" locally |
| [ ] | Signed boards (5 boards) | PARTIAL | The shell can read them but can't post |
| [ ] | Contact registry | PARTIAL / v2 | v2 had pending/accepted/blocked contacts, silent blocking, and messages that survived restarts |
| [ ] | Mesh node list (`N`) | SYNTH | 3 fake nodes. Duplicated in SIGNAL `M` |
| [ ] | Double-ratchet forward secrecy | STUB | `SyntheticRatchet`; python-doubleratchet parked (ADR-0012) |
| [ ] | Sealed sender, attachments, markdown, multi-hop routing | SPEC | |
| [ ] | Admin PIN + keypair admin | v2 | v3 `auth.py` is a stub, so **no v3 endpoint has auth** |

### MEDICAL — triage + drugs

| Keep | Feature | Status | Notes |
|---|---|---|---|
| [ ] | Triage decision trees (10 trees, 54 nodes) | REAL | `shell/src/data/triage.json`. One question at a time, ending in an outcome card |
| [ ] | Triage run history + step replay | PARTIAL | Runs are kept in memory only |
| [ ] | Dose calculator (drug, weight, age → band) | PARTIAL | Only 5 hardcoded drugs |
| [ ] | Drug search + interactions | PARTIAL | Same 5-drug table. The spec wants a ~40 MB real drug DB |
| [ ] | Photo triage (vision model) | SYNTH | Meant to be Qwen2-VL 2B on the NPU. `OVERSEER_VLM=qwen2vl` raises NotImplementedError |

### NAVIGATION — maps, waypoints, GPS

| Keep | Feature | Status | Notes |
|---|---|---|---|
| [ ] | Waypoints + categories, bearing/distance | REAL | SQLite. The shell uses a fixed position (Sheffield), not GPS |
| [ ] | Compass (nearest 10) | REAL | Same fixed position |
| [ ] | Sextant text map (default) | PARTIAL | Shows only high-ground blobs from a synthetic 120×72 bitmap, with no waypoints or position on it |
| [ ] | Leaflet + MBTiles map (`G`, opt-in) | PARTIAL | Real when `uk.mbtiles` is present. Leaflet loads from a CDN, which breaks offline |
| [ ] | GPS (gpsd / serial NMEA) | REAL | ADR-0014 adapter, falls back to synthetic data. `/api/n/gps/fix` |
| [ ] | Overlays | PARTIAL | List only; no drawing UI |
| [ ] | Line-of-sight / Fresnel, elevation | SYNTH | Elevation is a sine-wave formula. The SRTM option raises NotImplementedError |
| [ ] | Routing | SYNTH | Straight line. GraphHopper/Valhalla raise NotImplementedError |
| [ ] | Text-tile pipeline (tiles drawn as text, pan-delta, hillshade, contours, viewshed, OS grid) | SPEC | docs 06/07. Large (~6 weeks). Opcodes 0x7C–0x7F |
| [ ] | Dead reckoning | SPEC | |

### POWER — energy telemetry

| Keep | Feature | Status | Notes |
|---|---|---|---|
| [ ] | Battery/load telemetry (INA226, shunt ADC) | REAL | ADR-0014 reference adapter |
| [ ] | Host CPU/RAM/temperature | REAL | psutil |
| [ ] | Live push over WebSocket (`power.now`) | REAL | The only WebSocket topic in use |
| [ ] | History sparkline | PARTIAL | In-memory deque; the `power_sample` table is unused |
| [ ] | Radio + storage tiles | SYNTH | Static fakes |
| [ ] | Load forecast + automatic model downgrade (e.g. 14B→7B at 20%) | SPEC | Couples to the NPU/LLM design |

### LOG — journal

| Keep | Feature | Status | Notes |
|---|---|---|---|
| [ ] | Daily journal, quick entry, kinds, tags | REAL | SQLite |
| [ ] | Auto-events from other modules | REAL | |
| [ ] | Filter/search entries | REAL | |
| [ ] | Daily summary + approve | PARTIAL | Rule-based. **Bug:** the LLM path imports a missing `knowledge.llm_chat` and silently falls back |
| [ ] | Markdown export | REAL | Preview only, no download. Duplicated in TIMELINE |
| [ ] | Photo OCR (Tesseract) | PARTIAL | Code path exists, untested |

### INVENTORY — supplies

| Keep | Feature | Status | Notes |
|---|---|---|---|
| [ ] | Categories › items › detail, stock events ("USE 1") | REAL | SQLite, seeds demo data when empty |
| [ ] | Expiring (90 days) / low-stock alerts | REAL | |
| [ ] | Burn rate | REAL | |
| [ ] | Pack optimiser (mission → kg/kcal/medical coverage) | PARTIAL | Greedy algorithm; the "real" one raises NotImplementedError |
| [ ] | UPC lookup / barcode scan | SYNTH | A local `upc.db` path exists, untested. No camera |

### TIMELINE — unified history

| Keep | Feature | Status | Notes |
|---|---|---|---|
| [ ] | Combined feed (1/3/7/M/All), search, "around this time" | PARTIAL | Log, inventory and waypoint feeds work. **Bugs:** the comms feed reads an unused table; the medical feed reads attributes that don't exist. Both are always empty |
| [ ] | Markdown export | REAL | Duplicates LOG's export |

### AUSPICE — sky, almanac, divination, journal

| Keep | Feature | Status | Notes |
|---|---|---|---|
| [ ] | Sky: sun/moon/planets, next 30 days (Meeus maths) | REAL | No ephemeris file needed. Moon shown as an emoji, not sextant |
| [ ] | Almanac / sabbats | REAL | |
| [ ] | Natal chart | REAL | Kept in memory only |
| [ ] | Tarot / I Ching / runes / daily card | REAL | Text rows. Oracle sub-tabs are click-only |
| [ ] | Encrypted journal (PBKDF2 + AES-GCM, PIN) | PARTIAL | Real crypto, kept in memory only |
| [ ] | Deck builder, canonical tarot art in sextant, Vedic charts, themed decks | SPEC | SEXTANT-HANDOFF, AUSPICE Part C |

### SIGNAL — radio / SDR

| Keep | Feature | Status | Notes |
|---|---|---|---|
| [ ] | Weather-satellite passes + decode | SYNTH | Real branches are `pass  # TODO` (Skyfield, decoder) |
| [ ] | ADS-B aircraft | SYNTH | dump1090 TODO |
| [ ] | APRS | SYNTH | direwolf TODO |
| [ ] | Spectrum scan | SYNTH | rtl_power TODO. ASCII bar chart |
| [ ] | Band plan | REAL | Static reference data |
| [ ] | Mesh view | SYNTH | Broken: calls a missing `comms.nodes_list`. Duplicates COMMS `N` |

### RECREATION — morale

| Keep | Feature | Status | Notes |
|---|---|---|---|
| [ ] | Fortune | REAL | |
| [ ] | Wiki roulette | SYNTH | 6 stub articles. Becomes real if Kiwix comes back |
| [ ] | Chess | PARTIAL | No move legality, no engine |
| [ ] | Bunker Adventure (Zork-like) | REAL | State is in memory |
| [ ] | Dragon's Tale RPG | REAL | State is in memory. Player-vs-player over mesh is SPEC |
| [ ] | Trader (TradeWars-lite barter game) | REAL | State is in memory |
| [ ] | Reader progress | PARTIAL | |
| [ ] | v2 client games: Morse trainer, survival scenarios, hangman, codebreaker, number hunt, scramble, tic-tac-toe | v2 | `games/engine.js` + 7 JSON packs. The Morse trainer and survival scenarios are the most on-theme |

### SYSTEM / HELP

| Keep | Feature | Status | Notes |
|---|---|---|---|
| [ ] | System info (`/proc`, statvfs) | REAL | |
| [ ] | Users + settings | REAL | Settings are edited via `prompt()` |
| [ ] | Backups | SYNTH | Seeded rows; "trigger" only flips the status |
| [ ] | Themes, font switcher, snapshot/restore, plugin hot-reload, log tail, shutdown | SPEC | |
| [ ] | Help: hotkeys, commands, about, lore | PARTIAL | Hardcoded. Documents 8 palette commands that don't exist. "About" is stale |
| [ ] | Easter eggs (`:matrix`, Konami, cowsay) | SPEC | |

### TRACKER — "send the score" music over mesh (Sprint 24)

| Keep | Feature | Status | Notes |
|---|---|---|---|
| [ ] | AudioWorklet 303-voice latency bench | REAL (sw) | `/v3/bench-24a.html`. The device test hasn't been run |
| [ ] | Brotli TOML songs (~1.7 KB/track) + sample-pack protocol | SPEC | 24b |
| [ ] | Engine port from `c:\source\tracker`, the `J` module, visualiser | SPEC | 24c–f |

### Never built (catalogue modules)

| Keep | Feature | Status | Notes |
|---|---|---|---|
| [ ] | REBUILD (ATLAS, TREE, POINTERS, SUBSTITUTE, PROJECTS) | SPEC | REBUILD-SPEC-v2, ~2 weeks plus hand-written content. Rule: the LLM points to sources, it doesn't author |
| [ ] | INTEL, RITUAL, ARCHIVE | SPEC | Optional modules in 02-MODULE-CATALOG |

---

## 2. Cross-cutting infrastructure

| Keep | Component | Status | Notes |
|---|---|---|---|
| [ ] | OMP codec (4-byte header + MessagePack, Brotli in v0x02) | REAL | Tested. The shared Brotli dictionary is unused on the wire |
| [ ] | OMP opcode table + handlers | STUB | 5 of about 120 handled. **Spec bug:** the fragment flag clashes with the opcode high bit |
| [ ] | OMP fragmentation / retransmit | STUB | Raises NotImplementedError. v2's `lora_protocol.py` had working chunking, reassembly and ACKs |
| [ ] | OMP over Meshtastic `PRIVATE_APP` (ADR-0016) | REAL (sw) | Shares the HTTP `/omp` dispatcher. The on-air test with real radios is still pending |
| [ ] | `tools/lora-spike.py` bench | REAL | 23b runbook |
| [ ] | v2 LoRa text bot (`/ask`, `/search`, `/read`, 220-byte chunked replies) | v2 | `lora_bridge.py`. The only thing that has ever answered AI questions over LoRa |
| [ ] | v2 Pi Zero relay (phone UI, queue, reassembly, cache) | v2 | `relay/`. Superseded on paper by the Cardputer firmware |
| [ ] | Cardputer field-relay firmware (SoftAP, HTTP→OMP, shell served from flash, outbox) | SPEC | 23c–e, no code. The docs disagree on flash size |
| [ ] | Hardware selector `hw.py` + `/api/hw` synthetic flags | REAL | SIGNAL bypasses it |
| [ ] | SQLite + migration runner (15 migrations) | PARTIAL | Not run at boot. About 17 tables are never written |
| [ ] | WebSocket topic pub/sub | REAL | Only `power.now` uses it |
| [ ] | Auth | STUB | All `/api/*` routes are open |
| [ ] | Plugin loader | STUB | Opcodes 0xF0–0xFF reserved |
| [ ] | systemd unit (OPi5) | REAL | `deploy/systemd/overseer.service` |
| [ ] | Shell transport (HTTP + OMP, cache classes, stale-while-revalidate, IndexedDB outbox) | PARTIAL | Well built, but only POWER uses it |
| [ ] | State store | PARTIAL | Status strip is static. `dispatch` is never called |
| [ ] | Command palette (fuzzy) | REAL | 14 commands. `goto.help` is broken; there is no `goto.auspice` |
| [ ] | Chrome: status strip, breadcrumb, hotkey bar | PARTIAL | Breadcrumb only goes 2 levels. The hotkey bar never changes per screen |
| [ ] | Theme tokens, CRT mode, phone/tablet/desktop modes | REAL | Some modules use undefined variables |
| [ ] | PWA / service worker / manifest | STUB | Precaches the wrong paths for `/v3/`. `start_url` is `/` |
| [ ] | Sextant rasterizer + 5 binarisers | REAL | Only the NAVIGATION map uses it; the binarisers are unused |

---

## 3. Known bugs (fix if v3 lives on; design out if rebuilding)

1. **Hotkeys hijack text input.** The router never checks focus. Typing `c` in the KNOWLEDGE chat jumps to
   COMMS. Lowercase sub-keys fall through to top-level routing, so `l` in KNOWLEDGE opens LOG.
2. Three different key-handling patterns across modules. SIGNAL, RECREATION, SYSTEM and HELP sub-keys
   depend on which element has focus.
3. No click or tap navigation. On a phone, HOME is a dead end.
4. `log.py` imports the missing `knowledge.llm_chat`, so the LLM summary never runs.
5. TIMELINE's comms and medical feeds are always empty.
6. SIGNAL `/mesh` calls the missing `comms.nodes_list`.
7. Comms `decrypt()` skips Ed25519 signature verification.
8. `db.migrate()` is never called at runtime.
9. Service worker and manifest are wrong for `/v3/`. Fonts and Leaflet come from CDNs, which breaks offline.
10. Bundle is over budget: 147 KB JS / 55 KB CSS. msgpackr (~78 KB of source) should be lazy-loaded for mesh mode only.
11. Leaflet popups interpolate waypoint names as raw HTML (XSS).
12. Stale tracked build artefacts (`main.js.gz`, `*.old`) despite the gitignore.

---

## 4. Lessons to design around

1. **Build the core premise first.** LoRa TX didn't exist until Sprint 23. The mesh, the AI and the
   hardware were planned last and stayed fake. Next time, the first milestone should be a thin
   vertical slice through the hard parts: NPU inference → retrieval → OMP → LoRa → a field device.
2. **"Fake first" became "fake forever".** Synthetic fallbacks are good for CI, but every
   fake needs a dated owner and a deadline for the real version.
3. **Use one data path for every feature.** Only one module used the transport layer, so mesh mode
   was effectively never real. In the redesign, modules should be unable to call `fetch` directly.
4. **Guard key defaults with tests that can't be quietly edited.** Sprint 21 flipped the map to Leaflet
   and changed the smoke test to match.
5. **Input handling is a core design decision, not a per-module detail.** Settle the keyboard model
   (with text fields), touch and phone use before building any modules.
6. **Offline-first must be literal.** No CDNs, and the font is embedded.
7. **Adopt existing tools where they exist.** Meshtastic beat a custom mesh stack, and python-doubleratchet
   beat a hand-rolled ratchet. Expect the same for the NPU (RKLLM/RKNN) over anything hand-built.
8. **The LLM retrieves and points; it doesn't write authoritative content.** REBUILD and AUSPICE both
   settled on this.
9. **Docs drift.** Keep a single, generated status source, not a hand-edited 1100-line STATUS.md.

---

## 5. AI on the board — Orange Pi 5 Max (RK3588 NPU)

**Hardware (per the v3 docs):** Orange Pi 5 Max, 16 GB LPDDR5, full RK3588, 512 GB NVMe, Armbian. The
NPU has 3 cores and 6 TOPS INT8. The docs give power as about 2 W idle and 8–12 W during inference.

**What v3 assumed:**
- Qwen2.5 7B Q4_K_M as the main LLM (with 14B as an upgrade), running on the CPU via Ollama or
  Llamafile, at a claimed 8–15 tokens/s.
- Only two models on the NPU: Qwen2-VL 2B for photo triage, and nomic-embed v1.5 for embeddings.
- Whisper tiny (speech-to-text) and Piper (text-to-speech).
- **None of it is implemented**, and no NPU toolchain is referenced anywhere.

**What changes for the redesign:**
- Ollama and llama.cpp run on the CPU and don't use the NPU. Using the NPU means Rockchip's own stack:
  **RKLLM** (runtime + toolkit) for LLMs, and **RKNN / rknn-toolkit2** for vision, embedding and
  speech models. Models are converted and quantised off-board (on an x86 machine) into
  `.rkllm` / `.rknn` files, then loaded on the board. This needs Rockchip's NPU kernel driver on the
  board image.
- The inference layer therefore needs its own abstraction from day one, e.g. a `chat`,
  `embed`, `transcribe`, `see` and `speak` interface with an NPU backend, a CPU fallback and a synthetic
  backend for CI.
- Questions to answer in planning (benchmark on the board, don't assume):
  - Which LLM sizes RKLLM runs well in 16 GB, at what tokens/s and wattage?
  - Can one LLM plus embedding, Whisper and vision models share the NPU, or must they take turns?
  - Is NPU Whisper worth it over CPU whisper.cpp at the tiny/base size?
  - What does the power-aware model downgrade look like with NPU models?
  - Board OS image: vendor kernel (has the NPU driver) or mainline (doesn't, as of the last check)?

---

## 6. Suggested planning sequence (next session)

1. Go through this file and tick **Keep**. Note anything new you want that isn't listed.
2. Confirm the board and OS image, then run a short **NPU spike**: RKLLM with one small chat model,
   and one RKNN embedding model. Measure tokens/s, memory and watts. This fixes the AI budget
   before anything else is designed.
3. Decide the core architecture (the one data path, the inference layer, storage, auth) and write
   ADRs before code.
4. Design the new UI (input model, phone/touch, layout, sextant-first graphics), mocked up first.
5. Plan milestones as vertical slices, with the radio + AI slice first.
