# ADR-0009: Sextant rasterizer is a system-wide UI primitive

**Status:** Accepted (Sprint 2)
**Deciders:** Ted; recorded by author of Sprint 2 transport work

## Context

The Unicode "sextant" block characters (U+1FB00..U+1FB3B) provide a
2×3-cell grid of 6 binary subpixels per character — enough to render
genuinely image-like visualizations using monospace text alone. The
v3 design phase produced `docs/sextant_render.py` as a working
prototype: it converts a binary bitmap into the corresponding stream
of sextant characters, with multiple binarization modes (Otsu,
Niblack, Floyd-Steinberg, Atkinson) for different content kinds.

`docs/SEXTANT-GRAPHICS-HANDOFF.md` already commits the rasterizer to
being "the system-wide graphics primitive" — alongside box-drawing
chrome — for moon, tarot art, hexagrams, chart wheels, map tiles,
body diagrams, antenna patterns, frequency spectra, mesh topology.
But the wiring across modules has so far been talked about loosely:
NAVIGATION (Sprint 8a) is the obvious heavy consumer, and the rest of
the modules sometimes-mentioned-sometimes-not.

This ADR codifies the decision: **the sextant rasterizer is one
shared primitive at `shell/src/sextant/`, owned by no single module,
imported by any module that wants visualization.**

## Decision

1. **Shared module, not duplicated.** The sextant rasterizer ports
   from `docs/sextant_render.py` to JavaScript at
   `shell/src/sextant/rasterizer.js`. Modules import from there.
   Server-side Python keeps the prototype at `docs/sextant_render.py`
   for now; if the OPi5 needs server-side rasterization (e.g. for
   pre-rendering ZIM-embedded images at index time), it lifts to
   `server/sextant/` from the same source.

2. **JS port slot: Sprint 4 (static-shell discipline).** That sprint
   is already about settling bundle composition + service worker
   pre-cache. Adding the sextant module to the bundle there is a
   minor footprint. Sprint 8a (NAVIGATION text-map) is the first
   heavy consumer and depends on this port being done.

3. **Module wiring is a per-module concern.** Each module that wants
   sextant rendering imports the helpers it needs and renders into
   its own DOM. The sextant module itself is render-only — it knows
   nothing about the modules that call it.

4. **Box-drawing remains the chrome primitive.** Status strip,
   breadcrumb, hotkey bar, panel frames continue to use CP437 box-
   drawing. Sextant is for *content* visualization inside panels, not
   for layout chrome. The two primitives don't overlap.

## Where it gets used (initial pass — not exhaustive)

| Module          | Sprint | Sextant use cases                                    |
|-----------------|--------|------------------------------------------------------|
| KNOWLEDGE       | 5      | Conversation-tree branch visualizer (Branches view)  |
| MEDICAL         | 7      | Body diagrams (triage point selection)               |
| NAVIGATION      | 8 / 8a | Text-map renderer with hillshading, contours,        |
|                 |        | viewshed, OS grid, ruler — the canonical heavy user  |
| LOG             | 9      | Daily-density heatmap (entries-per-hour-per-day)     |
| INVENTORY       | 10     | Cache fill heatmaps; pack-optimizer footprint maps   |
| TIMELINE        | 11     | Per-day event-density bands across modules           |
| AUSPICE         | 12-13  | Moon phase imagery, hexagram glyphs, tarot card art, |
|                 |        | birth-chart wheel, year-wheel sabbats                |
| SIGNAL          | 14     | Spectrum waterfall, antenna patterns, NOAA APT       |
|                 |        | decoded frames, ADS-B traffic glyphs                 |

POWER (Sprint 3, the canary) ships first and stays on Unicode
block-character sparklines (`▁▂▃▄▅▆▇█`) because those are even
denser per character for 1D time-series data than sextant. Sextant
in POWER would only pay off if/when the radio sub-tile shows
spectra, at which point it imports from the shared module.

## Implications

- **Sprint 4 plan addendum (no separate ADR needed).** The Sprint 4
  task list gains: "Port `docs/sextant_render.py` to
  `shell/src/sextant/rasterizer.js` + `binarize.js` (Otsu, Niblack,
  Floyd-Steinberg, Atkinson). Add a small API doc in the ADR or in
  a co-located `shell/src/sextant/README.md`."

- **Bundle size impact.** The rasterizer + binarization helpers are
  pure JS (no large lookup tables outside the U+1FB00..U+1FB3B map).
  Estimated < 10 KB minified. Comfortably within the 2 MB plan-§5
  budget.

- **Test surface.** `tests/unit/test_sextant.py` (Python prototype) +
  `shell/src/sextant/__test__/` (JS port) ship together; both run
  the same fixture vectors so the two implementations stay in sync.
  Port-time exercise: round-trip a few canonical 32×32 bitmaps and
  assert exact-match output between Python and JS.

- **Server-side rasterization.** Deferred. The shell renders on demand
  in the browser today. If the OPi5 starts pre-rendering (Sprint 14
  SIGNAL spectrum decode is a candidate), `server/sextant/` lifts
  from the same prototype.

## Why this matters

Without this ADR, the next time a sprint (say AUSPICE) lands tarot
art, the temptation will be to copy the rasterizer into
`shell/src/modules/auspice/sextant.js` and tweak it locally. Three
sprints later, NAVIGATION will have its own version, MEDICAL will
have a third, and tweaks to the algorithm will diverge. ADR-0009
locks in the no-duplication pattern before the first bug
fork-divergence happens.
