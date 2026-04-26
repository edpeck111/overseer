"""
OVERSEER Relay — Lightweight Flask app for the Pi Zero.

Serves a mobile-optimized chat + Knowledge UI on port 80.
Communicates with OVERSEER base station via the LoRa client daemon.

Usage: python3 flask_relay.py [--port 80] [--db relay.db]
"""

import os
import sys
import time
import json

from flask import Flask, request, render_template, g

# Add parent dir for protocol imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from relay_db import get_db, init_db, get_conversations, get_thread, store_message, get_or_create_user, get_link_state
from lora_client import LoraClient

app = Flask(__name__)

# ── Configuration ─────────────────────────────────────────────────────────

RELAY_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(RELAY_DIR, "relay.db")
KEYS_DIR = os.path.join(RELAY_DIR, "keys")
DICT_PATH = os.path.join(RELAY_DIR, "lora_dict.zstd")

# LoRa client instance (started on first request or at init)
lora = None


def get_relay_db():
    if "db" not in g:
        g.db = get_db(DB_PATH)
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


# ── UI Routes ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("relay.html")


# ── User Management ──────────────────────────────────────────────────────

@app.route("/api/users")
def api_users():
    """List available callsigns on this relay."""
    db = get_relay_db()
    rows = db.execute("SELECT id, callsign FROM users ORDER BY callsign").fetchall()
    return {"users": [dict(r) for r in rows]}


@app.route("/api/login", methods=["POST"])
def api_login():
    """Set the active user on the LoRa client."""
    data = request.json
    user_id = data.get("user_id")
    if lora:
        lora.user_id = user_id
    return {"ok": True}


# ── Chat API ──────────────────────────────────────────────────────────────

@app.route("/api/conversations/<int:user_id>")
def api_conversations(user_id):
    db = get_relay_db()
    return {"conversations": get_conversations(db, user_id)}


@app.route("/api/thread/<int:user_id>/<int:contact_id>")
def api_thread(user_id, contact_id):
    db = get_relay_db()
    messages = get_thread(db, user_id, contact_id)
    contact = db.execute("SELECT callsign FROM users WHERE id = ?", (contact_id,)).fetchone()
    return {
        "messages": messages,
        "contact": {
            "id": contact_id,
            "callsign": contact["callsign"] if contact else "Unknown",
        },
    }


@app.route("/api/send", methods=["POST"])
def api_send():
    """Queue a message for LoRa transmission."""
    data = request.json
    from_id = data.get("from")
    to_id = data.get("to")
    body = data.get("body", "").strip()

    if not from_id or not to_id or not body:
        return {"error": "Missing fields"}, 400

    if lora:
        msg_uuid = lora.send_text(body, recipient_id=to_id)
        return {"ok": True, "msg_uuid": msg_uuid}
    else:
        # Store locally even without LoRa (for testing)
        db = get_relay_db()
        import uuid
        msg_uuid = str(uuid.uuid4())[:8]
        store_message(db, from_id, to_id, body, delivery_status="queued", msg_uuid=msg_uuid)
        return {"ok": True, "msg_uuid": msg_uuid}


@app.route("/api/read/<int:message_id>", methods=["POST"])
def api_mark_read(message_id):
    db = get_relay_db()
    db.execute("UPDATE messages SET read_at = ? WHERE id = ? AND read_at IS NULL", (time.time(), message_id))
    db.commit()
    return {"ok": True}


# ── Knowledge API (proxied over LoRa) ────────────────────────────────────

@app.route("/api/kb/search", methods=["POST"])
def api_kb_search():
    """Queue a knowledge base search over LoRa."""
    data = request.json
    query = data.get("query", "").strip()
    if not query:
        return {"error": "Query required"}, 400

    if lora:
        msg_id = lora.send_kb_search(query)
        return {"ok": True, "msg_id": msg_id}
    return {"error": "LoRa not available"}, 503


@app.route("/api/kb/fetch", methods=["POST"])
def api_kb_fetch():
    """Queue an article fetch over LoRa."""
    data = request.json
    path = data.get("path", "").strip()
    if not path:
        return {"error": "Path required"}, 400

    if lora:
        msg_id = lora.send_kb_fetch(path)
        return {"ok": True, "msg_id": msg_id}
    return {"error": "LoRa not available"}, 503


@app.route("/api/llm/query", methods=["POST"])
def api_llm_query():
    """Queue an LLM query over LoRa."""
    data = request.json
    query = data.get("query", "").strip()
    if not query:
        return {"error": "Query required"}, 400

    if lora:
        msg_id = lora.send_llm_query(query)
        return {"ok": True, "msg_id": msg_id}
    return {"error": "LoRa not available"}, 503


@app.route("/api/transfer/<int:msg_id>")
def api_transfer_status(msg_id):
    """Check progress of an incoming LoRa transfer."""
    if lora:
        return lora.get_transfer_status(msg_id)
    return {"complete": False, "progress": 0, "data": ""}


@app.route("/api/transfer/<int:msg_id>/cancel", methods=["POST"])
def api_cancel_transfer(msg_id):
    """Cancel an in-progress transfer."""
    if lora:
        lora.cancel_transfer(msg_id, sender_id=0)
        return {"ok": True}
    return {"error": "LoRa not available"}, 503


# ── Status ────────────────────────────────────────────────────────────────

@app.route("/api/status")
def api_status():
    """LoRa link status and queue depth."""
    db = get_relay_db()
    queue_depth = db.execute("SELECT COUNT(*) as cnt FROM outbound_queue WHERE status = 'pending'").fetchone()["cnt"]

    link_up = False
    signal = None
    last_pong = None
    if lora:
        link_up = lora.link_up
        signal = lora.signal_rssi
    else:
        link_up = get_link_state(db, "link_up", "false") == "true"
        signal = get_link_state(db, "signal_rssi")
        last_pong = get_link_state(db, "last_pong")

    return {
        "link_up": link_up,
        "signal_rssi": float(signal) if signal else None,
        "last_contact": float(last_pong) if last_pong else None,
        "queue_depth": queue_depth,
        "lora_connected": lora.link_up if lora else False,
    }


# ── Main ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="OVERSEER Relay — Pi Zero Flask App")
    parser.add_argument("--port", type=int, default=80, help="HTTP port")
    parser.add_argument("--db", default=DB_PATH, help="Database path")
    args = parser.parse_args()

    DB_PATH = args.db
    init_db(DB_PATH)

    # Start LoRa client
    dict_file = DICT_PATH if os.path.exists(DICT_PATH) else None
    lora = LoraClient(db_path=DB_PATH, keys_dir=KEYS_DIR, dict_path=dict_file)
    lora.start()

    app.run(host="0.0.0.0", port=args.port, debug=False)
