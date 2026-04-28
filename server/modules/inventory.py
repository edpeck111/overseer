"""INVENTORY module — categories, items, events, expiry, low-stock, pack optimizer.

Sprint 10. Synthetic-first per the established pattern:
  OVERSEER_INV_UPC=synthetic|local   (barcode/UPC lookup; local = offline DB)
  OVERSEER_INV_PACK=synthetic|real   (pack optimizer; real = OR-tools or similar)

In-memory store for Sprint 10. SQL DDL is noted inline for the migration runner.
"""
from __future__ import annotations

import math
import os
import time
from dataclasses import dataclass, field
from typing import Optional

# ------------------------------------------------------------------ #
# Data model (in-memory)
# ------------------------------------------------------------------ #

@dataclass
class Category:
    id: int
    name: str
    parent_id: Optional[int] = None

@dataclass
class Item:
    id: int
    category_id: int
    name: str
    qty: float
    unit: str = "ea"
    location: str = ""
    weight_g: Optional[float] = None
    kcal: Optional[float] = None
    water_ml: Optional[float] = None
    expires_at: Optional[float] = None   # unix ts
    acquired_at: float = field(default_factory=time.time)
    threshold_qty: Optional[float] = None
    notes: str = ""
    upc: str = ""

@dataclass
class InvEvent:
    id: int
    item_id: int
    delta: float          # +add, -consume
    reason: str
    at: float


_categories: dict[int, Category] = {}
_items: dict[int, Item] = {}
_events: dict[int, InvEvent] = {}
_cat_seq = 0
_item_seq = 0
_ev_seq = 0


def reset_for_tests() -> None:
    global _categories, _items, _events, _cat_seq, _item_seq, _ev_seq
    _categories = {}
    _items = {}
    _events = {}
    _cat_seq = _item_seq = _ev_seq = 0


# ------------------------------------------------------------------ #
# Seed helpers
# ------------------------------------------------------------------ #

def _seed_categories() -> None:
    """Populate default top-level categories if store is empty."""
    if _categories:
        return
    for name in ("Medical", "Food", "Water", "Tools", "Comms", "Ammo", "Fuel", "Bug-out"):
        cat_new(name)


# ------------------------------------------------------------------ #
# Category operations
# ------------------------------------------------------------------ #

def cat_new(name: str, parent_id: Optional[int] = None) -> int:
    global _cat_seq
    _cat_seq += 1
    _categories[_cat_seq] = Category(id=_cat_seq, name=name, parent_id=parent_id)
    return _cat_seq


def cat_list() -> list[dict]:
    return [{"id": c.id, "name": c.name, "parent_id": c.parent_id}
            for c in sorted(_categories.values(), key=lambda x: x.name)]


# ------------------------------------------------------------------ #
# Item operations
# ------------------------------------------------------------------ #

def item_new(
    category_id: int, name: str, qty: float, *,
    unit: str = "ea",
    location: str = "",
    weight_g: Optional[float] = None,
    kcal: Optional[float] = None,
    water_ml: Optional[float] = None,
    expires_at: Optional[float] = None,
    threshold_qty: Optional[float] = None,
    notes: str = "",
    upc: str = "",
) -> int:
    global _item_seq
    _item_seq += 1
    _items[_item_seq] = Item(
        id=_item_seq, category_id=category_id, name=name, qty=qty, unit=unit,
        location=location, weight_g=weight_g, kcal=kcal, water_ml=water_ml,
        expires_at=expires_at, acquired_at=time.time(),
        threshold_qty=threshold_qty, notes=notes, upc=upc,
    )
    return _item_seq


def item_fetch(iid: int) -> Optional[dict]:
    it = _items.get(iid)
    return _item_dict(it) if it else None


def item_update(iid: int, **fields) -> bool:
    it = _items.get(iid)
    if not it:
        return False
    allowed = {"name","qty","unit","location","weight_g","kcal","water_ml",
               "expires_at","threshold_qty","notes","upc","category_id"}
    for k, v in fields.items():
        if k in allowed:
            setattr(it, k, v)
    return True


def item_delete(iid: int) -> bool:
    if iid not in _items:
        return False
    del _items[iid]
    return True


