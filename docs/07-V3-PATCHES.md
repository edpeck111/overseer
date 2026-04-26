# 07 — V3 HANDOFF PATCHES (text map integration)

> Cross-cutting edits to the existing v3 handoff docs to fold in the text-map system. Apply each patch in order; each section names the file, the existing content to find, and what to replace it with.
>
> All of these are documentation patches — no code changes here.

---

## Patch 1 — Update `README.md`

In the "What's in this folder" section, add a sixth document:

```
00-VISUAL-REFERENCE.html  — interactive design preview, single self-contained file
01-DESIGN-SPEC.md         — design system, principles, tokens, layout rules
02-MODULE-CATALOG.md      — every module fully spec'd
03-MESH-ARCHITECTURE.md   — Cardputer/OPi5/LoRa system architecture
04-IMPLEMENTATION-PLAN.md — sprint plan, migration, what to keep/throw
05-OMP-PROTOCOL.md        — binary mesh protocol spec
06-TEXT-MAP-SYSTEM.md     — text-based cartographic renderer (NEW)
demos/                    — proof-of-concept HTML demos for visual reference
README.md                 — this file
```

In the "TL;DR for impatient humans" section, add a bullet under "Core principles":

> **Text maps as primary view.** Custom Unicode-block renderer for cartography. Single LoRa packet per tile (~178 bytes for 21,600 effective sub-pixels). Overlays for waypoints/routes/zones are independent JSON state. Spec in `06-TEXT-MAP-SYSTEM.md`.

---

## Patch 2 — Update `01-DESIGN-SPEC.md`

In Section 2 "Design principles", add a new principle:

> **P11 — Text maps over raster.** Cartography in OVERSEER is rendered from Unicode block characters, not images. This is a hard architectural commitment: it makes maps mesh-viable, aesthetically continuous with the rest of the system, and accessible from any terminal. Raster maps remain available for high-detail WiFi-only browsing, but text is the default and primary view. Specifics in `06-TEXT-MAP-SYSTEM.md`.

In Section 4.1 "Color palette", add a new sub-section after the main palette:

> ### 4.1.5 Map palettes (per-region)
>
> Each map region ships with a 16-color palette tuned to its dominant terrain. The Lake District uses cool greens, blues, browns; the Cornish Coast leans warm sandy-blue; an urban region is muted reds and greys. Palettes are indexed by `palette_id` in the binary tile header; client renders by looking up RGB at draw time.
>
> Example palette colors per region in `06-TEXT-MAP-SYSTEM.md` §3 and the demos.

In Section 4.3 "Typography", add a note:

> **Font for maps:** the text map renderer requires Unicode block characters (sextants minimum, octants preferred). The shell ships Iosevka Mono as embedded base64 woff2 — universal sextant support, ~70 KB total weight. Other system fonts are accepted with a fallback chain (octant → sextant → quadrant). Detection happens at boot.

---

## Patch 3 — Update `02-MODULE-CATALOG.md`

In the NAVIGATION section, replace the existing sub-screen list:

```
NAVIGATION
├── (W) WAYPOINTS    Two-pane MC-style: list ↔ detail/mini-map
├── (R) ROUTE        From/To picker, calculate route
├── (M) MAP          Full-screen Leaflet (kept from v2)
├── (C) COMPASS      Text-only "where am I" — bearing/distance to nearest WPs
└── (G) GPS          Current position, accuracy, satellites
```

with this expanded version:

```
NAVIGATION
├── (T) TEXT MAP        primary low-bandwidth view (NEW — see 06)
├── (W) WAYPOINTS       two-pane MC-style: list ↔ detail
├── (R) ROUTE           from/to picker, calculate route
├── (M) MAP             full-screen Leaflet (kept from v2, WiFi only)
├── (C) COMPASS         text-only "where am I" — bearing/distance to nearest WPs
└── (G) GPS             current position, accuracy, satellites
```

Make TEXT MAP the default landing screen for NAVIGATION (instead of the WAYPOINTS list).

Add this new sub-section after the existing NAVIGATION block:

> ### Text map sub-screen (`(T)`)
>
> Primary cartographic view. Renders Unicode-block tiles fetched from the OPi5 (or cached locally on Cardputer). Sub-features:
>
> - Pan with arrow keys, zoom with `+/-`
> - All overlay layers togglable: hillshading (`H`), contours (`K`), viewshed (`V`), OS grid (`Y`), water animation (`A`)
> - Click-to-measure distance ruler with bearing
> - Add waypoint at cursor (`W`)
> - Calculate route to point (`R`)
> - Layer menu (`L`)
>
> Full spec in `06-TEXT-MAP-SYSTEM.md`. Renders at 80×30 / 100×36 / 120×42 viewport sizes; cell size auto-fits container width.

In the data model for NAVIGATION, add a note:

