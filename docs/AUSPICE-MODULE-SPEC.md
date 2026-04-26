# AUSPICE — Module Spec (v3 addendum)

> Slot in alongside REBUILD and RECREATION. Optional dependency on COMMS for reader↔querent flows. Separate dependency on a journal encryption layer (specced below) shared with any future modules that need at-rest encryption with operator PIN.
>
> Hotkey: `(U)` — `S` is taken by SYSTEM, `A` by ATLAS within REBUILD. `(U)` reads as "auspice" mnemonically and is currently unassigned.
>
> **Tone discipline.** This module covers spirituality, divination, and personal reflection. Overseer's general voice is operational, factual, dry. AUSPICE keeps that voice — traditional content is rendered as reference material (cited from sources), the operator supplies the meaning. The system never speaks in mystical voice. No "the cards reveal," no "the universe whispers." A card is presented with its sources and traditional meanings; what it means *to the operator* is the operator's job.

---

## 0. Why this module exists

People under sustained stress — disaster, isolation, grief, prolonged uncertainty — reach for meaning-making practices. This is observably true across cultures and across history. Refusing to support that practice doesn't make it go away; it just means the operator does it badly, on a phone with no power, alone.

AUSPICE provides:

- **Real astronomy** that's just calculation against an ephemeris (moon phase, planetary positions, sunrise/sunset, eclipses).
- **Traditional symbolic systems** rendered as curated reference content with cited sources (tarot, I Ching, runes, Western and Vedic astrology, Lenormand, oracle decks, lunar mansions).
- **Structure for personal reflection** — pulling a card, casting a spread, journaling against it.
- **Mesh-native peer-to-peer practice** — a reader and querent on different nodes can share a tarot reading the way they would across a kitchen table.

It does not provide:

- LLM-generated mystical content of any kind, ever, anywhere in the module.
- Predictions, forecasts, or claims about reality.
- Authoritative interpretation. Traditional meanings are reference; the operator interprets.

---

## 1. Sub-screens

```
AUSPICE
├── (S) SKY          Live astronomy: moon, sun, planets, sabbats, eclipses
├── (C) CHART        Birth chart calculator (Western + Vedic)
├── (T) TAROT        Solo readings + COMMS reader↔querent spreads
├── (O) ORACLE       Multi-tradition: I Ching, runes, Lenormand, oracle decks
├── (D) DAILY        Card-of-the-day, moon-of-the-day, optional journal prompt
├── (J) JOURNAL      Encrypted reflections, cross-linked to readings
└── (A) ALMANAC      Sabbats, lunar calendar, seasonal markers, year wheel
```

Hotkey row: `[S]ky [C]hart [T]arot [O]racle [D]aily [J]ournal [A]lmanac  [/] search  [?] help  [q]`

---

## 2. Theme — the purple sub-theme

AUSPICE shifts the PHOSPHOR theme accent from green to deep purple. This is the only module that does so; it's the visual cue that you're in a different mode. The base PHOSPHOR scaffolding (frames, status strip, breadcrumb, F-key bar) stays green to keep continuity with the rest of Overseer. Only the module-internal accents shift.

```css
/* AUSPICE sub-theme tokens (override accent inside this module only) */
--accent:     #b88cff;   /* lavender */
--accent-hi:  #d877ff;   /* magenta-violet */
--accent-dim: #6b4d99;   /* dim violet */
--magic:      #9d4edd;   /* deep purple, used for selection */
```

Block-character washes (`░▒▓█`) inside AUSPICE use the violet ramp. Status strip and frame chrome remain green.

Other themes (AMBER, IBM, PAPER, ACID) get their own AUSPICE accent shift:

| Base theme | AUSPICE accent |
|---|---|
| PHOSPHOR | violet `#b88cff` |
| AMBER | rose `#ff8c8c` |
| IBM | sky `#7ec8ff` |
| PAPER | aubergine `#5a3a6a` on warm white |
| ACID | hot pink `#ff66cc` |

This is encoded as a `module_accent` token set the renderer applies when AUSPICE is active.

---

## 3. (S) SKY — live astronomy

Pure calculation, no interpretation, no LLM. Astronomy is math; this screen does the math.

### Layout