def items_by_category(cat_id: Optional[int] = None) -> list[dict]:
    rows = list(_items.values())
    if cat_id is not None:
        rows = [it for it in rows if it.category_id == cat_id]
    return [_item_dict(it) for it in sorted(rows, key=lambda x: x.name)]


def _item_dict(it: Item) -> dict:
    now = time.time()
    exp_days: Optional[int] = None
    if it.expires_at:
        exp_days = int((it.expires_at - now) / 86400)
    low = it.threshold_qty is not None and it.qty <= it.threshold_qty
    return {
        "id": it.id, "category_id": it.category_id, "name": it.name,
        "qty": it.qty, "unit": it.unit, "location": it.location,
        "weight_g": it.weight_g, "kcal": it.kcal, "water_ml": it.water_ml,
        "expires_at": it.expires_at, "exp_days": exp_days,
        "acquired_at": it.acquired_at,
        "threshold_qty": it.threshold_qty, "notes": it.notes, "upc": it.upc,
        "low": low,
    }


# ------------------------------------------------------------------ #
# Consumption events
# ------------------------------------------------------------------ #

def event_log(item_id: int, delta: float, reason: str) -> int:
    global _ev_seq
    it = _items.get(item_id)
    if not it:
        raise KeyError(item_id)
    it.qty = max(0.0, it.qty + delta)
    _ev_seq += 1
    _events[_ev_seq] = InvEvent(id=_ev_seq, item_id=item_id, delta=delta,
                                reason=reason, at=time.time())
    return _ev_seq


def events_for_item(item_id: int) -> list[dict]:
    return [
        {"id": e.id, "item_id": e.item_id, "delta": e.delta,
         "reason": e.reason, "at": e.at}
        for e in sorted(_events.values(), key=lambda x: x.at, reverse=True)
        if e.item_id == item_id
    ]


# ------------------------------------------------------------------ #
# Expiry / low-stock queries
# ------------------------------------------------------------------ #

def items_expiring(within_days: int = 90) -> list[dict]:
    cutoff = time.time() + within_days * 86400
    rows = [
        _item_dict(it) for it in _items.values()
        if it.expires_at and it.expires_at <= cutoff
    ]
    return sorted(rows, key=lambda x: x["expires_at"])


def items_low() -> list[dict]:
    return [
        _item_dict(it) for it in _items.values()
        if it.threshold_qty is not None and it.qty <= it.threshold_qty
    ]


# ------------------------------------------------------------------ #
# Burn-rate analytics (simple: events per day average)
# ------------------------------------------------------------------ #

def burn_rate(item_id: int) -> dict:
    evs = [e for e in _events.values() if e.item_id == item_id and e.delta < 0]
    if not evs:
        return {"item_id": item_id, "rate_per_day": 0.0, "days_remaining": None, "synthetic": True}
    span_days = max(1.0, (time.time() - min(e.at for e in evs)) / 86400)
    total_consumed = abs(sum(e.delta for e in evs))
    rate = total_consumed / span_days
    it = _items.get(item_id)
    days_remaining = (it.qty / rate) if (it and rate > 0) else None
    return {
        "item_id": item_id, "rate_per_day": round(rate, 3),
        "days_remaining": round(days_remaining, 1) if days_remaining else None,
        "synthetic": False,
    }


# ------------------------------------------------------------------ #
# Barcode / UPC lookup (synthetic-first)
# ------------------------------------------------------------------ #

_USE_UPC_DB = os.environ.get("OVERSEER_INV_UPC", "synthetic") == "local"

_SYNTHETIC_UPC: dict[str, dict] = {
    "5000169003930": {"name": "Ibuprofen 400mg x16", "category": "Medical", "unit": "pack"},
    "5010123456789": {"name": "Water purification tabs x50", "category": "Water", "unit": "pack"},
    "5060000001234": {"name": "Kendal mint cake 85g", "category": "Food", "unit": "ea", "kcal": 350, "weight_g": 85},
}


def upc_lookup(upc: str) -> dict:
    if _USE_UPC_DB:                         # pragma: no cover
        return _real_upc_lookup(upc)
    result = _SYNTHETIC_UPC.get(upc)
    if result:
        return {"found": True, "upc": upc, **result}
    return {"found": False, "upc": upc, "name": f"Unknown UPC {upc}", "synthetic": True}


