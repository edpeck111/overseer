// Global command registry for the palette.
//
// Modules call register({ id, label, run }) at boot. The registry is a
// flat list (not a tree) on purpose — that's what makes fuzzy match
// work uniformly across "comms.compose" and "encompass.export" and
// "decommission.user" (all match "comm").

const registry = [];

export function register(cmd) {
  // Last-write-wins on duplicate ids — simplifies plugin reload.
  const existing = registry.findIndex((c) => c.id === cmd.id);
  if (existing >= 0) registry[existing] = cmd;
  else registry.push(cmd);
}

/** Return all registered commands (for the palette to filter against). */
export function getCommands() { return registry.slice(); }

/** Sprint 1 seed: one entry per primary module so the palette has
 *  something to match against. Each module sprint will replace these
 *  with richer entries (e.g. comms.compose, knowledge.chat). */
export function registerDefaults() {
  if (registry.length > 0) return;  // already populated
  const modules = [
    ["home",       "go to HOME"],
    ["knowledge",  "K · chat · library"],
    ["comms",      "C · mail · boards · mesh"],
    ["medical",    "M · triage · ref · dose"],
    ["navigation", "N · map · waypoints · route"],
    ["power",      "P · battery · load · radio"],
    ["log",        "L · daily journal"],
    ["inventory",  "I · kit · food · ammo · meds"],
    ["recreation", "R · games · books · fortune"],
    ["signal",     "S · sdr · weather · scan"],
    ["timeline",   "T · unified events"],
    ["system",     "X · admin · users · settings"],
    ["help",       "? · topics · plugins · lore"],
  ];
  for (const [id, label] of modules) {
    register({
      id: `goto.${id}`,
      label,
      run: ({ store }) => store.set({ module: id.toUpperCase(), crumbs: [id.toUpperCase()] }),
    });
  }
  register({
    id: "crt.toggle",
    label: "toggle CRT scanlines / vignette",
    run: () => {
      const root = document.documentElement;
      root.dataset.crt = root.dataset.crt === "off" ? "on" : "off";
    },
  });
}
