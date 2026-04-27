"""MEDICAL module — triage wizard, runs, dose calc, drug interactions.

Sprint 7 ships:
  - 10 triage trees ported from v2 (shell/src/data/triage.json),
    accessed by both server (this module) and shell (the wizard
    renderer)
  - triage_run/triage_step persistence (in-memory; SQL DDL is in
    server/db.py awaiting the migration runner)
  - dose calculator: weight-based for the common pediatric/adult
    drugs in the synthetic curated set
  - drug interactions DB (curated synthetic; real lookup is a future
    sprint when an offline drug DB is mounted)
  - photo-triage synthetic stub behind OVERSEER_VLM env flag

Real Qwen2-VL on RK3588 NPU is the swap target — same pattern as
Sprint 5's OVERSEER_LLM env flag.
"""

from __future__ import annotations

import json
import os
import time
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

# --------------------------------------------------------------------- #
# Triage tree data (loaded from shell/src/data/triage.json — single
# source for both the wizard renderer and server-side replay)
# --------------------------------------------------------------------- #

_TREE_PATH = Path(__file__).resolve().parents[2] / "shell" / "src" / "data" / "triage.json"
TREES: dict = {}
if _TREE_PATH.exists():
    TREES = json.loads(_TREE_PATH.read_text())


def categories() -> list[dict]:
    return [
        {"id": k, "name": v.get("name", k.upper()), "icon": v.get("icon", "+")}
        for k, v in TREES.items()
    ]


def tree(category: str) -> dict | None:
    return TREES.get(category)


def step(category: str, node_id: str) -> dict | None:
    t = TREES.get(category)
    if not t: return None
    nodes = t.get("nodes", {})
    return nodes.get(node_id)


def start_node(category: str) -> dict | None:
    t = TREES.get(category)
    if not t: return None
    return step(category, t["start"])


# --------------------------------------------------------------------- #
# Triage runs (in-memory)
# --------------------------------------------------------------------- #

@dataclass
class TriageRun:
    id: int
    category: str
    started: float
    ended: float | None = None
    outcome: str | None = None
    steps: list[dict] = field(default_factory=list)


_runs: dict[int, TriageRun] = {}
_run_seq = 0


def reset_for_tests() -> None:
    global _runs, _run_seq
    _runs = {}
    _run_seq = 0


def start_run(category: str) -> int:
    if category not in TREES:
        raise KeyError(f"unknown triage category: {category}")
    global _run_seq
    _run_seq += 1
    _runs[_run_seq] = TriageRun(id=_run_seq, category=category, started=time.time())
    return _run_seq


def commit_step(run_id: int, *, node_id: str, q: str, ans: str, branch: str | None) -> None:
    r = _runs.get(run_id)
    if r is None: raise KeyError(f"unknown run: {run_id}")
    r.steps.append({"at": time.time(), "node_id": node_id, "q": q, "ans": ans, "branch": branch})


def end_run(run_id: int, outcome: str) -> None:
    r = _runs.get(run_id)
    if r is None: raise KeyError(f"unknown run: {run_id}")
    r.ended = time.time()
    r.outcome = outcome


def list_runs() -> list[dict]:
    return [
        {
            "id": r.id, "category": r.category, "started": r.started,
            "ended": r.ended, "outcome": r.outcome, "step_count": len(r.steps),
        } for r in sorted(_runs.values(), key=lambda x: x.id, reverse=True)
    ]


def fetch_run(run_id: int) -> dict | None:
    r = _runs.get(run_id)
    if r is None: return None
    return {
        "id": r.id, "category": r.category, "started": r.started, "ended": r.ended,
        "outcome": r.outcome, "steps": r.steps,
    }


# --------------------------------------------------------------------- #
# Dose calculator (curated drug list, mg/kg-based)
# --------------------------------------------------------------------- #