def _real_upc_lookup(upc: str) -> dict:     # pragma: no cover
    """Lookup against local offline UPC database (sqlite-backed ~1GB set)."""
    import sqlite3 as _sq
    db_path = os.environ.get("OVERSEER_UPC_DB", "/data/upc.db")
    try:
        conn = _sq.connect(db_path)
        row = conn.execute("SELECT name, brand FROM upc WHERE upc=?", (upc,)).fetchone()
        conn.close()
        if row:
            return {"found": True, "upc": upc, "name": f"{row[1]} {row[0]}".strip()}
        return {"found": False, "upc": upc}
    except Exception:
        return {"found": False, "upc": upc, "error": "upc db unavailable"}


# ------------------------------------------------------------------ #
# Pack optimizer (synthetic-first)
# ------------------------------------------------------------------ #

_USE_REAL_PACK = os.environ.get("OVERSEER_INV_PACK", "synthetic") == "real"

_MISSION_TARGETS = {
    "48h patrol":        {"days": 2,  "weight_max_g": 12000, "kcal_day": 2500, "water_ml_day": 3000},
    "14d bug-out":       {"days": 14, "weight_max_g": 22000, "kcal_day": 2000, "water_ml_day": 2500},
    "winter overnight":  {"days": 1,  "weight_max_g": 15000, "kcal_day": 3000, "water_ml_day": 2000},
}
_DEFAULT_TARGET = {"days": 3, "weight_max_g": 15000, "kcal_day": 2500, "water_ml_day": 2500}


def pack_optimize(mission: str, weight_max_g: Optional[float] = None, days: Optional[int] = None) -> dict:
    if _USE_REAL_PACK:                       # pragma: no cover
        return _real_pack_optimize(mission, weight_max_g, days)

    target = dict(_MISSION_TARGETS.get(mission, _DEFAULT_TARGET))
    if weight_max_g:
        target["weight_max_g"] = weight_max_g
    if days:
        target["days"] = days

    kcal_needed  = target["kcal_day"]  * target["days"]
    water_needed = target["water_ml_day"] * target["days"]

    selected = []
    total_w = total_kcal = total_water = 0.0

    # Greedy: food/water items first, then everything else by weight efficiency
    food_items = [it for it in _items.values() if it.kcal and it.qty > 0]
    water_items = [it for it in _items.values() if it.water_ml and it.qty > 0]
    other_items = [it for it in _items.values() if not it.kcal and not it.water_ml and it.qty > 0]

    def add(it: Item, label: str) -> bool:
        nonlocal total_w, total_kcal, total_water
        w = (it.weight_g or 200.0)
        if total_w + w > target["weight_max_g"]:
            return False
        total_w     += w
        total_kcal  += (it.kcal or 0) * it.qty
        total_water += (it.water_ml or 0) * it.qty
        selected.append({"id": it.id, "name": it.name, "qty": it.qty,
                          "unit": it.unit, "weight_g": w, "label": label})
        return True

    for it in sorted(food_items, key=lambda x: -(x.kcal or 0)):
        if total_kcal >= kcal_needed:
            break
        add(it, "food")

    for it in sorted(water_items, key=lambda x: -(x.water_ml or 0)):
        if total_water >= water_needed:
            break
        add(it, "water")

    for it in sorted(other_items, key=lambda x: x.weight_g or 200):
        add(it, "gear")

    med_coverage = "OK" if any(
        _categories.get(it["id"]) and "Medical" in _categories.get(it["id"], Category(0,"")).name
        for it in selected
    ) else "CHECK"

    return {
        "mission": mission,
        "items": selected,
        "total_weight_g": round(total_w),
        "total_kcal": round(total_kcal),
        "total_water_ml": round(total_water),
        "kcal_needed": kcal_needed,
        "water_needed_ml": water_needed,
        "weight_budget_g": target["weight_max_g"],
        "medical_coverage": med_coverage,
        "synthetic": True,
    }


def _real_pack_optimize(mission, weight_max_g, days):  # pragma: no cover
    raise NotImplementedError("Real pack optimizer (OR-Tools) not yet wired")


# ------------------------------------------------------------------ #
# Bootstrap demo data
# ------------------------------------------------------------------ #

