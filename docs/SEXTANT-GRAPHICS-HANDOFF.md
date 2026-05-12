# SEXTANT GRAPHICS — Handoff Notes

> **Purpose.** This document hands off the sextant graphics work to Claude Code on a dev machine for iteration. It is intentionally a working document, not a finished spec — the goal is to get the toolchain to a point where production-quality art can be built and reviewed iteratively before the cross-module spec patches are written.
>
> **Status.** Architecture decided, rasterizer prototyped, deck-builder design sketched. The four big spec patches (Design Spec, Maps Module, AUSPICE v2, REBUILD v3) are deferred until quality-of-output has been validated against real reference images. No point writing the patches if the underlying pipeline produces bad art.
>
> **What this hands off.**
> 1. The architectural decisions made in conversation, recorded as commitments.
> 2. The working Python rasterizer (`sextant_render.py`, in this same outputs folder) — production-shaped, ready to extend.
> 3. The deck-builder tool spec — what to build on top of the rasterizer.
> 4. Reference image pool architecture — how to source art legally and reproducibly.
> 5. Integration points across all Overseer v3 modules — where the new primitive lands.
> 6. Quality tuning notes — parameters to iterate on.
> 7. Open questions that need real-image experimentation to settle.
>
> **What it doesn't hand off.** Final art. Production deck files. The cross-module spec patches. Those come after the toolchain is validated.

---

## 1. Architectural commitments

These were settled in conversation. Recording them here so Claude Code and you don't have to re-litigate.

### 1.1 The sextant primitive

**Sextants are the system-wide graphics primitive for Overseer v3.** Every piece of imagery in the system that is not actual cartographic raster (raw MBTiles) flows through the sextant rasterizer. This includes:

- The moon mask in AUSPICE/SKY and AUSPICE/DAILY
- All tarot card art across all decks
- All oracle deck art (Lenormand, runes, themed oracle decks)
- I Ching hexagram rendering
- The chart wheel in AUSPICE/CHART (smooth circles via sextants beat box-drawing curves)
- ATLAS density washes in REBUILD
- Body diagrams in MEDICAL
- Antenna patterns and frequency spectra in SIGNAL
- System-block diagrams in POWER
- Mesh topology visualizations in COMMS
- The map tiles in the new MAPS module

Box-drawing characters (`─│┌┐└┘├┤┬┴┼╔╗`) remain the language of layout chrome — frames, dividers, the F-key bar. They handle structure. Sextants handle imagery.

### 1.2 The rendering rule

| Content | Source | When generated |
|---|---|---|
| Reference-derived art (tarot, oracle decks) | Image search → curated reference pool → rasterizer | Build time, dev machine, human review |
| Parametric art (moon, antenna patterns, hexagrams, chart wheel) | Math → rasterizer | Runtime on operator device |
| Geographic art (map tiles) | Real MBTiles raster → rasterizer | Runtime, then cached, then mesh-transmissible |

The rasterizer is the same in all three cases — a pure function from `(bitmap, dimensions, parameters) → sextant string`. The differences are just where the bitmap comes from.

### 1.3 The trust gradient (carried over from prior decisions)

Same as REBUILD-v2 and AUSPICE: no LLM generation at runtime, ever. The deck-builder LLM only assists at build time on the developer's machine, and even then it cannot write card meanings — only assist with reference image selection and naming. All meanings come from public-domain cited sources (Waite 1910 for RWS; Legge 1882 for I Ching; etc.) or from named human authors (developer-defined oracle decks; operator-authored peer decks).

The deck-builder LLM does *not* generate sextant strings. It assists in selecting source images and themed names; the rasterizer does the deterministic conversion of image → sextant.

### 1.4 The font situation

The system ships an Iosevka subset with full sextant coverage embedded as a webfont. This is necessary because OS font support for U+1FB00..U+1FB3B is uneven (good on macOS, partial on Windows, varies on Linux). Earlier in this project a sextant font subset was already built — locate it in the existing repo and verify it covers all 60 sextant codepoints plus the four substitution codepoints (U+0020 space, U+2588 full block, U+258C left half, U+2590 right half). The rasterizer assumes these substitutions per the Unicode TR for Symbols for Legacy Computing.

