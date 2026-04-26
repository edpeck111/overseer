"""SQLite connection + forward-only migrations.

Migrations live in `server/migrations/NNN_name.sql`. The runner stamps applied
versions in the `schema_migrations` table and is idempotent.
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

from .config import Config


SCHEMA_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
);
"""


def connect(cfg: Config) -> sqlite3.Connection:
    cfg.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(cfg.db_path, detect_types=sqlite3.PARSE_DECLTYPES)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def list_migrations() -> list[tuple[int, str, Path]]:
    """Discover migrations on disk, sorted by version."""
    migrations_dir = Path(__file__).resolve().parent / "migrations"
    out: list[tuple[int, str, Path]] = []
    if not migrations_dir.exists():
        return out
    for p in sorted(migrations_dir.glob("*.sql")):
        # filename: NNN_name.sql
        stem = p.stem
        try:
            version = int(stem.split("_", 1)[0])
            name = stem.split("_", 1)[1] if "_" in stem else stem
        except (ValueError, IndexError):
            continue
        out.append((version, name, p))
    return out


def migrate(cfg: Config) -> list[int]:
    """Apply all unapplied migrations. Returns list of versions applied."""
    conn = connect(cfg)
    try:
        conn.executescript(SCHEMA_TABLE)
        applied = {row["version"] for row in conn.execute("SELECT version FROM schema_migrations")}
        new_versions: list[int] = []
        for version, name, path in list_migrations():
            if version in applied:
                continue
            sql = path.read_text(encoding="utf-8")
            conn.executescript(sql)
            conn.execute(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
                (version, name, int(time.time())),
            )
            conn.commit()
            new_versions.append(version)
        return new_versions
    finally:
        conn.close()
