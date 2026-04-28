"""INVENTORY module — unit + endpoint tests. Sprint 10 gate."""
import time
import pytest

from server.app import app
from server.modules import inventory as INV


@pytest.fixture(autouse=True)
def fresh():
    INV.reset_for_tests()
    yield


@pytest.fixture
def client():
    app.config["TESTING"] = True
    return app.test_client()


# ------------------------------------------------------------------ #
# Category tests
# ------------------------------------------------------------------ #

def test_cat_new_and_list():
    cid = INV.cat_new("Medical")
    cats = INV.cat_list()
    assert any(c["id"] == cid and c["name"] == "Medical" for c in cats)


def test_cat_parent():
    parent = INV.cat_new("Medical")
    child  = INV.cat_new("Trauma", parent_id=parent)
    cats   = INV.cat_list()
    child_entry = next(c for c in cats if c["id"] == child)
    assert child_entry["parent_id"] == parent


# ------------------------------------------------------------------ #
# Item CRUD
# ------------------------------------------------------------------ #

def test_item_new_and_fetch():
    cid = INV.cat_new("Food")
    iid = INV.item_new(cid, "Freeze-dried meal", qty=14, unit="pouch",
                       kcal=550, weight_g=120)
    it = INV.item_fetch(iid)
    assert it["name"] == "Freeze-dried meal"
    assert it["qty"] == 14
    assert it["kcal"] == 550


def test_item_update():
    cid = INV.cat_new("Tools")
    iid = INV.item_new(cid, "Leatherman", qty=1)
    assert INV.item_update(iid, qty=2, notes="sharpened")
    it = INV.item_fetch(iid)
    assert it["qty"] == 2
    assert it["notes"] == "sharpened"


def test_item_delete():
    cid = INV.cat_new("Ammo")
    iid = INV.item_new(cid, "5.56 M193", qty=500)
    assert INV.item_delete(iid)
    assert INV.item_fetch(iid) is None
    assert not INV.item_delete(iid)


def test_items_by_category():
    cid1 = INV.cat_new("Food")
    cid2 = INV.cat_new("Water")
    INV.item_new(cid1, "Meal A", qty=5)
    INV.item_new(cid1, "Meal B", qty=3)
    INV.item_new(cid2, "Purif tabs", qty=2)
    assert len(INV.items_by_category(cid1)) == 2
    assert len(INV.items_by_category(cid2)) == 1
    assert len(INV.items_by_category()) == 3


# ------------------------------------------------------------------ #
# Consumption events
# ------------------------------------------------------------------ #

def test_event_log_reduces_qty():
    cid = INV.cat_new("Food")
    iid = INV.item_new(cid, "Ration", qty=10)
    INV.event_log(iid, -1, "lunch")
    INV.event_log(iid, -1, "dinner")
    it = INV.item_fetch(iid)
    assert it["qty"] == 8


def test_event_qty_floor_zero():
    cid = INV.cat_new("Food")
    iid = INV.item_new(cid, "Ration", qty=1)
    INV.event_log(iid, -999, "consumed all")
    assert INV.item_fetch(iid)["qty"] == 0.0


def test_event_log_unknown_item():
    with pytest.raises(KeyError):
        INV.event_log(9999, -1, "oops")


# ------------------------------------------------------------------ #
# Expiry / low-stock
# ------------------------------------------------------------------ #

def test_items_expiring():
    cid = INV.cat_new("Medical")
    now = time.time()
    INV.item_new(cid, "Soon-expiring", qty=1, expires_at=now + 30*86400)
    INV.item_new(cid, "Far-future",    qty=1, expires_at=now + 365*86400)
    INV.item_new(cid, "No-expiry",     qty=1)
    expiring = INV.items_expiring(within_days=60)
    assert len(expiring) == 1
    assert expiring[0]["name"] == "Soon-expiring"


