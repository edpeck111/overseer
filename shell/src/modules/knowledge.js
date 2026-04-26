// KNOWLEDGE module — chat + library + branches.
//
// Sprint 5 scope: hotkey K mounts the module on the chat sub-screen.
// Sub-screens routed by C (chat), L (library), B (branches). The
// content router (main.js) sees only KNOWLEDGE — internal sub-screen
// state lives here and survives unmount only via the store.

import { el, txt } from "../chrome/_dom.js";

const SUB_HOTKEYS = { C: "chat", L: "library", B: "branches" };

// Module-local state, kept alongside the store so a brief unmount
// (HOME→KNOWLEDGE→HOME→KNOWLEDGE) doesn't lose the active session.
const local = {
  sessionId: null,
  sub:       "chat",
  history:   [],            // [{role, content, citations?}, ...]
  archives:  null,
  articles:  {},            // archive -> [{id,title}]
  selected:  { archive: null, article: null, preview: null },
  branches:  null,
};

export function mountKnowledge(root, store, ctx) {
  const screen = el("div", "screen-knowledge knowledge");
  root.replaceChildren(screen);

  const tabbar = el("div", "kb-tabs");
  const body   = el("div", "kb-body");
  screen.append(tabbar, body);

  function paint() {
    // tabs
    tabbar.replaceChildren(...["chat", "library", "branches"].map((s) => {
      const tab = el("span", "kb-tab" + (local.sub === s ? " active" : ""));
      tab.append(el("span", "k", s[0].toUpperCase()), el("span", "l", s));
      tab.addEventListener("click", () => { local.sub = s; paint(); });
      return tab;
    }));
    if (local.sub === "chat")     paintChat(body, ctx);
    if (local.sub === "library")  paintLibrary(body, ctx);
    if (local.sub === "branches") paintBranches(body, ctx);
  }

  // sub-screen hotkeys (C/L/B) only fire when the chat input doesn't
  // have focus — typing in chat shouldn't switch tabs.
  function onKey(e) {
    if (e.target && e.target.tagName === "INPUT" && document.activeElement === e.target) return;
    if (!SUB_HOTKEYS[e.key]) return;
    local.sub = SUB_HOTKEYS[e.key];
    e.preventDefault();
    paint();
  }
  document.addEventListener("keydown", onKey, true);

  paint();
  return function unmount() {
    document.removeEventListener("keydown", onKey, true);
  };
}

// --------------------------- chat sub-screen ---------------------------
async function paintChat(body, ctx) {
  body.replaceChildren();
  const log = el("div", "kb-log");
  body.appendChild(log);

  // Render existing turns
  for (const t of local.history) renderTurn(log, t, ctx);
  log.scrollTop = log.scrollHeight;

  const inputRow = el("div", "kb-input");
  const sigil = el("span", "sigil", txt(">"));
  const field = el("input", "field");
  field.type = "text";
  field.placeholder = "ask · or /branch /cite N /save name";
  field.autofocus = true;
  field.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = field.value.trim();
    if (!q) return;
    field.value = "";
    await handleInput(q, log, ctx);
  });
  inputRow.append(sigil, field);
  body.appendChild(inputRow);
  setTimeout(() => field.focus(), 0);
}

