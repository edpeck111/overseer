CREATE TABLE IF NOT EXISTS map_overlay (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'zone'
                CHECK(kind IN ('zone','route','line','marker')),
    geo_json    TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#ffb347',
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS route_cache (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_wid    INTEGER REFERENCES waypoints(id),
    to_wid      INTEGER REFERENCES waypoints(id),
    profile     TEXT NOT NULL DEFAULT 'foot',
    distance_m  REAL,
    duration_s  REAL,
    geo_json    TEXT,
    cached_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
