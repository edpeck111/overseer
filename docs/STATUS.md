# OVERSEER v3 — status board

**Last updated:** end of Sprint 18, Cowork session.

---

## TL;DR

  - Branch `v3-redesign` is **all local**.
  - Sprints **0–18 done**; Sprint 19+ (TRADER module, polish, hardware) is the next gate.
  - Push when convenient: `git push -u origin v3-redesign`
  - All gates passing: **308 Python tests + 143 jsdom smoke**, no failures.
  - Bundle ~137 KB minified JS + ~52 KB minified CSS.

---

## How to push

From `C:\Source\Overseer\`:

```
git push -u origin v3-redesign
```

---

## Per-sprint completion

| Sprint | Title                                  | Status   | Gate |
|--------|----------------------------------------|----------|------|
| 0      | Repo migration + dev environment       | done     | ✓ |
| 1      | Chrome + HOME                          | done     | ✓ |
| 2      | Transport layer + OMP foundation       | done     | ✓ |
| 3      | POWER (canary)                         | done     | ✓ |
| 4      | Static-shell discipline                | done     | ✓ |
| 5      | KNOWLEDGE refresh                      | done     | ✓ |
| 6      | COMMS refresh + boards                 | done     | ✓ |
| 7      | MEDICAL wizard reflow                  | done     | ✓ |
| 8      | NAVIGATION refresh + sextant text-map  | done     | ✓ |
| 9      | LOG                                    | done     | ✓ |
| 10     | INVENTORY                              | done     | ✓ |
| 11     | TIMELINE                               | done     | ✓ |
| 12     | AUSPICE part A (astronomy)             | done     | ✓ |
| 13     | AUSPICE part B (divination + journal)  | done     | ✓ |
| 14     | SIGNAL                                 | done     | ✓ |
| 15     | RECREATION foundation                  | done     | ✓ |
| 16     | RECREATION: Dragon's Tale              | done     | ✓ |
| 17     | SYSTEM + HELP                          | done     | ✓ |
| 18     | SQLite persistence foundation          | done     | ✓ |
| 19+    | TRADER, polish, hardware               | pending  | — |

---

## Gate evidence at end of Sprint 18

```
$ pytest tests/unit/         -> 308 passed (0 failed)
$ node tools/smoke-shell.mjs -> 143 PASS, 0 FAIL

Bundle: shell/public/dist/main.{js,css}
  main.js  137 KB minified
  main.css  52 KB minified
```

Test count unchanged at 308 — Sprint 18 is infrastructure only, no new tests.

---

## Sprint 18 deliverables (SQLite persistence foundation)

`server/db.py`:
  - Thread-local SQLite connections via `get_db()` / `close_db()`
  - Migration runner: applies `server/migrations/*.sql` in sorted order,
    stamps applied migrations in `schema_migrations` table
  - `reset_tables(*names)` helper for test isolation

`conftest.py`:
  - Redirects `sqlite3.connect` to a temp dir for tests
  - Session-scoped `_run_migrations()` fixture (runs once per pytest session)
  - Per-test `_clear_db_caches()` fixture (closes/reopens thread-local connection)

Modules migrated from in-memory dicts to SQLite:
  - `server/modules/log.py` — `log_entry`, `daily_summary` tables
  - `server/modules/navigation.py` — `waypoints`, `map_overlay` tables
  - `server/modules/inventory.py` — `inv_category`, `inv_item`, `inv_event` tables
  - `server/modules/system_.py` — `users`, `settings`, `backup_job` tables
  - `server/modules/timeline.py` — adapter queries `log_entry` + `inv_event` via SQL

Modules deferred (Sprint 21):
  - `server/modules/comms.py` — crypto envelope objects can't go in DB;
    tests access internal `_messages[mid].envelope` directly

Migration files (`server/migrations/`):
  - `008_log_entries.sql` — log_entry + daily_summary; removed CHECK constraint
    on `kind` (blocked compound kinds like `auspice.sabbat`); added mood,
    energy, ref_table, ref_id columns
  - `009_inventory.sql` — inv_category (with parent_id), inv_item, inv_event;
    ASCII-only icon strings (no emoji)

Schema mapping notes:
  - `verified bool` ↔ `last_verified_at INTEGER` (NULL = not verified)
  - `expires_at float` ↔ `expiry_date TEXT` (ISO date YYYY-MM-DD)
  - `threshold_qty` ↔ `low_threshold`
  - `acquired_at` ↔ `created_at`
  - backup fields: `target` ↔ `name`, `path` ↔ `dest`, `at` ↔ `last_run`

---

## Gate evidence at end of Sprints 16 + 17

```
$ pytest tests/unit/         -> 308 passed (0 failed)
$ node tools/smoke-shell.mjs -> 143 PASS, 0 FAIL
```

---

## ADRs 0001–0013 in place

All in `docs/architecture-decisions/`. See Sprint 8 STATUS for full table.

---

## Things parked

- Brotli dict ctypes shim (ADR-0010)
- JS-side Brotli v0x02 (wait on browser support)
- Real hardware backends — env flags ready (OVERSEER_SIGNAL_SDR=rtlsdr etc.)
- COMMS forward secrecy — python-doubleratchet (ADR-0012)
- COMMS SQLite migration (Sprint 21) — crypto objects deferred
- Cardputer firmware
- TRADER module (planned Sprint 19)
- `.git/` cruft + `.trash_local/` cleanup

