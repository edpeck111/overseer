"""OMP HTTP endpoint — receives OMP-encoded request packets, dispatches
on opcode, returns OMP-encoded response packets.

The Cardputer's local web server forwards LoRa packets through this
endpoint when running in mesh-bridge mode (its own /api/* endpoint
translates HTTP requests into OMP packets first); the dev simulator
(``tools/sim-mesh.py``) proxies through this endpoint with injected
latency/loss.

Sprint 2 ships a minimal opcode set so the gate ('mesh simulator can
serve a roundtrip') passes:

  PING / PONG       protocol heartbeat (real)
  HELLO / HELLO_ACK protocol handshake (real)
  INBOX_HEADERS     stubbed canned response (Sprint 6 replaces)
  NET_NODES         stubbed canned response (Sprint 6 replaces)
  POWER_NOW         stubbed canned response (Sprint 3 replaces)

Anything outside this set returns ERROR (op = 0x06) with code 'NOT_IMPL'.
"""

from __future__ import annotations

import time
from typing import Any, Callable

from flask import Blueprint, Response, request

from server.omp.codec import decode, encode
from server.omp.opcodes import Op

omp_bp = Blueprint("omp", __name__)

# Dispatch table: opcode -> (request_payload) -> response_payload
_HANDLERS: dict[int, Callable[[Any], Any]] = {}


def handler(op: int):
    """Decorator: registers a function as the handler for ``op``."""
    def decorate(fn):
        _HANDLERS[int(op)] = fn
        return fn
    return decorate


# -------------------------- Sprint 2 handlers --------------------------

@handler(Op.PING)
def _ping(_payload):
    return {"server_time": int(time.time())}


@handler(Op.HELLO)
def _hello(payload):
    return {
        "op": Op.HELLO_ACK,
        "server_ver": "3.0.0-dev0",
        "dict_ver": 0,             # no shared dict yet (Sprint 4)
        "time": int(time.time()),
        "caps": ["lora-sim", "no-brotli-yet"],
        "client_callsign": (payload or {}).get("callsign"),
    }


# Sprint-2-stub responses; Sprint 3/6 replace.

@handler(Op.INBOX_HEADERS)
def _inbox_headers(_payload):
    return [
        {"id": 1, "from": "BRAVO-2",   "subj": "Re: rendezvous shift", "when": int(time.time()) - 14*60, "flags": 1},
        {"id": 2, "from": "CHARLIE-7", "subj": "Cache-7 inventory",    "when": int(time.time()) - 2*3600, "flags": 0},
        {"id": 3, "from": "ECHO-3",    "subj": "[BOARD/INTEL] vehicle traffic NW", "when": int(time.time()) - 6*3600, "flags": 0},
    ]


@handler(Op.NET_NODES)
def _net_nodes(_payload):
    return [
        {"user_id": "BRAVO-2",   "callsign": "BRAVO-2",   "transport": "wifi", "rssi": -42, "dist_m": None,    "last_seen": int(time.time()) - 30},
        {"user_id": "CHARLIE-7", "callsign": "CHARLIE-7", "transport": "lora", "rssi": -101, "dist_m": 9_000, "last_seen": int(time.time()) - 600},
        {"user_id": "DELTA-4",   "callsign": "DELTA-4",   "transport": "lora", "rssi": -118, "dist_m": 14_000, "last_seen": int(time.time()) - 3600},
    ]


@handler(Op.POWER_NOW)
def _power_now(_payload):
    # Sprint 3: synthetic source via server.modules.power. Sprint 4 wires
    # WS push from the same source; the OMP roundtrip stays available.
    from server.modules.power import read_sample
    return read_sample().to_wire()


# -------------------------- Flask wiring ------------------------------

@omp_bp.route("/omp", methods=["POST"])
def omp_endpoint():
    """Single-packet OMP roundtrip. Body is one OMP request packet,
    response body is one OMP response packet (same msg_id)."""
    try:
        op, msg_id, payload = decode(request.get_data())
    except (ValueError, NotImplementedError) as e:
        return _error_packet(0, msg_id_or=0, code="DECODE", msg=str(e))

    fn = _HANDLERS.get(op)
    if fn is None:
        return _error_packet(op, msg_id_or=msg_id, code="NOT_IMPL",
                             msg=f"opcode 0x{op:02x} not in Sprint 2 dispatch")

    try:
        response = fn(payload)
    except Exception as e:  # noqa: BLE001 -- surface as ERROR opcode
        return _error_packet(op, msg_id_or=msg_id, code="HANDLER_THREW", msg=str(e))

    # Some handlers return a sentinel dict {"op": Op.HELLO_ACK, ...} to
    # indicate that the response opcode is different from the request
    # (e.g. HELLO -> HELLO_ACK). Otherwise echo the request opcode.
    out_op = op
    if isinstance(response, dict) and "op" in response and isinstance(response["op"], int):
        out_op = response.pop("op")

    body = encode(out_op, msg_id, response)
    return Response(body, mimetype="application/octet-stream")


def _error_packet(req_op: int, msg_id_or: int, code: str, msg: str) -> Response:
    body = encode(Op.ERROR, msg_id_or & 0xFFFF, {"req_op": int(req_op), "code": code, "msg": msg})
    return Response(body, mimetype="application/octet-stream", status=200)


def register(app):
    """Register the /omp blueprint onto a Flask ``app``. Idempotent."""
    if "omp" in app.blueprints:
        return
    app.register_blueprint(omp_bp)
