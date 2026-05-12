"""NAVIGATION module — waypoints, routing, elevation, LOS, terrain.

Sprint 8 ships everything synthetic-first per ADR-0013. Each external
data source has an env-flag swap. Synthetic implementations return
deterministic results so tests are reproducible and the gate doesn't
depend on hardware/data availability.

Sprint 18: waypoints and overlays now persisted to SQLite.
"""

from __future__ import annotations

import json
import math
import os
import time
from typing import Iterable

from server.db import get_db, reset_tables

# Earth's mean radius (km) for haversine distance
_R_KM = 6371.0


# --------------------------------------------------------------------- #
# Waypoints — SQLite-backed (migration 001_baseline)
# --------------------------------------------------------------------- #

def reset_for_tests() -> None:
    reset_tables("waypoints", "map_overlay")


def waypoint_new(name: str, cat: str, lat: float, lon: float, **opts) -> int:
    db = get_db()
    elev     = opts.get("elev")
    notes    = opts.get("notes", "")
    verified = opts.get("verified", False)
    lv_at    = int(time.time()) if verified else None
    cur = db.execute(
        "INSERT INTO waypoints(name, cat, lat, lon, elev, notes, last_verified_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (name, cat, float(lat), float(lon), elev, notes, lv_at),
    )
    db.commit()
    return cur.lastrowid


def waypoint_update(wid: int, **fields) -> bool:
    db = get_db()
    row = db.execute("SELECT id FROM waypoints WHERE id=?", (wid,)).fetchone()
    if row is None:
        return False

    allowed = {"name", "cat", "lat", "lon", "elev", "notes", "color", "verified"}
    sets, vals = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k == "verified":
            sets.append("last_verified_at=?")
            vals.append(int(time.time()) if v else None)
        else:
            sets.append(f"{k}=?")
            vals.append(v)
    if not sets:
        return True
    vals.append(wid)
    db.execute(f"UPDATE waypoints SET {', '.join(sets)} WHERE id=?", vals)
    db.commit()
    return True


def waypoint_delete(wid: int) -> bool:
    db = get_db()
    cur = db.execute("DELETE FROM waypoints WHERE id=?", (wid,))
    db.commit()
    return cur.rowcount > 0


def waypoints_list() -> list[dict]:
    db = get_db()
    rows = db.execute("SELECT * FROM waypoints ORDER BY id").fetchall()
    return [_wp_to_dict(r) for r in rows]


def waypoint_fetch(wid: int) -> dict | None:
    db = get_db()
    row = db.execute("SELECT * FROM waypoints WHERE id=?", (wid,)).fetchone()
    return _wp_to_dict(row) if row else None


def _wp_to_dict(row) -> dict:
    return {
        "id":         row["id"],
        "name":       row["name"],
        "cat":        row["cat"],
        "lat":        row["lat"],
        "lon":        row["lon"],
        "elev":       row["elev"],
        "notes":      row["notes"] or "",
        "verified":   row["last_verified_at"] is not None,
        "created_at": row["created_at"],
    }


# --------------------------------------------------------------------- #
# Geometry primitives (pure functions — used by shell parity tests too)
# --------------------------------------------------------------------- #

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    dp = p2 - p1
    a = math.sin(dp/2)**2 + math.cos(p1) * math.cos(p2) * math.sin(dl/2)**2
    return 2 * _R_KM * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial compass bearing from p1 to p2 in degrees."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def nearest(lat: float, lon: float, max_results: int = 5) -> list[dict]:
    """Top-N closest waypoints to (lat, lon) with bearing + distance."""
    db = get_db()
    rows = db.execute("SELECT * FROM waypoints").fetchall()
    hits = []
    for row in rows:
        d_km = haversine_km(lat, lon, row["lat"], row["lon"])
        b = bearing_deg(lat, lon, row["lat"], row["lon"])
        hits.append({
            "id": row["id"], "name": row["name"], "cat": row["cat"],
            "bearing_deg": round(b, 1), "dist_m": round(d_km * 1000),
        })
    hits.sort(key=lambda h: h["dist_m"])
    return hits[:max_results]


