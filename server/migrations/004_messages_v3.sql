CREATE TABLE IF NOT EXISTS message (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sender          TEXT NOT NULL,
    recipient       TEXT,               -- NULL = board post
    board           TEXT,               -- NULL = direct message
    parent_id       INTEGER REFERENCES message(id),
    subject         TEXT,
    body            TEXT NOT NULL,
    delivery_state  TEXT NOT NULL DEFAULT 'pending'
                    CHECK(delivery_state IN ('pending','sent','delivered','failed','read')),
    signature       BLOB,
    ratchet_state   BLOB,
    at              INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS message_recipient ON message(recipient, at);
CREATE INDEX IF NOT EXISTS message_board     ON message(board, at);
CREATE INDEX IF NOT EXISTS message_sender    ON message(sender, at);

CREATE TABLE IF NOT EXISTS board (
    name        TEXT PRIMARY KEY,
    description TEXT,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
INSERT OR IGNORE INTO board(name, description) VALUES
    ('general', 'General discussion'),
    ('intel',   'Intelligence reports and observations'),
    ('trade',   'Goods and services exchange'),
    ('swap',    'Skills and labour exchange'),
    ('sos',     'Emergency calls for help');
