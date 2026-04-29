CREATE TABLE IF NOT EXISTS archive_chunk (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    archive     TEXT NOT NULL,
    article     TEXT NOT NULL,
    path        TEXT NOT NULL,
    chunk_idx   INTEGER NOT NULL,
    body        TEXT NOT NULL,
    indexed_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS archive_chunk_archive ON archive_chunk(archive, article);

-- FTS5 virtual table for BM25 full-text search over chunk body
CREATE VIRTUAL TABLE IF NOT EXISTS archive_chunk_fts USING fts5(
    body,
    content='archive_chunk',
    content_rowid='id'
);
