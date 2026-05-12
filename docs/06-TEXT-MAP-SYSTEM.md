# 06 — TEXT MAP SYSTEM

> The OVERSEER text map is a from-scratch cartographic renderer built on Unicode block characters. It exists because raster map tiles cannot cross a LoRa mesh in usable time — a single PNG tile is 50+ packets and 5+ minutes at SF12. Text tiles fit in a single packet. This document specifies the entire pipeline: source data, encoding, transmission, rendering, and overlays.
>
> **Architectural primacy:** The text map is the *primary* low-bandwidth view in the NAVIGATION module. The existing Leaflet-based graphical map remains as a high-detail option for direct WiFi connections, but the text map is what every operator on every transport sees by default.

---

## 1. Why text maps

Three independent reasons, in order of importance:

**Bandwidth.** A 100×36 cell text tile rendering 21,600 effective sub-pixels of map detail compresses to ~178 bytes after Brotli + shared dictionary + spatial prediction + arithmetic coding. That's a single LoRa packet at any spreading factor. Pan-step deltas are ~50 bytes — instant on any link. The equivalent raster tile is ~12 KB and takes 50+ packets. The difference is between "interactive use over LoRa" and "completely impractical."

**Aesthetic continuity.** The rest of OVERSEER is monospace text in a BBS frame. Maps that pop into a graphical viewer are jarring. Text maps stay in-frame, on-grid, and use the same color palette and typographical conventions as everything else.

**Universal deployment.** The text map renders identically on a phone over WiFi, a Cardputer over LoRa, an SSH session into the OPi5, or a desktop browser. No GPU, no canvas, no WebGL. Just text. That means it works on whatever decade-old Linux machine an operator has scavenged.

---

## 2. The rendering hierarchy

Three rendering modes, selected automatically by font capability detection at boot. The wire format is identical for all three — only client-side downsampling differs.

### Mode A — Octant (preferred, Unicode 16, Sept 2024)

Each character cell is split into a **2×4 grid of 8 sub-pixels**. 256 codepoints (U+1CD00..U+1CDE5) cover every possible filled pattern.

Effective resolution: **8× a plain ASCII map**. A 100×36 view = 28,800 effective sub-pixels.

Font support: recent JetBrains Mono (≥ 2.304), Cascadia Code (≥ 2407.24), Iosevka (≥ 32.0), Fira Code (≥ 6.3). Older fonts render tofu boxes.

### Mode B — Sextant (default, Unicode 13, 2020)

Each character cell is split into a **2×3 grid of 6 sub-pixels**. 60 codepoints (U+1FB00..U+1FB3B), with four "missing" patterns mapping to existing block characters (`▌▐█` plus space).

Effective resolution: **6× plain ASCII**. A 100×36 view = 21,600 effective sub-pixels.

Font support: **universal in any modern monospace font** since 2020. JetBrains Mono, Iosevka, Fira Code, Hack, IBM Plex Mono, Cascadia, Source Code Pro, Inconsolata, Berkeley Mono — all have these.

**This is the production default.** Sextants render correctly on every realistic operator device including older systems.

### Mode C — Quadrant (fallback, Unicode 1.1)

Each character cell is split into a **2×2 grid of 4 sub-pixels**. 15 codepoints in U+2580..U+259F, plus space for empty.

Effective resolution: **4× plain ASCII**. Lower density but in literally every monospace font on Earth.

Used only when octant + sextant detection both fail (extremely rare on any system from this decade).

### Detection algorithm

At boot, the client renders three test glyphs (one octant, one sextant, one quadrant) into a hidden test element with a known font size. It measures the rendered width of each:

- Width matches `0.5em` → glyph rendered correctly
- Width is `0` or matches `1em` (full-width tofu) → glyph missing

The first mode that passes wins. The selection is cached in localStorage; user can override with `:map mode octant|sextant|quadrant`.

---

## 3. The wire format

A text tile is a binary blob with this structure:

```
+--------+--------+--------+--------+
| ver(1) | flags(1)| width(1)|height(1)|         8-byte fixed header
+--------+--------+--------+--------+
| palette_id(1) | glyph_set(1) | reserved(2) |
+--------+--------+--------+--------+
|         base_tile_hash(8)?         |    optional, present if flags&PAN_DELTA
+--------+--------+--------+--------+
|                                    |
|  arithmetic-coded stream           |    variable length payload
|  of (predicted) cell deltas        |
|                                    |
+--------+--------+--------+--------+
```

