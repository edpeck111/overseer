# 01 — OVERSEER v3 DESIGN SPEC

> The visual reference (`00-VISUAL-REFERENCE.html`) is canonical. When this doc and that file disagree, the file wins. This doc explains the *why* and codifies the rules so they can be applied to screens not in the preview.

---

## 1. Design influences

Steal from these, deliberately:

| Source | What we take |
|---|---|
| **LORD / TradeWars 2002 / WWIV** | Single-letter hotkey menus. `(A)ttack (R)un (S)tats`. The accelerator is always in parens. |
| **ACiD / iCE / Blocktronics** | CP437 box-drawing as brand signature. Section dividers, framed panels, `░▒▓█` shaded blocks. |
| **Norton / Midnight Commander** | Persistent F-key bar at the bottom. Tab to switch panes. Two-pane operations. |
| **lazygit / k9s** | Multi-panel persistent layout. Drill-down with breadcrumb. `:command` palette. Status strip never moves. |
| **btop / bottom** | Widget dashboards. Sparklines from Unicode block characters. Real-time everything. |
| **yazi / ranger** | Miller columns for hierarchical browsing (parent / current / preview). |
| **htop / tig** | Header + scrollable list + function-key bar. |
| **fzf / atuin** | Fuzzy-everything. Press one key, search anything. |
| **Fallout PIP-Boy / S.T.A.L.K.E.R. PDA** | Diegetic in-world feel. Boot chime, soft CRT atmosphere, monospace honesty. |
| **MUDs / telnet adventures** | Type-ahead command parser. Slash commands in chat (`/cite`, `/save`). |

---

## 2. Design principles (non-negotiable)

These rules govern every screen. If a feature can't be made to fit them, the feature gets reshaped or rejected.

**P1 — One keystroke, one action.** Every screen maps letters and digits to actions. `N` = new, `R` = refresh, `/` = search, `?` = help, `q` = back. The web app being mobile-first is fine — render the letters as tappable pills — but each one is also a real key.

**P2 — Spatial consistency.** Status bar *always* top. Breadcrumb *always* second line. F-key hint row *always* bottom. Content in the middle. The eye never hunts. Across all eleven modules. No exceptions.

**P3 — No multi-step forms with "Save" buttons.** Replace every form with a prompt sequence: the system asks, the user answers, system asks the next thing. Like installing Slackware, like configuring meshtastic, like a BBS new-user signup. This is native to terminals; web forms are not.

**P4 — Command palette as escape valve.** Top menus stay shallow and clean. Every command — every operation in the entire system — is also reachable via `:` palette with fuzzy match. Long tail goes there.

**P5 — Persistent state on screen.** Don't hide the clock, model, RAM, battery, unread count. They live in the status strip, always visible. Same for transport indicator (WiFi / LoRa / direct / offline).

**P6 — Readable at arm's length, in low light, under stress.** This is a prepper system. Cold hands, dirty screen, one earbud. If the user has to squint or focus, you've failed.

**P7 — No emoji, no rounded corners, no gradients, no drop shadows.** Box-drawing characters only. The device is a salvaged ARM board in a metal case. The UI honours that.

**P8 — Optimistic UI.** Any action the user takes updates the screen instantly with a `⟳ pending` flag. Network confirmation flips it to `✓ delivered` (or `✗ retry`). Never block on a round trip.

**P9 — Cached data is honest data.** Every panel that shows data shows its `as-of` timestamp dimly: "INBOX as of 14m ago". Pure BBS aesthetic. Honesty about staleness > false freshness.

**P10 — Degrades gracefully.** Works with JS partially broken. Works on slow hardware. Works on a 9600-baud-equivalent mesh link. Works when half the backend is down.

---

## 3. The grid

**80 × 40 character cells, canonical.** This is the reference grid for all art, all screens, all layouts. Authored to it, displayed at it on phone.

### Adaptive composition

Larger viewports compose *more panels at 80c each*, not stretched single panels. This is the lazygit/k9s rule.

| Viewport class | Width | Behaviour |
|---|---|---|
| **Phone portrait** | <600px | Single panel. Swipe between panes. Compact font. |
| **Phone landscape** | 600–900px | Single panel, 80c reference. Larger font. Side stack hidden. |
| **Tablet** | 900–1200px | Dual panel. ~120c total. Side stack visible. Comms goes 3-pane (collapsed middle). |
| **Desktop** | 1200px+ | Up to 4 panels. ~160c total. Full lazygit-style for complex modules. |

Detection: query `getBoundingClientRect()` on the terminal container. Above thresholds, set `data-mode="phone|tablet|desktop"` on the root element. CSS responds via attribute selectors (see visual reference). User can force single-panel with `:layout single`.

---

## 4. Design tokens

All tokens lifted from `00-VISUAL-REFERENCE.html`. Port them as-is.

