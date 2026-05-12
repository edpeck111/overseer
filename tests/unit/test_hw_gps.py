"""Tests for the Sprint 22 GPS adapters in server/modules/navigation.py.

Three backends:
  - SyntheticGps  : deterministic walk, used as fallback
  - GpsdSource    : parses gpsd JSON over TCP
  - SerialNmeaSource : parses NMEA 0183 ($GPGGA / $GPRMC)
"""
from __future__ import annotations

import json
import pytest

from server.modules import navigation as N


# --------------------------------------------------------------------- #
# Synthetic
# --------------------------------------------------------------------- #

def test_synthetic_returns_valid_fix():
    src = N.SyntheticGps(seed=42)
    fix = src.read_fix()
    assert fix is not None
    assert -90 <= fix.lat <= 90
    assert -180 <= fix.lon <= 180
    assert fix.fix_type in ("2d", "3d")
    assert fix.sats >= 0


def test_synthetic_is_deterministic_with_seed():
    a = N.SyntheticGps(seed=123)
    b = N.SyntheticGps(seed=123)
    for _ in range(20):
        fa = a.read_fix()
        fb = b.read_fix()
        assert fa is not None and fb is not None
        assert fa.lat == fb.lat
        assert fa.lon == fb.lon


def test_synthetic_stays_within_radius():
    src = N.SyntheticGps(centre_lat=53.4808, centre_lon=-2.2426,
                         radius_km=0.5, seed=7)
    for _ in range(200):
        fix = src.read_fix()
        assert fix is not None
        d = N.haversine_km(fix.lat, fix.lon, src.centre_lat, src.centre_lon)
        # Walk may overshoot slightly before the next snap-back; allow 10 %.
        assert d <= src.radius_km * 1.1


def test_fix_to_wire_shape():
    f = N.Fix(lat=53.5, lon=-2.2, alt_m=80.0, accuracy_m=4.0,
              sats=10, fix_type="3d", at=1_700_000_000.0)
    wire = f.to_wire()
    assert set(wire) == {"lat", "lon", "alt_m", "accuracy_m",
                         "sats", "fix_type", "at"}
    assert wire["lat"] == 53.5
    assert wire["fix_type"] == "3d"


# --------------------------------------------------------------------- #
# gpsd
# --------------------------------------------------------------------- #

class _FakeSocket:
    """In-memory drop-in for socket.socket — feeds bytes via push()."""

    def __init__(self, *, raise_on_recv: type[Exception] | None = None):
        self._inbox: list[bytes] = []
        self.sent: list[bytes] = []
        self._raise = raise_on_recv
        self.closed = False

    def push(self, data: bytes) -> None:
        self._inbox.append(data)

    def sendall(self, data: bytes) -> None:
        self.sent.append(data)

    def setblocking(self, _flag: bool) -> None:
        pass

    def recv(self, _n: int) -> bytes:
        if self._raise is not None:
            raise self._raise("simulated")
        if not self._inbox:
            raise BlockingIOError()
        return self._inbox.pop(0)

    def close(self) -> None:
        self.closed = True


def _gpsd_with_fake(monkeypatch) -> tuple[N.GpsdSource, _FakeSocket]:
    """Construct a GpsdSource backed by a fake socket via create_connection."""
    fake = _FakeSocket()
    import socket as _socket
    monkeypatch.setattr(_socket, "create_connection",
                        lambda *_a, **_kw: fake)
    src = N.GpsdSource()
    assert src._fallback is None, f"unexpected fallback: {src.last_error}"
    return src, fake


def test_gpsd_connect_failure_falls_back(monkeypatch):
    import socket as _socket
    def _boom(*_a, **_kw):
        raise ConnectionRefusedError("gpsd not running")
    monkeypatch.setattr(_socket, "create_connection", _boom)
    src = N.GpsdSource()
    assert src._fallback is not None
    assert "connect" in (src.last_error or "")
    # read_fix() still works (via synthetic fallback).
    assert src.read_fix() is not None


def test_gpsd_watch_command_sent_on_connect(monkeypatch):
    src, fake = _gpsd_with_fake(monkeypatch)
    assert any(b'?WATCH' in m and b'json' in m for m in fake.sent)


