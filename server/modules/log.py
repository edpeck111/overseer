"""LOG module — daily journal, auto-events, LLM summary, export.

Sprint 9. All external dependencies (LLM tagging/summary, photo OCR,
weather auto-attach) are synthetic-first per the env-flag pattern
established in earlier sprints.

  OVERSEER_LOG_LLM=synthetic|ollama   (default: synthetic)
  OVERSEER_LOG_OCR=synthetic|tesseract

In-memory store for Sprint 9; SQL DDL is in server/db.py, ready to
activate when the migration runner lands.
"""
from __future__ import annotations

import math
import os
import time
from dataclasses import dataclass, field
from typing import Optional
from server.db import get_db, reset_tables

KINDS = (
    "observation", "decision", "patrol", "ration", "incident",
    "triage", "comms", "system", "note",
)

def _today_str() -> str:
    return time.strftime("%Y-%m-%d", time.localtime())


def _date_str(ts: float) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(ts))


def _day_number(ts: float) -> int:
    """Approximate D+ number: days since 2025-01-01 (v3 epoch)."""
    epoch = 1735689600.0  # 2025-01-01 00:00 UTC
    return max(0, int((ts - epoch) / 86400))


# ------------------------------------------------------------------ #
# Synthetic tag inference
# ------------------------------------------------------------------ #

_KIND_KEYWORDS: dict[str, list[str]] = {
    "observation": ["track", "sign", "saw", "heard", "found", "observed"],
    "decision":    ["decided", "going to", "will", "won't", "plan", "choice"],
    "patrol":      ["patrol", "perimeter", "sweep", "check", "circuit"],
    "ration":      ["ate", "breakfast", "lunch", "dinner", "kcal", "food",
                    "water", "drank", "calories"],
    "incident":    ["fault", "alarm", "alert", "failed", "broke", "incident",
                    "problem", "issue"],
    "note":        ["note", "reminder", "memo"],
}

_TOPIC_TAGS: list[tuple[str, list[str]]] = [
    ("security",  ["track", "patrol", "perimeter", "threat", "intruder"]),
    ("food",      ["ate", "food", "ration", "calories", "kcal", "breakfast",
                   "lunch", "dinner", "oats", "meal"]),
    ("water",     ["water", "spring", "filter", "purif", "drank"]),
    ("power",     ["solar", "battery", "inverter", "generator", "charge"]),
    ("medical",   ["injury", "wound", "pain", "sick", "triage", "dose", "meds"]),
    ("comms",     ["radio", "lora", "mesh", "message", "signal", "received"]),
    ("weather",   ["rain", "wind", "fog", "sun", "storm", "weather", "front"]),
    ("shelter",   ["shelter", "camp", "base", "roof", "leak", "repair"]),
    ("navigation",["waypoint", "cache", "route", "bearing", "grid"]),
]


def _infer_tags(kind: str, body: str) -> list[str]:
    """Synthetic tag inference — keyword scan over body text."""
    lower = body.lower()
    tags: list[str] = [kind]
    for topic, kws in _TOPIC_TAGS:
        if any(kw in lower for kw in kws):
            tags.append(topic)
    return list(dict.fromkeys(tags))   # dedupe, preserve order


# ------------------------------------------------------------------ #
# Synthetic LLM summary (real Ollama swap behind env flag)
# ------------------------------------------------------------------ #

_USE_OLLAMA = os.environ.get("OVERSEER_LOG_LLM", "synthetic") == "ollama"


