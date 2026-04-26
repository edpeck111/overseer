"""
OVERSEER Relay — LoRa client daemon for the Pi Zero.

Connects to meshtasticd via USB serial, sends/receives packets,
manages the outbound queue, and handles content reassembly with
progress callbacks for progressive rendering.
"""

import sys
import os
import time
import json
import threading
import logging

# Add parent dir for protocol imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lora_protocol import (
    Packet, MsgType, Reassembler, ReassemblyBuffer,
    make_ack, make_ping, make_cancel, ACK_FLAG_READ,
    build_text_message, build_llm_query, build_kb_search, build_kb_fetch,
    chunk_payload, next_msg_id, load_dictionary,
    FLAG_ENCRYPTED, FLAG_COMPRESSED,
)
from crypto_utils import KeyStore, load_private_key, load_public_key
from relay_db import get_db, store_message, update_link_state, get_link_state

log = logging.getLogger("lora_client")

# ── Configuration ─────────────────────────────────────────────────────────

MESHTASTIC_HOST = "127.0.0.1"
MESHTASTIC_PORT = 4403
QUEUE_POLL_INTERVAL = 2  # seconds
PING_INTERVAL = 30  # seconds
LINK_TIMEOUT = 90  # seconds without PONG → link down


class LoraClient:
    """Pi Zero LoRa client — sends/receives packets, manages local state."""

    def __init__(self, db_path: str, keys_dir: str, dict_path: str = None, user_id: int = None):
        self.db_path = db_path
        self.keys_dir = keys_dir
        self.user_id = user_id  # currently active user (set via callsign picker)

        # Reassembler for incoming chunked messages
        self.reassembler = Reassembler()

        # Progress callbacks for active transfers
        # key: (msg_id, sender_id) → callback(chunk_content, progress, total_chunks)
        self._progress_callbacks = {}
        self._progress_lock = threading.Lock()

        # Completed transfer results
        # key: (msg_type, msg_id) → {"data": bytes, "complete": True, "progress": 1.0}
        self._transfer_results = {}

        # Link state
        self._link_up = False
        self._last_pong = 0
        self._signal_rssi = None

        # Crypto
        self.key_store = None
        self._load_keys()

        # Compression dictionary
        if dict_path and os.path.exists(dict_path):
            load_dictionary(dict_path)
            log.info(f"Compression dictionary loaded: {dict_path}")

        # State
        self._running = False
        self._mesh_connected = False

    def _load_keys(self):
        """Load all identity keys from keys directory."""
        if not os.path.exists(self.keys_dir):
            return
        for fname in os.listdir(self.keys_dir):
            if fname.endswith("_private.pem"):
                try:
                    priv = load_private_key(os.path.join(self.keys_dir, fname))
                    if self.key_store is None:
                        self.key_store = KeyStore(priv)
                    log.info(f"Loaded key: {fname}")
                except Exception as e:
                    log.warning(f"Failed to load {fname}: {e}")

    @property
    def link_up(self):
        return self._link_up

    @property
    def signal_rssi(self):
        return self._signal_rssi

    # ── Packet Sending ────────────────────────────────────────────────

    def send_text(self, body: str, recipient_id: int) -> str:
        """Queue a text message for transmission. Returns msg_uuid."""
        import uuid
        msg_uuid = str(uuid.uuid4())[:8]

        # Store locally
        db = get_db(self.db_path)
        store_message(db, self.user_id, recipient_id, body, delivery_status="queued", msg_uuid=msg_uuid)

        # Build and queue packets
        packets = build_text_message(body, sender_id=self.user_id, recipient_id=recipient_id)
        for pkt in packets:
            db.execute(
                "INSERT INTO outbound_queue (msg_type, payload, sender_id, recipient_id, msg_id, chunk_index, total_chunks, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (pkt.msg_type, pkt.encode(), pkt.sender_id, pkt.recipient_id,
                 pkt.msg_id, pkt.chunk_index, pkt.total_chunks, time.time()),
            )
        db.commit()
        db.close()
        return msg_uuid

    def send_llm_query(self, query: str) -> int:
        """Queue an LLM query. Returns the msg_id for tracking the response."""
        packets = build_llm_query(query, sender_id=self.user_id or 0, recipient_id=0)
        msg_id = packets[0].msg_id
        db = get_db(self.db_path)
        for pkt in packets:
            db.execute(
                "INSERT INTO outbound_queue (msg_type, payload, sender_id, recipient_id, msg_id, chunk_index, total_chunks, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (pkt.msg_type, pkt.encode(), pkt.sender_id, pkt.recipient_id,
                 pkt.msg_id, pkt.chunk_index, pkt.total_chunks, time.time()),
            )
        db.commit()
        db.close()
        return msg_id

    def send_kb_search(self, query: str) -> int:
        """Queue a KB search request. Returns msg_id."""
        packets = build_kb_search(query, sender_id=self.user_id or 0, recipient_id=0)
        msg_id = packets[0].msg_id
        db = get_db(self.db_path)
        for pkt in packets:
            db.execute(
                "INSERT INTO outbound_queue (msg_type, payload, sender_id, recipient_id, msg_id, chunk_index, total_chunks, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (pkt.msg_type, pkt.encode(), pkt.sender_id, pkt.recipient_id,
                 pkt.msg_id, pkt.chunk_index, pkt.total_chunks, time.time()),
            )
        db.commit()
        db.close()
        return msg_id

    def send_kb_fetch(self, article_path: str) -> int:
        """Queue a KB article fetch. Returns msg_id."""
        packets = build_kb_fetch(article_path, sender_id=self.user_id or 0, recipient_id=0)
        msg_id = packets[0].msg_id
        db = get_db(self.db_path)
        for pkt in packets:
            db.execute(
                "INSERT INTO outbound_queue (msg_type, payload, sender_id, recipient_id, msg_id, chunk_index, total_chunks, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (pkt.msg_type, pkt.encode(), pkt.sender_id, pkt.recipient_id,
                 pkt.msg_id, pkt.chunk_index, pkt.total_chunks, time.time()),
            )
        db.commit()
        db.close()
        return msg_id

    def cancel_transfer(self, msg_id: int, sender_id: int):
        """Cancel an in-progress transfer."""
        self.reassembler.cancel(msg_id, sender_id)
        key = (msg_id, sender_id)
        with self._progress_lock:
            self._progress_callbacks.pop(key, None)
        # Send CANCEL packet to server
        cancel = make_cancel(msg_id, sender_id=self.user_id or 0, recipient_id=0)
        db = get_db(self.db_path)
        db.execute(
            "INSERT INTO outbound_queue (msg_type, payload, sender_id, recipient_id, msg_id, chunk_index, total_chunks, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (cancel.msg_type, cancel.encode(), cancel.sender_id, cancel.recipient_id,
             cancel.msg_id, 0, 1, time.time()),
        )
        db.commit()
        db.close()

    # ── Transfer Progress Tracking ────────────────────────────────────

    def get_transfer_status(self, msg_id: int):
        """Get status of an incoming transfer (LLM response, KB results, article).

        Returns dict: {
            "complete": bool,
            "progress": float (0-1),
            "received": int,
            "total": int,
            "data": str (accumulated text so far),
        }
        """
        # Check completed results
        for key, result in self._transfer_results.items():
            if key[1] == msg_id:
                return result

        # Check in-progress reassembly
        for (mid, sid), buf in self.reassembler._buffers.items():
            if mid == msg_id:
                # Reassemble what we have so far
                partial = b""
                for i in sorted(buf.chunks.keys()):
                    partial += buf.chunks[i]
                return {
                    "complete": False,
                    "progress": buf.progress,
                    "received": buf.received_count,
                    "total": buf.total_chunks,
                    "data": partial.decode("utf-8", errors="replace"),
                }

        return {"complete": False, "progress": 0, "received": 0, "total": 0, "data": ""}

    # ── Incoming Packet Handler ───────────────────────────────────────

    def on_packet_received(self, raw_data: bytes, from_node: int, rssi: float):
        """Handle an incoming LoRa packet from meshtasticd."""
        self._signal_rssi = rssi
        try:
            packet = Packet.decode(raw_data)
        except ValueError as e:
            log.warning(f"Invalid packet: {e}")
            return

        handlers = {
            MsgType.TEXT: self._handle_text,
            MsgType.ACK: self._handle_ack,
            MsgType.PONG: self._handle_pong,
            MsgType.LLM_RESP: self._handle_content_response,
            MsgType.KB_RESULTS: self._handle_content_response,
            MsgType.KB_ARTICLE: self._handle_content_response,
        }

        handler = handlers.get(packet.msg_type)
        if handler:
            handler(packet, from_node)

    def _handle_text(self, packet: Packet, from_node: int):
        """Handle incoming chat message."""
        chunk_content, buf = self.reassembler.receive(packet)
        if buf.is_complete:
            text = buf.reassemble().decode("utf-8", errors="replace")
            db = get_db(self.db_path)
            store_message(db, packet.sender_id, packet.recipient_id, text)
            db.close()
            # Send ACK
            ack = make_ack(packet.msg_id, sender_id=packet.recipient_id, recipient_id=packet.sender_id)
            self._queue_immediate(ack)

    def _handle_ack(self, packet: Packet, from_node: int):
        """Handle ACK — update local message delivery status."""
        db = get_db(self.db_path)
        is_read = len(packet.payload) > 0 and (packet.payload[0] & ACK_FLAG_READ)
        status = "read" if is_read else "delivered"
        db.execute(
            "UPDATE messages SET delivery_status = ? WHERE delivery_status IN ('queued', 'sent') "
            "AND from_user = ? ORDER BY sent_at DESC LIMIT 1",
            (status, self.user_id),
        )
        db.commit()
        db.close()

    def _handle_pong(self, packet: Packet, from_node: int):
        """Handle PONG — update link state."""
        self._last_pong = time.time()
        self._link_up = True
        db = get_db(self.db_path)
        update_link_state(db, "link_up", "true")
        update_link_state(db, "last_pong", str(time.time()))
        if self._signal_rssi is not None:
            update_link_state(db, "signal_rssi", str(self._signal_rssi))
        db.close()

    def _handle_content_response(self, packet: Packet, from_node: int):
        """Handle LLM_RESP, KB_RESULTS, KB_ARTICLE — progressive reassembly."""
        chunk_content, buf = self.reassembler.receive(packet)

        if buf.is_complete:
            data = buf.reassemble().decode("utf-8", errors="replace")
            self._transfer_results[(packet.msg_type, packet.msg_id)] = {
                "complete": True,
                "progress": 1.0,
                "received": buf.total_chunks,
                "total": buf.total_chunks,
                "data": data,
            }

    def _queue_immediate(self, packet: Packet):
        """Queue a packet for immediate transmission (ACKs, PINGs)."""
        db = get_db(self.db_path)
        db.execute(
            "INSERT INTO outbound_queue (msg_type, payload, sender_id, recipient_id, msg_id, chunk_index, total_chunks, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (packet.msg_type, packet.encode(), packet.sender_id, packet.recipient_id,
             packet.msg_id, packet.chunk_index, packet.total_chunks, time.time()),
        )
        db.commit()
        db.close()

    # ── Background Loops ──────────────────────────────────────────────

    def start(self):
        """Start background threads."""
        self._running = True

        t1 = threading.Thread(target=self._queue_loop, daemon=True, name="relay-queue")
        t1.start()

        t2 = threading.Thread(target=self._ping_loop, daemon=True, name="relay-ping")
        t2.start()

    def stop(self):
        self._running = False

    def _queue_loop(self):
        """Process outbound queue."""
        while self._running:
            try:
                db = get_db(self.db_path)
                rows = db.execute(
                    "SELECT id, payload, msg_type FROM outbound_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 5"
                ).fetchall()
                for row in rows:
                    # Placeholder: actual send via meshtasticd
                    db.execute("UPDATE outbound_queue SET status = 'sent', attempts = attempts + 1 WHERE id = ?", (row["id"],))
                db.commit()
                db.close()
            except Exception as e:
                log.error(f"Queue loop error: {e}")
            time.sleep(QUEUE_POLL_INTERVAL)

    def _ping_loop(self):
        """Periodic PING to check link status."""
        while self._running:
            try:
                ping = make_ping(sender_id=self.user_id or 0)
                self._queue_immediate(ping)

                # Check if link is down
                if self._last_pong and (time.time() - self._last_pong) > LINK_TIMEOUT:
                    self._link_up = False
                    db = get_db(self.db_path)
                    update_link_state(db, "link_up", "false")
                    db.close()
            except Exception as e:
                log.error(f"Ping loop error: {e}")
            time.sleep(PING_INTERVAL)
