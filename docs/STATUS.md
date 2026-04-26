# OVERSEER v3 — status board

**Last updated:** end of Sprint 5, autonomous run, paused for Ted.

---

## TL;DR

  - Branch `v3-redesign` is **41 commits past `origin/main`**, all local.
  - Sprints **0–5 done**; Sprint 6 (COMMS) is the next gate.
  - Nothing pushed during the autonomous run per standing instruction —
    Ted pushes from Windows when he wakes up.
  - All gates passed: 42 Python tests + 28 jsdom smoke checks + 11
    sextant parity vectors + 3 sim-mesh integration roundtrips.

---

## How to push when you're back at Windows

From `C:\Source\Overseer\`:

```
git push -u origin v3-redesign
```

That's it. Branch tracks `origin/v3-redesign` after the first push;
subsequent pushes are plain `git push`. No PRs were opened — keep the
branch as a long-running rebase target per the design plan.

---

## Per-sprint completion

| Sprint | Title                                  | Status   | Commits | Gate |
|--------|----------------------------------------|----------|---------|------|
| 0      | Repo migration + dev environment       | done     | 6       | ✓ |
| 1      | Chrome + HOME                          | done     | 8       | ✓ |
| 2      | Transport layer + OMP foundation       | done     | 9       | ✓ |
| 3      | POWER (canary)                         | done     | 4       | ✓ |
| 4      | Static-shell discipline                | done     | 10      | ✓ |
| 5      | KNOWLEDGE refresh                      | done     | 3       | ✓ |
| 6      | COMMS refresh + boards                 | pending  |         | — |
| 7      | MEDICAL wizard reflow                  | pending  |         | — |
| 8/8a   | NAVIGATION + text map                  | pending  |         | — |
| 9      | LOG                                    | pending  |         | — |
| 10     | INVENTORY                              | pending  |         | — |
| 11     | TIMELINE                               | pending  |         | — |
| 12     | AUSPICE part A (astronomy)             | pending  |         | — |
| 13     | AUSPICE part B (divination + journal)  | pending  |         | — |
| 14     | SIGNAL                                 | pending  |         | — |
| 15     | RECREATION foundation                  | pending  |         | — |
| 16     | RECREATION: Dragon's Tale              | pending  |         | — |
| 17     | SYSTEM polish + HELP                   | pending  |         | — |
| 18+    | Polish, optional modules, hardware     | pending  |         | — |

(AUSPICE moved into the main arc per the Sprint-2 plan revision —
ADR-0010 / commit `777b54a` for the slot reasoning.)

---

## Gate evidence at end of Sprint 5

```
$ pytest                                  → 42 passed (unit + integration)
$ npm run smoke (jsdom)                   → 28 PASS, 0 FAIL
$ node tests/fixtures/sextant_js_parity   → 11 pass, 0 fail
$ python tools/sample-remote-op.py        → 5/5 OMP roundtrips through sim-mesh

Bundle: shell/public/dist/main.{js,css}
  main.js  gz: ~21 KB
  main.css gz: ~3 KB
  combined gz: ~24 KB     (budget: 2 MB)
