# 02 — MODULE CATALOG

> Each module spec'd here is a build target. Specs include: purpose, screens, hotkeys, data model, API endpoints (which mirror OMP opcodes — see `05-OMP-PROTOCOL.md`).
>
> **Hotkey notation:** `(K)` = press key K. `[Tab]` = navigation. `:cmd` = palette command.

---

## Eleven primary modules + three optional

| Key | Module | Status |
|---|---|---|
| K | Knowledge | Refined from v2 |
| C | Comms | Refined + extended |
| M | Medical | Refined (wizard reflow) |
| N | Navigation | Refined |
| P | Power | Refined (btop dashboard) |
| L | Log | **NEW** |
| I | Inventory | **NEW** |
| R | Recreation | **NEW** (fulfils v2's TODO) |
| S | Signal | **NEW** |
| T | Timeline | **NEW** |
| X | System | Refined (admin) |
| ? | Help & Xtras | **NEW** |
| U | AUSPICE | **NEW** (Sprints 12-13) |
| (optional) | Intel | **NEW** later |
| (optional) | Ritual | **NEW** later |
| (optional) | Archive | **NEW** later |

---

## (K) KNOWLEDGE

**Purpose:** LLM chat with RAG + browsable offline knowledge base. The flagship module.

### Sub-screens

```
KNOWLEDGE
├── (C) CHAT          MUD-style scrolling log + RAG
├── (L) LIBRARY       Miller columns: archive › article › preview
├── (S) SAVED         Pinned conversations + favourite articles
└── (B) BRANCHES      Conversation tree (visual git-graph style)
```

### Chat sub-screen

Hotkeys: `(N)ew (C)lear (E)xport (V)oice  /commands  [↑] history  [Tab] toggle KB-aug

Slash commands inside chat input:
- `/cite` — show sources of last LLM response
- `/forget` — reset conversation context
- `/save <name>` — pin this conversation
- `/branch` — fork the current conversation
- `/voice` — toggle whisper.cpp input
- `/speak` — toggle piper TTS output for responses
- `/model <name>` — switch loaded model

### Library sub-screen (Miller columns)

```
┌─ ARCHIVES ─────┬─ ARTICLES ──────────────┬─ PREVIEW ──────────┐
│ > Wikipedia    │ > Water purification    │ ## Water           │
│   WikiMed      │   Water-borne diseases  │ ## purification    │
│   WikEM        │   Iodine treatment      │                    │
│   iFixit       │   Boiling temperature   │ Methods to make    │
│   Appropedia   │   Filter media          │ water safe...      │
│   Energypedia  │   ...                   │                    │
│   ...          │                         │                    │
└────────────────┴─────────────────────────┴────────────────────┘
```

`/` opens fuzzy search across all archives. `Enter` on article opens reader (full pane). Bookmark with `B`. Backlinks panel with `L`.

### NEW v3 features

- **Background embeddings index.** On first boot, chunks every ZIM into a sqlite-vss vector store. Hybrid retrieval (BM25 + vector cosine) for `/cite` and RAG.
- **Whisper.cpp voice input.** Tiny model (~40MB), runs in real-time. Press Space-hold to record.
- **Piper TTS output.** Critical responses (medical) read aloud option.
- **Conversation branching.** Each LLM turn can fork. Tree visible in Branches sub-screen.
- **Inline citations.** `[1]` in responses are tappable; jump to Library at the cited paragraph.

### Data model

```sql
CREATE TABLE chat_session (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES chat_session(id),  -- branching
  user_id INTEGER REFERENCES user(id),
  name TEXT,
  pinned BOOLEAN DEFAULT 0,
  created_at INTEGER,
  last_at INTEGER
);

CREATE TABLE chat_turn (
  id INTEGER PRIMARY KEY,
  session_id INTEGER REFERENCES chat_session(id),
  role TEXT CHECK(role IN ('user','overseer','system')),
  content TEXT,
  citations JSON,              -- [{archive, article, paragraph, score}]
  rag_used BOOLEAN,
  created_at INTEGER
);

CREATE TABLE archive_chunk (
  id INTEGER PRIMARY KEY,
  archive TEXT,
  article_title TEXT,
  paragraph_idx INTEGER,
  text TEXT,
  embedding BLOB           -- 384-dim float32, 1536 bytes
);
CREATE VIRTUAL TABLE archive_fts USING fts5(article_title, text, content=archive_chunk);
CREATE VIRTUAL TABLE archive_vss USING vss0(embedding(384));
```

### API endpoints

```
POST   /api/k/query              { q, session_id?, kb_aug? } → SSE stream
GET    /api/k/sessions           list
GET    /api/k/session/:id        full session
POST   /api/k/session            new
POST   /api/k/session/:id/branch fork at last turn
GET    /api/k/library/archives   list mounted ZIMs
GET    /api/k/library/search     ?q=… → fuzzy + vector hybrid
GET    /api/k/library/article    ?archive=…&id=… → full article
GET    /api/k/library/cite       ?archive=…&id=…&para=… → paragraph context
```

---

## (C) COMMS

**Purpose:** Encrypted store-and-forward messaging + boards + mesh status. Replaces v2's basic comms.

### Sub-screens

```
COMMS (lazygit three-pane)
├── Pane 1: Folders + Boards + Net
├── Pane 2: Message list (active folder/board)
└── Pane 3: Message detail or compose
```

See visual reference for exact layout.

### Hotkeys

`(N)ew (R)eply (F)wd (D)el (A)rch (M)ark-read [Tab] panes /search`

### Folders

INBOX, SENT, DRAFTS, ARCHIVE, OUTBOX (pending mesh delivery).

### Boards

Public, threaded, signed message boards. Default boards: `/general /intel /trade /swap /sos`. Operators can create new boards subject to admin approval.

### NEW v3 features

- **Real E2E encryption.** Signal-style double ratchet using existing keypairs. Audit v2 implementation — likely a stub. Replace with `libsodium` + custom ratchet implementation.
- **Mesh routing.** Messages that can't reach the recipient directly hop through any Overseer/Cardputer node. Each hop signs the envelope.
- **Optimistic send.** Message appears in SENT immediately with `⟳ pending` flag. Flips to `✓ delivered` on ack.
- **Boards.** Public threaded message boards. FidoNet-style.
- **Net pane.** Live mesh node list with signal strength, distance estimate, transport (WiFi/LoRa/serial), last-seen.
- **Attachments.** Compressed images (waypoint photos), small files, voice notes (opus-encoded).
- **Markdown rendering** in message body (tables, code blocks, ASCII maps embedded).

### Data model

Keep v2's `users`, `messages`, `contacts`, `blocks` tables. Add:

```sql
ALTER TABLE messages ADD COLUMN board TEXT;          -- null = direct mail
ALTER TABLE messages ADD COLUMN parent_id INTEGER;   -- threading
ALTER TABLE messages ADD COLUMN delivery_state TEXT
  CHECK(delivery_state IN ('pending','sent','delivered','failed','read'));
ALTER TABLE messages ADD COLUMN signature BLOB;
ALTER TABLE messages ADD COLUMN ratchet_state BLOB;

CREATE TABLE mesh_node (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  callsign TEXT,
  transport TEXT CHECK(transport IN ('wifi','lora','serial','direct')),
  last_seen_at INTEGER,
  rssi INTEGER,
  est_distance_m INTEGER
);

CREATE TABLE attachment (
  id INTEGER PRIMARY KEY,
  message_id INTEGER REFERENCES messages(id),
  mime TEXT,
  size INTEGER,
  blob BLOB,
  thumb BLOB
);
```

### API endpoints

```
GET    /api/c/folders                     folder counts
GET    /api/c/inbox?since=…               headers since timestamp
GET    /api/c/message/:id                 full message
POST   /api/c/send                        { to, subj, body, attach } → optimistic
POST   /api/c/board/:name                 post to board
GET    /api/c/board/:name?since=…         board posts
GET    /api/c/contacts                    contacts list
POST   /api/c/contacts/accept             { user_id }
POST   /api/c/contacts/block              { user_id }
GET    /api/c/net                         mesh node list
POST   /api/c/net/scan                    trigger rescan
```

---

## (M) MEDICAL

**Purpose:** Field medical reference + guided triage. Mostly works offline — no LLM required.

### Sub-screens

```
MEDICAL
├── (T) TRIAGE         Wizard-flow decision trees (10 categories)
├── (R) REFERENCE      Searchable WikiMed/WikEM articles
├── (D) DOSE           Drug calculator + interaction checker
├── (P) PHOTO          Camera-assisted assessment (NEW)
└── (H) HISTORY        Past triage runs (auto-logged)
```

### Triage wizard (refactored from v2 trees)

V2 has 10 triage categories with ~1000 LOC of decision tree JS. Keep the data, change the rendering.

Each category becomes a sequence of question-cards:

```
TRIAGE > BURNS > Q2 of 5

  How much body surface is burned?

   (A) Less than palm-size           → minor, treat at scene
   (B) Palm to one limb              → moderate, monitor closely
   (C) More than one limb            → major, evacuate priority
   (D) Critical areas (face/hands/   → major, evacuate priority
       feet/groin/major joints)

  [j/k] prev/next   [b] back   [q] abort   [n] note

  > _
```

Every wizard step writes a `triage_step` row so the run is fully replayable as a chain-of-care record.

### NEW: photo-assisted triage

Phone camera capture → on-device Qwen2-VL 2B (runs on RK3588 NPU) → returns structured assessment of:

- Wound: clean / contaminated / signs of infection
- Burn: estimated %BSA, depth indicator
- Skin: rash patterns, jaundice, cyanosis
- Pupils: dilated / constricted / unequal

Output is *advisory*. Always paired with the standard triage flow, never replaces it.

### NEW: dose calculator

```
DOSE > Paracetamol

  Patient weight:  ___ kg
  Patient age:     ___
  Route:           (P)O / (I)V / (R)ectal
  Indication:      (P)ain / (F)ever

  Result: 15 mg/kg PO q4-6h, max 60 mg/kg/day
          For 22kg child: 330mg per dose, max 1320mg/day

  Interactions found:
    ⚠ With ibuprofen — combine carefully, alternate q4h
    ⚠ With alcohol  — hepatotoxicity risk

  Press (S)ave to log this calculation.
```

Backed by an offline drug database (a curated subset of FDA orange book + RxNorm interactions, ~40MB).

### Hotkeys

Triage list: `(T)riage (R)ef (D)ose (P)hoto (H)istory`
Triage flow: `j/k prev/next  b back  q abort  n note  s save-step`
Reference: `/search ↑↓ navigate Enter open  B bookmark`

### Data model

```sql
CREATE TABLE triage_run (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  category TEXT,
  patient_ref TEXT,         -- free text "John Doe" or "self"
  started_at INTEGER,
  ended_at INTEGER,
  outcome TEXT,
  notes TEXT
);

CREATE TABLE triage_step (
  id INTEGER PRIMARY KEY,
  run_id INTEGER REFERENCES triage_run(id),
  step_idx INTEGER,
  question TEXT,
  answer TEXT,
  branch_taken TEXT,
  notes TEXT,
  at INTEGER
);

CREATE TABLE dose_calc (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  drug TEXT,
  patient_weight_kg REAL,
  patient_age REAL,
  route TEXT,
  indication TEXT,
  result_text TEXT,
  warnings_json JSON,
  at INTEGER
);

CREATE TABLE drug (
  id INTEGER PRIMARY KEY,
  name TEXT,
  generic TEXT,
  class TEXT,
  doses_json JSON,
  warnings_json JSON,
  interactions_json JSON
);
```

### API endpoints

```
GET    /api/m/triage/categories
GET    /api/m/triage/tree/:category
POST   /api/m/triage/run                  start
POST   /api/m/triage/step                 commit step
GET    /api/m/triage/runs                 history
POST   /api/m/dose                        calc + interactions
GET    /api/m/drug/:name                  drug detail
POST   /api/m/photo                       multipart camera capture, returns VLM JSON
```

---

## (N) NAVIGATION

**Purpose:** Waypoints, routing, offline maps, distance/bearing math.

### Sub-screens

```
NAVIGATION
├── (W) WAYPOINTS    Two-pane MC-style: list ↔ detail/mini-map
├── (R) ROUTE        From/To picker, calculate route
├── (M) MAP          Full-screen Leaflet (kept from v2)
├── (C) COMPASS      Text-only "where am I" — bearing/distance to nearest WPs
└── (G) GPS          Current position, accuracy, satellites
```

### Waypoints sub-screen (MC-style)

```
┌─ WAYPOINTS ────────────────┬─ DETAIL ────────────────────────────┐
│ > CACHE-7      cache       │ CACHE-7                             │
│   SPRING-N     water       │ Cache · Buried supply drop          │
│   RV-ALPHA     rally       │                                     │
│   MEDIC-1      medical     │ Lat:   54.5012° N                   │
│   FUEL-DEPOT   cache       │ Lon:    -2.0319° W                  │
│   HAZARD-W     hazard      │ Elev:  287m                         │
│   CAMP-TWIN    camp        │ Added: D+312                        │
│   LOOKOUT-N    general     │                                     │
│                            │ Notes: Buried 30cm under flat       │
│                            │ stone, NW of split oak. Contains    │
│ F2:NEW F5:COPY F6:ROUTE    │ 14d rations, 2L water, IFAK.        │
│ F7:EXPORT F8:DEL F10:QUIT  │ Last verified: D+401                │
└────────────────────────────┴─────────────────────────────────────┘
```

### NEW v3 features

- **Offline routing.** Pre-built GraphHopper or Valhalla tiles for the operating area. Pedestrian / driving / cycling routes, not just bearing.
- **Elevation profiles.** SRTM1 data (~15GB for continents) on NVMe. Show profile along any route.
- **Line-of-sight calc.** Given two waypoints, compute whether they have radio line of sight (Fresnel zone) — useful for LoRa antenna planning.
- **Dead reckoning** when GPS drops, using phone IMU (accelerometer + magnetometer).
- **Drawing mode.** Sketch zones, no-go regions, patrol routes on the map. Saved as overlays.
- **Compass screen.** Pure text view: nearest 5 waypoints with bearing/distance, no map redraw needed. Useful when bandwidth or battery limited.

### Data model

Keep v2's `waypoints`. Add:

```sql
ALTER TABLE waypoints ADD COLUMN elev REAL;
ALTER TABLE waypoints ADD COLUMN last_verified_at INTEGER;
ALTER TABLE waypoints ADD COLUMN photo_blob BLOB;

CREATE TABLE map_overlay (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  name TEXT,
  kind TEXT CHECK(kind IN ('zone','route','line','marker')),
  geo_json TEXT,         -- GeoJSON
  color TEXT,
  notes TEXT,
  created_at INTEGER
);

CREATE TABLE route_cache (
  id INTEGER PRIMARY KEY,
  from_lat REAL, from_lon REAL,
  to_lat REAL, to_lon REAL,
  mode TEXT CHECK(mode IN ('walk','drive','bike')),
  geometry_geo_json TEXT,
  distance_m REAL,
  duration_s REAL,
  created_at INTEGER
);
```

### API endpoints

```
GET    /api/n/waypoints
POST   /api/n/waypoint
DELETE /api/n/waypoint/:id
PUT    /api/n/waypoint/:id
POST   /api/n/route                 { from, to, mode } → geometry
GET    /api/n/elevation             ?lat=…&lon=… or ?route_id=…
POST   /api/n/los                   { from, to } → bool + fresnel
GET    /api/n/overlays
POST   /api/n/overlay
GET    /tiles/:z/:x/:y.png          unchanged from v2
```

---

## (P) POWER

**Purpose:** Battery, load, radio, storage at a glance. Real-time.

### Layout (btop dashboard)

```
┌─ BATTERY ─────────────┬─ LOAD ─────────────────┐
│ 82% · 14d 02h         │ CPU 7%   RAM 61%       │
│ ▰▰▰▰▰▰▰▰▱▱            │ ▁▂▂▃▄▄▅▅▆▇█▇▆▅▄▃▂▁     │
│ Draw 4.2W avg         │ 47°C  fan 2100rpm      │
├─ RADIO ───────────────┼─ STORAGE ──────────────┤
│ WiFi -42dB 6 clients  │ 412/512 GB · 80% used  │
│ LoRa 868MHz listening │ Archives 142GB         │
│ SDR idle              │ Models 14GB            │
│ ⠀⠀⠂⠆⠦⡾⢿⣿⣷⣶⣦⣄⣀         │ SMART healthy          │
└───────────────────────┴────────────────────────┘
```

### NEW v3 features

- **Load forecasting.** Linear regression on recent draw → "depleted in 14d 02h". Updated every 5 min.
- **Graceful degradation suggestions.** At 20% battery: "Suggest unloading 14B → 7B model? (saves 1.2W)". At 10%: auto-applies.
- **Hardware fault detection.** SMART monitoring, fan RPM anomalies, WiFi retry rates. Orange pip on offending tile.
- **Spectrum waterfall.** SDR scrolling display when LoRa or RTL-SDR active.
- **Per-process power attribution** (rough estimate from CPU time × TDP curve).

### Data model

```sql
CREATE TABLE power_sample (
  at INTEGER PRIMARY KEY,
  battery_pct REAL,
  draw_w REAL,
  charge_w REAL,
  cpu_pct REAL,
  ram_pct REAL,
  cpu_temp_c REAL,
  fan_rpm INTEGER
);
-- Insert every 30s, retain 30d at 30s, then downsample to 5min for 1y
```

### API endpoints

```
GET    /api/p/now                 current snapshot
GET    /api/p/history?range=24h   sparkline data
GET    /api/p/forecast            estimated runtime
POST   /api/p/degrade/auto        toggle graceful degradation
GET    /api/p/radio               WiFi/LoRa/SDR/BT statuses
GET    /api/p/storage             disk usage breakdown
GET    /api/p/health              SMART, fan, anomalies
```

---

## (L) LOG **NEW**

**Purpose:** Daily journal + system event timeline. The single most-requested feature for any prepper system, missing from v2.

### Sub-screens

```
LOG
├── (T) TODAY        Today's entries, ready to write
├── (E) ENTRIES      Browse/search past entries
├── (S) SUMMARY      LLM-generated daily debrief (auto-prepared at 22:00)
└── (X) EXPORT       Markdown export of date range
```

### Today sub-screen

```
LOG > TODAY · D+417 · 25 April

  09:14  observation  Fresh tracks N of cache-7. Two-toed,
                      probably deer. Old track, 2-3 days.
  11:02  ration       Breakfast: oats + honey. ~400 kcal.
  14:30  patrol       N perimeter. Nominal. No new signs.
  16:18  incident     Solar inverter beeped fault for 3min,
                      cleared on its own. Watching.
  21:40  decision     Going to skip rotation tomorrow,
                      weather front incoming. Stay put.

  > _new entry_
```

### Entry types

`observation` (default) · `decision` · `patrol` · `ration` · `incident` · `triage` (auto from MEDICAL) · `comms` (auto) · `system` (auto power events) · `note`

Each entry can attach: photo, GPS coords (auto if available), weather snapshot (auto from SIGNAL), mood/energy 1-5 self-rating (optional).

### NEW v3 features

- **Auto-events.** Comms received, triage performed, waypoint added, battery alerts — all auto-log into the same stream as typed entries. Single timeline.
- **Daily LLM summary.** At 22:00 the LLM reads today's entries and prepares a 5-line debrief. User reviews and approves on next visit.
- **Photo OCR.** Phone camera → log entry with photo → tesseract or VLM extracts text → searchable.
- **Tag inference.** LLM auto-tags entries when typed.

### Data model

```sql
CREATE TABLE log_entry (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  kind TEXT,
  body TEXT,
  tags JSON,
  lat REAL, lon REAL,
  weather_json JSON,
  mood INTEGER, energy INTEGER,
  photo_blob BLOB,
  source TEXT CHECK(source IN ('user','auto','imported')),
  ref_table TEXT, ref_id INTEGER,   -- for auto entries
  at INTEGER
);
CREATE VIRTUAL TABLE log_fts USING fts5(body, tags, content=log_entry);

CREATE TABLE daily_summary (
  date TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  summary_text TEXT,
  approved_at INTEGER
);
```

### API endpoints

```
GET    /api/l/today
GET    /api/l/entries?range=…&kind=…&q=…
POST   /api/l/entry
PUT    /api/l/entry/:id
DELETE /api/l/entry/:id
GET    /api/l/summary/:date
POST   /api/l/summary/:date/approve
GET    /api/l/export?from=…&to=…&fmt=md
```

---

## (I) INVENTORY **NEW**

**Purpose:** Track kit, food, water, ammo, meds, fuel. Predict depletion. Alert on expiry.

### Sub-screens

```
INVENTORY
├── (B) BROWSE        Three-pane: Categories › Items › Detail
├── (S) SCAN          Camera barcode → auto-add
├── (E) EXPIRING      Items expiring in next 90d, sorted
├── (L) LOW           Items below threshold
├── (P) PACK          Loadout optimizer for mission types
└── (R) RATE          Burn-rate analytics
```

### Browse sub-screen

```
┌─ CATEGORIES ─┬─ ITEMS ──────────────┬─ DETAIL ─────────────┐
│ > Bug-out    │ > IFAK            x1 │ IFAK                 │
│   Medical    │   CAT tourniquet  x2 │ Individual First     │
│   Food       │   Israeli bandage x4 │ Aid Kit              │
│   Water      │   Chest seals     x2 │                      │
│   Tools      │   NPA airway      x1 │ Loc:  Pack/front     │
│   Comms      │   Decomp needle   x1 │ Exp:  2028-04 ⚠ 12mo │
│   Ammo       │                      │ Qty:  1              │
│   Fuel       │                      │ Note: Field-checked  │
│              │                      │       D+401          │
└──────────────┴──────────────────────┴──────────────────────┘
```

### Pack optimizer

Given a mission type (`48h patrol`, `14d bug-out`, `winter overnight`), suggest a pack hitting weight/calorie/water/medical targets from current inventory. Output: list of items, total weight, total kcal, water mL, medical coverage rating.

### NEW v3 features

- **Barcode scan** via phone camera + offline UPC database (~1GB curated set).
- **Burn-rate tracking.** Mark a ration eaten → system updates consumption stats → projects depletion.
- **Expiry rotation.** "Beans expire in 45d, suggest rotating into next 7 meals."
- **Mission templates.** Pack loadouts saved as templates.
- **Photo per item** (helps identification when stressed).

### Data model

```sql
CREATE TABLE inv_category (
  id INTEGER PRIMARY KEY,
  name TEXT,
  parent_id INTEGER REFERENCES inv_category(id)
);

CREATE TABLE inv_item (
  id INTEGER PRIMARY KEY,
  category_id INTEGER REFERENCES inv_category(id),
  name TEXT,
  upc TEXT,
  location TEXT,
  qty REAL,
  unit TEXT,
  weight_g REAL,
  kcal REAL,
  water_ml REAL,
  expires_at INTEGER,
  acquired_at INTEGER,
  threshold_qty REAL,
  notes TEXT,
  photo_blob BLOB
);

CREATE TABLE inv_event (
  id INTEGER PRIMARY KEY,
  item_id INTEGER REFERENCES inv_item(id),
  delta REAL,
  reason TEXT,
  at INTEGER
);

CREATE TABLE pack_template (
  id INTEGER PRIMARY KEY,
  name TEXT,
  spec_json JSON
);
```

### API endpoints

```
GET    /api/i/categories
GET    /api/i/items?category=…
POST   /api/i/item
PUT    /api/i/item/:id
POST   /api/i/event             { item_id, delta, reason }
GET    /api/i/expiring?within=90d
GET    /api/i/low
POST   /api/i/scan              UPC lookup
POST   /api/i/pack/optimize     { mission, weight_max, days }
GET    /api/i/burn?item_id=…
```

---

## (R) RECREATION **NEW** — fulfils v2's TODO

**Purpose:** BBS doors reborn. Games, fortune, fiction. Morale and operator engagement.

### Catalog

```
RECREATION
├── (D) DRAGON'S TALE       LORD-style RPG, plays via comms across mesh
├── (T) TRADER              TradeWars-lite, single-player markets
├── (Z) ZORK-LIKE           Bundled small adventure (load Inform/z5)
├── (C) CHESS               Plain-text board, bundled engine
├── (G) GO                  9×9 or 19×19, GnuGo bundled
├── (W) WIKI ROULETTE       Random article from any mounted ZIM
├── (F) FORTUNE             BSD fortune-style quotes
└── (R) READER              Browse Project Gutenberg ZIMs as books
```

### Dragon's Tale (the big one)

A LORD homage with cross-operator gameplay over the mesh. Persistent state. One battle per real day. Town › Forest › Inn › Dragon Palace. Operators can attack each other in the forest.

In-game flirt/marriage system uses the existing comms backend — flirts are special-flagged direct messages.

State syncs over OMP when nodes see each other; CRDTs handle conflicting same-day actions.

This is not a small build — schedule it as its own sprint after the foundation lands.

### Reader

The library is for searching. The reader is for *reading* — long-form. Curl up with Marcus Aurelius. Page navigation, bookmarks, font controls.

### Data model

```sql
CREATE TABLE game_state (
  game TEXT,
  user_id INTEGER REFERENCES users(id),
  state_json JSON,
  updated_at INTEGER,
  PRIMARY KEY (game, user_id)
);

CREATE TABLE game_event (
  id INTEGER PRIMARY KEY,
  game TEXT,
  user_id INTEGER REFERENCES users(id),
  ev_type TEXT,
  ev_data_json JSON,
  at INTEGER
);

CREATE TABLE reading_progress (
  user_id INTEGER,
  archive TEXT,
  article_id TEXT,
  position REAL,           -- 0..1
  bookmark_text TEXT,
  updated_at INTEGER,
  PRIMARY KEY (user_id, archive, article_id)
);
```

### API endpoints

```
GET    /api/r/games
GET    /api/r/dragon/state          your state
POST   /api/r/dragon/action         { action, target? }
GET    /api/r/dragon/town           shared state
GET    /api/r/fortune               random quote
GET    /api/r/wiki/random
GET    /api/r/reader/progress
POST   /api/r/reader/progress
```

---

## (S) SIGNAL **NEW**

**Purpose:** SDR + LoRa + comms scanning. Cyberpunk slot of the system.

### Sub-screens

```
SIGNAL
├── (W) WEATHER       NOAA satellite passes + image decode
├── (A) AIR           ADS-B aircraft within range
├── (P) APRS          APRS packet feed + weather stations
├── (M) MESH          LoRa mesh node detail (extends Comms net pane)
├── (S) SCAN          Spectrum analyzer across configured bands
└── (T) TRANSMIT      (admin only, TX requires licensing)
```

### Hotkeys

`(W)eather (A)ir (P)aprs (M)esh (S)can`

### Hardware required

- RTL-SDR USB dongle (£20, future purchase per v2 notes)
- LoRa hat (Cap LoRa-1262 on Cardputer, or USB LoRa for OPi5)

### Spectrum waterfall

Block-character scrolling display. Time on Y, frequency on X, intensity on character density (`⠀⠂⠆⠦⠶⠾⡾⢿⣿`). 80×40 grid → at SF12 LoRa bandwidth that's ~5-min history. Beautiful.

### Data model

```sql
CREATE TABLE sig_capture (
  id INTEGER PRIMARY KEY,
  kind TEXT,          -- 'noaa','adsb','aprs','lora','generic'
  freq_hz INTEGER,
  metadata_json JSON,
  blob_path TEXT,     -- WAV/PNG on disk, blob in DB if small
  at INTEGER
);

CREATE TABLE adsb_track (
  icao TEXT,
  callsign TEXT,
  lat REAL, lon REAL,
  alt_m REAL,
  speed_kt REAL,
  heading REAL,
  at INTEGER,
  PRIMARY KEY (icao, at)
);
```

### API endpoints

```
GET    /api/s/weather/passes        NOAA satellite TLE-based predictions
POST   /api/s/weather/decode        capture next pass → APT image
GET    /api/s/air                   recent ADS-B tracks
GET    /api/s/aprs                  APRS feed
GET    /api/s/scan?band=…           spectrum data
GET    /api/s/captures              listing
```

---

## (T) TIMELINE **NEW**

**Purpose:** Unified chronological view of *everything*. Comms, log entries, triage events, waypoints added, system alerts, games played, power events. Searchable, filterable. After-action review tool.

### Layout

```
TIMELINE > LAST 72H

  D+417 23:33  comms.recv      BRAVO-2 · Re: rendezvous shift
  D+417 22:00  system.summary  Daily debrief prepared
  D+417 21:40  log.decision    Skip rotation tomorrow…
  D+417 16:18  log.incident    Solar inverter fault 3min
  D+417 16:14  power.alert     Inverter fault detected
  D+417 14:30  log.patrol      N perimeter nominal
  D+417 11:02  log.ration      Breakfast 400kcal
  D+417 09:14  log.observ      Tracks N of cache-7
  D+417 08:30  triage.run      Burns Q1 of 5 — minor
  D+416 22:00  system.summary  Daily debrief approved
  ...

  Filters:  [k]ind  [w]ho  [/]search
  Range:    [1] 24h  [3] 72h  [7] 7d  [m] 30d  [a] all
```

### NEW v3 features

- **Cross-module unified view.** This is the only place where everything lives in one stream.
- **Full-text search across all kinds.** `:timeline grep tourniquet` → every event mentioning it.
- **Causal threading.** Click an event → see what happened around it (±15 min) in all other modules.
- **Export.** Markdown report of any time range, suitable for after-action review or sharing.

### Implementation note

Don't denormalize. Implement as a query layer: `UNION ALL` over `log_entry`, `messages`, `triage_run`, `waypoint`, `power_sample` (sampled), `game_event`, etc, with a uniform shape.

### API endpoints

```
GET    /api/t/events?range=…&kind=…&q=…&user=…
GET    /api/t/around/:event_id?window=15m
GET    /api/t/export?from=…&to=…&fmt=md
```

---

## (X) SYSTEM

**Purpose:** Admin, settings, user management.

### Sub-screens

```
SYSTEM
├── (S) STATUS         Verbose health snapshot
├── (A) ADMIN          PIN-gated user/key management (kept from v2)
├── (T) THEMES         PHOSPHOR / AMBER / IBM / PAPER / ACID
├── (F) FONTS          User-switchable monospace
├── (B) BACKUP         Snapshot list, restore, export
├── (P) PLUGINS        Loaded plugins, hot-reload
├── (L) LOGS           Tail journalctl + flask logs
└── (Q) SHUTDOWN       Graceful poweroff with confirmation
```

### NEW v3 features

- **Themes** (5 presets, see Design Spec §4.5)
- **Snapshot/restore** every hour to `/backups/`. `:snapshot list` → roll back.
- **Plugins.** Drop a Python file in `/plugins/` → registers commands/screens. Hot-reloadable.
- **Tail logs** in-UI. Useful for debugging without SSH.

### Data model

Keep v2's `users`, `admin_pin`. Add:

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE snapshot (
  id INTEGER PRIMARY KEY,
  path TEXT,
  size_bytes INTEGER,
  created_at INTEGER,
  reason TEXT       -- 'auto-hourly','manual','pre-upgrade'
);

CREATE TABLE plugin (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE,
  path TEXT,
  enabled BOOLEAN,
  manifest_json JSON
);
```

### API endpoints

```
GET    /api/x/status
GET    /api/x/admin/users           (PIN required)
POST   /api/x/admin/users
DELETE /api/x/admin/users/:id
POST   /api/x/admin/pin
GET    /api/x/themes
POST   /api/x/themes/:name          activate
GET    /api/x/snapshots
POST   /api/x/snapshot              manual
POST   /api/x/snapshot/:id/restore  with confirmation
GET    /api/x/plugins
POST   /api/x/plugins/:id/toggle
GET    /api/x/logs?service=…&tail=N
POST   /api/x/shutdown              with confirmation
```

---

## (U) AUSPICE — astronomy + divination + encrypted journal **NEW** (Sprints 12-13)

Full spec: `AUSPICE-MODULE-SPEC.md`.

Sub-screens: SKY, CHART, TAROT, ORACLE, DAILY, JOURNAL, ALMANAC. Theme
ships a per-module purple accent shift (only AUSPICE touches the
phosphor base).

The module is split across two sprints — Sprint 12 (Part A: astronomy
and reference content) and Sprint 13 (Part B: divination engines and
the encrypted journal). The previously-planned standalone Sprint A/B/C
track is superseded; see `04-IMPLEMENTATION-PLAN.md` Sprints 12-13 for
the inlined plan.

Notable cross-module wires:

- ALMANAC events (sabbats, lunar phases, eclipses) feed TIMELINE
  (Sprint 11) once that module is live.
- TAROT reader↔querent uses the COMMS transport (Sprint 6).
- Journal encryption is its own at-rest layer — distinct from LOG's
  daily-journal table — so it can be reused by any future module that
  needs operator-PIN-gated storage.

---

## (?) HELP & XTRAS

**Purpose:** Discoverability + plugin showcase + lore.

### Sub-screens

```
HELP
├── (T) TOPICS         Module-by-module help index
├── (K) KEYS           Cheat sheet of all hotkeys, all modules
├── (C) COMMANDS       Full command palette listing
├── (P) PLUGINS        Browse and enable/disable
├── (L) LORE           In-character backstory, fortune library
└── (A) ABOUT          Version, build, hardware, credits
```

This is the LORD `(O)ther Places` slot — where weird, optional, plugin-contributed stuff lives. Keeps the main menus disciplined.

---

## Optional / future modules

Spec'd lightly, build later:

### INTEL

Wiki-style knowledge graph for operational area. People, places, threats, resources. Backlinks between pages. Syncable over comms between trusted operators. Think Obsidian, in Overseer.

### RITUAL

Daily/weekly/monthly checklists. "Sunday: rotate water, test radios, check perimeter." Auto-generates a log entry on completion.

### ARCHIVE

The Library generalized. Not just ZIM. PDFs, captured RSS, downloaded YouTube transcripts, your own notes. Unified search across all of it.

---

## Build priority order

(See `04-IMPLEMENTATION-PLAN.md` for full sprint plan.)

**Foundation (must come first):**
1. Chrome (status strip, breadcrumb, hotkey bar, palette) — already mocked in HTML
2. Static shell architecture (UI as static bundle, API split) — see `03-MESH-ARCHITECTURE.md`
3. HOME screen (the dispatcher)

**Core modules (refinements of v2):**
4. KNOWLEDGE refresh
5. COMMS refresh + boards
6. MEDICAL wizard reflow
7. NAVIGATION refresh
8. POWER btop dashboard
9. SYSTEM admin refresh

**New core:**
10. LOG
11. INVENTORY
12. TIMELINE

**New extended:**
13. SIGNAL
14. RECREATION (Dragon's Tale separate sprint)
15. HELP & XTRAS

**Optional / later:**
16. INTEL, RITUAL, ARCHIVE

---

End of module catalog. Continue to `03-MESH-ARCHITECTURE.md`.
