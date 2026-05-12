# REBUILD — Module Spec (v3 addendum)

> Slot in alongside INVENTORY and LOG. Depends on both. Optional dependency on KNOWLEDGE for LLM-assisted DESIGN sub-screen, but ATLAS / RECIPES / SUBSTITUTE work pure-offline with no model loaded.

> This document follows the conventions of `02-MODULE-CATALOG.md`. The hotkey is `(B)` — `R` is taken by RECREATION, `E` by RECREATION's submenu, so REBUILD takes `(B)` for "build". Confirm at integration time.

---

## 0. Why this module exists

The KNOWLEDGE module is a retrieval surface: ask, get article. After severe infrastructure loss, operators don't need *more* articles — they need to know **what's reachable from what they have**. REBUILD models human technological development as a graph of prerequisites and lets the operator navigate it forward from current capability.

The system is honest about three layers of confidence:

| Layer | Source | Trust |
|---|---|---|
| RECIPES | Curated, human-vetted build cards bundled with system | Highest |
| KB synthesis | Steps cited verbatim from ZIM archives | High |
| LLM reasoning | Qwen synthesis grounded in KB chunks | Medium, flagged |
| Speculation | LLM with no KB grounding | Low, gated behind confirm |

Every step rendered in REBUILD is tagged with its source layer. That's the whole trust model.

---

## 1. Sub-screens

```
REBUILD
├── (A) ATLAS         Era map. Stone → Bronze → Iron → Steam → Electric → Electronic
├── (T) TECH TREE     ASCII dependency graph, navigable
├── (R) RECIPES       Curated build cards (forge, still, radio, mill, ...)
├── (S) SUBSTITUTE    "I have X, what can replace Y?"
├── (P) PROJECTS      Active builds, parts list, progress, cross-linked to LOG
└── (D) DESIGN        LLM-assisted design session, KB-grounded, saves to RECIPES
```

Hotkey row at bottom: `[A]tlas [T]ree [R]ecipes [S]ub [P]roj [D]esign  [/] search  [?] help  [q] back`

---

## 2. (A) ATLAS — the era map

The first screen new operators see. Static, curated, motivational. No LLM. No queries. Just: here is the ladder of human technological development, and here is roughly where you stand.

### Layout (80×24 canonical)

```
┌─ REBUILD › ATLAS ─────────────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│   ┌─ YOU ARE HERE ──────────────────────────────────────┐                │
│   │  Tier reached:  III ELECTRIC (partial)              │                │
│   │  Anchor:        salvage + 12V solar + handtools     │                │
│   │  Next gate:     insulated wire stockpile            │                │
│   └─────────────────────────────────────────────────────┘                │
│                                                                          │
│  ╔═══════╗   ╔═══════╗   ╔═══════╗   ╔═══════╗   ╔═══════╗   ╔════════╗ │
│  ║  0    ║──▶║  I    ║──▶║  II   ║──▶║  III  ║──▶║  IV   ║──▶║   V    ║ │
│  ║ STONE ║   ║ FIRE  ║   ║ METAL ║   ║ STEAM ║   ║ ELEC  ║   ║DIGITAL ║ │
│  ╚═══════╝   ╚═══════╝   ╚═══════╝   ╚═══▲═══╝   ╚═══════╝   ╚════════╝ │
│   ░░░░░░░     ▒▒▒▒▒▒▒     ▓▓▓▓▓▓▓     ███████     ░░░░░░░     ░░░░░░░░  │
│   reached     reached     reached     PARTIAL     ahead       distant   │
│                                                                          │
│   Tier III contents:                                                     │
│   ✓ charcoal kiln          ✓ small forge         ◐ electric motor       │
│   ✓ lime kiln              ✓ wood lathe          ◐ wind turbine         │
│   ◐ coal smelting          ◯ telegraph wire      ◯ vacuum tube          │
│                                                                          │
│   Legend:  ✓ achieved   ◐ in progress   ◯ locked   ⚠ blocked            │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [↑↓] tier  [Enter] drill in  [/] search  [T] tree view  [?] help  [q]   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Behaviour

- Six tiers, fixed: STONE, FIRE, METAL, STEAM, ELECTRIC, DIGITAL.
- Each tier expands inline (LORD-style — no modal) into ~12-30 named technologies.
- Each technology is itself a node in the TECH TREE (next screen). `Enter` jumps there.
- The "YOU ARE HERE" panel is computed from INVENTORY + manually marked achievements. Operator can override with `M` (mark achieved) on any node.
- Block character density (`░▒▓█`) gives visual density-as-progress without color, so it survives mono terminals.

### Data

```sql
CREATE TABLE atlas_tier (
  id          INTEGER PRIMARY KEY,
  ordinal     INTEGER UNIQUE,         -- 0..5
  name        TEXT,                   -- 'STONE','FIRE',...
  description TEXT
);

