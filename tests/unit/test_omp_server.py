"""Roundtrip tests against the OMP HTTP endpoint via Flask's test client."""

import pytest

from server.app import app
from server.omp.codec import decode, encode
from server.omp.opcodes import Op


@pytest.fixture
def client():
    app.config["TESTING"] = True
    return app.test_client()


def _post(client, op, payload, msg_id=42):
    pkt = encode(op, msg_id, payload)
    r = client.post("/omp", data=pkt, content_type="application/octet-stream")
    assert r.status_code == 200, r.data
    return decode(r.data)


def test_ping_pong(client):
    op, msg_id, body = _post(client, Op.PING, {})
    assert op == Op.PING
    assert msg_id == 42
    assert "server_time" in body


def test_hello_returns_hello_ack(client):
    op, msg_id, body = _post(client, Op.HELLO, {"callsign": "TEST-1"}, msg_id=7)
    assert op == Op.HELLO_ACK
    assert msg_id == 7
    assert body["client_callsign"] == "TEST-1"
    assert body["dict_ver"] == 0


def test_inbox_headers_returns_three(client):
    op, _, body = _post(client, Op.INBOX_HEADERS, {})
    assert op == Op.INBOX_HEADERS
    assert isinstance(body, list)
    assert len(body) == 3
    assert all("from" in m and "subj" in m for m in body)


def test_unknown_op_returns_error(client):
    # Op 0x77 isn't registered for Sprint 2.
    op, _, body = _post(client, 0x77, {}, msg_id=99)
    assert op == Op.ERROR
    assert body["code"] == "NOT_IMPL"
    assert body["req_op"] == 0x77
