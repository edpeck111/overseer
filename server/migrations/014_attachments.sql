CREATE TABLE IF NOT EXISTS attachment (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_table   TEXT NOT NULL,  -- 'message', 'log_entry', etc.
    ref_id      INTEGER NOT NULL,
    filename    TEXT NOT NULL,
    mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes  INTEGER,
    blob        BLOB,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS attachment_ref ON attachment(ref_table, ref_id);
