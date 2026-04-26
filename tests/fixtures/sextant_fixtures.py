"""Generate sextant test fixtures.

Run from repo root:  python tests/fixtures/sextant_fixtures.py

The prototype docs/sextant_render.py has top-level side effects (writes
to a hard-coded path). We inline the pure rasterize() + sextant_char()
here so the fixture generator stays self-contained.
"""
from __future__ import annotations

import json
import math
from pathlib import Path


def sextant_char(pattern: int) -> str:
    if pattern == 0: return " "
    if pattern == 63: return "█"
    if pattern == 21: return "▌"
    if pattern == 42: return "▐"
    offset = pattern - 1
    if pattern > 21: offset -= 1
    if pattern > 42: offset -= 1
    return chr(0x1FB00 + offset)


def rasterize(bitmap: list[list[int]]) -> str:
    if not bitmap: return ""
    h = len(bitmap)
    w = max(len(r) for r in bitmap)
    bm = [list(row) + [0] * (w - len(row)) for row in bitmap]
    while len(bm) % 3 != 0: bm.append([0] * w)
    if w % 2 != 0:
        for row in bm: row.append(0)
        w += 1
    out = []
    for cy in range(len(bm) // 3):
        line = []
        for cx in range(w // 2):
            tl, tr = bm[cy*3+0][cx*2+0], bm[cy*3+0][cx*2+1]
            ml, mr = bm[cy*3+1][cx*2+0], bm[cy*3+1][cx*2+1]
            bl, br = bm[cy*3+2][cx*2+0], bm[cy*3+2][cx*2+1]
            pat = (tl<<0) | (tr<<1) | (ml<<2) | (mr<<3) | (bl<<4) | (br<<5)
            line.append(sextant_char(pat))
        out.append("".join(line))
    return "\n".join(out)


def moon_mask(illum_pct: float, phase_angle_deg: float, size: int = 32) -> list[list[int]]:
    bm = [[0] * size for _ in range(size)]
    cx, cy = size / 2, size / 2
    r = size / 2 - 0.5
    pa = math.radians(phase_angle_deg)
    term_a = abs(math.cos(pa)) * r
    for y in range(size):
        for x in range(size):
            dx = x - cx + 0.5
            dy = y - cy + 0.5
            if dx*dx + dy*dy > r*r: continue
            if r*r - dy*dy < 0: continue
            term_x = term_a * math.sqrt(1 - (dy*dy) / (r*r))
            if phase_angle_deg < 180:
                lit = (dx > term_x) if phase_angle_deg <= 90 else (dx > -term_x)
            else:
                lit = (dx < term_x) if phase_angle_deg <= 270 else (dx < -term_x)
            bm[y][x] = 1 if lit else 0
    return bm


FIXTURES = {
    # Single-cell edge cases (1 sextant cell each)
    "single_empty":       [[0,0],[0,0],[0,0]],
    "single_full":        [[1,1],[1,1],[1,1]],
    "single_left_half":   [[1,0],[1,0],[1,0]],
    "single_right_half":  [[0,1],[0,1],[0,1]],
    "single_top_left":    [[1,0],[0,0],[0,0]],
    "single_bottom_right":[[0,0],[0,0],[0,1]],
    # Padding paths
    "odd_width":  [[1,0,1],[0,1,0],[1,1,1]],
    "odd_height": [[1,1],[0,1],[1,0],[1,1]],
    # Organic mid-size — moon masks at three phases
    "moon_full":    moon_mask(1.00, 180, size=24),
    "moon_quarter": moon_mask(0.50,  90, size=24),
    "moon_new":     moon_mask(0.00,   0, size=24),
}


def main() -> None:
    rendered = {name: rasterize(bm) for name, bm in FIXTURES.items()}
    out = Path(__file__).parent / "sextant_fixtures.json"
    out.write_text(json.dumps(rendered, ensure_ascii=False, indent=2))
    print(f"wrote {out} ({len(rendered)} fixtures)")
    # Also write a JSON file with the input bitmaps so the JS test can
    # call its own rasterize() against them and assert parity.
    out_bm = Path(__file__).parent / "sextant_input_bitmaps.json"
    out_bm.write_text(json.dumps(FIXTURES, ensure_ascii=False, indent=2))
    print(f"wrote {out_bm}")


if __name__ == "__main__":
    main()