DRUGS = {
    "paracetamol": {
        "generic": "acetaminophen", "class": "analgesic / antipyretic",
        "doses": {"adult": "500-1000mg q4-6h, max 4g/day",
                  "pediatric": "10-15 mg/kg/dose q4-6h, max 75 mg/kg/day"},
        "warnings": ["hepatotoxic in overdose; avoid with chronic liver disease",
                     "interacts with warfarin (potentiates anticoagulant effect)"],
        "interactions": ["warfarin", "isoniazid", "phenytoin"],
    },
    "ibuprofen": {
        "generic": "ibuprofen", "class": "NSAID",
        "doses": {"adult": "400-600mg q6-8h, max 2.4g/day",
                  "pediatric": "5-10 mg/kg/dose q6-8h, max 40 mg/kg/day"},
        "warnings": ["GI bleeding risk; avoid in dehydration",
                     "may precipitate renal failure in volume-depleted patients"],
        "interactions": ["aspirin", "warfarin", "lithium", "ACE inhibitors"],
    },
    "amoxicillin": {
        "generic": "amoxicillin", "class": "penicillin antibiotic",
        "doses": {"adult": "500mg q8h or 875mg q12h",
                  "pediatric": "20-40 mg/kg/day divided q8h"},
        "warnings": ["check penicillin allergy first",
                     "rash with mononucleosis exposure"],
        "interactions": ["allopurinol (rash)", "oral contraceptives (efficacy reduced)"],
    },
    "epinephrine": {
        "generic": "epinephrine", "class": "sympathomimetic / anaphylaxis",
        "doses": {"adult": "0.3-0.5mg IM (1:1000) q5-15min PRN",
                  "pediatric": "0.01 mg/kg IM (1:1000) max 0.3mg q5-15min PRN"},
        "warnings": ["IM thigh is the standard site",
                     "tachycardia + tremor are expected effects"],
        "interactions": ["beta-blockers (may blunt response)", "MAOIs"],
    },
    "diphenhydramine": {
        "generic": "diphenhydramine", "class": "H1 antihistamine",
        "doses": {"adult": "25-50mg q6-8h",
                  "pediatric": "1.25 mg/kg/dose q6-8h, max 50mg"},
        "warnings": ["sedation; not in <2y", "anticholinergic"],
        "interactions": ["MAOIs", "CNS depressants (additive sedation)"],
    },
}


def dose_calc(drug: str, weight_kg: float, age: int | None = None) -> dict:
    d = DRUGS.get(drug.lower())
    if not d: return {"error": f"unknown drug: {drug}"}
    is_ped = age is not None and age < 12
    band = "pediatric" if is_ped else "adult"
    text = d["doses"].get(band, d["doses"].get("adult", ""))
    # Compute a per-dose mg figure if the dose string looks like "X mg/kg/dose"
    per_dose_mg = None
    import re
    m = re.search(r"([0-9.]+)(?:-([0-9.]+))?\s*mg/kg", text)
    if m and weight_kg:
        lo = float(m.group(1)); hi = float(m.group(2)) if m.group(2) else lo
        per_dose_mg = (round(lo * weight_kg, 1), round(hi * weight_kg, 1))
    return {
        "drug": drug.lower(), "generic": d["generic"], "class": d["class"],
        "band": band, "result_text": text,
        "per_dose_mg_low":  per_dose_mg[0] if per_dose_mg else None,
        "per_dose_mg_high": per_dose_mg[1] if per_dose_mg else None,
        "warnings": d["warnings"],
        "interactions": d["interactions"],
    }


def drug_search(q: str) -> list[dict]:
    ql = q.lower()
    return [
        {"name": k, "generic": d["generic"], "class": d["class"]}
        for k, d in DRUGS.items()
        if ql in k or ql in d["generic"] or ql in d["class"]
    ][:20]


def interactions(drugs: list[str]) -> list[dict]:
    """Cross-reference an N-drug list and return the union of warnings
    where another drug in the list appears in another's interaction set."""
    out = []
    drugs_lower = [d.lower() for d in drugs]
    for a in drugs_lower:
        info = DRUGS.get(a)
        if not info: continue
        for b in drugs_lower:
            if b == a: continue
            for inter in info["interactions"]:
                if b in inter.lower():
                    out.append({"a": a, "b": b, "warning": inter})
    return out


# --------------------------------------------------------------------- #
# Photo-triage stub (synthetic — Sprint 7 plumbing only)
# --------------------------------------------------------------------- #

