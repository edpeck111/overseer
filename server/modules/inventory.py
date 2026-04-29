"""INVENTORY module — categories, items, events, expiry, low-stock, pack optimizer.

Sprint 10. Synthetic-first per the established pattern:
  OVERSEER_INV_UPC=synthetic|local   (barcode/UPC lookup; local = offline DB)
  OVERSEER_INV_PACK=synthetic|real   (pack optimizer; real = OR-tools or similar)

Sprint 18: all storage migrated to SQLite (inv_category, inv_item, inv_event tables).
"""
from __future__ import annotations

import math
import os
import time
from datetime import datetime, timezone
from typing import Optional

from server.db import get_db, reset_tables


# ------------------------------------------------------------------ #
# Helpers: expiry date conversion (float unix ↔ ISO text)
# ------------------------------------------------------------------ #

def _ts_to_iso(ts: Optional[float]) -> Optional[str]:
    if ts is None: return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


def _iso_to_ts(s: Optional[str]) -> Optional[float]:
    if not s: return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").replace(
            tzinfo=timezone.utc).timestamp()
    except Exception:
        return None


# ------------------------------------------------------------------ #
# Reset (test isolation)
# ------------------------------------------------------------------ #

def reset_for_tests() -> None:
    reset_tables("inv_event", "inv_item", "inv_category")
    # re-seed default categories so tests calling cat_new() can parent off them
    # (but don't run bootstrap_demo — tests control their own items)


# ------------------------------------------------------------------ #
# Seed helpers
# ------------------------------------------------------------------ #

def _ensure_seed_categories(db) -> None:
    """Insert the default top-level categories if the table is empty."""
    n = db.execute("SELECT COUNT(*) FROM inv_category").fetchone()[0]
    if n > 0:
        return
    for i, (name, icon) in enumerate([
        ("Medical",  "🩺"),
        ("Food",     "🥫"),
        ("Water",    "💧"),
        ("Tools",    "🔧"),
        ("Comms",    "📻"),
        ("Ammo",     "⬤"),
        ("Fuel",     "⛽"),
        ("Bug-out",  "🎒"),
    ], start=1):
        db.execute(
            "INSERT OR IGNORE INTO inv_category(name, icon, sort_order) VALUES (?,?,?)",
            (name, icon, i),
        )
    db.commit()


def _seed_categories() -> None:
    """Public alias used by tests and bootstrap_demo."""
    _ensure_seed_categories(get_db())


# ------------------------------------------------------------------ #
# Category operations
# ------------------------------------------------------------------ #

def cat_new(name: str, parent_id: Optional[int] = None) -> int:
    db = get_db()
    cur = db.execute(
        "INSERT INTO inv_category(name, parent_id) VALUES (?, ?)",
        (name, parent_id),
    )
    db.commit()
    return cur.lastrowid