# --------------------------------------------------------------------- #
# Synthetic elevation, routing, LOS — all gated by env flags (ADR-0013)
# --------------------------------------------------------------------- #

def elevation_at(lat: float, lon: float) -> float:
    """Synthetic deterministic elevation. Real SRTM swaps via
    OVERSEER_NAV_ELEVATION=srtm."""
    flavour = os.environ.get("OVERSEER_NAV_ELEVATION", "synthetic")
    if flavour == "synthetic":
        base = 200 + 600 * (math.sin(lat * 1.3) + 1)
        ridges = 400 * math.sin(lon * 4.7)
        peaks  = 500 * math.cos(lat * 3.1) * math.sin(lon * 2.3)
        return max(0.0, base + ridges + peaks)
    raise NotImplementedError(f"OVERSEER_NAV_ELEVATION={flavour} — pending swap-in")


def elevation_profile(points: list[tuple[float, float]]) -> list[float]:
    return [elevation_at(lat, lon) for lat, lon in points]


def route(from_lat: float, from_lon: float, to_lat: float, to_lon: float,
          mode: str = "foot") -> dict:
    """Synthetic great-circle route. Real GraphHopper/Valhalla swap
    via OVERSEER_NAV_ROUTING."""
    flavour = os.environ.get("OVERSEER_NAV_ROUTING", "synthetic")
    if flavour == "synthetic":
        d_km = haversine_km(from_lat, from_lon, to_lat, to_lon)
        multipliers = {"foot": 1.4, "bike": 1.1, "car": 1.05}
        m = multipliers.get(mode, 1.4)
        steps = 16
        geometry = [
            (from_lat + (to_lat - from_lat) * (i / steps),
             from_lon + (to_lon - from_lon) * (i / steps))
            for i in range(steps + 1)
        ]
        speed_kmh = {"foot": 5, "bike": 20, "car": 50}.get(mode, 5)
        dur_s = int(d_km * m / max(0.1, speed_kmh) * 3600)
        return {
            "geometry": geometry, "dist_m": round(d_km * m * 1000),
            "dur_s": dur_s, "mode": mode, "synthetic": True,
        }
    raise NotImplementedError(f"OVERSEER_NAV_ROUTING={flavour} — pending swap-in")


def line_of_sight(lat1: float, lon1: float, lat2: float, lon2: float,
                  freq_mhz: float = 868.0) -> dict:
    """Fresnel-zone line-of-sight check."""
    SAMPLES = 64
    h_a = elevation_at(lat1, lon1)
    h_b = elevation_at(lat2, lon2)
    d_total_km = haversine_km(lat1, lon1, lat2, lon2)
    if d_total_km == 0:
        return {"has_los": True, "fresnel_clear": True, "obstacles": []}

    f1_mid = 547.7 * math.sqrt(d_total_km / freq_mhz)
    has_los = True
    fresnel_clear = True
    obstacles = []
    for i in range(1, SAMPLES):
        t = i / SAMPLES
        plat = lat1 + (lat2 - lat1) * t
        plon = lon1 + (lon2 - lon1) * t
        h = elevation_at(plat, plon)
        line_h = h_a + (h_b - h_a) * t
        clearance = line_h - h
        if clearance < 0:
            has_los = False
            obstacles.append({"frac": round(t, 2), "elev": round(h, 1),
                              "line_h": round(line_h, 1)})
        elif clearance < f1_mid:
            fresnel_clear = False

    return {
        "has_los": has_los,
        "fresnel_clear": fresnel_clear,
        "fresnel_zone_m": round(f1_mid, 1),
        "freq_mhz": freq_mhz,
        "obstacles": obstacles[:5],
    }


# --------------------------------------------------------------------- #
# Synthetic terrain bitmap for sextant text-map (Sprint 8a)
# --------------------------------------------------------------------- #

