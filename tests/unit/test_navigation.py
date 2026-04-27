"""NAVIGATION — waypoints, geometry, route/elevation/LOS, terrain bitmap."""

import math
import pytest

from server.app import app
from server.modules import navigation as N


@pytest.fixture(autouse=True)
def fresh():
    N.reset_for_tests()
    yield


@pytest.fixture
def client():
    app.config["TESTING"] = True
    return app.test_client()


def test_haversine_known_distance():
    # London → Manchester ~263 km
    d = N.haversine_km(51.5074, -0.1278, 53.4808, -2.2426)
    assert 250 < d < 280


def test_bearing_north():
    # Going due north — bearing should be ~0
    b = N.bearing_deg(51.0, -1.0, 52.0, -1.0)
    assert -1 < b < 1 or 359 < b <= 360


def test_waypoint_crud():
    wid = N.waypoint_new("Cache-7", "cache", 53.5, -1.5, notes="under the cairn")
    assert wid == 1
    fetched = N.waypoint_fetch(wid)
    assert fetched["name"] == "Cache-7"
    assert N.waypoint_update(wid, verified=True)
    assert N.waypoint_fetch(wid)["verified"] is True
    assert N.waypoint_delete(wid)
    assert N.waypoint_fetch(wid) is None


def test_nearest_orders_by_distance():
    here = (53.5, -1.5)
    N.waypoint_new("near",  "cache", 53.51, -1.51)   # ~1.4 km
    N.waypoint_new("far",   "cache", 53.7,  -1.7)    # ~28 km
    N.waypoint_new("close", "cache", 53.501, -1.499) # ~150 m
    near = N.nearest(*here)
    assert near[0]["name"] == "close"
    assert near[1]["name"] == "near"
    assert near[2]["name"] == "far"


def test_synthetic_route_geometry():
    r = N.route(53.5, -1.5, 53.7, -1.7, mode="foot")
    assert len(r["geometry"]) == 17     # 16 steps + endpoint
    assert r["dist_m"] > 0
    assert r["mode"] == "foot"
    assert r["synthetic"] is True


def test_elevation_synthetic_deterministic():
    a = N.elevation_at(53.5, -1.5)
    b = N.elevation_at(53.5, -1.5)
    assert a == b
    assert 0 <= a <= 3000


def test_los_clear_over_short_distance():
    # 10m apart at the same lat/lon — should always have LOS
    r = N.line_of_sight(53.5, -1.5, 53.5001, -1.5001)
    assert r["has_los"] is True


def test_terrain_bitmap_shape():
    bm = N.terrain_bitmap(west=-2.0, south=53.0, east=-1.0, north=54.0, width=32, height=24)
    assert len(bm) == 24
    assert len(bm[0]) == 32
    # Should have a mix of 0 and 1 cells (synthetic terrain isn't all-or-nothing)
    flat = [c for row in bm for c in row]
    assert 0 in flat
    assert 1 in flat


def test_terrain_bitmap_renders_to_sextant():
    """Sprint 4 sextant rasterizer (Python copy in test fixtures) should
    accept this bitmap and produce a valid sextant string. This is the
    parity guarantee for ADR-0009."""
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "fixtures"))
    import sextant_fixtures as sf
    bm = N.terrain_bitmap(west=-2.0, south=53.0, east=-1.0, north=54.0, width=32, height=24)
    rendered = sf.rasterize(bm)
    assert "\n" in rendered                  # multi-line output
    assert any(c not in (" ", "\n") for c in rendered)   # at least some non-empty cells
    assert len(rendered.split("\n")) == 8    # 24 rows / 3 per cell


def test_waypoint_endpoints(client):
    r = client.post("/api/n/waypoint", json={"name": "RV", "cat": "rdv", "lat": 53.5, "lon": -1.5})
    assert r.status_code == 200
    wid = r.get_json()["id"]
    assert client.get(f"/api/n/waypoint/{wid}").status_code == 200
    assert client.get("/api/n/waypoints").get_json()[0]["name"] == "RV"


def test_terrain_endpoint(client):
    r = client.get("/api/n/terrain", query_string={"w": 16, "h": 12})
    j = r.get_json()
    assert j["width"] == 16
    assert j["height"] == 12
    assert len(j["bitmap"]) == 12 and len(j["bitmap"][0]) == 16
