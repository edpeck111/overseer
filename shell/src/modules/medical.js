// MEDICAL module — triage wizard, history, dose calc, drugs, photo.
//
// Sprint 7. Hotkey M from HOME mounts on the triage sub-screen. Sub-
// screens routed by T (triage), H (history), D (dose), R (drugs),
// P (photo); skipped when input/textarea has focus.
//
// Triage flow: category picker → wizard renders one question at a
// time → leaf 'action' node shows the outcome card. Each step is
// committed server-side via /api/m/run/<rid>/step so the run replays
// faithfully from /api/m/run/<rid>.

import { el, txt } from "../chrome/_dom.js";
import { hwStatus, disabledBanner } from "./_hw.js";

const SUBS = { T: "triage", H: "history", D: "dose", R: "drugs", P: "photo" };

const local = {
  sub: "triage",
  hw: null,
  // triage state
  cats: null,
  category: null,
  runId: null,
  treeNodes: null,    // {nodeId: {q, opts} | {action}}
  currentNode: null,
  history: [],        // [{node_id, q, ans, branch}]
  outcome: null,
  // history sub-screen
  runs: null,
  selectedRun: null,
  selectedRunDetail: null,
  // dose sub-screen
  doseForm: { drug: "paracetamol", weight: 70, age: null },
  doseResult: null,
  // drugs sub-screen
  drugQuery: "",
  drugResults: [],
  drugDetail: null,
  // photo
  photoResult: null,
};

export function mountMedical(root, store, ctx) {
  const screen = el("div", "screen-medical medical");
  root.replaceChildren(screen);
  const tabs      = el("div", "kb-tabs");
  const bannerBar = el("div", "kb-banners");
  const body      = el("div", "kb-body");
  screen.append(tabs, bannerBar, body);

  function paint() {
    tabs.replaceChildren(...["triage","history","dose","drugs","photo"].map((s, i) => {
      const t = el("span", "kb-tab" + (local.sub === s ? " active" : ""));
      t.append(el("span", "k", "THDRP"[i]), el("span", "l", s));
      t.addEventListener("click", () => { local.sub = s; paint(); });
      return t;
    }));
    bannerBar.replaceChildren();
    if (local.hw) {
      bannerBar.appendChild(disabledBanner(
        "DRUG DATABASE / VLM TRIAGE",
        "synthetic — real mode needs curated drug DB + VLM image model"
      ));
    }
    if (local.sub === "triage")  paintTriage(body);
    if (local.sub === "history") paintHistory(body);
    if (local.sub === "dose")    paintDose(body);
    if (local.sub === "drugs")   paintDrugs(body);
    if (local.sub === "photo")   paintPhoto(body);
  }

  function onKey(e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (!SUBS[e.key]) return;
    local.sub = SUBS[e.key]; e.preventDefault(); paint();
  }
  document.addEventListener("keydown", onKey, true);

  hwStatus().then(h => { local.hw = h; paint(); });
  return function unmount() {
    document.removeEventListener("keydown", onKey, true);
  };
}

// --------------------------- triage ---------------------------
async function paintTriage(body) {
  body.replaceChildren();
  if (!local.cats) {
    try { local.cats = await (await fetch("/api/m/categories")).json(); }
    catch { local.cats = []; }
  }
  // No category selected → render picker
  if (!local.category) {
    body.appendChild(el("div", "kb-col-title", txt("TRIAGE — PICK A CATEGORY")));
    const grid = el("div", "med-cat-grid");
    for (const c of local.cats) {
      const card = el("div", "med-cat-card");
      card.append(
        el("div", "med-cat-icon", txt(c.icon || "+")),
        el("div", "med-cat-name", txt(c.name)),
      );
      card.addEventListener("click", () => startTriage(c.id, body));
      grid.appendChild(card);
    }
    body.appendChild(grid);
    return;
  }
  // Active wizard
  if (local.outcome) { paintOutcome(body); return; }
  const node = local.currentNode;
  if (!node) { body.appendChild(el("div", "kb-empty", txt("loading…"))); return; }
  body.appendChild(el("div", "kb-col-title", txt(`TRIAGE › ${local.category.toUpperCase()}`)));
  if (node.q) {
    body.appendChild(el("div", "med-q", txt(node.q)));
    const opts = el("div", "med-opts");
    (node.opts || []).forEach((o, i) => {
      const row = el("div", "med-opt");
      row.append(
        el("span", "med-opt-key", txt("(" + String.fromCharCode(65 + i) + ")")),
        el("span", "med-opt-label", txt(o.label)),
      );
      row.addEventListener("click", () => answer(node, o, body));
      opts.appendChild(row);
    });
    body.appendChild(opts);
    body.appendChild(el("div", "med-controls", txt("[b] back · [q] abort")));
  } else if (node.action) {
    paintActionNode(body, node);
  }
}

