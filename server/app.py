"""Flask app entrypoint.

Sprint 0: pure compatibility shim re-exporting the legacy v2 Flask app.
Sprint 2: stacks the WebSocket multiplexer (server.ws) and OMP HTTP
endpoint (server.omp.server) on top of the legacy app.
Sprint 3: registers the POWER REST blueprint (server.modules.power).

The legacy v2 routes still resolve unchanged. Sprint 6 onwards will
replace this shim with a proper create_app() factory once the
per-domain modules in server.modules start carrying real code.
"""

from legacy_server import app  # noqa: F401  -- v2 routes (side-effect import)

from server import ws as _ws
from server.omp import server as _omp_server
from server.modules import comms as _comms
from server.modules import medical as _medical
from server.modules import navigation as _navigation
from server.modules import log as _log
from server.modules import inventory as _inventory
from server.modules import auspice as _auspice
from server.modules import timeline as _timeline
from server.modules import knowledge as _knowledge
from server.modules import power as _power
from server.modules import signal_ as _signal
from server.modules import recreation as _recreation

_ws.register(app)
_omp_server.register(app)
_power.register(app)
_knowledge.register(app)
_comms.register(app)
_medical.register(app)
_navigation.register(app)
_log.register(app)
_inventory.register(app)
_auspice.register(app)
_timeline.register(app)
_signal.register(app)
_recreation.register(app)

__all__ = ["app"]


# ------------------------------------------------------------------ #
# v3 shell mount -- serves shell/public/* at /v3/*
# Sprint 17 (SYSTEM) will collapse v2 once v3 reaches parity.
# ------------------------------------------------------------------ #
from pathlib import Path as _P
from flask import send_from_directory as _send

_SHELL = _P(__file__).resolve().parents[1] / "shell" / "public"

@app.route("/v3/")
@app.route("/v3/<path:path>")
def _v3_shell(path: str = "index.html"):
    """Serve the built v3 shell bundle."""
    if not path:
        path = "index.html"
    return _send(_SHELL, path)
