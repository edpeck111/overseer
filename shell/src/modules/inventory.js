// INVENTORY module — categories, items, expiry, low-stock, pack optimizer.
//
// Sprint 10. Hotkey I from HOME. Sub-screens:
//   B — BROWSE    three-pane: categories › items › detail
//   E — EXPIRING  items expiring within 90 days
//   L — LOW       items below threshold
//   P — PACK      mission pack optimizer

import { el, txt } from "../chrome/_dom.js";

const SUBS = { B: "browse", E: "expiring", L: "low", P: "pack" };

const local = {
  sub: "browse",
  cats: null,
  selectedCat: null,
  items: null,
  selectedItem: null,
  expiring: null,
  low: null,
  pack: null,
  packMission: "48h patrol",
};

const MISSIONS = ["48h patrol", "14d bug-out", "winter overnight"];

export function mountInventory(root, store, ctx) {
  const screen = el("div", "screen-inv inv");
  root.replaceChildren(screen);
  const tabs = el("div", "kb-tabs");
  const body = el("div", "kb-body");
  screen.append(tabs, body);

  function paint() {
    tabs.replaceChildren(...["browse","expiring","low","pack"].map((s, i) => {
      const t = el("span", "kb-tab" + (local.sub === s ? " active" : ""));
      t.append(el("span", "k", "BELP"[i]), el("span", "l", s));
      t.addEventListener("click", () => { local.sub = s; paint(); });
      return t;
    }));
    if (local.sub === "browse")   paintBrowse(body);
    if (local.sub === "expiring") paintExpiring(body);
    if (local.sub === "low")      paintLow(body);
    if (local.sub === "pack")     paintPack(body);
  }

  function onKey(e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")) return;
    if (!SUBS[e.key]) return;
    local.sub = SUBS[e.key]; e.preventDefault(); paint();
  }
  document.addEventListener("keydown", onKey, true);

  loadCats().then(paint);

  return function unmount() {
    document.removeEventListener("keydown", onKey, true);
  };
}

// ------------------------------------------------------------------ //
// BROWSE — three-pane Miller columns
// ------------------------------------------------------------------ //

async function loadCats() {
  try { local.cats = await (await fetch("/api/i/categories")).json(); }
  catch (_) { local.cats = []; }
}

async function loadItems(catId) {
  try {
    const url = catId != null ? `/api/i/items?category=${catId}` : "/api/i/items";
    local.items = await (await fetch(url)).json();
  } catch (_) { local.items = []; }
}

function paintBrowse(body) {
  body.replaceChildren();
  const grid = el("div", "inv-miller");

  // Col 1 — categories
  const col1 = el("div", "inv-col inv-col-cats");
  col1.append(el("div", "inv-col-hdr", "CATEGORIES"));
  const catList = el("div", "inv-col-body");
  (local.cats || []).forEach(c => {
    const row = el("div", "inv-cat-row" + (local.selectedCat?.id === c.id ? " active" : ""), c.name);
    row.addEventListener("click", () => {
      local.selectedCat  = c;
      local.selectedItem = null;
      local.items        = null;
      loadItems(c.id).then(() => paintBrowse(body));
    });
    catList.append(row);
  });
  col1.append(catList);

  // Col 2 — items
  const col2 = el("div", "inv-col inv-col-items");
  col2.append(el("div", "inv-col-hdr", local.selectedCat ? local.selectedCat.name.toUpperCase() : "ALL ITEMS"));
  const itemList = el("div", "inv-col-body");
  if (!local.items && local.selectedCat) {
    itemList.append(el("div", "kb-empty", "Loading…"));
  } else {
    (local.items || []).forEach(it => {
      const row = el("div", "inv-item-row" + (local.selectedItem?.id === it.id ? " active" : ""));
      const nameSpan = el("span", "inv-item-name", it.name);
      const qtySpan  = el("span", "inv-item-qty" + (it.low ? " low" : ""), `×${it.qty}`);
      row.append(nameSpan, qtySpan);
      if (it.exp_days != null && it.exp_days < 60) row.classList.add("expiring-soon");
      row.addEventListener("click", () => {
        local.selectedItem = it;
        paintBrowse(body);
      });
      itemList.append(row);
    });
    if (!(local.items || []).length) {
      itemList.append(el("div", "kb-empty", local.selectedCat ? "No items in this category." : "Select a category."));
    }
  }
  col2.append(itemList);

  // Col 3 — detail
  const col3 = el("div", "inv-col inv-col-detail");
  col3.append(el("div", "inv-col-hdr", "DETAIL"));
  if (local.selectedItem) {
    col3.append(buildDetail(local.selectedItem));
  } else {
    col3.append(el("div", "kb-empty", "Select an item."));
  }

  grid.append(col1, col2, col3);
  body.append(grid);
}

