"""SQLite connection pool + migration runner.

Usage
-----
    from server.db import get_db, migrate

    # At server startup:
    migrate()

    # In any module:
    with get_db() as db:
        db.execute("INSERT INTO log_entry ...")

The connection is thread-local. Each call to get_db() returns the same
connection object for the current thread, creating it on first access.
Row factory is sqlite3.Row so results are dict-like.

Test isolation
--------------
Tests override DB_PATH via conftest.py (which patches sqlite3.connect).
Each test's autouse _reset fixture calls DELETE FROM on the tables it
owns — no schema re-creation needed because the migration runner creates
tables with IF NOT EXISTS.
"""
from __future__ import annotations
import sqlite3
import threading
import logging
from pathlib import Path

log = logging.getLogger(__name__)

# Import here so conftest can monkey-patch DB_PATH before modules load.
from server.config import DB_PATH, DATA_DIR

_local = threading.local()


def get_db() -> sqlite3.Connection:
    """Return the thread-local SQLite connection, creating it if needed."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        Path(DATA_DIR).mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn


def close_db() -> None:
    """Close and discard the thread-local connection."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
        _local.conn = None


# ── Migration runner ───────────────────────────────────────────────────────

_MIGRATIONS_DIR = Path(__file__).parent / "migrations"

_BOOTSTRAP = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version  TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
"""


def migrate() -> list[str]:
    """Apply any pending migrations in order. Returns list of applied versions."""
    db = get_db()
    db.executescript(_BOOTSTRAP)
    db.commit()

    applied: set[str] = {
        row[0] for row in db.execute("SELECT version FROM schema_migrations")
    }

    pending = sorted(
        p for p in _MIGRATIONS_DIR.glob("*.sql") if p.stem not in applied
    )

    ran: list[str] = []
    for path in pending:
        version = path.stem
        log.info("Applying migration %s", version)
        sql = path.read_text(encoding="utf-8")
        db.executescript(sql)
        db.execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?, strftime('%s','now'))",
            (version,),
        )
        db.commit()
        ran.append(version)

    if ran:
        log.info("Migrations applied: %s", ran)
    return ran


def reset_tables(*table_names: str) -> None:
    """Delete all rows from the given tables — used by reset_for_tests()."""
    db = get_db()
    for t in table_names:
        db.execute(f"DELETE FROM {t}")
    db.commit()
