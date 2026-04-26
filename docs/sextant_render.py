"""
Sextant rasterizer.
Converts a 2D bitmap of 0/1 values into a string of Unicode sextant block
characters (U+1FB00..U+1FB3B).

Each sextant cell holds a 2-wide x 3-tall block of sub-pixels.
The 6-bit pattern encoding follows the Symbols for Legacy Computing block:

  Bit layout in each cell (column, row):
    (0,0) (1,0)
    (0,1) (1,1)
    (0,2) (1,2)

  Bit weights (per Unicode TR for Legacy Computing):
    bit 0 = (0,0)
    bit 1 = (1,0)
    bit 2 = (0,1)
    bit 3 = (1,1)
    bit 4 = (0,2)
    bit 5 = (1,2)

  Codepoint = U+1FB00 + (n - 1) for n in 1..63, EXCEPT n=21 (full block)
  and n=42 (full block) which are mapped to U+2588 because Unicode reserved
  those positions to avoid collision with existing block characters.

  Specifically:
    n = 0  -> space (U+0020), all 6 sub-pixels off
    n = 21 -> U+2580 (upper half block, equivalent)  -- kept as upper
    n = 42 -> U+2590 (right half block, equivalent)  -- but actually 42 is
              the lower half pattern in our encoding; let's verify carefully
    n = 63 -> U+2588 (full block), all 6 sub-pixels on

The actual block-sextant range U+1FB00..U+1FB3B has 60 codepoints because
the four "duplicate" patterns (full empty, upper half, lower half, full
filled) reuse existing block characters.

This is what U+1FB00..U+1FB3B actually encodes. See:
https://en.wikipedia.org/wiki/Symbols_for_Legacy_Computing
"""

# Mapping from 6-bit pattern to character.
# Bit ordering: bit 0 = TL, bit 1 = TR, bit 2 = ML, bit 3 = MR,
#               bit 4 = BL, bit 5 = BR
# (TL=top-left, TR=top-right, ML=middle-left, MR=middle-right,
#  BL=bottom-left, BR=bottom-right)
#
# The sextant range starts at U+1FB00 (pattern 1: only TL set) and skips
# patterns equivalent to existing block chars.
#
# Reference table (n -> codepoint or substitute):
#   0  -> ' '       (space, all empty)
#   21 -> U+1FB14   (sextant pattern 22 — wait, the skip happens at full-half-blocks)
# Let me just build the table programmatically, with the known skips.

def sextant_char(pattern):
    """Return the unicode character for a 6-bit sextant pattern (0..63)."""
    # Patterns that are existing single-char blocks, replaced:
    #   0  = empty             -> ' '
    #   21 = upper half block  -> '▀' U+2580  (TL+TR set, others empty)... wait
    # Let me check: top half = bits 0 and 1 set = pattern 0b000011 = 3
    # That's the "upper-left + upper-right" cell, which IS the upper half.
    # So pattern 3 is the upper half.

    # Re-derive the mapping. Bit layout:
    #   row 0:  bit 0 (col 0)  bit 1 (col 1)
    #   row 1:  bit 2 (col 0)  bit 3 (col 1)
    #   row 2:  bit 4 (col 0)  bit 5 (col 1)
    #
    # Existing block chars that overlap:
    #   pattern 0  = 0b000000 = empty                     -> ' '
    #   pattern 3  = 0b000011 = upper half (top row only) -> ... actually no.
    # Wait. Sextant cells are 2 wide x 3 tall, so the "upper half" of a
    # sextant cell = top row only = bits 0+1 = pattern 3.
    #
    # But the existing U+2580 ▀ (upper half block) is a 2x2 quadrant char,
    # not a 2x3 sextant char. They're different aspect ratios. Hmm.
    #
    # The actual rule per Unicode:
    #   The sextant range U+1FB00..U+1FB3B covers patterns 1..62 EXCLUDING:
    #     - pattern 0  (empty)         -> use space
    #     - pattern 63 (full)          -> use U+2588 (full block)
    #     - pattern equivalent to U+2580 (top half) — this is actually NOT
    #       in the sextant range because U+2580 is a quadrant block. Wait,
    #       sextants and quadrants are DIFFERENT character ranges. Sextants
    #       have 60 codepoints (patterns 1-62 minus 21 and 42).
    #     - patterns 21 and 42 are SKIPPED because they correspond to
    #       repeating-row patterns:
    #         pattern 21 = 0b010101 = left column on, right off
    #         pattern 42 = 0b101010 = right column on, left off
    #       These are equivalent to ▌ (U+258C left half) and ▐ (U+2590 right
    #       half) which are 2x2 quadrants but visually identical when
    #       rendered as repeating columns.

    if pattern == 0:
        return ' '
    if pattern == 63:
        return '\u2588'  # full block
    if pattern == 21:
        return '\u258C'  # left half block (left col on, right off)
    if pattern == 42:
        return '\u2590'  # right half block (right col on, left off)

    # For patterns 1..62 except 21 and 42:
    # Codepoint offset = pattern - 1, but skip 21 and 42.
    offset = pattern - 1
    if pattern > 21:
        offset -= 1
    if pattern > 42:
        offset -= 1
    return chr(0x1FB00 + offset)


