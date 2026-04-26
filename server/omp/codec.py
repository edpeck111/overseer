"""OMP wire codec — encode/decode single-packet OMP messages.

Wire format (docs/05-OMP-PROTOCOL.md §1):

    +--------+--------+--------+--------+--------- ... -+
    |  ver   |  op    |    msg_id (BE)  |    body       |
    +--------+--------+--------+--------+--------- ... -+
        1B       1B          2B               variable

Sprint 2 ships ``ver = 0x01`` with the body as **raw MessagePack**.
Sprint 4 will introduce ``ver = 0x02`` with Brotli-compressed bodies
plus the shared dictionary. The codec already accepts a ``compress``
kwarg so call sites can opt in; Sprint 2 leaves it ``False`` because
the JS side doesn't have Brotli with shared-dict capability yet
(brotli-wasm lands in Sprint 4) and we want the wire shape symmetrical
across the WiFi and mesh transports.

Fragmentation (high bit of op) is reserved for Sprint 12 when LoRa
hardware actually arrives — the codec raises NotImplementedError on
fragments rather than silently truncate.
"""

from __future__ import annotations

import struct
from typing import Any

import brotli
import msgpack

from server.omp.opcodes import Op, is_fragment, real_op

VERSION: int = 0x01

# Header: B (ver) + B (op) + H (msg_id, big-endian unsigned)
_HEADER = struct.Struct(">BBH")
HEADER_LEN: int = _HEADER.size  # 4

# When Sprint 4 turns Brotli on, this is the quality knob. 6 is the
# sweet spot for typical OMP payload sizes (<2 KB) and embedded targets.
_BROTLI_QUALITY: int = 6


def encode(
    op: Op | int,
    msg_id: int,
    payload: Any,
    *,
    compress: bool = False,
    dictionary: bytes | None = None,
) -> bytes:
    """Encode a single (non-fragmented) OMP packet."""
    if not (0 <= int(op) < 0x80):
        raise ValueError(f"op out of range or fragment-bit set: {op:#x}")
    if not (0 <= msg_id < 0x10000):
        raise ValueError(f"msg_id out of range: {msg_id}")
    body = msgpack.packb(payload, use_bin_type=True)
    if compress:
        if dictionary is not None:
            raise NotImplementedError(
                "Brotli with shared dictionary needs a backend that exposes the "
                "BrotliEncoderSetCustomDictionary API. Sprint 4 vendor decision; "
                "the artifact is built and shipped today, the runtime use isn't."
            )
        body = brotli.compress(body, quality=_BROTLI_QUALITY)
    return _HEADER.pack(VERSION, int(op), msg_id) + body


def decode(
    packet: bytes,
    *,
    compress: bool = False,
    dictionary: bytes | None = None,
) -> tuple[int, int, Any]:
    """Decode an OMP packet → (op, msg_id, payload)."""
    if len(packet) < HEADER_LEN:
        raise ValueError(f"packet too short: {len(packet)}B (need >= {HEADER_LEN})")
    ver, op_byte, msg_id = _HEADER.unpack_from(packet, 0)
    if ver != VERSION:
        raise ValueError(f"unsupported OMP version 0x{ver:02x} (this build = 0x{VERSION:02x})")
    if is_fragment(op_byte):
        raise NotImplementedError(
            "fragmented OMP packets — landing in Sprint 12 (LoRa hardware)"
        )
    op = real_op(op_byte)
    body = packet[HEADER_LEN:]
    if compress:
        if dictionary is not None:
            raise NotImplementedError(
                "Brotli with shared dictionary needs a backend that exposes the "
                "BrotliDecoderSetCustomDictionary API. Sprint 4 vendor decision."
            )
        body = brotli.decompress(body)
    payload = msgpack.unpackb(body, raw=False)
    return op, msg_id, payload
