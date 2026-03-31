#!/bin/bash
# ============================================================
# OVERSEER — Setup Script
# Run on a fresh Orange Pi 5 Max (Armbian) or any Debian/Ubuntu
# Usage: chmod +x setup.sh && ./setup.sh
# ============================================================

set -e

OVERSEER_DIR="$(cd "$(dirname "$0")" && pwd)"
ZIM_DIR="$OVERSEER_DIR/zim"
KIWIX_DIR="$OVERSEER_DIR/kiwix"
SOUNDS_DIR="$OVERSEER_DIR/sounds"

# Colors
GREEN='\033[0;32m'
AMBER='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[OVERSEER]${NC} $1"; }
warn() { echo -e "${AMBER}[WARNING]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================================
# 1. SYSTEM PACKAGES
# ============================================================
log "Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq python3 python3-pip python3-venv curl wget

# ============================================================
# 2. PYTHON DEPENDENCIES
# ============================================================
log "Installing Python packages..."
pip3 install --break-system-packages flask requests psutil cryptography 2>/dev/null || \
pip3 install flask requests psutil cryptography

# ============================================================
# 3. OLLAMA
# ============================================================
if command -v ollama &>/dev/null; then
    log "Ollama already installed: $(ollama --version)"
else
    log "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
fi

# Pull the model
log "Pulling Qwen 2.5 7B model (this may take a while)..."
ollama pull qwen2.5:7b-instruct-q4_K_M

# ============================================================
# 4. KIWIX-SERVE
# ============================================================
mkdir -p "$KIWIX_DIR"

if [ -f "$KIWIX_DIR/kiwix-serve" ]; then
    log "Kiwix-serve already present"
else
    log "Downloading kiwix-tools..."
    ARCH=$(uname -m)
    case "$ARCH" in
        aarch64) KIWIX_ARCH="aarch64" ;;
        x86_64)  KIWIX_ARCH="x86_64" ;;
        armv7l)  KIWIX_ARCH="armv6" ;;
        *)       err "Unsupported architecture: $ARCH"; exit 1 ;;
    esac

    KIWIX_VERSION="3.8.0"
    KIWIX_URL="https://download.kiwix.org/release/kiwix-tools/kiwix-tools_linux-${KIWIX_ARCH}-${KIWIX_VERSION}.tar.gz"
    KIWIX_TAR="/tmp/kiwix-tools.tar.gz"

    wget -q --show-progress -O "$KIWIX_TAR" "$KIWIX_URL"
    tar -xzf "$KIWIX_TAR" -C "$KIWIX_DIR" --strip-components=1
    rm -f "$KIWIX_TAR"
    chmod +x "$KIWIX_DIR/kiwix-serve"
    log "Kiwix-serve installed"
fi

# ============================================================
# 5. ZIM FILES
# ============================================================
mkdir -p "$ZIM_DIR"

# ZIM download list — name and URL
# curl -C - resumes partial downloads
declare -A ZIMS=(
    # Medical / Reference
    ["mdwiki_en_all_maxi"]="https://download.kiwix.org/zim/mdwiki/mdwiki_en_all_maxi_2025-11.zim"
    ["wikem_en_all_maxi"]="https://download.kiwix.org/zim/wikem/wikem_en_all_maxi_2021-02.zim"
    ["ifixit_en_all"]="https://download.kiwix.org/zim/ifixit/ifixit_en_all_2025-12.zim"
    ["appropedia_en_all_maxi"]="https://download.kiwix.org/zim/other/appropedia_en_all_maxi_2026-02.zim"
    ["energypedia_en_all_maxi"]="https://download.kiwix.org/zim/other/energypedia_en_all_maxi_2025-12.zim"

    # Wikimedia
    ["wikibooks_en_all_maxi"]="https://download.kiwix.org/zim/wikibooks/wikibooks_en_all_maxi_2026-01.zim"
    ["wikivoyage_en_all_maxi"]="https://download.kiwix.org/zim/wikivoyage/wikivoyage_en_all_maxi_2026-03.zim"

    # Stack Exchange
    ["cooking.stackexchange"]="https://download.kiwix.org/zim/stack_exchange/cooking.stackexchange.com_en_all_2026-02.zim"
    ["diy.stackexchange"]="https://download.kiwix.org/zim/stack_exchange/diy.stackexchange.com_en_all_2026-02.zim"
    ["electronics.stackexchange"]="https://download.kiwix.org/zim/stack_exchange/electronics.stackexchange.com_en_all_2026-02.zim"
    ["gardening.stackexchange"]="https://download.kiwix.org/zim/stack_exchange/gardening.stackexchange.com_en_all_2026-02.zim"
    ["ham.stackexchange"]="https://download.kiwix.org/zim/stack_exchange/ham.stackexchange.com_en_all_2026-02.zim"
    ["homebrew.stackexchange"]="https://download.kiwix.org/zim/stack_exchange/homebrew.stackexchange.com_en_all_2026-02.zim"
    ["mechanics.stackexchange"]="https://download.kiwix.org/zim/stack_exchange/mechanics.stackexchange.com_en_all_2026-02.zim"
    ["outdoors.stackexchange"]="https://download.kiwix.org/zim/stack_exchange/outdoors.stackexchange.com_en_all_2026-02.zim"
    ["woodworking.stackexchange"]="https://download.kiwix.org/zim/stack_exchange/woodworking.stackexchange.com_en_all_2026-02.zim"

    # Gutenberg
    ["gutenberg_en_lcc-r"]="https://download.kiwix.org/zim/gutenberg/gutenberg_en_lcc-r_2026-03.zim"
    ["gutenberg_en_lcc-u"]="https://download.kiwix.org/zim/gutenberg/gutenberg_en_lcc-u_2026-03.zim"
    ["gutenberg_en_lcc-v"]="https://download.kiwix.org/zim/gutenberg/gutenberg_en_lcc-v_2026-03.zim"

    # Uncomment these for the full set (large downloads):
    # ["gutenberg_en_lcc-g"]="https://download.kiwix.org/zim/gutenberg/gutenberg_en_lcc-g_2026-03.zim"
    # ["gutenberg_en_lcc-s"]="https://download.kiwix.org/zim/gutenberg/gutenberg_en_lcc-s_2026-03.zim"
    # ["gutenberg_en_lcc-t"]="https://download.kiwix.org/zim/gutenberg/gutenberg_en_lcc-t_2026-03.zim"

    # Uncomment for Wikipedia (WARNING: ~100GB):
    # ["wikipedia_en_all_nopic"]="https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_nopic_2026-03.zim"
)

