"""Mesh transport simulator — proxy that injects LoRa-flavoured latency
and packet loss between an OmpTransport client and the real /omp
endpoint.

Sprint 2: standalone process that listens on a port, forwards POST /omp
to an upstream OVERSEER backend, and applies the configured impairment
to both the request and the response. Stops at the simulator boundary
— it does NOT model multi-hop mesh routing, RSSI vs distance, or
Meshtastic framing. Those land in Sprint 12 with real hardware.

Usage::

    python tools/sim-mesh.py                 # localhost:6101 → localhost:6100
    python tools/sim-mesh.py --latency-ms 500 --loss 0.02 --jitter-ms 300
    python tools/sim-mesh.py --upstream http://opi5.local:6100/omp

Smoke test:

    python -m server &        # start backend on :6100
    python tools/sim-mesh.py & # start simulator on :6101
    curl -X POST -H 'Content-Type: application/octet-stream' \
         --data-binary @sample-ping.bin http://localhost:6101/omp \
         | hexdump -C | head

LoRa SF preset suggestions (one-way, before jitter):

    SF7   ~ 50 ms, loss 0.5%
    SF9   ~ 200 ms, loss 1%
    SF12  ~ 1500 ms, loss 3%

A future revision will model bandwidth ceilings (queueing) for sustained
streams; the gate's roundtrip test only needs latency + loss.
"""

from __future__ import annotations

import argparse
import logging
import random
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Tuple

log = logging.getLogger("sim-mesh")


class SimConfig:
    """Holds the knobs. Mutable so a future control endpoint can poke them."""
    def __init__(self, *, latency_ms: int, jitter_ms: int, loss: float,
                 upstream: str, log_each: bool):
        self.latency_ms = latency_ms
        self.jitter_ms  = jitter_ms
        self.loss       = loss          # 0.0 .. 1.0
        self.upstream   = upstream
        self.log_each   = log_each


class _Handler(BaseHTTPRequestHandler):
    cfg: "SimConfig"   # set on the class by main()

    def log_message(self, fmt, *args):  # quieter default; we log ourselves
        if self.cfg.log_each:
            log.info("%s", fmt % args)

    def do_POST(self):
        if self.path != "/omp":
            self._send(404, b"only /omp is proxied")
            return

        n = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(n) if n > 0 else b""

        # Inject impairment on the inbound packet.
        if simulate_drop(self.cfg, "req"):
            log.warning("DROP req  %dB (loss %.3f)", len(body), self.cfg.loss)
            self._send(504, b"sim-mesh: simulated request drop")
            return
        simulate_delay(self.cfg)

        try:
            resp_bytes = _forward(self.cfg.upstream, body, timeout=30)
        except urllib.error.URLError as e:
            log.warning("UPSTREAM ERR  %s", e)
            self._send(502, f"sim-mesh: upstream unreachable: {e}".encode())
            return

        # Inject impairment on the outbound response.
        if simulate_drop(self.cfg, "resp"):
            log.warning("DROP resp %dB", len(resp_bytes))
            self._send(504, b"sim-mesh: simulated response drop")
            return
        simulate_delay(self.cfg)

        self._send(200, resp_bytes, content_type="application/octet-stream")
        if self.cfg.log_each:
            log.info("FWD ok   req=%dB resp=%dB", len(body), len(resp_bytes))

    def _send(self, status: int, body: bytes, content_type: str = "text/plain"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


def simulate_drop(cfg: SimConfig, leg: str) -> bool:
    """Coin-flip per-leg packet drop based on cfg.loss."""
    if cfg.loss <= 0:
        return False
    return random.random() < cfg.loss


def simulate_delay(cfg: SimConfig) -> None:
    """Sleep for the configured latency + uniform jitter."""
    extra = random.uniform(0, cfg.jitter_ms) if cfg.jitter_ms > 0 else 0
    sleep_s = (cfg.latency_ms + extra) / 1000.0
    if sleep_s > 0:
        time.sleep(sleep_s)


def _forward(url: str, body: bytes, *, timeout: float) -> bytes:
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Content-Type": "application/octet-stream"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def serve(cfg: SimConfig, host: str, port: int) -> Tuple[ThreadingHTTPServer, "object"]:
    """Start the sim-mesh HTTP server. Returns (httpd, thread).
    Caller is responsible for httpd.shutdown() during teardown."""
    HandlerClass = type("_BoundHandler", (_Handler,), {"cfg": cfg})
    httpd = ThreadingHTTPServer((host, port), HandlerClass)
    import threading
    th = threading.Thread(target=httpd.serve_forever, daemon=True, name="sim-mesh")
    th.start()
    log.info("sim-mesh listening http://%s:%d  →  %s  (latency %dms ±%d, loss %.3f)",
             host, port, cfg.upstream, cfg.latency_ms, cfg.jitter_ms, cfg.loss)
    return httpd, th


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=6101)
    ap.add_argument("--upstream", default="http://localhost:6100/omp")
    ap.add_argument("--latency-ms", type=int, default=200,
                    help="One-way base latency in ms (per leg)")
    ap.add_argument("--jitter-ms", type=int, default=50,
                    help="Random extra latency 0..jitter (per leg)")
    ap.add_argument("--loss", type=float, default=0.0,
                    help="Per-leg packet drop probability 0..1")
    ap.add_argument("--log-each", action="store_true",
                    help="Log every forwarded packet (chatty)")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="[sim-mesh] %(message)s")
    cfg = SimConfig(
        latency_ms=args.latency_ms,
        jitter_ms=args.jitter_ms,
        loss=args.loss,
        upstream=args.upstream,
        log_each=args.log_each,
    )
    httpd, _ = serve(cfg, args.host, args.port)
    try:
        # Block on the server thread.
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        log.info("sim-mesh stopping")
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
