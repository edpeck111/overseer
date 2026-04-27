"""Flask app entrypoint.

Sprint 0: pure compatibility shim re-exporting the legacy v2 Flask app.
Sprint 2: stacks the WebSocket multiplexer (server.ws) and OMP HTTP
endpoint (server.omp.server) on top of the legacy app.
Sprint 3: registers the POWER REST blueprint (server.modules.power).

The legacy v2 routes still resolve unchanged. Sprint 6 onwards will
replace this shim with a proper ``create_app()`` factory once the
per-domain modules in :mod:`server.modules` start carrying real code.
"""

from legacy_server import app  # noqa: F401  -- v2 routes (side-effect import)

from server import ws as _ws
from server.omp import server as _omp_server
from server.modules import comms as _comms
from server.modules import medical as _medical
from server.modules import navigation as _navigation
from server.modules import log as _log
from server.modules import knowledge as _knowledge
from server.modules import power as _power

_ws.register(app)
_omp_server.register(app)
_power.register(app)
_knowledge.register(app)
_comms.register(app)
_medical.register(app)
_navigation.register(app)
_log.register(app)

__all__ = ["app"]


# --------------------------------------------------------------------- #
# v3 shell mount — serves shell/public/* at /v3/* so the new UI is
# actually reachable. Legacy v2 stays at /. Sprint 17 (SYSTEM) will
# collapse v2 once v3 reaches functional parity per the migration
# plan in docs/04-IMPLEMENTATION-PLAN.md.
# --------------------------------------------------------------------- #
from pathlib import Path as _P
from flask import send_from_directory as _send

_SHELL = _P(__file__).resolve().parents[1] / "shell" / "public"

@app.route("/v3/")
@app.route("/v3/<path:path>")
def _v3_shell(path: str = "index.html"):
    """Serve the built v3 bundle. The browser hits /v3/ to load
    index.html, which references dist/main.{js,css} relative to /v3/,
    so /v3/dist/main.js etc. resolve through the same handler."""
    if not path:
        path = "index.html"
    return _send(_SHELL, path)