```
┌─ AUSPICE › SKY ───────────────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  ☉ 26 APR 2026 · 14:22 BST · 51.5074°N 0.1278°W                          │
│                                                                          │
│  ┌─ MOON ─────────────────────────────────┐                              │
│  │                                        │                              │
│  │              ▓▓▓▓▓░░░                  │   Phase:    waxing gibbous   │
│  │           ▓▓▓▓▓▓▓░░░░░                 │   Illum:    78.4%            │
│  │          ▓▓▓▓▓▓▓▓░░░░░░                │   Age:      9.3 days         │
│  │          ▓▓▓▓▓▓▓▓░░░░░░                │   Next ●:   30 APR 04:13     │
│  │           ▓▓▓▓▓▓▓░░░░░                 │   (full moon, Scorpio)       │
│  │              ▓▓▓▓▓░░░                  │                              │
│  │                                        │   Sign:     ♏ Scorpio        │
│  │                                        │   Mansion:  17 (Al Qalb)     │
│  └────────────────────────────────────────┘                              │
│                                                                          │
│  ┌─ SUN ──────────────────────────────────────────────────────┐          │
│  │  Rise: 05:44   Transit: 13:01   Set: 20:18   Day: 14h 34m  │          │
│  │  Position: 6° ♉ Taurus    Solar term: between equinox & sol│          │
│  └────────────────────────────────────────────────────────────┘          │
│                                                                          │
│  ┌─ PLANETS (geocentric) ────────────────────────────────────┐           │
│  │  ☿ Mercury   12° ♉ Taurus      direct                     │           │
│  │  ♀ Venus     22° ♈ Aries       direct                     │           │
│  │  ♂ Mars       4° ♋ Cancer      direct                     │           │
│  │  ♃ Jupiter   18° ♋ Cancer      direct                     │           │
│  │  ♄ Saturn     1° ♓ Pisces      retrograde                 │           │
│  │  ⛢ Uranus    27° ♉ Taurus      direct                     │           │
│  │  ♆ Neptune    2° ♈ Aries       direct                     │           │
│  │  ♇ Pluto      4° ♒ Aquarius    retrograde                 │           │
│  └────────────────────────────────────────────────────────────┘          │
│                                                                          │
│  Upcoming:  · 30 APR  full moon ●        · 06 MAY  ♀ enters ♉            │
│             · 13 MAY  ♄ stations direct   · 21 MAY  sun → ♊ Gemini      │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [→] tomorrow  [←] yesterday  [J] jump date  [C] chart  [A]lmanac  [q]   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Implementation

- Uses **Skyfield** (Python) or **astronomy-engine** (pure-JS) against a bundled JPL ephemeris (DE440, ~30MB, covers 1550-2650).
- Moon ASCII rendering: 8 phase glyphs at low fidelity, or a generated block-character mask at higher fidelity. The displayed mask is computed from actual illumination percentage, not pre-baked.
- Times computed for the operator's location (from Maps/GPS in v2, or manually set).
- Lunar mansion is the 28-mansion Arabic system (`Al Sharatain`, `Al Butain`, ..., `Al Risha`) — purely positional, well-documented.

### Data needed

- `de440.bsp` ephemeris (~30MB)
- `iers_data.txt` (timezone/leap-second adjustments)
- Static reference: lunar mansion definitions, sabbat dates, traditional zodiac glyphs

### API endpoints

```
GET /api/u/sky?at=<iso>&lat=<lat>&lon=<lon>
GET /api/u/sky/upcoming?days=30
```

Returns JSON; rendering happens client-side. A SKY response is ~2KB — fits in a few LoRa packets.

---

## 4. (C) CHART — birth chart calculator

Same engine as SKY, but anchored to a birth moment and rendered as the traditional chart wheel.

### Layout

```
┌─ AUSPICE › CHART ─────────────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  Born:  1987-03-14 · 03:42 UTC · Brighton UK (50.82°N 0.14°W)            │
│  System: Western tropical, Placidus houses                               │
│                                                                          │
│              ╭──────────── X · MC ────────────╮                          │
│         XI ╱                                  ╲ IX                       │
│           ╱       ☿  ☉                         ╲                         │
│          ╱   XII   ♉                  ♏    VIII ╲                        │
│   XII   │                ♋    ♓                  │ IX                    │
│         │ ♈                          ☾  ♀  ♃    │                       │
│   ── I ─┤AS                                      ├─ DS ──                │
│         │ ♉                          ♎    ♂      │ VII                   │
│   II    │                ♊    ♍                  │ VI                    │
│          ╲     III          IV         V          ╱                      │
│           ╲       ♇                            ♄ ╱                       │
│         IV ╲                                  ╱ V                        │
│              ╰──────────── IV · IC ────────────╯                         │
│                                                                          │
│  ── ASPECTS ──────────────────────────────────────────────────────────  │
│   ☉ ☌ ☿  4°    conjunction   sun · mercury                               │
│   ♀ △ ♃  2°    trine         venus · jupiter                             │
│   ♂ □ ♄  6°    square        mars · saturn                               │
│   ☾ ☍ ♅  1°    opposition    moon · uranus                               │
│                                                                          │
│  ── INTERPRETATIONS ─────────────────────────────────────────────────── │
│  Each placement links to traditional reference text:                    │
│   ▸ ☉ in ♓ Pisces · house IX     [traditional reading]                  │
│   ▸ ☾ in ♎ Libra · house IV      [traditional reading]                  │
│   ▸ AS in ♈ Aries                [traditional reading]                  │
│   ▸ ☉ ☌ ☿ aspect                  [traditional reading]                  │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [↑↓] aspect  [Enter] read  [V]edic view  [E]xport  [N]ew  [q]           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Two systems supported

- **Western tropical**, Placidus houses (the most common modern Western system)
- **Vedic sidereal**, whole-sign houses, with nakshatras (the most common Indian system)

Operator can toggle between them with `V`. Both calculations are real; both are displayed against their own canonical reference text.

### Interpretations are reference text, not generated prose

Each placement (`sun in Pisces`, `moon in 4th house`, `Mars square Saturn`) opens a reference page from `auspice/data/astrology/`. The text is hand-authored from cited public-domain sources (e.g. Manilius's *Astronomica*, Lilly's *Christian Astrology*, Parashara for Vedic). Front-matter cites the source. Body is traditional meaning, kept short — the system is a reference, not a textbook.

```markdown
---
id: sun-in-pisces
system: western-tropical
sources:
  - "Lilly, William. *Christian Astrology*, 1647. Book I §15."
  - "Manilius. *Astronomica*, c. 30 CE. Book IV."
---

## ☉ Sun in ♓ Pisces

Traditional attribution: **Mutable, water, ruled by Jupiter (traditional)
or Neptune (modern).** The sun in Pisces is in detriment in some
classical schemes (Mercury rules the opposite sign).

Lilly describes Pisces as "phlegmatic, cold, moist, watery, weak,
feminine, nocturnal" and the placement as conducing toward "an idle
disposition, much addicted to drink and women" — a reading more about
his era than ours. Modern traditional readings emphasise empathy,
imagination, and a tendency toward dissolution of boundaries.

The reflective question: where in your life are you porous?
```

That last line — "the reflective question" — is the closest the system comes to anything mystical. It's a prompt for the operator's own thought, sourced from contemporary practitioner writing where it's been taken from.

### Birth chart entry

