# OVERSEER v3 — Build

This is the v3-redesign build. It lives alongside the v2 code at the repo root for now; once v3 reaches functional parity it will be promoted to root and v2 archived under `legacy/`.

## Layout

```
v3/app/
├── server/                Flask backend (refactor of v2 server.py into a package)
│   ├── app.py             Flask app factory
│   ├── config.py          settings, paths
│   ├── db.py              SQLite + migrations runner
│   ├── auth.py            PIN + signed challenges
│   ├── ws.py              WebSocket hub (flask-sock)
│   ├── omp/               Overseer Mesh Protocol — codec + opcode dispatch
│   ├── modules/           one file per module: knowledge, comms, medical, ...
│   ├── llm/               ollama, embeddings, whisper, piper wrappers
│   ├── crypto/            ed25519 + x25519 + double ratchet
│   └── plugins/           hot-reloadable plugins
├── shell/                 Static client bundle (target ≤ 2 MB gzipped)
│   ├── package.json
│   ├── esbuild.config.mjs
│   ├── public/            served as-is (manifest.json, sw.js, icons)
│   └── src/
│       ├── main.js        entry point
│       ├── state/         tiny reactive store
│       ├── transport/     HTTP / OMP adapters
│       ├── chrome/        status-strip, breadcrumb, hotkey-bar
│       ├── palette/       command palette
│       ├── modules/       one file per UI module
│       ├── components/    reusable building blocks
│       ├── styles/        design tokens + per-component CSS
│       └── data/          shipped reference data (triage, drugs, lore, fortune)
├── tools/                 sim-mesh, sim-operators, build-dictionary, build-text-tiles, deck-builder
├── data/                  runtime data (gitignored): overseer.sqlite, snapshots/, plugins/, archives/
├── deploy/                setup.sh, deploy.sh, systemd units
├── docs/                  ADRs and developer docs
└── tests/                 unit / integration / e2e
```

The canonical specs are at `../Notes/` (one level up from `v3/app/`). When in doubt, the visual reference (`../Notes/00-VISUAL-REFERENCE.html`) wins on appearance, the design spec (`../Notes/01-DESIGN-SPEC.md`) wins on rules.

## Quick start (Windows dev)

Two terminals.

**Terminal A — backend:**
```
cd v3\app
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m server.app
```
Backend serves on `http://127.0.0.1:5000`.

**Terminal B — shell build:**
```
cd v3\app\shell
npm install
npm run dev
```
Watch mode rebuilds the bundle into `shell/dist/` on change. The Flask server picks it up automatically (no proxy needed in dev — Flask serves dist as static).

Open `http://127.0.0.1:5000` in a browser. You should see the chrome (status strip, breadcrumb, hotkey bar) and HOME screen as in `00-VISUAL-REFERENCE.html`.

## Sprint progress

- [x] Sprint 0 — repo migration & dev environment
- [x] Sprint 1 — Chrome + HOME
- [ ] Sprint 2 — Transport layer + OMP foundation
- [ ] Sprint 3 — POWER (canary)
- [ ] Sprint 4 — Static-shell discipline (service worker, offline)
- [ ] Sprint 5 — KNOWLEDGE refresh
- [ ] Sprint 6 — COMMS + boards
- [ ] Sprint 7 — MEDICAL wizard reflow
- [ ] Sprint 8 — NAVIGATION refresh
- [ ] Sprint 8a — TEXT MAP system
- [ ] Sprint 9 — LOG
- [ ] Sprint 10 — INVENTORY
- [ ] Sprint 11 — TIMELINE
- [ ] Sprint 12 — SIGNAL
- [ ] Sprint 13 — RECREATION foundation
- [ ] Sprint 14 — RECREATION: Dragon's Tale
- [ ] Sprint 15 — SYSTEM polish + HELP

See `../Notes/04-IMPLEMENTATION-PLAN.md` for sprint detail.
