// Binarization helpers — convert grayscale to 0/1 for the sextant
// rasterizer. Four modes per the SEXTANT-GRAPHICS-HANDOFF doc:
//
//   threshold(gray, t)             simple cutoff (default 128)
//   otsu(gray)                     adaptive global threshold by histogram
//   niblack(gray, w, k)            local mean - k*stddev over w×w window
//   floydSteinberg(gray)           classic 4-error-diffusion dithering
//   atkinson(gray)                 6-error-diffusion dithering
//
// Input shape: 2D number[][] of grayscale values 0..255 (row-major).
// Output shape: 2D number[][] of 0|1 bits, same dimensions.

/** Simple threshold cutoff. @param {number[][]} gray @param {number} [t=128] */
export function threshold(gray, t = 128) {
  return gray.map((row) => row.map((v) => (v >= t ? 1 : 0)));
}

/** Otsu's method — global threshold maximising inter-class variance. */
export function otsu(gray) {
  const hist = new Uint32Array(256);
  let total = 0;
  for (const row of gray) for (const v of row) {
    hist[clamp255(v)]++;
    total++;
  }
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, varMax = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > varMax) { varMax = v; t = i; }
  }
  return threshold(gray, t);
}

/** Niblack — local threshold = mean(window) - k * stddev(window).
 *  Good for variable-illumination scans (real document inputs). */
export function niblack(gray, windowSize = 15, k = -0.2) {
  const h = gray.length, w = gray[0].length;
  const r = Math.floor(windowSize / 2);
  const out = Array.from({ length: h }, () => new Array(w).fill(0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0, s = 0, s2 = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const v = gray[yy][xx];
          n++; s += v; s2 += v * v;
        }
      }
      const mean = s / n;
      const variance = s2 / n - mean * mean;
      const stddev = variance > 0 ? Math.sqrt(variance) : 0;
      const t = mean + k * stddev;
      out[y][x] = gray[y][x] >= t ? 1 : 0;
    }
  }
  return out;
}

/** Floyd-Steinberg error diffusion (classic).
 *  Distributes the quantisation error to neighbouring pixels:
 *      X 7
 *    3 5 1   (divide by 16) */
export function floydSteinberg(gray) {
  return _diffuseDither(gray, [
    { dx:  1, dy: 0, w: 7/16 },
    { dx: -1, dy: 1, w: 3/16 },
    { dx:  0, dy: 1, w: 5/16 },
    { dx:  1, dy: 1, w: 1/16 },
  ]);
}

/** Atkinson dithering (Bill Atkinson's algorithm — Apple, 1980s).
 *  Distributes only 6/8 of the error, leaving high-contrast preserved:
 *      X 1 1
 *    1 1 1
 *      1     (each weight is 1/8) */
export function atkinson(gray) {
  const w = 1 / 8;
  return _diffuseDither(gray, [
    { dx:  1, dy: 0, w },
    { dx:  2, dy: 0, w },
    { dx: -1, dy: 1, w },
    { dx:  0, dy: 1, w },
    { dx:  1, dy: 1, w },
    { dx:  0, dy: 2, w },
  ]);
}

// --- helpers ---------------------------------------------------------

function _diffuseDither(gray, kernel) {
  const h = gray.length, w = gray[0].length;
  // Working copy as floats for the error accumulation
  const buf = gray.map((row) => row.map((v) => v));
  const out = Array.from({ length: h }, () => new Array(w).fill(0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const old = buf[y][x];
      const newVal = old < 128 ? 0 : 255;
      out[y][x] = newVal === 255 ? 1 : 0;
      const err = old - newVal;
      for (const k of kernel) {
        const nx = x + k.dx, ny = y + k.dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        buf[ny][nx] += err * k.w;
      }
    }
  }
  return out;
}

function clamp255(v) {
  v = v | 0;
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}
