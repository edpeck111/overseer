CREATE TABLE IF NOT EXISTS chat_session (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT,
    model       TEXT,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS chat_message (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES chat_session(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content     TEXT NOT NULL,
    parent_id   INTEGER REFERENCES chat_message(id),
    sources     TEXT,   -- JSON array of {archive, article, path}
    at          INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS chat_message_session ON chat_message(session_id, at);

CREATE TABLE IF NOT EXISTS saved_article (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    archive     TEXT NOT NULL,
    article     TEXT NOT NULL,
    path        TEXT NOT NULL,
    note        TEXT,
    saved_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(archive, path)
);