CREATE TABLE atlas_node (
  id          INTEGER PRIMARY KEY,
  tier_id     INTEGER REFERENCES atlas_tier(id),
  slug        TEXT UNIQUE,            -- 'charcoal-kiln', 'wind-turbine'
  name        TEXT,
  summary     TEXT,                   -- one line
  recipe_id   INTEGER,                -- NULL or → recipe.id
  state       TEXT                    -- 'locked','available','in_progress','achieved','blocked'
);

CREATE TABLE atlas_prereq (
  node_id     INTEGER REFERENCES atlas_node(id),
  requires_id INTEGER REFERENCES atlas_node(id),
  PRIMARY KEY (node_id, requires_id)
);
```

The `atlas_*` tables ship pre-populated as a JSON seed file (`shell/data/atlas.json`). Updates to the curated graph are version-controlled in the repo, not user-editable. State (`achieved` etc) is per-deployment local state.

---

## 3. (T) TECH TREE — the dependency graph

ATLAS is the era overview. TECH TREE is the working view. Same data, different rendering: a focused ASCII graph centered on one node, showing immediate ancestors and descendants.

### Layout

```
┌─ REBUILD › TREE › electric-motor ─────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  prerequisites              FOCUS                  unlocks               │
│  ─────────────              ─────                  ───────               │
│                                                                          │
│  [✓] copper wire ─────────┐                  ┌──── [◯] alternator        │
│                           │                  │                           │
│  [✓] iron core ───────────┤                  ├──── [◯] generator         │
│                           ▼                  │                           │
│  [◐] insulators ────────▶ ◆ ELECTRIC ───────▶├──── [◯] electric pump    │
│                           │  MOTOR    │      │                           │
│  [✓] permanent magnet ────┤           │      └──── [◯] EV conversion     │
│                           │   v3.0    │                                  │
│  [✓] mechanical lathe ────┘           │                                  │
│                                                                          │
│  ── DETAILS ─────────────────────────────────────────────────────────── │
│  Source:    [RECIPE: motor-from-scratch.md]   [KB: Appropedia/motor]     │
│  Time est:  6-12 hours skilled, 2-3 days first attempt                   │
│  Skill:     intermediate  (requires hand-winding accuracy)                │
│  Risk:      low  (no high voltage during build)                          │
│  Status:    ◐ blocked on insulators  →  see SUBSTITUTE                   │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [hjkl] move  [Enter] focus node  [R]ecipe  [S]ub  [B]ack  [?] help  [q] │
└──────────────────────────────────────────────────────────────────────────┘
```

### Navigation

- `h/l` move focus along the prerequisite/unlock axis.
- `j/k` move between sibling nodes at same depth.
- `Enter` re-centers the tree on the selected node.
- `Backspace` walks back through the focus history.
- `R` jumps to the bound RECIPE if one exists.
- `S` jumps to SUBSTITUTE pre-filled with the missing prereq.

### Why ASCII (not a JS tree component)

- Renders identically on Cardputer, web, terminal SSH session, and Meshtastic-compressed paste-back.
- Survives copy-paste into LOG entries and COMMS messages without loss.
- Compresses extremely well over OMP — a tree update is `(focus_slug, [edges_added], [edges_removed])`, often <50 bytes.

### Rendering algorithm

Pseudocode:

```python
def render_tree(focus, depth=2):
    prereqs = bfs_prereqs(focus, depth)
    unlocks = bfs_unlocks(focus, depth)
    grid = ascii_canvas(80, 18)
    place_node(grid, focus, col=center)
    layout_left(grid, prereqs)            # right-aligned, lanes
    layout_right(grid, unlocks)           # left-aligned, lanes
    draw_edges(grid)                       # ─ │ ┐ ┘ ┌ └ ┤ ├ ▼ ▶
    return grid.to_string()