def terrain_bitmap(west: float, south: float, east: float, north: float,
                   *, width: int = 64, height: int = 48,
                   threshold_m: float = 600.0) -> list[list[int]]:
    bm = [[0] * width for _ in range(height)]
    for y in range(height):
        for x in range(width):
            lat = north - (north - south) * (y / max(1, height - 1))
            lon = west  + (east  - west)  * (x / max(1, width - 1))
            e = elevation_at(lat, lon)
            if e > threshold_m: bm[y][x] = 1
    for y in range(height):
        cx = int(width * 0.3 + width * 0.4 * (y / height) + 5 * math.sin(y * 0.4))
        for dx in range(-1, 2):
            x = cx + dx
            if 0 <= x < width: bm[y][x] = 1
    return bm


# --------------------------------------------------------------------- #
# Overlays — SQLite-backed (migration 013_overlays)
# --------------------------------------------------------------------- #

def overlay_new(name: str, kind: str, geo_json: dict, color: str = "#ffb849") -> int:
    db = get_db()
    # map_overlay.kind CHECK: zone|route|line|marker — remap "polyline" → "line"
    kind_map = {"polyline": "line", "polygon": "zone", "circle": "zone"}
    db_kind = kind_map.get(kind, kind)
    cur = db.execute(
        "INSERT INTO map_overlay(name, kind, geo_json, color) VALUES (?, ?, ?, ?)",
        (name, db_kind, json.dumps(geo_json), color),
    )
    db.commit()
    return cur.lastrowid


def overlay_delete(oid: int) -> bool:
    db = get_db()
    cur = db.execute("DELETE FROM map_overlay WHERE id=?", (oid,))
    db.commit()
    return cur.rowcount > 0


def overlays_list() -> list[dict]:
    db = get_db()
    rows = db.execute("SELECT * FROM map_overlay ORDER BY id").fetchall()
    return [
        {"id": r["id"], "name": r["name"], "kind": r["kind"],
         "geo_json": json.loads(r["geo_json"]), "color": r["color"]}
        for r in rows
    ]


# --------------------------------------------------------------------- #
# GPS sources — Sprint 22.
#
# A GPS source produces ``Fix`` instances on demand. Three backends:
#
#   synthetic  — deterministic slow walk; default, no hardware required
#   gpsd       — JSON over TCP localhost:2947 (the standard Linux GPS daemon)
#   serial     — direct NMEA 0183 over a serial UART (USB GPS dongles)
#
# Selection is via ``hw.gps_backend()`` (env ``OVERSEER_GPS``). Real
# backends lazy-import their I/O dependency; on bring-up failure they
# attach a synthetic fallback and warn once. ``read_fix()`` is
# non-blocking: it returns the most recent cached fix, or ``None`` if no
# fix has been acquired yet.
# --------------------------------------------------------------------- #

from dataclasses import dataclass as _dataclass, field as _field


@_dataclass
class Fix:
    """A single GPS position fix."""
    lat: float
    lon: float
    alt_m: float | None = None
    accuracy_m: float | None = None
    sats: int = 0
    fix_type: str = "2d"       # "no_fix" | "2d" | "3d"
    at: float = 0.0

    def to_wire(self) -> dict:
        return {
            "lat": round(self.lat, 6),
            "lon": round(self.lon, 6),
            "alt_m": None if self.alt_m is None else round(self.alt_m, 1),
            "accuracy_m": None if self.accuracy_m is None else round(self.accuracy_m, 1),
            "sats": int(self.sats),
            "fix_type": self.fix_type,
            "at": self.at,
        }