### 1.5 Themed colors come from CSS, not from glyphs

A sextant glyph carries no color information itself. The accent color (PHOSPHOR green, AUSPICE violet, AMBER, IBM, PAPER, ACID) is applied via CSS `color` and `text-shadow` on the containing element. This means:

- The same sextant string renders identically across every theme — only the color overlay changes
- A sextant string compresses identically regardless of how the theme will render it
- Multi-color art (e.g., a map tile with roads in one shade and water in another) is achieved by *layering multiple sextant strings* with different CSS classes, not by encoding color into the strings themselves

For multi-channel imagery (the headline case is map tiles), the rasterizer produces one sextant string per channel. Each channel is rendered in its own color. Stacked via absolute positioning in the renderer.

### 1.6 Dimensions per content type

Initial recommendations. Tune in iteration:

| Content | Cells (W × H) | Sub-pixels | Rationale |
|---|---|---|---|
| Tarot card (small, in spread) | 16 × 24 | 32 × 72 | Fits 3 cards across phone screen |
| Tarot card (large, single) | 24 × 36 | 48 × 108 | Detailed view, single card |
| Oracle card | 20 × 28 | 40 × 84 | Generally smaller than tarot |
| Lenormand card | 16 × 22 | 32 × 66 | Small format historically |
| I Ching hexagram | 15 × 8 | 30 × 24 | Six lines plus gaps |
| Rune | 8 × 12 | 16 × 36 | Single glyph |
| Moon mask | 24 × 8 | 48 × 24 | Wide aspect; lunar disk fits |
| Chart wheel | 42 × 14 | 84 × 42 | Circular, ~3:1 aspect for terminal cell shape |
| Body diagram (front) | 24 × 36 | 48 × 108 | Anatomical landmarks visible |
| Antenna pattern | 24 × 12 | 48 × 36 | Polar plot |
| Frequency spectrum | 60 × 8 | 120 × 24 | Wide, low height |
| Map tile | 24 × 16 | 48 × 48 | Square; matches OSM tile aspect |

The terminal cell aspect ratio is roughly 1:2 (wider tall than wide). Sextant cells (2 wide × 3 tall sub-pixels) inside that cell give an effective 2:3 sub-pixel aspect. Plan dimensions accordingly: a "square" image needs roughly equal cell-width and cell-height counts, but the underlying sub-pixel grid is tall.

---

## 2. The rasterizer

`sextant_render.py` (in this outputs folder) is the working prototype. It contains:

- `sextant_char(pattern)` — pure function from 6-bit pattern to character, handling the four substitution codepoints correctly
- `rasterize(bitmap)` — convert a 2D list of 0/1 values to a sextant string
- Demo generators for moon mask, hexagram, map tile (synthetic), chart wheel, and a placeholder Fool card

What's there works correctly. What it needs for production:

### 2.1 Ingest real raster images

Currently the demos build bitmaps procedurally. For tarot/oracle decks, the input is a reference image file (PNG, JPG, whatever). Add an `ingest_image(path, target_w, target_h, mode='auto')` function that:

1. Loads via Pillow (`from PIL import Image`)
2. Resizes to `(target_w * 2, target_h * 3)` pixels
3. Converts to grayscale
4. Applies contrast normalization (autoleveling — `PIL.ImageOps.autocontrast`)
5. Optionally applies edge-enhancement (Sobel, blended at parameterized strength)
6. Binarizes via one of: simple threshold, Otsu's method, Floyd-Steinberg dither, Atkinson dither, Niblack adaptive threshold
7. Returns a 2D list ready for `rasterize()`

This is where most of the quality tuning happens. Different content types want different binarization modes:

- **Figure-heavy cards (Major Arcana characters):** Niblack adaptive threshold with moderate edge enhancement
- **Scene-heavy cards (Wheel of Fortune, Sun, Moon arcana):** Otsu threshold with light dithering
- **Texture-heavy cards (Pentacles backgrounds, Cups water):** Floyd-Steinberg dither
- **Map tiles:** Multi-channel — separate render per layer (roads, water, contours, buildings) with channel-specific thresholds, recombined in CSS