```

Lane layout uses Sugiyama-style layering trimmed to the available rows (16 content rows, 3 reserved for the focus header). If a layer overflows, switch to compact mode: `[+3 more]` aggregator with `Tab` to cycle.

---

## 4. (R) RECIPES — curated build cards

The trust anchor of the whole module. RECIPES are human-vetted, version-controlled, ship with the system. No LLM involvement at runtime — they're authored offline by people who actually know how to do these things, and are rendered as static markdown.

### List screen

```
┌─ REBUILD › RECIPES ───────────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│ /charcoal_                                              43 recipes total │
│                                                                          │
│  TIER  ID                          NAME                       STATUS     │
│  ────  ─────────────────────────   ───────────────────────    ────────   │
│   I    fire-bow-drill              Bow-drill fire making      ✓ ach.     │
│   I    fire-flint-steel            Flint & steel ignition     ✓ ach.     │
│  >II<  charcoal-mound              Earth-mound charcoal       ◐ active   │
│   II   charcoal-retort             Retort charcoal (cleaner)  ◯ ready    │
│   II   small-forge                 Brake-drum forge           ✓ ach.     │
│   II   lime-kiln                   Field lime kiln            ◯ ready    │
│   III  steam-engine-toy            Pop-pop boat               ◯ ready    │
│   III  windmill-savonius           Savonius vertical-axis     ◯ ready    │
│   IV   alternator-rewind           Car alternator → genset    ◐ active   │
│   IV   motor-from-scratch          Hand-wound DC motor        ⚠ blocked  │
│   IV   crystal-radio               Galena crystal receiver    ◯ ready    │
│   V    arduino-from-salvage        AVR from junk boards       ◯ locked   │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [↑↓] select  [Enter] open  [N]ew  [F]ilter  [/] search  [?] help  [q]   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Recipe card format

A recipe is a markdown file in `shell/data/recipes/<id>.md` with strict front-matter. The renderer parses front-matter for the structured fields (parts, time, difficulty) and renders the body as standard markdown with a few extensions (citation tags, cross-links to ATLAS nodes, embedded ASCII diagrams).

#### Sample 1 — `charcoal-mound.md`

```markdown
---
id: charcoal-mound
name: Earth-mound charcoal
tier: II
atlas_node: charcoal-kiln
yields: charcoal (40-50% of input wood mass)
time_active: 4 hours setup, 2 hours teardown
time_total: 36-72 hours (slow burn + cooling)
difficulty: beginner
risk: medium  # fire, smoke inhalation, burns from hot earth
parts_required:
  - hardwood (oak, ash, hickory) — 100kg dry
  - earth/soil — sufficient to cover mound 8cm thick
  - water — 20L for emergency damping
  - long-handled rake
  - shovel
parts_optional:
  - sheet metal off-cut (for chimney baffle)
prerequisites_atlas:
  - axe-or-saw
  - controlled-fire
unlocks_atlas:
  - small-forge
  - lime-kiln
  - distillation
sources:
  - kb: Appropedia/Charcoal_production
  - kb: Wikipedia/Charcoal#Traditional_methods
  - book: "FAO 41 — Simple technologies for charcoal making"
---

## What you're making

Charcoal is wood that has been heated without oxygen. It burns hotter and
cleaner than wood, and is the gateway fuel for the entire METAL tier — you
cannot run a forge on raw firewood. A 100kg mound yields enough charcoal for
roughly 4-6 forge sessions.

## Site selection

Pick a site that is:

- Flat and clear of grass within 5m of the mound
- Sheltered from prevailing wind (steady draft = uneven burn)
- Within hose reach of water OR with 20L stockpile within arm's length
- NOT under tree canopy (smoke + ember risk)

## Construction

```
              ┌─ chimney hole (capped) ─┐
              │                          │
        ┌─────▼──────────────────────────▼─────┐
        │░░░░░░░░░░░░░░ EARTH 8cm ░░░░░░░░░░░░░│
        │  ▓▓▓▓▓▓▓▓ split logs vertical ▓▓▓▓▓▓ │   1.5m
        │  ▓▓▓▓ packed tight, gaps minimal ▓▓▓ │   tall
        │  ▓▓▓▓▓ kindling chamber centre ▓▓▓▓▓ │
        └──────────────────────────────────────┘
                    diameter 2m
                    air vents (8) around base