### 4.1 Color palette (256-feel, curated)

```css
/* Backgrounds */
--bg-deep:        #050807;   /* terminal background */
--bg-panel:       #0a1410;   /* panel fill */
--bg-panel-hi:    #0f1d17;   /* panel hover/active */
--bg-strip:       #06120c;   /* status strip, hotkey bar */

/* Rules / borders */
--rule-dim:       #133021;   /* subtle dividers */
--rule:           #1f5538;   /* normal borders */
--rule-bright:    #2d7a4e;   /* prominent borders */

/* Phosphor green (primary) */
--fg-dim:         #1d8c4a;   /* dim text, labels */
--fg:             #2cc26a;   /* normal text */
--fg-bright:      #5fff9b;   /* highlighted text */
--fg-glow:        #b8ffd2;   /* glow text */

/* Accents */
--amber:          #ffb849;   /* headers, warnings, brand */
--amber-bright:   #ffd27a;   /* warning highlight */
--red:            #ff4747;   /* alerts, danger */
--red-bright:     #ff8585;   /* alert highlight */
--cyan:           #4adfff;   /* network, cool states */
--cyan-bright:    #8ff0ff;   /* network highlight */
--magenta:        #ff5fb8;   /* special, signal */
--violet:         #b58cff;   /* esoteric */
--paper:          #d8e8d8;   /* very high contrast text */
```

**Palette discipline** — what each color means semantically:

- **Phosphor green** is the system. Default text. Working state. "OK".
- **Amber** is attention, headers, brand identity. Reserved. Don't sprinkle.
- **Red** is danger only. Alerts, errors, critical states. Used sparingly enough that any red on screen draws the eye instantly.
- **Cyan** is network, cool, signed/verified, navigation. Things involving the wire.
- **Magenta** is signal/SDR module. Cyberpunk slot, used only there.
- **Violet** is reserved for special states (admin overlays, easter eggs).

### 4.2 Per-module palette swaps

Each module gets a slight tonal shift while keeping phosphor as base. Subtle, not jarring. Implementation: each module sets `data-module="medical"` etc on its container, and CSS overrides `--fg-bright` and `--amber` selectively.

| Module | Accent shift |
|---|---|
| KNOWLEDGE | Default phosphor + amber |
| COMMS | Phosphor + cyan headers (network feel) |
| MEDICAL | Warm: red headers replacing amber for emphasis |
| NAVIGATION | Cool blue-cyan accents |
| POWER | Default + amber/red for warnings |
| LOG | Default + slightly warmer phosphor (paper-tinged) |
| INVENTORY | Default + amber for expiry alerts |
| RECREATION | Default + violet for game UI |
| SIGNAL | Magenta/cyan cyberpunk slot |
| TIMELINE | Default + cyan |
| SYSTEM | Amber-heavy (admin gravity) |

### 4.3 Typography

```css
font-family: 'JetBrains Mono', ui-monospace, 'Cascadia Mono', monospace;
font-size: clamp(7px, 1.45vw, 11px);  /* per character */
line-height: 1.55;
letter-spacing: 0.02em;
```

**Display font:** `VT323` for the main logo and module banners only. Brings the CRT character to brand moments without compromising body legibility.

**Font sizing:** scales with viewport via `clamp()`. On a 360px-wide phone you get ~7px chars (squint territory but fits 80c); on a 1380px desktop you get 11px chars at standard zoom. Users can `Ctrl+ +/-` to adjust zoom; everything respects it.

**Other fonts to consider shipping** (user-switchable via `:font` command):

- **IBM Plex Mono** — modern, extremely readable
- **Berkeley Mono** — premium, characterful
- **Fira Code** — ligatures for code
- **Topaz** / **Amiga Forever** — pure 80s flex (display-only, not for body)

### 4.4 Spacing & rhythm

The character cell is the unit. Padding, margins, gaps all multiples of `0.5em` or `1em`. No pixel values in layout.

Box-drawing dividers preferred over `border` properties where it fits the aesthetic:

```
╔══════════════════════╗   double-line frames for primary panels
║                      ║
╚══════════════════════╝

┌──────────────────────┐   single-line for secondary panels
│                      │
└──────────────────────┘

▌ ─── ▐                    bracketed accents for breadcrumbs

░▒▓█                        shaded blocks for fills, gauges
```

### 4.5 CRT atmosphere

```css
/* Scanlines (subtle, fixed overlay, multiply blend) */
background: repeating-linear-gradient(to bottom,
  rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px,
  rgba(0,0,0,0.18) 3px, rgba(0,0,0,0) 4px);
opacity: 0.55;
mix-blend-mode: multiply;

/* Vignette */
background: radial-gradient(ellipse at center,
  transparent 60%, rgba(0,0,0,0.45) 100%);

/* Glow on bright text */
text-shadow: 0 0 6px rgba(95,255,155,0.25),
             0 0 14px rgba(95,255,155,0.08);
```

