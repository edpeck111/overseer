"""Flask app factory + main entry point.

Sprint 0 / Sprint 1 scope:
  - Serves the static shell bundle at /
  - Single API endpoint: GET /api/x/status (the status strip's source of truth)
  - No DB tables yet; the migrations runner is wired but has nothing to apply.

Run with: `python -m server.app`
"""

from __future__ import annotations

import time
from datetime import date, datetime
from pathlib import Path

from flask import Flask, jsonify, send_from_directory

from . import __version__
from .config import Config, from_env
from .db import migrate


def _day_counter(cfg: Config) -> int:
    """Days since cfg.day_zero_iso. Returns 0 if config malformed."""
    try:
        d0 = date.fromisoformat(cfg.day_zero_iso)
    except ValueError:
        return 0
    return (date.today() - d0).days


def create_app(cfg: Config | None = None) -> Flask:
    cfg = cfg or from_env()

    # Initialize DB (no-op if no migrations on disk yet).
    migrate(cfg)

    app = Flask(__name__, static_folder=None)
    app.config["OVERSEER"] = cfg

    # ---- Static shell --------------------------------------------------
    dist = cfg.shell_dist

    @app.route("/")
    def index():
        if not (dist / "index.html").exists():
            return _missing_shell_message(dist), 503
        return send_from_directory(dist, "index.html")

    @app.route("/<path:path>")
    def static_proxy(path: str):
        target = dist / path
        if target.is_file():
            return send_from_directory(dist, path)
        # SPA fallback: unknown paths render the shell so client routing handles them.
        if (dist / "index.html").exists():
            return send_from_directory(dist, "index.html")
        return _missing_shell_message(dist), 503

    # ---- Minimal API for the status strip ------------------------------
    @app.route("/api/x/status")
    def status():
        # All values placeholder until subsequent sprints wire real telemetry.
        now = datetime.now()
        return jsonify({
            "brand": cfg.brand,
            "version": cfg.version,
            "operator": cfg.default_operator,
            "system": "OK",
            "ai": {"model": "QWEN-7B", "ready": False},  # placeholder
            "kb": {"mounted": 0, "total": 0},
            "power": {"battery_pct": 82, "draw_w": 4.2, "runtime_s": 14 * 24 * 3600 + 2 * 3600},
            "mesh": {"reachable": 2, "known": 3},
            "day_counter": _day_counter(cfg),
            "wall_time_iso": now.isoformat(timespec="seconds"),
            "uptime_s": int(time.monotonic()),
            "server_version": __version__,
        })

    @app.route("/api/x/ping")
    def ping():
        return jsonify({"pong": True, "t": int(time.time())})

    return app


def _missing_shell_message(dist: Path) -> str:
    return (
        "<!doctype html><meta charset=utf-8>"
        "<title>OVERSEER — shell not built</title>"
        "<style>body{font-family:ui-monospace,monospace;background:#050807;color:#2cc26a;padding:40px}"
        "h1{color:#ffb849}code{background:#0a1410;padding:2px 6px;border:1px solid #1f5538}</style>"
        "<h1>OVERSEER — shell bundle missing</h1>"
        "<p>Looked for <code>" + str(dist) + "/index.html</code> and didn't find it.</p>"
        "<p>From <code>v3/app/shell/</code> run:</p>"
        "<pre>npm install\nnpm run dev   # or: npm run build</pre>"
    )


def main() -> None:
    cfg = from_env()
    app = create_app(cfg)
    print(f"[overseer] serving on http://{cfg.host}:{cfg.port}/  (debug={cfg.debug})")
    print(f"[overseer] shell expected at: {cfg.shell_dist}")
    app.run(host=cfg.host, port=cfg.port, debug=cfg.debug)


if __name__ == "__main__":
    main()