```

1. Stack split hardwood vertically in a tight cone, 1.5m tall, 2m diameter.
   Centre logs lean inward. Pack the gaps with smaller offcuts.
2. Pierce a vertical chimney 10cm wide down the center to ground level.
3. Open 8 air vents at ground level around the perimeter, finger-width.
4. Cover the entire structure with 8cm of damp packed earth, EXCEPT the
   chimney hole and air vents.
5. Drop hot embers + tinder down the chimney. Seal chimney once visible
   smoke turns from white to thin blue (~2 hours).

## The burn

This is the dangerous part. The mound will burn for 24-48 hours. **Do not
leave it unattended.** Walk the perimeter every 30 minutes:

- White smoke from a vent → close it (it's burning too fast there).
- Glowing red earth → cover with more dirt immediately.
- Cracking earth → patch with fresh damp soil.
- Flame visible → CLOSE EVERYTHING, dump water on the breach.

The goal is **smoulder, not flame.** When all vents stop smoking and the
mound is uniformly cool to within a hand's breadth, you are done.

## Recovery

Wait a full 24 hours after the last smoke before opening. Hot charcoal
exposed to air will reignite explosively. When ready:

1. Open one vent. If no smoke and no glow, proceed.
2. Brush earth aside in stages.
3. Sort: hard ringing pieces are good charcoal. Crumbly black is dust
   (still useful — bind with starch into briquettes).
4. Store in a sealed dry container. Wet charcoal is useless.

## Failure modes

- **All ash, no charcoal.** Burn was too hot — insufficient earth cover or
  vents left open too long. Add 50% more earth next time.
- **Half-burnt logs.** Burn was too cool — vents were closed too early.
  Re-stack and retry with 2 extra hours of open burn.
- **Mound collapsed.** Logs were not packed tightly. Use thinner splits.

## Cross-references

- **MEDICAL** — burn treatment: `MEDICAL › TRIAGE › BURNS`
- **NEXT** — once you have charcoal, build a `small-forge`
- **UPSTREAM** — see ATLAS tier II for what charcoal unlocks
```

#### Sample 2 — `crystal-radio.md`

```markdown
---
id: crystal-radio
name: Galena crystal receiver
tier: III
atlas_node: crystal-radio
yields: AM-band receiver (no battery required)
time_active: 3-5 hours
time_total: 3-5 hours
difficulty: beginner
risk: low
parts_required:
  - galena crystal (or 1N34 germanium diode as substitute)
  - enamelled copper wire — ~30m
  - cardboard or PVC tube — 50mm dia × 100mm
  - high-impedance earphone (≥2kΩ) OR piezo earpiece
  - long wire antenna — 10-30m
  - earth ground (cold water pipe, copper rod)
  - safety pin + razor blade (cat's whisker mount)
parts_optional:
  - variable capacitor (improves selectivity)
prerequisites_atlas:
  - copper-wire
  - simple-tools
unlocks_atlas:
  - regenerative-receiver
  - vacuum-tube-receiver
  - signal-detection
sources:
  - kb: Appropedia/Crystal_radio
  - kb: ARRL Handbook 1980 ed., Ch.3
  - kb: WikiBooks/Electronics/Crystal_radio
---

## What you're making

A radio receiver that needs no battery. Powered entirely by the radio waves
it receives. Tunes the AM broadcast band (530-1700 kHz) and any local
shortwave stations within reach. Reception range depends almost entirely
on antenna length — 30m of wire in a tree can reach stations 1000+ km away
at night.

## Schematic

```
         ANTENNA  ────┬──────────┬──── DIODE ───┬─── EARPHONE ───┐
                     │          │     ──▶│──   │                 │
                  ┌──┴──┐    ───┴───                              │
                  │ COIL│    ─── CAP                              │
                  │     │       (var)                             │
                  └──┬──┘    ───┬───                              │
                     │          │                                 │
         GROUND  ────┴──────────┴───────────────┴─────────────────┘
