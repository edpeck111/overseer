// SYSTEM module -- sysinfo, users, settings, backup.
// Sprint 17. Hotkey X from HOME. Sub-screens:
//   I -- INFO     hardware/OS snapshot
//   U -- USERS    user registry
//   S -- SETTINGS key-value config
//   B -- BACKUP   backup job status
//
// Red/orange admin sub-theme (.screen-system): --accent #ff6b6b

import { el } from "../chrome/_dom.js";

const SUBS = { I:"info", U:"users", S:"settings", B:"backup" };

const local = {
  sub: "info",
  info: null,
  users: null,
  settings: null,
  backup: null,
  newUid: "", newCall: "", newRole: "observer",
  settingKey: "", settingVal: "",
};

export function mountSystem(root, store, ctx) {
  const screen = el("div", "screen-system system");
  root.replaceChildren(screen);
  const tabs = el("div", "kb-tabs");
  const body = el("div", "kb-body");
  screen.append(tabs, body);

  function paint() {
    const labels = ["info","users","settings","backup"];
    const keys   = "IUSB";
    tabs.replaceChildren(...labels.map((s, i) => {
      const t = el("span", "kb-tab" + (local.sub === s ? " active" : ""));
      t.append(el("span", "k", keys[i]), el("span", "l", s));
      t.addEventListener("click", () => { local.sub = s; paint(); });
      return t;
    }));
    body.replaceChildren();
    switch (local.sub) {
      case "info":     paintInfo(body);     break;
      case "users":    paintUsers(body);    break;
      case "settings": paintSettings(body); break;
      case "backup":   paintBackup(body);   break;
    }
  }

  // ── INFO ─────────────────────────────────────────────────────────────────
  function paintInfo(c) {
    const hdr = el("div", "sys-hdr");
    hdr.append(el("div", "sys-title", "SYSTEM INFO"));
    const refresh = el("button", "kb-btn", "R REFRESH");
    hdr.append(refresh);
    c.append(hdr);

    if (!local.info) {
      c.append(el("div", "sys-empty", "Loading..."));
      fetch("/api/x/info").then(r => r.json()).then(d => { local.info = d; paint(); });
      return;
    }

    const i = local.info;
    const rows = [
      ["NODE",     i.node],
      ["OS",       i.os],
      ["ARCH",     i.arch],
      ["PYTHON",   i.python],
      ["CPU CORES",String(i.cpu_cores)],
      ["LOAD 1m",  String(i.load_1m)],
      ["UPTIME",   i.uptime_s != null ? _fmtUptime(i.uptime_s) : "n/a"],
      ["DISK",     i.disk ? `${i.disk.free_gb} GB free / ${i.disk.total_gb} GB total` : "n/a"],
    ];
    const grid = el("div", "sys-kv-grid");
    for (const [k, v] of rows) {
      const row = el("div", "sys-kv-row");
      row.append(el("span", "sys-kv-key sys-dim", k), el("span", "sys-kv-val sys-mono", v));
      grid.append(row);
    }
    c.append(grid);
    refresh.addEventListener("click", () => { local.info = null; paint(); });
  }

  function _fmtUptime(s) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  }

  // ── USERS ─────────────────────────────────────────────────────────────────
  function paintUsers(c) {
    const hdr = el("div", "sys-hdr");
    hdr.append(el("div", "sys-title", "USER REGISTRY"));
    const refresh = el("button", "kb-btn", "R REFRESH");
    hdr.append(refresh);
    c.append(hdr);

    if (!local.users) {
      c.append(el("div", "sys-empty", "Loading..."));
      fetch("/api/x/users").then(r => r.json()).then(d => { local.users = d.users; paint(); });
      return;
    }

    const grid = el("div", "sys-user-grid");
    const hdrRow = el("div", "sys-user-row sys-user-hdr");
    hdrRow.append(
      el("span", "sys-u-uid",  "UID"),
      el("span", "sys-u-call", "CALLSIGN"),
      el("span", "sys-u-role", "ROLE"),
      el("span", "sys-u-seen", "LAST SEEN"),
      el("span", "sys-u-st",   ""),
    );
    grid.append(hdrRow);
    for (const u of local.users) {
      const row = el("div", "sys-user-row");
      const age = u.last_seen ? _fmtAge(u.last_seen) : "never";
      row.append(
        el("span", "sys-u-uid  sys-mono sys-accent", u.uid),
        el("span", "sys-u-call", u.callsign),
        el("span", "sys-u-role sys-dim", u.role),
        el("span", "sys-u-seen sys-dim sys-mono", age),
        el("span", "sys-u-st", u.active ? "●" : "○"),
      );
      grid.append(row);
    }
    c.append(grid);

    // Add user form
    const form = el("div", "sys-add-form");
    const uidIn  = el("input", "sys-inp"); uidIn.placeholder  = "UID";
    const callIn = el("input", "sys-inp"); callIn.placeholder = "Callsign";
    const roleIn = el("select", "sys-sel");
    for (const r of ["observer","operator","admin"]) {
      const o = el("option", "", r); o.value = r; roleIn.append(o);
    }
    const addBtn = el("button", "kb-btn sys-add-btn", "+ ADD");
    form.append(
      el("span", "sys-dim", "Add user: "),
      uidIn, callIn, roleIn, addBtn,
    );
    c.append(form);

    addBtn.addEventListener("click", () => {
      if (!uidIn.value.trim()) return;
      fetch("/api/x/users", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({uid: uidIn.value.trim(), callsign: callIn.value.trim(), role: roleIn.value}),
      }).then(r => r.json()).then(() => { local.users = null; paint(); });
    });
    refresh.addEventListener("click", () => { local.users = null; paint(); });
  }

  function _fmtAge(ts) {
    const s = Math.round(Date.now()/1000 - ts);
    if (s < 60)   return s + "s ago";
    if (s < 3600) return Math.floor(s/60) + "m ago";
    return Math.floor(s/3600) + "h ago";
  }

  // ── SETTINGS ─────────────────────────────────────────────────────────────
  function paintSettings(c) {
    const hdr = el("div", "sys-hdr");
    hdr.append(el("div", "sys-title", "SETTINGS"));
    const refresh = el("button", "kb-btn", "R REFRESH");
    hdr.append(refresh);
    c.append(hdr);

    if (!local.settings) {
      c.append(el("div", "sys-empty", "Loading..."));
      fetch("/api/x/settings").then(r => r.json()).then(d => { local.settings = d.settings; paint(); });
      return;
    }

    const grid = el("div", "sys-kv-grid");
    for (const [k, v] of Object.entries(local.settings)) {
      const row = el("div", "sys-kv-row sys-setting-row");
      const keyEl = el("span", "sys-kv-key sys-accent", k);
      const valEl = el("span", "sys-kv-val sys-mono", v);
      const editBtn = el("button", "kb-btn sys-edit-btn", "E");
      row.append(keyEl, valEl, editBtn);
      editBtn.addEventListener("click", () => {
        const newVal = prompt(`Set ${k} =`, v);
        if (newVal === null) return;
        fetch("/api/x/settings", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({key: k, value: newVal}),
        }).then(() => { local.settings = null; paint(); });
      });
      grid.append(row);
    }
    c.append(grid);
    refresh.addEventListener("click", () => { local.settings = null; paint(); });
  }

  // ── BACKUP ───────────────────────────────────────────────────────────────
  function paintBackup(c) {
    const hdr = el("div", "sys-hdr");
    hdr.append(el("div", "sys-title", "BACKUP STATUS"));
    const refresh = el("button", "kb-btn", "R REFRESH");
    hdr.append(refresh);
    c.append(hdr);

    if (!local.backup) {
      c.append(el("div", "sys-empty", "Loading..."));
      fetch("/api/x/backup").then(r => r.json()).then(d => { local.backup = d.jobs; paint(); });
      return;
    }

    for (const job of local.backup) {
      const row = el("div", "sys-backup-row");
      const statusCls = job.status === "ok" ? "sys-ok" : job.status === "error" ? "sys-err" : "sys-warn";
      row.append(
        el("span", "sys-bk-target sys-accent", job.target),
        el("span", "sys-bk-status " + statusCls, job.status.toUpperCase()),
        el("span", "sys-bk-size sys-mono sys-dim",
           job.size_mb > 0 ? job.size_mb.toFixed(1) + " MB" : "--"),
        el("span", "sys-bk-path sys-dim", job.path),
      );
      const trigger = el("button", "kb-btn sys-trigger-btn", "RUN");
      trigger.addEventListener("click", () => {
        fetch("/api/x/backup/trigger", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({id: job.id}),
        }).then(() => { local.backup = null; paint(); });
      });
      row.append(trigger);
      c.append(row);
    }

    refresh.addEventListener("click", () => { local.backup = null; paint(); });
  }

  // ── keyboard ──────────────────────────────────────────────────────────────
  function onKey(e) {
    const k = e.key.toUpperCase();
    if (SUBS[k]) { local.sub = SUBS[k]; paint(); }
  }
  screen.setAttribute("tabindex", "0");
  screen.addEventListener("keydown", onKey);
  screen.focus();
  paint();
  return () => screen.removeEventListener("keydown", onKey);
}
