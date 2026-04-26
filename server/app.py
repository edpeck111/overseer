"""Flask app entrypoint.

Sprint 0 compatibility shim: re-exports the legacy v2 Flask app from
``legacy_server`` (the renamed v2 ``server.py``) so existing v2 routes
keep working unchanged.

Future sprints replace this shim with a real ``create_app()`` factory
that wires up the per-domain blueprints in :mod:`server.modules`.
"""

# Importing legacy_server runs its module body, which creates the Flask
# instance and registers all v2 routes as a side-effect. We re-export
# ``app`` so callers can use ``from server.app import app``.
from legacy_server import app  # noqa: F401

__all__ = ["app"]