```

The coil + capacitor form a tuned circuit selecting one frequency. The
diode rectifies it into audio. The earphone vibrates audibly.

## Build

### 1. The coil

Wind 80 turns of enamelled copper wire around the cardboard tube. Tap
every 10 turns by twisting a small loop without breaking the wire — these
are your tuning taps. Secure with tape or shellac.

### 2. The detector

Modern way: solder a 1N34 germanium diode in line, band toward the
earphone.

Old way: mount a small galena crystal in a brass cup. Mount a fine wire
("cat's whisker") from a safety pin so its tip can be moved across the
crystal surface. Adjust during use to find a sensitive spot.

### 3. The antenna

Length matters more than anything else. Run insulated wire as high and as
long as you can. 10m gets local stations; 30m+ reaches distant stations
at night. Insulate from the support — bare wire to earth = no signal.

### 4. The ground

Equally critical. Connect to a cold water pipe (metal, all the way to the
street) OR drive a 1m copper rod into damp earth. A bad ground halves
your reception.

### 5. Tuning

With the earphone in your ear, walk the diode connection across the coil
taps until you hear a station. Move the cat's whisker to peak. With a
variable cap, fine-tune across the band.

## Operating hints

- Reception is dramatically better at night.
- A second longer antenna improves things; a third rarely does.
- A large wet metal mass (cold water tank) makes a great ground.
- If you hear all stations at once: increase coil turns or shorten antenna.
- If you hear nothing: check ground first, antenna second, diode third.

## Failure modes

- **Silence.** 90% of the time: bad ground. Try a different earth.
- **All stations at once.** Tuned circuit too broad — add a variable cap.
- **One faint station only.** Antenna too short for your area, or no
  strong stations nearby. Try at night.
- **Hum.** Pickup from nearby AC wiring. Move further from buildings.

## Cross-references

- **NEXT** — add a one-tube amplifier → regenerative receiver, 100× louder
- **COMMS** — pair with a transmitter (NEXT TIER) for two-way contact
- **SIGNAL** — log frequencies you receive in `SIGNAL › LOG`
```

### Recipe authoring

Recipes are markdown files in the repo. Editing requires a code change, review, and merge. This is a deliberate friction:

- The system ships ~50 vetted recipes covering tiers I-IV.
- A `(N)ew` command in the UI doesn't let an operator write a recipe — it lets them save a generated **DRAFT** from the DESIGN sub-screen as a local-only proposal. Drafts never appear in the main recipe list — only in `(D)RAFTS` sub-tab, clearly marked. They have to be promoted by a developer to enter the canonical set.

This is the only way the trust gradient survives. Once a user-editable RECIPES table exists, the LLM can write to it, and the trust boundary is gone.

### API endpoints

```
GET    /api/b/recipes                       list, with status
GET    /api/b/recipes/:id                   full markdown + parsed front-matter
GET    /api/b/recipes/:id/parts             structured parts list (for INVENTORY join)
POST   /api/b/recipes/:id/start             create a project from this recipe
GET    /api/b/recipes/drafts                user-saved DESIGN outputs (local only)
POST   /api/b/recipes/drafts                save a draft from a DESIGN session
DELETE /api/b/recipes/drafts/:id
```

---

## 5. (S) SUBSTITUTE — what can replace what

The most-used screen, probably. Operator types a material or part they're missing; system answers with substitutes ranked by closeness, with caveats.

### Layout

```
┌─ REBUILD › SUBSTITUTE ────────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  Need:  copper wire, enamelled, 0.5mm                                    │
│  For:   crystal-radio coil  (auto-detected from PROJECTS)                │
│                                                                          │
│  ── SUBSTITUTES ────────────────────────────────────────────────────── │
│                                                                          │
│   ◆ 1  SALVAGED COPPER WIRE                                  [BEST]      │
│        From:    motor windings, transformer windings, building            │
│                 cable (strip insulation), telephone cable                 │
│        Caveat:  enamel may be damaged on salvaged windings;               │
│                 inspect for nicks; re-coat with shellac if used in coil   │
│        Source:  [RECIPE: salvage-copper.md] [KB: Appropedia/Wire]         │
│                                                                          │
│   ◆ 2  ALUMINIUM WIRE                                        [PARTIAL]   │
│        Works for: low-frequency power, NOT for RF coils                   │
│        Caveat:  20% lower conductivity; oxidation at joints; do NOT       │
│                 use for crystal-radio coil — Q factor too low             │
│        Source:  [KB: ARRL Handbook Ch.20]                                 │
│                                                                          │
│   ◆ 3  STEEL WIRE WITH COPPER PLATING                        [POOR]      │
│        Found in: old fence wire, some cables                              │
│        Caveat:  thin plating wears off; high resistance; only             │
│                 acceptable for one-shot prototypes                        │
│                                                                          │
│  ── ADJACENT ──────────────────────────────────────────────────────── │
│                                                                          │
│   See also:  [SUBSTITUTE: enamel coating]  [SUBSTITUTE: insulation]      │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [↑↓] select  [Enter] details  [P] add to PROJECT  [/] new search  [q]   │
└──────────────────────────────────────────────────────────────────────────┘
```

### How it answers

Two-stage:

1. **Static lookup first.** A `material_substitute` table ships with the system, populated from MATERIALS database (the curated layer). For ~200 common materials this returns instantly with no LLM, no caveats invented on the spot.
2. **LLM augmentation only when static returns empty.** With explicit `[GEN]` tag on every speculative line, the model is given the relevant KB chunks and told to ground every claim. No KB chunks → no answer. The system says "no match found in knowledgebase" rather than guess.

