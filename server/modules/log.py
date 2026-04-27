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

# ------------------------------------------------------------------ #
# Data model (in-memory)
# ------------------------------------------------------------------ #

KINDS = (
    "observation", "decision", "patrol", "ration", "incident",
    "triage", "comms", "system", "note",
)

@dataclass
class LogEntry:
    id: int
    kind: str
    body: str
    tags: list
    at: float
    source: str = "user"          # user | auto | imported
    lat: Optional[float] = None
    lon: Optional[float] = None
    weather_json: Optional[dict] = None
    mood: Optional[int] = None
    energy: Optional[int] = None
    photo_text: Optional[str] = None   # OCR result if photo attached
    ref_table: Optional[str] = None    # for auto entries
    ref_id: Optional[int] = None

@dataclass
class DailySummary:
    date: str           # ISO YYYY-MM-DD
    summary_text: str
    approved_at: Optional[float] = None


_entries: dict[int, LogEntry] = {}
_summaries: dict[str, DailySummary] = {}
_seq = 0


def reset_for_tests() -> None:
    global _entries, _summaries, _seq
    _entries = {}
    _summaries = {}
    _seq = 0


# ------------------------------------------------------------------ #
# Helpers
# ------------------------------------------------------------------ #

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
    global _seq
    if kind not in KINDS:
        kind = "note"
    if at is None:
        at = time.time()
    photo_text = _ocr_photo(photo_bytes) if photo_bytes else None
    auto_tags = tags if tags is not None else _infer_tags(kind, body)
    _seq += 1
    _entries[_seq] = LogEntry(
        id=_seq, kind=kind, body=body, tags=auto_tags, at=at,
        source=source, lat=lat, lon=lon, weather_json=weather_json,
        mood=mood, energy=energy, photo_text=photo_text,
        ref_table=ref_table, ref_id=ref_id,
    )
    return _seq


def entry_fetch(eid: int) -> Optional[dict]:
    e = _entries.get(eid)
    return _entry_dict(e) if e else None


def entry_update(eid: int, **fields) -> bool:
    e = _entries.get(eid)
    if not e:
        return False
    allowed = {"kind", "body", "tags", "mood", "energy"}
    for k, v in fields.items():
        if k in allowed:
            setattr(e, k, v)
    return True


def entry_delete(eid: int) -> bool:
    if eid not in _entries:
        return False
    del _entries[eid]
    return True


def _entry_dict(e: LogEntry) -> dict:
    return {
        "id": e.id, "kind": e.kind, "body": e.body, "tags": e.tags,
        "at": e.at, "source": e.source,
        "lat": e.lat, "lon": e.lon,
        "weather": e.weather_json, "mood": e.mood, "energy": e.energy,
        "photo_text": e.photo_text,
        "ref_table": e.ref_table, "ref_id": e.ref_id,
        "date": _date_str(e.at),
        "time": time.strftime("%H:%M", time.localtime(e.at)),
    }


# ------------------------------------------------------------------ #
# Queries
# ------------------------------------------------------------------ #

def entries_today() -> list[dict]:
    today = _today_str()
    return [
        _entry_dict(e) for e in sorted(_entries.values(), key=lambda x: x.at)
        if _date_str(e.at) == today
    ]


def entries_query(
    *,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    kind: Optional[str] = None,
    q: Optional[str] = None,
) -> list[dict]:
    results = list(_entries.values())

    if date_from:
        ts_from = time.mktime(time.strptime(date_from, "%Y-%m-%d"))
        results = [e for e in results if e.at >= ts_from]
    if date_to:
        ts_to = time.mktime(time.strptime(date_to, "%Y-%m-%d")) + 86400
        results = [e for e in results if e.at < ts_to]
    if kind:
        results = [e for e in results if e.kind == kind]
    if q:
        ql = q.lower()
        results = [
            e for e in results
            if ql in e.body.lower() or any(ql in t for t in e.tags)
        ]

    return [_entry_dict(e) for e in sorted(results, key=lambda x: x.at, reverse=True)]


# ------------------------------------------------------------------ #
# Auto-event hook (called by MEDICAL, COMMS, POWER, NAVIGATION)
# ------------------------------------------------------------------ #

def register_auto_event(
    kind: str,
    body: str,
    ref_table: Optional[str] = None,
    ref_id: Optional[int] = None,
    **kwargs,
) -> int:
    """Called by other modules to inject auto-log entries."""
    return entry_new(
        kind=kind, body=body, source="auto",
        ref_table=ref_table, ref_id=ref_id, **kwargs,
    )


# ------------------------------------------------------------------ #
# Daily summary
# ------------------------------------------------------------------ #

def summary_get(date: Optional[str] = None) -> Optional[dict]:
    d = date or _today_str()
    s = _summaries.get(d)
    if s:
        return {"date": d, "text": s.summary_text, "approved_at": s.approved_at}
    # Auto-generate if not yet produced
    day_entries = [
        e for e in _entries.values() if _date_str(e.at) == d
    ]
    if not day_entries and d == _today_str():
        return None
    text = _generate_summary(day_entries)
    _summaries[d] = DailySummary(date=d, summary_text=text)
    return {"date": d, "text": text, "approved_at": None}


def summary_approve(date: Optional[str] = None) -> bool:
    d = date or _today_str()
    if d not in _summaries:
        summary_get(d)          # ensure it exists
    if d not in _summaries:
        return False
    _summaries[d].approved_at = time.time()
    return True


# ------------------------------------------------------------------ #
# Export
# ------------------------------------------------------------------ #

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


# ------------------------------------------------------------------ #
# Flask routes
# ------------------------------------------------------------------ #

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
