"""LOG module — unit + endpoint tests. Sprint 9 gate."""
import time
import pytest

from server.app import app
from server.modules import log as L


@pytest.fixture(autouse=True)
def fresh():
    L.reset_for_tests()
    yield


@pytest.fixture
def client():
    app.config["TESTING"] = True
    return app.test_client()


# ------------------------------------------------------------------ #
# Pure-function tests
# ------------------------------------------------------------------ #

def test_entry_new_and_fetch():
    eid = L.entry_new("observation", "Fresh tracks north of Cache-7")
    e = L.entry_fetch(eid)
    assert e["id"] == eid
    assert e["kind"] == "observation"
    assert "Fresh tracks" in e["body"]
    assert "observation" in e["tags"]


def test_entry_kinds_default_to_note_on_unknown():
    eid = L.entry_new("nonsense", "Some text")
    assert L.entry_fetch(eid)["kind"] == "note"


def test_all_valid_kinds_accepted():
    for k in L.KINDS:
        eid = L.entry_new(k, f"test body for {k}")
        assert L.entry_fetch(eid)["kind"] == k
    L.reset_for_tests()


def test_entry_update():
    eid = L.entry_new("note", "original body")
    assert L.entry_update(eid, body="updated body", mood=4)
    e = L.entry_fetch(eid)
    assert e["body"] == "updated body"
    assert e["mood"] == 4


def test_entry_delete():
    eid = L.entry_new("patrol", "N perimeter. Nominal.")
    assert L.entry_delete(eid)
    assert L.entry_fetch(eid) is None
    assert not L.entry_delete(eid)      # second delete returns False


def test_tag_inference_keywords():
    eid = L.entry_new("observation", "Ate oats and honey for breakfast, 400 kcal")
    tags = L.entry_fetch(eid)["tags"]
    assert "food" in tags


def test_tag_inference_security():
    eid = L.entry_new("patrol", "Swept the perimeter, no sign of intruder")
    tags = L.entry_fetch(eid)["tags"]
    assert "security" in tags


def test_entries_today_filters_by_date():
    now = time.time()
    yesterday = now - 86400
    L.entry_new("note", "today's entry", at=now)
    L.entry_new("note", "yesterday's entry", at=yesterday)
    today = L.entries_today()
    assert len(today) == 1
    assert "today's entry" in today[0]["body"]


def test_entries_query_by_kind():
    L.entry_new("patrol",  "patrol entry")
    L.entry_new("ration",  "ration entry")
    L.entry_new("patrol",  "another patrol")
    results = L.entries_query(kind="patrol")
    assert len(results) == 2
    assert all(e["kind"] == "patrol" for e in results)


def test_entries_query_full_text_search():
    L.entry_new("observation", "Solar inverter beeped fault")
    L.entry_new("note",        "Nothing unusual")
    results = L.entries_query(q="inverter")
    assert len(results) == 1
    assert "inverter" in results[0]["body"]


def test_auto_event_hook():
    eid = L.register_auto_event(
        kind="triage",
        body="Triage run completed: BLEEDING — venous",
        ref_table="medical_run", ref_id=42,
    )
    e = L.entry_fetch(eid)
    assert e["source"] == "auto"
    assert e["ref_table"] == "medical_run"
    assert e["ref_id"] == 42


def test_summary_generated_synthetically():
    L.entry_new("patrol",   "N perimeter sweep", at=time.time())
    L.entry_new("ration",   "Breakfast: oats",   at=time.time())
    L.entry_new("incident", "Inverter fault",     at=time.time())
    s = L.summary_get()
    assert s is not None
    assert len(s["text"]) > 0
    assert s["approved_at"] is None


def test_summary_approve():
    L.entry_new("note", "test", at=time.time())
    L.summary_get()       # generate
    ok = L.summary_approve()
    assert ok
    s = L.summary_get()
    assert s["approved_at"] is not None


def test_export_markdown_structure():
    ts = time.mktime(time.strptime("2025-06-01", "%Y-%m-%d"))
    L.entry_new("patrol", "N sweep", at=ts)
    L.entry_new("ration", "Breakfast", at=ts + 3600)
    md = L.export_markdown("2025-06-01", "2025-06-01")
    assert "## 2025-06-01" in md
    assert "patrol" in md
    assert "ration" in md


# ------------------------------------------------------------------ #
# Endpoint tests
# ------------------------------------------------------------------ #

def test_today_endpoint(client):
    r = client.get("/api/l/today")
    assert r.status_code == 200
    j = r.get_json()
    assert "entries" in j
    assert "day_number" in j


def test_entry_create_endpoint(client):
    r = client.post("/api/l/entry", json={"kind": "note", "body": "test via API"})
    assert r.status_code == 200
    j = r.get_json()
    assert j["id"] >= 1
    assert j["kind"] == "note"


def test_entries_search_endpoint(client):
    client.post("/api/l/entry", json={"kind": "patrol", "body": "S perimeter clear"})
    client.post("/api/l/entry", json={"kind": "note",   "body": "nothing here"})
    r = client.get("/api/l/entries?kind=patrol")
    assert r.status_code == 200
    results = r.get_json()
    assert len(results) == 1
    assert results[0]["kind"] == "patrol"


def test_entry_delete_endpoint(client):
    r = client.post("/api/l/entry", json={"kind": "note", "body": "to delete"})
    eid = r.get_json()["id"]
    assert client.delete(f"/api/l/entry/{eid}").get_json()["ok"] is True
    assert client.delete(f"/api/l/entry/{eid}").get_json()["ok"] is False


def test_summary_endpoint(client):
    client.post("/api/l/entry", json={"kind": "patrol", "body": "daily patrol"})
    today = time.strftime("%Y-%m-%d")
    r = client.get(f"/api/l/summary/{today}")
    assert r.status_code == 200
    assert "text" in r.get_json()


def test_kinds_endpoint(client):
    r = client.get("/api/l/kinds")
    kinds = r.get_json()
    assert "observation" in kinds
    assert "triage" in kinds
