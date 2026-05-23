"""Sprint 23b — end-to-end OMP-over-Meshtastic bench.

Validates ADR-0016's architectural decision on real hardware before
the Cardputer firmware work (Sprint 23c onward) commits to it.

Three modes:

  ping              one PING/PONG round-trip; prints RTT + RSSI/SNR.
  hello             one HELLO/HELLO_ACK with a callsign; verifies the
                    server's ``client_callsign`` echo + the wire-version
                    fields. Mostly a "is the dispatch table wired?" check.
  soak              N-second soak at one packet/sec. Logs per-packet
                    CSV; prints summary (count, success %, p50/p95/p99
                    RTT, mean RSSI/SNR) at the end.

Transport:

  --hardware        opens a Meshtastic-compatible USB radio via the
                    ``meshtastic`` library, sends OMP packets as
                    ``PRIVATE_APP`` payloads, listens for the response
                    over pubsub. Requires a real radio on this side AND
                    a real radio (with OVERSEER running, OVERSEER_LORA
                    set) on the receiving side.

  --loopback        skips hardware entirely. Drives the in-process
                    SyntheticLora to exercise the encode → dispatch →
                    decode path. Useful for smoke-testing the spike
                    itself without two radios; fake RSSI/SNR values.

Usage examples::

    # On the laptop, against an OPi5 200 m away
    python tools/lora-spike.py --hardware --device /dev/ttyUSB0 \
        --dest-node 0xDEADBEEF ping

    python tools/lora-spike.py --hardware --device /dev/ttyUSB0 \
        --dest-node 0xDEADBEEF soak --duration 300 --rate 1.0 \
        --csv soak.csv

    # Smoke test on the dev box (no hardware required)
    python tools/lora-spike.py --loopback ping
    python tools/lora-spike.py --loopback soak --duration 5 --rate 5

Gate for Sprint 23b: ≥95% packet success at 100 m line-of-sight, no
duty-cycle warnings logged by the Meshtastic library during the soak.
"""

from __future__ import annotations

import argparse
import csv
import random
import statistics
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Any

# Allow running this script directly (``python tools/lora-spike.py``)
# without ``-m`` by adding the repo root to sys.path.
if __package__ is None or __package__ == "":
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.omp.codec import decode, encode  # noqa: E402
from server.omp.opcodes import Op  # noqa: E402


# --------------------------------------------------------------------- #
# Per-packet record — CSV row shape + summary aggregator input.
# --------------------------------------------------------------------- #

@dataclass
class PacketResult:
    msg_id: int
    sent_at: float
    response_at: float | None = None
    rtt_ms: float | None = None
    rssi_dbm: float | None = None
    snr_db: float | None = None
    error: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.response_at is not None and self.error is None


# --------------------------------------------------------------------- #
# Loopback transport — drives the in-process dispatcher.
# --------------------------------------------------------------------- #
#
# Used by ``--loopback`` and by tests/unit/test_lora_spike.py. Models a
# successful round-trip with synthetic latency + a deterministic RSSI/SNR
# so summary stats are non-degenerate.

@dataclass
class LoopbackTransport:
    fake_latency_ms: float = 5.0
    fake_rssi: float = -42.0
    fake_snr: float = 9.0
    _rng: random.Random = field(default_factory=lambda: random.Random(0xC0FFEE))

    def send_and_wait(self, packet: bytes, *, dest_node: int | None,
                      timeout_s: float) -> dict[str, Any]:  # noqa: ARG002
        from server.omp.lora_transport import dispatch_packet
        response = dispatch_packet(packet)
        time.sleep(self.fake_latency_ms / 1000.0)
        return {
            "packet": response,
            "rssi_dbm": self.fake_rssi + self._rng.uniform(-1.5, 1.5),
            "snr_db":  self.fake_snr  + self._rng.uniform(-0.3, 0.3),
        }

    def close(self) -> None:
        pass


# --------------------------------------------------------------------- #
# Hardware transport — Meshtastic Python library + USB-serial radio.
# --------------------------------------------------------------------- #

