// Command palette — P4 escape valve, opened with `:` from any screen.
// Fuzzy match over the global command registry. Keys: ↑↓ to navigate,
// ↵ to run, Esc to close. Backdrop click also closes.
//
// The palette returns its handle from mountPalette() so the router can
// open() it without a global. For Sprint 1, fuzzy-match is plain
// case-insensitive substring with light scoring; an fzf-style scorer
// can drop in later behind the same .filter() interface.

import { el, txt } from "../chrome/_dom.js";
import { getCommands, registerDefaults } from "./registry.js";

export function mountPalette(root, store) {
  registerDefaults();

  let open = false;
  let query = "";
  let selected = 0;
  let results = [];

  // ----- DOM scaffold (built once, contents replaced on render) -----
  const wrap = el("div", "palette");
  const head = el("div", "palette-input");
  const sigil = el("span", "sigil", txt(":"));
  const field = el("span", "field");
  const queryNode = txt("");
  field.appendChild(queryNode);
  field.appendChild(el("span", "cursor"));
  const hint = el("span", "palette-hint", txt("[ESC to close · ↑↓ to nav · ↵ run]"));
  head.append(sigil, field, hint);
  const list = el("div", "palette-list");
  wrap.append(head, list);
  root.appendChild(wrap);

  // Backdrop click closes (root is the palette-wrap; clicks on .palette
  // bubble but we stop them so only the backdrop counts).
  root.addEventListener("click", (e) => { if (e.target === root) close(); });
  wrap.addEventListener("click", (e) => e.stopPropagation());

  function render() {
    queryNode.nodeValue = query;
    list.replaceChildren(...results.map((cmd, i) => {
      const row = el("div", "palette-row" + (i === selected ? " sel" : ""));
      row.append(
        el("span", "name", highlight(cmd.id, query)),
        el("span", "hint", txt(cmd.label || "")),
      );
      row.addEventListener("click", () => run(cmd));
      return row;
    }));
  }

  function recompute() {
    results = filter(getCommands(), query);
    selected = Math.min(selected, Math.max(0, results.length - 1));
    render();
  }

  function show() {
    if (open) return;
    open = true;
    query = "";
    selected = 0;
    recompute();
    root.classList.add("show");
  }

  function close() {
    if (!open) return;
    open = false;
    root.classList.remove("show");
  }

  function run(cmd) {
    close();
    try { cmd.run({ store }); }
    catch (e) { console.error("[palette] command threw", e); }
  }

  // Capture key events while open so other handlers (router) don't see
  // them. Router stays the source of truth for `:` to open.
  document.addEventListener("keydown", (e) => {
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selected = Math.min(selected + 1, results.length - 1);
      render();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
      render();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (results[selected]) run(results[selected]);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      query = query.slice(0, -1);
      recompute();
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      query += e.key.toLowerCase();
      recompute();
    }
  }, { capture: true });

  return { show, close, isOpen: () => open };
}

// Returns commands whose id contains all chars of `q` (in order). When
// `q` is empty, returns the full registry. Light tie-break: prefix
// matches first, then shorter ids first.
function filter(commands, q) {
  if (!q) return commands.slice(0, 50);
  const ql = q.toLowerCase();
  const scored = [];
  for (const c of commands) {
    const id = c.id.toLowerCase();
    let score = scoreOrdered(id, ql);
    if (score >= 0) scored.push([score, id.length, c]);
  }
  scored.sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]));
  return scored.map((row) => row[2]).slice(0, 50);
}

// Returns a positive score if every char of `needle` appears in
// `haystack` in order, with bonuses for prefix and contiguous matches.
function scoreOrdered(haystack, needle) {
  let i = 0, score = 0, contig = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) {
      score += 1;
      if (j === 0) score += 5;
      contig += 1;
      score += contig;
      i++;
    } else {
      contig = 0;
    }
  }
  return i === needle.length ? score : -1;
}

// Wraps matched chars of `q` inside <b> for the rendered command id.
function highlight(id, q) {
  if (!q) return txt(id);
  const node = el("span");
  const ql = q.toLowerCase();
  let i = 0;
  for (const ch of id) {
    if (i < ql.length && ch.toLowerCase() === ql[i]) {
      node.appendChild(el("b", null, txt(ch)));
      i++;
    } else {
      node.appendChild(txt(ch));
    }
  }
  return node;
}