**User-toggleable.** `:crt off` strips all scanlines/vignette/glow for daylight readability. `:crt soft|medium|strong` adjusts intensity.

---

## 5. The chrome (every screen has this)

```
╔══════════════════════════════════════════════════════════════════════════════╗
║ OVERSEER │ OP:ALPHA-1 │ SYS:OK │ AI:7B │ KB:12 │ PWR:82% │ MESH:●●○ │ 23:47 ║  ← STATUS STRIP
╚══════════════════════════════════════════════════════════════════════════════╝
▌ HOME › COMMS › INBOX                                          [3 UNREAD] ▐    ← BREADCRUMB
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                                                                              │
│                          ( CONTENT AREA )                                    │
│                                                                              │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
 [A]rch [R]eply [F]wd [D]el [N]ew  [Tab] panes  [:] cmd  [/] find  [?] help    ← HOTKEY BAR
```

### 5.1 Status strip segments (left → right)

1. **Brand** — `OVERSEER v3.0.1` (always)
2. **Operator** — `OP:ALPHA-1` (always)
3. **System** — `SYS:OK | DEGRADED | FAULT` (color-coded)
4. **AI** — model name, e.g. `AI:QWEN-7B` or `AI:OFFLINE`
5. **Knowledge** — `KB:12/12` archives mounted
6. **Power** — `PWR:82%` (amber if <30, red if <15)
7. **Mesh** — `MESH:●●○` reachable nodes / total known
8. **Clock** — `D+417 · 23:47` day-counter + wall time

Segments hide progressively on narrow viewports (in this order from right to left for hide priority: KB → AI → SYS → MESH → POWER → BRAND/OP/CLOCK always visible).

### 5.2 Breadcrumb

- Left: hierarchy `HOME › MODULE › SUBMODULE › ITEM`
- Right: contextual pill `[3 UNREAD]`, `[GPS LOCK]`, `[14d 02h]`, etc

### 5.3 Hotkey bar

Always visible. Always reflects the *current screen's* available actions. The accelerator letter rendered as a high-contrast pill. After all action keys, three universal keys: `[:] cmd  [/] find  [?] help`. On the rightmost: a danger-styled `[Q] back`.

---

## 6. Interaction patterns

### 6.1 Menu screens

Letter-keyed list. The HOME screen is the canonical example (see visual reference). Each item:

```
(K) KNOWLEDGE        chat · library · 12 vols           ●
```

- `(K)` letter accelerator — high-contrast key cap
- `KNOWLEDGE` — the label, bright phosphor
- `chat · library · 12 vols` — sub-description, dim
- `●` — status pip (amber alert / cyan info / dim normal)

Selectable with arrow keys, activated with Enter or the letter directly.

### 6.2 Wizards (replacing forms)

Sequential prompts:

```
TRIAGE > BLEEDING

  Q3/7: Is blood spurting with pulse, or steady flow?

   (A) Spurting / pulsing        → arterial, immediate tourniquet
   (B) Steady dark flow          → venous, direct pressure
   (C) Oozing                    → capillary, clean and dress
   (?) I don't know              → show field decision aid

  [j/k]: prev/next   [b]: back one step   [q]: abort

  > _
```

Each step commits to a log so the wizard run is replayable / auditable.

### 6.3 Multi-pane (lazygit style)

For COMMS, INVENTORY, NAVIGATION's waypoint editor, KNOWLEDGE's library:

```
┌─ FOLDERS ────┬─ MESSAGES ─────────┬─ DETAIL ───────────┐
│ INBOX     3  │ BRAVO-2  Re: rdv   │ FROM: BRAVO-2      │
│ SENT     47  │ CHARLIE  inv upd   │ TO:   ALPHA-1      │
│ DRAFTS    2  │ ECHO-3   intel     │ ...                │
│ ARCHIVE 211  │                    │ body...            │
└──────────────┴────────────────────┴────────────────────┘
```

`Tab` cycles focus between panes. Active pane has a brighter border and inset shadow. On phone, only the active pane is visible — Tab/swipe switches.

### 6.4 Dashboards (btop style)

For POWER, SIGNAL, TIMELINE: 2×2 or 2×3 grid of tiles. Each tile self-updating. Sparklines from Unicode block chars (`▁▂▃▄▅▆▇█`) for histories, braille (`⠀⠂⠆⠦⠶⠾⡾⢿⣿`) for high-density spectra.

### 6.5 Chat (KNOWLEDGE module)

MUD-style scrolling log:

