# OVERSEER

Mesh-native, low-bandwidth, text-mode prepper intelligence system.

The codebase is mid-redesign. v2 (the live Flask monolith) is on
`main`; v3 (the static-shell + thin-API rebuild) is on the
`v3-redesign` branch.

## Layout

```
.
├── legacy_server.py           v2 Flask app (renamed in Sprint 0; kept
│                              intact behind a compat shim while v3 is
│                              built around it).
├── server/                    v3 Flask package — currently a scaffold
│   ├── app.py                 compat shim re-exporting legacy app
│   ├── modules/               one file per UI module (knowledge,
│   │                          comms, medical, navigation, power, log,
│   │                          inventory, recreation, signal_, timeline,
│   │                          system, help)
│   ├── omp/                   Overseer Mesh Protocol codec + dispatch
│   ├── llm/                   ollama / embeddings / whisper / piper
│   ├── crypto/                ed25519 + x25519 + double ratchet
│   └── plugins/               hot-reload plugin loader
│
├── shell/                     v3 static client bundle (esbuild)
│   ├── src/
│   │   ├── main.js            entry point
│   │   ├── state/             hand-rolled reactive store
│   │   ├── transport/         HTTP / OMP adapters
│   │   ├── chrome/            status strip, breadcrumb, hotkey bar
│   │   ├── palette/           command palette
│   │   ├── modules/           one file per UI module
│   │   ├── styles/            tokens.css + per-component CSS
│   │   └── data/              triage.json, help.json, lore.json, ...
│   └── public/                manifest.json, sw.js, icons/
│
├── docs/                      design specs (00-07, AUSPICE, REBUILD,
│                              SEXTANT) + architecture-decisions/
├── tools/                     sim-mesh, sim-operators, build-dictionary,
│                              seed-data, download_tiles
├── deploy/                    setup.sh, deploy.sh, start_overseer.sh,
│                              start_kiwix.sh, .bat siblings, systemd/
├── games/, meshtastic/,       v2-era local modules awaiting Sprint 6/12
│   relay/, lora_*.py,         integration.
│   crypto_utils.py,
│   train_dictionary.py
├── kiwix/, zim/, sounds/,     v2 runtime assets (kiwix binaries, ZIM
│   keys/, templates/,         archives, key WAVs, operator keys, v2
│   static/                    HTML monolith — superseded by shell/ in
│                              Sprint 1).
└── data/                      runtime SQLite, snapshots — gitignored.
```

## Branches

- `main` — v2 (production OVERSEER). Bug fixes only.
- `v3-redesign` — v3 in progress. Stacked PRs by sprint (see
  `docs/04-IMPLEMENTATION-PLAN.md`).

## Running

v2 (still works on `v3-redesign` via compat shim):

```bash
./deploy/start_overseer.sh
```

This boots Kiwix, Ollama, and the Flask app on port 6100.

The build entrypoint is `python -m server`; in Sprint 0 it re-exports
the legacy app from `legacy_server.py` so behaviour matches v2.

## Reading the design

Start with `docs/01-DESIGN-SPEC.md` for the principles (P1–P11), then
`docs/02-MODULE-CATALOG.md` for the modules, then
`docs/04-IMPLEMENTATION-PLAN.md` for the sprint plan and target repo
layout. Architecture decisions go in `docs/architecture-decisions/`.

## License

AGPL-3.0-or-later.