```sql
CREATE TABLE material (
  id          INTEGER PRIMARY KEY,
  slug        TEXT UNIQUE,            -- 'copper-wire-0.5mm'
  name        TEXT,
  properties  JSON,                   -- { conductivity, melting_point, ... }
  hazards     TEXT
);

CREATE TABLE material_substitute (
  for_id      INTEGER REFERENCES material(id),
  use_id      INTEGER REFERENCES material(id),
  rank        INTEGER,                -- 1=best, 2=partial, 3=poor
  context     TEXT,                   -- 'rf-coil','power-wire','structural'
  caveat      TEXT,
  source      TEXT,                   -- KB citation
  PRIMARY KEY (for_id, use_id, context)
);
```

### API endpoints

```
GET  /api/b/substitute?need=<slug>&context=<slug>
POST /api/b/substitute/llm     # only when GET returns empty; rate-limited
```

---

## 6. (P) PROJECTS — what's actually being built

Cross-cuts INVENTORY and LOG. A project is an instance of a recipe in flight.

### List

```
┌─ REBUILD › PROJECTS ──────────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  ID  RECIPE                  STARTED       PROGRESS   STATUS             │
│  ──  ──────────────────────  ──────────    ────────   ──────────         │
│  17  charcoal-mound          2026-04-12    ████░ 4/5  burning            │
│  18  alternator-rewind       2026-04-19    ██░░░ 2/5  blocked: enamel    │
│  19  brake-drum-forge        2026-04-22    █░░░░ 1/4  parts gathering    │
│  20  rocket-mass-heater      2026-04-25    █████ 5/5  ✓ complete         │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [N]ew from recipe  [Enter] open  [L]og entry  [?] help  [q] back         │
└──────────────────────────────────────────────────────────────────────────┘
```

### Detail view

Combines the recipe markdown with checkboxes per step, parts list cross-referenced against INVENTORY (green = on hand, amber = partial, red = missing), elapsed time, log entries, and a journal.

`L` from any step opens a quick-LOG entry pre-tagged with the project ID — so when something goes wrong you can capture it instantly, and TIMELINE will show it.

---

## 7. (D) DESIGN — LLM-assisted, KB-grounded

The only sub-screen that uses the LLM at runtime. It is deliberately the least prominent — last in the menu order, hotkey `D`, separate confirmation gates throughout.

### Flow

```
┌─ REBUILD › DESIGN › NEW ──────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  Goal:    [_______________________________________________________]      │
│                                                                          │
│  Constraints (optional):                                                 │
│    Have:    pulled from INVENTORY  ▼ [override]                          │
│    Tier:    III ELECTRIC                                                 │
│    Budget:  [no constraint  ▼]                                           │
│    Time:    [no constraint  ▼]                                           │
│    Risk:    accept up to MEDIUM   ▼                                      │
│                                                                          │
│  Mode:                                                                    │
│    (•) Decompose  — break my goal into a build plan                      │
│    ( ) Diagnose   — my build isn't working, why?                         │
│    ( ) Explore    — what's reachable from what I have?                   │
│                                                                          │
│  Citation policy:                                                        │
│    (•) Strict    — refuse if no KB citation can be produced              │
│    ( ) Permissive — allow speculative steps, flagged                     │
│                                                                          │
│  ┌─ NOTICE ─────────────────────────────────────────────────────┐        │
│  │ LLM-assisted design output is graded:                        │        │
│  │   [KB] cited from knowledgebase                              │        │
│  │   [GEN] reasoned synthesis                                   │        │
│  │   [SPEC] speculative — verify before acting                  │        │
│  │ Speculative steps require explicit confirmation to act on.   │        │
│  └──────────────────────────────────────────────────────────────┘        │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [Tab] field  [Enter] generate  [?] help  [q] back                        │
└──────────────────────────────────────────────────────────────────────────┘
```

### Output