def rasterize(bitmap):
    """Convert a 2D list of 0/1 (rows of pixels) into a sextant string.

    The bitmap height is padded with 0 rows to a multiple of 3.
    The bitmap width is padded with 0 cols to a multiple of 2.
    Returns a multi-line string of sextant chars.
    """
    if not bitmap:
        return ''

    h = len(bitmap)
    w = max(len(row) for row in bitmap)

    # Pad each row to width w
    bitmap = [list(row) + [0] * (w - len(row)) for row in bitmap]

    # Pad height to multiple of 3
    while len(bitmap) % 3 != 0:
        bitmap.append([0] * w)
    # Pad width to multiple of 2
    if w % 2 != 0:
        for row in bitmap:
            row.append(0)
        w += 1

    cell_rows = len(bitmap) // 3
    cell_cols = w // 2

    out_lines = []
    for cy in range(cell_rows):
        line = []
        for cx in range(cell_cols):
            tl = bitmap[cy*3 + 0][cx*2 + 0]
            tr = bitmap[cy*3 + 0][cx*2 + 1]
            ml = bitmap[cy*3 + 1][cx*2 + 0]
            mr = bitmap[cy*3 + 1][cx*2 + 1]
            bl = bitmap[cy*3 + 2][cx*2 + 0]
            br = bitmap[cy*3 + 2][cx*2 + 1]
            pattern = (tl<<0) | (tr<<1) | (ml<<2) | (mr<<3) | (bl<<4) | (br<<5)
            line.append(sextant_char(pattern))
        out_lines.append(''.join(line))
    return '\n'.join(out_lines)


# ============================================================
# Generate art for the preview
# ============================================================
import math

def moon_mask(illum_pct, phase_angle_deg, size=32):
    """Generate a moon mask at given illumination.
    illum_pct: 0.0 to 1.0
    phase_angle_deg: 0 = new, 90 = first quarter, 180 = full, 270 = last quarter
    size: pixel diameter
    """
    # The lit region is a circle whose visible portion is bounded by an
    # ellipse representing the terminator. For phase_angle 0..180, the lit
    # side grows from right (phase=0=new, but we'll interpret phase=180=full).
    bitmap = [[0]*size for _ in range(size)]
    cx, cy = size/2, size/2
    r = size/2 - 0.5

    # phase_angle in radians; 0 = new (no light), 180 = full
    pa = math.radians(phase_angle_deg)
    # cos(pa) gives the terminator x-offset (-1 to +1) in normalized coords
    # The terminator is an ellipse with horizontal semi-axis = |cos(pa)| * r
    # and vertical semi-axis = r.

    term_a = abs(math.cos(pa)) * r  # horizontal radius of terminator ellipse
    waxing = math.sin(pa) > 0  # if True, lit side is on the right

    for y in range(size):
        for x in range(size):
            dx = x - cx + 0.5
            dy = y - cy + 0.5
            if dx*dx + dy*dy > r*r:
                continue  # outside the moon disk

            # Determine if this pixel is on the lit side of the terminator
            # The terminator ellipse passes through the moon center; at y=dy,
            # its x-extent is +/- term_a * sqrt(1 - (dy/r)^2)
            if r*r - dy*dy < 0:
                continue
            term_x = term_a * math.sqrt(1 - (dy*dy)/(r*r))

            if phase_angle_deg < 180:  # waxing: lit side on right
                # Right of the terminator (positive dx) is lit when waxing
                # but we need to check both the disk edge and terminator.
                # During waxing first half (0..90), terminator is on right
                # half: lit zone is dx > term_x but the right disk edge.
                # During waxing second half (90..180), terminator is on left
                # half: lit zone is dx > -term_x.
                if phase_angle_deg <= 90:
                    lit = dx > term_x
                else:
                    lit = dx > -term_x
            else:  # waning: lit side on left
                if phase_angle_deg <= 270:
                    lit = dx < term_x
                else:
                    lit = dx < -term_x

            bitmap[y][x] = 1 if lit else 0

    return bitmap


