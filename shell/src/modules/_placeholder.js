// Module placeholder view. Sprint 1 ships HOME for real and stubs every
// other module. Each non-HOME module renders this card naming the
// sprint that will replace the stub. Demonstrates routing works (the
// breadcrumb and active menu item update) without misleading the user
// about functionality that doesn't exist yet.

import { el, txt } from "../chrome/_dom.js";
import { moduleById } from "./_registry.js";

export function mountPlaceholder(root, store) {
  const render = () => {
    const id = (store.get("module") || "HOME").toLowerCase();
    if (id === "home") return;  // HOME owns the content; do nothing.
    const m = moduleById(id) || moduleById("home");
    const wrap = el("div", "module-placeholder");
    wrap.append(
      el("div", "ph-name", txt(m.name)),
      el("div", "ph-desc", txt(m.desc)),
      el("div", "ph-line", txt(`scheduled for Sprint ${m.sprint}`)),
      el("div", "ph-back", txt("press Q or H to return HOME · : for palette")),
    );
    root.replaceChildren(wrap);
  };
  store.subscribe("module", render);
}