function buildDetail(it) {
  const d = el("div", "inv-detail");
  const name = el("div", "inv-detail-name", it.name);
  d.append(name);

  const rows = [
    ["Qty",      `${it.qty} ${it.unit}`],
    ["Location", it.location || "—"],
    ["Weight",   it.weight_g ? `${it.weight_g}g` : "—"],
    ["Calories", it.kcal ? `${it.kcal} kcal` : "—"],
    it.exp_days != null
      ? ["Expires", `${it.exp_days >= 0 ? `in ${it.exp_days}d` : "EXPIRED"}${it.exp_days < 60 ? " ⚠" : ""}`]
      : ["Expires", "—"],
    ["Notes",    it.notes || "—"],
  ];
  const tbl = el("div", "inv-detail-tbl");
  for (const [k, v] of rows) {
    const row = el("div", "inv-detail-row");
    row.append(el("span", "inv-detail-k", k), el("span", "inv-detail-v", v));
    tbl.append(row);
  }
  d.append(tbl);

  // Quick consume button
  const btn = el("button", "inv-consume-btn", "USE 1");
  btn.addEventListener("click", async () => {
    await fetch("/api/i/event", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({item_id: it.id, delta: -1, reason: "manual"}),
    }).catch(() => {});
    await loadItems(local.selectedCat?.id ?? null);
    local.selectedItem = local.items?.find(x => x.id === it.id) ?? null;
    paintBrowse(document.querySelector(".inv .kb-body"));
  });
  d.append(btn);
  return d;
}

// ------------------------------------------------------------------ //
// EXPIRING sub-screen
// ------------------------------------------------------------------ //

async function loadExpiring() {
  try { local.expiring = await (await fetch("/api/i/expiring?within=90")).json(); }
  catch (_) { local.expiring = []; }
}

function paintExpiring(body) {
  body.replaceChildren();
  body.append(el("div", "inv-section-hdr", "EXPIRING WITHIN 90 DAYS"));

  if (!local.expiring) {
    loadExpiring().then(() => paintExpiring(body));
    body.append(el("div", "kb-empty", "Loading…"));
    return;
  }
  if (!local.expiring.length) {
    body.append(el("div", "kb-empty", "Nothing expiring soon. ✓"));
    return;
  }
  const list = el("div", "inv-exp-list");
  for (const it of local.expiring) {
    const row = el("div", "inv-exp-row");
    const urgency = it.exp_days < 14 ? " urgent" : it.exp_days < 30 ? " warn" : "";
    row.append(
      el("span", "inv-exp-name", it.name),
      el("span", "inv-exp-days" + urgency, `${it.exp_days}d`),
      el("span", "inv-exp-qty", `×${it.qty} ${it.unit}`),
    );
    list.append(row);
  }
  body.append(list);
}

// ------------------------------------------------------------------ //
// LOW sub-screen
// ------------------------------------------------------------------ //

async function loadLow() {
  try { local.low = await (await fetch("/api/i/low")).json(); }
  catch (_) { local.low = []; }
}

function paintLow(body) {
  body.replaceChildren();
  body.append(el("div", "inv-section-hdr", "BELOW THRESHOLD"));

  if (!local.low) {
    loadLow().then(() => paintLow(body));
    body.append(el("div", "kb-empty", "Loading…"));
    return;
  }
  if (!local.low.length) {
    body.append(el("div", "kb-empty", "All items above threshold. ✓"));
    return;
  }
  const list = el("div", "inv-low-list");
  for (const it of local.low) {
    const row = el("div", "inv-low-row");
    row.append(
      el("span", "inv-low-name", it.name),
      el("span", "inv-low-qty", `${it.qty} / ${it.threshold_qty} ${it.unit}`),
    );
    list.append(row);
  }
  body.append(list);
}

// ------------------------------------------------------------------ //
// PACK optimizer sub-screen
// ------------------------------------------------------------------ //

function paintPack(body) {
  body.replaceChildren();
  body.append(el("div", "inv-section-hdr", "PACK OPTIMIZER"));

  const form = el("div", "inv-pack-form");
  const sel  = el("select", "inv-pack-mission-sel");
  for (const m of MISSIONS) {
    const opt = el("option", "", m); opt.value = m;
    if (m === local.packMission) opt.selected = true;
    sel.append(opt);
  }
  const btn = el("button", "inv-pack-btn", "OPTIMIZE");
  btn.addEventListener("click", async () => {
    local.packMission = sel.value;
    try {
      local.pack = await (await fetch("/api/i/pack/optimize", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({mission: local.packMission}),
      })).json();
    } catch (_) { local.pack = null; }
    paintPack(body);
  });
  form.append(sel, btn);
  body.append(form);

  if (!local.pack) return;
  const p = local.pack;

  const stats = el("div", "inv-pack-stats");
  stats.append(
    el("span", "inv-pack-stat", `${(p.total_weight_g/1000).toFixed(1)}kg`),
    el("span", "inv-pack-stat-label", " weight · "),
    el("span", "inv-pack-stat", `${p.total_kcal}kcal`),
    el("span", "inv-pack-stat-label", " · med: "),
    el("span", "inv-pack-stat" + (p.medical_coverage === "OK" ? " ok" : " warn"), p.medical_coverage),
  );
  body.append(stats);

  const list = el("div", "inv-pack-list");
  for (const it of p.items) {
    const row = el("div", "inv-pack-row");
    row.append(
      el("span", "inv-pack-label inv-pack-label-" + it.label, it.label.slice(0,1).toUpperCase()),
      el("span", "inv-pack-name", it.name),
      el("span", "inv-pack-wt", `${it.weight_g}g`),
    );
    list.append(row);
  }
  body.append(list);
}