Make the binarization mode a parameter with sensible defaults, but allow per-card override in the deck-builder review UI.

### 2.2 Multi-channel rasterization

For map tiles especially, a single binary image throws away information. Add `rasterize_multichannel(layers, target_w, target_h)` where `layers` is a list of `(name, image, threshold_params)` tuples. Output is a dict of `{name: sextant_string}`. Renderer stacks them with different colors.

For the MAPS module, expected channels are:

- `water` — rivers, lakes, coastline
- `roads_major` — primary roads
- `roads_minor` — secondary roads, paths
- `buildings` — building footprints
- `contours` — elevation lines (optional, terrain mode)
- `labels` — text positions (passed through to renderer for chrome-layer rendering, not sextant)

Each layer comes from filtering the source MBTiles raster by feature type. Three to four layers is the sweet spot — more becomes visually noisy.

### 2.3 Source provenance tracking

Every produced sextant string should carry metadata: source image hash (SHA-256 of input file), parameters used (mode, threshold, edge weight), rasterizer version, dimensions. This goes in the deck file's per-card front-matter so any output can be traced back to its inputs and reproduced.

### 2.4 Determinism

The rasterizer must be deterministic — same input image + same parameters → same sextant string, byte for byte. This matters for:

- Reproducible builds
- Diff-able deck files in version control
- Reviewer trust (the review they did yesterday matches what gets committed today)

Floyd-Steinberg with default parameters is deterministic. Some adaptive threshold algorithms have nondeterminism in tie-breaking; document and pin choices.

---

## 3. The deck-builder tool

A standalone CLI tool that runs on the developer machine. Not shipped to operators. Lives in `tools/deck-builder/` in the Overseer repo.

### 3.1 Workflow

```
$ overseer-deck-builder new
  Source deck (canonical):       rider-waite-smith
  Theme description:             "maritime, 19th century sailing ships"
  Suit naming overrides:
    wands     → anchors
    cups      → lanterns
    swords    → sextants
    pentacles → charts
  Court naming overrides:
    page → cabin-boy / knight → first-mate / queen → bosun / king → captain
  Reference pool:                ./tools/deck-builder/refs/maritime/
  Art parameters:
    cells:      24 × 36
    mode:       niblack
    edge:       0.3
  Output:                        ./decks/maritime-rws/

  For each of 78 cards:
    1. Show LLM the source card name + theme + intended subject
    2. LLM proposes search query for reference pool
    3. Search returns N candidate images
    4. Builder rasterizes top 3 candidates at chosen parameters
    5. Show side-by-side: original images + sextant outputs + meanings (read-only)
    6. Developer picks one, adjusts parameters if needed, accepts
    7. Deck file written incrementally (resumable)

  78/78 cards complete. Ready for review pass.
  Run `overseer-deck-builder review ./decks/maritime-rws/` to finalize.
```

### 3.2 Hard constraints (enforced in code, not just policy)

The deck-builder enforces these via type-system / file-format / runtime checks. They are not soft conventions:

- **Cannot modify card meanings.** Themed decks reuse meanings from the source deck via a `meaning_source: <source_id>/<card_id>` reference. The themed card file has no `meaning` field. The renderer fetches meaning text from the source deck at display time. A themed card file with its own meaning *fails to load*.
- **Cannot modify deck structure.** RWS-78 means 22 majors + 4×14 minors. Builder cannot drop or add cards. The output schema is fixed at the structure type.
- **Output is text only.** No images written, no binary blobs. Each card is markdown front-matter + sextant string + sources list.
- **Provenance is mandatory.** Every output card has source image hash, rasterizer version, parameters. No anonymous output.
- **Provenance starts at `themed`, not `canon`.** A freshly-built themed deck is `provenance: themed` until a developer explicitly promotes it via `overseer-deck-builder review` (next section).

### 3.3 The review tool

