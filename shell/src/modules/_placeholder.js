// Module placeholder view. Modules that haven't shipped their real
// implementation yet land here when the user activates their hotkey
// — the breadcrumb and active menu item still update, the content
// pane shows a card naming the sprint that will replace the stub.

import { el, txt } from "../chrome/_dom.js";
import { moduleById } from "./_registry.js";

export function mountPlaceholder(root, store) {
  const id = (store.get("module") || "HOME").toLowerCase();
  const m = moduleById(id) || moduleById("home") || {
    name: id.toUpperCase(), desc: "—", sprint: "?",
  };
  const wrap = el("div", "module-placeholder");
  wrap.append(
    el("div", "ph-name", txt(m.name)),
    el("div", "ph-desc", txt(m.desc)),
    el("div", "ph-line", txt(`scheduled for Sprint ${m.sprint}`)),
    el("div", "ph-back", txt("press Q or H to return HOME · : for palette")),
  );
  root.replaceChildren(wrap);
  return undefined;
}
