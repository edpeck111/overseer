"""OMP codec roundtrip + boundary tests.

These tests run with the codec's default (uncompressed) Sprint-2 mode.
Sprint 4 will add a parallel set with compress=True once brotli-wasm
is in the JS bundle.
"""

import pytest

from server.omp.codec import HEADER_LEN, VERSION, decode, encode
from server.omp.opcodes import Op


def test_header_size_is_four_bytes():
    assert HEADER_LEN == 4


def test_roundtrip_status_ping():
    pkt = encode(Op.PING, 1, {})
    op, msg_id, body = decode(pkt)
    assert op == Op.PING
    assert msg_id == 1
    assert body == {}


def test_roundtrip_inbox_headers():
    payload = [
        {"id": 1, "from": "BRAVO-2",   "subj": "Re: rendezvous shift", "when": 1714086840, "flags": 1},
        {"id": 2, "from": "CHARLIE-7", "subj": "Cache-7 inventory",    "when": 1714083200, "flags": 0},
    ]
    pkt = encode(Op.INBOX_HEADERS, 0xABCD, payload)
    op, msg_id, body = decode(pkt)
    assert op == Op.INBOX_HEADERS
    assert msg_id == 0xABCD
    assert body == payload


def test_msg_id_big_endian():
    pkt = encode(Op.PING, 0x1234, {})
    # Header bytes: ver(01) op(04) msg_id(12 34)
    assert pkt[0:4] == bytes([VERSION, Op.PING, 0x12, 0x34])


def test_op_out_of_range_rejected():
    with pytest.raises(ValueError):
        encode(0x100, 1, {})
    with pytest.raises(ValueError):
        encode(0x80, 1, {})  # fragment bit not allowed in encode


def test_msg_id_out_of_range_rejected():
    with pytest.raises(ValueError):
        encode(Op.PING, -1, {})
    with pytest.raises(ValueError):
        encode(Op.PING, 0x10000, {})


def test_short_packet_rejected():
    with pytest.raises(ValueError):
        decode(b"\x01\x04\x00")  # 3 bytes, need 4


def test_unknown_version_rejected():
    fake = bytes([0x99, Op.PING, 0x00, 0x01]) + b"\x80"  # msgpack nil
    with pytest.raises(ValueError, match="unsupported OMP version"):
        decode(fake)


def test_fragment_bit_rejected_on_decode():
    # Manually construct a fragment-marked packet
    fake = bytes([VERSION, Op.PING | 0x80, 0x00, 0x01]) + b"\x80"
    with pytest.raises(NotImplementedError, match="fragment"):
        decode(fake)


def test_compress_kwarg_roundtrip():
    """Sprint 4 will exercise this with the shared dictionary too."""
    payload = {"q": "how do I purify rainwater", "kb_aug": True}
    pkt = encode(Op.LLM_QUERY, 7, payload, compress=True)
    op, msg_id, body = decode(pkt, compress=True)
    assert op == Op.LLM_QUERY
    assert msg_id == 7
    assert body == payload
