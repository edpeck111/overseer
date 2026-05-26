# OVERSEER v3 — status board

**Last updated:** end of Sprint 24a software-side — 2026-05-25.

---

## TL;DR

  - HEAD ahead of `origin/v3-redesign` (`4a0f791`) by the Sprint 22.6
    map-dual-mode restore. ADR-0015 added; sextant text-map is the
    NAVIGATION default again, with Leaflet as a `G`-key opt-in.
  - Sprints **0–22 + 22.6 + 23a done; 23b + 24a software-complete; 
    systemd deploy unit landed**.
    Hardware-blocked items waiting on Ted with kit in hand:
    - **Sprint 23b on-air gate** — run `tools/lora-spike.py
      --hardware ... soak` with two Heltecs per
      `docs/SPRINT-23b-RUNBOOK.md`. Pastes its summary into a
      `## Sprint 23b on-air gate evidence` block here on pass.
    - **Sprint 23c–e** — Cardputer firmware path. Blocked on 23b's
      on-air gate.
    - **Sprint 24a device gate** — open `/v3/bench-24a.html` on a
      2022+ phone + iPhone 13+ + desktop, press Start. Bench
      enforces the criteria itself; paste verdict + readout into
      a `## Sprint 24a device gate evidence` block here on pass.
    - **Sprint 24b–f** — full TRACKER engine port. Blocked on 24a
      device gate.
    - **Sprint 25** — SDR + display backends. Independent hardware
      paths, can run alongside 23c–e once attached.
    - **Sprint 24** — TRACKER audio module (WASM AudioWorklet, draws
      on `c:\source\tracker`).
    - **Sprint 25** — SDR + display backends + Cardputer polling
      (split off Sprint 23 — independent hardware paths).
  - Today: **OPi5 deploy works** (clone, pip install, `python -m server`,
    served at `:6100/v3/`). **No LoRa TX yet** — Sprint 23a closes that.
  - All gates green: **397 pytest passed (0 failed), smoke
    ALL CHECKS PASSED**, no warnings except the expected
    synthetic-fallback `UserWarning`s in the new hardware tests.
  - Bundle: ~141 KB minified JS + ~52 KB minified CSS (Sprint 22 GPS
    poll added ~1 KB).

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
| 20     | Polish: COMMS SQLite + hardware layer  | done     | ✓ |
| 21     | Real tiles + DISABLED banners          | done     | ✓ |
| 22     | Real hardware round 1: GPS + POWER     | done     | ✓ |
| 22.6   | Map dual-mode restore (sextant default)| done     | ✓ |
| 23a    | LoRa MVP — OPi5 side via Meshtastic    | done     | ✓ |
| 23b    | End-to-end OMP-over-Meshtastic spike   | sw-done  | ⊘ |
| 23c    | Cardputer firmware skeleton            | pending  | — |
| 23d    | Cardputer firmware — read-only OMP     | pending  | — |
| 23e    | Cardputer firmware — write/sync + UI   | pending  | — |
| 23-svc | systemd unit for OPi5 one-command boot | done     | ✓ |
| 24a    | TRACKER latency spike (WASM AudioWorklet)| sw-done| ⊘ |
| 24     | TRACKER — send-the-score audio module  | pending  | — |
| 25     | SDR + Display backends + Cardputer poll| pending  | — |

---

## Gate evidence at end of Sprint 21

```
$ pytest tests/           -> 357 passed (0 failed)
$ node tools/smoke-shell.mjs -> ALL CHECKS PASSED, 0 FAIL

Bundle: shell/public/dist/main.{js,css}
  main.js  ~140 KB minified
  main.css  ~52 KB minified
```

Test breakdown (357 total):
  - 354 carried (Sprint 20 baseline)
  - +3  (test_navigation.py: tiles_status_no_file, tiles_status_ok,
          tiles_serve_tile — new MBTiles endpoints)

Smoke: updated text-map assertion replaced with Leaflet map + no-tiles-banner
check; /api/hw mock added; all prior assertions still passing.

---

## Sprint 24a deliverables (TRACKER latency-spike bench — software side)

Landed 2026-05-25. **Status:** software-complete; the actual go/no-go
gate is "open the page on a 2022+ phone, press Start, observe pass
criteria." Browser-side test, not CI-testable. The bench enforces the
gate itself: it labels each measurement PASS / FAIL on the live
readout and prints the final verdict.

### What landed

`shell/public/bench-24a-worklet.js` (new, ~170 lines):
  - Faithful port of `c:\source\tracker\src\engine\voice303.rs` +
    `dsp/ladder.rs` hot path. Strips chorus / wobble / LFO / pan /
    noise — what remains is what the WASM port would have to run
    inside an AudioWorklet callback for the real TRACKER player.
  - Signal path: PolyBLEP saw → asym soft pre-drive → Huovilainen
    4-pole nonlinear ladder × 2× oversampling (8 tanh evaluations
    per output sample — the dominant cost) → 3-stage tanh cascade
    post-drive → AD amp envelope → output.
  - No allocations in `process()`; preallocated Float32Arrays for
    integrator + saturated states.
  - Reports per-buffer timing back to the main thread: `first_process`
    message once (for latency calc), `stats` message every 50 buffers
    with mean/max callback time, buffers processed, glitch count,
    `worklet_cpu_pct` (callback wall time / buffer audio time).
  - Glitch detection: tracks the `currentTime` jump between
    consecutive `process()` calls — if it's >1.8× the expected
    buffer duration, count it as a missed buffer.

