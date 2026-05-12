# REBUILD — Module Spec (v3 addendum, revision 2)

> **PATCH NOTE — supersedes revision 1.** Revision 1 (`REBUILD-MODULE-SPEC.md`) overstepped what this system can credibly do. It included LLM-authored build recipes with ASCII schematics and a `DESIGN` sub-screen that generated speculative steps with caveat tags. Both have been removed. The system can index, navigate, and journal — it cannot author technical content. This document reflects that reality.
>
> **Diff summary vs revision 1** (full diff in §11):
>
> - DESIGN sub-screen — **removed**
> - RECIPES — **renamed POINTERS**, content is index-only, no build instructions or schematics in-system
> - SUBSTITUTE — pure curated lookup; LLM augmentation removed
> - SUBSTITUTE_REPLY and DRAFT_SHARE OMP opcodes — **removed**
> - Sample recipes `charcoal-mound.md` and `crystal-radio.md` — **deleted**, replaced with pointer-card examples
> - Build priority and "what this module does NOT do" sections — rewritten

---

## 0. Why this module exists

The KNOWLEDGE module is a retrieval surface — ask, get article. After severe infrastructure loss, operators don't need *more* articles, they need to know **which article in the archive applies to their situation**, in what order. REBUILD is a navigation and journaling layer over the existing KB. It does not author technical content.

This is the trust model in one paragraph: **the KB archives were written by people who actually did the work — Appropedia, iFixit, WikiMed, FAO publications, ARRL handbooks. Those documents have authority. Anything this system writes does not.** REBUILD's contribution is the index, the journal, and the social layer over the mesh — never the build instructions themselves.

---

## 1. Sub-screens

```
REBUILD
├── (A) ATLAS         Era map. Stone → Bronze → Iron → Steam → Electric → Electronic
├── (T) TREE          Capability dependency graph, navigable
├── (P) POINTERS      Curated cards indexing KB articles by build target
├── (S) SUBSTITUTE    "I have X, what can replace Y?"  (pure lookup table)
└── (J) PROJECTS      Active builds, parts list, progress, journal entries
```

Hotkey row at bottom: `[A]tlas [T]ree [P]ointers [S]ub [J] proj  [/] search  [?] help  [q] back`

Five sub-screens, down from six. No LLM surface inside REBUILD. If the operator wants LLM help on a build, they go to `KNOWLEDGE › CHAT` with KB augmentation on — that is the existing, audited surface for talking to the model.

---

## 2. (A) ATLAS — the era map

Unchanged from revision 1. Static, curated, no LLM. Six tiers: STONE, FIRE, METAL, STEAM, ELECTRIC, DIGITAL. Each tier expands into named capabilities, each capability is a node in TREE that links to one or more POINTERS. The "YOU ARE HERE" panel is a manual marker the operator sets.

### Layout (80×24 canonical)

```
┌─ REBUILD › ATLAS ─────────────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│   ┌─ YOU ARE HERE ──────────────────────────────────────┐                │
│   │  Tier reached:  III ELECTRIC (partial)              │                │
│   │  Anchor:        salvage + 12V solar + handtools     │                │
│   │  Note (you):    "wire stockpile is the bottleneck"  │                │
│   └─────────────────────────────────────────────────────┘                │
│                                                                          │
│  ╔═══════╗   ╔═══════╗   ╔═══════╗   ╔═══════╗   ╔═══════╗   ╔════════╗ │
│  ║  0    ║──▶║  I    ║──▶║  II   ║──▶║  III  ║──▶║  IV   ║──▶║   V    ║ │
│  ║ STONE ║   ║ FIRE  ║   ║ METAL ║   ║ STEAM ║   ║ ELEC  ║   ║DIGITAL ║ │
│  ╚═══════╝   ╚═══════╝   ╚═══════╝   ╚═══▲═══╝   ╚═══════╝   ╚════════╝ │
│   ░░░░░░░     ▒▒▒▒▒▒▒     ▓▓▓▓▓▓▓     ███████     ░░░░░░░     ░░░░░░░░  │
│                                                                          │
│   Tier III contents:                                                     │
│   ✓ charcoal kiln          ✓ small forge         ◐ electric motor       │
│   ✓ lime kiln              ✓ wood lathe          ◐ wind turbine         │
│   ◐ coal smelting          ◯ telegraph wire      ◯ vacuum tube          │
│                                                                          │
│   Each ✓/◐/◯ links to one or more POINTERS into the KB archives.        │
│   Status is operator-marked. The system does not infer reachability.    │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [↑↓] tier  [Enter] drill in  [/] search  [T] tree view  [M] mark  [q]   │
└──────────────────────────────────────────────────────────────────────────┘
```

