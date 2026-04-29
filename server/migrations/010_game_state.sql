CREATE TABLE IF NOT EXISTS game_state (
    session_id  TEXT PRIMARY KEY,
    game_id     TEXT NOT NULL,
    state_json  TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS chess_game (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT,
    pgn         TEXT NOT NULL DEFAULT '',
    fen         TEXT NOT NULL,
    to_move     TEXT NOT NULL DEFAULT 'white',
    result      TEXT,
    started_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