async function startTriage(category, body) {
  local.category = category; local.history = []; local.outcome = null;
  // Fetch tree + start run
  try {
    const t = await (await fetch(`/api/m/tree/${category}`)).json();
    local.treeNodes = t.nodes || {};
    local.currentNode = local.treeNodes[t.start];
    local.currentNode._id = t.start;
    const r = await (await fetch("/api/m/run/start", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    })).json();
    local.runId = r.run_id;
  } catch (e) {
    console.warn("[medical] startTriage failed:", e.message);
  }
  paintTriage(body);
}

async function answer(node, opt, body) {
  // Commit the step
  if (local.runId) {
    fetch(`/api/m/run/${local.runId}/step`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: node._id, q: node.q, ans: opt.label, branch: opt.next }),
    }).catch(() => {});
  }
  local.history.push({ node_id: node._id, q: node.q, ans: opt.label, branch: opt.next });
  const next = local.treeNodes[opt.next];
  if (!next) {
    local.outcome = { title: "Path ended", steps: ["[no next node — tree data issue]"] };
  } else {
    next._id = opt.next;
    local.currentNode = next;
    if (next.action) {
      local.outcome = next.action;
      // End the run server-side
      if (local.runId) {
        fetch(`/api/m/run/${local.runId}/end`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome: next.action.title || "(no title)" }),
        }).catch(() => {});
      }
    }
  }
  paintTriage(body);
}

function paintActionNode(body, node) {
  paintOutcome(body, node.action);
}

function paintOutcome(body, action = null) {
  const a = action || local.outcome;
  body.appendChild(el("div", "kb-col-title", txt(`OUTCOME — ${local.category.toUpperCase()}`)));
  const card = el("div", "med-action-card" + (a.cls === "danger" ? " danger" : ""));
  card.appendChild(el("div", "med-action-title", txt(a.title || "")));
  if (a.steps?.length) {
    card.appendChild(el("div", "med-action-h", txt("STEPS")));
    const ol = el("ol", "med-steps");
    for (const s of a.steps) ol.appendChild(el("li", "", txt(s)));
    card.appendChild(ol);
  }
  if (a.doList?.length) {
    card.appendChild(el("div", "med-action-h ok", txt("DO")));
    const ul = el("ul", "med-list");
    for (const s of a.doList) ul.appendChild(el("li", "", txt(s)));
    card.appendChild(ul);
  }
  if (a.dontList?.length) {
    card.appendChild(el("div", "med-action-h bad", txt("DON'T")));
    const ul = el("ul", "med-list");
    for (const s of a.dontList) ul.appendChild(el("li", "", txt(s)));
    card.appendChild(ul);
  }
  body.appendChild(card);

  const reset = el("button", "med-btn", txt("[N]ew triage"));
  reset.addEventListener("click", () => {
    local.category = null; local.runId = null; local.outcome = null;
    local.currentNode = null; local.history = []; paintTriage(body);
  });
  body.appendChild(reset);
}

