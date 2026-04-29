CREATE TABLE IF NOT EXISTS inv_category (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    icon        TEXT NOT NULL DEFAULT '.',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    parent_id   INTEGER REFERENCES inv_category(id)
);
INSERT OR IGNORE INTO inv_category(name, icon, sort_order) VALUES
    ('Food & Water',      'food',   1),
    ('Medical',           'med',    2),
    ('Tools & Equipment', 'tools',  3),
    ('Comms & Power',     'comms',  4),
    ('Clothing & Shelter','shelter',5),
    ('Documents',         'docs',   6),
    ('Ammunition',        'ammo',   7),
    ('Other',             'other',  8);

CREATE TABLE IF NOT EXISTS inv_item (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES inv_category(id),
    name        TEXT NOT NULL,
    qty         REAL NOT NULL DEFAULT 0,
    unit        TEXT NOT NULL DEFAULT 'ea',
    upc         TEXT,
    expiry_date TEXT,
    weight_g    REAL,
    kcal        REAL,
    water_ml    REAL,
    location    TEXT,
    notes       TEXT,
    low_threshold REAL,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS inv_item_cat    ON inv_item(category_id);
CREATE INDEX IF NOT EXISTS inv_item_expiry ON inv_item(expiry_date);
CREATE INDEX IF NOT EXISTS inv_item_upc    ON inv_item(upc);

CREATE TABLE IF NOT EXISTS inv_event (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id     INTEGER NOT NULL REFERENCES inv_item(id),
    delta       REAL NOT NULL,
    reason      TEXT,
    at          INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS inv_event_item ON inv_event(item_id, at DESC);

-- end of migration 009
