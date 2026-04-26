"""Sample remote-operator session over the mesh simulator.

Demonstrates an OMP roundtrip from a 'remote operator' that talks to
Overseer Prime through tools/sim-mesh.py with realistic LoRa-flavoured
latency + occasional loss. Useful for:

  - Confirming the wire format works end-to-end
  - Visualising what a Cardputer's OMP bridge will exchange at boot
  - Stress-testing reconnect behaviour under loss

Run from repo root:

    python -m server &                              # backend on :6100
    python tools/sim-mesh.py --latency-ms 200 \
        --loss 0.05 --upstream http://localhost:6100/omp &  # sim on :6101
    python tools/sample-remote-op.py                # this script
"""

from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Add repo root to path so `from server.omp ...` resolves when run
# from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.omp.codec import decode, encode  # noqa: E402
from server.omp.opcodes import Op             # noqa: E402


SCRIPT = [
    ("HELLO",         Op.HELLO,         {"callsign": "ECHO-3", "caps": ["lora-sim"]}),
    ("PING",          Op.PING,          {}),
    ("INBOX_HEADERS", Op.INBOX_HEADERS, {}),
    ("NET_NODES",     Op.NET_NODES,     {}),
    ("POWER_NOW",     Op.POWER_NOW,     {}),
]


def fmt_payload(p):
    s = repr(p)
    return s if len(s) <= 80 else s[:77] + "..."


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bridge",  default="http://localhost:6101/omp")
    ap.add_argument("--repeats", type=int, default=2,
                    help="how many times to run the script (each run a fresh msg_id base)")
    args = ap.parse_args(argv)

    fail = 0
    success = 0
    msg_id = 1

    print(f"[remote-op] bridge: {args.bridge}")
    print(f"[remote-op] running {len(SCRIPT) * args.repeats} OMP roundtrips\n")

    for run in range(args.repeats):
        print(f"--- run {run+1}/{args.repeats} ---")
        for label, op, payload in SCRIPT:
            pkt = encode(op, msg_id, payload)
            t0 = time.monotonic()
            try:
                req = urllib.request.Request(
                    args.bridge, data=pkt, method="POST",
                    headers={"Content-Type": "application/octet-stream"},
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    raw = resp.read()
                resp_op, resp_id, resp_payload = decode(raw)
                dt_ms = (time.monotonic() - t0) * 1000
                status = "OK"
                if resp_op == Op.ERROR:
                    status = f"ERR {resp_payload.get('code', '?')}"
                    fail += 1
                else:
                    success += 1
                print(f"  {label:14s}  msg_id={msg_id:>5d}  rt={dt_ms:5.0f}ms  {status}  resp={fmt_payload(resp_payload)}")
            except urllib.error.HTTPError as e:
                dt_ms = (time.monotonic() - t0) * 1000
                fail += 1
                print(f"  {label:14s}  msg_id={msg_id:>5d}  rt={dt_ms:5.0f}ms  HTTP {e.code} (sim drop?)")
            except Exception as e:  # noqa: BLE001
                fail += 1
                print(f"  {label:14s}  msg_id={msg_id:>5d}  ERR {e!s}")
            msg_id = (msg_id + 1) & 0xFFFF
        print()

    total = success + fail
    rate = success / total * 100 if total else 0.0
    print(f"[remote-op] {success}/{total} succeeded ({rate:.0f}%)")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