@_dataclass
class SyntheticGps:
    """Deterministic GPS walk for tests and headless dev.

    Walks a small random distance per call around a configurable centre
    (defaults to Manchester, UK). Seed for reproducibility.
    """

    centre_lat: float = 53.4808
    centre_lon: float = -2.2426
    radius_km: float = 0.5
    seed: int | None = 42

    _rng: 'object' = _field(init=False, repr=False)
    _lat: float = _field(init=False, repr=False)
    _lon: float = _field(init=False, repr=False)

    def __post_init__(self) -> None:
        import random as _random
        self._rng = _random.Random(self.seed if self.seed is not None else time.time_ns())
        self._lat = self.centre_lat
        self._lon = self.centre_lon

    def read_fix(self) -> Fix | None:
        # km → deg conversion at the current latitude.
        step_km = self._rng.uniform(0, 0.01)  # ≤ 10 m per call
        bearing = self._rng.uniform(0, 2 * math.pi)
        dlat = (step_km / 110.574) * math.cos(bearing)
        dlon = (step_km / (111.320 * math.cos(math.radians(self._lat)))) * math.sin(bearing)
        self._lat += dlat
        self._lon += dlon
        # Snap back if we drift outside the radius.
        if haversine_km(self._lat, self._lon, self.centre_lat, self.centre_lon) > self.radius_km:
            self._lat, self._lon = self.centre_lat, self.centre_lon
        return Fix(
            lat=self._lat, lon=self._lon,
            alt_m=80.0 + self._rng.uniform(-2.0, 2.0),
            accuracy_m=self._rng.uniform(3.0, 7.0),
            sats=self._rng.randint(8, 12),
            fix_type="3d",
            at=time.time(),
        )


