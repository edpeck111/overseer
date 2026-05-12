/**
 * Shared hardware-backend status helper.
 *
 * Fetches /api/hw once per page load and caches the result.
 * Each module calls hwStatus() to decide whether to show a
 * DISABLED banner for its sub-screens.
 */

import { el, txt } from "../chrome/_dom.js";

const _FALLBACK = { _any_real: false, _synthetic: {
  sdr: true, lora: true, mesh: true, gps: true, power: true, display: true,
} };

let _cache = null;
let _inflight = null;

/** Fetch (and cache) the hw backend status. Returns a guaranteed-shape object. */
export async function hwStatus() {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const r = await fetch("/api/hw");
      if (!r.ok) throw new Error(`/api/hw → ${r.status}`);
      const j = await r.json();
      // Ensure _synthetic exists even if server returns unexpected shape
      if (!j._synthetic) j._synthetic = {};
      _cache = j;
      _inflight = null;
      return j;
    } catch {
      _inflight = null;
      return _FALLBACK;
    }
  })();
  return _inflight;
}

/**
 * Build a .disabled-banner element.
 * @param {string} what   - short label, e.g. "SDR RADIO"
 * @param {string} detail - e.g. "set OVERSEER_SDR=rtlsdr"
 */
export function disabledBanner(what, detail) {
  const wrap = el("div", "disabled-banner");
  wrap.appendChild(el("span", "icon", txt("⚠")));
  wrap.appendChild(el("span", "msg", txt(`SYNTHETIC — ${what} not connected  ·  ${detail}`)));
  return wrap;
}
