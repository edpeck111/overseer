CREATE TABLE IF NOT EXISTS log_entry (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL DEFAULT 'note',
    body        TEXT NOT NULL,
    tags        TEXT,
    lat         REAL,
    lon         REAL,
    weather     TEXT,
    author      TEXT,
    mood        INTEGER,
    energy      INTEGER,
    ref_table   TEXT,
    ref_id      INTEGER,
    at          INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS log_entry_at   ON log_entry(at DESC);
CREATE INDEX IF NOT EXISTS log_entry_kind ON log_entry(kind);

CREATE TABLE IF NOT EXISTS daily_summary (
    date_str    TEXT PRIMARY KEY,
    day_number  INTEGER,
    body        TEXT NOT NULL,
    approved    INTEGER NOT NULL DEFAULT 0,
    generated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    approved_at  INTEGER
);

-- end of migration 008