@_dataclass
class GpsdSource:
    """Reads fixes from gpsd via the standard TCP JSON protocol.

    Connects to host:port (default localhost:2947), issues
    ``?WATCH={"enable":true,"json":true}``, and on each ``read_fix()``
    drains any pending TPV objects, returning the newest as a Fix. If
    no TPV has arrived, returns the cached last fix (or None).
    """

    host: str = "127.0.0.1"
    port: int = 2947
    connect_timeout: float = 1.0

    _sock: 'object | None' = _field(default=None, init=False, repr=False)
    _buf: bytes = _field(default=b"", init=False, repr=False)
    _last: 'Fix | None' = _field(default=None, init=False, repr=False)
    _fallback: 'SyntheticGps | None' = _field(default=None, init=False, repr=False)
    last_error: str | None = _field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        try:
            import socket as _socket
            s = _socket.create_connection((self.host, self.port), timeout=self.connect_timeout)
            s.sendall(b'?WATCH={"enable":true,"json":true};\n')
            s.setblocking(False)
            self._sock = s
        except Exception as exc:  # noqa: BLE001
            self._attach_fallback(f"gpsd connect {self.host}:{self.port} failed: {exc}")

    def _attach_fallback(self, reason: str) -> None:
        self.last_error = reason
        import warnings
        warnings.warn(f"OVERSEER GPS: {reason}; using synthetic fallback", stacklevel=2)
        self._fallback = SyntheticGps()

    def _drain(self) -> None:
        if self._sock is None:
            return
        try:
            while True:
                chunk = self._sock.recv(4096)  # type: ignore[union-attr]
                if not chunk:
                    break
                self._buf += chunk
        except BlockingIOError:
            pass
        except Exception as exc:  # noqa: BLE001
            self._attach_fallback(f"gpsd recv failed: {exc}")
            return
        # Process complete lines.
        while b"\n" in self._buf:
            line, self._buf = self._buf.split(b"\n", 1)
            self._consume_line(line)

    def _consume_line(self, line: bytes) -> None:
        line = line.strip()
        if not line:
            return
        try:
            obj = json.loads(line.decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            return
        if obj.get("class") != "TPV":
            return
        mode = obj.get("mode", 0)
        fix_type = {0: "no_fix", 1: "no_fix", 2: "2d", 3: "3d"}.get(mode, "no_fix")
        if fix_type == "no_fix" or "lat" not in obj or "lon" not in obj:
            return
        # gpsd TPV "time" is ISO-8601; fall back to wall-clock if absent.
        self._last = Fix(
            lat=float(obj["lat"]),
            lon=float(obj["lon"]),
            alt_m=obj.get("altMSL") or obj.get("alt"),
            accuracy_m=obj.get("eph"),
            sats=int(obj.get("nSat", 0)),
            fix_type=fix_type,
            at=time.time(),
        )

    def read_fix(self) -> Fix | None:
        if self._fallback is not None:
            return self._fallback.read_fix()
        self._drain()
        return self._last


def _default_serial_device() -> str:
    """Platform-appropriate default serial device for GPS dongles.

    Linux / OPi5: /dev/ttyUSB0 (common u-blox / GlobalSat USB GPS).
    Windows dev box: COM3 (PowerShell `Get-PnpDevice` to find yours).
    macOS dev box: /dev/tty.usbserial-* (use `ls /dev/tty.*` to find).

    Override with OVERSEER_GPS_DEVICE; the dispatcher in _gps() reads
    it before instantiating SerialNmeaSource.
    """
    import sys
    if sys.platform.startswith("win"):
        return "COM3"
    if sys.platform == "darwin":
        return "/dev/tty.usbserial"
    return "/dev/ttyUSB0"


@_dataclass
class SerialNmeaSource:
    """Reads fixes from a serial GPS via NMEA 0183 ($GPRMC / $GPGGA).

    Default device is platform-dependent (see ``_default_serial_device``);
    9600 baud is the near-universal default for consumer GPS dongles
    (u-blox NEO-6 / NEO-7 / NEO-M8, GlobalSat BU-353, Garmin GLO 2).

    Override device + baud per deployment via OVERSEER_GPS_DEVICE and
    OVERSEER_GPS_BAUD env vars (handled by the dispatcher in ``_gps()``).
    """

    device: str = _field(default_factory=_default_serial_device)
    baud: int = 9600
    open_timeout: float = 1.0

    _port: 'object | None' = _field(default=None, init=False, repr=False)
    _buf: str = _field(default="", init=False, repr=False)
    _last: 'Fix | None' = _field(default=None, init=False, repr=False)
    _sats_seen: int = _field(default=0, init=False, repr=False)
    _fallback: 'SyntheticGps | None' = _field(default=None, init=False, repr=False)
    last_error: str | None = _field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        try:
            import serial  # type: ignore
            self._port = serial.Serial(self.device, self.baud, timeout=0)
        except ImportError as exc:
            self._attach_fallback(f"pyserial unavailable: {exc}")
        except Exception as exc:  # noqa: BLE001
            self._attach_fallback(f"serial open {self.device} failed: {exc}")

    def _attach_fallback(self, reason: str) -> None:
        self.last_error = reason
        import warnings
        warnings.warn(f"OVERSEER GPS: {reason}; using synthetic fallback", stacklevel=2)
        self._fallback = SyntheticGps()

    def _drain(self) -> None:
        if self._port is None:
            return
        try:
            chunk = self._port.read(4096)  # type: ignore[union-attr]
        except Exception as exc:  # noqa: BLE001
            self._attach_fallback(f"serial read failed: {exc}")
            return
        if not chunk:
            return
        try:
            self._buf += chunk.decode("ascii", errors="replace")
        except AttributeError:                # already str (tests with fakes)
            self._buf += chunk
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            self._consume_line(line.strip())

    def _consume_line(self, line: str) -> None:
        if not line.startswith("$") or "," not in line:
            return
        # Strip optional checksum.
        if "*" in line:
            line = line.split("*", 1)[0]
        parts = line.split(",")
        head = parts[0]
        try:
            if head.endswith("GGA") and len(parts) >= 10:
                lat = _nmea_dm_to_deg(parts[2], parts[3])
                lon = _nmea_dm_to_deg(parts[4], parts[5])
                if lat is None or lon is None:
                    return
                quality = int(parts[6] or 0)
                if quality == 0:
                    return
                sats = int(parts[7] or 0)
                alt = float(parts[9]) if parts[9] else None
                self._sats_seen = sats
                self._last = Fix(
                    lat=lat, lon=lon, alt_m=alt, accuracy_m=None,
                    sats=sats,
                    fix_type="3d" if alt is not None else "2d",
                    at=time.time(),
                )
            elif head.endswith("RMC") and len(parts) >= 7 and parts[2] == "A":
                lat = _nmea_dm_to_deg(parts[3], parts[4])
                lon = _nmea_dm_to_deg(parts[5], parts[6])
                if lat is None or lon is None:
                    return
                self._last = Fix(
                    lat=lat, lon=lon, alt_m=None, accuracy_m=None,
                    sats=self._sats_seen,
                    fix_type="2d",
                    at=time.time(),
                )
        except (ValueError, IndexError):
            return

    def read_fix(self) -> Fix | None:
        if self._fallback is not None:
            return self._fallback.read_fix()
        self._drain()
        return self._last


def _nmea_dm_to_deg(dm: str, hemi: str) -> float | None:
    """Convert NMEA ddmm.mmmm + N/S/E/W into a signed decimal degree."""
    if not dm or not hemi:
        return None
    try:
        # Latitude is ddmm.mmmm (2-digit degrees); longitude is dddmm.mmmm.
        dot = dm.find(".")
        deg_digits = max(0, dot - 2) if dot >= 2 else len(dm) - 2
        deg = float(dm[:deg_digits])
        minutes = float(dm[deg_digits:])
        val = deg + minutes / 60.0
        if hemi in ("S", "W"):
            val = -val
        return val
    except (ValueError, IndexError):
        return None


# Module-level selector: instantiated once at first use.
_gps_source: 'object | None' = None


def _gps() -> object:
    global _gps_source
    if _gps_source is not None:
        return _gps_source
    from server import hw
    backend = hw.gps_backend()
    if backend == "gpsd":
        _gps_source = GpsdSource()
    elif backend == "serial":
        device = os.environ.get("OVERSEER_GPS_DEVICE", "/dev/ttyUSB0")
        baud = int(os.environ.get("OVERSEER_GPS_BAUD", "9600"))
        _gps_source = SerialNmeaSource(device=device, baud=baud)
    else:
        _gps_source = SyntheticGps()
    return _gps_source


def gps_fix() -> dict | None:
    """Return the current GPS fix on the wire, or None if no fix yet."""
    fix = _gps().read_fix()  # type: ignore[attr-defined]
    return fix.to_wire() if fix is not None else None


def reset_gps_for_tests(source: object | None = None) -> None:
    """Reset the GPS source. Used by tests; injecting a source skips selection."""
    global _gps_source
    _gps_source = source


# --------------------------------------------------------------------- #
# REST blueprint
# --------------------------------------------------------------------- #

import sqlite3 as _sqlite3

from flask import Blueprint, jsonify, request, Response as _Response

nav_bp = Blueprint("navigation", __name__, url_prefix="/api/n")

# Path to the MBTiles file (env override for Overseer Prime)
_MBTILES = os.environ.get(
    "MBTILES_PATH",
    os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "..", "..", "tools", "tiles", "uk.mbtiles")),
)


