CREATE TABLE IF NOT EXISTS power_sample (
    at          INTEGER PRIMARY KEY,
    batt_pct    REAL,
    draw_w      REAL,
    charge_w    REAL,
    cpu_pct     REAL,
    ram_pct     REAL,
    cpu_temp_c  REAL,
    fan_rpm     INTEGER
);
CREATE INDEX IF NOT EXISTS power_sample_at ON power_sample(at DESC);
