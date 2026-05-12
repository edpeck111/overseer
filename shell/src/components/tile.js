// Tile — panel-titled container used for dashboard layouts (POWER,
// SIGNAL, TIMELINE). Composed of:
//   .tile-title (with optional .meta on the right)
//   .tile body (caller appends children)
//
// Helpers: bignumEl, kvGridEl — common building blocks inside tiles.

import { el } from "./dom.js";

/** @param {string} title @param {{meta?: string}} [opts] */
export function tileEl(title, { meta } = {}) {
  const wrap = el("div", "tile");
  const head = el("div", "tile-title", title);
  if (meta) head.appendChild(el("span", "meta", meta));
  wrap.appendChild(head);
  return wrap;
}

/** @param {string|number} value @param {string} [unit] @param {{variant?: string}} [opts] */
export function bignumEl(value, unit, { variant = "" } = {}) {
  const wrap = el("div", "bignum" + (variant ? " " + variant : ""), String(value));
  if (unit) wrap.appendChild(el("span", "unit", unit));
  return wrap;
}

/** @param {Array<[string, string]>} rows */
export function kvGridEl(rows) {
  const grid = el("div", "kv-grid");
  for (const [k, v] of rows) {
    grid.appendChild(el("span", "k", k));
    grid.appendChild(el("span", "v", v));
  }
  return grid;
}