@nav_bp.route("/waypoints", methods=["GET"])
def _wps(): return jsonify(waypoints_list())


@nav_bp.route("/waypoint", methods=["POST"])
def _wp_new():
    body = request.get_json(silent=True) or {}
    for f in ("name", "cat", "lat", "lon"):
        if f not in body: return jsonify({"error": f"missing field: {f}"}), 400
    wid = waypoint_new(
        body["name"], body["cat"], float(body["lat"]), float(body["lon"]),
        elev=body.get("elev"), notes=body.get("notes", ""),
        verified=body.get("verified", False),
    )
    return jsonify({"id": wid})


@nav_bp.route("/waypoint/<int:wid>", methods=["GET"])
def _wp_fetch(wid):
    w = waypoint_fetch(wid)
    if w is None: return jsonify({"error": "not found"}), 404
    return jsonify(w)


@nav_bp.route("/waypoint/<int:wid>", methods=["PATCH"])
def _wp_update(wid):
    body = request.get_json(silent=True) or {}
    if not waypoint_update(wid, **body): return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True})


@nav_bp.route("/waypoint/<int:wid>", methods=["DELETE"])
def _wp_delete(wid):
    if not waypoint_delete(wid): return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True})


@nav_bp.route("/nearest", methods=["GET"])
def _nearest():
    return jsonify(nearest(
        float(request.args.get("lat", 0)),
        float(request.args.get("lon", 0)),
        int(request.args.get("max", 5)),
    ))


