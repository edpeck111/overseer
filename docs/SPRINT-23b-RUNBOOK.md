# Sprint 23b runbook — hardware-on-the-air gate

Validates ADR-0016 (Meshtastic-as-transport) on real radios before
Sprint 23c commits to firmware work. Two Meshtastic-compatible USB
devices required: one on the OPi5 ("Prime"), one on a laptop
("client"). Software side is `tools/lora-spike.py`, landed in this
sprint alongside this runbook.

## Hardware

  - **OPi5 side:** any Meshtastic-compatible USB device — Heltec V3
    (~£25), T-Beam (~£40), RAK4631 (~£35). 868 MHz EU / 915 MHz US
    variant per your region.
  - **Client side:** identical or equivalent device. Same region /
    frequency / spreading factor as the OPi5's radio.
  - **Antennas:** stock PCB / rubber duck is fine for the 100 m gate.
    For the soak's RSSI/SNR stats to be useful, place both devices at
    roughly the geometry you expect to deploy at (don't bench-test
    next to each other on a desk).

## One-time setup (both ends)

```sh
# Flash stock Meshtastic firmware on each device using the Web Flasher:
#   https://flasher.meshtastic.org/
# Pick the firmware matching your chip + region.

# Configure both nodes onto the same channel + same PSK.
# Using the Meshtastic Python CLI (works on either side once installed):
pip install meshtastic
meshtastic --set-region EU_868            # or US, etc. — match your region
meshtastic --ch-set name OVERSEER --ch-index 0
meshtastic --ch-set psk random --ch-index 0   # generates a shared key
meshtastic --info                              # capture the node ID — used below
```

After running `--ch-set psk` on one device, export the QR / channel URL
and apply the same channel on the second device so they share the PSK.
Without identical PSK the radios won't decode each other's packets.

## Prime (OPi5) side

```sh
cd ~/overseer
git pull origin v3-redesign

# Optional dep — the v3 server's LoRa transport lazy-imports this.
pip install meshtastic

# Enable the real backend. Chip name is from server/hw.py's
# _LORA_BACKENDS set — any non-synthetic value routes to MeshtasticLora.
export OVERSEER_LORA=sx1262
# Pin the device only if auto-detect picks the wrong USB port:
#   export OVERSEER_LORA_DEVICE=/dev/ttyUSB0

python3 -m server
```

Verify the backend came up:

```sh
curl -s http://localhost:6100/api/hw/lora | jq
# Expected: {"backend": "meshtastic", "node_id": <int>, "tx_count": 0, "rx_count": 0}
# If "backend": "synthetic" with a "last_error" field, the radio didn't
# attach — check dmesg / lsusb / serial permissions (usermod -aG dialout).
```

The `node_id` from this response is what the **client side**'s
`--dest-node` argument needs.

## Client (laptop) side

```sh
# Clone the repo on the laptop too (the spike script imports
# server.omp.codec).
git clone <repo-url> overseer && cd overseer
pip install meshtastic

# Hardware ping. Replace 0xDEADBEEF with the OPi5's node_id from
# the curl above.
python tools/lora-spike.py --hardware --dest-node 0xDEADBEEF ping
# Expected: PASS  msg_id=1  rtt=~200-600ms  rssi=<-100..-30 dBm>  snr=<...>

# HELLO handshake — confirms the dispatch table is wired and the
# callsign echoes back.
python tools/lora-spike.py --hardware --dest-node 0xDEADBEEF \
    hello --callsign TANGO-1
# Expected: PASS  ... server_ver=3.0.0-dev0  dict_ver=0

# The Sprint 23b gate: 5-minute soak at 1 Hz with per-packet CSV.
python tools/lora-spike.py --hardware --dest-node 0xDEADBEEF \
    soak --duration 300 --rate 1.0 --csv soak.csv
```

## Pass criteria

The soak run prints a summary at the end. The gate is in the runbook
because the spike script *enforces* the success-rate threshold and
exits non-zero if it isn't met:

  - **>=95% packet success rate.** The script's final line says
    `GATE PASS` or `GATE FAIL` and the exit code matches (0 / 1).
  - **No duty-cycle warnings in the Meshtastic library output.** Watch
    the Prime side's stdout — if the library logs a duty-cycle warning,
    we're transmitting more than EU 1% / FCC region cap allows. At
    1 Hz with ~200 B packets this should not happen; if it does it
    means the radio is busy retransmitting and we need to either drop
    the rate or move to a faster SF preset.
  - **No firmware crashes / radio resets** during the 5 minutes.
    `curl http://opi5.local:6100/api/hw/lora` periodically — `rx_count`
    should be climbing roughly in step with the soak's `OK` count.

## Failure modes and what to do

  - **Spike's `PASS` line shows `error=timeout`.** Radios aren't talking
    to each other. Verify both nodes are on the same channel + PSK
    (`meshtastic --info` on each). Check antennas are connected (running
    a LoRa radio with no antenna kills it — pull the USB cable first).
  - **`backend: "synthetic"` on the Prime's `/api/hw/lora`.** Check the
    Python warning at server startup — it'll say either "meshtastic
    unavailable" (missing `pip install meshtastic`) or "serial open
    failed" (wrong device path, missing dialout group on Linux, or
    no device plugged in).
  - **Success rate is 80-94%.** Could be channel congestion (other
    Meshtastic users on a public channel near you), interference, or
    bad antenna placement. Move to a private channel with a non-default
    PSK, retry. If still <95% with a clear channel, that's a real
    finding to record before deciding on path forward.
  - **Success rate <50% or all timeouts.** Almost always a config
    problem (wrong region / PSK / channel index) rather than a real
    transport issue. Double-check both ends with `meshtastic --info`.

## What this run produces

  - `soak.csv` — per-packet log (msg_id, sent_at, response_at, rtt_ms,
    rssi_dbm, snr_db, error). Keep for the Sprint 23b deliverables
    section in STATUS.md: paste the summary, attach the CSV.
  - Final printed summary — copy into a `## Sprint 23b on-air gate
    evidence` block in STATUS.md once the hardware run passes.

## When this passes

Sprint 23b's gate is met → start Sprint 23c (Cardputer firmware
skeleton). The Meshtastic-as-transport decision is now load-tested on
the actual radios you'll be deploying.

## When this fails

Don't proceed to 23c. The transport decision is the foundation of
everything downstream. Failure modes worth treating as gate-fail:

  - Success rate <95% on a clean channel — the application layer's
    duty-cycle assumptions are wrong; recompute against measured.
  - Meshtastic library crashes or hangs during the soak — pin a known-
    good version in requirements.txt and retry; if multiple versions
    fail, escalate.
  - Per-packet RTT regularly >10 s at SF9 — fragmentation or queueing
    is occurring; investigate before commitment.

Open a thread documenting the failure and the alternative being
considered (Option A "custom LoRa stack" per ADR-0016, or different
hardware) before changing direction.