Operator enters: birthdate, birthtime (with "approximate" toggle for those who don't know exact time, which falls back to whole-sign houses and disables the AS/MC), location (geocoded from a bundled city list, or lat/lon).

Charts are saved per-operator. Multiple charts (own, partner, kids, friends) supported.

### API endpoints

```
POST /api/u/chart                     create from birth data
GET  /api/u/chart/:id
GET  /api/u/chart/:id/aspects
GET  /api/u/astrology/ref/:placement  fetch the reference markdown
```

---

## 5. (T) TAROT — solo and reader↔querent

The flagship interactive screen. Two modes: solo (operator pulls cards for themselves) and COMMS (reader on one node, querent on another).

### 5.1 Solo mode

```
┌─ AUSPICE › TAROT › SOLO ──────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  Deck:    Rider-Waite-Smith (canonical)        [press D to change]      │
│  Spread:  Three-card · past · present · future  [press S to change]     │
│                                                                          │
│  Question:  what should I focus on this season?                          │
│                                                                          │
│  ╭─────────────╮     ╭─────────────╮     ╭─────────────╮                │
│  │ ╳ ╳ ╳ ╳ ╳ ╳ │     │ ╳ ╳ ╳ ╳ ╳ ╳ │     │ ╳ ╳ ╳ ╳ ╳ ╳ │                │
│  │ ╳         ╳ │     │ ╳         ╳ │     │ ╳         ╳ │                │
│  │ ╳   ?     ╳ │     │ ╳   ?     ╳ │     │ ╳   ?     ╳ │                │
│  │ ╳         ╳ │     │ ╳         ╳ │     │ ╳         ╳ │                │
│  │ ╳ ╳ ╳ ╳ ╳ ╳ │     │ ╳ ╳ ╳ ╳ ╳ ╳ │     │ ╳ ╳ ╳ ╳ ╳ ╳ │                │
│  ╰─────────────╯     ╰─────────────╯     ╰─────────────╯                │
│      PAST              PRESENT             FUTURE                        │
│                                                                          │
│  Press [Space] to flip the next card.                                   │
│                                                                          │
│  Shuffle: cryptographic, seeded from clock + entropy at draw time       │
│  Drawn:   0 of 3                                                        │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [Space] flip next  [R]eshuffle  [D]eck  [S]pread  [Q]uestion  [J]ournal │
└──────────────────────────────────────────────────────────────────────────┘
```

After flipping all three:

```
┌─ AUSPICE › TAROT › SOLO ──────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  Deck: Rider-Waite-Smith    Spread: three-card past/present/future      │
│  Question: what should I focus on this season?                          │
│                                                                          │
│  ╭─────────────╮     ╭─────────────╮     ╭─────────────╮                │
│  │             │     │             │     │             │                │
│  │   ╱│        │     │     ▲       │     │      ☉      │                │
│  │  ╱ │        │     │    ╱│╲      │     │   ───────   │                │
│  │   ████      │     │   ─┼─┼─     │     │      ▲      │                │
│  │   THE       │     │     │       │     │     ╱│╲     │                │
│  │   FOOL      │     │  THE  TOWER │     │   THE  SUN  │                │
│  │     0       │     │    XVI      │     │    XIX      │                │
│  ╰─────────────╯     ╰─────────────╯     ╰─────────────╯                │
│      PAST              PRESENT             FUTURE                        │
│                                                                          │
│  ── PAST · THE FOOL · 0 ─────────────────────────────────────────────── │
│  Beginnings, leaps of faith, naive openness, the start of a journey     │
│  taken without full knowledge of where it leads. Trust, innocence,      │
│  potential. Reversed: recklessness, foolishness ignored.                │
│  ↳ source: Waite, *Pictorial Key to the Tarot*, 1910                     │
│                                                                          │
│  ── PRESENT · THE TOWER · XVI ──────────────────────────────────────── │
│  Sudden upheaval, the breaking of false structures, revelation through  │
│  shock. What was built on poor foundation comes down. Hard but often    │
│  necessary. Reversed: avoiding the inevitable.                          │
│  ↳ source: Waite, *Pictorial Key to the Tarot*, 1910                     │
│                                                                          │
│  ── FUTURE · THE SUN · XIX ─────────────────────────────────────────── │
│  Clarity, vitality, success, joy. The simple uncomplicated good.        │
│  Reversed: clouded judgement, false confidence.                         │
│  ↳ source: Waite, *Pictorial Key to the Tarot*, 1910                     │
│                                                                          │
│  ┌─ Reflection ──────────────────────────────────────────────────────┐ │
│  │ The cards are reference points for your own thought. What do      │ │
│  │ they bring up? Press [J] to journal your reflection.              │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [J]ournal  [N]ew reading  [S]ave reading  [E]xport  [B]ack  [q]         │
└──────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Reader↔querent mode (COMMS)

This is the genuinely novel piece. Reader and querent are different operators, possibly on different nodes connected only by LoRa mesh. The ritual is:

1. **Querent** opens TAROT, selects "request reading" mode, picks a reader from their COMMS contacts, types a question (or "no question — open reading").
2. The system sends a `0x70 READING_REQUEST` packet to the reader.
3. **Reader** receives notification, accepts. Picks the deck and spread.
4. **Querent** is shown a "shuffle" interface — they hold a key (any key) and the entropy of the hold-time + their key-press timings is used as the shuffle seed. They press Enter when "the deck feels right."
5. The shuffled deck order is committed: a hash of `(seed, deck_id, spread, timestamp)` is signed by the querent and sent to the reader.
6. **Reader** sees the spread layout with face-down cards. They flip them one at a time, choosing the rhythm. Each flip transmits the card position and the card identity (already determined by step 5's commitment).
7. Both sides watch the cards turn over together, in sync.
8. **Reader** speaks (over mesh chat, voice, or in person if co-located). The system shows them the canonical meanings as reference; the reader's actual interpretation goes in the chat sidebar of the spread.
9. When done, the spread can be saved by either party.

The cryptographic commitment in step 5 is what makes this fair — the querent's shuffle order is locked before the reader sees anything, and the reader can verify it post-flip. It's not strictly necessary for trust between friends but it is the cleanest model and costs nothing.

```
┌─ AUSPICE › TAROT › READING WITH KILO-7 ───────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  Reader:   KILO-7   (you)                Querent:  TANGO-3              │
│  Deck:     Rider-Waite-Smith             Spread:   Celtic Cross (10)    │
│  Question: "what's blocking me right now?"                              │
│                                                                          │
│  Querent shuffled: 14:18:22Z   commitment: ✓ verified                   │
│                                                                          │
│        ╭───╮                                                            │
│        │ 4 │                                                            │
│        ╰───╯                                                            │
│   ╭───╮ ╭───╮ ╭───╮          ╭───╮      reading sidebar (chat):        │
│   │ 5 │ │ 1 │ │ 6 │          │10 │      ─────────────────────────       │
│   ╰───╯ ╰─2─╯ ╰───╯          ╰───╯       reader> drawing now...        │
│        ╭───╮                  ╭───╮                                     │
│        │ 3 │                  │ 9 │       reader> #1 The Hermit         │
│        ╰───╯                  ╰───╯              over #2 Two of Swords  │
│                               ╭───╮                                     │
│                               │ 8 │       reader> there's a withdrawal  │
│                               ╰───╯              you've been making     │
│                               ╭───╮                                     │
│                               │ 7 │       querent> yes                  │
│                               ╰───╯                                     │
│                                                                          │
│  Reader: 6 of 10 cards flipped. Press [Space] to flip next.             │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [Space] flip  [Tab] chat  [V]oice (PTT)  [P]ause  [E]nd reading  [q]    │
└──────────────────────────────────────────────────────────────────────────┘
```

The querent's view is the same layout, but they can't flip — they only see cards as the reader flips them, and they can only chat. They see the canonical meanings appear when each card is flipped, so they can follow along.

### 5.3 Deck format

A deck is a directory: `auspice/decks/<deck-id>/`.

```
auspice/decks/rider-waite-smith/
├── deck.toml          # metadata
├── cards/
│   ├── 00-fool.md
│   ├── 01-magician.md
│   ├── ...
│   └── 77-king-of-pentacles.md
├── art/
│   ├── 00-fool.txt    # ASCII art
│   ├── 01-magician.txt
│   └── ...
└── back.txt           # card-back ASCII
```

`deck.toml`:

```toml
id = "rider-waite-smith"
name = "Rider-Waite-Smith"
short_name = "RWS"
tradition = "tarot"
structure = "rws-78"            # 22 major + 56 minor (4 suits × 14)
suits = ["wands", "cups", "swords", "pentacles"]
court = ["page", "knight", "queen", "king"]
sources = [
  "Waite, A. E. *The Pictorial Key to the Tarot*. London: Rider, 1910.",
  "Smith, Pamela Colman. Original card art, 1909 (PD)."
]
provenance = "canon"            # one of: canon | themed | peer
art_method = "hand-authored"    # hand-authored | themed-builder | peer
theme_of = null                 # if themed, points to source deck id
license = "PD"
```

A card markdown:

```markdown
---
id: 16-tower
number: 16
roman: XVI
arcana: major
name: "The Tower"
keywords: [upheaval, sudden change, revelation, breaking]
sources:
  - "Waite, *Pictorial Key to the Tarot*, 1910, ch.III"
---

## ✶ XVI · The Tower

**Upright:** Sudden upheaval, the breaking of false structures, revelation
through shock. What was built on poor foundation comes down. Hard but often
necessary.

**Reversed:** Avoiding the inevitable. A blow softened or postponed but not
escaped.

### Suit / element
Major arcana. Element: fire (lightning). Astrological attribution: Mars.

### Reflection
What in your life is built on a foundation you suspect won't hold?
```

### 5.4 Themed variants

A themed deck is built by the offline deck-builder tool (separate spec, §10). It produces the same directory structure with one critical constraint: **the meanings (`Upright:` and `Reversed:` blocks) are copied verbatim from the source deck.** Only the name, art, and (optionally) suit names change.

```toml
# auspice/decks/maritime-rws/deck.toml
id = "maritime-rws"
name = "Maritime Tarot"
tradition = "tarot"
structure = "rws-78"
suits = ["anchors", "lanterns", "sextants", "charts"]   # themed
court = ["captain", "first-mate", "bosun", "cabin-boy"] # themed
provenance = "themed"
art_method = "themed-builder"
theme_of = "rider-waite-smith"
sources = [
  "Source meanings: Waite 1910 (verbatim from RWS)",
  "Theme art: built with Overseer deck-builder tool, reviewed."
]
```

The card file is required to have a `meaning_source: rider-waite-smith/16-tower` front-matter line, and the renderer fetches the upright/reversed text from the source card at display time. This is hard-enforced: a themed deck card with its own meanings refuses to load.

### 5.5 Peer decks

Operator-authored decks live in `auspice/decks/_peer/<callsign>-<deck-id>/`. They're flagged `provenance = "peer"`. The `[PEER]` tag is shown anywhere a peer deck appears in the UI. Sharing over mesh uses the OMP `0x73 DECK_SHARE` opcode (signed, gzipped, fragmented).

Peer decks may have their own meanings (operator authored them; that's the point). The trust label is the only safeguard — operators see clearly that this deck's meanings come from another operator, not from canonical tradition.

### 5.6 Spreads

Spreads are markdown files in `auspice/spreads/`:

```markdown
---
id: three-card-ppf
name: Three card · past · present · future
positions:
  - id: 1
    label: PAST
    description: "What has led to the current moment"
    x: 1
    y: 1
  - id: 2
    label: PRESENT
    description: "The current moment, the energy of now"
    x: 2
    y: 1
  - id: 3
    label: FUTURE
    description: "Where this is heading if patterns continue"
    x: 3
    y: 1
sources:
  - "Modern standard. Documented in Greer, *Tarot for Yourself*, 1984."
---
```

Built-in spreads: single card, three-card past/present/future, three-card situation/action/outcome, Celtic Cross (10), horseshoe (7), relationship (5), year ahead (12), Tree of Life (10).

Operators can define their own spreads (saved locally, peer-shareable as `0x74 SPREAD_SHARE`).

### API endpoints

```
GET    /api/u/decks                          list available decks
GET    /api/u/decks/:id
GET    /api/u/decks/:id/cards
GET    /api/u/decks/:id/cards/:card
GET    /api/u/spreads
GET    /api/u/spreads/:id
POST   /api/u/readings                       create solo reading
GET    /api/u/readings                       list past readings
GET    /api/u/readings/:id
POST   /api/u/readings/:id/journal
POST   /api/u/readings/comms/request         start a peer reading
POST   /api/u/readings/comms/:id/shuffle     querent commits
POST   /api/u/readings/comms/:id/flip        reader flips card
POST   /api/u/readings/comms/:id/end
```

---

## 6. (O) ORACLE — multi-tradition divination

Same engine as TAROT but applied to other traditional symbolic systems. Each is implemented as a "deck" with its own structure type.

### Traditions shipped

| Tradition | Structure | Items | Sources |
|---|---|---|---|
| **I Ching** | 64 hexagrams | 64 | Wilhelm/Baynes 1950 (now PD), Legge 1882 (PD) |
| **Elder Futhark runes** | 24 runes | 24 | Page, *Reading the Past: Runes*, 1987 (citation only); Dickins 1915 (PD) |
| **Lenormand** | 36 cards | 36 | Lenormand booklet 1846 (PD), modern Treppner 1989 (citation only) |
| **Lunar mansions** | 28 mansions | 28 | Agrippa, *Three Books of Occult Philosophy*, 1531 (PD) |
| **Geomancy** | 16 figures | 16 | Robert Fludd 1617 (PD), Stephen Skinner *Terrestrial Astrology* (citation) |
| **Ogham** | 20+ feda | 25 | *Auraicept na n-Éces*, c. 7th cent (PD); McManus 1991 (citation) |
| **Sortes Virgilianae** | random Aeneid passage | varies | Virgil's *Aeneid* (PD) — drawing a random passage as oracle |

Each is structured as a deck under `auspice/decks/_oracle/<id>/`, with its own `structure` value in deck.toml so the renderer knows how to lay it out.

### I Ching example

The I Ching needs special handling because it uses two hexagrams (primary and changing), with optional changing lines.

```
┌─ AUSPICE › ORACLE › I CHING ──────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  Method: three coins, six throws (traditional simplified)               │
│                                                                          │
│  Throw 1:  ●●●  →  yang (7)        ▬▬▬▬▬▬                               │
│  Throw 2:  ○○○  →  changing yin    ▬▬ ⊗ ▬▬                              │
│  Throw 3:  ●●○  →  yin (8)         ▬▬     ▬▬                            │
│  Throw 4:  ●○○  →  yang (9)        ▬▬▬▬▬▬                               │
│  Throw 5:  ●●●  →  yang (7)        ▬▬▬▬▬▬                               │
│  Throw 6:  ○○○  →  changing yin    ▬▬ ⊗ ▬▬                              │
│                                                                          │
│  ── PRIMARY ─────────────────────  ── BECOMING ────────────────────── │
│   Hexagram 14                       Hexagram 13                          │
│   ▬▬▬▬▬▬                            ▬▬▬▬▬▬                              │
│   ▬▬     ▬▬                         ▬▬▬▬▬▬                              │
│   ▬▬▬▬▬▬                            ▬▬▬▬▬▬                              │
│   ▬▬▬▬▬▬                            ▬▬     ▬▬                           │
│   ▬▬     ▬▬                         ▬▬▬▬▬▬                              │
│   ▬▬▬▬▬▬                            ▬▬▬▬▬▬                              │
│   大有 Dà Yǒu                       同人 Tóng Rén                         │
│   "Great Possession"                "Fellowship with Men"                │
│                                                                          │
│  ── PRIMARY MEANING ──────────────────────────────────────────────────  │
│  Wilhelm: "Possession in great measure: Supreme success." The hexagram  │
│  means one who possesses much. Strength and clarity united. The         │
│  superior person supresses the bad and elevates the good.               │
│  ↳ source: Wilhelm/Baynes, *I Ching*, 1950 (Bollingen)                  │
│                                                                          │
│  ── CHANGING LINES ───────────────────────────────────────────────────  │
│  Lines 2 and 6 are changing. Read these for the situation in motion.    │
│  ▸ Line 2 (changing yin → yang)                                         │
│  ▸ Line 6 (changing yin → yang)                                         │
│                                                                          │
│  ── BECOMING MEANING ─────────────────────────────────────────────────  │
│  Tóng Rén: "Fellowship with men in the open. Success." The image is    │
│  fire rising under heaven. Bringing people together in a common goal.   │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [J]ournal  [N]ew throw  [S]ave  [L]egge translation  [B]ack  [q]        │
└──────────────────────────────────────────────────────────────────────────┘
```

Both Wilhelm and Legge translations are bundled (both PD). Operator can toggle between them.

### Other oracles

Each follows the same pattern: a draw mechanism appropriate to the tradition (rune cast, Lenormand draw, geomantic shield chart, Sortes Virgilianae random passage), a result rendered in canonical glyphs/text, and traditional meanings as cited reference.

---

## 7. (D) DAILY — one card / one moon / optional prompt

A small daily ritual screen. Operator opens it once a day; it offers:

- The day's moon phase, sign, and lunar mansion
- A single card pulled from a deck of their choice (operator picks the deck once; it persists as default)
- A single hexagram or rune for those who prefer non-tarot systems
- An optional reflection prompt — drawn from a pool of public-domain reflective questions (Marcus Aurelius, Tao Te Ching aphorisms, etc.), not LLM-generated
- A `[J]ournal` button for capturing a quick reflection

```
┌─ AUSPICE › DAILY ─────────────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  ☉ Sunday 26 April 2026                                                 │
│                                                                          │
│  ── MOON ──────────────────────────────────────────────────────────────┤
│  Waxing gibbous, 78% in ♏ Scorpio, mansion 17 (Al Qalb).                │
│  Traditional: a time for digging into what's hidden.                    │
│                                                                          │
│  ── CARD OF THE DAY ──────────────────────────────────────────────────  │
│                                                                          │
│        ╭─────────────╮                                                   │
│        │             │                                                   │
│        │     ╱│╲     │   ── EIGHT OF PENTACLES ───────────────────── │
│        │    ╱ │ ╲    │   The apprentice. Patient, practiced repetition. │
│        │   ●●●●●     │   Mastery built one stroke at a time.            │
│        │   ●●●●●     │                                                  │
│        │   VIII      │   ↳ source: RWS, Waite 1910                      │
│        │   PENTACLES │                                                  │
│        ╰─────────────╯                                                   │
│                                                                          │
│  ── REFLECTION ───────────────────────────────────────────────────────  │
│  Today's prompt:                                                         │
│   "What part of your work today is craft, and what is performance?"     │
│   ↳ Marcus Aurelius, *Meditations* IV.3 (paraphrased PD)                │
│                                                                          │
│  Press [J] to journal a response, or just sit with it.                  │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [J]ournal  [N]ew card  [D]eck  [P]rompt source  [B]ack  [q]             │
└──────────────────────────────────────────────────────────────────────────┘
```

The "new card" option is deliberate friction — the daily card is meant to be one card, accepted. Pulling repeatedly until the operator gets one they like is the failure mode; the system allows it but quietly logs how many redraws happened that day, visible in JOURNAL stats.

---

## 8. (J) JOURNAL — encrypted reflections

The most sensitive surface in the module. Encrypted at rest, gated behind a separate PIN.

### 8.1 Encryption model

- All journal entries encrypted with **AES-256-GCM** under a per-deployment **journal master key**.
- Journal master key is encrypted twice and stored:
  - (a) under the **operator's PIN** (PBKDF2-HMAC-SHA256, 600k iterations, salt unique per operator), in `journal_pin_blob`
  - (b) under the **overseer's recovery key** stored in `/etc/overseer/journal-recovery.key` (root-readable only), in `journal_recovery_blob`
- To unlock with PIN: derive PIN-key, decrypt `journal_pin_blob` → master key → decrypt entries.
- To reset PIN (overseer): root reads `journal-recovery.key`, decrypts `journal_recovery_blob` → master key, prompts for new PIN, derives new PIN-key, re-encrypts master key as new `journal_pin_blob`. Master key never changes; only the PIN-derived wrapping does. Existing entries remain decryptable.

```sql
CREATE TABLE journal_keystore (
  operator_id INTEGER PRIMARY KEY REFERENCES users(id),
  pin_blob BLOB NOT NULL,           -- master key encrypted under PIN
  pin_salt BLOB NOT NULL,
  pin_iter INTEGER NOT NULL DEFAULT 600000,
  recovery_blob BLOB NOT NULL,      -- master key encrypted under overseer key
  created_at INTEGER,
  pin_reset_at INTEGER              -- timestamp of last overseer reset
);

CREATE TABLE journal_entry (
  id INTEGER PRIMARY KEY,
  operator_id INTEGER REFERENCES users(id),
  ciphertext BLOB NOT NULL,         -- encrypted body
  nonce BLOB NOT NULL,
  tag BLOB NOT NULL,
  created_at INTEGER,
  reading_id INTEGER,               -- nullable, links to a tarot/oracle reading
  chart_id INTEGER,                 -- nullable, links to a birth chart
  card_id TEXT                      -- nullable, deck-id/card-id for daily-card refs
);
```

### 8.2 Operator-facing UI

First time: PIN setup screen explains the model in plain language.

```
┌─ AUSPICE › JOURNAL › PIN SETUP ───────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  Your journal entries are encrypted at rest with a PIN you set here.    │
│                                                                          │
│  This PIN protects your journal from other operators on the system.     │
│                                                                          │
│  IMPORTANT — what this PIN does NOT do:                                 │
│   · It does not protect you from the system overseer (the person who    │
│     administers this Overseer deployment). They can reset the PIN if    │
│     you forget it. They cannot read your journal without resetting it,  │
│     but they can choose to reset it.                                    │
│   · It does not protect you from physical access to the storage.        │
│                                                                          │
│  Choose a PIN you will remember. If you forget it, the overseer can     │
│  reset it for you, but there is no automated recovery — they will       │
│  need to be present to do so.                                           │
│                                                                          │
│  PIN (6+ characters, any type):    [______________]                     │
│  Confirm:                          [______________]                     │
│                                                                          │
│  [Enter] confirm  [B]ack  [q]                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

This is exactly the trust framing — clear and up-front, no surprises later.

### 8.3 Journal screen

Once unlocked:

```
┌─ AUSPICE › JOURNAL ───────────────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│  41 entries · last entry 2 days ago · session unlocks for 30 minutes    │
│                                                                          │
│  DATE        PROMPT / READING                                  ENTRY    │
│  ──────────  ────────────────────────────────────────────      ─────    │
│  04-24       Three-card · "what's blocking me"                  ✎ 240w  │
│  04-21       Daily · 6 of Cups                                  ✎  82w  │
│  04-20       I Ching 14 → 13                                    ✎ 180w  │
│  04-18       Daily · The Hermit                                 ✎ 110w  │
│  04-17       Birth chart review                                 ✎ 320w  │
│  04-15       Daily · Three of Pentacles                         ✎  45w  │
│  04-12       Sortes Virgilianae · Aen.VI.126                    ✎  98w  │
│  ...                                                                     │
│                                                                          │
│  ── SEARCH ──────────────────────────────────────────────────────────── │
│  /tower<span>_</span>                                                                │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [↑↓] entry  [Enter] read  [N]ew  [/] search  [E]xport  [L]ock  [q]      │
└──────────────────────────────────────────────────────────────────────────┘
```

Auto-locks after 30 minutes of inactivity. `L` locks immediately.

### 8.4 Overseer reset path

Documented in `04-IMPLEMENTATION-PLAN.md` operations runbook. Command:

```bash
sudo overseer journal reset-pin --operator <callsign>
```

Prompts for confirmation, decrypts the master key with the recovery key, generates a temporary PIN, prints it once, re-wraps the master key. The operator logs in with the temp PIN and is forced to change it.

The recovery key file `/etc/overseer/journal-recovery.key` is generated at first system setup. The setup script tells the overseer to back it up immediately — losing this file means losing the ability to reset PINs. (Operators with their PIN are unaffected.) The recovery key is never on the mesh, never in COMMS, never anywhere except root-readable on the deployment.

---

## 9. (A) ALMANAC — the year wheel

Long-form reference. Sabbats, traditional festivals across cultures, lunar calendar, eclipses, planetary stations, solar terms.

```
┌─ AUSPICE › ALMANAC › 2026 ───────────────────────────────  [PHOSPHOR] ─┐
│                                                                          │
│              YULE                                                        │
│             DEC 21                                                       │
│         ╲       │       ╱                                                │
│   SAMHAIN ╲     │     ╱ IMBOLC                                           │
│   OCT 31    ╲   │   ╱   FEB 02                                           │
│              ╲  │  ╱                                                     │
│   ─────────────●─────────────                                            │
│              ╱  │  ╲                                                     │
│   LUGHNASADH╱   │   ╲ OSTARA                                             │
│   AUG 01  ╱     │     ╲ MAR 20                                           │
│         ╱       │       ╲                                                │
│              MIDSUMMER                                                   │
│             JUN 21                                                       │
│                                                                          │
│  ── 2026 NOTABLE ─────────────────────────────────────────────────────  │
│   FEB 17   ☾ total solar eclipse, visible Antarctica                   │
│   MAR 03   ☾ penumbral lunar eclipse                                    │
│   MAR 20   spring equinox 14:46 UTC                                     │
│   APR 27   ♂ enters ♋ Cancer                                            │
│   AUG 12   ☾ total solar eclipse, visible Iceland/N.Spain               │
│   ...                                                                    │
│                                                                          │
│  ── LUNAR CALENDAR ──────────────────────────────────────────────────  │
│   ● new moon · ◐ first quarter · ○ full · ◑ last quarter                │
│   APR  ◐ 04   ○ 12   ◑ 20   ● 27                                        │
│   MAY  ◐ 03   ○ 11   ◑ 19   ● 26                                        │
│   JUN  ◐ 02   ○ 09   ◑ 18   ● 25                                        │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ [↑↓] month  [Y]ear ahead  [T]raditions  [E]clipses only  [B]ack  [q]    │
└──────────────────────────────────────────────────────────────────────────┘
```

The "traditions" toggle adds rows for non-Wheel-of-the-Year systems: Buddhist Vesak, Hindu festivals, Islamic lunar calendar, Jewish high holidays, Chinese solar terms, etc. All are calculation, not interpretation; all cite their canonical sources.

---

## 10. The deck-builder tool (developer-side, separate from runtime)

Separate spec, summarised here for completeness.

### Purpose

Generate themed variants of canonical decks at build time. Run on developer machine. Output is a deck directory ready to drop into the Overseer repo.

### Constraints, hard-enforced

- Cannot modify card meanings. Source meanings are passed to the builder as **immutable context**, the builder's output schema has no `meaning` field, and at deck-load time the renderer fetches meanings from the source deck via `meaning_source` reference.
- Cannot modify the structure of a deck. RWS-78 means 22 majors + 4×14 minors; the builder cannot drop or add cards.
- Output is text only — ASCII art and themed names. No images.
- Every output card includes a `theme_of` and `meaning_source` front-matter field pointing back to the canonical source.
- Provenance is set to `themed`, not `canon`, until the developer explicitly reviews and promotes it. Reviewed themed decks become `canon` (still with `theme_of` set, so origin is traceable).

### Workflow

```
$ overseer-deck-builder new
  Source deck (canonical): rider-waite-smith
  Theme description: "maritime — 19th century sailing ship era"
  Suit naming:
    wands     → anchors
    cups      → lanterns
    swords    → sextants
    pentacles → charts
  Court naming:
    page → cabin-boy
    knight → first-mate
    queen → bosun
    king → captain
  Art style: [low-detail | medium-detail | high-detail | minimalist]: medium-detail
  Output directory: ./decks/maritime-rws/

  Generating 78 cards...
  [00/78] 00-fool → "the runaway"          ✓
  [01/78] 01-magician → "the navigator"    ✓
  ...
  [77/78] 77-king-of-pentacles → "the captain of charts"  ✓

  Review:
    - meanings: copied verbatim from rider-waite-smith ✓
    - art:      78 ASCII art files generated
    - names:    78 themed names generated

  Output written to ./decks/maritime-rws/
  Status: themed (not canon). Run `overseer-deck-builder review` to promote.
```

### Review tool

```
$ overseer-deck-builder review ./decks/maritime-rws/
  Reviewing 78 cards. [a]ccept, [r]eject, [e]dit, [s]kip, [q]uit.

  ── 00 The Fool / "the runaway" ─────────────────────────────────────
  Source meaning (verbatim, immutable):
    Beginnings, leaps of faith, naive openness...

  Themed name: "the runaway"
  Themed art:
        ╭─────────────╮
        │       ☼     │
        │     ╱║╲     │
        │      ║      │
        │     ─║─     │
        │   wave wave │
        │     ⚓ 0     │
        │  the runaway│
        ╰─────────────╯

  [a/r/e/s/q] >
```

The reviewer (the developer) decides every card. Once all 78 are accepted, provenance is changed from `themed` to `canon` in deck.toml and the deck is committed to the repo.

### Why this discipline matters

It means a themed deck shipping with Overseer has been seen and approved by a human, card by card, with the canonical meaning visible alongside. Garbage art, wrong-feeling themed names, cards that drift from the source meaning — all of it gets caught at review. The tool generates; the human curates. That's the whole gradient.

---

## 11. COMMS interaction summary

| Opcode | Name | Description |
|---|---|---|
| `0x70` | READING_REQUEST | querent → reader, with question |
| `0x71` | READING_ACCEPT | reader → querent |
| `0x72` | READING_FLIP | reader → querent (and back), per card |
| `0x73` | DECK_SHARE | peer-deck propagation, gzipped, signed |
| `0x74` | SPREAD_SHARE | peer-spread propagation |
| `0x75` | READING_END | either party closes the spread |
| `0x76` | CHART_SHARE | one operator shares a birth chart with another |

The `0x73 DECK_SHARE` carries a signed peer-authored deck. Recipients see it tagged `[PEER]` clearly throughout the UI. They must explicitly opt to install it. Unsolicited deck shares are quarantined in `/inbox/decks` for review; never auto-installed.

The `0x76 CHART_SHARE` is a privacy-sensitive opcode — birth data is personal. The sender's UI requires explicit "I want to share this with KILO-7" confirmation each time. Charts are not on the public board.

---

## 12. Build priority

> **Superseded.** The Sprint A/B/C track described below is no longer
> the canonical plan. AUSPICE is now inlined into the main 16-sprint
> sequence as **Sprints 12 (Part A) and 13 (Part B)**. See
> `04-IMPLEMENTATION-PLAN.md` for the up-to-date sprint roadmap with
> renumbered downstream sprints. The deliverable list below is still
> correct as a *content* breakdown; only the sprint labels change.


Two sprints likely.

**Sprint A — astronomy and references (~2 weeks)**

1. SKY (Skyfield + DE440 ephemeris). 3 days.
2. CHART (Western tropical only initially). 4 days.
3. ALMANAC (year wheel + lunar calendar). 2 days.
4. Astrology reference text (sun-in-sign × 12, moon-in-sign × 12, AS × 12, common aspects × ~20 = ~80 markdown files, hand-authored from Lilly + modern PD sources). Long pole. 5 days.

**Sprint B — divination and journal (~3 weeks)**

5. Deck format + RWS deck (78 cards hand-authored). 4 days.
6. Spread engine + 8 standard spreads. 2 days.
7. TAROT solo screen. 2 days.
8. ORACLE engine + I Ching (Wilhelm + Legge text, 64 hexagrams). 3 days.
9. Other oracles (runes, Lenormand, geomancy, lunar mansions, Ogham, Sortes). 5 days.
10. JOURNAL with encryption + PIN flow + overseer reset path. 4 days.
11. DAILY screen. 1 day.
12. COMMS reader↔querent flow. 4 days.

**Sprint C (optional, later) — Vedic, deck-builder tool, themed decks (~1-2 weeks)**

13. Vedic system in CHART (sidereal, nakshatras, whole-sign houses). 4 days.
14. Deck-builder offline tool. 4 days.
15. First themed deck (one variant of RWS, hand-curated as the test of the toolchain). 2 days.

Total: ~5-6 weeks of focused engineering across the module. The long pole throughout is the **traditional content authoring** — astrology placements, card meanings, hexagram texts. None of which can be LLM-shortcut. That's the cost of doing it honestly.

---

## 13. What this module deliberately does NOT do

- **It does not generate mystical content at runtime.** No LLM-authored readings. No AI-composed horoscopes. No "the cards say..." prose.
- **It does not predict or forecast.** Astrology placements describe traditional attributions, not future events.
- **It does not make claims about reality.** Traditional meanings are presented as references from cited sources, not as facts.
- **It does not prevent skepticism.** A skeptical operator using this module for journaling structure or astronomical reference loses nothing.
- **It does not shame redrawing or reinterpretation.** People interpret. The system tracks gently.
- **It does not replace human practice.** A reader and querent are two operators; the system is the tablecloth, not a participant.

---

## 14. Trust labels (full)

| Source | Tag | Used for |
|---|---|---|
| Hand-authored from cited PD sources | `[CANON]` | Card meanings, astrology placements, hexagram text |
| Themed variant via deck-builder, reviewed | `[CANON]` | Themed decks shipped with system |
| Astronomical calculation against ephemeris | (untagged, factual) | Moon, planets, eclipses |
| Operator's own journal | (untagged, private) | Their reflection |
| Operator-authored peer deck | `[PEER]` | Peer-shared decks |
| Operator-shared birth chart | `[PEER]` | Charts shared with explicit consent |
| LLM at runtime | (does not exist in this module) | nothing |

---

End of AUSPICE spec. Companion: deck-builder tool spec (`AUSPICE-DECK-BUILDER.md`), to be drafted separately.
