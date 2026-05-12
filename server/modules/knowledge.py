"""KNOWLEDGE module — chat sessions, branching, hybrid retrieval, library.

Sprint 5 read path — synthetic backends per ADR-0011. The schema, OMP
opcodes, REST endpoints, and branch-tree logic are real and final;
only the LLM and embedder content is canned. Real backends swap in via
the OVERSEER_LLM and OVERSEER_KB_EMBEDDER env flags.

Design spec: docs/02-MODULE-CATALOG.md (K) KNOWLEDGE.
"""

from __future__ import annotations

import os
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Iterator, Protocol

# --------------------------------------------------------------------- #
# Sample library corpus (synthetic, hand-curated). Real ZIM mounts swap
# in behind the same Library interface in Sprint 5.5+.
# --------------------------------------------------------------------- #

LIBRARY = {
    "wikem_en_all": {
        "label": "WikEM",
        "desc":  "Emergency medicine — diagnosis, treatment protocols",
        "size_gb": 0.6,
        "articles": {
            "Water_purification": [
                "Rainwater is generally safe but should be filtered through cloth.",
                "Boiling for 1 minute (rolling) kills most pathogens.",
                "Unscented household bleach: 8 drops per gallon, 30 minute wait.",
                "0.2-micron filter passes most bacteria and protozoa.",
                "Avoid first-flush runoff from roofs.",
            ],
            "Tourniquet_application": [
                "Place 2-3 inches above the wound, never on a joint.",
                "Tighten until bright bleeding stops.",
                "Mark TIME OF APPLICATION on the patient.",
                "Do NOT remove once applied — only a clinician should.",
                "If commercial unavailable, improvise with cloth + rigid object.",
            ],
        },
    },
    "mdwiki_en_all_maxi": {
        "label": "Medical Wikipedia",
        "desc":  "75,000+ medical articles",
        "size_gb": 3.4,
        "articles": {
            "Waterborne_diseases": [
                "Cholera, typhoid, hepatitis A, giardiasis, cryptosporidiosis.",
                "Boiling, chemical disinfection, and filtration are primary defences.",
                "Population-level: source protection > treatment > distribution hygiene.",
            ],
        },
    },
    "ifixit_en_all": {
        "label": "iFixit",
        "desc":  "Repair guides for electronics, vehicles, appliances",
        "size_gb": 1.2,
        "articles": {
            "Solar_panel_inspection": [
                "Visual inspection: cracks, delamination, hot spots, corroded leads.",
                "Multimeter test: open-circuit voltage in full sun should be ≥ rated Voc × 0.9.",
                "Bypass diode failure shows as one shaded cell killing the whole string.",
            ],
        },
    },
}

# --------------------------------------------------------------------- #
# Synthetic LLM — canned answers keyed by query keywords, with
# inline citations referencing LIBRARY entries.
# --------------------------------------------------------------------- #

CANNED = [
    {
        "match": ("rain", "water", "purif", "drink"),
        "answer": (
            "Rainwater is generally safe but should be filtered through cloth and either "
            "boiled for one minute (rolling), treated with unscented bleach (eight drops "
            "per gallon, thirty minute wait), or run through a 0.2-micron filter [1]. "
            "Avoid first-flush runoff [2]. Field medicine only — seek trained personnel "
            "if available. Stay sharp."
        ),
        "citations": [
            {"archive": "wikem_en_all", "article": "Water_purification", "paragraph": 0, "score": 0.94},
            {"archive": "wikem_en_all", "article": "Water_purification", "paragraph": 4, "score": 0.81},
        ],
    },
    {
        "match": ("tourniquet", "bleed", "haemorrhage", "hemorrhage", "arterial"),
        "answer": (
            "Place the tourniquet 2-3 inches above the wound, never on a joint [1]. "
            "Tighten until bright red bleeding stops [2]. Mark the time of application "
            "on the patient — this is critical for the receiving clinician. Do not "
            "remove once applied [3]. Field medicine only. Stay sharp."
        ),
        "citations": [
            {"archive": "wikem_en_all", "article": "Tourniquet_application", "paragraph": 0, "score": 0.96},
            {"archive": "wikem_en_all", "article": "Tourniquet_application", "paragraph": 1, "score": 0.92},
            {"archive": "wikem_en_all", "article": "Tourniquet_application", "paragraph": 3, "score": 0.88},
        ],
    },
    {
        "match": ("solar", "panel", "fail", "diagnos"),
        "answer": (
            "Visual inspection first: cracks, delamination, hot spots, corroded leads [1]. "
            "If everything looks intact, multimeter test the open-circuit voltage in full "
            "sun — it should be at least 0.9× the rated Voc [2]. A single shaded cell "
            "killing a whole string usually points to a failed bypass diode [3]. Stay sharp."
        ),
        "citations": [
            {"archive": "ifixit_en_all", "article": "Solar_panel_inspection", "paragraph": 0, "score": 0.91},
            {"archive": "ifixit_en_all", "article": "Solar_panel_inspection", "paragraph": 1, "score": 0.89},
            {"archive": "ifixit_en_all", "article": "Solar_panel_inspection", "paragraph": 2, "score": 0.85},
        ],
    },
]

