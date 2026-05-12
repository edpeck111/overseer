/**
 * Sprint 1 boot state. Values are static placeholders chosen to look
 * indistinguishable from a real OVERSEER session (the visual reference
 * uses the same kind of static dressing). Sprint 2 replaces these with
 * data-store events from the transport adapter.
 */
export function initialState() {
  return {
    version: "3.0.1",
    operator: "ALPHA-1",
    system: "OK",
    ai:     "QWEN-7B",
    kb:     { mounted: 12, total: 12 },
    power:  { pct: 82, runtime: "14d 02h" },
    mesh:   { reachable: 2, known: 3 },
    clock:  { day: 417, hhmm: "23:47" },
    unread: 3,
    alerts: 2,
    crumbs: ["HOME"],
    pill:   "3 UNREAD · 2 ALERTS",
    module: "HOME",
    hotkeys: defaultHotkeyBar(),
  };
}

function defaultHotkeyBar() {
  return [
    { k: "K", l: "knowledge" },
    { k: "C", l: "comms"     },
    { k: "M", l: "medical"   },
    { k: "N", l: "nav"       },
    { k: "P", l: "power"     },
    { k: "L", l: "log"       },
    { k: ":", l: "palette",  variant: "special" },
    { k: "/", l: "search",   variant: "special" },
    { k: "?", l: "help"      },
    { k: "Q", l: "back",     variant: "danger"  },
  ];
}
