"""Run with: python -m server

Convenience entrypoint that boots the (currently legacy) Flask app on
port 6100. ``deploy/start_overseer.sh`` uses this entrypoint so the
shell command stays stable across the refactor.
"""

from server.app import app

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=6100, debug=True)