// --------------------------- history ---------------------------
async function paintHistory(body) {
  body.replaceChildren();
  body.appendChild(el("div", "kb-col-title", txt("TRIAGE HISTORY")));
  try { local.runs = await (await fetch("/api/m/runs")).json(); }
  catch { local.runs = []; }
  if (!local.runs.length) {
    body.appendChild(el("div", "kb-empty", txt("no runs yet — switch to T to start one")));
    return;
  }
  const list = el("div", "med-runs-list");
  for (const r of local.runs) {
    const row = el("div", "med-run-row" + (local.selectedRun === r.id ? " sel" : ""));
    row.append(
      el("span", "id", txt("#" + r.id)),
      el("span", "cat", txt(r.category.toUpperCase())),
      el("span", "out", txt(r.outcome || "(in progress)")),
      el("span", "n",  txt(`${r.step_count} steps`)),
    );
    row.addEventListener("click", async () => {
      local.selectedRun = r.id;
      try { local.selectedRunDetail = await (await fetch(`/api/m/run/${r.id}`)).json(); }
      catch { local.selectedRunDetail = null; }
      paintHistory(body);
    });
    list.appendChild(row);
  }
  body.appendChild(list);
  if (local.selectedRunDetail) {
    const d = local.selectedRunDetail;
    const detail = el("div", "med-run-detail");
    detail.appendChild(el("div", "med-action-h", txt(`Run #${d.id} · ${d.category}`)));
    for (const s of d.steps || []) {
      detail.appendChild(el("div", "med-step",
        el("span", "q", txt(s.q || s.node_id)),
        el("span", "ans", txt("→ " + (s.ans || ""))),
      ));
    }
    if (d.outcome) detail.appendChild(el("div", "med-outcome", txt("OUTCOME: " + d.outcome)));
    body.appendChild(detail);
  }
}

// --------------------------- dose ---------------------------
function paintDose(body) {
  body.replaceChildren();
  body.appendChild(el("div", "kb-col-title", txt("DOSE CALCULATOR")));
  const form = el("div", "med-form");

  const drugRow = el("div", "med-form-row");
  drugRow.append(el("span", "k", txt("DRUG")));
  const drugI = el("input", "field");
  drugI.value = local.doseForm.drug;
  drugI.addEventListener("input", (e) => { local.doseForm.drug = e.target.value; });
  drugRow.appendChild(drugI);
  form.appendChild(drugRow);

  const wRow = el("div", "med-form-row");
  wRow.append(el("span", "k", txt("WEIGHT KG")));
  const wI = el("input", "field");
  wI.type = "number"; wI.value = local.doseForm.weight;
  wI.addEventListener("input", (e) => { local.doseForm.weight = parseFloat(e.target.value) || 0; });
  wRow.appendChild(wI);
  form.appendChild(wRow);

  const aRow = el("div", "med-form-row");
  aRow.append(el("span", "k", txt("AGE Y (opt)")));
  const aI = el("input", "field");
  aI.type = "number"; aI.placeholder = "leave blank for adult";
  if (local.doseForm.age != null) aI.value = String(local.doseForm.age);
  aI.addEventListener("input", (e) => {
    const v = e.target.value.trim();
    local.doseForm.age = v === "" ? null : parseInt(v, 10);
  });
  aRow.appendChild(aI);
  form.appendChild(aRow);

  const calcBtn = el("button", "med-btn", txt("Calculate"));
  calcBtn.addEventListener("click", async () => {
    try {
      const r = await fetch("/api/m/dose", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(local.doseForm),
      });
      local.doseResult = await r.json();
    } catch { local.doseResult = { error: "fetch failed" }; }
    paintDose(body);
  });
  form.appendChild(calcBtn);
  body.appendChild(form);

  if (local.doseResult) {
    const r = local.doseResult;
    const card = el("div", "med-action-card");
    if (r.error) {
      card.appendChild(el("div", "med-action-title bad", txt(r.error)));
    } else {
      card.appendChild(el("div", "med-action-title", txt(`${r.drug} (${r.generic}) · ${r["class"]}`)));
      card.appendChild(el("div", "med-form-row", el("span", "k", txt("BAND")), el("span", "v", txt(r.band))));
      card.appendChild(el("div", "med-form-row", el("span", "k", txt("DOSE")), el("span", "v", txt(r.result_text))));
      if (r.per_dose_mg_low !== null) {
        card.appendChild(el("div", "med-form-row",
          el("span", "k", txt("PER DOSE")),
          el("span", "v", txt(`${r.per_dose_mg_low}–${r.per_dose_mg_high} mg`)),
        ));
      }
      if (r.warnings?.length) {
        card.appendChild(el("div", "med-action-h bad", txt("WARNINGS")));
        const ul = el("ul", "med-list");
        for (const w of r.warnings) ul.appendChild(el("li", "", txt(w)));
        card.appendChild(ul);
      }
    }
    body.appendChild(card);
  }
}