def hexagram_lines(lines):
    """Render an I Ching hexagram. lines is a list of 6 booleans:
    True = yang (solid line), False = yin (broken line).
    Lines are drawn bottom-up (line 0 is bottom)."""
    width = 30
    line_h = 2
    gap_h = 2
    bitmap = []
    # Top to bottom = line 5 to line 0
    for i in range(5, -1, -1):
        is_yang = lines[i]
        for r in range(line_h):
            row = [0]*width
            if is_yang:
                # solid line full width
                for x in range(2, width-2):
                    row[x] = 1
            else:
                # broken: solid, gap, solid
                gap_start = width//2 - 3
                gap_end = width//2 + 3
                for x in range(2, gap_start):
                    row[x] = 1
                for x in range(gap_end, width-2):
                    row[x] = 1
            bitmap.append(row)
        # gap between lines
        for r in range(gap_h):
            bitmap.append([0]*width)
    return bitmap


def map_tile_demo(size=48):
    """Synthesise a fake map tile: a road grid + river + buildings.
    This is what a real cartographic rasterizer would produce, just hand-faked.
    """
    bitmap = [[0]*size for _ in range(size)]

    # River: meandering curve from top to bottom-right
    for y in range(size):
        # river center x at this y
        cx = int(8 + 18 * (y/size) + 4*math.sin(y*0.4))
        for x in range(max(0, cx-2), min(size, cx+3)):
            bitmap[y][x] = 1

    # Road network (light dotted lines so they read as roads, not solid)
    # horizontal road at y=12 and y=30
    for y in [12, 30]:
        for x in range(size):
            if x % 2 == 0:
                bitmap[y][x] = 1
    # vertical roads at x=8, x=24, x=40
    for x in [8, 24, 40]:
        for y in range(size):
            if y % 2 == 0:
                # don't overwrite river
                if not (4 < bitmap[y][x] < 0):  # always false but symbolic
                    pass
                if bitmap[y][x] == 0:
                    bitmap[y][x] = 1

    # A few buildings (small filled rects)
    buildings = [(2, 14, 4, 3), (16, 14, 5, 4), (28, 14, 4, 3),
                 (42, 14, 4, 3), (2, 32, 4, 4), (28, 32, 5, 3),
                 (42, 32, 4, 4)]
    for (bx, by, bw, bh) in buildings:
        for y in range(by, min(size, by+bh)):
            for x in range(bx, min(size, bx+bw)):
                bitmap[y][x] = 1

    return bitmap


def chart_wheel_demo(size=42):
    """Render a 12-house chart wheel — outer circle, inner circle, dividers
    and ASC marker. This is GEOMETRIC content; sextants are still useful for
    smooth circles even though box-drawing could do it less smoothly."""
    bitmap = [[0]*size for _ in range(size)]
    cx, cy = size/2, size/2
    r_outer = size/2 - 1
    r_inner = size/2 * 0.65

    for y in range(size):
        for x in range(size):
            dx = x - cx + 0.5
            dy = y - cy + 0.5
            d = math.sqrt(dx*dx + dy*dy)
            # outer circle (1.5 px thick)
            if abs(d - r_outer) < 0.8:
                bitmap[y][x] = 1
            # inner circle (1 px thick)
            if abs(d - r_inner) < 0.6:
                bitmap[y][x] = 1
            # 12 house dividers — radial lines every 30 degrees
            if r_inner < d < r_outer:
                ang = math.atan2(dy, dx)
                ang_deg = math.degrees(ang) % 360
                # check if near a multiple of 30
                nearest_30 = round(ang_deg / 30) * 30
                if abs(ang_deg - nearest_30) < 0.8:
                    bitmap[y][x] = 1

    # Mark ASC (left side, 9 o'clock = 180 deg)
    asc_y = int(cy)
    for x in range(int(cx - r_outer - 2), int(cx - r_outer)):
        if 0 <= x < size and 0 <= asc_y < size:
            bitmap[asc_y][x] = 1
    return bitmap


