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

# ── end of module ─────────────────────────────────────────────────────────