@dataclass
class HardwareTransport:
    """Sends OMP packets as PRIVATE_APP payloads, awaits the response
    on the same port via pubsub. The receiving side (OPi5) is expected
    to be running OVERSEER with ``OVERSEER_LORA=sx1262`` so its
    ``MeshtasticLora.dispatch_packet`` path picks up the request and
    replies."""

    device: str | None = None
    _iface: Any = field(default=None, init=False, repr=False)
    _portnum: int = field(default=0, init=False, repr=False)
    _pending: dict[int, threading.Event] = field(default_factory=dict, init=False, repr=False)
    _responses: dict[int, dict[str, Any]] = field(default_factory=dict, init=False, repr=False)
    _lock: threading.RLock = field(default_factory=threading.RLock, init=False, repr=False)

    def __post_init__(self) -> None:
        import meshtastic.serial_interface as _serial  # type: ignore[import-untyped]
        from meshtastic.protobuf import portnums_pb2  # type: ignore[import-untyped]
        from pubsub import pub  # type: ignore[import-untyped]
        if self.device:
            self._iface = _serial.SerialInterface(devPath=self.device)
        else:
            self._iface = _serial.SerialInterface()
        self._portnum = portnums_pb2.PortNum.PRIVATE_APP
        pub.subscribe(self._on_data, "meshtastic.receive.data")

    def _on_data(self, packet: dict, interface: Any) -> None:  # noqa: ARG002
        decoded = packet.get("decoded") or {}
        if decoded.get("portnum") != "PRIVATE_APP":
            return
        raw = decoded.get("payload")
        if not isinstance(raw, (bytes, bytearray)):
            return
        try:
            op, msg_id, _payload = decode(bytes(raw))
        except Exception:  # noqa: BLE001
            return
        with self._lock:
            self._responses[msg_id] = {
                "packet": bytes(raw),
                "op": op,
                "rssi_dbm": packet.get("rxRssi"),
                "snr_db":   packet.get("rxSnr"),
                "from": packet.get("from"),
            }
            ev = self._pending.get(msg_id)
        if ev is not None:
            ev.set()

    def send_and_wait(self, packet: bytes, *, dest_node: int | None,
                      timeout_s: float) -> dict[str, Any]:
        # Extract msg_id from the header so we can match the response.
        msg_id = int.from_bytes(packet[2:4], "big")
        ev = threading.Event()
        with self._lock:
            self._pending[msg_id] = ev
        try:
            self._iface.sendData(
                packet,
                destinationId=dest_node if dest_node is not None else "^all",
                portNum=self._portnum,
                wantAck=False,
            )
            if not ev.wait(timeout=timeout_s):
                return {"error": "timeout", "rssi_dbm": None, "snr_db": None}
            with self._lock:
                resp = self._responses.pop(msg_id, None)
            if resp is None:
                return {"error": "missing", "rssi_dbm": None, "snr_db": None}
            return resp
        finally:
            with self._lock:
                self._pending.pop(msg_id, None)

    def close(self) -> None:
        if self._iface is not None:
            try:
                self._iface.close()
            except Exception:  # noqa: BLE001
                pass


# --------------------------------------------------------------------- #
# Run modes
# --------------------------------------------------------------------- #

def _next_msg_id(seq: dict[str, int]) -> int:
    seq["n"] = (seq.get("n", 0) + 1) & 0xFFFF
    return seq["n"] or 1  # never return 0; reserve it for "uninitialised"


def run_one(transport: Any, *, op: int, payload: Any, dest_node: int | None,
            timeout_s: float, msg_id: int) -> PacketResult:
    pkt = encode(op, msg_id, payload)
    rec = PacketResult(msg_id=msg_id, sent_at=time.time())
    resp = transport.send_and_wait(pkt, dest_node=dest_node, timeout_s=timeout_s)
    rec.response_at = time.time()
    rec.rtt_ms = (rec.response_at - rec.sent_at) * 1000.0
    rec.rssi_dbm = resp.get("rssi_dbm")
    rec.snr_db = resp.get("snr_db")
    if resp.get("error"):
        rec.error = resp["error"]
    return rec


def cmd_ping(transport: Any, *, dest_node: int | None, timeout_s: float) -> int:
    seq: dict[str, int] = {}
    rec = run_one(transport, op=Op.PING, payload=None,
                  dest_node=dest_node, timeout_s=timeout_s,
                  msg_id=_next_msg_id(seq))
    if not rec.succeeded:
        print(f"FAIL  msg_id={rec.msg_id} error={rec.error}")
        return 1
    print(f"PASS  msg_id={rec.msg_id}  rtt={rec.rtt_ms:.1f}ms  "
          f"rssi={_fmt(rec.rssi_dbm, 'dBm')}  snr={_fmt(rec.snr_db, 'dB')}")
    return 0


