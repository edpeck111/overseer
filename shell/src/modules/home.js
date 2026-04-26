// HOME screen — boot/landing surface. Logo, tagline, flavour rows,
// optional side stack (visible on tablet/desktop), primary + secondary
// menus, prompt line. Sprint 1: static dressing that matches the
// canonical visual reference.

import { el, txt } from "../chrome/_dom.js";
import { MODULES } from "./_registry.js";

export function mountHome(root, store) {
  const screen = el("div", "screen-home home");

  // ----- top: logo + side stack ------------------------------------
  const top = el("div", "home-top");

  const titleCol = el("div");
  const logo = el("div", "logo");
  // VT323 logo block — three lines of CP437 box-drawing.
  logo.innerHTML =
    `<span class="accent">╔═╗ ╦  ╦ ╔═╗ ╦═╗ ╔═╗ ╔═╗ ╔═╗ ╔═╗</span>\n` +
    `<span class="accent">║ ║ ╚╗╔╝ ║╣  ╠╦╝ ╚═╗ ║╣  ║╣  ╠╦╝</span>\n` +
    `<span class="accent">╚═╝  ╚╝  ╚═╝ ╩╚═ ╚═╝ ╚═╝ ╚═╝ ╩╚═</span>`;
  const tagline = el("div", "tagline",
    txt("offline vault · essential records · survival, emergency & endurance response"));
  const flavor = el("div", "flavor");
  const flavorRows = [
    ["UPTIME",     "17d 04h 22m"],
    ["BATTERY",    "82% · 14d 02h", "warn"],
    ["ARCHIVE",    "READY · 12 vols"],
    ["MESH",       "3 nodes seen", "cool"],
    ["LAST QUERY", "02:14 ago"],
    ["WEATHER",    "overcast · 11°C"],
  ];
  for (const [k, v, cls] of flavorRows) {
    const row = el("div", "row");
    row.append(el("span", "k", txt(k)), el("span", "v" + (cls ? " " + cls : ""), txt(v)));
    flavor.appendChild(row);
  }
  titleCol.append(logo, tagline, flavor);
  top.appendChild(titleCol);

  // Side stack: visible on tablet/desktop only (CSS hides on phone).
  const side = el("div", "side-stack hide-on-phone");
  side.append(
    panel("UNREAD MAIL", "3", unreadList()),
    panel("ONE-LINER OF THE DAY", null, oneliner()),
    panel("POWER · 24H", null, sparklineRow()),
  );
  top.appendChild(side);
  screen.appendChild(top);

  // ----- main menu ------------------------------------------------
  const menuWrap = el("div");
  menuWrap.append(menuSection("PRIMARY MODULES",   MODULES.filter((m) => m.category === "primary")));
  menuWrap.append(menuSection("SECONDARY MODULES", MODULES.filter((m) => m.category === "secondary")));
  screen.appendChild(menuWrap);

  // ----- prompt line ----------------------------------------------
  const prompt = el("div", "prompt");
  const sigil = el("span", "sigil", txt(">_"));
  const input = el("span", "input", txt("_"));
  input.appendChild(el("span", "cursor"));
  const promptHint = el("span", "prompt-hint",
    txt("[ press a letter, or "));
  promptHint.appendChild(el("span", "prompt-amber", txt(":")));
  promptHint.appendChild(txt(" for palette ]"));
  prompt.append(sigil, input, promptHint);
  screen.appendChild(prompt);

  // Initial active-class highlight from current module name. We don't
  // subscribe to subsequent module changes here — the content router
  // unmounts HOME entirely when leaving for another module, and
  // remounts fresh on return.
  const active = (store.get("module") || "HOME").toUpperCase();
  for (const item of screen.querySelectorAll(".menu-item")) {
    item.classList.toggle("active", item.dataset.name === active);
  }

  root.replaceChildren(screen);
  return undefined;   // nothing to clean up
}

// --- helpers -------------------------------------------------------

function menuSection(title, mods) {
  const wrap = el("div");
  wrap.appendChild(el("div", "menu-section-title", txt(title)));
  const grid = el("div", "menu");
  for (const m of mods) grid.appendChild(menuItem(m));
  wrap.appendChild(grid);
  return wrap;
}

function menuItem(m) {
  const wrap = el("div", "menu-item");
  wrap.dataset.hotkey = m.hotkey;
  wrap.dataset.name   = m.name;
  wrap.dataset.id     = m.id;
  wrap.append(
    el("span", "key",   txt(m.hotkey)),
    el("span", "label", txt(m.name)),
    el("span", "desc",  txt(m.desc)),
    el("span", "pip" + (m.pipClass ? " " + m.pipClass : ""), txt(m.pip)),
  );
  return wrap;
}

function panel(title, badge, body) {
  const p = el("div", "panel");
  const t = el("div", "panel-title", txt(title));
  if (badge) t.appendChild(el("span", "badge", txt(badge)));
  p.append(t, body);
  return p;
}

function unreadList() {
  const list = el("div", "unread-list");
  const seed = [
    ["BRAVO-2",   "Re: rendezvous shift — copy that", "14m"],
    ["CHARLIE-7", "Cache-7 inventory update",         "02h"],
    ["ECHO-3",    "[BOARD/INTEL] vehicle traffic NW", "06h"],
  ];
  for (const [from, subj, when] of seed) {
    const row = el("div", "msg");
    row.append(
      el("span", "from", txt(from)),
      el("span", "subj", txt(subj)),
      el("span", "when", txt(when)),
    );
    list.appendChild(row);
  }
  return list;
}

function oneliner() {
  const o = el("div", "oneliner");
  o.appendChild(txt("“If you do not change direction, you may end up where you are heading.”"));
  o.appendChild(el("span", "who", txt("— LAO TZU · posted by DELTA-4")));
  return o;
}

function sparklineRow() {
  const row = el("div", "tiny-spark");
  row.innerHTML =
    `<span class="lo">▁▁▂▂▂▃▃</span>` +
    `<span>▄▄▅▅▅▅▆</span>` +
    `<span class="hi">▆▇█▇▆▅▄</span>` +
    `<span>▄▃▃▃▂▂▂</span>`;
  const sub = el("div", "spark-sub", txt("avg 4.2W · peak 11.6W · trough 2.1W"));
  const wrap = el("div");
  wrap.append(row, sub);
  return wrap;
}
