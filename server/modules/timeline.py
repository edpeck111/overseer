"""TIMELINE module — unified chronological query across all modules.

Sprint 11. Implements the "UNION ALL" query layer described in the spec:
  - Sources: log_entry, comms messages, medical triage runs, navigation
    waypoints added, power samples, inventory events
  - Each source adapter returns a uniform event dict
  - Full-text search across all kinds
  - Causal threading: events ±window around a given event
  - Markdown export

Sprint 18: adapters for log, inventory, and navigation now query SQLite
directly. Comms and medical remain in-memory until their respective
persistence sprints.
"""
from __future__ import annotations

import time
from typing import Optional


# ------------------------------------------------------------------ #
# Uniform event shape
# ------------------------------------------------------------------ #
# {id, kind, who, body, at, module, ref_id}

def _ev(module: str, kind: str, body: str, at: float,
        ref_id: Optional[int] = None, who: Optional[str] = None) -> dict:
    return {
        "module": module, "kind": kind, "body": body, "at": at,
        "ref_id": ref_id, "who": who or "local",
        "time": time.strftime("%H:%M", time.localtime(at)),
        "date": time.strftime("%Y-%m-%d", time.localtime(at)),
        "day_number": max(0, int((at - 1735689600.0) / 86400)),
    }


# ------------------------------------------------------------------ #
# Source adapters
# ------------------------------------------------------------------ #

def _events_from_log() -> list[dict]:
    try:
        from server.db import get_db
        db = get_db()
        rows = db.execute("SELECT id, kind, body, at, author FROM log_entry").fetchall()
        return [
            _ev("log", f"log.{r['kind']}", r["body"], float(r["at"]),
                ref_id=r["id"], who=r["author"])
            for r in rows
        ]
    except Exception:
        return []


def _events_from_comms() -> list[dict]:
    """Comms persistence deferred to Sprint 21. Falls back to in-memory
    if the module is loaded, silently returns empty if not."""
    try:
        from server.db import get_db
        db = get_db()
        rows = db.execute(
            "SELECT id, sender, recipient, board, subject, body, at "
            "FROM message ORDER BY at DESC LIMIT 500"
        ).fetchall()
        evs = []
        for r in rows:
            if r["board"]:
                body = f"/{r['board']} · {r['sender']}: {r['subject'] or ''}"
                kind = "comms.board"
            else:
                body = f"{r['sender']} → {r['recipient']}: {r['subject'] or ''}"
                kind = "comms.recv"
            evs.append(_ev("comms", kind, body, float(r["at"]),
                           ref_id=r["id"], who=r["sender"]))
        return evs
    except Exception:
        return []


def _events_from_medical() -> list[dict]:
    try:
        from server.modules.medical import _runs
        return [
            _ev("medical", "triage.run",
                f"{r.category} — {r.outcome or 'in progress'}",
                r.started_at, ref_id=r.id)
            for r in _runs.values()
            if r.ended_at  # only completed runs
        ]
    except Exception:
        return []


def _events_from_navigation() -> list[dict]:
    try:
        from server.db import get_db
        db = get_db()
        rows = db.execute("SELECT id, name, cat, created_at FROM waypoints").fetchall()
        return [
            _ev("navigation", "nav.waypoint",
                f"Waypoint added: {r['name']} ({r['cat']})",
                float(r["created_at"]), ref_id=r["id"])
            for r in rows
        ]
    except Exception:
        return []


def _events_from_inventory() -> list[dict]:
    try:
        from server.db import get_db
        db = get_db()
        rows = db.execute(
            "SELECT e.id, e.delta, e.reason, e.at, i.name "
            "FROM inv_event e LEFT JOIN inv_item i ON i.id = e.item_id"
        ).fetchall()
        result = []
        for r in rows:
            name = r["name"] or f"item {r['id']}"
            verb = "consumed" if r["delta"] < 0 else "added"
            result.append(_ev("inventory", "inv.event",
                               f"{name}: {verb} {abs(r['delta']):.0f} ({r['reason'] or ''})",
                               float(r["at"]), ref_id=r["id"]))
        return result
    except Exception:
        return []