DEFAULT_ANSWER = {
    "answer": (
        "I don't have a curated answer for that yet. The synthetic backend "
        "ships a small set of canned responses for Sprint 5 — try asking "
        "about rainwater purification, tourniquet application, or solar "
        "panel diagnosis. The real Ollama integration (ADR-0011) lifts "
        "this. Stay sharp."
    ),
    "citations": [],
}


def _match_canned(query: str) -> dict:
    q = query.lower()
    for entry in CANNED:
        if all(kw in q for kw in entry["match"][:2]) or any(kw in q for kw in entry["match"]):
            return entry
    return DEFAULT_ANSWER


def stream_answer(query: str, *, batch_size: int = 8) -> Iterator[dict]:
    """Yield {tokens, done, citations?} batches for an LLM-stream-shaped flow.

    Sprint 5 emits canned text in word-batches with a small synthetic
    inter-token delay so the UI can demonstrate streaming.
    """
    canned = _match_canned(query)
    text = canned["answer"]
    citations = canned.get("citations", [])

    words = text.split()
    for i in range(0, len(words), batch_size):
        chunk = " ".join(words[i:i + batch_size])
        if i + batch_size < len(words):
            chunk += " "
        yield {"tokens": chunk, "done": False}
        time.sleep(0.05)   # 50 ms inter-batch — feels like a real stream
    yield {"tokens": "", "done": True, "citations": citations}


# --------------------------------------------------------------------- #
# Sessions + branching (real schema, in-memory store for Sprint 5)
# --------------------------------------------------------------------- #

@dataclass
class Turn:
    id: int
    role: str           # "user" | "overseer"
    content: str
    citations: list = field(default_factory=list)
    created_at: float = field(default_factory=time.time)


@dataclass
class Session:
    id: int
    parent_id: int | None
    name: str
    pinned: bool = False
    created_at: float = field(default_factory=time.time)
    turns: list[Turn] = field(default_factory=list)


# In-memory store. Sprint 6+ migrates to SQLite (the schema is in
# server/db.py DDL since Sprint 4; only the writer is missing).
_sessions: dict[int, Session] = {}
_turn_seq = 0
_session_seq = 0


def reset_for_tests() -> None:
    global _sessions, _turn_seq, _session_seq
    _sessions = {}
    _turn_seq = 0
    _session_seq = 0


def new_session(name: str | None = None, parent_id: int | None = None) -> Session:
    global _session_seq
    _session_seq += 1
    name = name or f"session-{_session_seq}"
    s = Session(id=_session_seq, parent_id=parent_id, name=name)
    _sessions[s.id] = s
    return s


def get_session(sid: int) -> Session | None:
    return _sessions.get(sid)


def append_turn(sid: int, role: str, content: str, citations: list | None = None) -> Turn:
    global _turn_seq
    _turn_seq += 1
    s = _sessions.get(sid)
    if s is None:
        raise KeyError(f"session {sid} not found")
    t = Turn(id=_turn_seq, role=role, content=content, citations=citations or [])
    s.turns.append(t)
    return t


def list_sessions() -> list[Session]:
    return sorted(_sessions.values(), key=lambda s: s.id)


def fork_session(sid: int, name: str | None = None) -> Session:
    parent = _sessions.get(sid)
    if parent is None:
        raise KeyError(f"session {sid} not found")
    return new_session(name=name or f"{parent.name}-fork", parent_id=sid)


def branch_tree(root_id: int | None = None) -> dict:
    """Build {id, name, children: [...], turns_count} tree from sessions."""
    by_parent: dict[int | None, list[Session]] = defaultdict(list)
    for s in _sessions.values():
        by_parent[s.parent_id].append(s)

    def node(s: Session) -> dict:
        return {
            "id": s.id,
            "name": s.name,
            "pinned": s.pinned,
            "turns_count": len(s.turns),
            "children": [node(c) for c in by_parent.get(s.id, [])],
        }

    if root_id is not None:
        s = _sessions.get(root_id)
        return node(s) if s else {}

    return {"roots": [node(s) for s in by_parent.get(None, [])]}


# --------------------------------------------------------------------- #
# Library helpers
# --------------------------------------------------------------------- #

def list_archives() -> list[dict]:
    return [
        {"key": k, "label": v["label"], "desc": v["desc"], "size_gb": v["size_gb"], "articles": len(v["articles"])}
        for k, v in LIBRARY.items()
    ]


def list_articles(archive_key: str) -> list[dict]:
    arc = LIBRARY.get(archive_key, {})
    return [{"id": title, "title": title.replace("_", " ")} for title in arc.get("articles", {}).keys()]


