CREATE TABLE IF NOT EXISTS comms_operator (
    callsign    TEXT PRIMARY KEY,
    pub_key     BLOB,
    registered_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS comms_message (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_cs     TEXT NOT NULL,
    to_cs       TEXT NOT NULL,
    subj        TEXT NOT NULL DEFAULT '',
    state       TEXT NOT NULL DEFAULT 'delivered',
    hops        INTEGER NOT NULL DEFAULT 1,
    when_ts     REAL NOT NULL,
    envelope_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comms_msg_to   ON comms_message(to_cs, state);
CREATE INDEX IF NOT EXISTS comms_msg_from ON comms_message(from_cs);

CREATE TABLE IF NOT EXISTS comms_board_post (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    board       TEXT NOT NULL,
    from_cs     TEXT NOT NULL,
    subj        TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    when_ts     REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS comms_post_board ON comms_board_post(board, when_ts DESC);

-- end of migration 015