def fool_card(width=20, height=30):
    """Hand-shaped silhouette of a figure — placeholder for what a
    rasterized RWS Fool art would look like. This is FAKE; the real
    deliverable would come from the rasterizer ingesting actual PD Smith
    1909 art. But it gives a sense of what's possible."""
    bm = [[0]*width for _ in range(height)]
    # Sun in upper right
    sx, sy = width-5, 3
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            if dx*dx+dy*dy <= 4:
                if 0 <= sy+dy < height and 0 <= sx+dx < width:
                    bm[sy+dy][sx+dx] = 1
    # sun rays
    for d in [(0,4),(0,-4),(4,0),(-4,0),(3,3),(-3,3),(3,-3),(-3,-3)]:
        for t in range(2,4):
            ry, rx = sy+d[0]*t//4, sx+d[1]*t//4
            if 0 <= ry < height and 0 <= rx < width:
                bm[ry][rx] = 1
    # Figure: head
    fx = width//2 - 1
    head_y = 8
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            if dx*dx+dy*dy <= 4 and dx*dx+dy*dy >= 1:
                if 0 <= head_y+dy < height and 0 <= fx+dx < width:
                    bm[head_y+dy][fx+dx] = 1
    # body (cloak triangle)
    for y in range(11, 22):
        spread = (y-11)//2 + 1
        for x in range(fx-spread, fx+spread+1):
            if 0 <= x < width:
                bm[y][x] = 1
    # arms outstretched
    bm[13][fx-4:fx-1] = [1]*3
    bm[13][fx+2:fx+5] = [1]*3
    # staff over shoulder (diagonal line)
    for i in range(0, 8):
        x = fx + 4 + i//2
        y = 14 - i
        if 0 <= y < height and 0 <= x < width:
            bm[y][x] = 1
    # Cliff edge below feet
    for x in range(width):
        if x < fx-3 or x > fx+3:
            bm[24][x] = 1 if x % 2 == 0 else 0
    # ground near cliff
    for x in range(fx-3, fx+4):
        bm[23][x] = 1
    # small dog companion
    dx = fx-5
    bm[21][dx:dx+3] = [1,1,1]
    bm[22][dx+2] = 1
    bm[22][dx] = 1
    return bm


# Generate everything and write to a JSON file we can include in the HTML

import json

renderings = {
    'moon_waxing_gibbous':  rasterize(moon_mask(0.78, 135, size=24)),
    'moon_full':            rasterize(moon_mask(1.00, 180, size=24)),
    'moon_first_quarter':   rasterize(moon_mask(0.50, 90,  size=24)),
    'moon_waning_crescent': rasterize(moon_mask(0.20, 300, size=24)),
    'moon_new':             rasterize(moon_mask(0.00, 0,   size=24)),
    'hexagram_14':          rasterize(hexagram_lines([True,False,True,True,True,True])),
    'hexagram_13':          rasterize(hexagram_lines([True,True,True,False,True,True])),
    'map_tile':             rasterize(map_tile_demo(48)),
    'chart_wheel':          rasterize(chart_wheel_demo(42)),
    'fool_card':            rasterize(fool_card(24, 36)),
}

with open('/home/claude/sextant_renderings.json', 'w') as f:
    json.dump(renderings, f, indent=2, ensure_ascii=False)

# Print samples to see them
print("=== MOON: WAXING GIBBOUS ===")
print(renderings['moon_waxing_gibbous'])
print()
print("=== MOON: FULL ===")
print(renderings['moon_full'])
print()
print("=== MOON: FIRST QUARTER ===")
print(renderings['moon_first_quarter'])
print()
print("=== MOON: WANING CRESCENT ===")
print(renderings['moon_waning_crescent'])
print()
print("=== HEXAGRAM 14 ===")
print(renderings['hexagram_14'])
print()
print("=== MAP TILE ===")
print(renderings['map_tile'])
print()
print("=== CHART WHEEL ===")
print(renderings['chart_wheel'])
print()
print("=== FOOL CARD (placeholder) ===")
print(renderings['fool_card'])
