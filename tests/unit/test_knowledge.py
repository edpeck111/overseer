"""KNOWLEDGE backend — sessions, branching, library, streaming."""

from __future__ import annotations

import json

import pytest

from server.app import app
from server.modules import knowledge as K


@pytest.fixture(autouse=True)
def fresh():
    K.reset_for_tests()
    yield


@pytest.fixture
def client():
    app.config["TESTING"] = True
    return app.test_client()


def test_archive_list(client):
    r = client.get("/api/k/library/archives")
    assert r.status_code == 200
    archives = r.get_json()
    keys = {a["key"] for a in archives}
    assert "wikem_en_all" in keys
    assert "mdwiki_en_all_maxi" in keys


def test_article_fetch(client):
    r = client.get("/api/k/library/article",
                   query_string={"archive": "wikem_en_all", "id": "Water_purification"})
    assert r.status_code == 200
    art = r.get_json()
    assert "paragraphs" in art and len(art["paragraphs"]) == 5


def test_citation(client):
    r = client.get("/api/k/library/cite",
                   query_string={"archive": "wikem_en_all", "id": "Water_purification", "paragraph": 2})
    assert r.status_code == 200
    cite = r.get_json()
    assert "bleach" in cite["paragraph_text"]


def test_search_finds_keyword(client):
    r = client.get("/api/k/library/search", query_string={"q": "rainwater filter"})
    assert r.status_code == 200
    results = r.get_json()
    assert any(r["id"] == "Water_purification" for r in results)


def test_query_streams_with_citations(client):
    r = client.post("/api/k/query", json={"q": "how do I purify rainwater?"})
    assert r.status_code == 200
    chunks = [json.loads(line) for line in r.data.decode().splitlines() if line.strip()]
    assert any(not c.get("done") and c.get("tokens") for c in chunks)
    last = chunks[-1]
    assert last.get("done") is True
    assert isinstance(last.get("citations"), list)
    assert len(last["citations"]) >= 1


def test_session_branching():
    s1 = K.new_session(name="root")
    K.append_turn(s1.id, "user", "first question")
    s2 = K.fork_session(s1.id, name="branch-A")
    s3 = K.fork_session(s2.id, name="branch-B")
    tree = K.branch_tree()
    assert len(tree["roots"]) == 1
    root = tree["roots"][0]
    assert root["id"] == s1.id
    assert len(root["children"]) == 1
    assert root["children"][0]["id"] == s2.id
    assert root["children"][0]["children"][0]["id"] == s3.id


def test_branching_via_api(client):
    r = client.post("/api/k/session/new", json={"name": "root"})
    assert r.status_code == 200
    sid = r.get_json()["id"]
    r2 = client.post(f"/api/k/session/{sid}/branch", json={"name": "fork-1"})
    assert r2.status_code == 200
    new_sid = r2.get_json()["id"]
    assert new_sid != sid
    r3 = client.get("/api/k/branches")
    tree = r3.get_json()
    assert len(tree["roots"]) == 1
    assert tree["roots"][0]["children"][0]["id"] == new_sid
