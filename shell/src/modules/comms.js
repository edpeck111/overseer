// COMMS module — three-pane mail + boards + net.
//
// Sprint 6 read path: hotkey C from HOME mounts the module on the mail
// sub-screen. Sub-screens routed by M (mail), B (boards), N (net),
// skipping when an input has focus.
//
// Auth bootstrap: register the active operator (default ALPHA-1) on
// first mount via POST /api/c/contacts/register. A demo recipient
// (BRAVO-2) is registered too so the gate can exercise an exchange.

import { el, txt } from "../chrome/_dom.js";

const ME    = "ALPHA-1";
const PEER  = "BRAVO-2";
const SUBS  = { M: "mail", B: "boards", N: "net" };
const FOLDERS = ["INBOX", "SENT", "DRAFTS", "ARCHIVE", "OUTBOX"];
const BOARDS  = ["general", "intel", "trade", "swap", "sos"];

const local = {
  sub: "mail",
  registered: false,
  folder: "INBOX",
  selected: null,
  inbox: [], sent: [],
  composing: false,
  draft: { to: PEER, subj: "", body: "" },
  boards: [],
  boardPosts: {},
  selectedBoard: null,
  net: [],
};

export function mountComms(root, store, ctx) {
  const screen = el("div", "screen-comms comms");
  root.replaceChildren(screen);
  const tabs = el("div", "kb-tabs");
  const body = el("div", "kb-body");
  screen.append(tabs, body);

  function paint() {
    tabs.replaceChildren(...["mail", "boards", "net"].map((s, i) => {
      const t = el("span", "kb-tab" + (local.sub === s ? " active" : ""));
      t.append(el("span", "k", "MBN"[i]), el("span", "l", s));
      t.addEventListener("click", () => { local.sub = s; paint(); });
      return t;
    }));
    if (local.sub === "mail")   paintMail(body);
    if (local.sub === "boards") paintBoards(body);
    if (local.sub === "net")    paintNet(body);
  }

  function onKey(e) {
    if (e.target && e.target.tagName === "INPUT") return;
    if (e.target && e.target.tagName === "TEXTAREA") return;
    if (!SUBS[e.key]) return;
    local.sub = SUBS[e.key];
    e.preventDefault();
    paint();
  }
  document.addEventListener("keydown", onKey, true);

  bootstrap().then(paint);

  return function unmount() {
    document.removeEventListener("keydown", onKey, true);
  };
}

async function bootstrap() {
  if (local.registered) return;
  try {
    await fetch("/api/c/contacts/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callsign: ME }),
    });
    await fetch("/api/c/contacts/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callsign: PEER }),
    });
    local.registered = true;
  } catch (e) {
    console.warn("[comms] register failed:", e.message);
  }
  await refresh();
}

async function refresh() {
  try {
    const inbox = await (await fetch(`/api/c/inbox/${ME}`)).json();
    local.inbox = inbox || [];
  } catch { local.inbox = []; }
  try {
    const sent = await (await fetch(`/api/c/sent/${ME}`)).json();
    local.sent = sent || [];
  } catch { local.sent = []; }
}

