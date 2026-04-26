"""Integration test: OMP request through tools/sim-mesh.py reaches the
backend's /omp endpoint and returns the right response.

Spins up the real legacy Flask server (server.app:app) on a free port,
the sim-mesh proxy on another free port, sends an OMP PING, asserts
the PONG round-trips with the same msg_id and a server_time.
"""

from __future__ import annotations

import importlib.util
import socket
import threading
import time
import urllib.request
from pathlib import Path

import pytest

from server.app import app as flask_app
from server.omp.codec import decode, encode
from server.omp.opcodes import Op


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def _run_flask(port: int):
    """Start the Flask dev server in a background thread."""
    flask_app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False, threaded=True)


def _wait_for_port(host: str, port: int, timeout_s: float = 5.0):
    """Probe TCP — returns when something binds. Doesn't care what it
    answers; we send real OMP packets afterwards which exercise the app."""
    start = time.monotonic()
    while time.monotonic() - start < timeout_s:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return
        except OSError:
            time.sleep(0.05)
    raise RuntimeError(f"never came up: {host}:{port}")


def _import_sim_mesh():
    spec = importlib.util.spec_from_file_location(
        "_sim_mesh",
        Path(__file__).resolve().parents[2] / "tools" / "sim-mesh.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


@pytest.fixture(scope="module")
def stack():
    sim = _import_sim_mesh()
    backend_port = _free_port()
    sim_port     = _free_port()

    fl_thread = threading.Thread(
        target=_run_flask, args=(backend_port,),
        daemon=True, name="flask-test",
    )
    fl_thread.start()
    # Flask raises 404 on /; ping a real endpoint.
    _wait_for_port("127.0.0.1", backend_port)

    cfg = sim.SimConfig(
        latency_ms=10, jitter_ms=0, loss=0.0,
        upstream=f"http://127.0.0.1:{backend_port}/omp",
        log_each=False,
    )
    httpd, _ = sim.serve(cfg, "127.0.0.1", sim_port)

    yield {"backend_port": backend_port, "sim_port": sim_port, "cfg": cfg}

    httpd.shutdown()


def test_ping_roundtrip_through_sim_mesh(stack):
    pkt = encode(Op.PING, 7, {})
    req = urllib.request.Request(
        f"http://127.0.0.1:{stack['sim_port']}/omp",
        data=pkt, method="POST",
        headers={"Content-Type": "application/octet-stream"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        assert resp.status == 200
        body = resp.read()
    op, msg_id, payload = decode(body)
    assert op == Op.PING
    assert msg_id == 7
    assert "server_time" in payload


def test_inbox_roundtrip_through_sim_mesh(stack):
    pkt = encode(Op.INBOX_HEADERS, 0xABCD, {})
    req = urllib.request.Request(
        f"http://127.0.0.1:{stack['sim_port']}/omp",
        data=pkt, method="POST",
        headers={"Content-Type": "application/octet-stream"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        body = resp.read()
    op, msg_id, payload = decode(body)
    assert op == Op.INBOX_HEADERS
    assert msg_id == 0xABCD
    assert isinstance(payload, list) and len(payload) == 3


def test_loss_eventually_drops(stack):
    """With loss=1.0 the proxy must drop every request (504 sim-drop)."""
    sim = _import_sim_mesh()
    saved_loss = stack["cfg"].loss
    stack["cfg"].loss = 1.0
    try:
        pkt = encode(Op.PING, 1, {})
        req = urllib.request.Request(
            f"http://127.0.0.1:{stack['sim_port']}/omp",
            data=pkt, method="POST",
            headers={"Content-Type": "application/octet-stream"},
        )
        with pytest.raises(urllib.error.HTTPError) as ei:
            urllib.request.urlopen(req, timeout=5)
        assert ei.value.code == 504
    finally:
        stack["cfg"].loss = saved_loss
