"""OMP wire codec — encode/decode single-packet OMP messages.

Wire format (docs/05-OMP-PROTOCOL.md §1):

    +--------+--------+--------+--------+--------- ... -+
    |  ver   |  op    |    msg_id (BE)  |    body       |
    +--------+--------+--------+--------+--------- ... -+
        1B       1B          2B               variable

VERSION negotiation:

    0x01  Sprint 2 — body is raw MessagePack
    0x02  Sprint 4 — body is Brotli(MessagePack), optionally with shared
          dictionary. Default for Sprint 4+ encode().

Senders default to ``VERSION = 0x02``; decoders accept both for graceful
upgrade. ``encode(version=0x01)`` is still callable for tests and for
testing the upgrade path on the receiver.

Brotli backend: ``brotlicffi`` (ADR-0010). Shared dictionary use is
gated until brotlicffi exposes BrotliEncoderSetCustomDictionary or we
vendor a small ctypes shim — the call chain takes ``dictionary=`` and
will use it once the backend lifts; today it raises NotImplementedError
on Python side so callers don't ship silently-broken paths.

Fragmentation (high bit of op) is reserved for Sprint 12 (LoRa hw).
"""

from __future__ import annotations

import struct
from typing import Any

import brotlicffi
import msgpack

from server.omp.opcodes import Op, is_fragment, real_op

VERSION: int = 0x02
LEGACY_VERSION: int = 0x01

_HEADER = struct.Struct(">BBH")
HEADER_LEN: int = _HEADER.size  # 4

_BROTLI_QUALITY: int = 6


def encode(
    op: Op | int,
    msg_id: int,
    payload: Any,
    *,
    version: int = VERSION,
    dictionary: bytes | None = None,
) -> bytes:
    """Encode one OMP packet at the given wire version."""
    if not (0 <= int(op) < 0x80):
        raise ValueError(f"op out of range or fragment-bit set: {op:#x}")
    if not (0 <= msg_id < 0x10000):
        raise ValueError(f"msg_id out of range: {msg_id}")
    body = msgpack.packb(payload, use_bin_type=True)
    if version == VERSION:
        body = _brotli_compress(body, dictionary=dictionary)
    elif version == LEGACY_VERSION:
        if dictionary is not None:
            raise ValueError("legacy v1 does not support dictionaries")
    else:
        raise ValueError(f"unsupported encode version {version:#x}")
    return _HEADER.pack(version, int(op), msg_id) + body


def decode(
    packet: bytes,
    *,
    dictionary: bytes | None = None,
) -> tuple[int, int, Any]:
    """Decode one OMP packet → (op, msg_id, payload). Auto-detects
    wire version (0x01 raw | 0x02 brotli). Raises NotImplementedError
    only if the packet is fragmented (Sprint 12 lifts)."""
    if len(packet) < HEADER_LEN:
        raise ValueError(f"packet too short: {len(packet)}B (need >= {HEADER_LEN})")
    ver, op_byte, msg_id = _HEADER.unpack_from(packet, 0)
    if ver not in (VERSION, LEGACY_VERSION):
        raise ValueError(f"unsupported OMP version 0x{ver:02x}")
    if is_fragment(op_byte):
        raise NotImplementedError(
            "fragmented OMP packets — landing in Sprint 12 (LoRa hardware)"
        )
    op = real_op(op_byte)
    body = packet[HEADER_LEN:]
    if ver == VERSION:
        body = _brotli_decompress(body, dictionary=dictionary)
    payload = msgpack.unpackb(body, raw=False)
    return op, msg_id, payload


# --------------------------------------------------------------------- #
# Brotli helpers — currently raw (no dict) on Python side; ADR-0010
# explains the dict deferral.
# --------------------------------------------------------------------- #

def _brotli_compress(body: bytes, *, dictionary: bytes | None) -> bytes:
    if dictionary is not None:
        # Server-side dict requires a backend that exposes
        # BrotliEncoderSetCustomDictionary. brotlicffi 1.2 doesn't.
        # ADR-0010 slots this into a follow-on commit (ctypes shim).
        raise NotImplementedError(
            "Brotli with shared dictionary on Python side — pending ADR-0010 "
            "ctypes shim against libbrotlienc. JS side via brotli-wasm "
            "supports it today; the wire format already permits it."
        )
    c = brotlicffi.Compressor(quality=_BROTLI_QUALITY)
    return c.process(body) + c.finish()


def _brotli_decompress(body: bytes, *, dictionary: bytes | None) -> bytes:
    if dictionary is not None:
        raise NotImplementedError(
            "Brotli decompress with shared dictionary on Python side — "
            "pending ADR-0010 ctypes shim."
        )
    d = brotlicffi.Decompressor()
    return d.process(body) + d.finish()
