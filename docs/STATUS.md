# OVERSEER v3 — status board

**Last updated:** end of Sprint 19, Cowork session.

---

## TL;DR

  - Branch `v3-redesign` is **all local**.
  - Sprints **0–19 done**; Sprint 20+ (polish, hardware, COMMS SQLite) is the next gate.
  - Push when convenient: `git push -u origin v3-redesign`
  - All gates passing: **333 Python tests + 121 jsdom smoke**, no failures.
  - Bundle ~139 KB minified JS + ~52 KB minified CSS.

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
| 19     | TRADER (TradeWars-lite barter game)    | done     | ✓ |
| 20+    | Polish, COMMS SQLite, hardware         | pending  | — |

---

## Gate evidence at end of Sprint 19

```
$ pytest tests/unit/         -> 333 passed (0 failed)
$ node tools/smoke-shell.mjs -> 121 PASS, 0 FAIL

Bundle: shell/public/dist/main.{js,css}
  main.js  139 KB minified
  main.css  52 KB minified
```

Test breakdown (333 total):
  - 308 carried (Sprints 0-18 baseline)
  - +25  (test_trader.py Sprint 19: engine/sectors/trade/routes)

Smoke breakdown (121 total):
  - 118 carried (Sprints 0-18 baseline)
  - +3   (TRADER: sub-screen mount, history panel, command input)

---

## Sprint 19 deliverables (TRADER)

`server/modules/recreation.py` (extended to 1011 lines):
  - `TraderState` dataclass: sector, credits, cargo dict, turns, history, prices, done/won
  - 6 sectors: homestead, market_town, farmstead, fuel_depot, medical_station, bunker
  - 6 commodities: food, water, fuel, medicine, ammo, tools
  - Comparative advantage: each sector has cheap/expensive commodities to reward cross-trading
  - Per-session randomised prices (±25% variance, seeded by session ID for reproducibility)
  - 200 credits / 20 cargo slots / 30 turns at start
  - Commands: go <sector>, buy <item> <qty>, sell <item> <qty>, status, prices, help
  - `trader_new(session)` + `trader_cmd(session, cmd)` public API
  - 2 new REST routes: POST /api/r/trader/start, POST /api/r/trader/<s>/cmd
  - Game registry: trader status updated from "coming Sprint 16" → "available"

`shell/src/modules/recreation.js` (extended, now 8 sub-screens):
  - T(trader): barter terminal, scrolling history, command input, session restart on done

25 new tests in `tests/unit/test_trader.py`:
  - TestTraderEngine (21): new session, starting state, go adjacent/non-adjacent, buy/sell,
    cross-sector profit, unknown commodity, insufficient credits, cargo limit, sell overage,
    help, status, unknown session, game registry available
  - TestTraderRoutes (4): start/cmd routes, buy via route, missing-session 404

`tools/smoke-shell.mjs`:
  - Tab count updated 7 → 8 (FWGCZRDT)
  - 3 new TRADER assertions: sub-screen mount, history panel, command input

---

## ADRs 0001–0013 in place

All in `docs/architecture-decisions/`. See Sprint 8 STATUS for full table.

---

## Things parked

- Brotli dict ctypes shim (ADR-0010)
- JS-side Brotli v0x02 (wait on browser support)
- Real hardware backends — env flags ready (OVERSEER_SIGNAL_SDR=rtlsdr etc.)
- COMMS forward secrecy — python-doubleratchet (ADR-0012)
- COMMS SQLite migration (Sprint 20+) — crypto objects deferred
- Cardputer firmware
- `.git/` cruft + `.trash_local/` cleanup

