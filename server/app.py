"""Flask app entrypoint.

Sprint 0 introduced this as a pure compatibility shim re-exporting the
legacy v2 Flask app from ``legacy_server``. Sprint 2 adds the
WebSocket multiplexer (server.ws) on top of the legacy app — modules
can now ``server.ws.publish(topic, data)`` to push to connected
clients without modifying legacy_server.py.

The legacy v2 routes still resolve unchanged. Sprint 6 onwards will
replace the shim with a proper ``create_app()`` factory once the
per-domain modules in :mod:`server.modules` start carrying real code.
"""

from legacy_server import app  # noqa: F401  -- v2 routes (side-effect import)

from server import ws as _ws

# Register /ws onto the legacy app. Idempotent — second call is a no-op.
_ws.register(app)

__all__ = ["app"]
