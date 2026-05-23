"""OMP-over-LoRa transport — Sprint 23a.

Carries OMP request/response packets across the Meshtastic mesh. Inbound
packets arrive on the radio's ``PRIVATE_APP`` port number, are handed to
the same OMP dispatch table as the HTTP ``/omp`` route, and the encoded
response is transmitted back to the requesting node.

Architectural decision: **Meshtastic-as-transport** (see Sprint 23 scope
in docs/STATUS.md, ADR-0016). We do not run our own mesh layer — OMP
packets ride inside Meshtastic data packets as ``PRIVATE_APP`` payloads.
Meshtastic handles routing, AES-256 channel encryption, duty-cycle
compliance (EU 1% on 868 MHz, FCC 30 dBm on 915 MHz), neighbour
discovery, store-and-forward.

ADR-0014 adapter pattern is followed verbatim:
  - The real backend (``MeshtasticLora``) lazy-imports ``meshtastic``.
  - Any bring-up failure (lib not installed, serial port absent, etc.)
    attaches a ``SyntheticLora`` fallback so the server still boots.
  - The fallback warns once, records TX packets in-memory, and never
    raises — modules that *try* to send over LoRa get a quiet no-op
    instead of an exception.
  - ``/api/hw`` surfaces ``lora: "sx1262"`` (or whatever the env var
    said) while ``_synthetic["lora"]`` flips to True so the shell paints
    a DISABLED banner.

Hardware: any Meshtastic-compatible USB device (Heltec V3, T-Beam,
RAK4631) plugged into the OPi5. Set ``OVERSEER_LORA=sx1262`` (or
``sx1278`` / ``rylr998`` — the env var selects the *radio chip*; the
``meshtastic`` Python library figures out the interface for us).
Optional ``OVERSEER_LORA_DEVICE=/dev/ttyUSB0`` to pin the serial port.
"""

from __future__ import annotations

import os
import threading
import time
import warnings
from dataclasses import dataclass, field
from typing import Any, Callable

from server.omp.codec import decode, encode
from server.omp.opcodes import Op


# --------------------------------------------------------------------- #
# Dispatcher — single source of truth shared with the HTTP route.
# --------------------------------------------------------------------- #
#
# server/omp/server.py imports ``dispatch_packet`` from here so the HTTP
# route at /omp and the LoRa transport both feed the same handler table.
# Keeps "where does an OMP packet get answered" answerable in one place.

def dispatch_packet(raw: bytes, *, version: int | None = None) -> bytes:
    """Decode → handler lookup → encode. Returns an OMP packet that is
    either the handler's real response or an ERROR packet.

    ``version`` controls the wire version of the *response*: passing
    ``None`` echoes the request's version (matches HTTP's pre-23a
    behaviour); the LoRa path passes ``0x02`` explicitly to force the
    compressed wire on the air.

    Pure function: no side effects beyond what handlers themselves do.
    Safe to call from any thread.
    """
    # Import here to avoid a circular import at module load (server.py
    # imports this module to wire dispatch_packet into its Flask route).
    from server.omp.server import _HANDLERS  # noqa: WPS433

    req_version = raw[0] if raw else 0x02
    if req_version not in (0x01, 0x02):
        # Garbage version byte → fall back to the compressed default so
        # the ERROR packet we emit is well-formed.
        req_version = 0x02
    out_version = version if version is not None else req_version

    msg_id = 0
    try:
        op, msg_id, payload = decode(raw)
    except (ValueError, NotImplementedError) as exc:
        return _error_packet(req_op=0, msg_id=msg_id, code="DECODE",
                             msg=str(exc), version=out_version)

    fn = _HANDLERS.get(op)
    if fn is None:
        return _error_packet(
            req_op=op, msg_id=msg_id, code="NOT_IMPL",
            msg=f"opcode 0x{op:02x} not in dispatch", version=out_version,
        )

    try:
        response = fn(payload)
    except Exception as exc:  # noqa: BLE001 — surface as ERROR opcode
        return _error_packet(req_op=op, msg_id=msg_id, code="HANDLER_THREW",
                             msg=str(exc), version=out_version)

    # Sentinel: handler can override the response opcode via {"op": X, ...}.
    out_op = op
    if isinstance(response, dict) and "op" in response and isinstance(response["op"], int):
        out_op = response.pop("op")

    return encode(out_op, msg_id, response, version=out_version)


