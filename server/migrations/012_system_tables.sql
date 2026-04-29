CREATE TABLE IF NOT EXISTS backup_job (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    dest        TEXT NOT NULL,
    schedule    TEXT,
    last_run    INTEGER,
    status      TEXT NOT NULL DEFAULT 'idle'
                CHECK(status IN ('idle','pending','running','ok','error')),
    size_mb     REAL NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO backup_job(name, dest, status, size_mb) VALUES
    ('Full DB',    '/mnt/usb0/overseer/db.tar.gz',     'ok',      82.4),
    ('Config',     '/mnt/usb0/overseer/config.tar.gz', 'ok',       1.2),
    ('Knowledge',  '/mnt/usb0/overseer/know.tar.gz',   'pending',  0.0);

CREATE TABLE IF NOT EXISTS snapshot (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT NOT NULL,
    db_blob     BLOB,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