| Field | Size | Description |
|---|---|---|
| `ver` | 1 byte | Format version. Currently `0x01`. |
| `flags` | 1 byte | Bit flags (see below). |
| `width` | 1 byte | Tile width in cells (8-byte aligned, 8-128 typical). |
| `height` | 1 byte | Tile height in cells. |
| `palette_id` | 1 byte | Index into pre-shipped palette table (256 palettes). |
| `glyph_set` | 1 byte | `0`=universal, `1`=urban-favoured, `2`=upland-favoured, etc. |
| `reserved` | 2 bytes | Zero-filled, future use. |
| `base_tile_hash` | 8 bytes | Only if `flags & PAN_DELTA` — references a previously cached tile. |
| `payload` | variable | Compressed cell stream. |

**Flags:**

```
bit 0  HAS_HEIGHT       Per-cell elevation byte follows class byte
bit 1  PAN_DELTA        This tile is a delta from base_tile_hash
bit 2  HIGH_DETAIL      8-bit-per-cell encoding (default is 4-bit)
bit 3  RESERVED
bit 4  RESERVED
bit 5  ANIMATED         Has animation channel (water phases)
bit 6  TACTICAL         Includes per-cell tactical data (visibility, threat)
bit 7  RESERVED
```

**Crucially, no line breaks.** The decoder reflows by index. A tile of `width=100, height=36` is exactly 3,600 cells in row-major order in the payload stream.

### Cell encoding (compressed payload)

Each cell encodes to ~3-4 bits average after compression, from these source channels:

- **Glyph index** (~5 bits raw entropy, ~1.5 bits compressed): index into the per-region glyph alphabet (most regions use only 30-40 of the 256 octant codepoints, so `glyph_set` selects which subset is in use)
- **Color pair index** (~4 bits raw, ~1 bit compressed): index into the 16-color region palette, selecting (foreground, background) — the palette has only 16 colors so 4 bits = exact, but most cells use 1-3 of the 16 pairs so it compresses well
- **Optional height** (~8 bits raw if present, ~2 bits compressed): metres above tile-minimum, only present when `HAS_HEIGHT` flag is set

### The compression pipeline

Server side, per tile:

1. **Spatial prediction** — for each cell, predict from left + upper neighbours; encode only the residual. ~70% of cells are exactly the predicted value.
2. **Domain arithmetic coding** — using a per-region trained statistical model. The Lake District has different cell-class transition probabilities than London; both have models.
3. **Brotli** with shared dictionary — the dictionary is pre-trained on representative tiles + common glyph sequences. Ships once with the static shell, never re-transmitted.
4. **Multi-tile context** — when the client requests a 3×3 tile bundle, the nine tiles compress together as one Brotli stream. Per-tile cost drops ~30% because adjacent tiles share enormous redundancy.

---

## 4. Compression numbers (validated)

| View | Cells | Effective px | Raw | Brotli only | Brotli+dict | + Spatial pred | + Arith coding | + Multi-tile | LoRa packets |
|---|---|---|---|---|---|---|---|---|---|
| 80×30 standard | 2,400 | 14,400 | 2.4 KB | ~1.0 KB | ~360 B | ~250 B | ~190 B | **~140 B** | **1** |
| 100×36 dense | 3,600 | 21,600 | 3.6 KB | ~1.4 KB | ~520 B | ~340 B | ~250 B | **~178 B** | **1** |
| 120×42 huge | 5,040 | 30,240 | 5.0 KB | ~1.9 KB | ~720 B | ~480 B | ~340 B | **~250 B** | **1** |
| **Pan-step delta** | (only the new column) | — | — | — | — | — | — | **~50 B** | **<1** |

That's the production target — every standard tile fits in a single LoRa packet at any spreading factor. Pan operations effectively free.

---

## 5. The renderer

The client-side renderer runs in the static shell. Pure JavaScript, no canvas, no WebGL. Renders into the DOM as nested `<span>` elements.

### Tight cell rendering

The CSS that makes block characters meet edge-to-edge with no gaps:

```css
.canvas {
  font-family: 'Iosevka Mono', ui-monospace, monospace;
  font-size: 13px;        /* dynamically sized at runtime */
  line-height: 1;
  letter-spacing: 0;
  display: flex;
  flex-direction: column;
}
.canvas .row {
  display: flex;
  /* Sextant aspect ratio: 2×3 sub-pixels, square sub-pixels means 2:3 cell aspect.
     Iosevka char advance = 0.5em, so cell height = 0.75em for square sub-pixels. */
  height: 0.75em;          /* 0.62em for octant 2:4 ratio, 0.5em for quadrant */
  overflow: hidden;
  white-space: nowrap;
  align-items: flex-start;
}
.canvas .ch {
  display: inline-block;
  width: 0.5em;            /* matches Iosevka's char advance */
  height: 1em;
  flex: none;
  text-align: center;
  margin-top: -0.13em;     /* nudge glyph up to fill squashed row */
}
```

The negative `margin-top` and clipped `height` together crush all vertical font padding so adjacent rows of block characters meet precisely.

### Dynamic font sizing

The renderer computes font size from container width at draw time so the map always fills its container:

```javascript
function fitFontSize(containerWidth, cols) {
  // Iosevka char advance = 0.5em, so cell width = fontSize * 0.5
  // Solve: cols * fontSize * 0.5 = containerWidth
  return containerWidth / (cols * 0.5);
}
```

Called on `redraw()` and on `resize`. The cells stay square, the map fills the container, the same code adapts to phone, tablet, and desktop.

### Class-priority cell algorithm

When downsampling sub-pixels to a single cell, naïve majority voting drops important features. The fix is **priority-weighted scoring**:

```javascript
const CLASS_PRIORITY = {
  water: 100, shore: 80, urban: 70, peak: 60,
  forest: 30, hill: 25, moor: 20, grass: 10,
};

// Score each class present in the sub-pixels
const scored = Object.entries(counts).map(([cls, count]) => ({
  cls,
  score: count * (CLASS_PRIORITY[cls] || 1),
}));
scored.sort((a, b) => b.score - a.score);

const fgClass = scored[0].cls;
let bgClass = scored[1]?.cls || fgClass;

// Special: water always wins as either fg or bg if it's present at all
if (counts.water > 0 && fgClass !== 'water' && bgClass !== 'water') {
  bgClass = 'water';
}
```

This guarantees coastlines stay visible through aggressive downsampling and roads survive even when they're a single sub-pixel thread through a cell.

### Mask-to-glyph functions

Sextant (6 bits in row-major order):

```javascript
const SEXTANT_FALLBACK = {
  0x00: ' ',   // empty → space
  0x15: '▌',   // bits 0,2,4 (left column) → existing left half block
  0x2A: '▐',   // bits 1,3,5 (right column) → existing right half block
  0x3F: '█',   // all bits → full block
};

function sextantGlyph(mask) {
  if (SEXTANT_FALLBACK[mask] !== undefined) return SEXTANT_FALLBACK[mask];
  // Codepoint = 0x1FB00 + offset, where offset skips the 4 reserved masks
  let offset = mask;
  if (mask > 0x00) offset -= 1;
  if (mask > 0x15) offset -= 1;
  if (mask > 0x2A) offset -= 1;
  return String.fromCodePoint(0x1FB00 + offset);
}
```

Octant (8 bits) follows the same pattern with 16 reserved masks mapping to existing characters.

---

## 6. Local enhancements (free wire cost)

The base tile carries terrain class only. Every visual enhancement below is computed *at render time* on the client from local data. Zero added wire cost.

### Hillshading

NW sun direction simulated by computing local elevation gradient and modulating cell brightness ±30% based on the dot product with the sun vector:

```javascript
function hillshadeFactor(elev, x, y) {
  const dzdx = (getElev(elev, x+1, y) - getElev(elev, x-1, y)) * 0.5;
  const dzdy = (getElev(elev, x, y+1) - getElev(elev, x, y-1)) * 0.5;
  const sunX = -0.7, sunY = -0.7;       // NW
  const dot = dzdx * sunX + dzdy * sunY;
  return 1.0 + Math.max(-0.3, Math.min(0.3, dot * 5));
}
```

Source elevation: SRTM1 data on the OPi5 (~15 GB for global, ~500 MB for the UK alone). Cardputer ships with the operating region's slice in flash.

### Contour lines

Drawn every 50 m elevation, replacing terrain glyph at cell boundaries between contour bands:

```javascript
const cur = Math.floor(elev * 1000 / 50);
const left = Math.floor(elevLeft * 1000 / 50);
const up = Math.floor(elevUp * 1000 / 50);
if (cur !== left || cur !== up) {
  glyph = (cur !== left && cur !== up) ? '┼' :
          (cur !== left) ? '│' : '─';
  fg = 'rgba(176,220,200,0.55)';
}
```