```
┌─ REBUILD › DESIGN › OUTPUT ───────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  Goal:  small wind generator from car alternator                         │
│                                                                          │
│  ── BUILD PLAN ──────────────────────────────────────────────────────  │
│                                                                          │
│  1. [KB] Source a salvaged car alternator (12V, 50A common type).        │
│     Most modern alternators are internally regulated; we want an         │
│     external-regulator type for control flexibility.                     │
│     ↳ cite: KB:Appropedia/Small_wind_systems §3.2                        │
│                                                                          │
│  2. [KB] Strip the alternator's internal voltage regulator. The Y-wound  │
│     stator is fine as-is; we just bypass the field control.              │
│     ↳ cite: KB:Otherpower.com/alternator_conversion (mirrored)           │
│                                                                          │
│  3. [GEN] Mount the alternator on a vertical shaft inside a Savonius     │
│     rotor (RECIPE: windmill-savonius). The alternator's stock pulley     │
│     gives roughly 4:1 step-up which suits Savonius low RPM.              │
│     ↳ derived from: RECIPE:windmill-savonius + KB:alternator_curves      │
│                                                                          │
│  4. [GEN] Charge controller: a 12V solar charge controller will work     │
│     for a wind alternator if rated for ≥1.5× expected current. Add a     │
│     diversion load (resistive heater) to dump excess in high wind.       │
│     ↳ derived from: KB:Solar_charge_controller §5 + KB:Wind_dump_load    │
│                                                                          │
│  5. [SPEC] ⚠ Estimated output: 100-300W in 8 m/s wind. This is an        │
│     extrapolation from generic alternator+rotor curves and may be off    │
│     by 50% in either direction. Verify with measurement.                 │
│     ↳ NOT cited from knowledgebase                                       │
│                                                                          │
│  ── PARTS NEEDED (cross-referenced against INVENTORY) ───────────────   │
│                                                                          │
│   ✓ alternator       have                                                │
│   ✓ steel pipe 50mm  have                                                │
│   ◐ bearings         partial — only 1 of 2 needed                        │
│   ◯ charge ctrl 30A  missing — see SUBSTITUTE                            │
│   ◯ dump load        missing                                             │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [S]ave as draft  [P] start project  [E] expand step  [B] back  [q]       │
└──────────────────────────────────────────────────────────────────────────┘
```

The `[KB]`, `[GEN]`, `[SPEC]` tags are not cosmetic — they're enforced at the prompt-engineering layer. The model is instructed to either produce a citation from the supplied KB chunks or tag the line `[SPEC]`. A post-filter rejects any output where `[KB]` or `[GEN]` lines are not followed by a `↳ cite:` line — those get re-tagged `[SPEC]` automatically before display.

### Rate limits

- `(D)ESIGN` is rate-limited per operator: 5 generations per hour, 30 per day. Keeps the LLM from being used as a chatty oracle when KNOWLEDGE/CHAT is the right tool.
- Drafts saved to `recipes/drafts/` are local-only and clearly marked. They never enter the canonical recipe set without manual promotion.

### Prompt structure (developer reference)

```
SYSTEM:
  You are a build planner. You answer ONLY based on the provided KB chunks.
  Tag every step:
    [KB]   if directly stated in a chunk. Cite as: ↳ cite: <chunk_id>
    [GEN]  if synthesized from 2+ chunks. Cite all sources.
    [SPEC] if not grounded in the chunks. Mark with ⚠.
  If you cannot answer with at least one [KB] step, refuse and say so.

USER:
  Goal: <user goal>
  Have: <inventory list>
  Tier: <atlas tier reached>

CONTEXT (top-k retrieved chunks from KB and RECIPES):
  ===CHUNK 1 [KB:Appropedia/Small_wind_systems §3.2]===
  ...
  ===CHUNK 2 [RECIPE:windmill-savonius]===
  ...
```

---

## 8. COMMS interaction — sharing builds across the mesh

Recipes, drafts, and project snapshots are LoRa-transmissible. This is where the system gets genuinely interesting in a multi-operator setting: one operator's working forge becomes another's tomorrow.

### Wire format

A recipe over OMP is the markdown body, gzip-compressed. A typical curated recipe is 2-5KB raw, 800-1500 bytes compressed — fits in 4-8 LoRa packets at SF9.

A **project snapshot** is a tiny JSON envelope referencing the recipe ID, plus per-step status, plus the journal entries. Often <500 bytes.

### New OMP opcodes

Reserve in the `0x60-0x6F` range (REBUILD module):

```
0x60  RECIPE_ADVERTISE     "I have recipe X version Y"
0x61  RECIPE_REQUEST       "send me recipe X"
0x62  RECIPE_PAYLOAD       gzipped markdown body, fragmented
0x63  PROJECT_SNAPSHOT     project state share
0x64  SUBSTITUTE_QUERY     "anyone got a sub for X in context Y?"
0x65  SUBSTITUTE_REPLY     human-authored reply, signed
0x66  ATLAS_DELTA          shared state of "we as a group reached X"
0x67  DRAFT_SHARE          "here's my design draft for review" (signed)
```