_ADAPTERS = [
    _events_from_log,
    _events_from_comms,
    _events_from_medical,
    _events_from_navigation,
    _events_from_inventory,
]


# ------------------------------------------------------------------ #
# Query
# ------------------------------------------------------------------ #

def events_query(
    *,
    range_hours: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    kind: Optional[str] = None,
    q: Optional[str] = None,
    who: Optional[str] = None,
) -> list[dict]:
    all_events: list[dict] = []
    for adapter in _ADAPTERS:
        all_events.extend(adapter())

    now = time.time()

    if range_hours:
        cutoff = now - range_hours * 3600
        all_events = [e for e in all_events if e["at"] >= cutoff]

    if date_from:
        ts = time.mktime(time.strptime(date_from, "%Y-%m-%d"))
        all_events = [e for e in all_events if e["at"] >= ts]

    if date_to:
        ts = time.mktime(time.strptime(date_to, "%Y-%m-%d")) + 86400
        all_events = [e for e in all_events if e["at"] < ts]

    if kind:
        all_events = [e for e in all_events if e["kind"].startswith(kind)]

    if q:
        ql = q.lower()
        all_events = [e for e in all_events if ql in e["body"].lower()]

    if who:
        wl = who.lower()
        all_events = [e for e in all_events if wl in (e["who"] or "").lower()]

    return sorted(all_events, key=lambda x: x["at"], reverse=True)


def events_around(at: float, window_seconds: int = 900) -> list[dict]:
    """All events within ±window around a given timestamp."""
    all_events: list[dict] = []
    for adapter in _ADAPTERS:
        all_events.extend(adapter())
    lo, hi = at - window_seconds, at + window_seconds
    return sorted(
        [e for e in all_events if lo <= e["at"] <= hi],
        key=lambda x: x["at"], reverse=True,
    )


# ------------------------------------------------------------------ #
# Export
# ------------------------------------------------------------------ #

def export_markdown(date_from: str, date_to: str) -> str:
    rows = events_query(date_from=date_from, date_to=date_to)
    if not rows:
        return f"# OVERSEER TIMELINE — {date_from} to {date_to}\n\nNo events.\n"

    lines = [f"# OVERSEER TIMELINE — {date_from} to {date_to}\n"]
    cur_date = None
    for e in sorted(rows, key=lambda x: x["at"]):
        if e["date"] != cur_date:
            cur_date = e["date"]
            lines.append(f"\n## D+{e['day_number']} — {e['date']}\n")
        lines.append(f"**{e['time']}**  `{e['kind']}`  {e['body']}")
    return "\n".join(lines)


# ------------------------------------------------------------------ #
# Flask routes
# ------------------------------------------------------------------ #

def register(app) -> None:
    from flask import jsonify, request, Response

    @app.get("/api/t/events")
    def t_events():
        rng = request.args.get("range")
        range_hours = None
        if rng:
            if rng.endswith("h"):
                range_hours = int(rng[:-1])
            elif rng == "24h": range_hours = 24
            elif rng == "72h": range_hours = 72
            elif rng == "7d":  range_hours = 168
            elif rng == "30d": range_hours = 720
        return jsonify(events_query(
            range_hours=range_hours,
            date_from=request.args.get("from"),
            date_to=request.args.get("to"),
            kind=request.args.get("kind"),
            q=request.args.get("q"),
            who=request.args.get("who"),
        ))

    @app.get("/api/t/around")
    def t_around():
        at = request.args.get("at", type=float)
        window = request.args.get("window", 900, type=int)
        if not at:
            return jsonify({"error": "at required"}), 400
        return jsonify(events_around(at, window))

    @app.get("/api/t/export")
    def t_export():
        date_from = request.args.get("from", time.strftime("%Y-%m-%d"))
        date_to   = request.args.get("to",   time.strftime("%Y-%m-%d"))
        fmt       = request.args.get("fmt", "md")
        md = export_markdown(date_from, date_to)
        if fmt == "md":
            return Response(md, mimetype="text/markdown",
                            headers={"Content-Disposition":
                                     f'attachment; filename="timeline-{date_from}-{date_to}.md"'})
        return jsonify({"text": md})

# ── end of module ─────────────────────────────────────────────────────────