Toggleable via `:map contours on/off`.

### Animated water

Per-cell deterministic phase delay creates a rolling shimmer:

```javascript
const animatePhase = isWater
  ? ((x * 0.31 + y * 0.21) % 4.2).toFixed(2) + 's'
  : null;
```

Applied as `animation-delay: -<phase>` on a CSS keyframe `ripple` that brightens the cell ±18% over 4.2s. Looks like real water.

### Texture variation

Forest, moor, and grass cells use deterministic pseudo-random secondary glyphs to break uniformity:

```javascript
function textureGlyph(mainGlyph, cls, x, y, seed) {
  const h = ((x * 2654435761) ^ (y * 40503) ^ seed) >>> 0;
  if (cls === 'forest' && (h % 7) === 0) {
    return ['♣', '♠', '⋆', '❀', '❁'][(h >>> 3) % 5];
  }
  if (cls === 'moor' && (h % 5) === 0) {
    return ['"', "'", ',', '`'][(h >>> 3) % 4];
  }
  if (cls === 'grass' && (h % 11) === 0) {
    return ['·', '.'][(h >>> 4) % 2];
  }
  return mainGlyph;
}
```

**Critical implementation note:** use unsigned right shift `>>>` not signed shift `>>` throughout, otherwise large hash values produce negative array indices and crash the renderer. The signed-shift bug cost a session of debugging — don't repeat it.

### OS national grid overlay

1km grid lines computed from `cellMeters` per tile. Rendered as `<div>` lines absolutely positioned over the canvas. Toggleable via `:map grid on/off`.

### Viewshed

Cells visible from the operator's position rendered normal; occluded cells dimmed to 35% opacity. Computed by ray-casting from observer through every cell:

```javascript
function computeViewshed(elev, ox, oy, observerHeight = 0.04) {
  const visible = new Uint8Array(elev.cols * elev.rows);
  const obsElev = getElev(elev, ox, oy) + observerHeight;
  for (let y = 0; y < elev.rows; y++) {
    for (let x = 0; x < elev.cols; x++) {
      if (x === ox && y === oy) { visible[y * elev.cols + x] = 1; continue; }
      const dx = x - ox, dy = y - oy;
      const dist = Math.hypot(dx, dy);
      const steps = Math.ceil(dist);
      let maxAngle = -Infinity;
      let occluded = false;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const sx = Math.round(ox + dx * t);
        const sy = Math.round(oy + dy * t);
        const sElev = getElev(elev, sx, sy);
        const sDist = dist * t;
        const angle = (sElev - obsElev) / sDist;
        if (s < steps) {
          if (angle > maxAngle) maxAngle = angle;
        } else {
          if (angle < maxAngle - 0.005) occluded = true;
        }
      }
      visible[y * elev.cols + x] = occluded ? 0 : 1;
    }
  }
  return visible;
}
```

This is genuinely useful for radio LOS planning, ambush avoidance, and tactical observation. Toggleable per-screen.

### Distance ruler

Click two points anywhere on the map → SVG line drawn, distance in metres/km and bearing in degrees displayed at midpoint. State stored in `rulerStart`/`rulerEnd` JSON.

---

## 7. The overlay layer

Markers, labels, routes, hazard zones, OS grid, ruler — all of these sit in a separate DOM layer absolutely positioned over the canvas. They are JavaScript-rendered from JSON state, never part of the wire-transmitted tile.

### The schema

```javascript
// Each marker is a small JSON object.
{
  name: 'CACHE-7',         // label text
  glyph: '●',              // single character to render
  x: 0.36,                 // fractional position 0..1 across tile
  y: 0.42,                 // fractional position 0..1 across tile
  color: '#ffb849',        // CSS color
  kind: 'cache',           // semantic tag (cache, water, rally, hazard)
  info: '14d rations',     // tooltip text
}

// A route is an array of [x, y] points.
[[0.50, 0.52], [0.46, 0.46], [0.42, 0.42]]