// --------------------------- drugs ---------------------------
function paintDrugs(body) {
  body.replaceChildren();
  body.appendChild(el("div", "kb-col-title", txt("DRUG SEARCH")));
  const search = el("div", "med-form-row");
  search.append(el("span", "k", txt("Q")));
  const qI = el("input", "field");
  qI.placeholder = "drug name / class";
  qI.value = local.drugQuery;
  qI.addEventListener("input", async (e) => {
    local.drugQuery = e.target.value;
    try { local.drugResults = await (await fetch(`/api/m/drug/search?q=${encodeURIComponent(local.drugQuery)}`)).json(); }
    catch { local.drugResults = []; }
    renderDrugList();
  });
  search.appendChild(qI);
  body.appendChild(search);

  const list = el("div", "med-drug-list");
  body.appendChild(list);
  const detailWrap = el("div", "med-drug-detail");
  body.appendChild(detailWrap);

  function renderDrugList() {
    list.replaceChildren();
    for (const d of local.drugResults) {
      const row = el("div", "med-drug-row" + (local.drugDetail?.name === d.name ? " sel" : ""));
      row.append(
        el("span", "name", txt(d.name)),
        el("span", "class", txt(d["class"])),
      );
      row.addEventListener("click", async () => {
        try { local.drugDetail = await (await fetch(`/api/m/drug/${encodeURIComponent(d.name)}`)).json(); }
        catch { local.drugDetail = null; }
        renderDrugList();
        renderDrugDetail();
      });
      list.appendChild(row);
    }
  }

  function renderDrugDetail() {
    detailWrap.replaceChildren();
    if (!local.drugDetail) return;
    const d = local.drugDetail;
    const card = el("div", "med-action-card");
    card.appendChild(el("div", "med-action-title", txt(`${d.name} · ${d["class"]}`)));
    if (d.doses) {
      for (const [b, t] of Object.entries(d.doses)) {
        card.appendChild(el("div", "med-form-row", el("span", "k", txt(b.toUpperCase())), el("span", "v", txt(t))));
      }
    }
    if (d.warnings?.length) {
      card.appendChild(el("div", "med-action-h bad", txt("WARNINGS")));
      const ul = el("ul", "med-list");
      for (const w of d.warnings) ul.appendChild(el("li", "", txt(w)));
      card.appendChild(ul);
    }
    if (d.interactions?.length) {
      card.appendChild(el("div", "med-action-h", txt("INTERACTIONS")));
      const ul = el("ul", "med-list");
      for (const w of d.interactions) ul.appendChild(el("li", "", txt(w)));
      card.appendChild(ul);
    }
    detailWrap.appendChild(card);
  }

  // Initial trigger
  if (!local.drugResults.length) {
    fetch("/api/m/drug/search?q=").then(r => r.json()).then(j => {
      local.drugResults = j; renderDrugList();
    }).catch(() => {});
  } else {
    renderDrugList();
    renderDrugDetail();
  }
}

// --------------------------- photo ---------------------------
function paintPhoto(body) {
  body.replaceChildren();
  body.appendChild(el("div", "kb-col-title", txt("PHOTO TRIAGE")));
  body.appendChild(el("div", "kb-empty", txt(
    "Sprint 7 ships plumbing only — synthetic VLM placeholder. " +
    "Real Qwen2-VL on RK3588 NPU lands when OVERSEER_VLM=qwen2vl is " +
    "wired (ADR-pattern same as KNOWLEDGE / POWER / COMMS).",
  )));

  const btn = el("button", "med-btn", txt("Run synthetic analysis"));
  btn.addEventListener("click", async () => {
    try {
      const r = await fetch("/api/m/photo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "wound", image_b64: btoa("placeholder image bytes") }),
      });
      local.photoResult = await r.json();
    } catch { local.photoResult = { error: "fetch failed" }; }
    paintPhoto(body);
  });
  body.appendChild(btn);

  if (local.photoResult) {
    const r = local.photoResult;
    const card = el("div", "med-action-card");
    if (r.error) card.appendChild(el("div", "med-action-title bad", txt(r.error)));
    else {
      card.appendChild(el("div", "med-action-title", txt(`Findings · synthetic=${r.synthetic}`)));
      card.appendChild(el("div", "med-form-row",
                el("span", "k", txt("BYTES")),
        el("span", "v", txt(String(r.image_bytes))),
      ));
      const ul = el("ul", "med-list");
      for (const f of (r.findings || [])) {
        ul.appendChild(el("li", "", txt(`${f.label} (${(f.confidence * 100).toFixed(0)}%)`)));
      }
      card.appendChild(ul);
    }
    body.appendChild(card);
  }
}