def cmd_hello(transport: Any, *, dest_node: int | None, timeout_s: float,
              callsign: str) -> int:
    seq: dict[str, int] = {}
    msg_id = _next_msg_id(seq)
    pkt = encode(Op.HELLO, msg_id, {"callsign": callsign})
    sent_at = time.time()
    resp = transport.send_and_wait(pkt, dest_node=dest_node, timeout_s=timeout_s)
    rtt_ms = (time.time() - sent_at) * 1000.0
    if resp.get("error"):
        print(f"FAIL  error={resp['error']}")
        return 1
    body = resp["packet"]
    op_out, msg_id_out, payload = decode(body)
    if op_out != Op.HELLO_ACK:
        print(f"FAIL  expected HELLO_ACK, got 0x{op_out:02x}")
        return 1
    if payload.get("client_callsign") != callsign:
        print(f"FAIL  callsign echo mismatch: got {payload.get('client_callsign')!r}")
        return 1
    print(f"PASS  msg_id={msg_id_out}  rtt={rtt_ms:.1f}ms  "
          f"server_ver={payload.get('server_ver')}  "
          f"dict_ver={payload.get('dict_ver')}  "
          f"rssi={_fmt(resp.get('rssi_dbm'), 'dBm')}  "
          f"snr={_fmt(resp.get('snr_db'), 'dB')}")
    return 0


def cmd_soak(transport: Any, *, dest_node: int | None, timeout_s: float,
             duration_s: float, rate_hz: float, csv_path: str | None) -> int:
    interval_s = 1.0 / rate_hz if rate_hz > 0 else 1.0
    deadline = time.time() + duration_s
    seq: dict[str, int] = {}
    records: list[PacketResult] = []

    print(f"Soak: {duration_s:g}s @ {rate_hz:g} Hz "
          f"(interval {interval_s*1000:.0f}ms, timeout {timeout_s:g}s)")

    next_send = time.time()
    while time.time() < deadline:
        delay = next_send - time.time()
        if delay > 0:
            time.sleep(delay)
        msg_id = _next_msg_id(seq)
        rec = run_one(transport, op=Op.PING, payload=None,
                      dest_node=dest_node, timeout_s=timeout_s, msg_id=msg_id)
        records.append(rec)
        marker = "OK" if rec.succeeded else "X "
        print(f"  {marker}  msg_id={rec.msg_id:5d}  "
              f"rtt={_fmt(rec.rtt_ms, 'ms', '6.1f')}  "
              f"rssi={_fmt(rec.rssi_dbm, 'dBm')}  "
              f"snr={_fmt(rec.snr_db, 'dB')}  "
              f"{rec.error or ''}")
        next_send += interval_s

    if csv_path:
        _write_csv(records, csv_path)
        print(f"\nCSV written: {csv_path}")

    return _print_summary(records)


# --------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------- #

def _fmt(v: float | None, unit: str, fmt: str = ".1f") -> str:
    if v is None:
        return f"   --  {unit}"
    return f"{v:{fmt}} {unit}"


def _write_csv(records: list[PacketResult], path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["msg_id", "sent_at", "response_at", "rtt_ms",
                    "rssi_dbm", "snr_db", "error"])
        for r in records:
            w.writerow([r.msg_id, f"{r.sent_at:.3f}",
                        f"{r.response_at:.3f}" if r.response_at is not None else "",
                        f"{r.rtt_ms:.2f}" if r.rtt_ms is not None else "",
                        f"{r.rssi_dbm:.1f}" if r.rssi_dbm is not None else "",
                        f"{r.snr_db:.2f}"   if r.snr_db   is not None else "",
                        r.error or ""])


