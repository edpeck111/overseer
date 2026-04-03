#!/bin/bash
# ============================================
#  OVERSEER — Kiwix Knowledge Server Startup
#  Validates ZIM files and skips bad ones
# ============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KIWIX="$SCRIPT_DIR/kiwix/kiwix-serve"
ZIM_DIR="$SCRIPT_DIR/zim"

if [ ! -x "$KIWIX" ]; then
    echo "[!] kiwix-serve not found at $KIWIX"
    exit 1
fi

echo "Starting kiwix-serve..."
echo "Scanning ZIM archives in $ZIM_DIR..."

VALID_ZIMS=""
SKIP_COUNT=0
TOTAL=0

for zim in "$ZIM_DIR"/*.zim; do
    [ -f "$zim" ] || continue
    TOTAL=$((TOTAL + 1))

    # Skip files smaller than 1MB (corrupt or partial downloads)
    size=$(stat -c%s "$zim" 2>/dev/null || stat -f%z "$zim" 2>/dev/null || echo 0)
    if [ "$size" -lt 1048576 ]; then
        echo "  SKIP: $(basename "$zim") — too small (${size} bytes), likely corrupt"
        SKIP_COUNT=$((SKIP_COUNT + 1))
        continue
    fi

    VALID_ZIMS="$VALID_ZIMS \"$zim\""
    echo "  LOAD: $(basename "$zim")"
done

if [ "$TOTAL" -eq 0 ]; then
    echo "[!] No ZIM files found in $ZIM_DIR"
    exit 1
fi

if [ -z "$VALID_ZIMS" ]; then
    echo "[!] All $TOTAL ZIM files failed validation"
    exit 1
fi

COUNT=$((TOTAL - SKIP_COUNT))
echo ""
echo "Loading $COUNT of $TOTAL ZIM archives on port 8080..."
[ "$SKIP_COUNT" -gt 0 ] && echo "WARNING: $SKIP_COUNT files skipped (check downloads)"
echo ""

# Use eval to handle quoted paths, exec to replace shell process
eval exec "$KIWIX" --port 8080 $VALID_ZIMS