def photo_analyze(kind: str, image_data: bytes) -> dict:
    flavour = os.environ.get("OVERSEER_VLM", "synthetic")
    if flavour == "synthetic":
        # Returns a deterministic-flavoured "finding" so the UI flow is
        # testable. Real Qwen2-VL on RK3588 NPU swaps in via OVERSEER_VLM=qwen2vl.
        return {
            "kind": kind,
            "image_bytes": len(image_data),
            "findings": [
                {"label": "image-quality:adequate", "confidence": 0.92},
                {"label": "synthetic VLM placeholder — Sprint 7 ships plumbing only", "confidence": 0.0},
            ],
            "synthetic": True,
        }
    if flavour == "qwen2vl":
        raise NotImplementedError(
            "OVERSEER_VLM=qwen2vl: implement and swap real model. ADR pattern same as KNOWLEDGE."
        )
    raise ValueError(f"unknown OVERSEER_VLM={flavour}")


# --------------------------------------------------------------------- #
# REST blueprint
# --------------------------------------------------------------------- #

from flask import Blueprint, jsonify, request

medical_bp = Blueprint("medical", __name__, url_prefix="/api/m")


@medical_bp.route("/categories", methods=["GET"])
def _cats(): return jsonify(categories())


@medical_bp.route("/tree/<category>", methods=["GET"])
def _tree(category):
    t = tree(category)
    if not t: return jsonify({"error": "unknown category"}), 404
    return jsonify(t)


@medical_bp.route("/run/start", methods=["POST"])
def _run_start():
    body = request.get_json(silent=True) or {}
    cat = body.get("category")
    try: rid = start_run(cat)
    except KeyError as e: return jsonify({"error": str(e)}), 400
    return jsonify({"run_id": rid})


@medical_bp.route("/run/<int:rid>/step", methods=["POST"])
def _run_step(rid):
    body = request.get_json(silent=True) or {}
    try:
        commit_step(rid, node_id=body.get("node_id", ""), q=body.get("q", ""),
                    ans=body.get("ans", ""), branch=body.get("branch"))
    except KeyError as e: return jsonify({"error": str(e)}), 404
    return jsonify({"ok": True})


@medical_bp.route("/run/<int:rid>/end", methods=["POST"])
def _run_end(rid):
    body = request.get_json(silent=True) or {}
    try: end_run(rid, body.get("outcome", ""))
    except KeyError as e: return jsonify({"error": str(e)}), 404
    return jsonify({"ok": True})


@medical_bp.route("/runs", methods=["GET"])
def _runs(): return jsonify(list_runs())


@medical_bp.route("/run/<int:rid>", methods=["GET"])
def _run_fetch(rid):
    r = fetch_run(rid)
    if r is None: return jsonify({"error": "not found"}), 404
    return jsonify(r)


@medical_bp.route("/dose", methods=["POST"])
def _dose():
    body = request.get_json(silent=True) or {}
    return jsonify(dose_calc(body.get("drug", ""), float(body.get("weight_kg", 0)), body.get("age")))


@medical_bp.route("/drug/search", methods=["GET"])
def _drug_search():
    return jsonify(drug_search(request.args.get("q", "")))


@medical_bp.route("/drug/<name>", methods=["GET"])
def _drug_fetch(name):
    d = DRUGS.get(name.lower())
    if not d: return jsonify({"error": "not found"}), 404
    return jsonify({"name": name.lower(), **d})


@medical_bp.route("/interactions", methods=["POST"])
def _interactions():
    body = request.get_json(silent=True) or {}
    return jsonify(interactions(body.get("drugs", [])))


@medical_bp.route("/photo", methods=["POST"])
def _photo():
    body = request.get_json(silent=True) or {}
    image_b64 = body.get("image_b64", "")
    import base64
    try: image = base64.b64decode(image_b64) if image_b64 else b""
    except Exception: image = b""
    return jsonify(photo_analyze(body.get("kind", "wound"), image))


def register(app):
    if "medical" in app.blueprints: return
    app.register_blueprint(medical_bp)