// A hazard zone is a bounding box.
{ x: 0.28, y: 0.58, w: 0.10, h: 0.10 }
```

### Why separate from the base tile

**Different lifecycle.** Terrain doesn't change. Waypoints, mesh-node positions, hazard reports change constantly. Decoupling them means terrain ships once and caches forever; overlays update in tiny independent messages.

**Tiny payload.** A waypoint is ~30 bytes encoded. Adding one to the map costs the user nothing in map-fetch terms.

**Independent toggle.** The user can hide/show overlay categories without re-fetching anything. This is exactly how Google Maps, Apple Maps, every modern mapping system works — the architectural pattern is universal.

**Crisp labels.** The label backdrop uses CSS to make text readable over any terrain:

```css
.overlay .marker .label {
  background: rgba(5,8,7,0.85);
  padding: 0 0.3em;
  text-shadow: 0 0 6px rgba(0,0,0,0.9);
  margin-left: 0.4em;
}
```

Labels can extend horizontally beyond their anchor cell — the only deliberate breaking of the 80×40 grid in OVERSEER, justified by readability needs.

### Position math

Each overlay element is positioned by computing the rendered cell width and height (`getBoundingClientRect()` on a sample cell), then placing the element at `(x * COLS * cellW, y * ROWS * cellH)` relative to the canvas origin.

---

## 8. The OPi5 tile generator pipeline

A one-time pre-processing step on the OPi5 that turns OSM PBF data into the binary text tiles the renderer consumes.

### Input

- **OSM PBF for the UK** — `~/data/great-britain-latest.osm.pbf` from Geofabrik (~1.5 GB compressed)
- **SRTM1 elevation** — `~/data/srtm/` GeoTIFFs covering the UK (~500 MB)

### Output

- **`~/data/text-tiles/{region}/{z}/{x}/{y}.otile`** — binary tiles, ~200-400 bytes each
- **`~/data/text-tiles/palettes.json`** — per-region 16-color palettes
- **`~/data/text-tiles/index.json`** — tile manifest (which tiles exist at which zoom)

### Pipeline stages

```python
# tools/build-text-tiles.py — rough sketch

import osmium
import rasterio
from PIL import Image
import brotli
from overseer.tiles import encode_tile, region_palette

class TileHandler(osmium.SimpleHandler):
    def __init__(self):
        self.features = []  # accumulated per-tile

    def way(self, w):
        if 'highway' in w.tags:
            self.features.append({'kind': 'road', 'major': w.tags.get('highway') in MAJOR_ROADS, ...})
        elif 'natural' in w.tags:
            self.features.append({'kind': w.tags['natural'], ...})
        # etc

def render_tile(z, x, y, region):
    """Render one tile to the binary format."""
    bbox = tile_to_bbox(z, x, y)
    handler = TileHandler()
    handler.apply_file(f'data/{region}.osm.pbf', filters=osmium.osm.Box(*bbox))

    elev = sample_srtm(bbox, cols=COLS, rows=ROWS)

    # For each sub-pixel position, classify the dominant feature
    cells = [[None]*COLS for _ in range(ROWS)]
    for y_cell in range(ROWS):
        for x_cell in range(COLS):
            sub_classes = []
            for dy in range(SUB_ROWS):
                for dx in range(SUB_COLS):
                    sx = x_cell * SUB_COLS + dx
                    sy = y_cell * SUB_ROWS + dy
                    cls = classify_subpixel(sx, sy, handler.features, elev)
                    sub_classes.append(cls)
            cells[y_cell][x_cell] = pick_priority_pair(sub_classes)

    # Encode
    palette_id = region_palette[region]
    glyph_set = pick_glyph_set(cells)
    payload = compress_cells(cells, palette_id, glyph_set)
    header = pack_header(version=1, width=COLS, height=ROWS,
                         palette_id=palette_id, glyph_set=glyph_set)
    return header + payload

def main():
    for region in REGIONS:
        for z in range(MIN_ZOOM, MAX_ZOOM + 1):
            for x, y in tiles_in_region(region, z):
                tile_data = render_tile(z, x, y, region)
                write_tile(region, z, x, y, tile_data)
