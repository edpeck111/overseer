// LOG module — daily journal, auto-events, LLM summary, export.
//
// Sprint 9. Hotkey L from HOME. Sub-screens:
//   T — TODAY    current day's entries + quick-entry input
//   E — ENTRIES  browse/search past entries
//   S — SUMMARY  LLM daily debrief, approve button
//   X — EXPORT   markdown export by date range

import { el, txt } from "../chrome/_dom.js";

const SUBS  = { T: "today", E: "entries", S: "summary", X: "export" };
const KINDS = ["observation","decision","patrol","ration","incident","triage","comms","system","note"];

const local = {
  sub: "today",
  // today
  todayData: null,
  // entries
  entryList: null,
  filterKind: "",
  filterQ: "",
  // summary
  summaryData: null,
  // export
  exportFrom: "",
  exportTo: "",
  exportResult: null,
};

export function mountLog(root, store, ctx) {
  const screen = el("div", "screen-log log");
  root.replaceChildren(screen);
  const tabs = el("div", "kb-tabs");
  const body = el("div", "kb-body");
  screen.append(tabs, body);

  function paint() {
    tabs.replaceChildren(...["today","entries","summary","export"].map((s, i) => {
      const t = el("span", "kb-tab" + (local.sub === s ? " active" : ""));
      t.append(el("span", "k", "TESX"[i]), el("span", "l", s));
      t.addEventListener("click", () => { local.sub = s; paint(); });
      return t;
    }));
    if (local.sub === "today")   paintToday(body);
    if (local.sub === "entries") paintEntries(body);
    if (local.sub === "summary") paintSummary(body);
    if (local.sub === "export")  paintExport(body);
  }

  function onKey(e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (!SUBS[e.key]) return;
    local.sub = SUBS[e.key]; e.preventDefault(); paint();
  }
  document.addEventListener("keydown", onKey, true);

  loadToday().then(paint);

  return function unmount() {
    document.removeEventListener("keydown", onKey, true);
  };
}

// ------------------------------------------------------------------ //
// TODAY sub-screen
// ------------------------------------------------------------------ //

async function loadToday() {
  try {
    local.todayData = await (await fetch("/api/l/today")).json();
  } catch (_) {
    local.todayData = { date: today(), day_number: 0, entries: [] };
  }
}

function paintToday(body) {
  body.replaceChildren();

  const header = el("div", "log-day-header");
  const d = local.todayData;
  const dayNum  = d ? `D+${d.day_number}` : "D+?";
  const dateStr = d ? d.date : today();
  header.append(
    el("span", "log-day-num", dayNum),
    el("span", "log-day-sep", " · "),
    el("span", "log-day-date", dateStr),
    el("span", "log-entry-count",
      ` · ${d ? d.entries.length : 0} entr${(d && d.entries.length === 1) ? "y" : "ies"}`),
  );
  body.append(header);

  const list = el("div", "log-entry-list");
  if (d && d.entries.length) {
    for (const e of d.entries) {
      list.append(buildEntryRow(e));
    }
  } else {
    list.append(el("div", "kb-empty", "No entries today. Start writing below."));
  }
  body.append(list);

  // Quick-entry bar
  body.append(buildQuickEntry(async (kind, text) => {
    if (!text.trim()) return;
    await fetch("/api/l/entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, body: text }),
    }).catch(() => {});
    await loadToday();
    paintToday(body);
  }));
}

function buildEntryRow(e) {
  const row = el("div", "log-entry-row");
  row.append(
    el("span", "log-entry-time", e.time || "??:??"),
    el("span", "log-entry-kind log-kind-" + e.kind, e.kind),
    el("span", "log-entry-body", e.body),
  );
  if (e.source === "auto") row.classList.add("log-auto");
  return row;
}

function buildQuickEntry(onSubmit) {
  const wrap = el("div", "log-quick");
  const kindSel = el("select", "log-kind-sel");
  for (const k of KINDS) {
    const opt = el("option", "", k); opt.value = k;
    if (k === "observation") opt.selected = true;
    kindSel.append(opt);
  }
  const input = el("input", "log-input");
  input.type = "text";
  input.placeholder = "> new entry…";
  input.setAttribute("autocomplete", "off");
  const btn = el("button", "log-submit-btn", "ADD");

  async function submit() {
    await onSubmit(kindSel.value, input.value);
    input.value = "";
    input.focus();
  }
  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });

  wrap.append(kindSel, input, btn);
  return wrap;
}

// ------------------------------------------------------------------ //
// ENTRIES sub-screen
// ------------------------------------------------------------------ //

