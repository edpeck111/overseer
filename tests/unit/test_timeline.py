"""TIMELINE module — unit + endpoint tests. Sprint 11 gate."""
import time
import pytest

from server.app import app
from server.modules import timeline as TL
from server.modules import log as LOG
from server.modules import inventory as INV


@pytest.fixture(autouse=True)
def fresh():
    LOG.reset_for_tests()
    INV.reset_for_tests()
    yield


@pytest.fixture
def client():
    app.config["TESTING"] = True
    return app.test_client()


def _seed_log():
    now = time.time()
    LOG.entry_new("patrol",   "N perimeter clear",  at=now - 7200)
    LOG.entry_new("ration",   "Breakfast 400kcal",  at=now - 3600)
    LOG.entry_new("incident", "Inverter fault",      at=now - 1800)


def _seed_inv():
    INV._seed_categories()
    INV._bootstrap_demo()


# ------------------------------------------------------------------ #
# Unit tests
# ------------------------------------------------------------------ #

def test_events_query_returns_log_entries():
    _seed_log()
    evs = TL.events_query()
    kinds = {e["kind"] for e in evs}
    assert "log.patrol" in kinds
    assert "log.ration" in kinds
    assert "log.incident" in kinds


def test_events_query_range_hours_filters():
    now = time.time()
    LOG.entry_new("note", "recent",   at=now - 3600)
    LOG.entry_new("note", "old",      at=now - 48 * 3600)
    evs = TL.events_query(range_hours=24)
    bodies = [e["body"] for e in evs]
    assert any("recent" in b for b in bodies)
    assert not any("old" in b for b in bodies)


def test_events_query_kind_filter():
    _seed_log()
    evs = TL.events_query(kind="log.patrol")
    assert all(e["kind"] == "log.patrol" for e in evs)
    assert len(evs) >= 1


def test_events_query_fulltext():
    LOG.entry_new("note", "tourniquet applied to left arm")
    LOG.entry_new("note", "nothing unusual today")
    evs = TL.events_query(q="tourniquet")
    assert len(evs) == 1
    assert "tourniquet" in evs[0]["body"]


def test_events_sorted_newest_first():
    now = time.time()
    LOG.entry_new("note", "older", at=now - 7200)
    LOG.entry_new("note", "newer", at=now - 100)
    evs = TL.events_query()
    assert evs[0]["at"] >= evs[-1]["at"]


def test_events_around_window():
    now = time.time()
    LOG.entry_new("note", "anchor",  at=now)
    LOG.entry_new("note", "near",    at=now - 300)    # 5min ago — inside 15min window
    LOG.entry_new("note", "far",     at=now - 7200)   # 2h ago — outside
    evs = TL.events_around(now, window_seconds=900)
    bodies = [e["body"] for e in evs]
    assert "anchor" in bodies
    assert "near"   in bodies
    assert "far" not in bodies


def test_events_from_inventory():
    _seed_inv()
    items = INV.items_by_category()
    iid = items[0]["id"]
    INV.event_log(iid, -1, "consumed")
    evs = TL.events_query(kind="inv.event")
    assert len(evs) >= 1
    assert "consumed" in evs[0]["body"]


def test_export_markdown():
    ts = time.mktime(time.strptime("2025-06-15", "%Y-%m-%d"))
    LOG.entry_new("patrol", "south sweep", at=ts)
    md = TL.export_markdown("2025-06-15", "2025-06-15")
    assert "## D+" in md
    assert "log.patrol" in md
    assert "south sweep" in md


def test_uniform_event_shape():
    _seed_log()
    evs = TL.events_query()
    for e in evs:
        for key in ("module", "kind", "body", "at", "time", "date", "day_number"):
            assert key in e, f"missing key {key!r} in event {e}"


# ------------------------------------------------------------------ #
# Endpoint tests
# ------------------------------------------------------------------ #

def test_events_endpoint(client):
    _seed_log()
    r = client.get("/api/t/events")
    assert r.status_code == 200
    evs = r.get_json()
    assert isinstance(evs, list)
    assert len(evs) >= 3


def test_events_endpoint_kind_filter(client):
    _seed_log()
    r = client.get("/api/t/events?kind=log.patrol")
    assert r.status_code == 200
    evs = r.get_json()
    assert all(e["kind"].startswith("log.patrol") for e in evs)


def test_events_endpoint_search(client):
    LOG.entry_new("note", "BRAVO-2 seen at Cache-7")
    r = client.get("/api/t/events?q=BRAVO-2")
    assert r.status_code == 200
    assert len(r.get_json()) >= 1


def test_around_endpoint(client):
    now = time.time()
    LOG.entry_new("note", "anchor", at=now)
    r = client.get(f"/api/t/around?at={now}&window=900")
    assert r.status_code == 200
    assert len(r.get_json()) >= 1