def fetch_article(archive_key: str, article_id: str) -> dict:
    arc = LIBRARY.get(archive_key)
    if not arc:
        return {"error": "archive not found"}
    paragraphs = arc.get("articles", {}).get(article_id)
    if paragraphs is None:
        return {"error": "article not found"}
    return {
        "archive": archive_key,
        "id": article_id,
        "title": article_id.replace("_", " "),
        "paragraphs": paragraphs,
    }


def cite_paragraph(archive_key: str, article_id: str, paragraph: int) -> dict:
    article = fetch_article(archive_key, article_id)
    if "error" in article:
        return article
    paras = article["paragraphs"]
    if paragraph < 0 or paragraph >= len(paras):
        return {"error": "paragraph out of range"}
    return {
        "title": article["title"],
        "archive": archive_key,
        "id": article_id,
        "paragraph": paragraph,
        "paragraph_text": paras[paragraph],
        "before": paras[paragraph - 1] if paragraph > 0 else None,
        "after": paras[paragraph + 1] if paragraph + 1 < len(paras) else None,
    }


def search(query: str, archives: list[str] | None = None, max_results: int = 10) -> list[dict]:
    """Simple substring + bag-of-words synthetic match. Real BM25 + vector
    hybrid lands when sqlite-vec is wired in (ADR-0011)."""
    q_words = [w for w in query.lower().split() if len(w) > 2]
    out = []
    for arc_key, arc in LIBRARY.items():
        if archives and arc_key not in archives: continue
        for art_key, paras in arc["articles"].items():
            for i, p in enumerate(paras):
                pl = p.lower()
                hits = sum(1 for w in q_words if w in pl)
                if hits == 0: continue
                out.append({
                    "archive": arc_key, "id": art_key, "title": art_key.replace("_", " "),
                    "snippet": p, "paragraph": i, "score": hits / max(1, len(q_words)),
                })
    out.sort(key=lambda d: d["score"], reverse=True)
    return out[:max_results]


# --------------------------------------------------------------------- #
# REST blueprint
# --------------------------------------------------------------------- #

from flask import Blueprint, Response, jsonify, request, stream_with_context
import json

knowledge_bp = Blueprint("knowledge", __name__, url_prefix="/api/k")


@knowledge_bp.route("/query", methods=["POST"])
def _query():
    body = request.get_json(silent=True) or {}
    q = body.get("q", "")
    sid = body.get("session_id")
    if sid is None:
        sid = new_session(name=q[:40] if q else None).id
    s = _sessions.get(sid)
    if s is None:
        return jsonify({"error": "session not found"}), 404
    append_turn(sid, "user", q)

    @stream_with_context
    def generate():
        chunks = []
        cites = []
        for batch in stream_answer(q):
            chunks.append(batch.get("tokens", ""))
            if batch.get("citations"):
                cites = batch["citations"]
            yield json.dumps({"session_id": sid, **batch}) + "\n"
        append_turn(sid, "overseer", "".join(chunks), citations=cites)

    return Response(generate(), mimetype="application/x-ndjson")


@knowledge_bp.route("/session/new", methods=["POST"])
def _session_new():
    body = request.get_json(silent=True) or {}
    s = new_session(name=body.get("name"), parent_id=body.get("parent_id"))
    return jsonify({"id": s.id, "name": s.name, "parent_id": s.parent_id})


@knowledge_bp.route("/session/<int:sid>", methods=["GET"])
def _session_fetch(sid: int):
    s = _sessions.get(sid)
    if s is None: return jsonify({"error": "not found"}), 404
    return jsonify({
        "id": s.id, "name": s.name, "parent_id": s.parent_id, "pinned": s.pinned,
        "turns": [{"id": t.id, "role": t.role, "content": t.content,
                   "citations": t.citations, "created_at": t.created_at}
                  for t in s.turns],
    })


@knowledge_bp.route("/session/<int:sid>/branch", methods=["POST"])
def _session_branch(sid: int):
    body = request.get_json(silent=True) or {}
    s = fork_session(sid, name=body.get("name"))
    return jsonify({"id": s.id, "name": s.name, "parent_id": s.parent_id})


@knowledge_bp.route("/branches", methods=["GET"])
def _branches():
    rid = request.args.get("root", type=int)
    return jsonify(branch_tree(root_id=rid))


@knowledge_bp.route("/library/archives", methods=["GET"])
def _archives():        return jsonify(list_archives())


@knowledge_bp.route("/library/articles", methods=["GET"])
def _articles():        return jsonify(list_articles(request.args.get("archive", "")))


@knowledge_bp.route("/library/article", methods=["GET"])
def _article():
    return jsonify(fetch_article(request.args.get("archive", ""), request.args.get("id", "")))


@knowledge_bp.route("/library/cite", methods=["GET"])
def _cite():
    return jsonify(cite_paragraph(
        request.args.get("archive", ""),
        request.args.get("id", ""),
        request.args.get("paragraph", type=int) or 0,
    ))


@knowledge_bp.route("/library/search", methods=["GET"])
def _search():
    q = request.args.get("q", "")
    return jsonify(search(q))


def register(app):
    if "knowledge" in app.blueprints: return
    app.register_blueprint(knowledge_bp)
