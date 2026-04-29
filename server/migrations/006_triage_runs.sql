CREATE TABLE IF NOT EXISTS triage_run (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tree        TEXT NOT NULL,
    outcome     TEXT,
    steps       TEXT,   -- JSON array of {node_id, choice}
    started_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    ended_at    INTEGER
);
