// Sparkline — Unicode block-character histogram (P11: text > raster).
//
// Renders an array of numbers as a string of ▁▂▃▄▅▆▇█ glyphs scaled
// to the data's min/max. The DOM form wraps the glyph string in
// <span> chunks coloured by quartile (.a / .b / .c / .d) so a high
// bar reads visually distinct from a low one even in monochrome
// terminals.

import { el } from "./dom.js";

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** @param {number[]} values @param {{min?: number, max?: number}} [opts] */
export function renderSparkline(values, { min, max } = {}) {
  if (!values || values.length === 0) return "";
  const lo = min !== undefined ? min : Math.min(...values);
  const hi = max !== undefined ? max : Math.max(...values);
  const span = hi - lo;
  return values
    .map((v) => {
      if (span <= 0) return BLOCKS[0];
      const idx = Math.max(0, Math.min(BLOCKS.length - 1,
        Math.round(((v - lo) / span) * (BLOCKS.length - 1))));
      return BLOCKS[idx];
    })
    .join("");
}

/** Same as renderSparkline but returns a DOM element with quartile
 *  colour spans (.a/.b/.c/.d) for visual emphasis on peaks. */
export function sparklineEl(values, opts = {}) {
  const wrap = el("div", "spark");
  if (!values || values.length === 0) return wrap;
  const lo = opts.min !== undefined ? opts.min : Math.min(...values);
  const hi = opts.max !== undefined ? opts.max : Math.max(...values);
  const span = Math.max(1e-9, hi - lo);

  // Group consecutive cells by quartile to keep the DOM tiny.
  const QUARTILES = ["a", "b", "c", "d"];
  let group = "", glyphs = "";
  for (const v of values) {
    const norm = (v - lo) / span;                       // 0..1
    const q = QUARTILES[Math.min(3, Math.floor(norm * 4))];
    const idx = Math.max(0, Math.min(BLOCKS.length - 1,
      Math.round(norm * (BLOCKS.length - 1))));
    const ch = BLOCKS[idx];
    if (q === group) {
      glyphs += ch;
    } else {
      if (group) wrap.appendChild(el("span", group, glyphs));
      group = q;
      glyphs = ch;
    }
  }
  if (glyphs) wrap.appendChild(el("span", group, glyphs));
  return wrap;
}