def _print_summary(records: list[PacketResult]) -> int:
    n = len(records)
    ok = sum(1 for r in records if r.succeeded)
    rate = (ok / n * 100.0) if n else 0.0
    rtts = [r.rtt_ms for r in records if r.succeeded and r.rtt_ms is not None]
    rssis = [r.rssi_dbm for r in records if r.rssi_dbm is not None]
    snrs  = [r.snr_db   for r in records if r.snr_db   is not None]

    print()
    print(f"=== Summary ===")
    print(f"  Packets sent:    {n}")
    print(f"  Succeeded:       {ok}  ({rate:.1f}%)")
    print(f"  Lost / errored:  {n - ok}")
    if rtts:
        rtts_sorted = sorted(rtts)
        print(f"  RTT p50:         {_pct(rtts_sorted, 0.50):.1f} ms")
        print(f"  RTT p95:         {_pct(rtts_sorted, 0.95):.1f} ms")
        print(f"  RTT p99:         {_pct(rtts_sorted, 0.99):.1f} ms")
        print(f"  RTT mean:        {statistics.mean(rtts):.1f} ms")
    if rssis:
        print(f"  RSSI mean:       {statistics.mean(rssis):.1f} dBm")
    if snrs:
        print(f"  SNR  mean:       {statistics.mean(snrs):.2f} dB")
    print()
    # Sprint 23b gate
    if rate < 95.0:
        print(f"GATE FAIL: success rate {rate:.1f}% < 95% threshold")
        return 1
    print(f"GATE PASS: success rate {rate:.1f}% meets >=95% threshold")
    return 0


def _pct(sorted_xs: list[float], p: float) -> float:
    if not sorted_xs:
        return float("nan")
    idx = min(len(sorted_xs) - 1, int(round(p * (len(sorted_xs) - 1))))
    return sorted_xs[idx]


# --------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------- #

def _parse_node_id(s: str | None) -> int | None:
    if s is None:
        return None
    s = s.strip()
    if s.lower() in ("", "broadcast", "^all"):
        return None
    if s.startswith(("0x", "0X")):
        return int(s, 16)
    if s.startswith("!"):
        # Meshtastic-style node ID prefix: !abcdef12 → 0xabcdef12
        return int(s[1:], 16)
    return int(s)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="OMP-over-Meshtastic bench (Sprint 23b).")
    p.add_argument("--hardware", action="store_true",
                   help="Use a real Meshtastic radio over USB-serial.")
    p.add_argument("--loopback", action="store_true",
                   help="Skip hardware; drive the in-process SyntheticLora.")
    p.add_argument("--device", default=None,
                   help="Serial device path (e.g. /dev/ttyUSB0 or COM3). "
                        "Default: meshtastic auto-detects.")
    p.add_argument("--dest-node", default=None,
                   help="Target node ID (decimal, 0xHEX, !hex). "
                        "Default: broadcast.")
    p.add_argument("--timeout", type=float, default=10.0,
                   help="Per-packet response timeout (s). Default 10.")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("ping")
    p_hello = sub.add_parser("hello")
    p_hello.add_argument("--callsign", default="TANGO-1")
    p_soak = sub.add_parser("soak")
    p_soak.add_argument("--duration", type=float, default=300.0,
                        help="Soak duration in seconds. Default 300 (5 min).")
    p_soak.add_argument("--rate", type=float, default=1.0,
                        help="Packets per second. Default 1.0.")
    p_soak.add_argument("--csv", default=None,
                        help="Write per-packet log to this CSV path.")

    args = p.parse_args(argv)
    if args.hardware and args.loopback:
        print("ERROR: --hardware and --loopback are mutually exclusive", file=sys.stderr)
        return 2
    if not args.hardware and not args.loopback:
        print("ERROR: choose --hardware or --loopback", file=sys.stderr)
        return 2

    dest_node = _parse_node_id(args.dest_node)

    if args.hardware:
        try:
            transport: Any = HardwareTransport(device=args.device)
        except ImportError as exc:
            print(f"ERROR: meshtastic library not installed: {exc}\n"
                  f"       pip install meshtastic", file=sys.stderr)
            return 3
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR: opening Meshtastic radio failed: {exc}", file=sys.stderr)
            return 3
    else:
        transport = LoopbackTransport()

    try:
        if args.cmd == "ping":
            return cmd_ping(transport, dest_node=dest_node, timeout_s=args.timeout)
        if args.cmd == "hello":
            return cmd_hello(transport, dest_node=dest_node,
                             timeout_s=args.timeout, callsign=args.callsign)
        if args.cmd == "soak":
            return cmd_soak(transport, dest_node=dest_node,
                            timeout_s=args.timeout,
                            duration_s=args.duration, rate_hz=args.rate,
                            csv_path=args.csv)
        return 2
    finally:
        transport.close()


if __name__ == "__main__":
    sys.exit(main())
