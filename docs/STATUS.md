# OVERSEER v3 — status board

**Last updated:** end of Sprints 10 + 11, Cowork session.

---

## TL;DR

  - Branch `v3-redesign` is **~58 commits past `origin/main`**, all local.
  - Sprints **0–11 done**; Sprint 12 (AUSPICE part A) is the next gate.
  - Push when convenient: `git push -u origin v3-redesign`
  - All gates passing: **133 Python tests + 80 jsdom smoke**, no failures.
  - Bundle ~39 KB gzipped combined (budget 2 MB).

---

## How to push

From `C:\Source\Overseer\`:

```
git push -u origin v3-redesign
```

Subsequent pushes are plain `git push`. No PR opened.

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
| 12     | AUSPICE part A (astronomy)             | pending  | — |
| 13     | AUSPICE part B (divination + journal)  | pending  | — |
| 14     | SIGNAL                                 | pending  | — |
| 15     | RECREATION foundation                  | pending  | — |
| 16     | RECREATION: Dragon's Tale              | pending  | — |
| 17     | SYSTEM polish + HELP                   | pending  | — |
| 18+    | Polish, optional modules, hardware     | pending  | — |

---

## Gate evidence at end of Sprint 11

```
$ pytest tests/unit/        → 133 passed (0 failed)
$ node tools/smoke-shell.mjs → 80 PASS, 0 FAIL

Bundle: shell/public/dist/main.{js,css}
  main.js  gz: ~33 KB
  main.css gz: ~6 KB
  combined gz: ~39 KB     (budget: 2 MB)
```

Test breakdown:
  - 97 carried (Sprints 0-9 baseline)
  - +23 new  (test_inventory.py)
  - +13 new  (test_timeline.py)

Smoke breakdown:
  - 56 carried (Sprints 1-9 baseline)
  - +11 new  (INVENTORY: miller/cats/items/expiring/low/pack)
  - +13 new  (TIMELINE: feed/range/stream/search/export)

---

## ADRs 0001–0013 in place

All in `docs/architecture-decisions/`. See Sprint 8 STATUS for full table.

---

## Sprint 10 deliverables (INVENTORY)

`server/modules/inventory.py`:
  - Categories, Items, InvEvents in-memory stores; reset_for_tests()
  - Demo seed: 9 items across 5 categories on first register()
  - Burn-rate analytics from consumption event history
  - UPC lookup: synthetic dict + OVERSEER_INV_UPC=local swap
  - Pack optimizer: greedy kcal/water/weight; OVERSEER_INV_PACK=real swap
  - Mission targets: "48h patrol", "14d bug-out", "winter overnight"
  - 10 REST routes: /api/i/categories, /api/i/items, /api/i/item,
    /api/i/event, /api/i/expiring, /api/i/low, /api/i/scan,
    /api/i/pack/optimize, /api/i/burn

`shell/src/modules/inventory.{js,css}`:
  - B(browse): three-pane Miller columns — categories | items | detail
  - E(expiring): urgency colour coding (urgent <14d, warn <30d)
  - L(low): items below threshold
  - P(pack): mission dropdown, OPTIMIZE button, weight/kcal/medical stats

---

## Sprint 11 deliverables (TIMELINE)

`server/modules/timeline.py`:
  - Pure read layer — UNION ALL across log, comms, medical, navigation,
    inventory adapters; no own store
  - Uniform event shape: {module, kind, body, at, time, date, day_number,
    ref_id, who}
  - Kind dot notation: log.patrol, comms.recv, triage.run, nav.waypoint,
    inv.event
  - events_query(): range_hours, date_from/to, kind prefix, FTS, who
  - events_around(at, window_seconds): causal threading ±window
  - 3 REST routes: /api/t/events, /api/t/around, /api/t/export

`shell/src/modules/timeline.{js,css}`:
  - F(feed): range selector (24h/72h/7d/30d/all) + chronological stream
    with D+ date dividers; module colour map per kind prefix
  - S(search): q + kind prefix + who inputs + SEARCH button
  - X(export): date range pickers + EXPORT MD button + markdown preview

---

## Things parked

- Brotli dict ctypes shim (ADR-0010)
- JS-side Brotli v0x02 (wait on browser support)
- Real model swaps (KNOWLEDGE/MEDICAL/NAVIGATION) — env flags ready
- COMMS forward secrecy — python-doubleratchet (ADR-0012)
- Cardputer firmware
- `.git/` cruft + `.trash_local/` cleanup

---

## Ready for Sprint 12 (AUSPICE part A)

Spec in `docs/02-MODULE-CATALOG.md` — AUSPICE section.
Astronomy sub-module: solar/lunar rise-set, moon phase, celestial nav
ephemeris. Synthetic-first pattern continues.