`shell/public/bench-24a.html` (new, ~330 lines):
  - Mobile-first single-page bench. Served at `/v3/bench-24a.html`
    by the existing `_v3_shell` route in `server/app.py` (no new
    routing needed).
  - Terminal aesthetic matching the rest of the v3 shell. Self-
    contained — no imports, no build step, opens directly in any
    modern browser.
  - "Start 60-second soak" button: on press, captures
    `performance.now()`, creates `AudioContext({latencyHint: 'interactive'})`,
    loads the worklet module, triggers a continuous 303 voice
    (retriggered every 500 ms so the AD env never silences and the
    DSP stays active for the full minute).
  - Live readout: state / elapsed / latency / worklet CPU mean
    + max / glitches / buffers processed / main-thread rAF stalls /
    `outputLatency` / `baseLatency` / sample rate. Each gate row
    flips green/red as data arrives.
  - rAF loop monitors main-thread frame budget: any inter-frame
    delta >33 ms counts as a stall (proxy for "the page can't keep
    up with its budget").
  - Final verdict: explicit "GATE PASS — proceed to Sprint 24b" /
    "GATE FAIL — see readout" with full evidence in the run log.
  - visibilitychange warning: most browsers throttle AudioWorklet
    on hidden tabs — flagged loud and clear if the user backgrounds
    the page mid-soak.

### Gate (browser-evaluated)

| Check | Criterion |
|---|---|
| input-to-audio latency | < 30 ms |
| worklet CPU (steady-state mean) | < 5 % |
| audio glitches over 60 s soak | 0 |
| main-thread frame stalls | tracked, not gated |

The bench enforces all three programmatically; the page only shows
"GATE PASS" when every row is green. Failing rows are red on the
live readout and on the final verdict.

### How to run it

  1. Browse to `<server>/v3/bench-24a.html` on a 2022+ Android phone
     via Chrome, iPhone 13+ via Safari (iOS 17+), or desktop browser.
  2. Press the orange "Start 60-second soak" button. Use speakers
     or headphones — the bench plays an audible 303 voice for the
     full minute.
  3. Wait 60 seconds. Verdict appears at the top of the page.
  4. Don't navigate away during the soak — the visibility warning
     fires if you do, and most browsers throttle the audio thread
     when hidden, invalidating the result.

Tunnel URL (still live at this commit time):
`https://california-repeated-see-working.trycloudflare.com/v3/bench-24a.html`

### What 24a does NOT land

  - **Per-device pass/fail records.** This sprint ships the bench;
    you run it on whatever devices you care about and we paste
    results into a `## Sprint 24a device gate evidence` block here
    once we have them.
  - **WASM compilation.** The bench is hand-ported JS, not a
    wasm-pack build of the Rust engine. If 24a passes on hand-port
    we know AudioWorklet can do it; the WASM path (mentioned as
    risk mitigation in the Sprint 24 scope) is an option for
    Sprint 24c when float-determinism matters.
  - **Real TRACKER UX.** Just one voice playing a continuous
    303-ish note. Polyphony, sequencer, sample playback all
    deferred to 24c/d.

### Risks called out by 24a's existence

  - **iOS AudioContext + outputLatency.** Safari historically didn't
    expose `outputLatency`. The bench displays "unsupported" in that
    case and the latency gate effectively measures only the
    page-side portion. On iOS 17+ this should be present per
    WebKit's tracking; the bench will tell us.
  - **Tab throttling on Android Chrome.** Most aggressive on
    older Android; the visibilitychange handler flags it. If a
    user reports unstable results, "did you keep the tab in the
    foreground" is the first question.

---

## Sprint 23b deliverables (OMP-over-Meshtastic spike — software side)

Landed 2026-05-23. **Status:** software-complete; hardware-on-the-air
gate runs separately on the OPi5 + laptop pair per the runbook below
and gets a stamp here when it passes.

### What landed

`tools/lora-spike.py` (new, ~370 lines):
  - Cross-platform CLI for the 23b bench. Three commands: `ping`
    (single round-trip), `hello` (HELLO/HELLO_ACK with callsign echo),
    `soak --duration --rate --csv` (the gate run).
  - **`--hardware`** mode: opens a Meshtastic-compatible USB radio via
    `meshtastic.serial_interface.SerialInterface`, sends OMP packets as
    `PRIVATE_APP` payloads, awaits responses via pubsub. Per-packet
    msg_id match (response keyed off the 2-byte msg_id in the OMP
    header). Records `rxRssi` / `rxSnr` from the Meshtastic packet
    metadata.
  - **`--loopback`** mode: drives the in-process `SyntheticLora` so the
    spike script itself can be smoke-tested without radios. Adds
    deterministic latency + bounded jitter so the soak's summary stats
    are non-degenerate.
  - Output: live per-packet line (OK/X marker, msg_id, RTT, RSSI, SNR,
    error), optional CSV (msg_id, sent_at, response_at, rtt_ms,
    rssi_dbm, snr_db, error), final summary (count, success %,
    p50/p95/p99 RTT, mean RSSI/SNR), exit code 0 iff `success_rate
    >= 95.0` (Sprint 23b gate enforced by the tool).
  - Node-ID parsing: decimal (`12345`), hex (`0xdeadbeef`),
    Meshtastic-style (`!deadbeef`), or broadcast (`^all` / empty).

`tests/unit/test_lora_spike.py` (new, 13 tests):
  - `LoopbackTransport` round-trips and synthetic RSSI/SNR in expected
    bands.
  - `cmd_ping` / `cmd_hello` / `cmd_soak` exit-code + stdout contracts.
  - CSV output shape verified end-to-end.
  - Node-ID parsing across all four forms.
  - CLI argument validation: rejects both transports specified, rejects
    neither specified, accepts `--loopback` for ping and short soak.
  - Summary edge cases: zero packets / all-fail both return `GATE FAIL`.

`docs/SPRINT-23b-RUNBOOK.md` (new):
  - Two-radio bring-up instructions: stock Meshtastic firmware via the
    Web Flasher, identical region + channel + PSK on both ends,
    `meshtastic --info` to capture node IDs.
  - Prime-side enable: `OVERSEER_LORA=sx1262`, `curl /api/hw/lora` to
    verify the real backend came up.
  - Client-side run sequence: hardware ping, hello, then the 5-minute
    soak that produces the gate evidence.
  - Pass criteria, failure modes with diagnostic steps, "what to do
    when this passes" / "what to do when this fails" (don't proceed
    to 23c on a failed transport bench — open a thread first).

### What 23b does NOT land

  - **Hardware results.** This sprint ships the bench tool, not the
    bench run. The on-air gate happens when Ted has both radios in
    hand; results paste into a `## Sprint 23b on-air gate evidence`
    section here when it's done.
  - **OMP fragmentation.** `server/omp/codec.py` still has the Sprint
    12 placeholder. Soak runs at 1 Hz PING which fits one packet, so
    no fragmentation is exercised by this bench.
  - **Cardputer firmware.** Sprint 23c is unblocked once 23b's
    hardware gate stamps.

### Gate

| Check | Result |
|---|---|
| Loopback ping returns PONG with `server_time` | ✓ |
| Loopback hello returns HELLO_ACK with callsign echo | ✓ |
| Loopback soak at 20 Hz × 0.3 s → GATE PASS | ✓ |
| Loopback soak writes valid CSV | ✓ |
| All 13 spike tests pass | ✓ (427 total pytest) |
| Hardware-on-the-air bench (5-min soak) | **pending** |
| Shell smoke ALL CHECKS PASSED | ✓ |

---

## Sprint 23a deliverables (LoRa MVP on OPi5 — Meshtastic transport)

Landed 2026-05-23. **Gate**: 414 pytest passed (+17 new), shell smoke
ALL CHECKS PASSED. Hardware-on-the-air gate still pending until Ted
has a Heltec on the OPi5; the synthetic path is what CI exercises.

