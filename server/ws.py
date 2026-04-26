"""WebSocket multiplexer — flask-sock blueprint.

The hub provides a topic-based pub/sub broker so server-side modules
can broadcast events (POWER samples, COMMS deliveries, mesh node
state changes) to connected clients without coupling.

Wire format on /ws is line-delimited JSON, two message kinds:

    Client -> server:   {"op": "subscribe",   "topics": ["power.now", ...]}
                        {"op": "unsubscribe", "topics": [...]}
                        {"op": "ping"}

    Server -> client:   {"op": "hello",   "server_time": 1714086840}
                        {"op": "ack",     "for": "subscribe"}
                        {"op": "pong",    "server_time": 1714086840}
                        {"op": "push",    "topic": "power.now", "data": {...}}

Real OMP push (binary, brotli + msgpack) lives in server/omp/server.py
and shares this hub via :func:`publish` — the WS hub is the WiFi-side
mirror, the OMP hub is the mesh-side mirror.

Bind: the Flask app this hub registers onto runs on 0.0.0.0:6100
(deploy/start_overseer.sh; ADR / Ted decision Sprint 2).
"""

from __future__ import annotations

import json
import threading
import time
from collections import defaultdict
from typing import Any

from flask_sock import Sock

# Module-level so server/omp/server.py + module code can call publish()
# without re-importing the Sock instance.
_sock: Sock | None = None
_lock = threading.RLock()
_subs: dict[str, set] = defaultdict(set)            # topic -> {ws}
_topics_for: dict[Any, set[str]] = defaultdict(set) # ws -> {topic}


def register(app) -> None:
    """Attach the /ws blueprint to a Flask ``app``.

    Call once from ``server.app`` after the legacy app is imported.
    """
    global _sock
    if _sock is not None:
        return  # idempotent for hot reload
    _sock = Sock(app)

    @_sock.route("/ws")
    def _ws_handler(ws):
        _on_connect(ws)
        try:
            while True:
                raw = ws.receive(timeout=60)
                if raw is None:
                    # heartbeat timeout — send a server-side ping; if
                    # the client is gone, the next receive will raise.
                    _send(ws, {"op": "pong", "server_time": int(time.time())})
                    continue
                _on_message(ws, raw)
        finally:
            _on_disconnect(ws)


# --------------------------------------------------------------------- #
# Public API for server-side modules
# --------------------------------------------------------------------- #

def publish(topic: str, data: Any) -> int:
    """Broadcast ``data`` to all subscribers of ``topic``.

    Returns the number of recipients (useful for metrics).
    """
    payload = {"op": "push", "topic": topic, "data": data}
    sent = 0
    with _lock:
        recipients = list(_subs.get(topic, ()))
    for ws in recipients:
        if _send(ws, payload):
            sent += 1
    return sent


def subscriber_count(topic: str | None = None) -> int:
    """Total subscribers (or for one topic if given)."""
    with _lock:
        if topic is None:
            return sum(len(v) for v in _subs.values())
        return len(_subs.get(topic, ()))


# --------------------------------------------------------------------- #
# Internals
# --------------------------------------------------------------------- #

def _on_connect(ws) -> None:
    _send(ws, {"op": "hello", "server_time": int(time.time())})


def _on_message(ws, raw: str) -> None:
    try:
        msg = json.loads(raw)
    except (ValueError, TypeError):
        _send(ws, {"op": "nack", "reason": "bad_json"})
        return
    op = msg.get("op")
    if op == "subscribe":
        topics = msg.get("topics") or []
        with _lock:
            for t in topics:
                _subs[t].add(ws)
                _topics_for[ws].add(t)
        _send(ws, {"op": "ack", "for": "subscribe", "topics": list(topics)})
    elif op == "unsubscribe":
        topics = msg.get("topics") or []
        with _lock:
            for t in topics:
                _subs[t].discard(ws)
                _topics_for[ws].discard(t)
        _send(ws, {"op": "ack", "for": "unsubscribe", "topics": list(topics)})
    elif op == "ping":
        _send(ws, {"op": "pong", "server_time": int(time.time())})
    else:
        _send(ws, {"op": "nack", "reason": "unknown_op", "got": op})


def _on_disconnect(ws) -> None:
    with _lock:
        for t in _topics_for.pop(ws, ()):
            _subs[t].discard(ws)


def _send(ws, payload: dict) -> bool:
    """Best-effort send; returns False if the socket is dead."""
    try:
        ws.send(json.dumps(payload, separators=(",", ":")))
        return True
    except Exception:
        # The connection's receive loop will catch this on next iter
        # and trigger _on_disconnect; we just stop trying to push.
        return False