// --------------------------- mail ---------------------------
function paintMail(body) {
  body.replaceChildren();
  const grid = el("div", "comms-grid");
  body.appendChild(grid);

  // Folder pane
  const fpane = el("div", "kb-col comms-folders");
  fpane.appendChild(el("div", "kb-col-title", txt("FOLDERS")));
  for (const f of FOLDERS) {
    const counts = f === "INBOX" ? local.inbox.length : f === "SENT" ? local.sent.length : 0;
    const row = el("div", "comms-folder" + (local.folder === f ? " sel" : ""));
    row.append(
      el("span", "fname", txt(f)),
      el("span", "fct", txt(String(counts))),
    );
    row.addEventListener("click", () => { local.folder = f; local.selected = null; paintMail(body); });
    fpane.appendChild(row);
  }
  grid.appendChild(fpane);

  // Message list pane
  const mpane = el("div", "kb-col comms-msglist");
  const messages = local.folder === "INBOX" ? local.inbox
                 : local.folder === "SENT"  ? local.sent
                 : [];
  mpane.appendChild(el("div", "kb-col-title", txt(local.folder + ` · ${messages.length}`)));
  if (local.folder === "INBOX" || local.folder === "SENT") {
    const composeBtn = el("button", "comms-compose-btn", txt("[N]ew"));
    composeBtn.addEventListener("click", () => { local.composing = true; paintMail(body); });
    mpane.appendChild(composeBtn);
  }
  for (const m of messages) {
    const row = el("div", "comms-row" + (local.selected === m.id ? " sel" : ""));
    const who = local.folder === "INBOX" ? m.from : m.to;
    const verified = m.verified === true ? "⚿ " : (m.verified === false ? "✗ " : "");
    row.append(
      el("span", "from", txt(verified + who)),
      el("span", "subj", txt(m.subj)),
      el("span", "when", txt(formatWhen(m.when))),
    );
    row.addEventListener("click", () => {
      local.selected = m.id;
      local.composing = false;
      paintMail(body);
      // Mark as read on click (for inbox)
      if (local.folder === "INBOX" && m.state !== "read") {
        fetch("/api/c/read", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callsign: ME, ids: [m.id] }),
        }).then(refresh);
      }
    });
    mpane.appendChild(row);
  }
  grid.appendChild(mpane);

  // Detail / compose pane
  const dpane = el("div", "kb-col comms-detail");
  if (local.composing) paintCompose(dpane, body);
  else if (local.selected !== null) paintDetail(dpane, messages.find((x) => x.id === local.selected));
  else dpane.appendChild(el("div", "kb-empty", txt("← select a message · or [N]ew")));
  grid.appendChild(dpane);
}

function paintDetail(pane, msg) {
  if (!msg) { pane.appendChild(el("div", "kb-error", txt("message gone"))); return; }
  pane.appendChild(el("div", "msg-h-row", el("span", "k", txt("FROM")), el("span", "v", txt(msg.from || ""))));
  if (msg.to)  pane.appendChild(el("div", "msg-h-row", el("span", "k", txt("TO")),   el("span", "v", txt(msg.to))));
  pane.appendChild(el("div", "msg-h-row", el("span", "k", txt("SUBJ")), el("span", "v", txt(msg.subj || ""))));
  pane.appendChild(el("div", "msg-h-row",
    el("span", "k", txt("WHEN")),
    el("span", "v", txt(formatWhen(msg.when, true))),
  ));
  if (msg.hops !== undefined) pane.appendChild(el("div", "msg-h-row",
    el("span", "k", txt("HOPS")),
    el("span", "v", txt(`${msg.hops} hop${msg.hops === 1 ? "" : "s"}`)),
  ));
  if (msg.verified !== undefined) pane.appendChild(el("div", "msg-h-row",
    el("span", "k", txt("VERIFY")),
    el("span", "v" + (msg.verified ? " ok" : " bad"), txt(msg.verified ? "⚿ verified" : "✗ FAILED")),
  ));
  pane.appendChild(el("hr"));
  // Markdown-ish body — plain text + paragraph breaks. Real markdown
  // rendering is Sprint 6.5 polish.
  const body = el("div", "msg-body");
  for (const line of (msg.body || "").split("\n")) {
    body.appendChild(el("div", "", txt(line || " ")));
  }
  pane.appendChild(body);
}

