# ADR-0013: NAVIGATION backend — routing, elevation, terrain, MBTiles

**Status:** Accepted (Sprint 8)
**Deciders:** Ted (delegated; standing autonomous mandate); recorded by Sprint 8 author

## Context

Sprint 8 (NAVIGATION refresh) needs five external-data backends:

  1. Offline routing (GraphHopper or Valhalla)
  2. Elevation data (SRTM tiles)
  3. Line-of-sight calculation (Fresnel-zone aware)
  4. MBTiles map tiles
  5. Terrain raster for the sextant text-map (Sprint 8a — first real
     consumer of the sextant primitive per ADR-0009)

Per the standing autonomous mandate, all five ship synthetic-first
behind clean swap interfaces.

## Decisions

### Routing — `OVERSEER_NAV_ROUTING=synthetic|graphhopper|valhalla`

Synthetic for Sprint 8: returns a great-circle line + straight-line
distance with a hand-tuned per-mode multiplier (foot 1.4×, bike 1.1×,
car 1.05×). Real routing requires a routing engine + OSM data on the
OPi5 — Sprint 8.5+ work, slotted when Ted has the routing tile pack
loaded. GraphHopper and Valhalla both ship as Java/C++ binaries; the
choice between them is bandwidth-vs-quality and can be deferred.

### Elevation — `OVERSEER_NAV_ELEVATION=synthetic|srtm|tiff`

Synthetic: deterministic noise function derived from (lat, lon)
producing plausible 0-3000m elevation values. Real source is SRTM 90m
HGT files (~1 GB for the UK); Sprint 8.5+ when the dataset is
provisioned. The interface returns scalars or [profile] arrays; both
sides match.

### Line-of-sight — built on the elevation source

LOS is just a Fresnel-zone check over the elevation profile between
two points. No new dependency; runs on whatever elevation source is
configured. Sprint 8 ships the algorithm against synthetic elevation;
swapping to SRTM data swaps the LOS results without code changes.

### MBTiles — `OVERSEER_NAV_TILES=fixture|mbtiles`

Per the project memory: tiles live on Overseer Prime (OPi5 Max) and
aren't synced to dev boxes. Sprint 8 ships a tiny fixture tile (a
single 256×256 PNG of synthetic terrain) so the gate exercises the
tile-fetch path. Real MBTiles serving is the legacy v2 `serve_tile`
already kept; Sprint 8 just doesn't depend on it being available.

### Terrain raster for sextant text-map — `OVERSEER_NAV_TERRAIN=synthetic`

Sprint 8a's text-map needs a binary bitmap input for the sextant
rasterizer. The terrain source is built on the elevation source plus
overlays (river hand-painted on synthetic terrain, road grid, etc.).
Lives in `server/modules/navigation.py:terrain_bitmap()`.

This is the **first real consumer of `shell/src/sextant/` in
production code** (Sprint 4 only had test fixtures). ADR-0009 promised
parity between the Python prototype and the JS port — Sprint 8a
exercises that promise. If the parity fixtures pass and a real
synthetic-terrain bitmap renders identically on both sides, the
sextant primitive is production-ready.

## Consequences

  - **NAVIGATION ships in Sprint 8 without any external data
    dependencies.** Every backend has a synthetic mode with a
    deterministic seed; tests are reproducible.
  - **Real-data swap** is one env-flag flip per backend (and the
    matching binary/data on disk). The shell never knows.
  - **Sextant primitive earns its keep** — Sprint 8a is a
    high-resolution test of the JS port's correctness. Any drift
    against the Python prototype gets surfaced and fixed in this
    sprint, not papered over.

## Revisit triggers

  - GraphHopper/Valhalla evaluation when Ted has OPi5 + OSM data
    loaded → pick one, flip flag, drop the synthetic mode for routing.
  - SRTM tile pack on OPi5 → flip elevation flag.
  - Real MBTiles dataset usable from the dev box → flip tiles flag,
    drop the fixture tile.
