"""COMMS module — encrypted messaging, boards, mesh routing.

Sprint 6 ships:
  - operator registry (callsign → Identity, in-memory)
  - per-pair ratchet state (cached on first send)
  - inbox / sent / drafts / archive / outbox folders
  - boards (signed, not encrypted)
  - mesh node list (synthetic) with multi-hop hop count tracked on the wire
  - delivery state lifecycle: pending → sent → delivered → read

Schema is in-memory for Sprint 6 (the SQL DDL goes through server/db.py
in a Sprint 7+ migration runner alongside MEDICAL persistence). The
crypto layer (server.crypto) does real AEAD with synthetic forward
secrecy per ADR-0012; the wire envelope is final.

Boards: /general /intel /trade /swap /sos. Signed but not encrypted —
the design contract is that boards are mesh-public.
"""

from __future__ import annotations

import os
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, x25519

from server.crypto import (
    Envelope, Identity, SyntheticRatchet, derive_shared, generate,
)

BOARDS = ("/general", "/intel", "/trade", "/swap", "/sos")


# --------------------------------------------------------------------- #
# In-memory state
# --------------------------------------------------------------------- #

@dataclass
class Message:
    id: int
    from_cs: str
    to_cs: str
    subj: str
    envelope: Envelope            # real ciphertext + sig
    when: float
    state: str = "pending"        # pending → sent → delivered → read
    hops: int = 1                 # how many mesh nodes the packet traversed

@dataclass
class BoardPost:
    id: int
    board: str
    from_cs: str
    subj: str
    body: str                     # plaintext (boards are public)
    when: float
    sig: bytes


# --------------------------------------------------------------------- #
# Module-level registries
# --------------------------------------------------------------------- #

_operators: dict[str, Identity] = {}            # callsign → Identity (private; server-side ops only)
_messages:  dict[int, Message]   = {}
_msg_seq    = 0
_post_seq   = 0
_posts:     list[BoardPost] = []
_inboxes:   dict[str, list[int]]  = defaultdict(list)
_sent:      dict[str, list[int]]  = defaultdict(list)
_pair_keys: dict[tuple[str, str], bytes] = {}    # (sender, recipient) → root_key
_pair_seqs: dict[tuple[str, str], int] = defaultdict(int)


def reset_for_tests() -> None:
    global _operators, _messages, _posts, _inboxes, _sent, _pair_keys, _pair_seqs
    global _msg_seq, _post_seq
    _operators = {}; _messages = {}; _posts = []
    _inboxes = defaultdict(list); _sent = defaultdict(list)
    _pair_keys = {}; _pair_seqs = defaultdict(int)
    _msg_seq = 0; _post_seq = 0


# --------------------------------------------------------------------- #
# Operator registration
# --------------------------------------------------------------------- #

def register_operator(callsign: str) -> dict:
    """Idempotent — returns the operator's public bundle."""
    if callsign not in _operators:
        _operators[callsign] = generate(callsign)
    op = _operators[callsign]
    return {"callsign": op.callsign, "fp": op.fingerprint}


def list_contacts() -> list[dict]:
    return [
        {"callsign": op.callsign, "fp": op.fingerprint}
        for op in _operators.values()
    ]


def _identity(callsign: str) -> Identity:
    if callsign not in _operators:
        raise KeyError(f"unknown operator: {callsign}")
    return _operators[callsign]


def _ratchet_for(sender: str, recipient: str) -> SyntheticRatchet:
    """Return the sender's ratchet for a given recipient. Lazily derives
    the shared root on first send between this pair."""
    a = _identity(sender); b = _identity(recipient)
    pair = (sender, recipient)
    if pair not in _pair_keys:
        _pair_keys[pair] = derive_shared(a.dh_priv, b.dh_pub)
        # Symmetric: recipient's reverse pair gets the same root
        _pair_keys[(recipient, sender)] = derive_shared(b.dh_priv, a.dh_pub)
    counter = _pair_seqs[pair]
    _pair_seqs[pair] = counter + 1
    return SyntheticRatchet(
        root_key=_pair_keys[pair],
        sender_fp=a.fingerprint,
        sender_sign=a.sign_priv,
        counter=counter,
    )


