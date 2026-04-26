// Tiny DOM helpers. Avoids per-call template parsing and keeps the
// component files focused on structure + event wiring.

/** @param {string} tag @param {string} [cls] @param {...(Node|string)} kids */
export function el(tag, cls, ...kids) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const k of kids) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
  return n;
}

/** @param {string} s */
export function txt(s) { return document.createTextNode(String(s ?? "")); }
