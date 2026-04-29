-- Baseline schema — users, contacts, waypoints carried from v2.
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    callsign    TEXT UNIQUE NOT NULL,
    role        TEXT NOT NULL DEFAULT 'observer'
                     CHECK(role IN ('admin','operator','observer')),
    public_key  BLOB,
    last_seen   INTEGER,
    active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS contacts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_callsign TEXT NOT NULL,
    callsign    TEXT NOT NULL,
    note        TEXT,
    UNIQUE(owner_callsign, callsign)
);

CREATE TABLE IF NOT EXISTS waypoints (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    cat         TEXT NOT NULL DEFAULT 'general',
    lat         REAL NOT NULL,
    lon         REAL NOT NULL,
    elev        REAL,
    notes       TEXT,
    color       TEXT,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    last_verified_at INTEGER
);
CREATE INDEX IF NOT EXISTS waypoints_cat ON waypoints(cat);

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

INSERT OR IGNORE INTO settings(key,value) VALUES
    ('callsign',    'ALPHA-1'),
    ('grid_ref',    'IO91wm'),
    ('tz',          'UTC'),
    ('mesh_freq',   '433.175'),
    ('day_zero',    '2024-01-05'),
    ('log_level',   'info'),
    ('backup_path', '/mnt/usb0/overseer'),
    ('theme',       'dark');
