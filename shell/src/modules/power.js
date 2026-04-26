// POWER module — Sprint 3 read-only canary.
//
// Four tiles per docs/02-MODULE-CATALOG.md → (P) POWER:
//   BATTERY    soc% + runtime + bar + kv-grid + sparkline
//   LOAD       cpu/ram/swap bars + temp/fan + cores
//   RADIO      kv-grid for WiFi/LoRa/SDR/BT
//   STORAGE    used/total + breakdown + SMART status
//
// Polling: every POLL_MS milliseconds the module fetches /api/p/now,
// appends the sample to a local ring buffer (HISTORY_LEN entries =
// the sparkline width), and re-renders. Sprint 4 swaps polling for
// WS push by replacing the setInterval with transport.subscribe().
//
// Returns a cleanup function — main.js calls it when navigating away
// so the polling timer doesn't leak.

import { el, txt } from "../chrome/_dom.js";
import { tileEl, bignumEl, kvGridEl } from "../components/tile.js";
import { barEl } from "../components/bar.js";
import { sparklineEl } from "../components/sparkline.js";

const POLL_MS = 30_000;     // ADR-0008 HOT class on WiFi (canary read path)
const HISTORY_LEN = 32;     // sparkline width

export function mountPower(root, store, ctx) {
  const screen = el("div", "screen-power power");
  const tiles = {
    battery: tileEl("BATTERY", { meta: "jackery 2000Wh" }),
    load:    tileEl("LOAD",    { meta: "RK3588 · 8 cores" }),
    radio:   tileEl("RADIO",   { meta: "3 transports" }),
    storage: tileEl("STORAGE", { meta: "1 TB nvme" }),
  };
  Object.values(tiles).forEach((t) => screen.appendChild(t));
  root.replaceChildren(screen);

  const ring = [];           // last HISTORY_LEN samples for sparklines

  // ---- per-tile body slots (replaceChildren on each repaint) -----
  function repaintBattery(s) {
    const body = el("div", "tile-body");
    const row = el("div", "row-flex");
    row.appendChild(bignumEl(Math.round(s.batt_pct), "%", { variant: powerVariant(s.batt_pct) }));
    const right = el("div", "right");
    right.appendChild(el("div", "k-tiny", txt("EST RUNTIME")));
    right.appendChild(el("div", "v-big", txt(formatRuntime(s.runtime_est_s))));
    row.appendChild(right);
    body.appendChild(row);
    body.appendChild(barEl("CHG", s.batt_pct, { variant: powerVariant(s.batt_pct) }));
    body.appendChild(kvGridEl([
      ["DRAW",   `${s.draw_w} W avg · ${s.draw_w_peak} W peak`],
      ["INPUT",  s.input_w > 0 ? `${s.input_w} W — solar` : "0 W — solar disconnected"],
      ["CYCLES", `${s.cycles} · health ${s.health_pct}%`],
      ["TEMP",   `${s.temp_c} °C`],
    ]));
    if (ring.length > 1) {
      body.appendChild(sparklineEl(ring.map((x) => x.draw_w)));
      body.appendChild(el("div", "spark-sub", txt(`draw · last ${ring.length} samples · ${POLL_MS/1000}s buckets`)));
    }
    swapBody(tiles.battery, body);
  }

  function repaintLoad(s) {
    const body = el("div", "tile-body");
    const row = el("div", "row-flex");
    row.appendChild(bignumEl(Math.round(s.cpu), "% CPU"));
    const right = el("div", "right");
    right.appendChild(el("div", "k-tiny", txt("RAM USED")));
    right.appendChild(el("div", "v-big", txt(`${s.ram_used_gb} / ${s.ram_total_gb} GB`)));
    row.appendChild(right);
    body.appendChild(row);
    body.appendChild(barEl("CPU",  s.cpu));
    body.appendChild(barEl("RAM",  s.ram));
    body.appendChild(barEl("SWAP", s.swap));
    body.appendChild(kvGridEl([
      ["CORES", "4×A76 + 4×A55"],
      ["TEMP",  `${s.temp_c}°C · fan ${s.fan} rpm`],
      ["FREQ",  "408 MHz idle · 2.4 GHz turbo"],
    ]));
    swapBody(tiles.load, body);
  }

  function repaintRadio(radio) {
    const body = el("div", "tile-body");
    body.appendChild(kvGridEl([
      ["WiFi", `${radio.wifi.ssid} · ${radio.wifi.rssi_db}dB · ${radio.wifi.clients} clients`],
      ["LoRa", `${radio.lora.freq_mhz} MHz · ${radio.lora.state} · ${radio.lora.pkts_per_h} pkts/h`],
      ["SDR",  `${radio.sdr.kind} · ${radio.sdr.state} · ${radio.sdr.jobs} jobs queued`],
      ["BT",   radio.bt.state === "disabled"
                ? `disabled (${radio.bt.reason})`
                : `${radio.bt.state}`],
    ]));
    swapBody(tiles.radio, body);
  }

  function repaintStorage(storage) {
    const body = el("div", "tile-body");
    const pct = Math.round((storage.used_gb / storage.total_gb) * 100);
    const row = el("div", "row-flex");
    row.appendChild(bignumEl(pct, "% used"));
    const right = el("div", "right");
    right.appendChild(el("div", "k-tiny", txt("USED / TOTAL")));
    right.appendChild(el("div", "v-big", txt(`${storage.used_gb} / ${storage.total_gb} GB`)));
    row.appendChild(right);
    body.appendChild(row);
    body.appendChild(barEl("DISK", pct));
    body.appendChild(kvGridEl([
      ["ARCHIVES", `${storage.breakdown.archives_gb} GB`],
      ["MODELS",   `${storage.breakdown.models_gb} GB`],
      ["SYSTEM",   `${storage.breakdown.system_gb} GB`],
      ["SMART",    storage.smart_status],
    ]));
    swapBody(tiles.storage, body);
  }

  // ---- transport poll loop ---------------------------------------
  let timer = null;
  let active = true;

  async function pull() {
    if (!active) return;
    try {
      const sample = await ctx.transport.request("GET", "/api/p/now", undefined, { cacheClass: "HOT" });
      ring.push(sample);
      if (ring.length > HISTORY_LEN) ring.shift();
      repaintBattery(sample);
      repaintLoad(sample);
    } catch (e) {
      // transport down — sprint 3 just notes it; sprint 4's WS push
      // will handle reconnect via the queue/dispatcher.
      console.warn("[power] /api/p/now failed:", e.message);
    }
  }

  async function pullStatic() {
    try {
      const [radio, storage] = await Promise.all([
        ctx.transport.request("GET", "/api/p/radio",   undefined, { cacheClass: "STABLE" }),
        ctx.transport.request("GET", "/api/p/storage", undefined, { cacheClass: "STABLE" }),
      ]);
      repaintRadio(radio);
      repaintStorage(storage);
    } catch (e) {
      console.warn("[power] static fetch failed:", e.message);
    }
  }

  // First paint kicks off both transient and static fetches.
  pull();
  pullStatic();
  timer = setInterval(pull, POLL_MS);

  // Cleanup on unmount.
  return function unmount() {
    active = false;
    if (timer) clearInterval(timer);
  };
}

// ---- helpers ------------------------------------------------------
function powerVariant(pct) { return pct < 15 ? "alert" : pct < 30 ? "warn" : ""; }

function formatRuntime(s) {
  if (!isFinite(s) || s > 60 * 86400) return "indefinite (charging)";
  const d  = Math.floor(s / 86400);
  const h  = Math.floor((s % 86400) / 3600);
  const m  = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

function swapBody(tile, body) {
  // Tile head is the first child (.tile-title); replace everything else.
  const head = tile.firstChild;
  tile.replaceChildren(head, body);
}