def _error_packet(*, req_op: int, msg_id: int, code: str, msg: str,
                  version: int = 0x02) -> bytes:
    return encode(
        Op.ERROR, msg_id & 0xFFFF,
        {"req_op": int(req_op), "code": code, "msg": msg},
        version=version,
    )


# --------------------------------------------------------------------- #
# Synthetic backend — used when no radio is present or bring-up fails.
# --------------------------------------------------------------------- #
#
# Records TX packets in-memory so tests can assert what *would* have been
# sent over the air. ``receive()`` lets tests inject inbound packets and
# observe the synthesised response — exercises the full dispatch path
# without any hardware.

@dataclass
class SyntheticLora:
    """No-op LoRa backend. Records TX, accepts RX via ``receive()``."""

    name: str = "synthetic"
    sent: list[tuple[int | None, bytes]] = field(default_factory=list)

    def send(self, payload: bytes, *, dest: int | None = None) -> None:
        self.sent.append((dest, payload))

    def receive(self, payload: bytes, *, src: int | None = None) -> bytes:
        """Drive one round-trip through the dispatcher.

        Returns the encoded response. Tests use this; the real backend
        invokes ``dispatch_packet`` from its pubsub callback and TXes
        the result over the radio.
        """
        response = dispatch_packet(payload)
        self.send(response, dest=src)
        return response

    def close(self) -> None:
        pass

    def info(self) -> dict[str, Any]:
        return {"backend": self.name, "node_id": None, "tx_count": len(self.sent)}


# --------------------------------------------------------------------- #
# Meshtastic backend — real radio over USB-serial.
# --------------------------------------------------------------------- #

@dataclass
class MeshtasticLora:
    """Real LoRa backend via the ``meshtastic`` Python library.

    Subscribes to ``meshtastic.receive.data`` and dispatches any packet
    whose ``portnum`` is ``PRIVATE_APP``. The response (if non-empty) is
    transmitted back to the originating node on the same port number.
    """

    device: str | None = None
    connect_timeout: float = 3.0

    _interface: Any = field(default=None, init=False, repr=False)
    _fallback: 'SyntheticLora | None' = field(default=None, init=False, repr=False)
    _node_id: int | None = field(default=None, init=False, repr=False)
    _portnum: int | None = field(default=None, init=False, repr=False)
    _tx_count: int = field(default=0, init=False, repr=False)
    _rx_count: int = field(default=0, init=False, repr=False)
    _lock: 'threading.RLock' = field(default_factory=threading.RLock, init=False, repr=False)
    last_error: str | None = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        try:
            import meshtastic.serial_interface as _serial  # type: ignore[import-untyped]
            from meshtastic.protobuf import portnums_pb2  # type: ignore[import-untyped]
            from pubsub import pub  # type: ignore[import-untyped]
        except ImportError as exc:
            self._attach_fallback(f"meshtastic unavailable: {exc}")
            return

        try:
            if self.device:
                self._interface = _serial.SerialInterface(devPath=self.device)
            else:
                self._interface = _serial.SerialInterface()
        except Exception as exc:  # noqa: BLE001
            self._attach_fallback(f"serial open failed: {exc}")
            return

        self._portnum = portnums_pb2.PortNum.PRIVATE_APP
        try:
            info = self._interface.getMyNodeInfo() or {}
            self._node_id = int(info.get("num", 0)) or None
        except Exception:  # noqa: BLE001
            self._node_id = None

        pub.subscribe(self._on_data, "meshtastic.receive.data")

    def _attach_fallback(self, reason: str) -> None:
        self.last_error = reason
        warnings.warn(f"OVERSEER LORA: {reason}; using synthetic fallback", stacklevel=2)
        self._fallback = SyntheticLora()

    # --- pubsub callback ---------------------------------------------------

    def _on_data(self, packet: dict, interface: Any) -> None:  # noqa: ARG002
        """Invoked by Meshtastic's pubsub on every received data packet.

        Filters on ``PRIVATE_APP`` port number, dispatches, TX'es the
        response back to the sender. Never raises — any unhandled
        exception is logged and swallowed so the radio thread stays up.
        """
        try:
            decoded = packet.get("decoded") or {}
            if decoded.get("portnum") != "PRIVATE_APP":
                return
            raw = decoded.get("payload")
            if not isinstance(raw, (bytes, bytearray)):
                return
            with self._lock:
                self._rx_count += 1
            src = packet.get("from")
            response = dispatch_packet(bytes(raw))
            if response:
                self.send(response, dest=src)
        except Exception as exc:  # noqa: BLE001
            warnings.warn(f"OVERSEER LORA: rx handler crashed: {exc}", stacklevel=2)

    # --- public API --------------------------------------------------------

    def send(self, payload: bytes, *, dest: int | None = None) -> None:
        """TX an OMP packet to ``dest`` (or broadcast if None)."""
        if self._fallback is not None:
            self._fallback.send(payload, dest=dest)
            return
        if self._interface is None or self._portnum is None:
            return
        try:
            self._interface.sendData(
                payload,
                destinationId=dest if dest is not None else "^all",
                portNum=self._portnum,
                wantAck=False,
            )
            with self._lock:
                self._tx_count += 1
        except Exception as exc:  # noqa: BLE001
            warnings.warn(f"OVERSEER LORA: tx failed: {exc}", stacklevel=2)

    def close(self) -> None:
        if self._fallback is not None:
            self._fallback.close()
            return
        if self._interface is None:
            return
        try:
            self._interface.close()
        except Exception:  # noqa: BLE001
            pass

    def info(self) -> dict[str, Any]:
        if self._fallback is not None:
            d = self._fallback.info()
            d["last_error"] = self.last_error
            return d
        return {
            "backend": "meshtastic",
            "node_id": self._node_id,
            "tx_count": self._tx_count,
            "rx_count": self._rx_count,
        }