def test_gpsd_parses_tpv_fix(monkeypatch):
    src, fake = _gpsd_with_fake(monkeypatch)
    tpv = {
        "class": "TPV", "mode": 3,
        "lat": 53.4808, "lon": -2.2426,
        "altMSL": 78.5, "eph": 4.2, "nSat": 11,
    }
    fake.push((json.dumps(tpv) + "\n").encode("utf-8"))
    fix = src.read_fix()
    assert fix is not None
    assert fix.lat == pytest.approx(53.4808)
    assert fix.lon == pytest.approx(-2.2426)
    assert fix.alt_m == pytest.approx(78.5)
    assert fix.sats == 11
    assert fix.fix_type == "3d"


def test_gpsd_no_fix_mode_is_ignored(monkeypatch):
    src, fake = _gpsd_with_fake(monkeypatch)
    fake.push(b'{"class":"TPV","mode":1}\n')
    assert src.read_fix() is None


def test_gpsd_unrelated_class_is_ignored(monkeypatch):
    src, fake = _gpsd_with_fake(monkeypatch)
    fake.push(b'{"class":"SKY","satellites":[]}\n')
    assert src.read_fix() is None


def test_gpsd_bad_json_does_not_crash(monkeypatch):
    src, fake = _gpsd_with_fake(monkeypatch)
    fake.push(b'this is not json\n')
    # And a valid one after the garbage:
    fake.push(b'{"class":"TPV","mode":2,"lat":1.0,"lon":2.0}\n')
    fix = src.read_fix()
    assert fix is not None
    assert fix.lat == 1.0


def test_gpsd_multi_line_buffer_handled(monkeypatch):
    src, fake = _gpsd_with_fake(monkeypatch)
    fake.push(b'{"class":"TPV","mode":3,"lat":1.0,"lon":2.0}\n'
              b'{"class":"TPV","mode":3,"lat":3.0,"lon":4.0}\n')
    fix = src.read_fix()
    assert fix is not None
    # Newest fix wins.
    assert fix.lat == 3.0


def test_gpsd_partial_line_buffered_until_complete(monkeypatch):
    src, fake = _gpsd_with_fake(monkeypatch)
    fake.push(b'{"class":"TPV","mode":3,"lat":')
    src.read_fix()  # drain partial
    fake.push(b'5.0,"lon":6.0}\n')
    fix = src.read_fix()
    assert fix is not None
    assert fix.lat == 5.0
    assert fix.lon == 6.0


# --------------------------------------------------------------------- #
# Serial NMEA
# --------------------------------------------------------------------- #

class _FakeSerial:
    def __init__(self) -> None:
        self._buf = b""

    def feed(self, s: bytes) -> None:
        self._buf += s

    def read(self, _n: int) -> bytes:
        out, self._buf = self._buf, b""
        return out


def _serial_with_fake() -> N.SerialNmeaSource:
    src = N.SerialNmeaSource(device="/dev/null")
    # Even if pyserial is installed, /dev/null open will likely fail or
    # produce nothing — either way we force the test wiring.
    src._fallback = None
    src.last_error = None
    src._port = _FakeSerial()
    return src


def test_serial_falls_back_when_pyserial_missing():
    """Most CI runs don't have pyserial; the adapter must fall back."""
    src = N.SerialNmeaSource(device="/dev/does-not-exist")
    # Either pyserial isn't installed (ImportError) or open() failed.
    assert src._fallback is not None
    assert src.read_fix() is not None


def test_nmea_dm_to_deg_manchester():
    """53°28.848'N, 002°14.556'W → ≈ 53.4808, -2.2426."""
    lat = N._nmea_dm_to_deg("5328.848", "N")
    lon = N._nmea_dm_to_deg("00214.556", "W")
    assert lat == pytest.approx(53.4808, abs=1e-3)
    assert lon == pytest.approx(-2.2426, abs=1e-3)


def test_nmea_dm_to_deg_southern_hemisphere():
    lat = N._nmea_dm_to_deg("3351.65", "S")
    assert lat == pytest.approx(-33.860833, abs=1e-4)


def test_nmea_dm_to_deg_empty_returns_none():
    assert N._nmea_dm_to_deg("", "N") is None
    assert N._nmea_dm_to_deg("5328.848", "") is None


def test_serial_parses_gga():
    src = _serial_with_fake()
    # Valid GGA from Manchester centre, quality=1, 9 sats, alt 75 m.
    line = b"$GPGGA,123519,5328.848,N,00214.556,W,1,09,1.0,75.0,M,46.9,M,,*4F\n"
    src._port.feed(line)  # type: ignore[union-attr]
    fix = src.read_fix()
    assert fix is not None
    assert fix.lat == pytest.approx(53.4808, abs=1e-3)
    assert fix.lon == pytest.approx(-2.2426, abs=1e-3)
    assert fix.alt_m == pytest.approx(75.0)
    assert fix.sats == 9
    assert fix.fix_type == "3d"