def test_items_low():
    cid = INV.cat_new("Ammo")
    INV.item_new(cid, "Rounds", qty=50, threshold_qty=100)   # below threshold
    INV.item_new(cid, "Mags",   qty=5,  threshold_qty=2)    # above threshold
    low = INV.items_low()
    assert len(low) == 1
    assert low[0]["name"] == "Rounds"
    assert low[0]["low"] is True


# ------------------------------------------------------------------ #
# Burn rate
# ------------------------------------------------------------------ #

def test_burn_rate_no_events():
    cid = INV.cat_new("Food")
    iid = INV.item_new(cid, "Ration", qty=10)
    br  = INV.burn_rate(iid)
    assert br["rate_per_day"] == 0.0
    assert br["days_remaining"] is None


def test_burn_rate_with_events():
    cid = INV.cat_new("Food")
    iid = INV.item_new(cid, "Ration", qty=30)
    # Simulate 3 consumption events spaced a day apart
    t0 = time.time() - 3 * 86400
    from server.modules.inventory import _events, _ev_seq, InvEvent, _items
    import server.modules.inventory as INV2
    INV2._events[1] = InvEvent(id=1, item_id=iid, delta=-3, reason="day1", at=t0)
    INV2._events[2] = InvEvent(id=2, item_id=iid, delta=-3, reason="day2", at=t0+86400)
    INV2._events[3] = InvEvent(id=3, item_id=iid, delta=-3, reason="day3", at=t0+2*86400)
    INV2._ev_seq = 3
    INV2._items[iid].qty = 21   # reflect consumed
    br = INV.burn_rate(iid)
    assert br["rate_per_day"] > 0
    assert br["days_remaining"] is not None


# ------------------------------------------------------------------ #
# UPC lookup (synthetic)
# ------------------------------------------------------------------ #

def test_upc_lookup_known():
    result = INV.upc_lookup("5000169003930")
    assert result["found"] is True
    assert "Ibuprofen" in result["name"]


def test_upc_lookup_unknown():
    result = INV.upc_lookup("0000000000000")
    assert result["found"] is False


# ------------------------------------------------------------------ #
# Pack optimizer (synthetic)
# ------------------------------------------------------------------ #

def test_pack_optimize_returns_structure():
    INV._seed_categories()
    INV._bootstrap_demo()
    result = INV.pack_optimize("48h patrol")
    assert "items" in result
    assert "total_weight_g" in result
    assert "total_kcal" in result
    assert result["synthetic"] is True


def test_pack_optimize_respects_weight_budget():
    INV._seed_categories()
    INV._bootstrap_demo()
    result = INV.pack_optimize("48h patrol", weight_max_g=5000)
    assert result["total_weight_g"] <= 5000


# ------------------------------------------------------------------ #
# Endpoint tests
# ------------------------------------------------------------------ #

def test_categories_endpoint(client):
    INV._seed_categories()
    r = client.get("/api/i/categories")
    assert r.status_code == 200
    assert len(r.get_json()) >= 1


def test_items_endpoint(client):
    INV._bootstrap_demo()
    r = client.get("/api/i/items")
    assert r.status_code == 200
    assert len(r.get_json()) >= 5


def test_item_create_endpoint(client):
    INV._seed_categories()
    cats = client.get("/api/i/categories").get_json()
    cid = cats[0]["id"]
    r = client.post("/api/i/item", json={"category_id": cid, "name": "Test item", "qty": 3})
    assert r.status_code == 200
    assert r.get_json()["name"] == "Test item"


def test_expiring_endpoint(client):
    INV._bootstrap_demo()
    r = client.get("/api/i/expiring?within=90")
    assert r.status_code == 200
    assert isinstance(r.get_json(), list)


def test_low_endpoint(client):
    INV._bootstrap_demo()
    r = client.get("/api/i/low")
    assert r.status_code == 200
    assert isinstance(r.get_json(), list)


def test_pack_optimize_endpoint(client):
    INV._bootstrap_demo()
    r = client.post("/api/i/pack/optimize", json={"mission": "48h patrol"})
    assert r.status_code == 200
    j = r.get_json()
    assert "items" in j and "total_weight_g" in j
