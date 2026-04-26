// Canonical module registry. Single source of truth for hotkeys, labels,
// sub-descriptions, status pips, and which sprint builds each one out.
// HOME renders the menu from this; the router resolves hotkey presses
// against it; the palette seeds 'goto.<id>' commands from it.

/**
 * @typedef {Object} ModuleEntry
 * @property {string}  hotkey   — one keystroke that selects the module
 * @property {string}  id       — lowercase, used in URLs/state
 * @property {string}  name     — display name, all caps
 * @property {string}  desc     — one-liner shown in the HOME menu
 * @property {"primary"|"secondary"} category
 * @property {number}  sprint   — sprint that fully builds this module
 * @property {string}  pip      — '●' default; alert/cool variants set per state
 * @property {string}  [pipClass] — 'alert' | 'cool'
 */

/** @type {ModuleEntry[]} */
export const MODULES = [
  { hotkey: "K", id: "knowledge",  name: "KNOWLEDGE",     desc: "chat · library · 12 vols",     category: "primary",   sprint: 5,  pip: "●" },
  { hotkey: "C", id: "comms",      name: "COMMS",         desc: "mail · boards · mesh",         category: "primary",   sprint: 6,  pip: "3 NEW", pipClass: "alert" },
  { hotkey: "M", id: "medical",    name: "MEDICAL",       desc: "triage · ref · dose",          category: "primary",   sprint: 7,  pip: "●" },
  { hotkey: "N", id: "navigation", name: "NAVIGATION",    desc: "map · waypoints · route",      category: "primary",   sprint: 8,  pip: "GPS",   pipClass: "cool"  },
  { hotkey: "P", id: "power",      name: "POWER",         desc: "battery · load · radio",       category: "primary",   sprint: 3,  pip: "82%" },
  { hotkey: "L", id: "log",        name: "LOG",           desc: "daily journal · timeline",     category: "primary",   sprint: 9,  pip: "●" },

  { hotkey: "I", id: "inventory",  name: "INVENTORY",     desc: "kit · food · ammo · meds",     category: "secondary", sprint: 10, pip: "2 EXP", pipClass: "alert" },
  { hotkey: "R", id: "recreation", name: "RECREATION",    desc: "games · books · fortune",      category: "secondary", sprint: 13, pip: "●" },
  { hotkey: "S", id: "signal",     name: "SIGNAL",        desc: "sdr · weather · scan",         category: "secondary", sprint: 12, pip: "RX",    pipClass: "cool"  },
  { hotkey: "T", id: "timeline",   name: "TIMELINE",      desc: "unified events · query",       category: "secondary", sprint: 11, pip: "●" },
  { hotkey: "X", id: "system",     name: "SYSTEM",        desc: "admin · users · settings",     category: "secondary", sprint: 15, pip: "●" },
  { hotkey: "?", id: "help",       name: "HELP & XTRAS",  desc: "topics · plugins · lore",      category: "secondary", sprint: 15, pip: "●" },
];

/** Lookup module by hotkey (case-insensitive). */
export function moduleByHotkey(k) {
  const u = k.toUpperCase();
  return MODULES.find((m) => m.hotkey === u);
}

/** Lookup by id. */
export function moduleById(id) {
  return MODULES.find((m) => m.id === id);
}