function paintCompose(pane, root) {
  pane.appendChild(el("div", "kb-col-title", txt("COMPOSE")));
  const toRow = el("div", "compose-row");
  toRow.append(el("span", "k", txt("TO")));
  const toI = el("input", "field");
  toI.value = local.draft.to;
  toI.addEventListener("input", (e) => { local.draft.to = e.target.value; });
  toRow.appendChild(toI);
  pane.appendChild(toRow);

  const subjRow = el("div", "compose-row");
  subjRow.append(el("span", "k", txt("SUBJ")));
  const sI = el("input", "field");
  sI.value = local.draft.subj;
  sI.addEventListener("input", (e) => { local.draft.subj = e.target.value; });
  subjRow.appendChild(sI);
  pane.appendChild(subjRow);

  const bI = el("textarea", "field compose-body");
  bI.value = local.draft.body;
  bI.placeholder = "message body — markdown rendering arrives in Sprint 6.5";
  bI.addEventListener("input", (e) => { local.draft.body = e.target.value; });
  pane.appendChild(bI);

  const sendBtn = el("button", "comms-send-btn", txt("[S]end"));
  sendBtn.addEventListener("click", async () => {
    const d = local.draft;
    if (!d.to || !d.subj) return;
    sendBtn.textContent = "sending…";
    try {
      const r = await fetch("/api/c/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: ME, to: d.to, subj: d.subj, body: d.body, hops: 1 }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      local.draft = { to: PEER, subj: "", body: "" };
      local.composing = false;
      local.folder = "SENT";
      await refresh();
      paintMail(root);
    } catch (e) {
      sendBtn.textContent = "[S]end (failed: " + e.message + ")";
    }
  });
  pane.appendChild(sendBtn);

  const cancelBtn = el("button", "comms-cancel-btn", txt("Cancel"));
  cancelBtn.addEventListener("click", () => { local.composing = false; paintMail(root); });
  pane.appendChild(cancelBtn);
}

// --------------------------- boards ---------------------------
async function paintBoards(body) {
  body.replaceChildren();
  if (!local.boards.length) {
    try {
      local.boards = await (await fetch("/api/c/boards")).json();
    } catch { local.boards = []; }
  }
  const grid = el("div", "comms-grid comms-boards-grid");
  body.appendChild(grid);

  const list = el("div", "kb-col");
  list.appendChild(el("div", "kb-col-title", txt("BOARDS")));
  for (const b of local.boards) {
    const slug = b.name.replace(/^\//, "");
    const row = el("div", "comms-folder" + (local.selectedBoard === slug ? " sel" : ""));
    row.append(el("span", "fname", txt(b.name)), el("span", "fct", txt(String(b.post_count))));
    row.addEventListener("click", async () => {
      local.selectedBoard = slug;
      try {
        local.boardPosts[slug] = await (await fetch(`/api/c/boards/${slug}`)).json();
      } catch { local.boardPosts[slug] = []; }
      paintBoards(body);
    });
    list.appendChild(row);
  }
  grid.appendChild(list);

  const posts = el("div", "kb-col comms-board-posts");
  if (local.selectedBoard) {
    posts.appendChild(el("div", "kb-col-title", txt("/" + local.selectedBoard + " · posts")));
    const pp = local.boardPosts[local.selectedBoard] || [];
    if (!pp.length) posts.appendChild(el("div", "kb-empty", txt("no posts yet")));
    for (const p of pp) {
      const row = el("div", "board-post");
      row.append(
        el("div", "h", el("span", "from", txt(p.from)), el("span", "when", txt(formatWhen(p.when, true)))),
        el("div", "subj", txt(p.subj)),
        el("div", "body", txt(p.body)),
      );
      posts.appendChild(row);
    }
  } else {
    posts.appendChild(el("div", "kb-empty", txt("← select a board")));
  }
  grid.appendChild(posts);
}

// --------------------------- net ---------------------------
async function paintNet(body) {
  body.replaceChildren();
  body.appendChild(el("div", "kb-col-title", txt("MESH NODES")));
  if (!local.net.length) {
    try { local.net = await (await fetch("/api/c/net")).json(); }
    catch { local.net = []; }
  }
  const list = el("div", "comms-net-list");
  for (const n of local.net) {
    const row = el("div", "net-row");
    const transportColor = n.transport === "wifi" ? "cool" : "amber";
    row.append(
      el("span", "dot " + transportColor, txt(n.transport === "wifi" ? "●" : "◐")),
      el("span", "callsign", txt(n.callsign)),
      el("span", "transport", txt(n.transport.toUpperCase())),
      el("span", "rssi", txt(`${n.rssi}dB`)),
      el("span", "dist", txt(n.dist_m ? `${(n.dist_m/1000).toFixed(1)}km` : "WiFi")),
    );
    list.appendChild(row);
  }
  body.appendChild(list);
}

// --------------------------- helpers ---------------------------
function formatWhen(t, full = false) {
  if (!t) return "";
  const sec = typeof t === "number" ? t : t / 1000;
  const ago = Date.now() / 1000 - sec;
  if (full) return new Date(sec * 1000).toLocaleString();
  if (ago < 60) return Math.floor(ago) + "s";
  if (ago < 3600) return Math.floor(ago / 60) + "m";
  if (ago < 86400) return Math.floor(ago / 3600) + "h";
  return Math.floor(ago / 86400) + "d";
}