# --------------------------------------------------------------------- #
# Module-level selector — mirrors the GPS/POWER dispatcher pattern.
# --------------------------------------------------------------------- #

_transport: 'SyntheticLora | MeshtasticLora | None' = None
_transport_lock = threading.RLock()


def get_transport() -> 'SyntheticLora | MeshtasticLora':
    """Lazily create + return the configured LoRa transport.

    Selection: ``hw.lora_backend()`` returns one of the radio-chip names
    (sx1262 / sx1278 / rylr998 / synthetic). Any non-synthetic name maps
    to ``MeshtasticLora`` — the chip differences are handled inside the
    ``meshtastic`` library, not here.
    """
    global _transport
    with _transport_lock:
        if _transport is not None:
            return _transport
        from server import hw
        backend = hw.lora_backend()
        if backend == "synthetic":
            _transport = SyntheticLora()
        else:
            device = os.environ.get("OVERSEER_LORA_DEVICE") or None
            _transport = MeshtasticLora(device=device)
        return _transport


def reset_for_tests(transport: 'SyntheticLora | MeshtasticLora | None' = None) -> None:
    """Replace the module's transport. ``None`` clears it (next call to
    ``get_transport`` re-selects per env)."""
    global _transport
    with _transport_lock:
        if _transport is not None and transport is not _transport:
            _transport.close()
        _transport = transport


def lora_info() -> dict[str, Any]:
    """Wire shape for the link-status endpoint to expose to the shell."""
    return get_transport().info()


# --------------------------------------------------------------------- #
# Flask blueprint — exposes a single read-only endpoint so the shell
# (and the dev simulator) can see the live link state without going
# through /api/hw.
# --------------------------------------------------------------------- #

from flask import Blueprint as _Blueprint, jsonify as _jsonify

_lora_bp = _Blueprint("lora", __name__, url_prefix="/api/hw/lora")


@_lora_bp.route("")
def _lora_status():
    return _jsonify(lora_info())


def register(app) -> None:
    """Register the /api/hw/lora blueprint. Idempotent."""
    if "lora" in app.blueprints:
        return
    app.register_blueprint(_lora_bp)