Separate command. Walks the developer through every card, side-by-side with the source. Accept / reject / re-rasterize-with-different-params / edit name. Once all cards accepted, provenance flips from `themed` to `canon` (with `theme_of` still set, so origin is traceable). Commit to repo.

```
$ overseer-deck-builder review ./decks/maritime-rws/
  Reviewing 78 cards. [a]ccept, [r]eject, [e]dit params, [n]ame, [s]kip, [q]uit.

  ── Card 1/78: 00 The Fool / "the runaway" ─────────────────────────

  SOURCE IMAGE:                 SEXTANT RENDERING:
  [path: refs/maritime/         [shown in terminal as the actual
   1856-running-sailor.jpg]      24×36 sextant string]

  MEANING (verbatim from rider-waite-smith, immutable):
    Beginnings, leaps of faith, naive openness...

  PARAMETERS:                   PROVENANCE:
    cells:    24 × 36             source: 1856-running-sailor.jpg
    mode:     niblack             hash:   sha256:e7a4f3...
    edge:     0.3                 rasterizer: v0.3.1

  [a/r/e/n/s/q] >
```

### 3.4 The LLM's role, narrowly scoped

The LLM in the deck-builder is used for exactly two things:

1. **Search query generation.** Given source card "Three of Wands" and theme "maritime, 19th century sailing ships", propose: "sailor on quay watching three ships depart, 19th century engraving". This query goes to the reference pool's local search index.
2. **Themed name generation.** Given source name "Page of Wands" and the established suit/court mapping, propose: "cabin-boy of anchors". Developer accepts or edits.

The LLM does **not** see the card meanings. It does **not** generate sextant art (the rasterizer does that, deterministically, from selected images). It does **not** write any text that ends up in the deck file's body.

Prompting structure:

```
SYSTEM:
  You assist with image search query generation for a themed tarot deck
  builder. Given a source tarot card description and a theme, you produce
  a search query (8 words max) that will match relevant images in a
  curated reference image pool.
  
  You do NOT write card meanings. You do NOT describe imagery in detail.
  You do NOT produce final card art.

USER:
  Source card: Three of Wands (suit: wands, number: 3)
  Theme: maritime, 19th century sailing ships
  Imagery context (from theme): suits become anchors/lanterns/sextants/charts

OUTPUT (one query, no commentary):
  sailor watching ships depart from quay 19th century
```

This keeps the LLM in a narrow, well-defined role. It cannot drift into authoring.

---

## 4. Reference image pool

The deck-builder draws reference images from a curated local pool, not live web image search. This sidesteps copyright and gives reproducible builds.

### 4.1 Sources

- **Wikimedia Commons.** Largest pool of PD/CC-licensed images. Has bulk download tools.
- **Internet Archive.** Public-domain prints, photographs, illustrations.
- **NYPL Digital Collections.** PD prints and engravings.
- **Library of Congress PPOC.** PD photos and prints.
- **Smithsonian Open Access.** PD museum collections.
- **The Met Open Access.** PD museum collections.
- **Specific known PD art collections.** Pamela Colman Smith RWS originals (PD since 2021), classical engravings, etc.

For each source, document the licensing terms in `tools/deck-builder/refs/SOURCES.md`. Only PD or CC0 images go in the pool. CC-BY images can be included if attribution is preserved in the deck file's per-card sources field.

### 4.2 Pool structure

```
tools/deck-builder/refs/
├── SOURCES.md                 license documentation
├── INDEX.json                 generated search index (tags + filenames)
├── canonical/
│   └── rws-1909/              the actual Smith 1909 art for canonical RWS
│       ├── 00-fool.png
│       ├── 01-magician.png
│       └── ... (78 files)
├── maritime/                  themed pool: nautical, ships, sailors
│   ├── 1856-running-sailor.jpg
│   ├── ... (~200 images)
├── nature/                    themed pool: landscapes, flora, fauna
├── medieval/                  themed pool: castles, knights, peasants
├── ... 
```

Pools start small (50-200 images each) and grow as you build more decks. Adding a new image requires recording its source URL, license, and tag list in INDEX.json.

### 4.3 Search

