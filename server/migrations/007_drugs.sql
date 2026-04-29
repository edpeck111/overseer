CREATE TABLE IF NOT EXISTS drug (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    category    TEXT,
    max_dose_mg REAL,
    interval_h  REAL,
    contraindications TEXT,
    notes       TEXT
);

CREATE TABLE IF NOT EXISTS dose_event (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    drug_id     INTEGER NOT NULL REFERENCES drug(id),
    patient_id  TEXT,
    dose_mg     REAL NOT NULL,
    given_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    given_by    TEXT
);