### What changed from revision 1

- The "next gate" line is gone. The system does not predict what the next bottleneck is. The operator can write a free-text **note** instead.
- Status of each node is **operator-marked only**. Revision 1 implied automatic inference from INVENTORY, which would require the system to reason about what counts as "having" something. It doesn't. Operator decides.

### Data model

```sql
CREATE TABLE atlas_tier (
  id          INTEGER PRIMARY KEY,
  ordinal     INTEGER UNIQUE,
  name        TEXT,
  description TEXT
);

CREATE TABLE atlas_node (
  id          INTEGER PRIMARY KEY,
  tier_id     INTEGER REFERENCES atlas_tier(id),
  slug        TEXT UNIQUE,
  name        TEXT,
  summary     TEXT,
  state       TEXT  -- 'unmarked','available','in_progress','achieved','blocked'
);

CREATE TABLE atlas_prereq (
  node_id     INTEGER REFERENCES atlas_node(id),
  requires_id INTEGER REFERENCES atlas_node(id),
  PRIMARY KEY (node_id, requires_id)
);

CREATE TABLE atlas_pointer_link (   -- many-to-many: node ↔ pointer
  node_id     INTEGER REFERENCES atlas_node(id),
  pointer_id  INTEGER REFERENCES pointer(id),
  PRIMARY KEY (node_id, pointer_id)
);

CREATE TABLE atlas_note (
  id          INTEGER PRIMARY KEY,
  scope       TEXT,    -- 'tier' or 'node'
  ref_id      INTEGER, -- tier.id or node.id
  body        TEXT,
  updated_at  INTEGER
);
```

Seed data ships as `shell/data/atlas.json`. Updates are version-controlled. Per-deployment local state (marks, notes) lives in the SQLite db.

---

## 3. (T) TREE — capability dependency graph