@nav_bp.route("/route", methods=["POST"])
def _route():
    b = request.get_json(silent=True) or {}
    return jsonify(route(b["from"][0], b["from"][1], b["to"][0], b["to"][1],
                          mode=b.get("mode", "foot")))


@nav_bp.route("/elevation", methods=["POST"])
def _elev():
    b = request.get_json(silent=True) or {}
    if "points" in b:
        return jsonify({"profile": elevation_profile(b["points"])})
    return jsonify({"m": elevation_at(b["lat"], b["lon"])})


@nav_bp.route("/los", methods=["POST"])
def _los():
    b = request.get_json(silent=True) or {}
    return jsonify(line_of_sight(b["from"][0], b["from"][1], b["to"][0], b["to"][1],
                                   freq_mhz=b.get("freq_mhz", 868.0)))


@nav_bp.route("/terrain", methods=["GET"])
def _terrain():
    bm = terrain_bitmap(
        west=float(request.args.get("west",  -2.0)),
        south=float(request.args.get("south", 53.0)),
        east=float(request.args.get("east",  -1.0)),
        north=float(request.args.get("north", 54.0)),
        width=int(request.args.get("w", 64)),
        height=int(request.args.get("h", 48)),
        threshold_m=float(request.args.get("threshold_m", 600)),
    )
    return jsonify({"width": len(bm[0]), "height": len(bm), "bitmap": bm})


@nav_bp.route("/overlays", methods=["GET"])
def _ovs(): return jsonify(overlays_list())


@nav_bp.route("/overlay", methods=["POST"])
def _ov_new():
    b = request.get_json(silent=True) or {}
    return jsonify({"id": overlay_new(b["name"], b["kind"], b.get("geo_json", {}), b.get("color", "#ffb849"))})


@nav_bp.route("/gps/fix")
def _gps_fix():
    """Current GPS fix, or 204 No Content if no fix is available yet."""
    fix = gps_fix()
    if fix is None:
        return "", 204
    return jsonify(fix)


@nav_bp.route("/tiles/status")
def _tiles_status():
    """Reports whether the MBTiles file exists and how many tiles it holds."""
    if not os.path.exists(_MBTILES):
        return jsonify({"available": False, "path": _MBTILES, "tiles": 0})
    try:
        db = _sqlite3.connect(_MBTILES)
        n = db.execute("SELECT COUNT(*) FROM tiles").fetchone()[0]
        meta = {r[0]: r[1] for r in db.execute("SELECT name,value FROM metadata")}
        db.close()
        return jsonify({
            "available": True, "tiles": n,
            "minzoom": meta.get("minzoom"), "maxzoom": meta.get("maxzoom"),
            "bounds": meta.get("bounds"),
        })
    except Exception as exc:
        return jsonify({"available": False, "error": str(exc)}), 500


@nav_bp.route("/tiles/<int:z>/<int:x>/<int:y>")
def _tile(z, x, y):
    """Serve a single PNG tile from the MBTiles SQLite file.
    MBTiles stores TMS y (flipped from XYZ web convention).
    """
    if not os.path.exists(_MBTILES):
        return "", 404
    tms_y = (2 ** z - 1) - y
    try:
        db = _sqlite3.connect(_MBTILES)
        row = db.execute(
            "SELECT tile_data FROM tiles "
            "WHERE zoom_level=? AND tile_column=? AND tile_row=?",
            (z, x, tms_y),
        ).fetchone()
        db.close()
    except Exception:
        return "", 500
    if row is None:
        return "", 404
    return _Response(
        row[0],
        mimetype="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


def register(app):
    if "navigation" in app.blueprints: return
    app.register_blueprint(nav_bp)

# ── end of module ─────────────────────────────────────────────────────────