Local full-text search over INDEX.json tags. Could use sqlite FTS5 or just grep for v1. The LLM-generated search query is matched against tags, returns top N candidates by tag overlap, builder rasterizes top 3 for review.

### 4.4 Canonical RWS specifically

The canonical RWS deck uses the actual 1909 Smith art directly — not "themed", not derived. Pamela Colman Smith's tarot illustrations are PD as of 2021 in most jurisdictions. Source from a high-quality scan (Wikimedia has good ones), rasterize all 78 with consistent parameters, commit.

This becomes the reference deck — every other tarot deck in the system is themed against RWS structure (with verbatim meanings) but with different sextant art.

---

## 5. Cross-module integration points

Notes on where the sextant primitive lands in each module. These are the "what to change" lists for the future spec patches — when the toolchain is ready, these become the patch documents.

### 5.1 AUSPICE

- **SKY:** moon mask becomes parametric sextant. Already shown in preview. Generated at runtime per the operator's location and current time.
- **CHART:** wheel becomes sextant. Houses, ASC marker, glyphs render as overlays in chrome layer.
- **TAROT:** all card art becomes sextant. Canonical RWS = rasterized Smith 1909. Themed decks = built via deck-builder.
- **ORACLE:** I Ching hexagrams become parametric sextant (real lines, not glyph approximations). Runes become single-glyph sextant (hand-rasterized one-time from PD reference). Lenormand cards become sextant (built via deck-builder from PD Lenormand 1846 art and historical engravings).
- **DAILY:** combines moon mask + card art on one screen. Already shown in preview.
- **JOURNAL:** no graphics; pure text.
- **ALMANAC:** the year wheel becomes sextant (smooth sabbat positions). Lunar calendar rows can show small sextant moon icons inline at quarter positions.

### 5.2 REBUILD