# --------------------------------------------------------------------- #
# Messages
# --------------------------------------------------------------------- #

def send_message(from_cs: str, to_cs: str, subj: str, body: str, *, hops: int = 1) -> int:
    """Encrypt and deliver. Returns the message id."""
    global _msg_seq
    _msg_seq += 1
    rt = _ratchet_for(from_cs, to_cs)
    env = rt.encrypt(body.encode("utf-8"))
    msg = Message(
        id=_msg_seq, from_cs=from_cs, to_cs=to_cs, subj=subj,
        envelope=env, when=time.time(), state="delivered", hops=hops,
    )
    _messages[msg.id] = msg
    _sent[from_cs].append(msg.id)
    _inboxes[to_cs].append(msg.id)
    return msg.id


def fetch_inbox(callsign: str, *, decrypt: bool = True) -> list[dict]:
    out = []
    for mid in _inboxes.get(callsign, []):
        m = _messages[mid]
        d = {
            "id": m.id, "from": m.from_cs, "subj": m.subj,
            "when": m.when, "state": m.state, "hops": m.hops,
        }
        if decrypt:
            try:
                rt = _decrypt_ratchet_for(callsign, m)
                d["body"] = rt.decrypt(m.envelope).decode("utf-8")
                d["verified"] = True
            except (InvalidSignature, Exception) as e:  # noqa: BLE001
                d["body"] = "[decrypt failed]"
                d["verified"] = False
        else:
            d["envelope"] = m.envelope.to_wire()
        out.append(d)
    return out


def fetch_sent(callsign: str) -> list[dict]:
    return [
        {"id": m.id, "to": m.to_cs, "subj": m.subj, "when": m.when, "state": m.state, "hops": m.hops}
        for m in (_messages[mid] for mid in _sent.get(callsign, []))
    ]


def mark_read(callsign: str, ids: list[int]) -> int:
    n = 0
    for mid in ids:
        m = _messages.get(mid)
        if m and m.to_cs == callsign and m.state != "read":
            m.state = "read"; n += 1
    return n


def _decrypt_ratchet_for(recipient: str, msg: Message) -> SyntheticRatchet:
    """Build a fresh ratchet seeded with the per-pair root + the
    message's kid so the per-message key matches what the sender used."""
    pair = (msg.from_cs, recipient)
    if pair not in _pair_keys:
        # Lazy derivation if recipient hasn't initialised the pair yet
        a = _identity(msg.from_cs); b = _identity(recipient)
        _pair_keys[pair] = derive_shared(b.dh_priv, a.dh_pub)
    return SyntheticRatchet(
        root_key=_pair_keys[pair],
        sender_fp=msg.envelope.sender_fp,
        sender_sign=_operators[msg.from_cs].sign_priv,   # signing not used on decrypt
        counter=msg.envelope.kid,
    )


# --------------------------------------------------------------------- #
# Boards
# --------------------------------------------------------------------- #

def post_to_board(callsign: str, board: str, subj: str, body: str) -> int:
    if board not in BOARDS:
        raise ValueError(f"unknown board: {board}")
    op = _identity(callsign)
    global _post_seq
    _post_seq += 1
    payload = (board + "|" + subj + "|" + body).encode("utf-8")
    sig = op.sign_priv.sign(payload)
    p = BoardPost(
        id=_post_seq, board=board, from_cs=callsign, subj=subj,
        body=body, when=time.time(), sig=sig,
    )
    _posts.append(p)
    return p.id


def list_boards() -> list[dict]:
    counts = defaultdict(int)
    last_at = {}
    for p in _posts:
        counts[p.board] += 1
        last_at[p.board] = max(last_at.get(p.board, 0), p.when)
    return [
        {"name": b, "post_count": counts.get(b, 0), "last_post_at": last_at.get(b, None)}
        for b in BOARDS
    ]


