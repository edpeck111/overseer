// Status strip — eight segments, P5 persistent state.
// Subscribes to topics: version, operator, system, ai, kb, power,
// mesh, clock. Re-renders on any change. Segments hide-sm-priority
// from right to left (per design spec §5.1):
//   KB → AI → SYS → MESH → POWER → (BRAND/OP/CLOCK always visible).

import { el, txt } from "./_dom.js";

/** @param {HTMLElement} root */
export function mountStatusBar(root, store) {
  const render = () => {
    const s = store.get();
    root.replaceChildren(
      seg("brand",            ["v",  `OVERSEER`,           "k",  `v${s.version}`]),
      seg("",                 ["k",  "OP",                 "v",  s.operator]),
      seg("hide-sm" + sysCls(s.system), ["k", "SYS",       "v",  s.system]),
      seg("hide-sm",          ["k",  "AI",                 "v",  s.ai]),
      seg("hide-sm",          ["k",  "KB",                 "v",  `${s.kb.mounted}/${s.kb.total}`]),
      seg("hide-sm",          ["k",  "MESH",               "v",  meshDots(s.mesh)]),
      seg(pwrCls(s.power.pct),["k",  "PWR",                "v",  `${s.power.pct}%`]),
      seg("flex",             ["clock", `D+${s.clock.day} · ${s.clock.hhmm}`]),
    );
  };
  for (const k of ["version","operator","system","ai","kb","power","mesh","clock"]) {
    store.subscribe(k, render);
  }
  render();
}

function seg(cls, parts) {
  const node = el("div", `seg ${cls}`);
  for (let i = 0; i < parts.length; i += 2) {
    node.appendChild(el("span", parts[i], txt(parts[i + 1])));
  }
  return node;
}

function pwrCls(pct) { return pct < 15 ? "alert" : pct < 30 ? "warn" : ""; }
function sysCls(sys) { return sys === "FAULT" ? " alert" : sys === "DEGRADED" ? " warn" : ""; }
function meshDots(m) {
  // Reachable filled, missing hollow, e.g. 2 reachable / 3 known => ●●○
  const filled = "●".repeat(Math.max(0, m.reachable));
  const hollow = "○".repeat(Math.max(0, m.known - m.reachable));
  return filled + hollow || "—";
}
