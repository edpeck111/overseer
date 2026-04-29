CREATE TABLE IF NOT EXISTS mesh_node (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    callsign    TEXT UNIQUE NOT NULL,
    transport   TEXT NOT NULL DEFAULT 'lora'
                CHECK(transport IN ('wifi','lora','serial','direct')),
    rssi        INTEGER,
    snr         REAL,
    lat         REAL,
    lon         REAL,
    battery_pct INTEGER,
    firmware    TEXT,
    last_seen   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
