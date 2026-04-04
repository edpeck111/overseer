#!/bin/bash
# ============================================================
# OVERSEER — Download UK Map Tiles (MBTiles format)
# ============================================================
# Downloads OpenStreetMap tiles for the UK and packages them
# into an MBTiles (SQLite) file using only Python3 + urllib.
# No pip packages required.
#
# The resulting .mbtiles file goes in the tiles/ directory.
# OVERSEER will auto-detect and serve it.
#
# WARNING: Downloads ~8-15 GB of tile data. Run with a good
# internet connection BEFORE going off-grid. Respects OSM
# tile usage policy with rate limiting.
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TILES_DIR="$SCRIPT_DIR/tiles"
mkdir -p "$TILES_DIR"
export MBTILES_OUTPUT="$TILES_DIR/uk.mbtiles"

echo "========================================"
echo " OVERSEER TILE DOWNLOADER"
echo "========================================"
echo ""
echo "Target:    $MBTILES_OUTPUT"
echo "Region:    United Kingdom"
echo "Bounds:    -10.5, 49.5, 2.0, 61.0"
echo "Zoom:      0 - 14"
echo "Est. size: 8-15 GB"
echo ""

if [ -f "$MBTILES_OUTPUT" ]; then
    echo "[!] $MBTILES_OUTPUT already exists."
    read -p "Overwrite? (y/N): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "Aborted."
        exit 0
    fi
    rm -f "$MBTILES_OUTPUT"
fi

echo "Starting download..."
echo "(This will take a long time — zoom 0-14 is millions of tiles)"
echo ""

python3 "$SCRIPT_DIR/download_tiles.py"

echo ""
echo "========================================"
echo "[OK] Download complete!"
echo "File: $MBTILES_OUTPUT"
if [ -f "$MBTILES_OUTPUT" ]; then
    echo "Size: $(du -h "$MBTILES_OUTPUT" | cut -f1)"
fi
echo ""
echo "Restart OVERSEER to load the map data."
echo "========================================"