def fetch_board(name: str) -> list[dict]:
    return [
        {"id": p.id, "from": p.from_cs, "subj": p.subj, "body": p.body, "when": p.when}
        for p in _posts if p.board == name
    ]


# --------------------------------------------------------------------- #
# Mesh nodes — synthetic for Sprint 6, real meshtastic feed in Sprint 14
# --------------------------------------------------------------------- #

def list_net_nodes() -> list[dict]:
    """Static synthetic nodes — same shape as Sprint 2's OMP NET_NODES
    handler. Sprint 14 SIGNAL feeds real RSSI from meshtasticd."""
    now = int(time.time())
    return [
        {"user_id": "BRAVO-2",   "callsign": "BRAVO-2",   "transport": "wifi", "rssi": -42, "dist_m": None,    "last_seen": now - 30},
        {"user_id": "CHARLIE-7", "callsign": "CHARLIE-7", "transport": "lora", "rssi": -101, "dist_m": 9_000,  "last_seen": now - 600},
        {"user_id": "DELTA-4",   "callsign": "DELTA-4",   "transport": "lora", "rssi": -118, "dist_m": 14_000, "last_seen": now - 3600},
    ]


# --------------------------------------------------------------------- #
# REST blueprint
# --------------------------------------------------------------------- #

from flask import Blueprint, jsonify, request

comms_bp = Blueprint("comms", __name__, url_prefix="/api/c")


@comms_bp.route("/contacts", methods=["GET"])
def _contacts(): return jsonify(list_contacts())


@comms_bp.route("/contacts/register", methods=["POST"])
def _register():
    body = request.get_json(silent=True) or {}
    cs = body.get("callsign")
    if not cs: return jsonify({"error": "callsign required"}), 400
    return jsonify(register_operator(cs))


@comms_bp.route("/inbox/<callsign>", methods=["GET"])
def _inbox(callsign):
    if callsign not in _operators: return jsonify({"error": "unknown operator"}), 404
    return jsonify(fetch_inbox(callsign))


@comms_bp.route("/sent/<callsign>", methods=["GET"])
def _sent_route(callsign):
    if callsign not in _operators: return jsonify({"error": "unknown operator"}), 404
    return jsonify(fetch_sent(callsign))


@comms_bp.route("/send", methods=["POST"])
def _send():
    body = request.get_json(silent=True) or {}
    for f in ("from", "to", "subj", "body"):
        if f not in body: return jsonify({"error": f"missing field: {f}"}), 400
    try:
        mid = send_message(body["from"], body["to"], body["subj"], body["body"], hops=body.get("hops", 1))
    except KeyError as e:
        return jsonify({"error": str(e)}), 404
    return jsonify({"id": mid, "state": "delivered"})


@comms_bp.route("/read", methods=["POST"])
def _read():
    body = request.get_json(silent=True) or {}
    cs = body.get("callsign"); ids = body.get("ids", [])
    return jsonify({"count": mark_read(cs, ids)})


@comms_bp.route("/boards", methods=["GET"])
def _boards(): return jsonify(list_boards())


@comms_bp.route("/boards/<slug>", methods=["GET"])
def _board_posts(slug):
    name = "/" + slug
    if name not in BOARDS: return jsonify({"error": "unknown board"}), 404
    return jsonify(fetch_board(name))


@comms_bp.route("/boards/<slug>/post", methods=["POST"])
def _board_post(slug):
    name = "/" + slug
    body = request.get_json(silent=True) or {}
    cs = body.get("from"); subj = body.get("subj"); body_ = body.get("body")
    if not (cs and subj is not None and body_ is not None):
        return jsonify({"error": "from/subj/body required"}), 400
    try:
        pid = post_to_board(cs, name, subj, body_)
    except (KeyError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"id": pid})


@comms_bp.route("/net", methods=["GET"])
def _net(): return jsonify(list_net_nodes())


def register(app):
    if "comms" in app.blueprints: return
    app.register_blueprint(comms_bp)