> Text-tile storage is filesystem-based, not SQL. Tiles live at `/data/text-tiles/{region}/{z}/{x}/{y}.otile` with a manifest in `/data/text-tiles/index.json`. The OSM PBF source is regenerated annually or on user request via the `build-text-tiles.py` tool.

In the API endpoints for NAVIGATION, add:

```
GET    /api/n/tile/text/:z/:x/:y      ?region=...&mode=octant|sextant
GET    /api/n/tiles/text/bundle        POST { z, [(x,y)...] }
GET    /api/n/tile/text/pan-delta      ?base=<hash>&dx=<n>&dy=<n>
GET    /api/n/overlays/:region         ?kinds=waypoint,hazard,...
POST   /api/n/overlays/marker
```

---

## Patch 4 — Update `03-MESH-ARCHITECTURE.md`

In Section 5 "Caching strategy", add to the cache class table:

| Cache class | Endpoint examples |
|---|---|
| **STATIC** (existing) | shell assets, drugs, fortune, **text-map tiles** |
| ... | ... |

In the table itself, add a row:

| Endpoint | Class | TTL on WiFi | TTL on mesh |
|---|---|---|---|
| `/api/n/tile/text/*` | STATIC | forever | forever |
| `/api/n/overlays/*` | WARM | 30 s | 5 min |

Add a new sub-section after Section 9 "Compression strategy":

> ### 9.4 Text-map tile compression
>
> Text-map tiles use a specialized compression pipeline beyond Brotli + shared dictionary:
>
> 1. **Spatial prediction** — each cell predicted from left + upper neighbours; only residuals encoded (~70% of cells encode in 1 bit)
> 2. **Domain arithmetic coding** — per-region statistical models for cell-class transitions
> 3. **Multi-tile context** — bundles of 9 tiles compress together with shared Markov state
>
> Combined with Brotli + dictionary, a 100×36 dense tile encoding 21,600 effective sub-pixels compresses to ~178 bytes — single LoRa packet at any spreading factor. See `06-TEXT-MAP-SYSTEM.md` §3-4 for the wire format and detailed numbers.

In Section 11 "Cardputer firmware spec", add to the Bootstrap list:

> 5. Mount the text-tile pack for the operator's region from flash (~80 MB typical for one region at all zooms 6-14)

---

## Patch 5 — Update `04-IMPLEMENTATION-PLAN.md`

In Section 3 "Sprint plan", insert a new sprint between Sprint 8 (NAVIGATION refresh) and Sprint 9 (LOG):

> ### Sprint 8a — Text Map System (NEW)
>
> Spec: `06-TEXT-MAP-SYSTEM.md`. Estimated 6 weeks at relaxed pace, 3-4 weeks full-time.
>
> **Week 1:** renderer foundation — embed Iosevka, font detection, sextant renderer, class-priority cell algorithm, tight CSS, dynamic font sizing.
>
> **Week 2:** local enhancements — hillshading, contours, animated water, texture variation (with the `>>>` unsigned-shift fix), OS grid, viewshed.
>
> **Week 3:** overlay system — markers, labels with backdrops, routes, hazard zones, distance ruler.
>
> **Week 4:** tile generation pipeline — `build-text-tiles.py` reading OSM PBF, class encoding, per-region palettes, binary serialization, Brotli + dictionary, generate Lake District at all zooms.
>
> **Week 5:** wire protocol + caching — OMP opcodes 0x7C-0x7F, HTTP transport, service worker caching, pan-delta encoding, mesh simulator tests.
>
> **Week 6:** integration + polish — NAVIGATION sub-screen, hotkey bindings, theme variants, real Cardputer demo.
>
> **Gate:** open NAVIGATION → TEXT MAP, see Lake District render with hillshading + contours + waypoints + viewshed in <50ms; pan with arrow keys at <500ms per step over LoRa simulator at SF12.

In Section 4 "Database migration", add:

> ### 015_text_map_tiles.sql
>
> No SQL change — text tiles are filesystem-based. Just creates a directory `/data/text-tiles/` and runs `build-text-tiles.py` for the configured operating region as a one-time post-install step. The migration is a no-op on the database side; it's just a marker for "tile generation has been triggered".

---

## Patch 6 — Update `05-OMP-PROTOCOL.md`

In Section 3 "Opcode space", under "Navigation (0x70-0x8F)", add four new opcodes:

```
0x7C  TILE_TEXT_FETCH       {z, x, y, mode?, region?}      → {tile_data}      ~178 B avg
0x7D  TILE_TEXT_BUNDLE      {z, [(x,y)...]}                → {tiles[]}        bundled, ~120 B/tile
0x7E  TILE_TEXT_PAN_DELTA   {base_hash, dx, dy}            → {delta_data}     ~50 B
0x7F  TILE_TEXT_OVERLAY     {region, kinds[]}              → {markers[]}      ~30 B/marker
```

