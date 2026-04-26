// Sextant rasterizer — JS port of docs/sextant_render.py.
//
// Converts a 2D 0/1 bitmap into a string of Unicode sextant block
// characters (U+1FB00..U+1FB3B, with substitutions for the four
// patterns that overlap existing block chars).
//
// Each cell is 2 wide × 3 tall. Bit layout per Unicode "Symbols for
// Legacy Computing":
//
//     row 0:  bit 0 (TL)   bit 1 (TR)
//     row 1:  bit 2 (ML)   bit 3 (MR)
//     row 2:  bit 4 (BL)   bit 5 (BR)
//
// Pattern 0 → space; 21 → U+258C left half; 42 → U+2590 right half;
// 63 → U+2588 full block. All other patterns 1..62 land at
// U+1FB00 + (pattern - 1 - skips_below).
//
// Per ADR-0009 this is a system-wide UI primitive — modules import
// directly, no per-module fork.

/** @param {number} pattern 6-bit value 0..63 */
export function sextantChar(pattern) {
  if (pattern === 0) return " ";
  if (pattern === 63) return "█";    // full block
  if (pattern === 21) return "▌";    // left half
  if (pattern === 42) return "▐";    // right half
  let offset = pattern - 1;
  if (pattern > 21) offset -= 1;
  if (pattern > 42) offset -= 1;
  return String.fromCodePoint(0x1FB00 + offset);
}

/** Convert a 2D 0/1 bitmap (array of arrays, row-major) into a
 *  multi-line sextant string. Pads to multiples of 2 wide × 3 tall.
 *  @param {number[][]} bitmap */
export function rasterize(bitmap) {
  if (!bitmap || bitmap.length === 0) return "";
  const h = bitmap.length;
  let w = 0;
  for (const row of bitmap) if (row.length > w) w = row.length;

  // Pad rows to width w
  const padded = bitmap.map((row) => {
    const r = row.slice();
    while (r.length < w) r.push(0);
    return r;
  });
  // Pad height to multiple of 3
  while (padded.length % 3 !== 0) padded.push(new Array(w).fill(0));
  // Pad width to even
  if (w % 2 !== 0) {
    for (const row of padded) row.push(0);
    w += 1;
  }

  const cellRows = padded.length / 3;
  const cellCols = w / 2;
  const lines = [];
  for (let cy = 0; cy < cellRows; cy++) {
    let line = "";
    for (let cx = 0; cx < cellCols; cx++) {
      const tl = padded[cy*3 + 0][cx*2 + 0] ? 1 : 0;
      const tr = padded[cy*3 + 0][cx*2 + 1] ? 1 : 0;
      const ml = padded[cy*3 + 1][cx*2 + 0] ? 1 : 0;
      const mr = padded[cy*3 + 1][cx*2 + 1] ? 1 : 0;
      const bl = padded[cy*3 + 2][cx*2 + 0] ? 1 : 0;
      const br = padded[cy*3 + 2][cx*2 + 1] ? 1 : 0;
      const pattern =
        (tl << 0) | (tr << 1) | (ml << 2) | (mr << 3) | (bl << 4) | (br << 5);
      line += sextantChar(pattern);
    }
    lines.push(line);
  }
  return lines.join("\n");
}
