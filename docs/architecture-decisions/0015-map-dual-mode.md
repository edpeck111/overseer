# ADR-0015: Map view is dual-mode — sextant text-map default, Leaflet opt-in

**Status:** Accepted (Sprint 22.6)
**Deciders:** Ted; recorded by Sprint 22.6 author
**Supersedes (implicitly):** the Sprint 21 decision to make Leaflet the
NAVIGATION map default

## Context

Sprint 8a landed the NAVIGATION `M` sub-screen as a sextant text-map —
the first production consumer of the system-wide sextant primitive
(ADR-0009) and the implementation of the design specified in
`docs/06-TEXT-MAP-SYSTEM.md`. That spec is unambiguous about
architectural primacy:

> The text map is the *primary* low-bandwidth view in the NAVIGATION
> module. The existing Leaflet-based graphical map remains as a
> high-detail option for direct WiFi connections, but the text map is
> what every operator on every transport sees by default.

The three load-bearing reasons documented there:

1. **Bandwidth.** A 100×36 cell text tile compresses to ~178 bytes
   (Brotli + shared dictionary + spatial prediction + arithmetic
   coding). One LoRa packet at any SF. The equivalent raster tile is
   ~12 KB / 50+ packets. The product is "interactive over LoRa" vs
   "completely impractical".
2. **Aesthetic continuity.** The rest of OVERSEER is monospace text
   in a BBS frame. Graphics that pop into a separate viewer break the
   experience.
3. **Universal deployment.** Text renders identically on a phone over
   WiFi, a Cardputer over LoRa, an SSH session into the OPi5, or a
   desktop browser. No GPU, no canvas, no WebGL.

Sprint 21 — "Real tiles + DISABLED banners" — quietly replaced the
sextant text-map with a Leaflet/MBTiles default. The smoke test was
updated to assert the Leaflet container in place of the sextant `<pre>`,
the inline header comment was changed to say "M sub-screen upgraded
from sextant text-map to real Leaflet tile map", and the change shipped
inside a larger commit (`b470ec3`) without an accompanying spec or ADR
update.

The regression went unnoticed until local testing on 2026-05-22 surfaced
"full graphic fidelity" maps in dev. The bandwidth argument doesn't
care about dev: when Overseer Prime is bridging to LoRa peers, every
operator on the far side gets paged ~12 KB tiles instead of ~178-byte
sextant tiles.

## Decision

The NAVIGATION map sub-screen is **dual-mode**. The default mode is the
sextant text-map; Leaflet/MBTiles is retained as an opt-in detail view.

| Aspect              | Text mode (default)              | Graphical mode (opt-in)            |
|---------------------|----------------------------------|------------------------------------|
| Source              | `/api/n/terrain` (1-bit bitmap)  | `/api/n/tiles/{z}/{x}/{y}` (MBTiles) |
| Renderer            | `shell/src/sextant/` (ADR-0009)  | Leaflet 1.9.4 (CDN)                |
| Wire size           | bytes — one LoRa packet          | KB per tile — WiFi only            |
| Toggle              | `T` key while in M sub-screen    | `G` key while in M sub-screen      |
| Fallback if missing | always available                 | DISABLED banner (no-tiles)         |

State (`local.mapMode`) persists for the lifetime of the NAVIGATION
mount. Switching modes destroys the Leaflet instance + GPS poll via a
shared `tearDownLeaflet()` to avoid DOM/timer leaks.

## Generalisation: ASCII-primary applies to *all* graphics

The text-map regression exposed a class of risk, not a one-off mistake.
Per project feedback memory `feedback_sextant_default_graphics.md`, all
visual rendering in OVERSEER goes through the sextant rasterizer by
default — maps, oracle/tarot card art, moon phase drawings, antenna
patterns, sigils, any future graphics. Full graphical renderers
(Leaflet, canvas, SVG, images) may exist as opt-in WiFi-only
alternatives, but they must never be the default.

Concretely, this means any future PR that introduces a non-sextant
default renderer for a visual element is in tension with this ADR and
should either justify the deviation explicitly or stay opt-in.

## Consequences

  - The bandwidth promise of OVERSEER over LoRa is restored. Operators
    on mesh links see the same UX as operators on WiFi — just with the
    sextant view that already worked over a single packet.
  - The spec (`docs/06-TEXT-MAP-SYSTEM.md`) is correct again without
    any spec edits; the regression was at the implementation layer.
  - Sprint 21's Leaflet plumbing (MBTiles endpoint, `tools/download_tiles.py`,
    Leaflet CDN includes, DISABLED-banner integration) is *kept* — all
    of it is reachable via `G` and is the right experience for WiFi.
  - Backend `terrain_bitmap()` + `/api/n/terrain` is now a load-bearing
    production endpoint, not a Sprint 8a relic. Any future schema /
    contract changes there need to maintain shell parity.
  - The sextant primitive earns its keep across the whole product, not
    just non-map modules.

## Revisit triggers

  - If the bandwidth math changes meaningfully (e.g. all peers move
    onto high-bandwidth links), revisit whether dual-mode is still
    warranted vs Leaflet-only with a text fallback for SSH-on-Pi
    sessions.
  - If the sextant rasterizer's overlay capabilities improve (coloured
    cells for operator/waypoints stamped on terrain), the inline
    waypoint legend below the text map can move to overlay form.
  - Any decision to drop Leaflet/MBTiles entirely (e.g. dataset
    licensing change) — a new ADR, not an inline edit here.
