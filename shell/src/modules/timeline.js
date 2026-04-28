// TIMELINE module — unified chronological view across all modules.
//
// Sprint 11. Hotkey T from HOME. Sub-screens:
//   F — FEED     scrollable event stream (default)
//   S — SEARCH   full-text + kind + who filters
//   X — EXPORT   markdown export by date range
//
// Range selector: 1(24h) 3(72h) 7(7d) M(30d) A(all)

import { el } from "../chrome/_dom.js";

const SUBS  = { F: "feed", S: "search", X: "export" };
const RANGES = [
  { key: "1", label: "24h",  hours: 24  },
  { key: "3", label: "72h",  hours: 72  },
  { key: "7", label: "7d",   hours: 168 },
  { key: "M", label: "30d",  hours: 720 },
  { key: "A", label: "all",  hours: null },
];

// Module colour map for the kind badge
const MOD_CLASS = {
  log:        "tl-mod-log",
  comms:      "tl-mod-comms",
  medical:    "tl-mod-med",
  triage:     "tl-mod-med",
  navigation: "tl-mod-nav",
  inventory:  "tl-mod-inv",
  system:     "tl-mod-sys",
};

const local = {
  sub:         "feed",
  range:       RANGES[1],   // default 72h
  events:      null,
  searchQ:     "",
  searchKind:  "",
  searchWho:   "",
  exportFrom:  "",
  exportTo:    "",
  exportResult: null,
};

export function mountTimeline(root, store, ctx) {
  const screen = el("div", "screen-tl tl");
  root.replaceChildren(screen);
  const tabs = el("div", "kb-tabs");
  const body = el("div", "kb-body");
  screen.append(tabs, body);

  function paint() {
    tabs.replaceChildren(...["feed","search","export"].map((s, i) => {
      const t = el("span", "kb-tab" + (local.sub === s ? " active" : ""));
      t.append(el("span", "k", "FSX"[i]), el("span", "l", s));
      t.addEventListener("click", () => { local.sub = s; paint(); });
      return t;
    }));
    if (local.sub === "feed")   paintFeed(body);
    if (local.sub === "search") paintSearch(body);
    if (local.sub === "export") paintExport(body);
  }

  function onKey(e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")) return;
    if (SUBS[e.key]) { local.sub = SUBS[e.key]; e.preventDefault(); paint(); return; }
    // Range keys 1/3/7/M/A in feed mode
    if (local.sub === "feed") {
      const r = RANGES.find(x => x.key === e.key.toUpperCase());
      if (r) { local.range = r; local.events = null; e.preventDefault(); loadFeed().then(() => paintFeed(body)); }
    }
  }
  document.addEventListener("keydown", onKey, true);

  loadFeed().then(paint);

  return function unmount() {
    document.removeEventListener("keydown", onKey, true);
  };
}

// ------------------------------------------------------------------ //
// FEED sub-screen
// ------------------------------------------------------------------ //

async function loadFeed(opts = {}) {
  const params = new URLSearchParams();
  if (local.range.hours) params.set("range", local.range.hours + "h");
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.q)    params.set("q",    opts.q);
  if (opts.who)  params.set("who",  opts.who);
  try {
    local.events = await (await fetch("/api/t/events?" + params)).json();
  } catch (_) { local.events = []; }
}

function paintFeed(body) {
  body.replaceChildren();

  // Range selector bar
  const rangeBar = el("div", "tl-range-bar");
  for (const r of RANGES) {
    const btn = el("span", "tl-range-btn" + (local.range.key === r.key ? " active" : ""), r.label);
    btn.addEventListener("click", () => {
      local.range = r; local.events = null;
      loadFeed().then(() => paintFeed(body));
    });
    rangeBar.append(btn);
  }
  body.append(rangeBar);

  if (!local.events) {
    body.append(el("div", "kb-empty", "Loading…"));
    return;
  }

  if (!local.events.length) {
    body.append(el("div", "kb-empty", "No events in this range."));
    return;
  }

  const stream = el("div", "tl-stream");
  let curDate = null;
  for (const e of local.events) {
    if (e.date !== curDate) {
      curDate = e.date;
      stream.append(el("div", "tl-date-divider", `D+${e.day_number} · ${e.date}`));
    }
    stream.append(buildEventRow(e));
  }
  body.append(stream);
}

