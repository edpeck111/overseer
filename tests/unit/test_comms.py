"""COMMS — two-operator exchange, boards, mesh routing."""

import pytest

from server.app import app
from server.modules import comms as C


@pytest.fixture(autouse=True)
def fresh():
    C.reset_for_tests()
    yield


@pytest.fixture
def client():
    app.config["TESTING"] = True
    return app.test_client()


def test_two_operator_message_exchange():
    C.register_operator("ALPHA-1")
    C.register_operator("BRAVO-2")
    mid = C.send_message("ALPHA-1", "BRAVO-2", "Re: rendezvous", "shifting RV from 0600 to 0530")
    inbox = C.fetch_inbox("BRAVO-2")
    assert len(inbox) == 1
    msg = inbox[0]
    assert msg["from"] == "ALPHA-1"
    assert msg["body"] == "shifting RV from 0600 to 0530"
    assert msg["verified"] is True
    assert msg["state"] == "delivered"
    # Sent folder records it for the sender
    sent = C.fetch_sent("ALPHA-1")
    assert sent[0]["to"] == "BRAVO-2"


def test_unknown_recipient_rejected():
    C.register_operator("ALPHA-1")
    with pytest.raises(KeyError):
        C.send_message("ALPHA-1", "NOBODY", "x", "x")


def test_per_message_ciphertexts_differ():
    C.register_operator("A"); C.register_operator("B")
    m1 = C.send_message("A", "B", "x", "same body")
    m2 = C.send_message("A", "B", "x", "same body")
    e1 = C._messages[m1].envelope
    e2 = C._messages[m2].envelope
    assert e1.ct != e2.ct                  # different per-msg keys
    assert e1.kid == 0 and e2.kid == 1     # ratchet step advances


def test_board_post_visible_to_all(client):
    client.post("/api/c/contacts/register", json={"callsign": "ALPHA-1"})
    client.post("/api/c/contacts/register", json={"callsign": "BRAVO-2"})
    r = client.post("/api/c/boards/intel/post", json={
        "from": "ALPHA-1", "subj": "vehicle traffic", "body": "two unmarked vehicles eastbound 0830",
    })
    assert r.status_code == 200
    posts = client.get("/api/c/boards/intel").get_json()
    assert len(posts) == 1
    assert posts[0]["body"].startswith("two unmarked")


def test_mark_read_lifecycle():
    C.register_operator("A"); C.register_operator("B")
    mid = C.send_message("A", "B", "subj", "body")
    inbox = C.fetch_inbox("B")
    assert inbox[0]["state"] == "delivered"
    n = C.mark_read("B", [mid])
    assert n == 1
    inbox = C.fetch_inbox("B")
    assert inbox[0]["state"] == "read"


def test_multi_hop_count_recorded():
    C.register_operator("A"); C.register_operator("B")
    mid = C.send_message("A", "B", "subj", "body", hops=3)
    inbox = C.fetch_inbox("B")
    assert inbox[0]["hops"] == 3


def test_decrypt_with_corrupted_envelope_fails():
    C.register_operator("A"); C.register_operator("B")
    mid = C.send_message("A", "B", "subj", "body")
    msg = C._messages[mid]
    # Flip a byte in the ciphertext — decryption should fail
    msg.envelope.ct = bytes([msg.envelope.ct[0] ^ 0xFF]) + msg.envelope.ct[1:]
    inbox = C.fetch_inbox("B")
    assert inbox[0]["verified"] is False
    assert inbox[0]["body"] == "[decrypt failed]"


def test_boards_endpoint_lists_all_five(client):
    boards = client.get("/api/c/boards").get_json()
    names = {b["name"] for b in boards}
    assert names == {"/general", "/intel", "/trade", "/swap", "/sos"}


def test_send_route_full_flow(client):
    client.post("/api/c/contacts/register", json={"callsign": "A"})
    client.post("/api/c/contacts/register", json={"callsign": "B"})
    r = client.post("/api/c/send", json={"from": "A", "to": "B", "subj": "S", "body": "B"})
    assert r.status_code == 200
    inbox = client.get("/api/c/inbox/B").get_json()
    assert inbox[0]["body"] == "B"

# Persistence tests — appended to test_comms.py


def test_message_written_to_db():
    """send_message() writes a row to comms_message in SQLite."""
    from server.db import get_db
    C.register_operator("A"); C.register_operator("B")
    mid = C.send_message("A", "B", "persist check", "hello db")
    db = get_db()
    row = db.execute("SELECT id, from_cs, to_cs, subj FROM comms_message WHERE id=?", (mid,)).fetchone()
    assert row is not None
    assert row["from_cs"] == "A"
    assert row["subj"] == "persist check"


def test_mark_read_updates_db():
    """mark_read() updates the state column in comms_message."""
    from server.db import get_db
    C.register_operator("A"); C.register_operator("B")
    mid = C.send_message("A", "B", "subj", "body")
    C.mark_read("B", [mid])
    db = get_db()
    row = db.execute("SELECT state FROM comms_message WHERE id=?", (mid,)).fetchone()
    assert row["state"] == "read"


def test_board_post_written_to_db():
    """post_to_board() writes a row to comms_board_post in SQLite."""
    from server.db import get_db
    C.register_operator("A")
    pid = C.post_to_board("A", "/intel", "sitrep", "all clear at 0900")
    db = get_db()
    row = db.execute("SELECT board, from_cs, body FROM comms_board_post WHERE id=?", (pid,)).fetchone()
    assert row is not None
    assert row["board"] == "/intel"
    assert "all clear" in row["body"]

# -- end of test --