def _bootstrap_demo() -> None:
    """Seed demo items if inventory is empty (gate needs something to render)."""
    if _items:
        return
    _seed_categories()
    cats = {c["name"]: c["id"] for c in cat_list()}

    now = time.time()
    item_new(cats["Medical"], "IFAK",               qty=1, unit="kit", weight_g=450,
             location="Pack/front", expires_at=now + 365*86400*2, threshold_qty=1,
             notes="Individual First Aid Kit")
    item_new(cats["Medical"], "CAT tourniquet",     qty=2, unit="ea",  weight_g=60,
             location="Belt", expires_at=now + 365*86400*3, threshold_qty=1)
    item_new(cats["Medical"], "Israeli bandage",    qty=4, unit="ea",  weight_g=90, threshold_qty=2)
    item_new(cats["Food"],    "Freeze-dried meal",  qty=14, unit="pouch",
             kcal=550, weight_g=120, expires_at=now + 365*86400*5)
    item_new(cats["Food"],    "Kendal mint cake",   qty=6, unit="bar",
             kcal=350, weight_g=85, expires_at=now + 30*86400,   # expiring soon!
             threshold_qty=3)
    item_new(cats["Water"],   "Water purif tabs",   qty=2, unit="pack",
             water_ml=10000, weight_g=20, expires_at=now + 180*86400)
    item_new(cats["Fuel"],    "Butane canister",    qty=3, unit="ea",  weight_g=200, threshold_qty=2)
    item_new(cats["Tools"],   "Leatherman Wave",    qty=1, unit="ea",  weight_g=204)
    item_new(cats["Ammo"],    "5.56x45 M193",       qty=500, unit="rd", weight_g=1200, threshold_qty=200)


# ------------------------------------------------------------------ #
# Flask routes
# ------------------------------------------------------------------ #

def register(app) -> None:
    from flask import jsonify, request

    _bootstrap_demo()

    @app.get("/api/i/categories")
    def i_categories():
        return jsonify(cat_list())

    @app.get("/api/i/items")
    def i_items():
        cat_id = request.args.get("category", type=int)
        return jsonify(items_by_category(cat_id))

    @app.post("/api/i/item")
    def i_item_new():
        d = request.get_json(force=True) or {}
        iid = item_new(
            category_id=d.get("category_id", 1),
            name=d.get("name", "unnamed"),
            qty=float(d.get("qty", 1)),
            unit=d.get("unit", "ea"),
            location=d.get("location", ""),
            weight_g=d.get("weight_g"),
            kcal=d.get("kcal"),
            water_ml=d.get("water_ml"),
            expires_at=d.get("expires_at"),
            threshold_qty=d.get("threshold_qty"),
            notes=d.get("notes", ""),
            upc=d.get("upc", ""),
        )
        return jsonify(item_fetch(iid))

    @app.put("/api/i/item/<int:iid>")
    def i_item_update(iid):
        d = request.get_json(force=True) or {}
        return jsonify({"ok": item_update(iid, **d)})

    @app.delete("/api/i/item/<int:iid>")
    def i_item_delete(iid):
        return jsonify({"ok": item_delete(iid)})

    @app.post("/api/i/event")
    def i_event():
        d = request.get_json(force=True) or {}
        try:
            eid = event_log(
                item_id=int(d["item_id"]),
                delta=float(d["delta"]),
                reason=d.get("reason", ""),
            )
            return jsonify({"id": eid})
        except KeyError:
            return jsonify({"error": "item not found"}), 404

    @app.get("/api/i/expiring")
    def i_expiring():
        within = int(request.args.get("within", 90))
        return jsonify(items_expiring(within))

    @app.get("/api/i/low")
    def i_low():
        return jsonify(items_low())

    @app.post("/api/i/scan")
    def i_scan():
        d = request.get_json(force=True) or {}
        return jsonify(upc_lookup(d.get("upc", "")))

    @app.post("/api/i/pack/optimize")
    def i_pack_optimize():
        d = request.get_json(force=True) or {}
        return jsonify(pack_optimize(
            mission=d.get("mission", "48h patrol"),
            weight_max_g=d.get("weight_max_g"),
            days=d.get("days"),
        ))

    @app.get("/api/i/burn")
    def i_burn():
        item_id = request.args.get("item_id", type=int)
        if not item_id:
            return jsonify({"error": "item_id required"}), 400
        return jsonify(burn_rate(item_id))
