"""Tests for tools/lora-spike.py — Sprint 23b.

The hardware path can't be exercised in CI (no radio), so the tests
cover the loopback transport + the CLI argument parsing + the
PacketResult / summary aggregation. Together they verify the moving
parts that aren't the Meshtastic library itself.
"""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest


# --------------------------------------------------------------------- #
# Load tools/lora-spike.py as a module ("-" in the filename means it
# can't be imported the normal way). importlib.util gets around it.
# --------------------------------------------------------------------- #

@pytest.fixture(scope="module")
def spike():
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    path = repo_root / "tools" / "lora-spike.py"
    spec = importlib.util.spec_from_file_location("lora_spike", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    # @dataclass-decorated classes need the module to be in sys.modules
    # at class-definition time (dataclasses._is_type looks up the class's
    # __module__ in sys.modules). Register before exec_module.
    sys.modules["lora_spike"] = mod
    spec.loader.exec_module(mod)
    return mod


# --------------------------------------------------------------------- #
# LoopbackTransport — happy path
# --------------------------------------------------------------------- #

def test_loopback_ping_returns_pong(spike):
    from server.omp.codec import encode, decode
    from server.omp.opcodes import Op
    t = spike.LoopbackTransport(fake_latency_ms=0)
    pkt = encode(Op.PING, msg_id=7, payload=None)
    resp = t.send_and_wait(pkt, dest_node=None, timeout_s=1.0)
    assert "error" not in resp
    op, msg_id, payload = decode(resp["packet"])
    assert op == Op.PING
    assert msg_id == 7
    assert "server_time" in payload


def test_loopback_synthetic_rssi_snr_in_band(spike):
    from server.omp.codec import encode
    from server.omp.opcodes import Op
    t = spike.LoopbackTransport(fake_latency_ms=0,
                                fake_rssi=-50.0, fake_snr=8.0)
    pkt = encode(Op.PING, msg_id=1, payload=None)
    resp = t.send_and_wait(pkt, dest_node=None, timeout_s=1.0)
    # Loopback adds bounded jitter to the fake values.
    assert -55 < resp["rssi_dbm"] < -45
    assert 7 < resp["snr_db"] < 9


# --------------------------------------------------------------------- #
# CLI mode handlers — exercised via the run_one helper that wraps them.
# --------------------------------------------------------------------- #

def test_cmd_ping_loopback_returns_0(spike, capsys):
    t = spike.LoopbackTransport(fake_latency_ms=0)
    rc = spike.cmd_ping(t, dest_node=None, timeout_s=1.0)
    out = capsys.readouterr().out
    assert rc == 0
    assert "PASS" in out
    assert "rtt=" in out


def test_cmd_hello_loopback_returns_0(spike, capsys):
    t = spike.LoopbackTransport(fake_latency_ms=0)
    rc = spike.cmd_hello(t, dest_node=None, timeout_s=1.0, callsign="ZULU-9")
    out = capsys.readouterr().out
    assert rc == 0
    assert "PASS" in out
    assert "server_ver=3.0.0-dev0" in out


def test_cmd_soak_short_run_passes_gate(spike, capsys):
    t = spike.LoopbackTransport(fake_latency_ms=0)
    rc = spike.cmd_soak(t, dest_node=None, timeout_s=1.0,
                        duration_s=0.4, rate_hz=20, csv_path=None)
    out = capsys.readouterr().out
    assert rc == 0
    assert "GATE PASS" in out
    assert "Succeeded:" in out
    # At 20 Hz over 0.4 s we expect 8±2 packets.
    assert "100.0%" in out


# --------------------------------------------------------------------- #
# CSV output
# --------------------------------------------------------------------- #

def test_cmd_soak_writes_csv(spike, capsys):
    # Don't use pytest's tmp_path — pyproject sets --basetemp=/tmp/... which
    # doesn't exist on Windows. Use mkdtemp instead.
    import tempfile, shutil
    tmp = tempfile.mkdtemp(prefix="lora_spike_test_")
    try:
        csv_path = Path(tmp) / "soak.csv"
        t = spike.LoopbackTransport(fake_latency_ms=0)
        spike.cmd_soak(t, dest_node=None, timeout_s=1.0,
                       duration_s=0.3, rate_hz=20, csv_path=str(csv_path))
        capsys.readouterr()  # discard
        text = csv_path.read_text()
        lines = text.strip().splitlines()
        assert lines[0] == "msg_id,sent_at,response_at,rtt_ms,rssi_dbm,snr_db,error"
        assert len(lines) >= 2
        for row in lines[1:]:
            assert row.count(",") == 6
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# --------------------------------------------------------------------- #
# Node-ID parsing — covers decimal / 0xHEX / !hex / broadcast forms.
# --------------------------------------------------------------------- #

def test_parse_node_id_forms(spike):
    p = spike._parse_node_id
    assert p(None) is None
    assert p("") is None
    assert p("broadcast") is None
    assert p("^all") is None
    assert p("0xdeadbeef") == 0xDEADBEEF
    assert p("0XDEADBEEF") == 0xDEADBEEF
    assert p("!cafe1234") == 0xCAFE1234
    assert p("12345") == 12345


# --------------------------------------------------------------------- #
# CLI top-level — argument validation
# --------------------------------------------------------------------- #

def test_cli_rejects_both_transports(spike, capsys):
    rc = spike.main(["--hardware", "--loopback", "ping"])
    err = capsys.readouterr().err
    assert rc == 2
    assert "mutually exclusive" in err


def test_cli_rejects_neither_transport(spike, capsys):
    rc = spike.main(["ping"])
    err = capsys.readouterr().err
    assert rc == 2
    assert "--hardware or --loopback" in err


def test_cli_loopback_ping_succeeds(spike, capsys):
    rc = spike.main(["--loopback", "ping"])
    assert rc == 0
    assert "PASS" in capsys.readouterr().out


def test_cli_loopback_soak_short_run(spike, capsys):
    rc = spike.main(["--loopback", "soak",
                     "--duration", "0.3", "--rate", "20"])
    assert rc == 0
    assert "GATE PASS" in capsys.readouterr().out


# --------------------------------------------------------------------- #
# Summary stats — empty + populated
# --------------------------------------------------------------------- #

def test_summary_zero_packets_returns_fail(spike, capsys):
    rc = spike._print_summary([])
    out = capsys.readouterr().out
    assert rc == 1
    assert "GATE FAIL" in out


def test_summary_all_fail_returns_fail(spike, capsys):
    records = [
        spike.PacketResult(msg_id=i, sent_at=0.0, error="timeout")
        for i in range(5)
    ]
    rc = spike._print_summary(records)
    out = capsys.readouterr().out
    assert rc == 1
    assert "GATE FAIL" in out
    assert "0.0%" in out