Unchanged structurally from revision 1, but the "details panel" beneath the focused node is now **pointer-only**: it lists the KB-cited POINTERS for that capability and the substitution paths from SUBSTITUTE. No "time estimate", no "skill level", no "risk" — those are judgments the system can't make and shouldn't fake.

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
│                           │           │                                  │
│  [✓] mechanical lathe ────┘           │                                  │
│                                                                          │
│  ── POINTERS ────────────────────────────────────────────────────────── │
│  ▸ POINTER:motor-from-scratch    → KB:Appropedia/Hand_wound_motor       │
│                                  → KB:Otherpower.com/motor_basics       │
│  ▸ POINTER:alternator-as-motor   → KB:Wikipedia/Alternator (background) │
│                                                                          │
│  ── SUBSTITUTION PATHS ─────────────────────────────────────────────── │
│  ▸ insulators (currently ◐)      → see SUBSTITUTE                       │
│                                                                          │
│  Operator-marked status: ◐ in progress    [press M to change]            │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [hjkl] move  [Enter] focus  [P] pointers  [S]ub  [M]ark  [B]ack  [q]    │
└──────────────────────────────────────────────────────────────────────────┘
```

What's gone: time estimate, skill rating, risk rating. None of those can be honestly produced by the system. They were ornament that looked authoritative.

---

## 4. (P) POINTERS — curated index cards into the KB

This is the renamed and rescoped RECIPES screen. A POINTER is a short structured card that names a build target, lists which KB articles cover it, what capabilities it requires (not what steps to take), what parts you'll need (per the KB), and what it unlocks. **The card body contains no build instructions, no schematics, no step lists.** The operator follows the linked KB articles for that.

### List screen

```
┌─ REBUILD › POINTERS ──────────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│ /charcoal_                                              48 pointers · 4 peer │
│                                                                          │
│  TIER  ID                          NAME                       MARK       │
│  ────  ─────────────────────────   ───────────────────────    ────────   │
│   I    fire-bow-drill              Bow-drill fire making      ✓          │
│   I    fire-flint-steel            Flint & steel ignition     ✓          │
│  >II<  charcoal-mound              Earth-mound charcoal       ◐          │
│   II   charcoal-retort             Retort charcoal            ◯          │
│   II   small-forge                 Brake-drum forge           ✓          │
│   II   lime-kiln                   Field lime kiln            ◯          │
│   III  steam-engine                Single-cylinder engine     ◯          │
│   III  windmill-savonius           Savonius vertical-axis     ◯          │
│   IV   alternator-rewind           Car alternator → genset    ◐          │
│   IV   crystal-radio               Galena crystal receiver    ◯          │
│   V    arduino-from-salvage        AVR from junk boards       ◯          │
│                                                                          │
│  ── PEER ENDORSEMENTS ───────────────────────────────────────────────── │
│   II   charcoal-mound              KILO-7 added a journal entry          │
│   IV   alternator-rewind           ECHO-1 marked complete                │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [↑↓] select  [Enter] open  [F]ilter  [/] search  [S]hare journal  [q]   │
└──────────────────────────────────────────────────────────────────────────┘
```

Mark column is the operator's status: `✓` achieved, `◐` in progress, `◯` not started, `⚠` blocked. There is no "active/ready/locked" inferred state — system doesn't pretend to know.

### Pointer card format

A pointer is a short markdown file in `shell/data/pointers/<id>.md`. Front-matter is structured. Body is a short orientation paragraph and a links list. Not a build document.

#### Sample 1 — `pointers/charcoal-mound.md`

```markdown
---
id: charcoal-mound
name: Earth-mound charcoal
tier: II
atlas_node: charcoal-kiln
yields: charcoal
parts_summary:
  - hardwood (oak/ash/hickory), bulk
  - earth/soil, bulk
  - water (emergency damping)
  - long-handled rake, shovel
prerequisites_atlas:
  - controlled-fire
  - axe-or-saw
unlocks_atlas:
  - small-forge
  - lime-kiln
kb_articles:
  - archive: Appropedia
    article: Charcoal_production
    section: Traditional methods
  - archive: Wikipedia
    article: Charcoal
    section: Traditional methods
related_pointers:
  - charcoal-retort
  - small-forge
related_modules:
  - MEDICAL › TRIAGE › BURNS    # for the burn risk during the build
  - MEDICAL › TRIAGE › SMOKE    # for smoke inhalation
---

## What this is

A traditional method of making charcoal — the gateway fuel for any forge,
foundry, or blacksmithing work. The KB articles cover the actual build
procedure. This card is just the index card for finding them.

## Where to read

Open `KNOWLEDGE › LIBRARY` and follow the linked articles in order:

1. **Appropedia / Charcoal_production** — practical, illustrated, with
   safety section. Start here.
2. **Wikipedia / Charcoal § Traditional methods** — historical context
   and variations.

## Safety cross-references

This is a multi-day attended fire. Before starting, review:

- `MEDICAL › TRIAGE › BURNS`
- `MEDICAL › TRIAGE › SMOKE INHALATION`

## When you're done

Mark this pointer in `POINTERS` and consider sharing your journal over
COMMS `/builds`. The system propagates your journal entry, not the
build itself — the build is in the KB.
```

That's the entire card. No schematic, no step list, no caveats invented by an LLM. The build instructions live where they were authored — in the KB archive, by people who knew what they were writing about.

#### Sample 2 — `pointers/crystal-radio.md`

```markdown
---
id: crystal-radio
name: Galena crystal receiver
tier: III
atlas_node: crystal-radio
yields: AM-band receiver, no battery
parts_summary:
  - galena crystal OR germanium diode
  - enamelled copper wire
  - tube former (cardboard/PVC)
  - high-impedance earphone or piezo
  - long wire antenna, earth ground
prerequisites_atlas:
  - copper-wire
  - simple-tools
unlocks_atlas:
  - regenerative-receiver
  - signal-detection
kb_articles:
  - archive: Appropedia
    article: Crystal_radio
  - archive: Wikipedia
    article: Crystal_radio
  - archive: WikiBooks
    article: Electronics/Crystal_radio