async function handleInput(text, log, ctx) {
  // Slash commands
  if (text.startsWith("/")) {
    const [cmd, ...rest] = text.slice(1).split(" ");
    if (cmd === "branch") {
      await branchCurrent(log, ctx);
      return;
    }
    if (cmd === "cite") {
      const idx = parseInt(rest[0] || "1", 10) - 1;
      const lastCited = [...local.history].reverse().find((t) => t.citations && t.citations.length);
      if (lastCited && lastCited.citations[idx]) {
        openCitation(lastCited.citations[idx]);
      }
      return;
    }
    if (cmd === "forget") {
      local.history = [];
      local.sessionId = null;
      return paintChat(document.querySelector(".kb-body"), ctx);
    }
    appendTurn(log, "system", `[unknown command: /${cmd}]`);
    return;
  }

  // Normal user query
  const userTurn = { role: "user", content: text };
  local.history.push(userTurn);
  renderTurn(log, userTurn, ctx);

  const overseer = { role: "overseer", content: "", citations: [] };
  local.history.push(overseer);
  const turnEl = renderTurn(log, overseer, ctx);
  log.scrollTop = log.scrollHeight;

  // Stream the response. fetch() to /api/k/query returns NDJSON; we
  // read it as text and parse line-by-line.
  try {
    const res = await fetch("/api/k/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, session_id: local.sessionId }),
    });
    if (!res.ok) throw new Error(`/api/k/query → ${res.status}`);
    const all = await res.text();
    for (const line of all.split("\n")) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line);
      if (chunk.session_id) local.sessionId = chunk.session_id;
      if (chunk.tokens) overseer.content += chunk.tokens;
      if (chunk.citations) overseer.citations = chunk.citations;
      // Repaint just the active overseer turn
      turnEl.replaceWith(renderTurn(null, overseer, ctx, turnEl));
      log.scrollTop = log.scrollHeight;
    }
  } catch (e) {
    overseer.content += `\n[error: ${e.message}]`;
    turnEl.replaceWith(renderTurn(null, overseer, ctx));
  }
}

function renderTurn(log, turn, ctx, replaceTarget) {
  const wrap = el("div", "kb-turn kb-turn-" + turn.role);
  const sigil = turn.role === "user" ? "> " : turn.role === "overseer" ? "[OVERSEER] " : "[!] ";
  wrap.appendChild(el("span", "kb-sigil", txt(sigil)));
  const body = el("span", "kb-body-text");

  // Render content; convert [N] to clickable spans that open the
  // matching citation in library.
  const citations = turn.citations || [];
  const re = /\[(\d+)\]/g;
  let last = 0, m;
  const text = turn.content;
  while ((m = re.exec(text))) {
    if (m.index > last) body.appendChild(txt(text.slice(last, m.index)));
    const idx = parseInt(m[1], 10) - 1;
    const link = el("span", "kb-cite", txt(`[${m[1]}]`));
    if (citations[idx]) {
      link.addEventListener("click", () => openCitation(citations[idx]));
      link.title = `${citations[idx].archive} · ${citations[idx].article} · ¶${citations[idx].paragraph}`;
    }
    body.appendChild(link);
    last = m.index + m[0].length;
  }
  if (last < text.length) body.appendChild(txt(text.slice(last)));
  wrap.appendChild(body);

  if (log) log.appendChild(wrap);
  return wrap;
}

function appendTurn(log, role, content) {
  local.history.push({ role, content });
  renderTurn(log, { role, content }, null);
  log.scrollTop = log.scrollHeight;
}

