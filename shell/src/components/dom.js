// Tiny DOM helpers — component-scoped mirror of chrome/_dom.js.
// el(tag, cls?, ...kids) where kids may be strings or Nodes.

export function el(tag, cls, ...kids) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const k of kids) {
    if (k == null) continue;
    n.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
  }
  return n;
}