### Trust over the mesh

Critical: **only canonical recipes propagate by default.** Drafts (LLM-generated, locally saved) require a destination operator to opt in by callsign. The receive-end UI shows clearly whether a recipe is canonical-signed or a peer-shared draft:

```
   [✓ CANON]   shipped with system, hash matches
   [✓ PEER]    received from KILO-7, signed by their key
   [⚠ DRAFT]   LLM-generated, peer-shared, unverified
```

A `0x67 DRAFT_SHARE` packet that arrives unsolicited — i.e. without a prior opt-in for that callsign — is dropped silently and logged. This prevents a hostile or malfunctioning peer from poisoning the recipe set with hallucinated builds.

### COMMS UI surface

In `COMMS › BOARDS`, add a `/builds` board:

```
┌─ COMMS › BOARDS › /builds ────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  TIME       FROM       SUBJECT                              KIND         │
│  ─────────  ─────────  ──────────────────────────────────   ─────────    │
│  04-25 14h  KILO-7     RE: alternator-rewind enamel sub      SUBSTITUTE  │
│  04-25 11h  TANGO-3    project snapshot: lime-kiln day 2     PROJECT     │
│  04-24 19h  ECHO-1     ⚠ DRAFT: micro-hydro turbine          DRAFT       │
│  04-24 16h  KILO-7     ✓ PEER: improved-charcoal-mound v2    RECIPE      │
│  04-23 09h  --SYS--    ATLAS: TANGO-3 reached tier III       MILESTONE   │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [Enter] open  [I] import  [R] reply  [B] back  [q]                       │
└──────────────────────────────────────────────────────────────────────────┘
```

`[I] import` on a peer-shared recipe stages it in `RECIPES › PEERS` (separate sub-tab), where it can be reviewed before being added to the working set. Drafts go to `RECIPES › DRAFTS` and never elsewhere.

### A scenario, end-to-end

> KILO-7 successfully builds a charcoal retort that improves on the canonical mound design — the retort is cleaner-burning and yields more charcoal. They mark their PROJECT complete, edit the journal with their modifications, and `(S)hare` it.
>
> The system packages: the original recipe ID + version, plus the journal as a structured "modifications" overlay. ~1.2KB compressed. Broadcast over the mesh as opcode `0x63` with the modification flag set.
>
> TANGO-3 sees it appear on `/builds` board next time their node syncs. They open it, review KILO-7's modifications inline (rendered as a diff against the canonical recipe), and decide to try it. `(I)mport` adds it to their PEERS recipe list, marked `[✓ PEER]`. They start a new project from it.
>
> Three weeks later, when ECHO-1 joins the mesh, the recipe propagates again. ECHO-1 sees it as `[✓ PEER]` with two signatures (KILO-7 originated, TANGO-3 endorsed via their successful project completion). The trust gradient is visible in the UI.

This is the whole point. Knowledge gets *better* as it moves through the network, and the system records who tried what and how it went, without any of it pretending to be canonical until enough operators have endorsed it.

---

## 9. Build priority

If REBUILD is one sprint:

1. **ATLAS first.** Static, motivational, no LLM. ~3 days incl. seed data.
2. **RECIPES list + reader.** Just markdown rendering with front-matter parsing. ~2 days. Ship with 15 hand-written recipes.
3. **PROJECTS** with INVENTORY join. ~3 days.
4. **SUBSTITUTE** static-only (no LLM yet). ~2 days incl. ~200 material entries.
5. **TECH TREE.** Trickiest layout work. ~4 days.
6. **DESIGN.** Last. The LLM-bearing screen. ~5 days incl. prompt engineering and rate limiting.
7. **COMMS integration** as a follow-up sprint, gated on REBUILD core stable.

Total: ~3 weeks of focused work for the core, plus the recipe authoring (which is the long pole — it's where the actual value is).

---

## 10. What this module deliberately does NOT do

- **It is not a tutor.** No quizzes, no pedagogical scaffolding. Operators read recipes and follow them.
- **It does not auto-prioritise.** No "you should build X next" nudges. The operator decides; the system shows what's reachable.
- **It does not generate recipes silently.** Every LLM-touched output is tagged. Every draft requires explicit save. No drift into auto-canon.
- **It does not gamify.** No XP, no badges, no progress bars beyond what's actually useful (the parts-on-hand bar). Survival is not a video game.

End of REBUILD spec.
