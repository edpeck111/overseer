"""Flask app entrypoint.

Sprint 0: pure compatibility shim re-exporting the legacy v2 Flask app.
Sprint 2: stacks the WebSocket multiplexer (server.ws) and OMP HTTP
endpoint (server.omp.server) on top of the legacy app.

The legacy v2 routes still resolve unchanged. Sprint 6 onwards will
replace this shim with a proper ``create_app()`` factory once the
per-domain modules in :mod:`server.modules` start carrying real code.
"""

from legacy_server import app  # noqa: F401  -- v2 routes (side-effect import)

from server import ws as _ws
from server.omp import server as _omp_server

_ws.register(app)
_omp_server.register(app)

__all__ = ["app"]
