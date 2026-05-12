// Bar — labelled progress bar. Visual reference:
//
//   CPU  [▰▰▰▱▱▱▱▱▱▱]  29%
//
// Variants: normal (phosphor green fill), warn (amber), alert (red).

import { el } from "./dom.js";

/** @param {string} label @param {number} pct  @param {{variant?: string}} [opts] */
export function barEl(label, pct, { variant = "" } = {}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const bar = el("div", "bar" + (variant ? " " + variant : ""));
  bar.appendChild(el("span", "lab", label));
  const track = el("div", "track");
  const fill = el("div", "fill");
  fill.style.width = clamped + "%";
  track.appendChild(fill);
  bar.appendChild(track);
  bar.appendChild(el("span", "pct", Math.round(clamped) + "%"));
  return bar;
}
