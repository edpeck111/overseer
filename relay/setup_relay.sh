#!/bin/bash
# ============================================================
# OVERSEER Relay — Pi Zero 2W Setup Script
# ============================================================
# Provisions a Pi Zero 2W as a LoRa relay with WiFi AP.
# Run as root on a fresh Raspberry Pi OS Lite installation.
#
# Usage: sudo bash setup_relay.sh
# ============================================================

set -e

RELAY_DIR="$(cd "$(dirname "$0")" && pwd)"
SSID="${1:-OVERSEER-RELAY}"
CHANNEL=6
IP_ADDR="192.168.4.1"
DHCP_RANGE="192.168.4.10,192.168.4.50,24h"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║      O.V.E.R.S.E.E.R. RELAY PROVISIONER        ║"
echo "║      Pi Zero 2W — LoRa Mesh Client              ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Relay directory: $RELAY_DIR"
echo "WiFi AP SSID:    $SSID"
echo ""

# ── 1. System Packages ───────────────────────────────────────

echo "[1/7] Installing system packages..."
apt-get update -qq
apt-get install -y -qq \
    python3 python3-pip python3-venv \
    hostapd dnsmasq \
    curl wget

# ── 2. Python Dependencies ───────────────────────────────────

echo "[2/7] Installing Python packages..."
pip3 install --break-system-packages \
    flask requests zstandard cryptography

# ── 3. WiFi Access Point (hostapd + dnsmasq) ─────────────────

echo "[3/7] Configuring WiFi access point..."

# Stop services during config
systemctl stop hostapd 2>/dev/null || true
systemctl stop dnsmasq 2>/dev/null || true

# Static IP for wlan0
cat > /etc/dhcpcd.conf.d/overseer-relay.conf << EOF
interface wlan0
    static ip_address=${IP_ADDR}/24
    nohook wpa_supplicant
EOF

# If dhcpcd.conf doesn't include conf.d, append it
if ! grep -q "include /etc/dhcpcd.conf.d/" /etc/dhcpcd.conf 2>/dev/null; then
    echo "include /etc/dhcpcd.conf.d/*.conf" >> /etc/dhcpcd.conf
fi

# hostapd config
cat > /etc/hostapd/hostapd.conf << EOF
interface=wlan0
driver=nl80211
ssid=${SSID}
hw_mode=g
channel=${CHANNEL}
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
# No password — open network (encryption handled at app layer)
EOF

# Point hostapd to config
sed -i 's|^#DAEMON_CONF=.*|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd 2>/dev/null || true

# dnsmasq config (DHCP server)
cat > /etc/dnsmasq.d/overseer-relay.conf << EOF
interface=wlan0
dhcp-range=${DHCP_RANGE}
address=/#/${IP_ADDR}
EOF

# Enable services
systemctl unmask hostapd
systemctl enable hostapd
systemctl enable dnsmasq

# ── 4. Meshtastic Installation ────────────────────────────────

echo "[4/8] Installing Meshtastic..."
pip3 install --break-system-packages meshtastic
echo "  Meshtastic Python library installed"

# ── 5. LoRa Radio Configuration ──────────────────────────────

echo "[5/8] Configuring LoRa radio..."
echo ""