related_pointers:
  - antenna-longwire
  - earphone-high-impedance
related_modules:
  - SIGNAL › LOG    # for logging received frequencies
---

## What this is

A radio receiver that needs no battery, powered entirely by the radio
waves it receives. Tunes the AM broadcast band and some shortwave. The
KB articles cover the build, the schematic, and the tuning procedure.

## Where to read

Open `KNOWLEDGE › LIBRARY` and read in order:

1. **WikiBooks / Electronics / Crystal_radio** — clearest schematic and
   parts walkthrough.
2. **Appropedia / Crystal_radio** — practical builder notes.
3. **Wikipedia / Crystal_radio** — theory and historical context.

## Notes

- Antenna length matters more than any other variable. Read the section
  on antennas before sourcing parts.
- A "high-impedance" earphone is critical and unusual today. The KB
  articles discuss substitutes.

## When you're done

Mark this pointer. If you log received stations and frequencies, those
go in `SIGNAL › LOG`.
```

### Authoring discipline

Pointers are markdown in the repo. Editing is a code change. **The system never generates a pointer.** The `(N)ew` action in the UI is gone — there is no in-product authoring path for pointer cards. They exist only as curated content the operator can read and mark.

What the operator *can* author is **journal entries** under PROJECTS (next section). Journals are operator-written; the system stores and propagates them.

### API endpoints

```
GET    /api/b/pointers
GET    /api/b/pointers/:id
GET    /api/b/pointers/:id/parts        # structured parts list (joins INVENTORY)
POST   /api/b/pointers/:id/start        # creates a project from this pointer
POST   /api/b/pointers/:id/mark         # operator mark: ach./prog./blocked
```

No POST to create or modify pointers. No /llm endpoints.

---

## 5. (S) SUBSTITUTE — pure curated lookup

What it was: a curated lookup with an LLM fallback when the table came up empty.
What it is now: a curated lookup. Period. If the table comes up empty, the system says so.

### Layout

```
┌─ REBUILD › SUBSTITUTE ────────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  Need:  copper wire, enamelled, 0.5mm                                    │
│  For:   crystal-radio coil  (auto-detected from PROJECTS)                │
│                                                                          │
│  ── SUBSTITUTES (from curated material database) ──────────────────── │
│                                                                          │
│   ◆ 1  SALVAGED COPPER WIRE                                  [BEST]      │
│        From:    motor windings, transformer windings, building            │
│                 cable (strip insulation), telephone cable                 │
│        Caveat:  enamel may be damaged on salvaged windings;               │
│                 inspect for nicks                                         │
│        Source:  KB: Appropedia / Wire                                     │
│                                                                          │
│   ◆ 2  ALUMINIUM WIRE                                        [PARTIAL]   │
│        Works for: low-frequency power, NOT for RF coils                   │
│        Caveat:  20% lower conductivity; oxidation at joints; do NOT       │
│                 use for crystal-radio coil — Q factor too low             │
│        Source:  KB: ARRL Handbook Ch.20                                   │
│                                                                          │
│  ── ADJACENT QUERIES ──────────────────────────────────────────────── │
│   See also:  [SUBSTITUTE: enamel coating]  [SUBSTITUTE: insulation]      │
│                                                                          │
│  ── DATABASE STATUS ────────────────────────────────────────────────── │
│  2 results from curated material database. No LLM augmentation.          │
│  If your need is not in this database, it is not in this database —      │
│  consult KB articles via KNOWLEDGE for unindexed materials.               │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [↑↓] select  [Enter] details  [P] add to project  [/] new search  [q]   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Database

Same schema as revision 1, ~200 hand-curated entries shipped as JSON seed. Every entry cites a KB source. Empty queries return empty — no LLM fallback, no `[L]` key, no rate-limited speculation.

```sql
CREATE TABLE material (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE,
  name TEXT,
  properties JSON,
  hazards TEXT
);

CREATE TABLE material_substitute (
  for_id INTEGER REFERENCES material(id),
  use_id INTEGER REFERENCES material(id),
  rank INTEGER,        -- 1=best, 2=partial, 3=poor
  context TEXT,        -- 'rf-coil','power-wire','structural'
  caveat TEXT,
  source TEXT,         -- KB citation, mandatory
  PRIMARY KEY (for_id, use_id, context)
);
```

