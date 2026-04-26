/**
 * Module registry. Each module exposes:
 *   - id, key (uppercase letter), label, description, pip
 *   - mount(root, store) → unmount fn
 *   - hotkeys() → array of { key, label, cls? } shown in hotkey bar
 *   - commands() → array of { name, hint, run } registered in palette
 *
 * The HOME module is also a registry consumer — it lists everything else.
 */

import { mountHome } from './home.js';
import { stubModule } from './stub.js';

const PRIMARY = [
  { id: 'knowledge',  key: 'K', label: 'KNOWLEDGE',  desc: 'chat · library · 12 vols',         pip: { text: '●' } },
  { id: 'comms',      key: 'C', label: 'COMMS',      desc: 'mail · boards · mesh',             pip: { text: '3 NEW', cls: 'alert' } },
  { id: 'medical',    key: 'M', label: 'MEDICAL',    desc: 'triage · ref · dose',              pip: { text: '●' } },
  { id: 'navigation', key: 'N', label: 'NAVIGATION', desc: 'map · waypoints · route',          pip: { text: 'GPS', cls: 'cool' } },
  { id: 'power',      key: 'P', label: 'POWER',      desc: 'battery · load · radio',           pip: { text: '82%' } },
  { id: 'log',        key: 'L', label: 'LOG',        desc: 'daily journal · timeline',         pip: { text: '●' } },
];

const SECONDARY = [
  { id: 'inventory',  key: 'I', label: 'INVENTORY',  desc: 'kit · food · ammo · meds',         pip: { text: '2 EXP', cls: 'alert' } },
  { id: 'recreation', key: 'R', label: 'RECREATION', desc: 'games · books · fortune',          pip: { text: '●' } },
  { id: 'signal',     key: 'S', label: 'SIGNAL',     desc: 'sdr · weather · scan',             pip: { text: 'RX', cls: 'cool' } },
  { id: 'timeline',   key: 'T', label: 'TIMELINE',   desc: 'unified events · query',           pip: { text: '●' } },
  { id: 'system',     key: 'X', label: 'SYSTEM',     desc: 'admin · users · settings',         pip: { text: '●' } },
  { id: 'help',       key: '?', label: 'HELP & XTRAS', desc: 'topics · plugins · lore',        pip: { text: '●' } },
];

/**
 * Optional: AUSPICE addendum. Hotkey U.
 * Only listed in the secondary tier when enabled in settings (Sprint A).
 */
const ADDENDUM = [
  { id: 'auspice',    key: 'U', label: 'AUSPICE',    desc: 'sky · chart · tarot · journal',    pip: { text: '○' } },
];

export const moduleList = {
  primary:   PRIMARY,
  secondary: SECONDARY,
  addendum:  ADDENDUM,
};

/** All known modules indexed by upper-case key. */
export const modulesByKey = (() => {
  const map = new Map();
  for (const m of [...PRIMARY, ...SECONDARY, ...ADDENDUM]) {
    map.set(m.key.toUpperCase(), m);
  }
  return map;
})();

/** All known modules indexed by id. */
export const modulesById = (() => {
  const map = new Map();
  for (const m of [...PRIMARY, ...SECONDARY, ...ADDENDUM]) {
    map.set(m.id, m);
  }
  return map;
})();

/**
 * Returns a mount() function for a module id. Sprint 1 only HOME is real;
 * everything else falls through to a stub explaining the build phase.
 */
export function mountFor(id) {
  if (id === 'home') return mountHome;
  return (root, store) => stubModule(root, store, modulesById.get(id) || { id, label: id.toUpperCase() });
}
