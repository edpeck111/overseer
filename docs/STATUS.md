# OVERSEER v3 — status board

**Last updated:** end of Sprints 12 + 13, Cowork session.

---

## TL;DR

  - Branch `v3-redesign` is **~60 commits past `origin/main`**, all local.
  - Sprints **0–13 done**; Sprint 14 (SIGNAL) is the next gate.
  - Push when convenient: `git push -u origin v3-redesign`
  - All gates passing: **181 Python tests + 95 jsdom smoke**, no failures.
  - Bundle ~40 KB gzipped combined (budget 2 MB).

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
| 14     | SIGNAL                                 | pending  | — |
| 15     | RECREATION foundation                  | pending  | — |
| 16     | RECREATION: Dragon's Tale              | pending  | — |
| 17     | SYSTEM polish + HELP                   | pending  | — |
| 18+    | Polish, optional modules, hardware     | pending  | — |

---

## Gate evidence at end of Sprint 13

```
$ pytest tests/unit/         → 181 passed (0 failed)
$ node tools/smoke-shell.mjs → 95 PASS, 0 FAIL

Bundle: shell/public/dist/main.{js,css}
  main.js  gz: ~34 KB
  main.css gz: ~6 KB
  combined gz: ~40 KB     (budget: 2 MB)
```

Test breakdown:
  - 133 carried (Sprints 0-11 baseline)
  - +25 new  (test_auspice.py Sprint 12: sky/chart/almanac)
  - +23 new  (test_auspice.py Sprint 13: tarot/oracle/journal/daily)

Smoke breakdown:
  - 80 carried (Sprints 1-11 baseline)
  - +15 new  (AUSPICE: sky/moon/planets/upcoming/tarot/oracle/iching/daily/almanac)

Also patched:
  - server/modules/log.py: auto-source entries bypass KINDS coercion
    (allows auspice.sabbat, auspice.full_moon etc. to filter correctly)

---

## ADRs 0001–0013 in place

All in `docs/architecture-decisions/`. See Sprint 8 STATUS for full table.

---

## Sprint 12+13 deliverables (AUSPICE)

`server/modules/auspice.py` (955 lines):
  - Pure-math astronomy (Jean Meeus "Astronomical Algorithms" 2nd ed.)
    - _julian_day / _jd_to_dt / _moon_lon_lat (Ch.47) / _sun_lon (Ch.25)
    - _sun_rise_set (Ch.15) / _planet_positions (10 bodies, mean orbital elements)
    - _sabbat_dates (8 cross-quarter/solstice/equinox dates per year)
    - _lunar_calendar_month (new/full/quarter dates)
  - Divination engines (all in-memory synthetic-first):
    - Tarot: full 78-card RWS deck, 3 spreads (PPF/Celtic/Single)
    - I Ching: 64 hexagrams with judgment text
    - Runes: 24 Elder Futhark with keywords
  - AES-256-GCM journal: PBKDF2-HMAC-SHA256 (600k iters) PIN derivation
    recovery key; per-entry encrypt/decrypt; PIN reset
  - _seed_almanac_events(): pushes sabbats + 30-day moon events into
    TIMELINE on startup via register_auto_event()
  - 14 REST routes under /api/u/*

`shell/src/modules/auspice.{js,css}`:
  - S(sky): moon phase glyph+illumination, sun rise/transit/set,
    10-body planet grid, upcoming 30-day celestial events
  - C(chart): lat/lon/birth-dt form → natal chart planet table + ASC
  - T(tarot): spread selector, query input, DRAW button, card layout
    with position/name/reversed/keywords
  - O(oracle): I Ching CAST (hexagram symbol + judgment + changing lines)
    | Runes DRAW (glyph + name + keywords) | Traditions list
  - D(daily): date + moon phase + card of the day + rune of the day
  - J(journal): PIN unlock form → compose textarea + mood → entry list
    → detail view
  - A(almanac): year nav (◀/▶), 8-sabbat wheel, monthly lunar phase grid

`shell/src/modules/_registry.js`:
  - Added AUSPICE (hotkey U, pip ✦, category secondary, sprint 13)

Purple sub-theme (.screen-auspice):
  - --accent: #b88cff (lavender), --accent-dim: #7c5cbf, --accent-glow

---

## Things parked

- Brotli dict ctypes shim (ADR-0010)
- JS-side Brotli v0x02 (wait on browser support)
- Real model swaps — env flags ready (OVERSEER_AUSPICE_EPH=skyfield etc.)
- COMMS forward secrecy — python-doubleratchet (ADR-0012)
- Cardputer firmware
- `.git/` cruft + `.trash_local/` cleanup

---

## Ready for Sprint 14 (SIGNAL)

Spec in `docs/02-MODULE-CATALOG.md` — SIGNAL section.
SDR receiver UI, weather NOAA decode, frequency scanner.
Synthetic-first: stub RTL-SDR backend, real swap via OVERSEER_SDR=rtl.