`source` is `NOT NULL`. No row enters this table without a KB citation.

### API endpoints

```
GET  /api/b/substitute?need=<slug>&context=<slug>
```

That's it. No POST. No /llm.

---

## 6. (J) PROJECTS — operator-authored journal

Where the operator's actual knowledge accumulates. A project is an instance of a pointer being followed. The system stores: which pointer, when started, parts checklist, marked status per step (operator's own steps, not pointer-supplied), and free-text journal entries.

### List

```
┌─ REBUILD › PROJECTS ──────────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  ID  POINTER                STARTED       JOURNAL    STATUS              │
│  ──  ──────────────────────  ──────────    ───────    ──────────         │
│  17  charcoal-mound          2026-04-12    7 entries  active             │
│  18  alternator-rewind       2026-04-19    3 entries  blocked: enamel    │
│  19  brake-drum-forge        2026-04-22    1 entry    parts gathering    │
│  20  rocket-mass-heater      2026-04-25    12 entries ✓ complete         │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [N]ew from pointer  [Enter] open  [L]og entry  [?] help  [q] back        │
└──────────────────────────────────────────────────────────────────────────┘
```

### Detail view

The pointer card at top (read-only). Operator-defined parts checklist below (cross-referenced against INVENTORY). Then the journal — a chronological list of operator-authored entries. `L` adds a new entry, pre-tagged with the project ID, also visible in TIMELINE and LOG.

The system contributes nothing to the journal except the timestamp. Every word in it was written by the operator. That's what makes it shareable across the mesh — it is grounded in real attempts.

### Data model

```sql
CREATE TABLE project (
  id INTEGER PRIMARY KEY,
  pointer_id INTEGER REFERENCES pointer(id),
  started_at INTEGER,
  status TEXT,                   -- 'active','blocked','complete','abandoned'
  status_note TEXT
);

CREATE TABLE project_parts (
  project_id INTEGER REFERENCES project(id),
  material_slug TEXT,
  required_qty REAL,
  on_hand_qty REAL,
  notes TEXT
);

CREATE TABLE project_journal (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES project(id),
  body TEXT,                     -- operator-authored, markdown
  created_at INTEGER,
  shared INTEGER DEFAULT 0       -- has this entry been broadcast?
);
```

### API endpoints

```
GET    /api/b/projects
POST   /api/b/projects                  # from a pointer_id
GET    /api/b/projects/:id
PATCH  /api/b/projects/:id              # status, notes
POST   /api/b/projects/:id/journal      # new entry
GET    /api/b/projects/:id/journal
POST   /api/b/projects/:id/share        # mark for COMMS broadcast
```

---

## 7. COMMS interaction — sharing journals over the mesh

This is what becomes valuable in a multi-operator setting: not LLM-generated recipes propagating, but **operator-written journal entries** moving between nodes. "I followed the Appropedia charcoal article. Here's what I changed and what happened." That's real signal.

### What propagates over OMP

Three things, with this trust labelling:

| Kind | Tag in UI | Description |
|---|---|---|
| Pointer mark | `[CANON]` | "Operator KILO-7 marked pointer X as achieved" — reference to a canonical pointer, no payload beyond the mark |
| Journal entry | `[PEER]` | Operator-written prose attached to a project, signed by their key |
| ATLAS milestone | `[CANON]` | "KILO-7 reached tier III" — derived from pointer marks |

