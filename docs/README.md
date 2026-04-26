# OVERSEER v3 — Claude Code Handoff Package

**For:** Claude Code, picking up the redesign on Ted's dev machine.
**Existing repo:** `https://github.com/edpeck111/overseer.git` (v2.0.0, ~4,900 LOC).
**Status:** Design phase complete. Visual direction approved. Ready to implement.

---

## START HERE — read these in order

1. **`00-VISUAL-REFERENCE.html`** — open in a browser. This is the single source of truth for how v3 looks. Resize the browser or use the VIEW buttons (phone/tablet/desktop) and SCREEN buttons (home/comms/power) to see the intended behaviour. The CSS in this file is the design tokens you'll port.

2. **`01-DESIGN-SPEC.md`** — the *why* and the *what*. Design principles, layout rules, module list, behavioural patterns. Read before writing any code.

3. **`02-MODULE-CATALOG.md`** — every module spec'd in detail: features, screens, hotkeys, data model, API endpoints. This is your build backlog.

4. **`03-MESH-ARCHITECTURE.md`** — the Cardputer-Adv + Orange Pi 5 Max + LoRa design. Local-first preloaded shell, OMP binary protocol, compression strategy. Critical to understand before touching the API layer because the API split (static shell + thin endpoints) is non-negotiable.

5. **`04-IMPLEMENTATION-PLAN.md`** — suggested sprint ordering, what to keep from v2, what to throw away, migration notes for the SQLite schema.

6. **`05-OMP-PROTOCOL.md`** — Overseer Mesh Protocol opcode reference and wire format. Build this in parallel with the API; the API endpoints and the OMP opcodes are 1:1 mirrors.

---

## TL;DR for impatient humans

OVERSEER v3 is a full UI redesign of v2's prepper system, pulling influences from BBS door games (LORD, TradeWars), classic TUIs (Norton/Midnight Commander), and the modern terminal renaissance (lazygit, btop, k9s, yazi).

**Core principles:**

- **80×40 canonical grid.** Larger viewports add panels, never stretch content.
- **Keystroke-first.** Every action has a single-letter accelerator. Touch targets are also keys.
- **Persistent chrome.** Status strip top, breadcrumb second, content middle, hotkey bar bottom. Always.
- **Command palette (`:`)** absorbs feature sprawl. Top menus stay clean.
- **Modern power, BBS look.** 256 colors, real-time updates, fuzzy search, embeddings — but discipline keeps it feeling like a 1994 BBS.
- **Static shell + thin API.** UI is fully preloaded. Only deltas cross the wire. Critical for LoRa mesh viability.

**Eleven modules** (six existing, refined; five new): Knowledge, Comms, Medical, Navigation, Power, System (existing); Log, Inventory, Recreation, Signal, Timeline (new). Plus three optional: Intel, Ritual, Archive.

**Four targets, one UI:** direct WiFi (full speed), Cardputer LoRa mesh (low bandwidth), SSH/TUI mode (terminal), desktop browser. Same shell, different transports.

---

## What's in this folder

```
00-VISUAL-REFERENCE.html  — interactive design preview, single self-contained file
01-DESIGN-SPEC.md         — design system, principles, tokens, layout rules
02-MODULE-CATALOG.md      — every module fully spec'd
03-MESH-ARCHITECTURE.md   — Cardputer/OPi5/LoRa system architecture
04-IMPLEMENTATION-PLAN.md — sprint plan, migration, what to keep/throw
05-OMP-PROTOCOL.md        — binary mesh protocol spec
README.md                 — this file
```

---

## Conversation history (context)

This handoff is the result of a multi-day conversation. Key decisions made:

- **80×40 grid stays canonical** — phone landscape struggles with wider, and keeping one reference grid simplifies design and ANSI art authoring.
- **256 colors per screen, not 16** — modern hardware, no reason to constrain to VGA.
- **Vast menus are fine** as long as they're hierarchical, shallow on the hot path, and the command palette absorbs the long tail.
- **Static shell on Cardputer** is mandatory for mesh use — the UI never crosses the wire, only the data does.
- **Compression matters more than raw bandwidth** — Brotli with a shared dictionary, MessagePack over JSON, LLM streams compressed against an Overseer-vocabulary dictionary.
- **Optimistic UI** for any user action that requires network — local UI updates immediately, network confirmation arrives async.

---

## Working with Ted

A few notes on the operator (i.e. Ted) that should colour your decisions:

- UK-based developer and commodities trader. Strong embedded background (bare-metal C, STM32, ESP32 via PlatformIO). Will write the Cardputer firmware himself; you focus on the OPi5 backend + UI.
- Owns M5StickC PLUS2 and Cardputer-Adv hardware. Pi Hut is preferred UK supplier.
- The v2 code is his — be respectful of what's there. Quite a lot is worth keeping (Flask routes, SQLite schema, kiwix integration, medical triage decision trees). The redesign is mostly UI + new modules + the mesh split.
- He's prepper/survivalist focused. Keep that operational seriousness in tone — no jokes about doomsday, no frivolous easter eggs that compromise the system. The Easter eggs that *do* belong are the BBS ones (LORD-style hidden commands, fortune quotes, ASCII art on boot).
- He thinks in systems. Architecture decisions should be explicit and justified.

---

## When you finish a meaningful chunk

Commit with conventional commits. Open a PR with a screenshot or terminal capture. Reference the spec section you're implementing. Don't merge to main without Ted's review.

Good luck. Build something he'll actually use.
