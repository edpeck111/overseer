#!/bin/bash
# ============================================
#  O.V.E.R.S.E.E.R. — Deploy / Update Script
#  Run ON the Orange Pi 5 to pull latest code
#  and restart the service.
#
#  Usage:  ~/overseer/deploy.sh
#  From mobile SSH:  ssh orangepi@192.168.0.124 '~/overseer/deploy.sh'
# ============================================

set -e

OVERSEER_DIR="$HOME/overseer"
SERVICE_NAME="overseer"

echo "========================================"
echo " O.V.E.R.S.E.E.R. DEPLOYMENT"
echo "========================================"
echo ""

cd "$OVERSEER_DIR"

# Check current version
CURRENT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "CURRENT:  $CURRENT"

# Pull latest
echo "PULLING LATEST..."
git pull --ff-only origin main
NEW=$(git rev-parse --short HEAD)
echo "UPDATED:  $NEW"
echo ""

if [ "$CURRENT" = "$NEW" ]; then
    echo "Already up to date. No restart needed."
    exit 0
fi

# Show what changed
echo "CHANGES:"
git log --oneline "$CURRENT".."$NEW" 2>/dev/null || true
echo ""

# Restart service
echo "RESTARTING SERVICE..."
sudo systemctl restart "$SERVICE_NAME" 2>/dev/null && echo "SERVICE RESTARTED." || {
    echo "systemd service not found — starting manually..."
    pkill -f "python.*server.py" 2>/dev/null || true
    sleep 1
    cd "$OVERSEER_DIR"
    nohup bash -c './start_kiwix.sh & sleep 3 && python3 server.py' > /tmp/overseer.log 2>&1 &
    echo "STARTED MANUALLY. Log: /tmp/overseer.log"
}

echo ""
echo "DEPLOYMENT COMPLETE."
echo "Access: http://192.168.0.124:6100"