- **ATLAS:** density washes (the `░▒▓█` ramps showing tier progress) replaced with sextant-rasterized progress bars at higher fidelity. Era cards (`STONE`, `FIRE`, etc.) gain small sextant icons.
- **TREE:** dependency graph stays in box-drawing (it's geometric/structural, the language fits). No change.
- **POINTERS:** card layouts stay text. Optional: each pointer can have a small sextant icon (one per pointer, hand-rasterized from PD reference) for visual recognition.

### 5.3 MAPS (new module)

The biggest piece. The new module's headline feature is **mesh-transmissible map tiles via sextant rasterization.**

- Tile rendering: rasterize MBTiles raster tiles to multi-channel sextant.
- Channels: water, roads_major, roads_minor, buildings, contours.
- Each channel a separate sextant string, rendered in different theme accents.
- Tiles cached locally after first render.
- Mesh transport: a node with the MBTiles archive can render a tile and transmit it as gzipped sextant strings to a node that lacks the source data. ~250-500 bytes per tile.
- Operator-facing UI: pan/zoom, GPS overlay, waypoints (from existing Maps v2 data model), route plotting.

This is its own module spec, deferred until the rasterizer's multi-channel mode is working against real MBTiles.

### 5.4 MEDICAL

- **TRIAGE:** body diagrams (front, back, side silhouettes) rendered as sextant. One-time hand-rasterized from anatomical references. Pain points / injury markers overlay in the chrome layer at coordinates.
- **REFERENCE:** no graphics; pure text from KB.

### 5.5 SIGNAL

- **Antenna patterns:** parametric sextant (polar plot generated from antenna math).
- **Frequency spectrum:** parametric sextant (live amplitude bars over frequency axis).
- **Waterfall display:** parametric sextant (time on Y, frequency on X, amplitude → sub-pixel density).

### 5.6 POWER

- **System block diagram:** could be sextant (rendered from a topology JSON), but box-drawing might serve equally well. Defer decision until POWER module is being touched.

### 5.7 COMMS

- **Mesh topology view:** node-and-edge graph rendered as sextant (nodes as filled circles, edges as lines, signal strength as line weight via channel layering).
- **Message body:** pure text.

### 5.8 NAVIGATION

- **Compass rose:** parametric sextant.
- **Route diagrams:** sextant (path between waypoints with elevation profile underneath).
- **Elevation profiles:** parametric sextant (line plot).

---

## 6. Quality tuning notes

The parameters that will matter when iterating:

### 6.1 Per-content-type defaults

Likely starting points; tune from real outputs:

| Content type | Mode | Edge | Notes |
|---|---|---|---|
| Tarot, figure-heavy | Niblack | 0.3 | Major Arcana characters |
| Tarot, scenic | Otsu | 0.1 | Wheel, Sun, Moon, Star |
| Tarot, suit cards | Floyd-Steinberg | 0.0 | Pentacles, Cups, etc. |
| Lenormand | Otsu | 0.2 | Mostly object-focused |
| Runes | Threshold (manual) | 0.0 | Single glyph, often hand-tuned |
| Hexagrams | Procedural (no image) | n/a | Drawn from line array |
| Moon | Procedural | n/a | Drawn from illumination math |
| Map tile | Per-channel: water=Otsu, roads=threshold, buildings=Otsu | 0.0 | Multi-channel |
| Body diagram | Niblack | 0.5 | High edge for anatomy |
| Antenna pattern | Procedural | n/a | Drawn from antenna math |
| Chart wheel | Procedural | n/a | Drawn from circle/divider math |

### 6.2 Things to watch for

- **Over-dithering destroys recognizability.** A face dithered at full strength becomes noise. For figure cards, prefer hard-threshold or Niblack adaptive over Floyd-Steinberg.
- **Under-thresholding leaves cards muddy.** Auto-contrast before threshold matters.
- **Edge enhancement can help silhouettes but hurt text.** If a reference image has lettering, edge-enhance lightly or not at all.
- **Aspect ratio matters.** A square reference image rasterized to 24×36 (which is taller than wide in sub-pixels) gets squashed. Either crop the source first or accept the squash. Crop is usually right for tarot.
- **Tiny details disappear at low resolution.** A tarot card rasterized to 16×24 cells is 32×72 sub-pixels. Eye whites, individual fingers, small numbers don't survive. Pick reference images with strong silhouettes and high contrast.

### 6.3 Iteration workflow

When tuning:

1. Pick 5 representative cards spanning the visual variety (a Major Arcana character, a Major Arcana scene, a Wand, a Cup, a court card).
2. Rasterize all 5 with default parameters.
3. Review side-by-side with sources.
4. Note which fail and why.
5. Adjust parameters per failure type.
6. Re-rasterize.
7. Iterate until all 5 read clearly at intended display size.
8. Apply tuned parameters to the full 78.
9. Spot-check the full deck for outliers.

---

## 7. Open questions (need real-image experimentation to settle)

These are the ones that can't be decided in conversation and need actual rasterizer output against actual reference images.

**Q1: What's the smallest tarot card that still reads?** I recommended 16×24 cells for in-spread display, 24×36 for single-card view. Test both. The phone screen at typical font sizes can show maybe 50 cells across, so 3 cards × 16 cells + gaps fits comfortably. But if 16 is too small to read the figure, drop to 2 cards across at 24 cells each.

**Q2: Single-image rasterization or multi-channel for tarot?** Currently planning single-image. But a tarot card has a frame, the central figure, and a number/title — these could be three channels rendered separately, frame in one accent and figure in another. Probably overkill for v1; document as future option.

**Q3: How dense should the reference image pools be?** I suggested ~50-200 per theme. This is just a guess. May need 500+ for some themes to find good matches per card. Build the maritime pool (the test theme) first; see how many images the LLM finds for the trickier cards (Hanged Man, Wheel of Fortune, Hierophant in maritime context).

**Q4: Do parametric and reference-derived art need different rasterizer modes?** Parametric (moon, hexagrams, chart wheel) is binary by construction — no thresholding question. Reference-derived (cards) needs the full pipeline. Currently the same `rasterize()` function handles both. May want to split for clarity if the pipelines diverge.

**Q5: Does the chart wheel really benefit from sextants over box-drawing?** The preview suggests yes (smooth circles read well). But: glyphs and house numbers overlay in the chrome layer, which may collide with sextant-edge anti-aliasing artifacts. Test in actual browser at multiple themes.

**Q6: What's the right approach for runes?** 24 individual sextant glyphs, hand-rasterized once each from historical references. Or — since runes are angular by construction — drawn from a vector path math definition like hexagrams are. The latter is cleaner but requires authoring the path data for each rune.

**Q7: Map tile zoom level performance.** At z14 (city-block scale) a tile contains roads, buildings, water — readable. At z18 (building scale) detail goes up. At z10 (regional scale) it's mostly land/water with major roads. Each zoom needs its own tuning of which channels to include and what threshold to use. Test against real MBTiles from the existing v2 setup.

**Q8: How long does a tile actually take to rasterize?** A real MBTiles raster is 256×256 px. Per channel filter + threshold + sextant encode shouldn't be more than ~50ms on the OPi5 RK3588. But verify. If it's slow, cache aggressively.

**Q9: Multi-line spread layouts.** A Celtic Cross has 10 cards in a non-grid arrangement. With sextant-art cards at 16×24 cells each, fitting 10 cards on a phone screen is hard. May need scrolling or zoom. The current spread layout in the preview shows the cards as small slots; opening any one card jumps to single-card view. Confirm this UX works in practice.

**Q10: How does sextant art look on the Cardputer's tiny screen?** 1.14" 240×135 LCD. The card art at 16×24 cells will be tiny. May need a Cardputer-specific renderer mode that swaps to icon-style smaller art or just shows card name + tradition glyph.

---

## 8. What's deferred

The following deliverables were planned in the conversation but parked until the toolchain is validated:

1. **`01-DESIGN-SPEC-PATCH.md`** — adding "Spatial Diagrams via Sextant Graphics" as a foundational design pattern, plus "NEWCOMER mode" as a global cross-cutting feature.
2. **`MAPS-MODULE-SPEC.md`** — the new mesh-native maps module spec.
3. **`AUSPICE-MODULE-SPEC-v2.md`** — patch incorporating sextants, oracle variations, newcomer hooks, and the prior round's self-critique items (PD source corrections, Vedic scoped out, reflection prompts cut, redraw tracking made invisible, simpler shuffle protocol).
4. **`REBUILD-MODULE-SPEC-v3.md`** — patch incorporating sextants and newcomer hooks.
5. **`MODULE-MIGRATION-NOTES.md`** — short guide for migrating MEDICAL, SIGNAL, POWER, COMMS, NAVIGATION to sextant rendering.

These will be much easier to write once you have real rasterizer output to point at. The patches will say things like "the moon mask is rendered via [the rasterizer in tools/deck-builder/rasterize.py] with parameters [these]" and that whole sentence is hollow without the toolchain existing.

The right order for landing the deferred work:

1. Get the rasterizer to production quality (this is what Claude Code starts on).
2. Build the canonical RWS deck (78 cards from PD Smith 1909 art).
3. Build the MAPS module's tile rasterization against real MBTiles.
4. Land the I Ching, runes, and parametric renderers (moon, chart wheel, antenna patterns).
5. Validate quality in the actual chrome of each module.
6. *Then* write the spec patches with confidence about what to commit to.

---

## 9. Files to look at first

When Claude Code picks this up:

- `sextant_render.py` (in this same outputs folder) — the working rasterizer. Read this first.
- `sextant-graphics-preview.html` (in this same outputs folder) — visual preview showing the intended output across screens. Useful as a "this is what good looks like" reference, with the caveat that the tarot card art is hand-faked placeholder.
- The earlier sextant font subset work in the existing repo — find the Iosevka subset and verify codepoint coverage. If it's missing the four substitution codepoints (U+0020, U+2588, U+258C, U+2590), patch it.

Then start with:

- Add `ingest_image()` to the rasterizer with all binarization modes.
- Build a tiny test harness: a Python script that takes a directory of test images and rasterizes each at multiple parameter sets, outputs a comparison HTML page.
- Get the canonical RWS art rasterizing well (this is the longest-pole quality test).
- Once that looks right, build the deck-builder CLI around it.

---

End of handoff notes.
