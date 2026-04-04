#!/bin/bash
# ============================================================
# OVERSEER — Download UK Map Tiles (MBTiles format)
# ============================================================
# Downloads OpenStreetMap tiles for the UK at zoom levels 0-14
# and packages them into an MBTiles (SQLite) file.
#
# Requirements:
#   pip install tilepack
#
# The resulting .mbtiles file goes in the tiles/ directory.
# OVERSEER will auto-detect and serve it.
#
# WARNING: This downloads ~8-15 GB of tile data from OSM tile
# servers. Run this with a good internet connection BEFORE
# going off-grid. Be respectful of OSM tile usage policy.
# ============================================================

set -e

TILES_DIR="$(dirname "$0")/tiles"
OUTPUT="$TILES_DIR/uk.mbtiles"

# UK bounding box (approx)
# West, South, East, North
BBOX="-10.5,49.5,2.0,61.0"
MIN_ZOOM=0
MAX_ZOOM=14

echo "========================================"
echo " OVERSEER TILE DOWNLOADER"
echo "========================================"
echo ""
echo "Target:    $OUTPUT"
echo "Region:    United Kingdom"
echo "Bounds:    $BBOX"
echo "Zoom:      $MIN_ZOOM - $MAX_ZOOM"
echo "Est. size: 8-15 GB"
echo ""

# Check for tilepack
if ! command -v tilepack &> /dev/null; then
    echo "[!] tilepack not found. Install with:"
    echo "    pip install tilepack"
    echo ""
    echo "Alternative: use tileserver-gl or download pre-built"
    echo "MBTiles from https://openmaptiles.org/downloads/"
    echo "(Select 'Great Britain' under OpenStreetMap)"
    exit 1
fi

mkdir -p "$TILES_DIR"

if [ -f "$OUTPUT" ]; then
    echo "[!] $OUTPUT already exists."
    read -p "Overwrite? (y/N): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "Aborted."
        exit 0
    fi
    rm -f "$OUTPUT"
fi

echo "Starting download..."
echo "(This will take a while — grab a coffee)"
echo ""

tilepack \
    -s osm \
    -b "$BBOX" \
    -z "$MIN_ZOOM" \
    -Z "$MAX_ZOOM" \
    -o "$OUTPUT" \
    -f mbtiles

echo ""
echo "========================================"
echo "[OK] Download complete!"
echo "File: $OUTPUT"
echo "Size: $(du -h "$OUTPUT" | cut -f1)"
echo ""
echo "Restart OVERSEER to load the map data."
echo "========================================"
