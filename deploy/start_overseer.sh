#!/bin/bash
# ============================================
#  O.V.E.R.S.E.E.R. — Main Startup Script
#  Starts Kiwix, Ollama, and Flask server
# ============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Start Kiwix in background (sibling script in deploy/)
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

# Start Flask server (run from repo root so 'python -m server' resolves)
echo "Starting OVERSEER server..."
cd "$REPO_ROOT"
python3 -m server

# Cleanup on exit
kill $KIWIX_PID 2>/dev/null
