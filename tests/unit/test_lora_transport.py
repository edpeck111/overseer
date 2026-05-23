"""Tests for server/omp/lora_transport.py — Sprint 23a.

The real Meshtastic backend can't be exercised without a USB radio, so
the tests focus on:

  - The synthetic backend (default on dev machines + boxes with no LoRa)
  - The dispatch_packet function — round-trips through the shared
    handler table
  - Synthetic-fallback contract — when MeshtasticLora can't bring up,
    it attaches a SyntheticLora and warns
  - HTTP /omp route still works (regression check on the dispatch
    refactor)
  - /api/hw/lora endpoint returns sane shape
"""
from __future__ import annotations

import os
import warnings

import pytest

from server.omp import lora_transport as L
from server.omp.codec import decode, encode
from server.omp.opcodes import Op


# --------------------------------------------------------------------- #
# Fixtures — keep each test isolated from env + transport state.
# --------------------------------------------------------------------- #

@pytest.fixture(autouse=True)
def _isolate():
    keys = [k for k in os.environ if k.startswith("OVERSEER_LORA")]
    saved = {k: os.environ.pop(k) for k in keys}
    L.reset_for_tests(None)
    yield
    L.reset_for_tests(None)
    os.environ.update(saved)


# --------------------------------------------------------------------- #
# dispatch_packet — happy paths
# --------------------------------------------------------------------- #

def test_dispatch_ping_roundtrips():
    req = encode(Op.PING, msg_id=42, payload=None)
    resp_bytes = L.dispatch_packet(req)
    op, msg_id, payload = decode(resp_bytes)
    assert op == Op.PING
    assert msg_id == 42
    assert isinstance(payload, dict) and "server_time" in payload


def test_dispatch_hello_responds_with_hello_ack():
    req = encode(Op.HELLO, msg_id=7, payload={"callsign": "TANGO-1"})
    op, msg_id, payload = decode(L.dispatch_packet(req))
    assert op == Op.HELLO_ACK
    assert msg_id == 7
    assert payload["client_callsign"] == "TANGO-1"
    assert payload["server_ver"] == "3.0.0-dev0"


def test_dispatch_unknown_opcode_returns_error():
    # Op code far outside the Sprint 2 dispatch range.
    req = encode(0xEE, msg_id=99, payload={})
    op, msg_id, payload = decode(L.dispatch_packet(req))
    assert op == Op.ERROR
    assert msg_id == 99
    assert payload["code"] == "NOT_IMPL"
    assert payload["req_op"] == 0xEE


def test_dispatch_handler_exception_returns_error():
    # POWER_NOW reads a sample; pin its module to throw via monkeypatching
    # the import within the handler. Cheapest reproducible test of the
    # HANDLER_THREW path.
    from server.modules import power as P
    orig = P.read_sample
    P.read_sample = lambda: (_ for _ in ()).throw(RuntimeError("boom"))
    try:
        op, msg_id, payload = decode(L.dispatch_packet(encode(Op.POWER_NOW, msg_id=5, payload=None)))
    finally:
        P.read_sample = orig
    assert op == Op.ERROR
    assert payload["code"] == "HANDLER_THREW"
    assert "boom" in payload["msg"]


def test_dispatch_garbage_input_returns_decode_error():
    op, _, payload = decode(L.dispatch_packet(b"\xff\xff\xff\xff"))
    assert op == Op.ERROR
    assert payload["code"] == "DECODE"


def test_dispatch_echoes_request_version_by_default():
    # v1 (uncompressed) request → v1 response
    req_v1 = encode(Op.PING, msg_id=1, payload=None, version=0x01)
    assert req_v1[0] == 0x01
    resp = L.dispatch_packet(req_v1)
    assert resp[0] == 0x01


def test_dispatch_forces_version_when_requested():
    # LoRa path forces v2 explicitly to guarantee compression on the air.
    req_v1 = encode(Op.PING, msg_id=1, payload=None, version=0x01)
    resp = L.dispatch_packet(req_v1, version=0x02)
    assert resp[0] == 0x02