`server/omp/lora_transport.py` (new, ~250 lines):
  - `dispatch_packet(raw, *, version=None)` — shared dispatch core used
    by both the HTTP `/omp` route and the LoRa pubsub callback. Single
    source of truth for "given an OMP packet, what's the response?".
    `version=None` echoes the request's wire version (HTTP); the LoRa
    path passes `0x02` explicitly to force compression on the air.
  - `SyntheticLora` — no-op fallback. Records TX packets in-memory;
    `receive()` drives a synthetic round-trip through the dispatcher
    so tests + dev sims work without a radio.
  - `MeshtasticLora` — real backend via the `meshtastic` Python library
    over USB-serial. Lazy-imports `meshtastic.serial_interface` +
    `meshtastic.protobuf.portnums_pb2` + `pubsub` inside
    `__post_init__`. Subscribes to `meshtastic.receive.data`, filters
    on `PRIVATE_APP` port number, dispatches, TX'es the response back
    to the sender. ADR-0014 synthetic-fallback: any bring-up failure
    (lib missing, serial port absent, open fails) attaches a
    `SyntheticLora` and warns once. Server boot is unaffected.
  - `get_transport()` — module-level selector. `OVERSEER_LORA=synthetic`
    (or unset) → `SyntheticLora`. Any chip name (`sx1262`, `sx1278`,
    `rylr998`) → `MeshtasticLora` (the library handles chip
    differences; we don't need to know which is plugged in).
  - `reset_for_tests()` — replace the transport for unit-test
    isolation. Mirrors `navigation.reset_gps_for_tests`.
  - `register(app)` + `/api/hw/lora` endpoint — exposes link state
    (`{backend, node_id, tx_count, rx_count, last_error?}`) so 23b's
    end-to-end spike can verify the link without going through `/api/hw`.

`server/omp/server.py` (refactored):
  - HTTP `/omp` route now delegates to `lora_transport.dispatch_packet`.
    All wire-version-echo behaviour preserved (regression-tested).
  - Removed dead-code `_error_packet` helper (moved inside the
    transport module). `decode`/`encode` imports dropped — handlers
    still import `Op` directly.

`server/app.py`:
  - Imports `server.omp.lora_transport`, calls `register(app)` +
    `get_transport()` at boot. The eager bring-up surfaces config
    problems at server start rather than at first packet (ADR-0014).

`tests/unit/test_lora_transport.py` (new, 17 tests):
  - `dispatch_packet` round-trips: PING → PONG with `server_time`,
    HELLO → HELLO_ACK with `client_callsign` echo, unknown opcode →
    ERROR(NOT_IMPL), handler exception → ERROR(HANDLER_THREW),
    garbage input → ERROR(DECODE).
  - Wire-version handling: echoes v0x01 → v0x01 by default; honours
    explicit `version=0x02` to force compression.
  - `SyntheticLora`: send records `(dest, payload)` tuples; `receive`
    drives the full dispatcher; `close` is a no-op.
  - `MeshtasticLora` on a CI box (no library, no radio): does not
    raise, attaches `_fallback`, warns once, send/info/close all work
    through the fallback.
  - Selector: `OVERSEER_LORA=sx1262` instantiates `MeshtasticLora`
    (with fallback attached because no hardware).
  - HTTP `/omp` regression: PING round-trip through the refactored
    Flask route; v0x01 request → v0x01 response (wire-version echo
    preserved).
  - `/api/hw/lora` endpoint returns the expected shape.

`docs/architecture-decisions/0016-meshtastic-as-transport.md` (new):
  - Documents Option A (custom LoRa) / Option B (Meshtastic as
    transport, chosen) / Option C (firmware side-by-side, rejected).
  - Pins the load-bearing decision so future PRs that try to slip
    custom LoRa framing in have to argue against it explicitly.
  - Revisit triggers: payload cap, duty cycle, upstream protocol
    churn, regulatory change.

### What 23a does NOT do (Sprint 23b/c/d/e own these)

  - **Verify on real hardware.** Synthetic fallback is the CI path;
    Ted plugs a Heltec V3 into the OPi5 for 23b's hardware gate.
  - **Add `meshtastic` to `requirements.txt`.** Lazy import means
    nothing breaks if absent. Pin when 23b confirms the lib version
    we want.
  - **Build the OMP opcode set out.** Still Sprint-2-level stubs.
    Sprint 23d expands the read-path opcodes for the field-relay UX.
  - **Fragmentation for writes >200 B.** Codec already has a Sprint
    12 placeholder. Lift when a real use case forces it.
  - **Cardputer firmware.** Sprint 23c onward.

### How to enable on the OPi5

```sh
pip install meshtastic                  # optional dep, lazy-imported
export OVERSEER_LORA=sx1262             # or sx1278 / rylr998
# optional: pin the serial device
export OVERSEER_LORA_DEVICE=/dev/ttyUSB0
python3 -m server
```

`curl http://localhost:6100/api/hw/lora` should then return
`{"backend": "meshtastic", "node_id": <int>, "tx_count": 0, "rx_count": 0}`
once the radio is up. Without the radio plugged in, you'll see
`backend: "synthetic"` and a `last_error` field describing the
bring-up failure.

---

## Sprint 23 scope (LoRa MVP + Cardputer field-relay firmware)

Status: **pending — not started**. Scope defined 2026-05-23 after Ted
asked whether the current build can broadcast small packets to remote
devices if pushed onto an OPi5. Short answer at scoping time: **no**.
v3 has no code that touches a radio. `server/hw.py` declares the
`OVERSEER_LORA` env-var contract; no driver was written. Legacy
`lora_bridge.py` (Meshtastic Python lib + Heltec V3 over USB-serial)
exists in the repo but isn't imported by anything and only bridges the
v1 text protocol. The Cardputer-Adv firmware that the mesh architecture
diagram puts at the centre of the field topology has never been written
— `deploy/cardputer/` is 64 lines of README + a 10-line JSON config
example, no code.

### Why this is a sprint, not a "Sprint 11+ TBD"

The previous one-line "Sprint 23+ SDR / LoRa / Mesh + Cardputer + push"
entry collapsed five unrelated workstreams into a single bullet that
never moved. Sprint 23 is now scoped to **the LoRa mesh path
end-to-end**: OPi5 transmits, mesh hops, Cardputer relays, phones see
the v3 shell over a SoftAP. SDR and display work split out to Sprint 25
(separate hardware paths, no dependency).

### Topology (re-stated from `docs/03-MESH-ARCHITECTURE.md`)

```
  [phone] ── WiFi/SoftAP ──► [Cardputer-Adv (field relay)]
                                    │
                              LoRa  │  868 MHz / 915 MHz ISM
                                    ▼
                       [other Cardputers / Meshtastic nodes]
                                    │
                              LoRa  │  multi-hop, up to 7 hops
                                    ▼
                       [OPi5 Prime + LoRa USB device]
```

The Cardputer is the **field unit**. Phones in the field connect to
**its SoftAP** (no internet required), reach a full v3 shell served
from its flash, and any `/api/*` call gets translated into an OMP
packet and ridden over LoRa to Prime, possibly through intermediate
nodes. Both endpoints (OPi5 and every Cardputer) need a LoRa radio.

### Architectural decision: Meshtastic as transport (not custom LoRa)

OMP packets ride **inside Meshtastic data packets** (`PORTNUM_PRIVATE_APP`
payload, ~200 B usable — fits a Brotli'd OMP packet). Rationale:

  - Meshtastic already does what we'd otherwise spend months
    rebuilding: mesh routing, AES-256 encryption, duty-cycle compliance
    (EU 1% on 868 MHz, FCC 30 dBm on 915 MHz — both enforced by the
    firmware), neighbour discovery, store-and-forward, position
    beacons. All free, battle-tested, on the exact ESP32-S3 + SX1262
    hardware we'd be buying anyway.
  - Other people's Meshtastic nodes can relay our packets without
    running our firmware. The 200-mile / multi-hop story comes from
    the broader community plus any relay nodes we deploy.
  - Proof point already in-repo: legacy `lora_bridge.py` uses the
    `meshtastic` Python library against a Heltec V3 today. It works.
    Sprint 23a lifts that plumbing into v3 transport.
  - All hardware (Cardputer-Adv, Heltec V3, T-Beam, RAK4631) is
    commercially sold for exactly this use case on ISM bands —
    license-free, encryption permitted on ISM, standard hobbyist
    territory.

Rejected alternative: custom LoRa frames + our own mesh routing.
Months of work re-inventing what Meshtastic already ships. Only worth
revisiting if Meshtastic's per-packet payload cap or duty-cycle
discipline blocks a concrete use case we can name. To be captured in
**ADR-0016: Meshtastic-as-transport** (write alongside Sprint 23a).

### Hardware shopping list (for Sprint 23 dev)

  - **OPi5 side:** any Meshtastic-compatible USB device — Heltec V3 (~£25),
    T-Beam (~£40), or RAK4631 (~£35). `meshtastic` Python lib is
    indifferent to which.
  - **Field side:** M5Stack Cardputer-Adv (the LoRa variant, ESP32-S3
    + SX1262 + 1.14" colour LCD + 56-key keyboard, ~£70). Stock
    Meshtastic firmware boots on it.
  - **Optional second OPi5-side antenna:** a 5 dBi rubber duck on a
    short SMA cable buys real range. The PCB antenna on the Heltec
    is fine for bench testing.

### Milestones — 23a/b are go/no-go gates for 23c–e

#### 23a — LoRa MVP on OPi5 (3–5 days)

  - Add `server/omp/lora_transport.py`: lifts the serial-to-Meshtastic
    plumbing from `lora_bridge.py:LoraBridge` (`__init__`, `_listen`,
    `_on_packet`, `send` methods), strips out the v1 text protocol,
    keeps only `iface = meshtastic.serial_interface.SerialInterface(...)`.
  - Hook it as a transport sink in `server/omp/server.py`: inbound
    Meshtastic packets on `PORTNUM_PRIVATE_APP` → `decode()` → existing
    OMP dispatch table → response → `encode()` → `iface.sendData(...)`.
  - Wire into `hw.lora_backend()`: when `OVERSEER_LORA=sx1262|sx1278|rylr998`,
    start the LoRa transport on boot; otherwise stay synthetic.
  - Synthetic fallback per ADR-0014: bring-up failure (no serial device,
    `meshtastic` import error, port not openable) attaches a
    `_synthetic` flag, surfaces a DISABLED banner in the shell.
  - Add `/api/hw` integration so the SIGNAL module's MESH indicator
    reflects real radio state.
  - **Gate:** with `OVERSEER_LORA=sx1262` and a Heltec V3 plugged into
    the OPi5, `python tools/sim-mesh.py --target 192.168.1.x:6100 ping`
    on a laptop with its own Heltec on the same channel succeeds —
    end-to-end PING/PONG over the air, OMP-encoded.

#### 23b — End-to-end OMP-over-Meshtastic spike (1–2 days)

Validate the architectural decision before committing to firmware work.

  - On a laptop with a Heltec V3 + `pip install meshtastic`, hand-craft
    an OMP `HELLO` packet using `server/omp/codec.py:encode()`, send
    as `PRIVATE_APP` payload to the OPi5's node ID.
  - Verify OPi5 receives it, decodes, returns `HELLO_ACK`.
  - Run a 5-minute soak: 1 packet/sec at SF9, log RSSI/SNR per
    packet, confirm Meshtastic's duty-cycle limiter doesn't break OMP
    flow. (At ~1 KB per OMP packet round-trip, well under 1% duty.)
  - **Gate:** ≥95% packet success rate at 100 m line-of-sight, no
    duty-cycle warnings logged. Fail → revisit transport decision.

#### 23c — Cardputer firmware skeleton (~1 week)

Smallest possible firmware: WiFi SoftAP + HTTP server + Meshtastic
client app, **no shell hosting yet**. Confirms the on-device pipeline
end-to-end before pulling in LittleFS + bundle delivery.

  - ESP-IDF project at `deploy/cardputer/firmware/` (new). Target
    Cardputer-Adv (ESP32-S3, 8 MB flash, 8 MB PSRAM).
  - Stock Meshtastic firmware does NOT run as base — we run our own
    ESP-IDF app that uses the Meshtastic protobuf library to talk to
    the on-board SX1262. Decision: easier than running Meshtastic and
    our app as side-by-side processes on a microcontroller.
  - WiFi SoftAP on `OVERSEER-<callsign>` SSID. Open captive portal at
    `http://192.168.4.1/`.
  - `esp_http_server` on port 80. One route only: `GET /api/ping` →
    builds OMP PING packet → TX over LoRa → wait for PONG (timeout
    5 s) → return as JSON to phone.
  - LCD shows: SSID, channel, last RSSI, packet counters (TX/RX/dropped).
  - Reads `/spiffs/bridge.json` for callsign + LoRa mode (per
    `deploy/cardputer/bridge-config.example.json`).
  - **Gate:** phone on Cardputer SoftAP, hit `http://192.168.4.1/api/ping`
    in browser, see `{"ok": true, "rtt_ms": <number>}`. Round-trip
    goes phone → Cardputer (WiFi) → LoRa → OPi5 → LoRa → Cardputer →
    phone. End-to-end proven.

#### 23d — Cardputer firmware: read-only OMP + shell hosting (~1–2 weeks)

  - LittleFS partition for the static v3 shell. Add `Makefile`
    target that copies `shell/public/dist/` + `shell/public/index.html`
    into `deploy/cardputer/firmware/spiffs/shell/` before `idf.py build`.
  - HTTP server serves `/` (and `/v3/`) from LittleFS — phone gets the
    same v3 shell it would get from Prime, just over SoftAP.
  - HTTP→OMP translation middleware: per-route mapping table mirrors
    `server/omp/opcodes.py`. Read-only routes only for this milestone
    (no writes, no SQLite-affecting calls):
    - `GET /api/n/waypoints` → OMP opcode (TBD, see below)
    - `GET /api/n/terrain` → OMP opcode
    - `GET /api/k/library/archives` → OMP opcode
    - `GET /api/c/inbox` → OMP opcode
    - `GET /api/hw` → OMP opcode
  - Each read-only response from Prime is cacheable on the Cardputer
    in PSRAM (TTL per ADR-0008 cache classes) so repeated phone
    requests don't pound the radio.
  - **OMP opcode expansion required:** Sprint 2 only defined PING/PONG/
    HELLO + a few stubs. Read-only routes above need real opcodes
    + handlers. Land alongside in `server/omp/opcodes.py` + handler
    registration in the relevant `server/modules/*.py`.
  - **Gate:** phone on Cardputer SoftAP, opens shell, NAVIGATION
    waypoints sub-screen populates with real data from Prime 200 m
    away over LoRa. All other sub-screens that need read-only data
    work too.

#### 23e — Cardputer firmware: write/sync + link UI polish (~1 week)

  - Write opcodes: `POST /api/n/waypoint`, `POST /api/c/inbox/send`,
    journal entries, MEDICAL run records. These cost more bandwidth
    (write payloads can be larger) — add OMP fragmentation if a single
    Meshtastic packet can't hold the payload (rare for the data shapes
    we care about, but plumbing must exist).
  - Outbox queue: writes that fail (no LoRa carrier, Prime unreachable)
    persist to LittleFS, replay on link recovery. Mirror of the shell's
    `idb_outbox.js` pattern.
  - Link-quality UI: LCD shows neighbour list (callsign, RSSI, last
    seen), packet success rate, current channel + SF. 56-key keyboard
    used for callsign entry on first boot (otherwise read from
    `bridge.json`).
  - Boot chime + status LED patterns (per `bridge-config.example.json`'s
    `boot_chime` field) for headless deployment.
  - **Gate:** full v3 shell functional over Cardputer SoftAP at 1 km
    line-of-sight (or 200 m through buildings). Phones can read AND
    write; outbox queue survives a 60-second LoRa blackout.

### Out of scope (deferred)

  - **SDR / display backends** — moved to Sprint 25. Independent
    hardware paths.
  - **Custom LoRa mesh routing** — Meshtastic does it. Only revisit
    if a concrete use case beats Meshtastic's per-packet cap or duty
    cycle.
  - **Cardputer running stock Meshtastic firmware in parallel with our
    app** — investigated and rejected in 23c. We use the Meshtastic
    protocol over our own application code; we don't run their full
    firmware stack alongside.
  - **Auto-OTA firmware updates over LoRa** — packet sizes too large
    to be worth the duty cycle. Sneakernet for now.
  - **End-to-end encryption beyond Meshtastic's AES-256** — channel
    encryption is sufficient for v1. ADR-0012 covers the comms-crypto
    layer if we later want per-operator E2E on top.

### Risks

  - **Meshtastic protobuf size on ESP32** — full protobuf runtime adds
    ~40 KB to firmware. Acceptable on ESP32-S3 with 8 MB flash but
    worth measuring early (23c).
  - **Duty cycle on busy channels** — EU 1% means ~36 s of TX per hour
    per node. Heavy v3 shell use (lots of polls, lots of writes) could
    saturate it. Mitigations: aggressive caching on Cardputer side
    (ADR-0008 TTLs), OMP delta-sync for COMMS/NAVIGATION (KNOWLEDGE
    pattern from ADR-0007 generalises).
  - **Cardputer-Adv availability + spec uncertainty** — confirm the
    LoRa variant is in stock and that its SX1262 is on standard
    EU/US ISM frequencies before ordering more than one for dev.
  - **OMP opcode table is mostly stubs (Sprint 2)** — 23d will need
    to materialise real handlers for at least the read paths it
    exposes. Don't underestimate this; it's the work that connects
    the OMP plumbing to actual module data. Track in 23d, not as a
    later cleanup.
  - **The "moving target" risk** — `lora_bridge.py` is v1 code that
    pre-dates the v3 design. Don't over-fit 23a to it; lift the bits
    that work (serial bring-up, packet RX/TX) and write the rest
    fresh against v3 conventions (ADR-0014 adapter pattern,
    synthetic-fallback contract, blueprint registration).

### Deliverables checklist (for the "done" gate)

  - `server/omp/lora_transport.py` (23a)
  - `server/omp/opcodes.py` extended with real read-path opcodes (23d)
  - Module handlers wired for those opcodes (23d)
  - `tests/unit/test_lora_transport.py` — synthetic-fallback + happy-path
  - `tests/unit/test_omp_codec.py` — already exists, extend with
    end-to-end Meshtastic envelope round-trip fixture
  - `deploy/cardputer/firmware/` ESP-IDF project (23c, expanded 23d/e)
  - `deploy/cardputer/Makefile` — bundle-copy + build target
  - `deploy/systemd/overseer.service` — Linux service for OPi5 deploy
    (separate but should land in same sprint window so OPi5 is
    one-command deployable end-to-end)
  - `docs/architecture-decisions/0016-meshtastic-as-transport.md`
  - `docs/STATUS.md` — Sprint 23a–e deliverables sections as each
    milestone lands

---

## Sprint 24 scope (TRACKER — send-the-score audio over mesh)

Status: **pending — not started**. Scope defined 2026-05-23 after Ted
asked whether compressed TOML "scores" from the sibling `c:\source\tracker`
project could be transmitted over Meshnet and played back on phones /
Linux / Windows.

### Why this fits OVERSEER

Same architectural insight as the sextant text-map (ADR-0015) and the
KNOWLEDGE delta-sync (ADR-0007): **send the source representation,
render locally**. The bandwidth gain is dramatic — Brotli-compressed
TOML on the reference track `riddle_me_this.toml`:

| Form | Size | LoRa packets (SF12, ~178 B payload) |
|---|---|---|
| TOML source | 8772 B | 50 |
| gzip -9 | 2054 B | 12 |
| **Brotli -q 11** | **1726 B** | **~8** |
| MP3 bounce | 1.6 MB | ~9 400 |
| WAV bounce | 19 MB | ~110 000 |

A full DJ track ships in ~8 LoRa packets / a single Meshtastic chunk.
Once each peer has the engine and the drum-sample pack cached (one-time
~704 KB pack over WiFi or sneakernet), every future song is 1-2 KB.

### Architecture decision: path 2 (WASM + Web Audio)

Three player paths were considered; path 2 picked because it aligns with
the "monospace, universal, no install" ethos of the rest of OVERSEER
and reuses the existing v3 shell as the player UI on every platform
(Android Chrome, iOS Safari ≥17, Linux Firefox, Windows desktop).

  1. Rust → native binaries per platform (cargo cross-compile, JNI/Tauri
     for Android). Best perf, three install paths to maintain. Escape
     hatch if 24a latency bench fails.
  2. **AudioWorklet engine + Web Audio API in the v3 shell.** Chosen.
  3. Server-side bounce to MP3 on Overseer Prime. Punts on bandwidth
     win; only useful if WASM perf is inadequate (it won't be).

### Reference projects

  - `c:\source\tracker` — Rust acid-techno engine. **Early-stage, will be
    revised considerably.** Sprint 24 must port the *concepts and TOML
    grammar*, not pin to any specific engine commit. Source LOC at time
    of scoping: `src/` = 1837 lines total, of which `dsp/` + `engine/`
    ≈ 1200 lines (the translation target).
  - `c:\source\tracker\visualizer\` — CRT-styled web frontend
    (`index.html` 165, `viz.js` 247, `style.css` 201 = 613 lines total).
    **Directly liftable** — uses the browser's AnalyserNode for the
    spectrum (no FFT port needed), pure CSS for the SL-1210 turntables
    and CRT scanlines. Aesthetic translates straight into the v3 shell.

### Milestones — 24a is a go/no-go gate for 24b–f

#### 24a — Latency spike (go/no-go)

Port one voice (the 303 voice — most expensive — *or* the kick sampler
if simpler is preferred for the first pass) to an AudioWorklet. Trigger
from a Play button in a throwaway page. Measure end-to-end latency on:

  - A 2022+ Android phone via Chrome (Pixel 6 / S22 class baseline)
  - iPhone 13+ via Safari (iOS 17+)
  - Desktop Linux Firefox

Pass criteria: **<30 ms input-to-audio latency, no audible glitches at
128-sample buffer over 60 s sustained playback, <5% main-thread CPU**.

Fail → fall back to path 1 (native) and rescope. Don't proceed to 24b
on hope.

#### 24b — Wire format + sample pack protocol

  - Lock TOML v1 schema (subset of the current tracker grammar that the
    WASM engine implements). Document at `docs/08-TRACKER-FORMAT.md`.
  - New OMP message type `song.v1`: Brotli-compressed TOML + sample-pack
    SHA-256 + (optional) cover art ref. Wire through the existing OMP
    envelope (ADR-0006 msgpack codec).
  - Sample-pack manifest endpoint `/api/t/pack/manifest` returns
    `{hash, version, file_count, total_bytes, samples: [{name, sha256, size}]}`.
  - Peer fetches the pack once over WiFi via `/api/t/pack/<sha256>.tar`
    (or zip — decide). Cached in IndexedDB / SQLite per-platform.
  - Player refuses to play songs whose pack hash doesn't match a cached
    pack — surfaces a "missing samples (pack {hash})" DISABLED banner.

#### 24c — Engine port

Translate `tracker/src/dsp/` + `tracker/src/engine/` to TypeScript
AudioWorklet. Keep the structure close to the Rust so future engine
revisions in the Rust source can be re-translated cheaply.

  - `dsp/osc.ts` — PolyBLEP saw + square
  - `dsp/ladder.ts` — Huovilainen 4-pole nonlinear ladder, 2× OS
  - `dsp/env.ts`, `dsp/drive.ts`, `dsp/util.ts`, `dsp/biquad.ts`,
    `dsp/delay.ts`
  - `engine/voice303.ts` — the 303 voice
  - `engine/sampler.ts` — polyphonic sample voice
  - `engine/sequencer.ts` — pattern stepping
  - `engine/ducker.ts` — sidechain
  - `engine/mixer.ts` — master sat + limiter
  - All buffers preallocated. **No allocations in the audio thread.**
  - Determinism check: bit-identical (or near-identical, ±LSB) output
    vs the Rust bounce for the reference track, across Chrome / Safari /
    Firefox. Float-determinism caveats documented if hit.

Add a **draft mode** toggle: skip 2× oversampling + use the cheaper
biquad LPF in place of the ladder. Sounds 90% as good for preview,
costs ~⅓ the CPU. Default ON for mobile, OFF for desktop.

#### 24d — TRACKER module in v3 shell

Hotkey TBD (suggest `J` — unused per current HELP HOTKEYS list, fits
"jam"). Sub-screens:

  - `L`ibrary — received songs, by date/sender/title. Backed by a new
    `tracker_song` SQLite table (migration 016).
  - `P`lay — engine view; play/pause, position, BPM, current pattern,
    visualizer pane.
  - `U`pload — paste TOML or pick a file; validates + Brotli + sends as
    `song.v1` OMP message to a peer or board.
  - `S`ample pack status — show cached pack hash, total size, "fetch
    over WiFi" action if a peer advertises a newer pack.

Backend: `server/modules/tracker.py` with the standard `register(app)`
shape; SQLite migration; blueprint at `/api/t/`. Endpoints:
`/api/t/songs`, `/api/t/song/<id>`, `/api/t/upload`, `/api/t/pack/manifest`,
`/api/t/pack/<hash>`.

#### 24e — Visualizer lift

Port `c:\source\tracker\visualizer\` into the shell as
`shell/src/modules/tracker/visualizer/`. Adapt the palette to the
terminal tokens (`--amber`, `--cyan`, `--fg-bright`). Keep:

  - 32-band spectrum (browser AnalyserNode, no FFT port)
  - Scope (waveform from a script processor or worklet ring buffer)
  - RMS meters
  - Step grid synced to the sequencer
  - Twin SL-1210 turntable animations (pure CSS)
  - CRT scanlines, vignette, phosphor flicker

The CRT effects ride on top of the existing v3 chrome — should look like
"the tracker visualizer dropped inside the OVERSEER terminal frame", not
a separate viewer that breaks aesthetic continuity.

#### 24f — Bench + polish

  - 60-minute soak test on the Android baseline phone — no buffer
    underruns, no audio thread crashes.
  - Memory budget: <50 MB heap at steady state with one song loaded and
    the sample pack cached.
  - DISABLED banner if AudioContext can't be created (rare but happens
    on locked-down Android profiles).
  - HELP entry + ADR-0016 documenting the send-the-score decision.

### Out of scope (deferred to Sprint 24+)

  - Real-time collaborative jamming (live performance streaming) — much
    harder problem (network jitter, drift correction). Not needed for v1.
  - Native player binaries (path 1) — only revisit if path 2 fails 24a.
  - Compression beyond Brotli — already at 1.7 KB; further wins not
    worth complexity until somebody hits a real wall.
  - Custom sample packs — v1 uses one canonical pack distributed by
    Overseer Prime. Pack authoring UX is a v2 concern.

### Risks

  - **AudioWorklet on iOS Safari** — solid from iOS 17+ but historically
    a source of headaches. 24a explicitly benches Safari before commit.
  - **Float determinism across engines** — if Chrome and Safari diverge
    by more than ±1 LSB, "everyone hears the same thing" weakens.
    Mitigation: ship a Rust → WASM build of the engine itself (via
    wasm-pack) as a fallback if hand-ported TS drifts. Bigger bundle
    (~150 KB extra) but bit-identical to the Rust bounce.
  - **The tracker engine is moving** — Sprint 24 ports concepts, not a
    pinned commit. Schema and module structure should anticipate engine
    revisions without protocol breakage. Wire format (Brotli TOML +
    pack hash) is the stable contract; the engine implementation behind
    it can change.

---

## Sprint 22.6 deliverables (Map dual-mode restore — sextant default)

Scope: restore the sextant text-map as the default NAVIGATION map view.
Sprint 21 had silently flipped the default to Leaflet, contradicting
`docs/06-TEXT-MAP-SYSTEM.md` ("the text map is the *primary* low-bandwidth
view... what every operator on every transport sees by default"). Ted
caught the regression during local testing on 2026-05-22 and chose
dual-mode rather than a full Leaflet rip-out: ASCII primary per spec,
Leaflet retained as an opt-in WiFi-only detail view.

`shell/src/modules/navigation.js`:
  - `paintMap()` now dispatches on `local.mapMode` (default `"text"`).
  - `paintTextMap()` fetches `/api/n/terrain` (already on backend since
    Sprint 8a) and renders via `rasterize()` from `shell/src/sextant/`.
    Bitmap is 120×72 → ~24 sextant rows × 60 cells.
  - `paintGraphicalMap()` retains the Sprint 21 Leaflet + MBTiles path
    unchanged, including the no-tiles DISABLED banner.
  - `T` and `G` keys toggle modes while in the M sub-screen.
  - Shared `tearDownLeaflet()` cleans up the Leaflet instance + GPS poll
    on mode-switch or unmount.
  - Below the text map: compact waypoint legend (bearing / cardinal /
    name / cat / distance) computed from operator position — mirrors
    the C sub-screen's compass list.

`shell/src/modules/navigation.css`:
  - `.nav-map-toggle` + `.nav-map-mode-btn` for the T/G toggle row.
  - `.nav-map` styles the sextant `<pre>` (monospace, terminal palette).
  - `.nav-leaflet-map` styles + Leaflet popup theming retained verbatim.

`tools/smoke-shell.mjs`:
  - Default-mode assertion: `pre.nav-map` present with rendered content.
  - G-toggle assertion: Leaflet container mounts + no-tiles banner shows.
  - T-toggle assertion: returns to sextant `<pre>`, Leaflet container
    torn down (no DOM leak).

`docs/architecture-decisions/0015-map-dual-mode.md` (new):
  - Codifies ASCII-primary, supersedes the implicit Sprint 21 decision.
  - References ADR-0009 (sextant as system-wide primitive) and the
    bandwidth math in `docs/06-TEXT-MAP-SYSTEM.md`.

No backend changes — `/api/n/terrain` (`server/modules/navigation.py:712`)
was still serving the bitmap; only the shell needed re-wiring.

---

## Sprint 22 deliverables (Real hardware round 1 — GPS + POWER)

Scope: stand up real-hardware adapters for the two backends with mature
Python libs and graceful failure modes. SDR / LoRa / Mesh / Display stay
synthetic for now — each needs its own sourcing decision and pulls in
heavier dependencies. Both new adapters preserve the
"synthetic-fallback-on-bring-up-failure" contract so the server still
boots on a dev box without I2C / GPS hardware.

`server/modules/power.py` (extended):
  - `Ina226Source` — Texas Instruments INA226 over I2C via `smbus2`.
    Writes config + calibration on init; reads bus voltage (1.25 mV/LSB)
    and signed current (current_lsb = max_current / 32768) per call.
    Lazy-imports `smbus2`; on `ImportError` or bus-open failure, attaches
    a `SyntheticSource` and warns once.
  - `ShuntSource` — generic ADC-via-I2C source (ADS1115 defaults).
    Reads bus voltage post-divider + shunt voltage, derives current
    via Ohm's law. Same lazy-import + fallback contract. `read_raw()`
    is an override point for non-ADS1115 ADCs.
  - `_RailMeasurement` dataclass; `_rail_to_sample()` helper combines a
    rail measurement with psutil-derived CPU/RAM/thermal numbers so the
    on-wire `Sample` shape is identical to synthetic.
  - `_host_metrics()` — psutil-backed; returns plausible static defaults
    if psutil is absent so tests/CI don't need the wheel.
  - `_select_source()` rewritten: consults `hw.power_backend()`
    (`OVERSEER_POWER`) instead of the old local `OVERSEER_POWER_SOURCE`
    env var. Unknown values now fall back to synthetic via `hw.py`'s
    validator rather than raising.

`server/modules/navigation.py` (extended):
  - `Fix` dataclass — `lat`, `lon`, `alt_m`, `accuracy_m`, `sats`,
    `fix_type` (`"no_fix" | "2d" | "3d"`), `at`. `to_wire()` rounds
    floats and emits JSON-clean dict.
  - `SyntheticGps` — deterministic seeded random walk around a
    configurable centre (defaults to Manchester); auto-snaps back
    inside `radius_km` after drift.
  - `GpsdSource` — TCP to `localhost:2947`; issues
    `?WATCH={"enable":true,"json":true};\n`, drains TPV objects on each
    `read_fix()`. Non-blocking socket; partial-line buffering. Returns
    cached newest fix or `None`.
  - `SerialNmeaSource` — pyserial-backed; parses `$GPGGA` (3D + sats +
    alt) and `$GPRMC` (2D fallback). NMEA `ddmm.mmmm` → decimal degrees
    via `_nmea_dm_to_deg()`. Rejects `RMC` status `V` (void) and
    `GGA` quality `0`.
  - `gps_fix()` public function + `_gps()` selector (driven by
    `hw.gps_backend()`); cached at module level.
  - `reset_gps_for_tests()` for deterministic injection.
  - `/api/n/gps/fix` HTTP endpoint — `200` + wire dict when fixed,
    `204 No Content` when no fix.
  - Lazy-imports: `socket` (stdlib, always present), `serial` (optional).
    On bring-up failure each real source attaches a synthetic fallback
    and warns once.

`tests/unit/test_power.py` (updated):
  - Old `OVERSEER_POWER_SOURCE` tests (`unknown_source_flavour_rejected`,
    `hardware_flavour_explicitly_unimplemented`) replaced with four
    selector tests against the new `OVERSEER_POWER` env: default,
    `ina226`, `shunt`, and unknown-value-falls-back-to-synthetic.

`tests/unit/test_hw_power.py` (new, 11 tests):
  - INA226: smbus2-missing fallback; register-math with fake bus
    (bus_v 0x2EE0 → 15.0 V; current 0x0100 with current_lsb 20/32768);
    signed-current handling for 0xFF00; read-failure-attaches-fallback.
  - Shunt: smbus2-missing fallback; ADC math at half-scale (bus
    divider × full-scale × ratio); read-failure fallback.
  - Selector wiring: `OVERSEER_POWER` → correct class.

`tests/unit/test_hw_gps.py` (new, 21 tests):
  - Synthetic: validity, seed-determinism, radius-bounding, wire shape.
  - gpsd: connect-failure-fallback; `?WATCH` is sent; TPV parsing for
    mode 3 with alt/eph/nSat; mode 1 ignored; non-TPV class ignored;
    bad JSON survived; multi-line buffer; partial-line buffering.
  - NMEA serial: pyserial-missing fallback; `_nmea_dm_to_deg` for
    Manchester + southern hemisphere + empty inputs; `$GPGGA` and
    `$GPRMC` parsing; quality-0 / status-V rejection; garbage-then-valid.
  - End-to-end: `gps_fix()` wire shape; `204` and `200` HTTP routes;
    selector wiring for `gpsd` / `serial` / default.

Gate evidence:
```
$ pytest tests/  ->  396 passed, 1 pre-existing failure
                    (tests/unit/test_sextant.py::test_python_renders_are_stable,
                     cp1252 codec on Windows — unrelated to Sprint 22)
$ node tools/smoke-shell.mjs  ->  ERR_REQUIRE_ESM in @exodus/bytes
                    (npm dep-tree issue; no shell changes this sprint)
```

Sprint 22 added +21 hw-power + 21 hw-gps = 42 new test cases; the four
old POWER_SOURCE-flag tests in `test_power.py` were rewritten in place.

---

## Repo hygiene — resolved this session

The tangled "files-on-disk-but-not-in-git" state has been cleaned up:

- `.gitignore` extended (FUSE artefacts, sprint .bat helpers,
  pytest-cache dirs, build .gz/.old artefacts, secrets, runtime
  databases).
- The full v3 tree is now tracked: `server/` (omp, llm, crypto,
  plugins, all modules), `shell/src/` (chrome, components, palette,
  sextant, state, transport, all modules, all styles), `tests/`
  (fixtures, integration, full unit suite), `docs/` (01–07 design
  specs, all ADRs including 0014, REBUILD/AUSPICE/SEXTANT specs,
  preview HTML), `deploy/` (cardputer + setup + systemd), `tools/`
  (sim, seed, build-dictionary, download-tiles, sample-remote-op).
- v2 compat shim retained (`legacy_server.py`, `lora_*.py`,
  `crypto_utils.py`, `train_dictionary.py`).
- Cruft kept out: `keys/admin_private.pem`, `kiwix/`, `zim/`,
  `sounds/`, `data/`, `tools/tiles/*.mbtiles`, `node_modules/`,
  `__pycache__/`, `.fuse_hidden*`, `_git_commit_sprint*.bat`,
  stray `Overseer` root file, `prepper_llm_project.md`.

`origin/v3-redesign` is now one commit behind `HEAD`. Push when
ready: `git push -u origin v3-redesign`.

---

## Sprint 21 deliverables (Real tiles + DISABLED banners)

`tools/download_tiles.py` (new):
  - Downloads UK OSM tiles from tile.openstreetmap.org into an MBTiles SQLite file
  - `MBTILES_MIN_ZOOM` / `MBTILES_MAX_ZOOM` env vars (defaults 0–14)
  - Quick mode: `set MBTILES_MAX_ZOOM=8 && python tools\download_tiles.py` (~30 s)
  - **Must run on Ted's Windows machine** — sandbox proxy blocks OSM tile server

`tools/download-tiles.bat` (new):
  - Windows convenience wrapper for download_tiles.py

`server/modules/navigation.py` (extended):
  - `/api/n/tiles/status` — returns tile count + zoom range from MBTiles file
  - `/api/n/tiles/<z>/<x>/<y>` — serves PNG tiles with TMS y-flip (`(2^z-1)-y`)
  - `MBTILES_PATH` env var to override default path (`tools/tiles/uk.mbtiles`)
  - +3 pytest tests: tiles_status_no_file, tiles_status_ok, tiles_serve_tile

`server/app.py` (extended):
  - Registers `_hw_bp` blueprint → `/api/hw` endpoint

`server/hw.py` (extended):
  - `_hw_bp` Flask blueprint at `/api/hw`
  - Returns full hw_info dict + `_any_real` bool + `_synthetic` bool-dict per key

`shell/public/index.html`:
  - Added Leaflet 1.9.4 CSS + JS from cdnjs CDN

`shell/src/modules/navigation.js`:
  - `paintMap()` replaced: Leaflet tile map on `/api/n/tiles/{z}/{x}/{y}`
  - No-tiles banner when MBTiles file absent (run download_tiles.py to dismiss)
  - Leaflet instance destroyed on unmount to prevent DOM leaks
  - Waypoints rendered as colour-coded circle markers with popups
  - Operator position shown as green circle marker

`shell/src/styles/navigation.css`:
  - `.nav-leaflet-map` — full-height map container
  - Leaflet popup theming to match terminal palette

`shell/src/modules/_hw.js` (new):
  - `hwStatus()` — fetch-once-and-cache `/api/hw`; falls back to FALLBACK
    (all `_synthetic` keys true) on error or non-OK response
  - `disabledBanner(what, detail)` — shared amber DISABLED banner factory

`shell/src/modules/signal.js`, `power.js`, `knowledge.js`, `medical.js`:
  - Import `hwStatus` / `disabledBanner` from `_hw.js`
  - DISABLED banners shown for any synthetic hardware backend
  - `knowledge.js` / `medical.js`: `bannerBar` element sits between tab bar and
    body so sub-screen `replaceChildren()` calls never wipe the banner

`shell/src/styles/base.css`:
  - `.disabled-banner` — amber border, amber text, ⚠ icon, flex layout

`tools/smoke-shell.mjs`:
  - Old sextant text-map assertion replaced with Leaflet map header + no-tiles
    banner assertion
  - `/api/hw` and `/api/n/tiles/status` mocks added

---

## Sprint 20 deliverables (Polish: COMMS SQLite + hardware layer)

`server/migrations/015_comms.sql`:
  - `comms_operator` — callsign registry
  - `comms_message` — message rows with serialised envelope JSON
  - `comms_board_post` — board posts with body + metadata

`server/modules/comms.py` (hybrid SQLite migration):
  - `register_operator()` writes to `comms_operator`
  - `send_message()` writes envelope via `to_wire()` to `comms_message`
  - `mark_read()` updates `state` column in `comms_message`
  - `post_to_board()` writes to `comms_board_post`
  - `reset_for_tests()` calls `reset_tables(...)` + clears in-memory dicts
  - `_messages` dict stays as in-memory cache (crypto objects can't go in DB)
  - All 9 existing comms tests pass unchanged

`server/hw.py` (new):
  - `sdr_backend()` — OVERSEER_SDR env var → rtlsdr / hackrf / airspy / synthetic
  - `lora_backend()` — OVERSEER_LORA → sx1262 / sx1278 / rylr998 / synthetic
  - `mesh_backend()` — OVERSEER_MESH → meshtastic / hamlib / synthetic
  - `gps_backend()` — OVERSEER_GPS → gpsd / serial / synthetic
  - `power_backend()` — OVERSEER_POWER → ina226 / shunt / synthetic
  - `display_backend()` — OVERSEER_DISPLAY → epaper / hdmi / headless
  - `hw_info()` — snapshot dict of all backends
  - `any_real_hardware()` — True if any non-synthetic backend active
  - Unknown env values fall back to default with a warning

`tests/unit/test_comms.py` (extended to 12 tests):
  - +3 persistence tests: message_written_to_db, mark_read_updates_db,
    board_post_written_to_db

`tests/unit/test_hw.py` (new, 18 tests):
  - TestDefaults (6): all defaults correct
  - TestEnvOverrides (8): each backend, unknown value warning, case-insensitive
  - TestHwInfo (4): all keys, defaults, any_real_hardware false/true

`.gitignore`:
  - Added `.fuse_hidden*` (Linux FUSE mount artefacts)

---

## ADRs 0001–0013 in place

All in `docs/architecture-decisions/`. See Sprint 8 STATUS for full table.

---

## Things parked

- Brotli dict ctypes shim (ADR-0010)
- JS-side Brotli v0x02 (wait on browser support)
- COMMS forward secrecy — python-doubleratchet (ADR-0012)
- COMMS `_messages` in-memory cache — crypto objects require live ratchet state
- Real hardware backends — env flags in `server/hw.py`, stubs ready to swap in
- Cardputer firmware (Ted writes this against the OPi5 backend)
- `.git/` cruft + `.trash_local/` cleanup