```

---

## Architecture decisions made overnight

These all have ADRs in `docs/architecture-decisions/` so you can audit
the reasoning. Each is reversible via a follow-on ADR if you disagree.

- **ADR-0010 — Brotli backend.** Server uses `brotlicffi`, encodes
  VERSION 0x02 (Brotli) by default, decodes both 0x01 raw + 0x02
  Brotli for graceful upgrade. The `/omp` endpoint echoes the request
  version so JS clients (still on v0x01 in the WiFi-served bundle)
  get raw replies and future Cardputer clients (v0x02) get
  compressed replies. Browser-side stays on v0x01 because esbuild
  iife couldn't dynamic-split brotli-wasm cleanly and the WiFi path
  is HTTP/JSON anyway. Native `CompressionStream("br")` was rejected
  because the format-name diverges (browsers say "br", Node 22 says
  "brotli"). Dictionary-on-the-wire deferred — `brotlicffi` doesn't
  expose `BrotliEncoderSetCustomDictionary` without a ctypes shim.

- **ADR-0011 — KNOWLEDGE backend.** sqlite-vec (the active successor
  to sqlite-vss the original spec called for). Embedding model
  `nomic-embed-text-v1.5` 384-d INT8 — synthetic for Sprint 5,
  `OVERSEER_KB_EMBEDDER=nomic` swap. Ollama LLM wrapper around
  `qwen2.5:7b-instruct-q4_K_M` — synthetic canned-citation lookup
  for Sprint 5, `OVERSEER_LLM=ollama` swap. whisper.cpp + piper as
  synthetic stubs. Sprint 5 ships full plumbing + UI flows; only the
  model *content* is canned. Real backends are one env-flag-flip
  away, no UI changes needed.

- **OMP opcode-range vs fragmentation marker.** The spec contradicts
  itself: §1.2 says "high bit of op marks fragments" but §3 lists
  real opcodes up to 0xFF (POWER 0x90, SYSTEM 0xA0, ...). Sprint 4
  resolution: encoders/decoders allow the full 0..0xFF range; the
  fragment-marker placement is deferred to Sprint 12 with LoRa
  hardware. Tests updated to match. `is_fragment()` helpers stay
  available for callers that want the high-bit semantics.

- **Sextant rasterizer is a system-wide primitive.** ADR-0009
  (Sprint 2 plan revision). Lives at `shell/src/sextant/`,
  imported by modules; no per-module forks. Sprint 4 ports the full
  rasterizer + 4 binarizers (threshold, otsu, niblack, F-S, atkinson)
  and asserts byte-for-byte parity with the Python prototype across
  11 fixture vectors.

- **AUSPICE inlined as Sprints 12-13.** Was an off-track Sprint A/B/C.
  Slotted after TIMELINE (not after LOG as initially suggested) so
  ALMANAC events feed the cross-module event stream on day one.
  Renumbered downstream Sprints 14-18+. AUSPICE-MODULE-SPEC.md gained
  a supersedure note on its old build-priority section.

- **Cache-class TTLs.** ADR-0008 codified concrete ms values for
  STATIC/STABLE/WARM/HOT/EXPENSIVE on WiFi vs mesh. Service worker
  (Sprint 4) implements stale-while-revalidate per class with
  forced `networkOnly` for mutating methods, `/(auth|login|token|secret|admin)/`
  paths, and any `Set-Cookie` response.

- **POWER synthetic source.** Sprint 3 ships a state-machine
  generator with plausible drift, AC-on events, load spikes, and
  thermal lag. Real-hardware swap is a `OVERSEER_POWER_SOURCE=hardware`
  env flag; the `read_sample()` Protocol stays the same. Sprint 4
  added the lazy WS-push producer thread that starts on first
  subscribe and stops on last unsubscribe.

---

## Things parked for your call

Nothing genuinely blocking, just things that benefit from your
judgment when you're back:

- **Brotli dictionary on the wire (Python side).** Sprint 2 built and
  hashed `server/omp/dictionary.bin`; Sprint 4 wired raw Brotli but
  the dict path is gated on a small ctypes shim against
  `libbrotlienc.so` (or upstream `brotlicffi` adding the binding).
  ~60-80 LOC of FFI glue when you want to land it.

- **Real model swap-in for KNOWLEDGE.** When you have an OPi5 with
  `qwen2.5:7b` + a nomic embedder weights on disk, set
  `OVERSEER_LLM=ollama` and `OVERSEER_KB_EMBEDDER=nomic`. The shell
  flows are real today; only the answer content is canned.

- **Cardputer firmware.** `deploy/cardputer/` ships scaffolding
  (README + bridge config schema). The actual ESP-IDF firmware is
  your domain per the project memory. Once you have the device:
  the build pipeline copies `shell/public/*` into the firmware's
  `data/shell/` LittleFS partition.

- **`.git/` cruft from the hostile-mount workaround.** The Linux
  sandbox can't unlink files on the Windows mount, so I worked
  around it by renaming aside. `.git/` has accumulated some
  `*.lock.cleared-*`, `*.stale*`, `index.corrupt-*`, and
  `objects/**/tmp_obj_*` orphans. None block git operations; safe to
  delete from Windows when convenient.

- **`.trash_local/`** — graveyard for files moved aside during the
  sandbox-unlink workaround (rejected v3/app/ pre-scaffold,
  `.localmod` snapshots, etc.). Already gitignored. Eyeball before
  deleting in case anything looks salvageable; I don't think so.

- **Python ≥ 3.11 confirmation on production OPi5.** `pyproject.toml`
  requires 3.11; the dev sandbox runs 3.10.12 so I can't run
  `pre-commit` locally, only on a 3.11+ machine.

---

## Working memory updates worth knowing

The autonomous run didn't update `.auto-memory/MEMORY.md` files (read-
only mount in this sandbox). The substantive learnings to fold in
when convenient:

  - The `v3-redesign` branch is now 41 commits past `origin/main`
    (was 9 at start of this run); all local.
  - Sprints 0–5 are done; Sprint 6 (COMMS) is the next target.
  - AUSPICE is Sprints 12-13 in the renumbered plan.
  - 11 ADRs landed (0001–0011).
  - Hostile Windows-mount filesystem makes `git rm` and `chmod`
    intermittently fail; pattern is "rename aside, never delete".
    `GIT_INDEX_FILE=/tmp/overseer-index` keeps the index out of the
    broken mount when corruption recurs.

---

## Ready for Sprint 6 when Ted resumes

Sprint 6 (COMMS refresh + boards) per `docs/04-IMPLEMENTATION-PLAN.md`
§Sprint-6:

  - Three-pane layout (Folders / Messages / Detail)
  - Inbox / Sent / Drafts / Archive / Outbox folders
  - Boards (`/general /intel /trade /swap /sos`)
  - Net pane with mesh node list
  - Compose with optimistic send + delivery state badges
  - Real Signal-ratchet implementation (lift to JS too)
  - Mesh routing: messages forward through nodes
  - Markdown rendering in message body
  - Attachment support (photos, voice notes)

Gate: two simulated operators exchange encrypted messages over the
mesh simulator with multi-hop routing; ratchet state survives across
reconnects; board posts visible to all.

The `tools/sample-remote-op.py` harness is the natural starting point
for the multi-operator demo.
