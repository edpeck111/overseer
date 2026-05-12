// HELP & XTRAS module -- hotkey reference, commands, about, lore.
// Sprint 17. Hotkey ? from HOME. Sub-screens:
//   H -- HOTKEYS    all module hotkeys
//   C -- COMMANDS   palette command reference
//   A -- ABOUT      system lore + version
//   L -- LORE       prepper philosophy + field notes

import { el } from "../chrome/_dom.js";
import { MODULES } from "./_registry.js";

const SUBS = { H:"hotkeys", C:"commands", A:"about", L:"lore" };

const local = { sub: "hotkeys" };

const _COMMANDS = [
  { cmd: "goto.<id>",    desc: "Navigate directly to a module (e.g. goto.power)" },
  { cmd: "mod.<id>",     desc: "Alias for goto.<id>" },
  { cmd: "help",         desc: "Open this HELP screen" },
  { cmd: "log.quick",    desc: "Open quick log entry prompt" },
  { cmd: "inventory.add",desc: "Jump to inventory add form" },
  { cmd: "signal.scan",  desc: "Jump to SIGNAL spectrum scan" },
  { cmd: "timeline.search", desc: "Jump to TIMELINE search" },
  { cmd: "comms.compose",desc: "Open COMMS compose window" },
  { cmd: "auspice.daily",desc: "Show today's divination snapshot" },
  { cmd: "system.backup",desc: "Jump to SYSTEM backup status" },
];

const _ABOUT = [
  "OVERSEER v3 — mesh-native field operations system",
  "",
  "A post-collapse command layer: comms, medical, navigation, signals,",
  "logistics, knowledge, and a few creature comforts. Built to run on a",
  "Raspberry Pi 5 with an Orange Pi 5 Max for tile-serving.",
  "",
  "Architecture: BBS-influenced, 80x40 grid, keystroke-first. Every module",
  "is synthetic-first with real hardware behind env flags.",
  "",
  "Branch: v3-redesign. Sprints 0-17 complete.",
  "Gate: 258+ pytest  |  117+ jsdom smoke assertions",
  "",
  "Key bindings: standard ASCII, uppercase hotkeys.",
  "No mouse required. No cloud required. No excuses.",
];

const _LORE = [
  "FIELD NOTES — OVERSEER SYSTEM PHILOSOPHY",
  "",
  "Two is one, one is none.",
  "Redundancy is not paranoia; it is arithmetic.",
  "",
  "The mesh is the network. The network is the community.",
  "Without comms, you are alone. Alone is how you lose.",
  "",
  "Information decays. Log everything. The timeline is memory.",
  "Memory is survival. Survival is the mission.",
  "",
  "SIGNAL: listen before you transmit.",
  "NAVIGATION: know where you are before you plan where to go.",
  "MEDICAL: slow is smooth. Smooth is fast. Fast saves lives.",
  "INVENTORY: what you have is what you have. Know it exactly.",
  "",
  "AUSPICE: the sky has always told time. The stars predate GPS.",
  "Read the moon. Know the tides. Watch for the unexpected.",
  "",
  "RECREATION: a mind without rest makes poor decisions.",
  "Play chess. Read. Tell stories. Stay human.",
  "",
  "-- ALPHA-1",
];

export function mountHelp(root, store, ctx) {
  const screen = el("div", "screen-help help");
  root.replaceChildren(screen);
  const tabs = el("div", "kb-tabs");
  const body = el("div", "kb-body");
  screen.append(tabs, body);

  function paint() {
    const labels = ["hotkeys","commands","about","lore"];
    const keys   = "HCAL";
    tabs.replaceChildren(...labels.map((s, i) => {
      const t = el("span", "kb-tab" + (local.sub === s ? " active" : ""));
      t.append(el("span", "k", keys[i]), el("span", "l", s));
      t.addEventListener("click", () => { local.sub = s; paint(); });
      return t;
    }));
    body.replaceChildren();
    switch (local.sub) {
      case "hotkeys":  paintHotkeys(body);  break;
      case "commands": paintCommands(body); break;
      case "about":    paintAbout(body);    break;
      case "lore":     paintLore(body);     break;
    }
  }

  // ── HOTKEYS ───────────────────────────────────────────────────────────────
  function paintHotkeys(c) {
    c.append(el("div", "hlp-section-title", "MODULE HOTKEYS"));
    const primary   = MODULES.filter(m => m.category === "primary");
    const secondary = MODULES.filter(m => m.category === "secondary");
    for (const [label, group] of [["Primary", primary], ["Secondary", secondary]]) {
      const hdr = el("div", "hlp-group-hdr hlp-dim", label);
      c.append(hdr);
      const grid = el("div", "hlp-hotkey-grid");
      for (const m of group) {
        const row = el("div", "hlp-hotkey-row");
        row.append(
          el("span", "hlp-key k", m.hotkey),
          el("span", "hlp-mod-name hlp-accent", m.name),
          el("span", "hlp-mod-desc hlp-dim", m.desc),
        );
        grid.append(row);
      }
      c.append(grid);
    }
    const nav = el("div", "hlp-group-hdr hlp-dim", "Navigation");
    c.append(nav);
    const navGrid = el("div", "hlp-hotkey-grid");
    for (const [k, desc] of [
      ["Q",     "Return to HOME from any module"],
      [":",     "Open command palette"],
      ["Esc",   "Close palette / cancel"],
      ["Enter", "Confirm / submit"],
    ]) {
      const row = el("div", "hlp-hotkey-row");
      row.append(
        el("span", "hlp-key k", k),
        el("span", "hlp-mod-name hlp-accent", ""),
        el("span", "hlp-mod-desc hlp-dim", desc),
      );
      navGrid.append(row);
    }
    c.append(navGrid);
  }

  // ── COMMANDS ──────────────────────────────────────────────────────────────
  function paintCommands(c) {
    c.append(el("div", "hlp-section-title", "PALETTE COMMANDS  (press : to open)"));
    const grid = el("div", "hlp-cmd-grid");
    for (const cmd of _COMMANDS) {
      const row = el("div", "hlp-cmd-row");
      row.append(
        el("span", "hlp-cmd-name hlp-mono hlp-accent", cmd.cmd),
        el("span", "hlp-cmd-desc hlp-dim", cmd.desc),
      );
      grid.append(row);
    }
    c.append(grid);
  }

  // ── ABOUT ─────────────────────────────────────────────────────────────────
  function paintAbout(c) {
    c.append(el("div", "hlp-section-title", "ABOUT OVERSEER"));
    const box = el("pre", "hlp-text-box", _ABOUT.join("\n"));
    c.append(box);
  }

  // ── LORE ──────────────────────────────────────────────────────────────────
  function paintLore(c) {
    c.append(el("div", "hlp-section-title", "FIELD NOTES"));
    const box = el("pre", "hlp-text-box hlp-lore", _LORE.join("\n"));
    c.append(box);
  }

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