```
> how do I purify rainwater
[OVERSEER] indexing... cross-referencing archives...
[OVERSEER] Rainwater is generally safe but should be filtered through
           cloth and either boiled (1 minute rolling), treated with
           unscented bleach (8 drops/gallon, 30 min wait), or run
           through a 0.2-micron filter. Avoid first-flush runoff.

           Field medicine only. Seek trained personnel if available.
           Stay sharp.

> _
```

Slash commands: `/cite`, `/forget`, `/save <name>`, `/branch`, `/voice`. Citations clickable to jump into Library at the right paragraph.

### 6.6 Command palette

Trigger: `:` from any screen.

```
┌─ : ── command ───────────────────────────────────────────────────┐
│ : comm│                                          [ESC ↑↓ ↵]      │
├──────────────────────────────────────────────────────────────────┤
│ > comms.inbox                                  open inbox · C    │
│   comms.compose                                new message       │
│   comms.boards.intel                           board /intel      │
│   comms.boards.sos                             board /sos        │
│   comms.net.scan                               rescan mesh       │
│   encompass.export                             export archive    │
└──────────────────────────────────────────────────────────────────┘
```

Fuzzy-matched against a registry. Every module registers commands at boot. Plugins can register their own.

### 6.7 The prompt line (all screens)

Bottom-of-content text input that accepts:

- Bare letters → menu hotkeys (`K`, `C`, `M`...)
- `:` prefix → command palette
- `/` prefix → fuzzy search within current screen
- `?` → context help
- `q` → back / pop one level off the breadcrumb stack
- Free text → only in chat/text-input screens

---

## 7. Sound design

`sounds/` already has 8 key-click WAVs. Keep them. Add:

- **Boot chime** (~2s) — brief modem-handshake-flavoured tone on first connect
- **Comms arrival** — short RTTY burst when a new message arrives
- **Alert warble** — for red-status events
- **Module enter** — half-second per-module signature swoosh (subtle)
- **Geiger background** — optional ambient tick, frequency = CPU load %

All muted by default. `[SND:OFF/ON]` toggle in status strip mirrored to `:sound on|off|alerts-only`.

---

## 8. Animation discipline

Three flavours allowed, anything else rejected:

1. **Type-on reveal** for important text. ~150 cps (1200 baud feel). Boot lines, triage questions, LLM first tokens.
2. **Cursor blink.** The classic. 1.05s steps.
3. **Status pulse** on alerts. 1.4s blink for unread/critical pips.

**Forbidden:** sliding panels, fade transitions between pages, bouncy easing, parallax, any kind of scroll-jacking. Screens replace, they don't slide.

---

## 9. Easter eggs (LORD-style, deliberate)

Belong:

- `:fortune` — random Seneca/Heinlein/Sun Tzu/Boy Scout Handbook quote
- `:matrix` — full-screen rain for 5 seconds, then dismisses
- A few hidden chat triggers (the LLM occasionally references "the old world" — give Ted curated lore phrases)
- Konami code on HOME unlocks an admin diagnostic screen
- `:cowsay <msg>` — for messages and one-liners
- A rotating one-liner shown on boot, contributable by operators over the mesh

Don't belong:

- Anything frivolous about the doomsday/prepper premise
- Pop-culture overload (no Skyrim arrows, no "we did it Reddit")
- Random color flashes that compromise readability

---

## 10. Accessibility

- Minimum AA contrast on all text (the phosphor palette already passes)
- `:contrast high` mode bumps everything to paper-on-black, kills the glow
- Screen reader: every key cap has `aria-label="key K, KNOWLEDGE module"`
- Keyboard navigation: 100% (since that's the design)
- Touch targets: 36px minimum on phone
- Reduced motion: `:motion off` strips type-on, blink, pulse

---

## 11. What's *not* in v3 visually

So Claude Code doesn't accidentally rebuild it:

- The big splash boot screen gets reduced to a 2-3 second authentic boot log, then HOME
- The current PIN entry on a square keypad is replaced with a single inline prompt
- The Leaflet map is *kept* but moves into a NAVIGATION submode you `M` into, not a primary tab
- The current bright dashboard cards on HOME are replaced with the menu + side-stack pattern
- The "BROWSE / SEARCH" library tabs become Miller columns

---

## 12. The diegetic frame

The OVERSEER persona stays. From v2's system prompt:

> Offline Vault of Essential Records for Survival, Emergency & Endurance Response. A hardened survival intelligence system built before the collapse. You run on salvaged hardware in a reinforced bunker.

This is not just chat character — it's the whole tone. The UI is part of the fiction. The boot lines, the alert text, the empty-state copy: all in-character. Not winking at the user. Operators interact with *the Overseer*, not with a software product.

That said: never compromise utility for theme. If someone is doing field triage, they need clarity. The fiction supports the tool, not vice versa.

---

End of design spec. Continue to `02-MODULE-CATALOG.md`.
