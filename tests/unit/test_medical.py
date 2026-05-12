"""MEDICAL — triage trees, runs, dose calc, drug interactions, photo stub."""

import pytest

from server.app import app
from server.modules import medical as M


@pytest.fixture(autouse=True)
def fresh():
    M.reset_for_tests()
    yield


@pytest.fixture
def client():
    app.config["TESTING"] = True
    return app.test_client()


def test_categories_loaded():
    cats = M.categories()
    names = {c["id"] for c in cats}
    assert "bleeding" in names
    assert "burns" in names
    assert len(cats) >= 8


def test_triage_tree_traversal():
    t = M.tree("bleeding")
    assert t is not None
    start = M.step("bleeding", t["start"])
    assert start is not None
    assert "q" in start
    assert "opts" in start


def test_run_replay():
    rid = M.start_run("bleeding")
    M.commit_step(rid, node_id="severity", q="severity?", ans="arterial", branch="arterial")
    M.commit_step(rid, node_id="arterial", q="—", ans="action", branch=None)
    M.end_run(rid, outcome="ARTERIAL BLEEDING — LIFE THREAT")
    r = M.fetch_run(rid)
    assert r["outcome"] == "ARTERIAL BLEEDING — LIFE THREAT"
    assert len(r["steps"]) == 2
    assert r["steps"][0]["ans"] == "arterial"


def test_dose_calc_pediatric():
    d = M.dose_calc("paracetamol", weight_kg=20, age=8)
    assert d["band"] == "pediatric"
    assert d["per_dose_mg_low"] == 200.0      # 10 mg/kg × 20 kg
    assert d["per_dose_mg_high"] == 300.0     # 15 mg/kg × 20 kg
    assert "hepatotoxic" in " ".join(d["warnings"]).lower()


def test_dose_calc_adult():
    d = M.dose_calc("ibuprofen", weight_kg=80, age=35)
    assert d["band"] == "adult"
    assert "400-600mg" in d["result_text"]


def test_dose_calc_unknown_drug():
    d = M.dose_calc("magic-elixir", weight_kg=50)
    assert "error" in d


def test_drug_search():
    results = M.drug_search("anti")
    assert any("amoxicillin" in r["name"] for r in results)


def test_interactions_finds_warnings():
    out = M.interactions(["paracetamol", "warfarin"])
    # warfarin is in paracetamol's interaction list
    assert any(i["b"] == "warfarin" for i in out)


def test_photo_stub_synthetic():
    r = M.photo_analyze("wound", b"\x89PNG fake")
    assert r["synthetic"] is True
    assert r["image_bytes"] > 0
    assert any("placeholder" in f["label"].lower() for f in r["findings"])


def test_categories_endpoint(client):
    r = client.get("/api/m/categories")
    assert r.status_code == 200
    assert any(c["id"] == "bleeding" for c in r.get_json())


def test_full_run_via_api(client):
    r = client.post("/api/m/run/start", json={"category": "bleeding"})
    assert r.status_code == 200
    rid = r.get_json()["run_id"]
    client.post(f"/api/m/run/{rid}/step", json={"node_id": "severity", "q": "?", "ans": "venous"})
    client.post(f"/api/m/run/{rid}/end", json={"outcome": "VENOUS BLEEDING — SERIOUS"})
    fetched = client.get(f"/api/m/run/{rid}").get_json()
    assert fetched["outcome"] == "VENOUS BLEEDING — SERIOUS"
    assert len(fetched["steps"]) == 1