def test_serial_parses_rmc():
    src = _serial_with_fake()
    line = b"$GPRMC,123519,A,5328.848,N,00214.556,W,022.4,084.4,230394,003.1,W*6A\n"
    src._port.feed(line)  # type: ignore[union-attr]
    fix = src.read_fix()
    assert fix is not None
    assert fix.lat == pytest.approx(53.4808, abs=1e-3)
    assert fix.lon == pytest.approx(-2.2426, abs=1e-3)
    assert fix.fix_type == "2d"


def test_serial_invalid_rmc_status_ignored():
    """RMC with status 'V' (void) must not produce a fix."""
    src = _serial_with_fake()
    line = b"$GPRMC,123519,V,5328.848,N,00214.556,W,022.4,084.4,230394,003.1,W*6A\n"
    src._port.feed(line)  # type: ignore[union-attr]
    assert src.read_fix() is None


def test_serial_gga_quality_zero_ignored():
    src = _serial_with_fake()
    line = b"$GPGGA,123519,5328.848,N,00214.556,W,0,00,,,M,,M,,*4F\n"
    src._port.feed(line)  # type: ignore[union-attr]
    assert src.read_fix() is None


def test_serial_garbage_then_valid():
    src = _serial_with_fake()
    src._port.feed(b"\x00\x00not nmea\n")  # type: ignore[union-attr]
    src._port.feed(b"$GPGGA,123519,5328.848,N,00214.556,W,1,09,1.0,75.0,M,,,,*4F\n")  # type: ignore[union-attr]
    fix = src.read_fix()
    assert fix is not None
    assert fix.lat == pytest.approx(53.4808, abs=1e-3)


# --------------------------------------------------------------------- #
# Module-level wiring & HTTP endpoint
# --------------------------------------------------------------------- #

def test_gps_fix_returns_wire_dict(monkeypatch):
    monkeypatch.delenv("OVERSEER_GPS", raising=False)
    N.reset_gps_for_tests(N.SyntheticGps(seed=1))
    wire = N.gps_fix()
    assert wire is not None
    assert {"lat", "lon", "fix_type", "at"} <= set(wire.keys())
    N.reset_gps_for_tests(None)


def test_gps_fix_returns_none_when_source_unfixed():
    class _NoFix:
        def read_fix(self): return None
    N.reset_gps_for_tests(_NoFix())
    assert N.gps_fix() is None
    N.reset_gps_for_tests(None)


def test_gps_fix_route_204_when_no_fix():
    from server.app import app
    class _NoFix:
        def read_fix(self): return None
    N.reset_gps_for_tests(_NoFix())
    client = app.test_client()
    resp = client.get("/api/n/gps/fix")
    assert resp.status_code == 204
    N.reset_gps_for_tests(None)


def test_gps_fix_route_200_when_fixed():
    from server.app import app
    N.reset_gps_for_tests(N.SyntheticGps(seed=2))
    client = app.test_client()
    resp = client.get("/api/n/gps/fix")
    assert resp.status_code == 200
    body = resp.get_json()
    assert "lat" in body and "lon" in body
    N.reset_gps_for_tests(None)


def test_selector_routes_to_gpsd_when_env_set(monkeypatch):
    """OVERSEER_GPS=gpsd should produce a GpsdSource (which falls back to
    synthetic when no daemon is listening)."""
    monkeypatch.setenv("OVERSEER_GPS", "gpsd")
    N.reset_gps_for_tests(None)
    src = N._gps()
    assert isinstance(src, N.GpsdSource)
    N.reset_gps_for_tests(None)


def test_selector_routes_to_serial_when_env_set(monkeypatch):
    monkeypatch.setenv("OVERSEER_GPS", "serial")
    monkeypatch.setenv("OVERSEER_GPS_DEVICE", "/dev/does-not-exist")
    N.reset_gps_for_tests(None)
    src = N._gps()
    assert isinstance(src, N.SerialNmeaSource)
    N.reset_gps_for_tests(None)


def test_selector_default_synthetic(monkeypatch):
    monkeypatch.delenv("OVERSEER_GPS", raising=False)
    N.reset_gps_for_tests(None)
    src = N._gps()
    assert isinstance(src, N.SyntheticGps)
    N.reset_gps_for_tests(None)
