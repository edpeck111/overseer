// Keyboard router. Single-character keys select modules; ':' opens the
// palette; '/' enters search (Sprint 1 stub); '?' shows help; 'Q'/'q'
// pops the breadcrumb. Modifier-keyed shortcuts are reserved for
// future use and fall through.
//
// When the palette is open it captures keys ahead of this router, so
// we don't double-handle.

import { moduleByHotkey } from "./modules/_registry.js";

export function mountRouter(store, { palette }) {
  document.addEventListener("keydown", (e) => {
    if (palette.isOpen()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === ":") { e.preventDefault(); palette.show(); return; }

    if (e.key === "Q" || e.key === "q") {
      const crumbs = store.get("crumbs") || ["HOME"];
      if (crumbs.length > 1) {
        store.set({ crumbs: crumbs.slice(0, -1), module: crumbs[crumbs.length - 2] });
      }
      e.preventDefault();
      return;
    }

    if (e.key === "/") {
      // Sprint 1 stub — Sprint 2 wires fuzzy search within the active
      // screen. For now we no-op so the hotkey bar's '/' pill doesn't
      // lie about what's bound.
      e.preventDefault();
      return;
    }

    if (e.key === "?") {
      const help = moduleByHotkey("?");
      if (help) selectModule(store, help);
      e.preventDefault();
      return;
    }

    // Letter / digit hotkeys -----------------------------------------
    if (e.key.length === 1) {
      const m = moduleByHotkey(e.key);
      if (m) {
        selectModule(store, m);
        e.preventDefault();
      }
    }
  });
}

function selectModule(store, m) {
  store.set({
    module: m.name,
    crumbs: m.id === "home" ? ["HOME"] : ["HOME", m.name],
    pill: m.pip,
  });
}