```

### Storage requirements

| Coverage | Zoom levels | Estimated tiles | Total size |
|---|---|---|---|
| Single region (e.g. Lake District) | 6-14 | ~8,000 | **~80-200 MB** |
| Whole UK | 6-14 | ~250,000 | **~3-5 GB** |
| Whole UK incl. height channel | 6-14 | ~250,000 | **~6-10 GB** |

A small fraction of the OPi5's 512 GB NVMe. Compare to MBTiles raster equivalent at the same zooms (~25-30 GB UK).

A Cardputer ships with one or two operating regions in its flash (16 MB total) — that's enough room for ~80 MB of text tiles, which is a single region at all zoom levels. Operators living in different regions get different Cardputer firmware.

### Run frequency

Once at OPi5 setup, then ad-hoc when:
- OSM data is refreshed (annually for most users)
- The operating region changes
- A user reports a serious cartographic error and wants a regenerate

Generation time on RK3588: ~2-4 hours for the entire UK at all zooms. Done as a background `systemctl` unit with low CPU priority, runs at night.

---

## 9. The transport story

Tile fetches happen through OMP. New opcodes for `05-OMP-PROTOCOL.md`:

```
0x7C  TILE_TEXT_FETCH       {z, x, y, mode?, region?}      → {tile_data}      ~178 B avg
0x7D  TILE_TEXT_BUNDLE      {z, [(x,y)...]}                → {tiles[]}        bundled fetch, ~120 B per tile
0x7E  TILE_TEXT_PAN_DELTA   {base_hash, dx, dy}            → {delta_data}     ~50 B for single-step pan
0x7F  TILE_TEXT_OVERLAY     {region, kinds[]}              → {markers[]}      overlay JSON, ~30 B per marker
```

### Cache strategy

| Endpoint | Cache class | TTL on WiFi | TTL on mesh |
|---|---|---|---|
| `TILE_TEXT_FETCH` | STATIC | forever (terrain doesn't change) | forever |
| `TILE_TEXT_OVERLAY` | WARM | 30 s | 5 min |
| Pan operations | (handled by base cache) | — | — |

Operators panning around their familiar territory hit cache 99% of the time. Only when exploring new tiles does data cross the wire.

### Service worker integration

Text tiles are pre-cached aggressively. The static shell ships with a **starter tile pack** for the operating region — typically 200-500 tiles covering common zoom levels for the immediate area. Cold-start panning is instant.

---

## 10. Module integration (NAVIGATION refresh)

Update `02-MODULE-CATALOG.md` under NAVIGATION:

```
NAVIGATION
├── (T) TEXT MAP        primary low-bandwidth view (NEW)
├── (W) WAYPOINTS       two-pane MC-style: list ↔ detail
├── (R) ROUTE           from/to picker, calculate route
├── (M) MAP             full-screen Leaflet (kept from v2, WiFi only)
├── (C) COMPASS         text-only "where am I" — bearing/distance to nearest WPs
└── (G) GPS             current position, accuracy, satellites
```

`(T) TEXT MAP` becomes the default landing screen for NAVIGATION. Hotkeys within it:

```
↑↓←→     pan     +/- zoom     C center on me     W add waypoint at cursor
G goto coords    R route to     L layers menu     /find search
H hillshading    K contours     V viewshed       Y os grid
:map mode <octant|sextant|quadrant>     :map theme <topo|tactical|simple>
```

The graphical Leaflet view stays as `(M) MAP` for those rare WiFi-only cases where a user wants to zoom to street-level imagery on top of OS basemap. But text map is the default.

---

## 11. Implementation sprint plan

Slot this work into the v3 sprint sequence (per `04-IMPLEMENTATION-PLAN.md`) as a new sprint, ideally between the existing Sprint 8 (NAVIGATION refresh) and Sprint 9 (LOG):

### Sprint 8a — Text Map System

**Week 1: Renderer foundation**
- Embed Iosevka Mono (or chosen font) as base64 woff2 in shell
- Implement font detection (octant/sextant/quadrant capability check)
- Implement sextant renderer with class-priority cell algorithm
- Tight cell CSS (height 0.75em, margin-top -0.13em) for zero-gap rendering
- Dynamic font-size-to-fit-container computation
- Test against Lake District / Thames Estuary / Snowdonia / Cornish Coast / Urban procedural data (synthetic, like the demos)

**Week 2: Local enhancements**
- Hillshading from in-memory elevation
- Contour lines
- Animated water with deterministic phase
- Texture variation (with the unsigned-shift bug fix — `>>>` not `>>`)
- OS grid overlay
- Viewshed computation

**Week 3: Overlay system**
- Marker positioning math (fractional → pixel)
- Label backdrop CSS
- Route rendering as cell-spaced characters
- Hazard zones as translucent boxes
- Distance ruler with click-to-set

**Week 4: Tile generation pipeline**
- Python `build-text-tiles.py` reading OSM PBF (use `pyosmium` or `osmium-tool`)
- Class encoding from OSM features
- Per-region palette computation
- Binary serialization with the wire format from §3
- Brotli + shared dictionary integration
- Spatial prediction encoder
- Generate Lake District at all zooms as proof-of-concept

**Week 5: Wire protocol + caching**
- OMP opcodes 0x7C-0x7F
- HTTP transport for direct WiFi
- Service worker caching strategy
- Pan-delta encoding
- Tests against mesh simulator

**Week 6: Integration + polish**
- Slot into NAVIGATION module as `(T)` sub-screen
- Hotkey bindings
- Theme variants (`topographic`, `tactical`, `simple`)
- Browser font detection cache
- Documentation
- Demo against real Lake District tile pack on Cardputer

### Acceptance criteria

- [ ] Renders Lake District at 100×36 dense view with all 6 enhancement layers in <50ms on phone hardware
- [ ] Tile fetch over LoRa simulator at SF7 completes in <2 seconds per tile
- [ ] Pan operation completes in <500ms on simulated SF12 LoRa
- [ ] Tile pack for Lake District (z6-14) generates and stores in <30 minutes on RK3588
- [ ] Overlay markers update independently of base tile (toggle on/off has zero network effect)
- [ ] Font fallback chain works: octant → sextant → quadrant → ASCII

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Octant fonts not yet ubiquitous | Default to sextants; octants are an enhancement, not a requirement |
| Browser font rendering varies | Embed font as base64 in shell so all clients render identically |
| OSM data quality varies regionally | Fall back to topology-based class assignment when feature tags are sparse |
| Tile generation is slow | Run as background systemd unit with `nice -n 19`, generate over hours |
| Coastline tiles dominate ocean cells | Aggressive run-length encoding + per-tile glyph_set selection |
| Users want satellite imagery | Out of scope; the graphical Leaflet view is for that |
| Sub-pixel signed-shift bug | **Unit test that explicitly probes `(x * large_prime) >>> 0 >>> 3 % N` for negative results** |
| Label collision on dense waypoints | Implement leaderlines + jitter, lazygit-style |
| Different operators want different palettes | Per-region palette + `:map theme` user override |

---

## 13. Future extensions

Not for the initial sprint, worth listing for later:

- **Tactical drawing mode** — operator can pen zones, no-go markers, patrol routes directly on the map. Saved as overlay layer, syncable across mesh.
- **Multi-resolution composite views** — main map at one zoom + minimap at lower zoom in corner, both rendered as text.
- **Day/night palette swap** — automatic based on local sunrise/sunset times.
- **3D perspective mode** — render the map as an ASCII isometric projection. Pure flex.
- **Animated route playback** — replay a recorded GPS track at variable speed across the map.
- **Heat overlays** — show comms density, foot-traffic frequency, threat reports as a colour wash on top of the base.
- **Range rings** — 1km, 5km, 10km circles from your position, useful for radio planning and ETA estimation.

All of these slot into the overlay layer architecture without changing the base tile format.

---

## 14. The proven demos

For Claude Code's reference during implementation, we built four progressively-refined HTML demos that prove the approach works:

1. `textmap-demo.html` — initial NetHack-style char rendering, simple class system
2. `textmap-blocks-demo.html` — five rendering modes side by side (char/shaded/quadrant/sextant/octant) showing the density progression
3. `textmap-dense-demo.html` — dense octant rendering with class priority bug fixes and full overlay system
4. `textmap-final.html` — final iteration with hillshading, contours, animated water, texture variation, OS grid, viewshed, and click-to-measure ruler

These should ship in `docs/v3-handoff/demos/` as visual reference. The CSS, JavaScript, and procedural geography generation in `textmap-final.html` is production-ready; the production renderer adapts it to consume real binary tiles instead of generating synthetic geography.

---

End of text map system spec. This belongs in the v3 handoff package as `06-TEXT-MAP-SYSTEM.md`. Cross-references:
- `01-DESIGN-SPEC.md` should reference this for NAVIGATION's primary view
- `02-MODULE-CATALOG.md` NAVIGATION section should list `(T) TEXT MAP` as the new default sub-screen
- `03-MESH-ARCHITECTURE.md` should add text tiles to the cache class table as STATIC
- `04-IMPLEMENTATION-PLAN.md` should slot Sprint 8a between sprints 8 and 9
- `05-OMP-PROTOCOL.md` should add opcodes 0x7C-0x7F to the Navigation range