def _generate_summary(entries: list[LogEntry]) -> str:
    """Produce a ~5-line debrief. Synthetic: uses rule-based condensing."""
    if _USE_OLLAMA:                          # pragma: no cover
        return _ollama_summary(entries)

    if not entries:
        return "No entries recorded today."

    counts: dict[str, int] = {}
    for e in entries:
        counts[e.kind] = counts.get(e.kind, 0) + 1

    lines = []
    lines.append(f"D+{_day_number(entries[0].at)} — {len(entries)} entries logged.")

    patrols = [e for e in entries if e.kind == "patrol"]
    if patrols:
        lines.append(f"Patrol: {len(patrols)} circuit(s) completed.")

    rations = [e for e in entries if e.kind == "ration"]
    if rations:
        lines.append(f"Rations: {len(rations)} meal(s) logged.")

    incidents = [e for e in entries if e.kind == "incident"]
    if incidents:
        lines.append(f"Incidents: {len(incidents)} — review recommended.")

    decisions = [e for e in entries if e.kind == "decision"]
    if decisions:
        lines.append(f"Decisions: {len(decisions)} recorded.")

    autos = [e for e in entries if e.source == "auto"]
    if autos:
        lines.append(f"Auto-events: {len(autos)} from other modules.")

    return "\n".join(lines[:5])


def _ollama_summary(entries: list[LogEntry]) -> str:  # pragma: no cover
    """Real LLM summary via KNOWLEDGE module's Ollama wrapper."""
    try:
        from server.modules.knowledge import llm_chat
        bullet_list = "\n".join(f"- [{e.kind}] {e.body[:80]}" for e in entries)
        prompt = (
            "You are a survival system assistant. "
            "Summarise these journal entries in exactly 5 lines. "
            "Be terse and factual.\n\n" + bullet_list
        )
        return llm_chat(prompt)
    except Exception:
        return _generate_summary(entries)   # fallback to synthetic


# ------------------------------------------------------------------ #
# Synthetic OCR (real tesseract/VLM swap behind env flag)
# ------------------------------------------------------------------ #

_USE_OCR = os.environ.get("OVERSEER_LOG_OCR", "synthetic") == "tesseract"


def _ocr_photo(photo_bytes: bytes) -> str:
    if _USE_OCR:                             # pragma: no cover
        import pytesseract, PIL.Image, io
        img = PIL.Image.open(io.BytesIO(photo_bytes))
        return pytesseract.image_to_string(img).strip()
    # Synthetic: return a placeholder
    size_kb = len(photo_bytes) // 1024
    return f"[synthetic OCR — photo {size_kb}KB — text extraction pending real model]"


# ------------------------------------------------------------------ #
# Core entry operations
# ------------------------------------------------------------------ #

"""LOG module — SQLite storage layer (Sprint 18 replacement for in-memory dicts)."""
import json, time
from typing import Optional
from server.db import get_db, reset_tables


# ── CRUD ──────────────────────────────────────────────────────────────────