**Nothing else propagates.** No DRAFT_SHARE. No LLM-generated content. No SUBSTITUTE_REPLY (the substitute table is curated and ships with the system; there's no peer-augmented version).

### Revised OMP opcodes

Reserve in the `0x60-0x6F` range (REBUILD module):

```
0x60  POINTER_MARK        operator marked pointer X with status Y
0x61  JOURNAL_ENTRY       operator-authored prose for project Z (gzipped)
0x62  JOURNAL_REQUEST     "send me journals for pointer X from anyone"
0x63  ATLAS_MILESTONE     derived: operator reached tier T
```

Removed from revision 1: `RECIPE_ADVERTISE`, `RECIPE_REQUEST`, `RECIPE_PAYLOAD`, `SUBSTITUTE_QUERY`, `SUBSTITUTE_REPLY`, `DRAFT_SHARE`. These all assumed peer-shareable build content. With pointers being canonical-only and substitute being curated-only, none of them are needed.

### COMMS UI surface

The `/builds` board still exists, with a tighter scope:

```
┌─ COMMS › BOARDS › /builds ────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  TIME       FROM       SUBJECT                              KIND         │
│  ─────────  ─────────  ──────────────────────────────────   ─────────    │
│  04-25 14h  KILO-7     journal: charcoal-mound day 3          [PEER]     │
│  04-25 11h  TANGO-3    journal: lime-kiln day 2               [PEER]     │
│  04-24 19h  KILO-7     marked achieved: small-forge           [CANON]    │
│  04-24 16h  ECHO-1     journal: alternator-rewind complete    [PEER]     │
│  04-23 09h  --SYS--    ATLAS: TANGO-3 reached tier III        [CANON]    │
│  04-21 17h  KILO-7     marked complete: charcoal-retort       [CANON]    │
│                                                                          │
│  ── PREVIEW ───────────────────────────────────────────────────────── │
│   FROM:     KILO-7  (key: 7c4a..91ef)                                   │
│   POINTER:  charcoal-mound                                              │
│   PROJECT:  #14, day 3                                                  │
│                                                                          │
│   "Mound burned hotter than expected on day 1 — closed three vents on   │
│    the windward side and that brought it back. Yield estimate looks     │
│    good for day 4 opening. The Appropedia article warns about wind      │
│    direction; I should have read that twice before siting."             │
│                                                                          │
│   [I] save to my journal references                                     │
│   [R] reply (private to KILO-7)                                         │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [↑↓] select  [Enter] open  [I] save  [R]eply  [N]ew post  [B]ack  [q]   │
└──────────────────────────────────────────────────────────────────────────┘
```

The "import" verb is gone — there's nothing to import in revision 2, because no peer is sending recipes. The verb is `[I] save to journal references`, which copies the entry into a personal "things I want to remember" list, plain text, attributable to whoever wrote it.

### A scenario, end-to-end (revised)

> KILO-7 successfully follows the Appropedia charcoal article and writes a project journal for `charcoal-mound`. Six entries over four days, including modifications they tried (narrower base, two extra vents) and how those worked.
>
> They press `(S)hare` on the project. The system broadcasts each journal entry as a `0x61 JOURNAL_ENTRY` packet, plus a `0x60 POINTER_MARK` setting their status to `achieved`. Total payload across the four days: ~3KB compressed.
>
> TANGO-3 sees the entries appear on `/builds`. They read KILO-7's notes and decide to attempt their own mound. They start their own project on the same canonical pointer. They reference KILO-7's journal in their own first entry: "Going to try KILO-7's narrower-base modification."
>
> Three weeks later, ECHO-1 joins the mesh. The pointer is canonical and unchanged — it's the same Appropedia link it always was. What ECHO-1 also receives is the catalog of journal entries from KILO-7 and TANGO-3, two operators who actually built the thing. ECHO-1 can read what worked, what didn't, what to watch out for.
>
> The system has not authored anything. Knowledge has accumulated as operator testimony, plainly attributed, plainly dated, plainly signed.

This is the scenario revision 1 was reaching for, without the LLM-authorship problem.

---

## 8. Build priority (revised)

If REBUILD is one sprint:

1. **ATLAS first.** Static, no LLM, motivational. ~3 days incl. seed data.
2. **POINTERS list + reader.** Markdown rendering with strict front-matter. ~2 days. Ship with 30 hand-written pointers — that's the long pole.
3. **PROJECTS** with INVENTORY join and journal. ~3 days.
4. **SUBSTITUTE.** Pure lookup. ~2 days incl. ~200 material entries.
5. **TREE.** Layout work over POINTERS data. ~3 days.
6. **COMMS integration** as a follow-up sprint, gated on REBUILD core stable.

Total: ~2 weeks of focused engineering, plus the pointer + material-database authoring (which is where the actual value is, and which a developer or trusted contributor curates by hand from the KB archives).

Lower than revision 1's 3-week estimate, because the DESIGN sub-screen and the LLM prompt-engineering work are gone.

---

## 9. What this module deliberately does NOT do

- **It does not author build instructions.** Every step in every build comes from the KB archives. The system points at them.
- **It does not generate technical content.** No schematics, no diagrams, no step lists, no failure-mode analysis — those are the things people get hurt by when an LLM gets them wrong.
- **It does not reason about reachability.** The operator marks status. The system stores marks. It does not predict "what's next" or "you're close to X" — that's an inference the system can't honestly make.
- **It does not host an LLM surface.** If the operator wants to ask the model about a build, that's KNOWLEDGE › CHAT. KB augmentation is on by default. That surface is already audited and clearly framed as conversational, not authoritative.
- **It does not gamify.** No XP, no badges, no nudges.

---

## 10. What changed about the trust model

Revision 1 had a four-tier trust model: RECIPES (curated), KB synthesis, LLM reasoning, speculation. The bottom two tiers (`[GEN]` and `[SPEC]`) were the ones doing the dangerous work — generating content with caveats stapled on. Caveats don't survive contact with stress.

Revision 2 has a two-tier trust model:

| Layer | Source | Authority |
|---|---|---|
| KB archives | Authored by domain experts, shipped as ZIM | High |
| Operator journals | Authored by named, keyed operators with mesh-attested attempts | Medium, transparent |

The system is the indexer and the postal service. Authority for technical content lives where it was written. Authority for "what worked when I tried it" lives with the operator who tried it. Nothing in between.

---

## 11. Diff vs revision 1 (full)

```
- Sub-screen DESIGN                                                 [REMOVED]
- Sub-screen RECIPES                                                [RENAMED to POINTERS]
- Recipe authoring (LLM-assisted)                                   [REMOVED]
- Recipe drafts (DRAFTS sub-tab, local)                             [REMOVED]
- LLM rate limits, citation policy, prompt structure                [REMOVED]
- [KB] / [GEN] / [SPEC] tagging system                              [REMOVED]
- Sample recipe charcoal-mound.md (full build doc with schematic)   [DELETED]
- Sample recipe crystal-radio.md (full build doc with schematic)    [DELETED]
+ Sample pointer charcoal-mound.md (index card, links to KB)        [ADDED]
+ Sample pointer crystal-radio.md (index card, links to KB)         [ADDED]

- TREE detail panel: time/skill/risk fields                         [REMOVED]
+ TREE detail panel: pointers list + substitution paths             [REVISED]

- ATLAS: "next gate" auto-inferred                                  [REMOVED]
+ ATLAS: operator-authored notes per tier/node                      [ADDED]
+ ATLAS: status is operator-marked only, not inferred               [CLARIFIED]

- SUBSTITUTE: LLM augmentation when table empty                     [REMOVED]
- SUBSTITUTE: [L] key for LLM speculation                           [REMOVED]
+ SUBSTITUTE: empty queries return empty, no fallback               [REVISED]

- OMP opcode 0x62 RECIPE_PAYLOAD                                    [REMOVED]
- OMP opcode 0x64 SUBSTITUTE_QUERY                                  [REMOVED]
- OMP opcode 0x65 SUBSTITUTE_REPLY                                  [REMOVED]
- OMP opcode 0x67 DRAFT_SHARE                                       [REMOVED]
- OMP opcode 0x60 RECIPE_ADVERTISE  → repurposed as POINTER_MARK
- OMP opcode 0x61 RECIPE_REQUEST    → repurposed as JOURNAL_ENTRY
+ OMP opcode 0x62 JOURNAL_REQUEST                                   [ADDED]
+ OMP opcode 0x63 ATLAS_MILESTONE                                   [unchanged number, kept]

- /builds board: import peer recipes                                [REMOVED]
+ /builds board: save journal entries to references                 [REVISED]

- Trust tiers: CANON / KB / GEN / SPEC                              [REMOVED]
+ Trust tiers: CANON (KB+pointers) / PEER (operator journals)       [REVISED]

- Build priority: ~3 weeks                                          [REVISED to ~2 weeks]
- Section: "What this module does NOT do" — gamification only       [EXPANDED to authorship, reasoning, LLM surface]
```

End of REBUILD spec, revision 2.
