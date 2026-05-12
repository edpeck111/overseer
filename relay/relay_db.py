"""
OVERSEER Relay — Local SQLite database for the Pi Zero relay.

Stores: conversations cache, outbound message queue, user identities, LoRa link state.
"""

import sqlite3
import time
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "relay.db")


def get_db(db_path=None):
    db = sqlite3.connect(db_path or DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    return db


def init_db(db_path=None):
    db = get_db(db_path)
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            callsign TEXT UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id INTEGER,
            from_user INTEGER NOT NULL,
            to_user INTEGER NOT NULL,
            body TEXT NOT NULL,
            sent_at REAL NOT NULL,
            read_at REAL,
            delivery_status TEXT NOT NULL DEFAULT 'queued',
            source TEXT NOT NULL DEFAULT 'lora',
            msg_uuid TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_relay_msg_from ON messages(from_user);
        CREATE INDEX IF NOT EXISTS idx_relay_msg_to ON messages(to_user);
        CREATE TABLE IF NOT EXISTS outbound_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            msg_type INTEGER NOT NULL,
            payload BLOB NOT NULL,
            sender_id INTEGER NOT NULL,
            recipient_id INTEGER NOT NULL,
            msg_id INTEGER NOT NULL,
            chunk_index INTEGER DEFAULT 0,
            total_chunks INTEGER DEFAULT 1,
            status TEXT DEFAULT 'pending',
            attempts INTEGER DEFAULT 0,
            created_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS link_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    """)
    db.commit()
    db.close()


def get_or_create_user(db, user_id, callsign):
    """Ensure a user exists in the local cache."""
    existing = db.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
    if not existing:
        db.execute("INSERT OR IGNORE INTO users (id, callsign) VALUES (?, ?)", (user_id, callsign))
        db.commit()


def store_message(db, from_user, to_user, body, sent_at=None, delivery_status="delivered", msg_uuid=None):
    """Store a message in the local cache."""
    db.execute(
        "INSERT INTO messages (from_user, to_user, body, sent_at, delivery_status, msg_uuid) VALUES (?, ?, ?, ?, ?, ?)",
        (from_user, to_user, body, sent_at or time.time(), delivery_status, msg_uuid),
    )
    db.commit()


def get_conversations(db, user_id):
    """Get conversation list with last message preview and unread count."""
    rows = db.execute("""
        SELECT
            other_id,
            u.callsign,
            last_body,
            last_at,
            last_from,
            (SELECT COUNT(*) FROM messages m2
             WHERE m2.from_user = other_id AND m2.to_user = ? AND m2.read_at IS NULL) as unread_count
        FROM (
            SELECT
                CASE WHEN from_user = ? THEN to_user ELSE from_user END as other_id,
                body as last_body,
                sent_at as last_at,
                from_user as last_from
            FROM messages
            WHERE (from_user = ? OR to_user = ?)
            GROUP BY other_id
            HAVING sent_at = MAX(sent_at)
        ) conv
        JOIN users u ON u.id = conv.other_id
        ORDER BY last_at DESC
    """, (user_id, user_id, user_id, user_id)).fetchall()
    return [dict(r) for r in rows]


def get_thread(db, user_id, contact_id, limit=50):
    """Get chronological message thread between two users."""
    rows = db.execute("""
        SELECT id, from_user, to_user, body, sent_at, read_at, delivery_status, msg_uuid
        FROM messages
        WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
        ORDER BY sent_at DESC LIMIT ?
    """, (user_id, contact_id, contact_id, user_id, limit)).fetchall()
    return [dict(r) for r in reversed(rows)]


def update_link_state(db, key, value):
    db.execute(
        "INSERT INTO link_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
        (key, str(value), str(value)),
    )
    db.commit()


def get_link_state(db, key, default=None):
    row = db.execute("SELECT value FROM link_state WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default