if meshtastic --info > /dev/null 2>&1; then
    echo "  Radio detected on USB."

    # Set region
    echo "  Setting region to EU_868..."
    meshtastic --set lora.region EU_868

    # Set modem preset
    echo "  Setting modem preset to LONG_FAST..."
    meshtastic --set lora.modem_preset LONG_FAST

    # Configure OVERSEER private channel with PSK from server
    echo ""
    echo "  ╔════════════════════════════════════════════╗"
    echo "  ║  OVERSEER CHANNEL PSK REQUIRED             ║"
    echo "  ╠════════════════════════════════════════════╣"
    echo "  ║  Enter the PSK from the OPi 5 Max setup.  ║"
    echo "  ║  (Found in keys/overseer_channel_psk.txt   ║"
    echo "  ║   on the server, or shown during setup.)   ║"
    echo "  ╚════════════════════════════════════════════╝"
    echo ""
    read -p "  Paste OVERSEER channel PSK (base64): " OVERSEER_PSK

    if [ -n "$OVERSEER_PSK" ]; then
        echo "  Creating OVERSEER channel..."
        meshtastic --ch-index 1 --ch-set name OVERSEER
        meshtastic --ch-index 1 --ch-set psk "base64:${OVERSEER_PSK}"
        meshtastic --ch-index 1 --ch-enable

        echo "  OVERSEER channel configured with matching PSK."

        # Save PSK locally for reference
        echo "$OVERSEER_PSK" > "$RELAY_DIR/keys/overseer_channel_psk.txt"
    else
        echo "  WARNING: No PSK entered. LoRa radio configured but OVERSEER channel not set."
        echo "  Set it manually later with:"
        echo "    meshtastic --ch-index 1 --ch-set name OVERSEER"
        echo "    meshtastic --ch-index 1 --ch-set psk base64:YOUR_PSK_HERE"
        echo "    meshtastic --ch-index 1 --ch-enable"
    fi

    # Show node info
    echo ""
    echo "  Node info:"
    meshtastic --info 2>&1 | grep -E "^(Owner|Node|Region|Modem)" | while read -r line; do
        echo "    $line"
    done
else
    echo "  WARNING: No radio detected on USB."
    echo "  Connect RAK4631 WisBlock via USB and configure manually:"
    echo "    meshtastic --set lora.region EU_868"
    echo "    meshtastic --set lora.modem_preset LONG_FAST"
    echo "    meshtastic --ch-index 1 --ch-set name OVERSEER"
    echo "    meshtastic --ch-index 1 --ch-set psk base64:YOUR_PSK_HERE"
    echo "    meshtastic --ch-index 1 --ch-enable"
fi

# ── 6. Database Initialization ────────────────────────────────

echo ""
echo "[6/8] Initializing relay database..."
cd "$RELAY_DIR"
python3 -c "from relay_db import init_db; init_db('$RELAY_DIR/relay.db'); print('  Database initialized')"

# ── 7. Startup Script ────────────────────────────────────────

echo "[7/8] Creating startup script..."

cat > "$RELAY_DIR/start_relay.sh" << 'SCRIPT'
#!/bin/bash
RELAY_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$RELAY_DIR"

echo "Starting OVERSEER Relay..."

# Start Flask relay on port 80
exec python3 flask_relay.py --port 80 --db "$RELAY_DIR/relay.db"
SCRIPT

chmod +x "$RELAY_DIR/start_relay.sh"

# ── 8. SystemD Service ───────────────────────────────────────

echo "[8/8] Creating systemd service..."

cat > /etc/systemd/system/overseer-relay.service << EOF
[Unit]
Description=OVERSEER Relay — LoRa Mesh Client
After=network.target hostapd.service

[Service]
Type=simple
ExecStart=${RELAY_DIR}/start_relay.sh
WorkingDirectory=${RELAY_DIR}
Restart=on-failure
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable overseer-relay

# ── Done ──────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║      RELAY PROVISIONING COMPLETE                 ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  WiFi SSID:  ${SSID}"
echo "║  IP Address: ${IP_ADDR}"
echo "║  Web UI:     http://${IP_ADDR}/"
echo "║  Database:   ${RELAY_DIR}/relay.db"
echo "╠══════════════════════════════════════════════════╣"
echo "║  NEXT STEPS:                                     ║"
echo "║  1. Copy user keys to ${RELAY_DIR}/keys/"
echo "║  2. Copy lora_dict.zstd from OPi5 to ${RELAY_DIR}/"
echo "║  3. Ensure RAK4631 is connected via USB"
echo "║  4. Verify LoRa channel: meshtastic --ch-index 1 --ch-get psk"
echo "║     (must match the OPi 5 Max PSK)"
echo "║  5. Reboot: sudo reboot"
echo "║  6. Connect phone to '${SSID}' WiFi"
echo "║  7. Open http://${IP_ADDR}/ in browser"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Stay sharp, operator."