TOTAL=${#ZIMS[@]}
COUNT=0

for name in "${!ZIMS[@]}"; do
    COUNT=$((COUNT + 1))
    url="${ZIMS[$name]}"
    filename=$(basename "$url")
    filepath="$ZIM_DIR/$filename"

    if [ -f "$filepath" ]; then
        # Check if file looks complete (compare with Content-Length)
        local_size=$(stat -c '%s' "$filepath" 2>/dev/null || stat -f '%z' "$filepath" 2>/dev/null)
        remote_size=$(curl -sIL "$url" 2>/dev/null | grep -i content-length | tail -1 | awk '{print $2}' | tr -d '\r')

        if [ "$local_size" = "$remote_size" ] 2>/dev/null; then
            log "[$COUNT/$TOTAL] $filename — already complete"
            continue
        else
            log "[$COUNT/$TOTAL] $filename — resuming download..."
        fi
    else
        log "[$COUNT/$TOTAL] $filename — downloading..."
    fi

    curl -C - -L --progress-bar -o "$filepath" "$url"
done

log "ZIM downloads complete"

# ============================================================
# 6. STARTUP SCRIPTS (Linux)
# ============================================================
cat > "$OVERSEER_DIR/start_kiwix.sh" << 'KEOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KIWIX="$SCRIPT_DIR/kiwix/kiwix-serve"
ZIM_DIR="$SCRIPT_DIR/zim"

echo "Starting kiwix-serve..."
ZIMS=$(find "$ZIM_DIR" -name "*.zim" -type f)
if [ -z "$ZIMS" ]; then
    echo "No ZIM files found in $ZIM_DIR"
    exit 1
fi
echo "Loading $(echo "$ZIMS" | wc -l) ZIM archives..."
$KIWIX --port 8080 $ZIMS
KEOF
chmod +x "$OVERSEER_DIR/start_kiwix.sh"

cat > "$OVERSEER_DIR/start_overseer.sh" << 'OEOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Start Kiwix in background
echo "Starting Kiwix..."
"$SCRIPT_DIR/start_kiwix.sh" &
KIWIX_PID=$!
sleep 2

# Start Ollama if not running
if ! curl -s http://localhost:11434/api/version > /dev/null 2>&1; then
    echo "Starting Ollama..."
    ollama serve &
    sleep 3
fi

# Start Flask server
echo "Starting OVERSEER server..."
cd "$SCRIPT_DIR"
python3 server.py

# Cleanup on exit
kill $KIWIX_PID 2>/dev/null
OEOF
chmod +x "$OVERSEER_DIR/start_overseer.sh"

# ============================================================
# 7. SYSTEMD SERVICE (optional — run on boot)
# ============================================================
cat > "/tmp/overseer.service" << SEOF
[Unit]
Description=OVERSEER — Offline Survival Platform
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$OVERSEER_DIR
ExecStart=$OVERSEER_DIR/start_overseer.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SEOF

log ""
log "============================================"
log " OVERSEER SETUP COMPLETE"
log "============================================"
log ""
log "To start manually:"
log "  ./start_overseer.sh"
log ""
log "To install as a boot service:"
log "  sudo cp /tmp/overseer.service /etc/systemd/system/"
log "  sudo systemctl enable overseer"
log "  sudo systemctl start overseer"
log ""
log "Default admin PIN: 1234"
log "Change it in SYSTEM > ADMIN after first login."
log ""

# Summary
ZIM_COUNT=$(find "$ZIM_DIR" -name "*.zim" -type f 2>/dev/null | wc -l)
ZIM_SIZE=$(du -sh "$ZIM_DIR" 2>/dev/null | awk '{print $1}')
log "ZIM archives: $ZIM_COUNT files ($ZIM_SIZE)"
log "Server will be available at http://localhost:6100"
log "Stay sharp, operator."