async function branchCurrent(log, ctx) {
  if (!local.sessionId) {
    appendTurn(log, "system", "[no active session to branch from — ask a question first]");
    return;
  }
  try {
    const r = await fetch(`/api/k/session/${local.sessionId}/branch`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const j = await r.json();
    appendTurn(log, "system", `[branched session ${local.sessionId} → ${j.id}]`);
    local.sessionId = j.id;
    // Carry forward chat history visually but the new session starts fresh server-side.
  } catch (e) {
    appendTurn(log, "system", `[branch failed: ${e.message}]`);
  }
}

function openCitation(c) {
  local.sub = "library";
  local.selected.archive = c.archive;
  local.selected.article = c.article;
  local.selected.previewParagraph = c.paragraph;
  // Trigger a repaint by re-running mount? Easier: request paint via
  // the screen-tab click handler. Cheapest: dispatch a click on the
  // library tab node.
  const lib = document.querySelector(".kb-tab.l, .kb-tab:nth-child(2)");
  if (lib) lib.click();
  else {
    const allTabs = document.querySelectorAll(".kb-tab");
    if (allTabs[1]) allTabs[1].click();
  }
}

// --------------------------- library sub-screen ---------------------------
async function paintLibrary(body, ctx) {
  body.replaceChildren();
  const cols = el("div", "kb-miller");
  const archCol = el("div", "kb-col");
  const artCol  = el("div", "kb-col");
  const prevCol = el("div", "kb-col kb-preview");
  cols.append(archCol, artCol, prevCol);
  body.appendChild(cols);

  archCol.appendChild(el("div", "kb-col-title", txt("ARCHIVES")));
  artCol.appendChild(el("div", "kb-col-title", txt("ARTICLES")));
  prevCol.appendChild(el("div", "kb-col-title", txt("PREVIEW")));

  // Fetch archives if not cached
  if (!local.archives) {
    try {
      const r = await fetch("/api/k/library/archives");
      local.archives = await r.json();
    } catch { local.archives = []; }
  }

  for (const a of local.archives) {
    const row = el("div", "kb-item" + (local.selected.archive === a.key ? " active" : ""));
    row.append(
      el("span", "kb-name", txt(a.label)),
      el("span", "kb-meta", txt(`${a.articles} · ${a.size_gb}GB`)),
    );
    row.addEventListener("click", async () => {
      local.selected.archive = a.key;
      local.selected.article = null;
      local.selected.preview = null;
      // Fetch articles for this archive
      try {
        const r = await fetch(`/api/k/library/articles?archive=${encodeURIComponent(a.key)}`);
        local.articles[a.key] = await r.json();
      } catch { local.articles[a.key] = []; }
      paintLibrary(body, ctx);
    });
    archCol.appendChild(row);
  }

  if (local.selected.archive) {
    const arts = local.articles[local.selected.archive] || [];
    for (const art of arts) {
      const row = el("div", "kb-item" + (local.selected.article === art.id ? " active" : ""));
      row.append(el("span", "kb-name", txt(art.title)));
      row.addEventListener("click", async () => {
        local.selected.article = art.id;
        try {
          const r = await fetch(`/api/k/library/article?archive=${encodeURIComponent(local.selected.archive)}&id=${encodeURIComponent(art.id)}`);
          local.selected.preview = await r.json();
        } catch { local.selected.preview = { error: "fetch failed" }; }
        paintLibrary(body, ctx);
      });
      artCol.appendChild(row);
    }
  }

  if (local.selected.preview) {
    const p = local.selected.preview;
    if (p.error) {
      prevCol.appendChild(el("div", "kb-error", txt(p.error)));
    } else {
      prevCol.appendChild(el("h3", "kb-preview-title", txt(p.title)));
      const focused = local.selected.previewParagraph;
      (p.paragraphs || []).forEach((para, i) => {
        const cls = "kb-para" + (focused === i ? " focused" : "");
        prevCol.appendChild(el("p", cls, txt(`¶${i+1}  ${para}`)));
      });
      // Scroll the focused paragraph into view
      if (focused !== undefined && focused !== null) {
        setTimeout(() => {
          const focusedEl = prevCol.querySelector(".kb-para.focused");
          if (focusedEl) focusedEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 0);
      }
    }
  } else if (local.selected.archive) {
    prevCol.appendChild(el("div", "kb-empty", txt("select an article →")));
  } else {
    prevCol.appendChild(el("div", "kb-empty", txt("← select an archive")));
  }
}

// --------------------------- branches sub-screen ---------------------------
async function paintBranches(body, ctx) {
  body.replaceChildren();
  body.appendChild(el("div", "kb-col-title", txt("CONVERSATION TREE")));
  const tree = el("pre", "kb-tree");
  body.appendChild(tree);

  try {
    const r = await fetch("/api/k/branches");
    const data = await r.json();
    if (!data.roots || data.roots.length === 0) {
      tree.textContent = "(no sessions yet — start a chat in the C tab)";
      return;
    }
    let lines = [];
    function walk(node, depth) {
      const pad = "  ".repeat(depth);
      const star = node.pinned ? "★ " : "  ";
      const active = (local.sessionId === node.id) ? "● " : "  ";
      lines.push(`${pad}${active}${star}#${node.id}  ${node.name}  (${node.turns_count} turns)`);
      for (const c of node.children) walk(c, depth + 1);
    }
    for (const r of data.roots) walk(r, 0);
    tree.textContent = lines.join("\n");
  } catch (e) {
    tree.textContent = `[error: ${e.message}]`;
  }
}