function buildEventRow(e) {
  const row = el("div", "tl-event-row");
  const modKey = e.kind.split(".")[0];
  const modCls = MOD_CLASS[modKey] || "tl-mod-sys";
  row.append(
    el("span", "tl-ev-time", e.time),
    el("span", "tl-ev-kind " + modCls, e.kind),
    el("span", "tl-ev-body", e.body),
  );
  return row;
}

// ------------------------------------------------------------------ //
// SEARCH sub-screen
// ------------------------------------------------------------------ //

function paintSearch(body) {
  body.replaceChildren();

  const filters = el("div", "tl-search-filters");

  const qInput = el("input", "tl-search-q");
  qInput.type = "text"; qInput.placeholder = "search events…";
  qInput.value = local.searchQ;
  qInput.setAttribute("autocomplete", "off");

  const kindInput = el("input", "tl-search-kind");
  kindInput.type = "text"; kindInput.placeholder = "kind prefix (e.g. log)";
  kindInput.value = local.searchKind;
  kindInput.setAttribute("autocomplete", "off");

  const whoInput = el("input", "tl-search-who");
  whoInput.type = "text"; whoInput.placeholder = "who (callsign)";
  whoInput.value = local.searchWho;
  whoInput.setAttribute("autocomplete", "off");

  const btn = el("button", "tl-search-btn", "SEARCH");

  async function doSearch() {
    local.searchQ    = qInput.value;
    local.searchKind = kindInput.value;
    local.searchWho  = whoInput.value;
    await loadFeed({ q: local.searchQ, kind: local.searchKind, who: local.searchWho });
    paintSearchResults(body, resultsDiv);
  }
  btn.addEventListener("click", doSearch);
  [qInput, kindInput, whoInput].forEach(inp =>
    inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doSearch(); }})
  );

  filters.append(qInput, kindInput, whoInput, btn);
  body.append(filters);

  const resultsDiv = el("div", "tl-search-results");
  body.append(resultsDiv);
}

function paintSearchResults(body, resultsDiv) {
  resultsDiv.replaceChildren();
  if (!local.events) { resultsDiv.append(el("div", "kb-empty", "Loading…")); return; }
  if (!local.events.length) { resultsDiv.append(el("div", "kb-empty", "No matches.")); return; }
  const stream = el("div", "tl-stream");
  for (const e of local.events) stream.append(buildEventRow(e));
  resultsDiv.append(stream);
}

// ------------------------------------------------------------------ //
// EXPORT sub-screen
// ------------------------------------------------------------------ //

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function paintExport(body) {
  body.replaceChildren();
  body.append(el("div", "tl-section-hdr", "EXPORT TIMELINE"));

  const form = el("div", "tl-export-form");
  const fromLabel = el("label", "tl-export-label", "FROM ");
  const fromInput = el("input", "tl-export-date");
  fromInput.type = "date"; fromInput.value = local.exportFrom || todayStr();
  const toLabel = el("label", "tl-export-label", "TO ");
  const toInput = el("input", "tl-export-date");
  toInput.type = "date"; toInput.value = local.exportTo || todayStr();
  const btn = el("button", "tl-export-btn", "EXPORT MD");

  btn.addEventListener("click", async () => {
    local.exportFrom = fromInput.value;
    local.exportTo   = toInput.value;
    try {
      const r = await fetch(`/api/t/export?from=${local.exportFrom}&to=${local.exportTo}&fmt=json`);
      local.exportResult = (await r.json()).text;
    } catch (_) { local.exportResult = "Export failed."; }
    paintExport(body);
  });

  form.append(fromLabel, fromInput, toLabel, toInput, btn);
  body.append(form);

  if (local.exportResult) {
    body.append(el("pre", "tl-export-preview", local.exportResult));
  }
}
