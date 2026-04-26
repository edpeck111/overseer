"""SQLite schema + (eventually) a migrations runner.

Sprint 0 stub. Sprint 3 lands the first concrete schema (POWER) as a
SQL DDL string; Sprint 4 adds the migration runner that applies these
in version order against ``data/overseer.sqlite``. Until then, modules
that need persistence open their own connections — POWER (Sprint 3) is
read-only canary so it doesn't yet, but the schema is documented here
so ``server/modules/power.py`` knows the shape its successor will hold.
"""

# Schema version — bumped when DDL changes.
SCHEMA_VERSION = 1

# DDL strings, applied in definition order. Future migration runner
# will read these and stamp ``schema_migrations(version, applied_at)``.
DDL = {
    "001_power_sample": """
        CREATE TABLE IF NOT EXISTS power_sample (
          at INTEGER PRIMARY KEY,        -- unix seconds, the canonical sample time
          batt_pct REAL,
          draw_w REAL,
          input_w REAL,                  -- 0 when on battery
          runtime_est_s INTEGER,
          cpu_pct REAL,
          ram_pct REAL,
          ram_used_gb REAL,
          swap_pct REAL,
          cpu_temp_c REAL,
          fan_rpm INTEGER,
          cycles INTEGER,
          health_pct REAL
        );
        -- Insert every 30 s, retain 30 d at 30 s, then downsample to 5 min for 1 y.
        -- Sprint 3 keeps history in-memory (server/modules/power._history); the
        -- background sampler that writes to this table arrives in Sprint 4.
        CREATE INDEX IF NOT EXISTS power_sample_at ON power_sample(at);
    """,
}