def cat_list() -> list[dict]:
    db = get_db()
    rows = db.execute(
        "SELECT id, name, parent_id FROM inv_category ORDER BY name"
    ).fetchall()
    return [{"id": r["id"], "name": r["name"], "parent_id": r["parent_id"]} for r in rows]


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
    db = get_db()
    expiry_date = _ts_to_iso(expires_at)
    cur = db.execute(
        """INSERT INTO inv_item
           (category_id, name, qty, unit, location, weight_g, kcal, water_ml,
            expiry_date, low_threshold, notes, upc)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (category_id, name, float(qty), unit, location, weight_g, kcal, water_ml,
         expiry_date, threshold_qty, notes, upc or None),
    )
    db.commit()
    return cur.lastrowid


def item_fetch(iid: int) -> Optional[dict]:
    db = get_db()
    row = db.execute("SELECT * FROM inv_item WHERE id=?", (iid,)).fetchone()
    return _item_dict(row) if row else None


def item_update(iid: int, **fields) -> bool:
    db = get_db()
    row = db.execute("SELECT id FROM inv_item WHERE id=?", (iid,)).fetchone()
    if not row:
        return False
    allowed = {"name", "qty", "unit", "location", "weight_g", "kcal", "water_ml",
               "expires_at", "expiry_date", "threshold_qty", "low_threshold",
               "notes", "upc", "category_id"}
    sets, vals = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k == "expires_at":
            sets.append("expiry_date=?"); vals.append(_ts_to_iso(v))
        elif k == "threshold_qty":
            sets.append("low_threshold=?"); vals.append(v)
        else:
            sets.append(f"{k}=?"); vals.append(v)
    if not sets:
        return True
    sets.append("updated_at=?"); vals.append(int(time.time()))
    vals.append(iid)
    db.execute(f"UPDATE inv_item SET {', '.join(sets)} WHERE id=?", vals)
    db.commit()
    return True


def item_delete(iid: int) -> bool:
    db = get_db()
    cur = db.execute("DELETE FROM inv_item WHERE id=?", (iid,))
    db.commit()
    return cur.rowcount > 0


def items_by_category(cat_id: Optional[int] = None) -> list[dict]:
    db = get_db()
    if cat_id is not None:
        rows = db.execute(
            "SELECT * FROM inv_item WHERE category_id=? ORDER BY name", (cat_id,)
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM inv_item ORDER BY name").fetchall()
    return [_item_dict(r) for r in rows]


def _item_dict(row) -> dict:
    now = time.time()
    expires_at = _iso_to_ts(row["expiry_date"])
    exp_days: Optional[int] = None
    if expires_at:
        exp_days = int((expires_at - now) / 86400)
    low_threshold = row["low_threshold"]
    low = low_threshold is not None and row["qty"] <= low_threshold
    return {
        "id":            row["id"],
        "category_id":   row["category_id"],
        "name":          row["name"],
        "qty":           row["qty"],
        "unit":          row["unit"],
        "location":      row["location"] or "",
        "weight_g":      row["weight_g"],
        "kcal":          row["kcal"],
        "water_ml":      row["water_ml"],
        "expires_at":    expires_at,
        "exp_days":      exp_days,
        "acquired_at":   row["created_at"],
        "threshold_qty": low_threshold,
        "notes":         row["notes"] or "",
        "upc":           row["upc"] or "",
        "low":           low,
    }


# ------------------------------------------------------------------ #
# Consumption events
# ------------------------------------------------------------------ #

def event_log(item_id: int, delta: float, reason: str,
              at: Optional[float] = None) -> int:
    """Log an inventory change. at is optional (for testing backdated events)."""
    db = get_db()
    row = db.execute("SELECT qty FROM inv_item WHERE id=?", (item_id,)).fetchone()
    if row is None:
        raise KeyError(item_id)
    new_qty = max(0.0, row["qty"] + delta)
    db.execute("UPDATE inv_item SET qty=?, updated_at=? WHERE id=?",
               (new_qty, int(time.time()), item_id))
    at_int = int(at) if at is not None else int(time.time())
    cur = db.execute(
        "INSERT INTO inv_event(item_id, delta, reason, at) VALUES (?,?,?,?)",
        (item_id, float(delta), reason, at_int),
    )
    db.commit()
    return cur.lastrowid


def events_for_item(item_id: int) -> list[dict]:
    db = get_db()
    rows = db.execute(
        "SELECT * FROM inv_event WHERE item_id=? ORDER BY at DESC", (item_id,)
    ).fetchall()
    return [{"id": r["id"], "item_id": r["item_id"], "delta": r["delta"],
             "reason": r["reason"], "at": float(r["at"])} for r in rows]


# ------------------------------------------------------------------ #
# Expiry / low-stock queries
# ------------------------------------------------------------------ #

def items_expiring(within_days: int = 90) -> list[dict]:
    cutoff = _ts_to_iso(time.time() + within_days * 86400)
    db = get_db()
    rows = db.execute(
        "SELECT * FROM inv_item WHERE expiry_date IS NOT NULL AND expiry_date <= ? "
        "ORDER BY expiry_date",
        (cutoff,),
    ).fetchall()
    return [_item_dict(r) for r in rows]


def items_low() -> list[dict]:
    db = get_db()
    rows = db.execute(
        "SELECT * FROM inv_item WHERE low_threshold IS NOT NULL AND qty <= low_threshold"
    ).fetchall()
    return [_item_dict(r) for r in rows]


# ------------------------------------------------------------------ #
# Burn-rate analytics (simple: events per day average)
# ------------------------------------------------------------------ #

def burn_rate(item_id: int) -> dict:
    db = get_db()
    rows = db.execute(
        "SELECT delta, at FROM inv_event WHERE item_id=? AND delta < 0",
        (item_id,),
    ).fetchall()
    if not rows:
        return {"item_id": item_id, "rate_per_day": 0.0, "days_remaining": None,
                "synthetic": True}
    span_days = max(1.0, (time.time() - min(r["at"] for r in rows)) / 86400)
    total_consumed = abs(sum(r["delta"] for r in rows))
    rate = total_consumed / span_days
    item = item_fetch(item_id)
    days_remaining = (item["qty"] / rate) if (item and rate > 0) else None
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
    "5000169003930": {"name": "Ibuprofen 400mg x16",        "category": "Medical", "unit": "pack"},
    "5010123456789": {"name": "Water purification tabs x50", "category": "Water",   "unit": "pack"},
    "5060000001234": {"name": "Kendal mint cake 85g",        "category": "Food",    "unit": "ea",
                      "kcal": 350, "weight_g": 85},
}


def upc_lookup(upc: str) -> dict:
    if _USE_UPC_DB:                         # pragma: no cover
        return _real_upc_lookup(upc)
    result = _SYNTHETIC_UPC.get(upc)
    if result:
        return {"found": True, "upc": upc, **result}
    return {"found": False, "upc": upc, "name": f"Unknown UPC {upc}", "synthetic": True}


def _real_upc_lookup(upc: str) -> dict:     # pragma: no cover
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
    "48h patrol":       {"days": 2,  "weight_max_g": 12000, "kcal_day": 2500, "water_ml_day": 3000},
    "14d bug-out":      {"days": 14, "weight_max_g": 22000, "kcal_day": 2000, "water_ml_day": 2500},
    "winter overnight": {"days": 1,  "weight_max_g": 15000, "kcal_day": 3000, "water_ml_day": 2000},
}
_DEFAULT_TARGET = {"days": 3, "weight_max_g": 15000, "kcal_day": 2500, "water_ml_day": 2500}


def pack_optimize(mission: str, weight_max_g: Optional[float] = None,
                  days: Optional[int] = None) -> dict:
    if _USE_REAL_PACK:                       # pragma: no cover
        return _real_pack_optimize(mission, weight_max_g, days)

    target = dict(_MISSION_TARGETS.get(mission, _DEFAULT_TARGET))
    if weight_max_g: target["weight_max_g"] = weight_max_g
    if days:         target["days"] = days

    kcal_needed  = target["kcal_day"]  * target["days"]
    water_needed = target["water_ml_day"] * target["days"]

    db = get_db()
    all_rows = db.execute("SELECT * FROM inv_item WHERE qty > 0").fetchall()
    items = [_item_dict(r) for r in all_rows]

    food_items  = [it for it in items if it["kcal"]]
    water_items = [it for it in items if it["water_ml"]]
    other_items = [it for it in items if not it["kcal"] and not it["water_ml"]]

    selected: list[dict] = []
    total_w = total_kcal = total_water = 0.0

    # get category names for medical check
    cat_names = {r["id"]: r["name"]
                 for r in db.execute("SELECT id, name FROM inv_category").fetchall()}

    def add(it: dict, label: str) -> bool:
        nonlocal total_w, total_kcal, total_water
        w = it["weight_g"] or 200.0
        if total_w + w > target["weight_max_g"]:
            return False
        total_w     += w
        total_kcal  += (it["kcal"] or 0) * it["qty"]
        total_water += (it["water_ml"] or 0) * it["qty"]
        selected.append({"id": it["id"], "name": it["name"], "qty": it["qty"],
                          "unit": it["unit"], "weight_g": w, "label": label})
        return True

    for it in sorted(food_items, key=lambda x: -(x["kcal"] or 0)):
        if total_kcal >= kcal_needed: break
        add(it, "food")
    for it in sorted(water_items, key=lambda x: -(x["water_ml"] or 0)):
        if total_water >= water_needed: break
        add(it, "water")
    for it in sorted(other_items, key=lambda x: x["weight_g"] or 200):
        add(it, "gear")

    med_coverage = "OK" if any(
        "medical" in cat_names.get(it2["id"], "").lower()
        for it2 in items
        if it2.get("category_id") and "Medical" in cat_names.get(it2["category_id"], "")
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
    """Seed demo items if inventory is empty."""
    db = get_db()
    n = db.execute("SELECT COUNT(*) FROM inv_item").fetchone()[0]
    if n > 0:
        return
    _ensure_seed_categories(db)
    cats = {r["name"]: r["id"] for r in db.execute("SELECT id, name FROM inv_category").fetchall()}
    now = time.time()
    item_new(cats.get("Medical", 1), "IFAK",              qty=1,   unit="kit", weight_g=450,
             location="Pack/front", expires_at=now + 365*86400*2, threshold_qty=1,
             notes="Individual First Aid Kit")
    item_new(cats.get("Medical", 1), "CAT tourniquet",    qty=2,   unit="ea",  weight_g=60,
             location="Belt", expires_at=now + 365*86400*3, threshold_qty=1)
    item_new(cats.get("Medical", 1), "Israeli bandage",   qty=4,   unit="ea",  weight_g=90,
             threshold_qty=2)
    item_new(cats.get("Food",    2), "Freeze-dried meal", qty=14,  unit="pouch",
             kcal=550, weight_g=120, expires_at=now + 365*86400*5)
    item_new(cats.get("Food",    2), "Kendal mint cake",  qty=6,   unit="bar",
             kcal=350, weight_g=85, expires_at=now + 30*86400, threshold_qty=3)
    item_new(cats.get("Water",   3), "Water purif tabs",  qty=2,   unit="pack",
             water_ml=10000, weight_g=20, expires_at=now + 180*86400)
    item_new(cats.get("Fuel",    7), "Butane canister",   qty=3,   unit="ea",  weight_g=200,
             threshold_qty=2)
    item_new(cats.get("Tools",   4), "Leatherman Wave",   qty=1,   unit="ea",  weight_g=204)
    item_new(cats.get("Ammo",    6), "5.56x45 M193",      qty=500, unit="rd",  weight_g=1200,
             threshold_qty=200)


# ------------------------------------------------------------------ #
# Flask routes
# ------------------------------------------------------------------ #

def register(app) -> None:
    from flask import jsonify, request

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

# ── end of module ─────────────────────────────────────────────────────────