async function loadEntries() {
  const params = new URLSearchParams();
  if (local.filterKind) params.set("kind", local.filterKind);
  if (local.filterQ)    params.set("q",    local.filterQ);
  try {
    local.entryList = await (await fetch("/api/l/entries?" + params)).json();
  } catch (_) { local.entryList = []; }
}

function paintEntries(body) {
  body.replaceChildren();

  const filters = el("div", "log-filters");
  const kindSel = el("select", "log-filter-kind");
  const allOpt = el("option", "", "all kinds"); allOpt.value = "";
  kindSel.append(allOpt);
  for (const k of KINDS) {
    const opt = el("option", "", k); opt.value = k;
    if (k === local.filterKind) opt.selected = true;
    kindSel.append(opt);
  }
  kindSel.addEventListener("change", () => {
    local.filterKind = kindSel.value;
    loadEntries().then(() => paintEntries(body));
  });

  const search = el("input", "log-search");
  search.type = "text"; search.placeholder = "search…";
  search.value = local.filterQ;
  search.setAttribute("autocomplete","off");
  search.addEventListener("input", () => {
    local.filterQ = search.value;
    loadEntries().then(() => paintEntries(body));
  });

  filters.append(kindSel, search);
  body.append(filters);

  const list = el("div", "log-entry-list");
  if (!local.entryList) {
    loadEntries().then(() => paintEntries(body));
    list.append(el("div", "kb-empty", "Loading…"));
  } else if (!local.entryList.length) {
    list.append(el("div", "kb-empty", "No matching entries."));
  } else {
    let curDate = null;
    for (const e of local.entryList) {
      if (e.date !== curDate) {
        curDate = e.date;
        list.append(el("div", "log-date-divider", e.date));
      }
      list.append(buildEntryRow(e));
    }
  }
  body.append(list);
}

// ------------------------------------------------------------------ //
// SUMMARY sub-screen
// ------------------------------------------------------------------ //

async function loadSummary() {
  const d = today();
  try {
    local.summaryData = await (await fetch(`/api/l/summary/${d}`)).json();
  } catch (_) { local.summaryData = null; }
}

function paintSummary(body) {
  body.replaceChildren();

  const hdr = el("div", "log-section-header", "DAILY DEBRIEF");
  body.append(hdr);

  if (!local.summaryData) {
    loadSummary().then(() => paintSummary(body));
    body.append(el("div", "kb-empty", "Generating summary…"));
    return;
  }

  const s = local.summaryData;
  const card = el("div", "log-summary-card");
  const dateSpan = el("span", "log-summary-date", s.date || today());
  card.append(dateSpan);

  const textBox = el("pre", "log-summary-text", s.text);
  card.append(textBox);

  if (s.approved_at) {
    const ts = new Date(s.approved_at * 1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
    card.append(el("div", "log-summary-approved", `✓ approved ${ts}`));
  } else {
    const btn = el("button", "log-approve-btn", "APPROVE");
    btn.addEventListener("click", async () => {
      await fetch(`/api/l/summary/${s.date}/approve`, { method: "POST" }).catch(() => {});
      await loadSummary();
      paintSummary(body);
    });
    card.append(btn);
  }
  body.append(card);
}

// ------------------------------------------------------------------ //
// EXPORT sub-screen
// ------------------------------------------------------------------ //

function paintExport(body) {
  body.replaceChildren();

  const hdr = el("div", "log-section-header", "EXPORT LOG");
  body.append(hdr);

  const form = el("div", "log-export-form");
  const fromLabel = el("label", "log-export-label", "FROM ");
  const fromInput = el("input", "log-export-date");
  fromInput.type = "date"; fromInput.value = local.exportFrom || today();
  const toLabel = el("label", "log-export-label", "TO ");
  const toInput = el("input", "log-export-date");
  toInput.type = "date"; toInput.value = local.exportTo || today();
  const btn = el("button", "log-export-btn", "EXPORT MD");

  btn.addEventListener("click", async () => {
    local.exportFrom = fromInput.value;
    local.exportTo   = toInput.value;
    try {
      const r = await fetch(`/api/l/export?from=${local.exportFrom}&to=${local.exportTo}&fmt=json`);
      const j = await r.json();
      local.exportResult = j.text;
    } catch (_) { local.exportResult = "Export failed."; }
    paintExport(body);
  });

  form.append(fromLabel, fromInput, toLabel, toInput, btn);
  body.append(form);

  if (local.exportResult) {
    const pre = el("pre", "log-export-preview", local.exportResult);
    body.append(pre);
  }
}

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
