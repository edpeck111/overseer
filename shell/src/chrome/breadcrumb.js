// Breadcrumb — second line, P2 spatial consistency. Left: hierarchy
// crumbs joined by ›. Right: contextual pill (e.g. [3 UNREAD]).

import { el, txt } from "./_dom.js";

export function mountBreadcrumb(root, store) {
  const render = () => {
    const crumbs = store.get("crumbs") || ["HOME"];
    const pill   = store.get("pill");
    const parts  = [];
    crumbs.forEach((label, i) => {
      if (i > 0) parts.push(el("span", "arrow", txt("›"))); // ›
      parts.push(el("span", "crumb" + (i === crumbs.length - 1 ? " active" : ""), txt(label)));
    });
    if (pill) parts.push(el("span", "pill", txt(pill)));
    root.replaceChildren(...parts);
  };
  store.subscribe("crumbs", render);
  store.subscribe("pill",   render);
  render();
}
