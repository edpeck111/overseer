// Hotkey bar — bottom of frame, P2 spatial. Reflects the active
// screen's hotkey set. Each entry: { k: 'K', l: 'knowledge', variant?:
// 'special' | 'danger' }. Variants follow the visual reference's
// .key.special (amber) and .key.danger (red) classes.

import { el, txt } from "./_dom.js";

export function mountHotkeyBar(root, store) {
  const render = () => {
    const items = store.get("hotkeys") || [];
    root.replaceChildren(...items.map(({ k, l, variant }) => {
      const wrap = el("span", "key" + (variant ? " " + variant : ""));
      wrap.appendChild(el("span", "k", txt(k)));
      wrap.appendChild(el("span", "l", txt(l)));
      return wrap;
    }));
  };
  store.subscribe("hotkeys", render);
  render();
}