def entry_new(
    kind: str,
    body: str,
    *,
    at: Optional[float] = None,
    source: str = "user",
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    weather_json: Optional[dict] = None,
    mood: Optional[int] = None,
    energy: Optional[int] = None,
    photo_bytes: Optional[bytes] = None,
    ref_table: Optional[str] = None,
    ref_id: Optional[int] = None,
    tags: Optional[list] = None,
) -> int:
    if kind not in KINDS and source != "auto":
        kind = "note"
    if at is None:
        at = time.time()
    photo_text = _ocr_photo(photo_bytes) if photo_bytes else None
    auto_tags  = tags if tags is not None else _infer_tags(kind, body)
    db = get_db()
    cur = db.execute(
        """INSERT INTO log_entry
               (kind, body, tags, at, lat, lon, weather, author,
                mood, energy, ref_table, ref_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (kind, body, json.dumps(auto_tags), at, lat, lon,
         json.dumps(weather_json) if weather_json else None, source,
         mood, energy, ref_table, ref_id))
    db.commit()
    return cur.lastrowid


def entry_fetch(eid: int) -> Optional[dict]:
    row = get_db().execute(
        "SELECT * FROM log_entry WHERE id=?", (eid,)).fetchone()
    return _row_to_dict(row) if row else None


def entry_update(eid: int, **fields) -> bool:
    allowed = {"kind", "body", "tags", "mood", "energy"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return False
    db = get_db()
    if "tags" in updates and isinstance(updates["tags"], list):
        updates["tags"] = json.dumps(updates["tags"])
    sets = ", ".join(f"{k}=?" for k in updates)
    cur = db.execute(f"UPDATE log_entry SET {sets} WHERE id=?",
                     (*updates.values(), eid))
    db.commit()
    return cur.rowcount > 0


def entry_delete(eid: int) -> bool:
    db = get_db()
    cur = db.execute("DELETE FROM log_entry WHERE id=?", (eid,))
    db.commit()
    return cur.rowcount > 0


def _row_to_dict(row) -> dict:
    tags = json.loads(row["tags"]) if row["tags"] else []
    weather = json.loads(row["weather"]) if row["weather"] else None
    at = row["at"]
    return {
        "id": row["id"], "kind": row["kind"], "body": row["body"],
        "tags": tags, "at": at, "source": row["author"] or "user",
        "lat": row["lat"], "lon": row["lon"], "weather": weather,
        "mood": row["mood"], "energy": row["energy"], "photo_text": None,
        "ref_table": row["ref_table"], "ref_id": row["ref_id"],
        "date": _date_str(at),
        "time": time.strftime("%H:%M", time.localtime(at)),
    }


# ── Queries ───────────────────────────────────────────────────────────────

def entries_today() -> list[dict]:
    today = _today_str()
    db = get_db()
    rows = db.execute(
        "SELECT * FROM log_entry WHERE date(at,'unixepoch','localtime')=? "
        "ORDER BY at ASC", (today,)).fetchall()
    return [_row_to_dict(r) for r in rows]


def entries_query(
    *,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    kind: Optional[str] = None,
    q: Optional[str] = None,
) -> list[dict]:
    clauses, params = [], []
    if date_from:
        clauses.append("at >= ?")
        params.append(time.mktime(time.strptime(date_from, "%Y-%m-%d")))
    if date_to:
        clauses.append("at < ?")
        params.append(time.mktime(time.strptime(date_to, "%Y-%m-%d")) + 86400)
    if kind:
        # Support exact match or prefix match (e.g. "auspice.sabbat")
        if "." in kind:
            clauses.append("kind=?"); params.append(kind)
        else:
            clauses.append("(kind=? OR kind LIKE ?)"); params += [kind, f"{kind}.%"]
    if q:
        clauses.append("(body LIKE ? OR tags LIKE ?)")
        params += [f"%{q}%", f"%{q}%"]
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = get_db().execute(
        f"SELECT * FROM log_entry {where} ORDER BY at DESC", params).fetchall()
    return [_row_to_dict(r) for r in rows]


def register_auto_event(
    kind: str, body: str,
    ref_table: Optional[str] = None, ref_id: Optional[int] = None, **kwargs,
) -> int:
    return entry_new(kind=kind, body=body, source="auto",
                     ref_table=ref_table, ref_id=ref_id, **kwargs)


# ── Daily summary ─────────────────────────────────────────────────────────

def summary_get(date: Optional[str] = None) -> Optional[dict]:
    d = date or _today_str()
    db = get_db()
    row = db.execute("SELECT * FROM daily_summary WHERE date_str=?", (d,)).fetchone()
    if row:
        return {"date": d, "day_number": row["day_number"],
                "text": row["body"], "approved_at": row["approved_at"]}
    day_entries_rows = db.execute(
        "SELECT * FROM log_entry WHERE date(at,'unixepoch','localtime')=?", (d,)).fetchall()
    if not day_entries_rows and d == _today_str():
        return None
    # Build synthetic entry objects for the summary generator
    class _E:
        pass
    entries = []
    for r in day_entries_rows:
        e = _E()
        e.id = r["id"]; e.kind = r["kind"]; e.body = r["body"]
        e.tags = json.loads(r["tags"]) if r["tags"] else []
        e.at = r["at"]; e.lat = r["lat"]; e.lon = r["lon"]
        e.source = r["author"] or "user"
        e.weather_json = json.loads(r["weather"]) if r["weather"] else None
        e.mood = None; e.energy = None; e.photo_text = None
        e.ref_table = None; e.ref_id = None
        entries.append(e)
    text = _generate_summary(entries)
    day_n = _day_number(time.mktime(time.strptime(d, "%Y-%m-%d")))
    db.execute(
        "INSERT OR REPLACE INTO daily_summary(date_str,day_number,body,approved) "
        "VALUES(?,?,?,0)", (d, day_n, text))
    db.commit()
    return {"date": d, "day_number": day_n, "text": text, "approved_at": None}


def summary_approve(date: Optional[str] = None) -> bool:
    d = date or _today_str()
    summary_get(d)   # ensure row exists
    db = get_db()
    cur = db.execute(
        "UPDATE daily_summary SET approved=1, approved_at=strftime('%s','now') "
        "WHERE date_str=?", (d,))
    db.commit()
    return cur.rowcount > 0


# ── Export ────────────────────────────────────────────────────────────────

def export_markdown(date_from: str, date_to: str) -> str:
    rows = entries_query(date_from=date_from, date_to=date_to)
    if not rows:
        return f"# OVERSEER LOG — {date_from} to {date_to}\n\nNo entries.\n"
    lines = [f"# OVERSEER LOG — {date_from} to {date_to}\n"]
    cur_date = None
    for e in sorted(rows, key=lambda x: x["at"]):
        d = e["date"]
        if d != cur_date:
            cur_date = d
            lines.append(f"\n## {d}\n")
        lines.append(f"**{e['time']}** `{e['kind']}` — {e['body']}")
        if e["tags"]:
            lines.append(f"  *tags: {', '.join(e['tags'])}*")
        lines.append("")
    return "\n".join(lines)


# ── Reset ─────────────────────────────────────────────────────────────────

def reset_for_tests() -> None:
    reset_tables("log_entry", "daily_summary")
def register(app) -> None:
    from flask import jsonify, request

    @app.get("/api/l/today")
    def l_today():
        today = _today_str()
        return jsonify({
            "date": today,
            "day_number": _day_number(time.time()),
            "entries": entries_today(),
        })

    @app.get("/api/l/entries")
    def l_entries():
        return jsonify(entries_query(
            date_from=request.args.get("from"),
            date_to=request.args.get("to"),
            kind=request.args.get("kind"),
            q=request.args.get("q"),
        ))

    @app.post("/api/l/entry")
    def l_entry_new():
        d = request.get_json(force=True) or {}
        eid = entry_new(
            kind=d.get("kind", "observation"),
            body=d.get("body", ""),
            at=d.get("at"),
            mood=d.get("mood"),
            energy=d.get("energy"),
            lat=d.get("lat"),
            lon=d.get("lon"),
        )
        return jsonify({"id": eid, **entry_fetch(eid)})

    @app.put("/api/l/entry/<int:eid>")
    def l_entry_update(eid):
        d = request.get_json(force=True) or {}
        ok = entry_update(eid, **{k: v for k, v in d.items()
                                  if k in ("kind", "body", "tags", "mood", "energy")})
        return jsonify({"ok": ok})

    @app.delete("/api/l/entry/<int:eid>")
    def l_entry_delete(eid):
        return jsonify({"ok": entry_delete(eid)})

    @app.get("/api/l/summary/<date>")
    def l_summary(date):
        s = summary_get(date)
        if not s:
            return jsonify({"error": "no entries for that date"}), 404
        return jsonify(s)

    @app.post("/api/l/summary/<date>/approve")
    def l_summary_approve(date):
        return jsonify({"ok": summary_approve(date)})

    @app.get("/api/l/export")
    def l_export():
        from flask import Response
        date_from = request.args.get("from", _today_str())
        date_to   = request.args.get("to",   _today_str())
        fmt       = request.args.get("fmt", "md")
        md = export_markdown(date_from, date_to)
        if fmt == "md":
            return Response(md, mimetype="text/markdown",
                            headers={"Content-Disposition":
                                     f'attachment; filename="log-{date_from}-{date_to}.md"'})
        return jsonify({"text": md})

    @app.get("/api/l/kinds")
    def l_kinds():
        return jsonify(list(KINDS))

# ── end of module ─────────────────────────────────────────────────────────

# -- end of module - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