Replace the previous `0x7B TILE_FETCH` (raster) entry with:

```
0x7B  TILE_RASTER_FETCH    {z, x, y}                       → {png_data}      WiFi-only fallback
```

Add a note to Section 4 sequence diagrams:

> **Text tile fetch on first view:**
> ```
> Client requests TILE_TEXT_FETCH for (z=10, x=4527, y=2891)
>   → encoded request: ~16 bytes after compression
>   → server reads tile from /data/text-tiles/lakes/10/4527/2891.otile
>   → server returns raw tile contents (already compressed at generation time)
>   → response: ~178 bytes
>   → client decodes header, runs sextant renderer, paints
>   Total round trip on SF7 LoRa: ~2 seconds
> ```
>
> **Subsequent pan operations:**
> ```
> User presses Right arrow → client requests TILE_TEXT_PAN_DELTA
>   → server computes delta against client's currently-cached tile
>   → response: ~50 bytes (only the new column of cells)
>   → client splices delta into existing tile, re-paints
>   Total round trip on SF12 LoRa: ~5 seconds
> ```

---

## Patch 7 — Add the demo files

Create the directory `docs/v3-handoff/demos/` and copy in the four progressive HTML demos as visual reference:

```
demos/
├── 01-textmap-basic.html         (was textmap-demo.html)
├── 02-textmap-blocks-modes.html  (was textmap-blocks-demo.html)
├── 03-textmap-dense-overlay.html (was textmap-dense-demo.html)
├── 04-textmap-final.html         (was textmap-final.html)
└── README.md                     short note explaining the progression
```

The `README.md` for the demos folder:

```markdown
# Text Map Demos — Visual Reference

Four iterations showing the design progression. Each demo is self-contained;
open in a browser to see what the production renderer should look like.

1. **basic** — NetHack-style ASCII map with simple class system. Proves
   text maps can render geographic data legibly.

2. **blocks-modes** — five rendering modes side by side (char / shaded /
   quadrant / sextant / octant) showing the density progression. Proves
   sub-pixel rendering quadruples or octuples effective resolution at
   minimal byte cost.

3. **dense-overlay** — dense rendering with the class-priority algorithm
   (water always wins) and the full JS overlay system (markers, routes,
   hazard zones). Proves the architectural separation of base-tile vs
   overlays.

4. **final** — all enhancements: tight cells, hillshading, contours,
   animated water, texture variation, OS grid, viewshed, click-to-measure
   ruler. Proves the production feature set is achievable. The CSS and
   rendering JS in this file is the basis for the production renderer.

The demos use procedurally-generated synthetic geography (Lake District,
Thames Estuary, Cornish Coast, Snowdonia, Urban Core) so they can be
reviewed without a tile server. The production renderer consumes real
binary tiles generated by `tools/build-text-tiles.py` from OSM PBF data,
but the rendering code is identical.

See `06-TEXT-MAP-SYSTEM.md` for the full system spec.
```

---

## Patch 8 — Update sprint sequence numbering

After inserting Sprint 8a, renumber existing sprints if needed for clarity. The new sequence:

```
Sprint 0   Repo migration & dev environment
Sprint 1   Chrome + HOME
Sprint 2   Transport layer + OMP foundation
Sprint 3   POWER (canary)
Sprint 4   Static shell discipline
Sprint 5   KNOWLEDGE refresh
Sprint 6   COMMS refresh + boards
Sprint 7   MEDICAL wizard reflow
Sprint 8   NAVIGATION refresh (waypoints, routes, GPS — minus text map)
Sprint 8a  TEXT MAP SYSTEM (new)
Sprint 9   LOG
Sprint 10  INVENTORY
Sprint 11  TIMELINE
Sprint 12  SIGNAL
Sprint 13  RECREATION foundation
Sprint 14  RECREATION: Dragon's Tale
Sprint 15  SYSTEM polish + HELP
Sprint 16+ Polish, optional modules, hardware integration
```

Sprint 8 becomes "NAVIGATION refresh minus text map" — covering waypoints, routes, compass, GPS, and the existing Leaflet view restyled. Sprint 8a is then a focused build of the text-map system that integrates back into NAVIGATION as its primary sub-screen.

---

## Apply order

1. Drop `06-TEXT-MAP-SYSTEM.md` into `docs/v3-handoff/`
2. Drop the four demo HTMLs into `docs/v3-handoff/demos/` with the README
3. Apply patches 1-6 to existing handoff docs (find/replace text edits)
4. Renumber sprints per patch 8 in `04-IMPLEMENTATION-PLAN.md`
5. Commit as a single PR titled `docs(v3): integrate text-map system spec`

That's the complete handoff for text mapping in OVERSEER v3.