# --------------------------------------------------------------------- #
# SyntheticLora backend
# --------------------------------------------------------------------- #

def test_synthetic_default_when_env_unset():
    t = L.get_transport()
    assert isinstance(t, L.SyntheticLora)
    assert t.info()["backend"] == "synthetic"


def test_synthetic_send_records_packet():
    t = L.SyntheticLora()
    t.send(b"hello", dest=12345)
    assert t.sent == [(12345, b"hello")]


def test_synthetic_receive_runs_full_roundtrip():
    t = L.SyntheticLora()
    req = encode(Op.PING, msg_id=11, payload=None)
    resp_bytes = t.receive(req, src=99)
    # The response is also recorded as a "send" back to the source.
    assert t.sent == [(99, resp_bytes)]
    op, msg_id, _ = decode(resp_bytes)
    assert op == Op.PING
    assert msg_id == 11


def test_synthetic_close_is_noop():
    t = L.SyntheticLora()
    t.close()  # must not raise


# --------------------------------------------------------------------- #
# MeshtasticLora — bring-up failure attaches a SyntheticLora.
# --------------------------------------------------------------------- #

def test_meshtastic_no_lib_attaches_fallback():
    # On dev/CI the meshtastic library is not installed; instantiating
    # the real backend must NOT raise — it must warn and fall back.
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        m = L.MeshtasticLora()
    assert m._fallback is not None
    assert any("meshtastic" in str(w.message).lower() or
               "serial" in str(w.message).lower() for w in caught)
    # Fallback path: sends are recorded, no exceptions.
    m.send(b"x", dest=1)
    info = m.info()
    assert info["backend"] == "synthetic"
    assert info["last_error"]


def test_env_set_routes_to_meshtastic_backend_with_fallback():
    """OVERSEER_LORA=sx1262 selects MeshtasticLora; without the lib
    installed, that backend attaches a fallback at __post_init__."""
    os.environ["OVERSEER_LORA"] = "sx1262"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        t = L.get_transport()
    assert isinstance(t, L.MeshtasticLora)
    # Selector picked the real class even though the radio isn't there;
    # the fallback inside makes it functionally synthetic.
    assert t._fallback is not None
    t.send(b"hello", dest=42)
    assert t.info()["backend"] == "synthetic"


# --------------------------------------------------------------------- #
# Reset helper
# --------------------------------------------------------------------- #

def test_reset_for_tests_replaces_transport():
    a = L.SyntheticLora(name="a")
    L.reset_for_tests(a)
    assert L.get_transport() is a
    b = L.SyntheticLora(name="b")
    L.reset_for_tests(b)
    assert L.get_transport() is b


# --------------------------------------------------------------------- #
# HTTP /omp regression — the refactored route still works end-to-end.
# --------------------------------------------------------------------- #

@pytest.fixture
def client():
    from server.app import app
    app.config["TESTING"] = True
    return app.test_client()


def test_http_omp_ping_still_works(client):
    req = encode(Op.PING, msg_id=1, payload=None)
    r = client.post("/omp", data=req, content_type="application/octet-stream")
    assert r.status_code == 200
    op, msg_id, payload = decode(r.data)
    assert op == Op.PING
    assert msg_id == 1
    assert "server_time" in payload


def test_http_omp_echoes_v1_version(client):
    req_v1 = encode(Op.PING, msg_id=2, payload=None, version=0x01)
    r = client.post("/omp", data=req_v1, content_type="application/octet-stream")
    assert r.status_code == 200
    assert r.data[0] == 0x01  # response version mirrors the request


# --------------------------------------------------------------------- #
# /api/hw/lora endpoint
# --------------------------------------------------------------------- #

def test_lora_status_endpoint_returns_synthetic_info(client):
    r = client.get("/api/hw/lora")
    assert r.status_code == 200
    body = r.get_json()
    assert body["backend"] == "synthetic"
    assert "tx_count" in body
