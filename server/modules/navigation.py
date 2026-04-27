"""NAVIGATION module — waypoints, routing, elevation, LOS, terrain.

Sprint 8 ships everything synthetic-first per ADR-0013. Each external
data source has an env-flag swap. Synthetic implementations return
deterministic results so tests are reproducible and the gate doesn't
depend on hardware/data availability.

Heaviest module so far in terms of geometry — most of the math lives
in pure functions that the shell's sextant text-map can reuse via
parity tests against shell/src/sextant/.
"""

from __future__ import annotations

import math
import os
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable

# Earth's mean radius (km) for haversine distance
_R_KM = 6371.0


# --------------------------------------------------------------------- #
# Waypoints (in-memory; SQL DDL is in server/db.py awaiting the runner)
# --------------------------------------------------------------------- #

@dataclass
class Waypoint:
    id: int
    name: str
    cat: str          # "cache" | "rdv" | "obs" | "danger" | "shelter" | ...
    lat: float
    lon: float
    elev: float | None = None
    notes: str = ""
    verified: bool = False
    created_at: float = field(default_factory=time.time)


_waypoints: dict[int, Waypoint] = {}
_wp_seq = 0


def reset_for_tests() -> None:
    global _waypoints, _wp_seq
    _waypoints = {}
    _wp_seq = 0


def waypoint_new(name: str, cat: str, lat: float, lon: float, **opts) -> int:
    global _wp_seq
    _wp_seq += 1
    w = Waypoint(id=_wp_seq, name=name, cat=cat, lat=lat, lon=lon, **{
        k: v for k, v in opts.items() if k in ("elev", "notes", "verified")
    })
    _waypoints[_wp_seq] = w
    return _wp_seq


def waypoint_update(wid: int, **fields) -> bool:
    w = _waypoints.get(wid)
    if w is None: return False
    for k, v in fields.items():
        if hasattr(w, k): setattr(w, k, v)
    return True


def waypoint_delete(wid: int) -> bool:
    return _waypoints.pop(wid, None) is not None


def waypoints_list() -> list[dict]:
    return [_wp_to_dict(w) for w in sorted(_waypoints.values(), key=lambda x: x.id)]


def waypoint_fetch(wid: int) -> dict | None:
    w = _waypoints.get(wid)
    return _wp_to_dict(w) if w else None


def _wp_to_dict(w: Waypoint) -> dict:
    return {
        "id": w.id, "name": w.name, "cat": w.cat,
        "lat": w.lat, "lon": w.lon, "elev": w.elev,
        "notes": w.notes, "verified": w.verified,
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
    hits = []
    for w in _waypoints.values():
        d_km = haversine_km(lat, lon, w.lat, w.lon)
        b = bearing_deg(lat, lon, w.lat, w.lon)
        hits.append({
            "id": w.id, "name": w.name, "cat": w.cat,
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
        # Smooth synthetic terrain: superposition of three sinusoids
        # tuned to give plausible 0..3000 m values.
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
        # Mode-specific multiplier (rough — real routing factors are higher)
        multipliers = {"foot": 1.4, "bike": 1.1, "car": 1.05}
        m = multipliers.get(mode, 1.4)
        # Linear interpolation 16 points for a sextant-friendly profile
        steps = 16
        geometry = [
            (from_lat + (to_lat - from_lat) * (i / steps),
             from_lon + (to_lon - from_lon) * (i / steps))
            for i in range(steps + 1)
        ]
        # Speed estimates: foot 5 km/h, bike 20, car 50 km/h
        speed_kmh = {"foot": 5, "bike": 20, "car": 50}.get(mode, 5)
        dur_s = int(d_km * m / max(0.1, speed_kmh) * 3600)
        return {
            "geometry": geometry, "dist_m": round(d_km * m * 1000),
            "dur_s": dur_s, "mode": mode, "synthetic": True,
        }
    raise NotImplementedError(f"OVERSEER_NAV_ROUTING={flavour} — pending swap-in")


def line_of_sight(lat1: float, lon1: float, lat2: float, lon2: float,
                  freq_mhz: float = 868.0) -> dict:
    """Fresnel-zone line-of-sight check. Sprint 8 algorithm against
    synthetic elevation; real-data swap is automatic via the elevation
    flag — this code doesn't change."""
    SAMPLES = 64
    h_a = elevation_at(lat1, lon1)
    h_b = elevation_at(lat2, lon2)
    profile = []
    obstacles = []
    d_total_km = haversine_km(lat1, lon1, lat2, lon2)
    if d_total_km == 0: return {"has_los": True, "fresnel_clear": True, "obstacles": []}

    # First Fresnel zone radius (m) at midpoint:
    # F1 = 547.7 * sqrt(d_km / freq_mhz)  -- approx
    f1_mid = 547.7 * math.sqrt(d_total_km / freq_mhz)

    has_los = True
    fresnel_clear = True
    for i in range(1, SAMPLES):
        t = i / SAMPLES
        plat = lat1 + (lat2 - lat1) * t
        plon = lon1 + (lon2 - lon1) * t
        h = elevation_at(plat, plon)
        # Direct line height at this fraction:
        line_h = h_a + (h_b - h_a) * t
        clearance = line_h - h
        profile.append(round(h, 1))
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
    """Render an elevation→1-bit bitmap for the sextant rasterizer.
    Cells above ``threshold_m`` are 1 (high ground); below are 0.
    Plus a synthetic river drawn through the bbox.

    Tested against the JS port (shell/src/sextant) for parity in
    tests/fixtures/sextant_input_bitmaps.json — Sprint 8 adds new
    fixtures derived from this function.
    """
    bm = [[0] * width for _ in range(height)]
    for y in range(height):
        for x in range(width):
            lat = north - (north - south) * (y / max(1, height - 1))
            lon = west  + (east  - west)  * (x / max(1, width - 1))
            e = elevation_at(lat, lon)
            if e > threshold_m: bm[y][x] = 1
    # Synthetic river: meander through the bbox
    for y in range(height):
        cx = int(width * 0.3 + width * 0.4 * (y / height) + 5 * math.sin(y * 0.4))
        for dx in range(-1, 2):
            x = cx + dx
            if 0 <= x < width: bm[y][x] = 1
    return bm


# --------------------------------------------------------------------- #
# Overlays (in-memory)
# --------------------------------------------------------------------- #

@dataclass
class Overlay:
    id: int
    name: str
    kind: str        # "polyline" | "polygon" | "circle"
    geo_json: dict
    color: str = "#ffb849"


_overlays: dict[int, Overlay] = {}
_ov_seq = 0


def overlay_new(name: str, kind: str, geo_json: dict, color: str = "#ffb849") -> int:
    global _ov_seq
    _ov_seq += 1
    _overlays[_ov_seq] = Overlay(id=_ov_seq, name=name, kind=kind, geo_json=geo_json, color=color)
    return _ov_seq


def overlay_delete(oid: int) -> bool:
    return _overlays.pop(oid, None) is not None


def overlays_list() -> list[dict]:
    return [{"id": o.id, "name": o.name, "kind": o.kind, "geo_json": o.geo_json, "color": o.color}
            for o in _overlays.values()]


# --------------------------------------------------------------------- #
# REST blueprint
# --------------------------------------------------------------------- #

from flask import Blueprint, jsonify, request

nav_bp = Blueprint("navigation", __name__, url_prefix="/api/n")


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
    """Returns a 0/1 bitmap suitable for the sextant rasterizer."""
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


def register(app):
    if "navigation" in app.blueprints: return
    app.register_blueprint(nav_bp)
