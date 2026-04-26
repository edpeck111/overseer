// Sprint 1+2+3 gate smoke test for the shell. jsdom + the built IIFE
// bundle, simulating the keystrokes called out in each sprint's gate
// plus exercising the POWER module's read-only canary path.
//
// Run from repo root or from shell/ — paths resolve relative to this
// script, not cwd.

import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.resolve(__dirname, "..", "shell", "public");
const html  = readFileSync(path.join(SHELL, "index.html"), "utf8");
const js    = readFileSync(path.join(SHELL, "dist", "main.js"), "utf8");

const dom = new JSDOM(html, {
  url: "http://localhost/",
  runScripts: "dangerously",
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;
window.addEventListener("error", (e) => console.error("[shell error]", e.message));

// jsdom doesn't ship fetch / WebSocket — supply mocks.
const fakeResp = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json:  async () => data,
  text:  async () => JSON.stringify(data),
  arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(data)).buffer,
});
window.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/api/p/now")) return fakeResp({
    at: 1714086840, batt_pct: 82, draw_w: 4.2, draw_w_peak: 11.6,
    input_w: 0, runtime_est_s: 1216260,
    cpu: 7, ram: 61, ram_used_gb: 9.8, ram_total_gb: 16,
    swap: 2, temp_c: 22, fan: 2100,
    cycles: 238, health_pct: 96,
  });
  if (u.includes("/api/p/radio")) return fakeResp({
    wifi: { ssid: "overseer-net", rssi_db: -42, clients: 6 },
    lora: { freq_mhz: 868, state: "listening", pkts_per_h: 14 },
    sdr:  { kind: "RTL.SDR", state: "idle", jobs: 0 },
    bt:   { state: "disabled", reason: "power_save" },
  });
  if (u.includes("/api/p/storage")) return fakeResp({
    used_gb: 412, total_gb: 512,
    breakdown: { archives_gb: 142, models_gb: 14, system_gb: 6, other_gb: 250 },
    smart_status: "healthy",
  });
  if (u.endsWith("/api/k/library/archives")) return fakeResp([
    { key: "wikem_en_all", label: "WikEM", desc: "Emergency medicine", size_gb: 0.6, articles: 2 },
    { key: "ifixit_en_all", label: "iFixit", desc: "Repair guides", size_gb: 1.2, articles: 1 },
  ]);
  if (u.includes("/api/k/library/articles")) return fakeResp([
    { id: "Water_purification", title: "Water purification" },
    { id: "Tourniquet_application", title: "Tourniquet application" },
  ]);
  if (u.includes("/api/k/library/article")) return fakeResp({
    archive: "wikem_en_all", id: "Water_purification", title: "Water purification",
    paragraphs: ["Filter through cloth.", "Boil one minute.", "Bleach: 8 drops/gallon."],
  });
  if (u.includes("/api/k/branches")) return fakeResp({ roots: [] });
  return fakeResp("not mocked", 404);
};
window.WebSocket = function () {
  this.readyState = 0;
  this.send = () => {};
  this.close = () => {};
  this.addEventListener = (k, fn) => { if (k === "error") setTimeout(fn, 5); };
};

const script = document.createElement("script");
script.textContent = js;
document.body.appendChild(script);
await new Promise((r) => setTimeout(r, 50));

const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };
const pass = (msg) => console.log(" PASS:", msg);

// ---- Sprint 1 chrome assertions -----------------------------------
const status = document.getElementById("statusbar");
const segs   = status.querySelectorAll(".seg");
if (segs.length !== 8) fail("status strip expected 8 segments, got " + segs.length);
pass("status strip has " + segs.length + " segments");

const brand = status.querySelector(".seg.brand .v");
if (!brand || brand.textContent.trim() !== "OVERSEER") fail("brand text wrong");
pass("brand segment shows " + brand.textContent);

const hotkeys = document.getElementById("hotkeybar").querySelectorAll(".key");
if (hotkeys.length !== 10) fail("hotkey bar expected 10 keys, got " + hotkeys.length);
pass("hotkey bar has " + hotkeys.length + " keys");

const breadcrumb = document.getElementById("breadcrumb");
if (!breadcrumb.textContent.includes("HOME")) fail("breadcrumb missing HOME");
pass("breadcrumb default shows HOME");

const home = document.querySelector(".screen-home");
if (!home) fail("HOME screen not mounted");
const menuItems = home.querySelectorAll(".menu-item");
if (menuItems.length !== 12) fail("expected 12 menu items, got " + menuItems.length);
pass("HOME has " + menuItems.length + " menu items");

document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "K" }));
await new Promise((r) => setTimeout(r, 10));
const after = document.getElementById("breadcrumb").textContent;
if (!after.includes("KNOWLEDGE")) fail("expected KNOWLEDGE in breadcrumb, got " + after);
pass("press K then breadcrumb shows KNOWLEDGE");

document.dispatchEvent(new window.KeyboardEvent("keydown", { key: ":" }));
await new Promise((r) => setTimeout(r, 10));
const pal = document.getElementById("palette");
if (!pal.classList.contains("show")) fail("palette did not open on colon");
pass("palette opens on colon");
const rows = pal.querySelectorAll(".palette-row");
if (rows.length === 0) fail("palette opened but registry produced no rows");
pass("palette shows " + rows.length + " default commands");

document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
await new Promise((r) => setTimeout(r, 10));
if (pal.classList.contains("show")) fail("palette did not close on Escape");
pass("palette closes on Escape");

const term = document.getElementById("term");
const mode = term.getAttribute("data-mode");
if (!["phone","tablet","desktop"].includes(mode)) fail("data-mode missing or invalid: " + mode);
pass("mode observer set data-mode=" + mode);

// ---- Sprint 2 transport / MESH / queue assertions ----------------
const overseer = window.__overseer;
if (!overseer || !overseer.store || !overseer.transport || !overseer.queue || !overseer.dispatch) {
  fail("window.__overseer missing transport/queue/dispatch");
}
pass("transport stack constructed (store/transport/queue/dispatch attached)");

const meshDotsNow = () => {
  const seg = [...document.querySelectorAll(".statusbar .seg")].find(
    (s) => s.querySelector(".k") && s.querySelector(".k").textContent === "MESH",
  );
  return seg ? seg.querySelector(".v").textContent : null;
};
if (meshDotsNow() === null) fail("MESH segment not found in status strip");

overseer.store.set({ mesh: { reachable: 0, known: 3 } });
await new Promise((r) => setTimeout(r, 5));
const meshDotsOff = meshDotsNow();
if (!meshDotsOff.includes("○") || meshDotsOff.includes("●")) fail(`MESH offline: "${meshDotsOff}"`);
pass(`MESH indicator on offline: "${meshDotsOff}"`);

overseer.store.set({ mesh: { reachable: 3, known: 3 } });
await new Promise((r) => setTimeout(r, 5));
const meshDotsOn = meshDotsNow();
if (!meshDotsOn.includes("●") || meshDotsOn.includes("○")) fail(`MESH healthy: "${meshDotsOn}"`);
pass(`MESH indicator on healthy: "${meshDotsOn}"`);

const t = overseer.transport;
// Replace transport.request with a tracker so we can verify drain order.
const origRequest = t.request.bind(t);
const ranPaths = [];
t.request = async (method, path, body, opts) => {
  ranPaths.push(path);
  if (path === "/api/p/now")     return { batt_pct: 50 };  // mock POWER fetch
  if (path === "/api/p/radio")   return {};
  if (path === "/api/p/storage") return {};
  return { ok: 1 };
};
await overseer.queue.clear();      // start clean
t.healthState = "offline";
await overseer.dispatch({ optimistic: { _testFlag: 1 }, request: { method: "POST", path: "/api/_test/a", body: {} } });
await overseer.dispatch({ optimistic: {},                request: { method: "POST", path: "/api/_test/b", body: {} } });
await new Promise((r) => setTimeout(r, 10));
const sz0 = await overseer.queue.size();
const ranBefore = ranPaths.filter(p => p.startsWith("/api/_test/")).length;
if (ranBefore !== 0 || sz0 !== 2) fail(`offline queue mis-state ran=${ranBefore} sz=${sz0}`);
pass(`offline queue holds 2 actions (size=2, ran=0)`);

t._setHealth("wifi");
await new Promise((r) => setTimeout(r, 50));
const ranAfter = ranPaths.filter(p => p.startsWith("/api/_test/"));
const sz1 = await overseer.queue.size();
if (ranAfter.length !== 2 || ranAfter[0] !== "/api/_test/a" || ranAfter[1] !== "/api/_test/b") fail(`queue drained wrong: ${ranAfter.join(",")}`);
if (sz1 !== 0) fail(`queue not emptied: size=${sz1}`);
pass(`queue drained FIFO on recovery: ${ranAfter.map(p => p.split("/").pop()).join(",")}`);
t.request = origRequest;

// ---- Sprint 3 POWER module assertions ----------------------------
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "P" }));
// Wait for /api/p/* fetch promises to resolve and tiles to repaint.
await new Promise((r) => setTimeout(r, 80));

const power = document.querySelector(".screen-power");
if (!power) fail("POWER screen not mounted on 'P'");
pass("press P then POWER screen mounts");

const tiles = power.querySelectorAll(".tile");
if (tiles.length !== 4) fail(`POWER expected 4 tiles, got ${tiles.length}`);
pass(`POWER has ${tiles.length} tiles (BATTERY/LOAD/RADIO/STORAGE)`);

// BATTERY tile should display the bignum value from the canned /api/p/now
const battery = [...power.querySelectorAll(".tile")].find(
  (t) => t.querySelector(".tile-title") && t.querySelector(".tile-title").textContent.includes("BATTERY"),
);
if (!battery) fail("BATTERY tile not found by title");
const bignum = battery.querySelector(".bignum");
if (!bignum || !bignum.textContent.includes("82")) fail(`BATTERY bignum text wrong: "${bignum && bignum.textContent}"`);
pass(`BATTERY tile shows 82% from canned /api/p/now: "${bignum.textContent.trim()}"`);

// LOAD tile should have CPU/RAM/SWAP bars
const load = [...power.querySelectorAll(".tile")].find(
  (t) => t.querySelector(".tile-title") && t.querySelector(".tile-title").textContent.includes("LOAD"),
);
if (!load) fail("LOAD tile not found");
const bars = load.querySelectorAll(".bar");
if (bars.length < 3) fail(`LOAD expected ≥3 bars, got ${bars.length}`);
pass(`LOAD tile has ${bars.length} bars`);

// RADIO + STORAGE tiles populated from their respective stub endpoints
const radio = [...power.querySelectorAll(".tile")].find(
  (t) => t.querySelector(".tile-title") && t.querySelector(".tile-title").textContent.includes("RADIO"),
);
if (!radio || !radio.textContent.includes("overseer-net")) fail("RADIO tile missing wifi ssid");
pass("RADIO tile shows overseer-net WiFi");

const storage = [...power.querySelectorAll(".tile")].find(
  (t) => t.querySelector(".tile-title") && t.querySelector(".tile-title").textContent.includes("STORAGE"),
);
if (!storage || !storage.textContent.includes("412")) fail("STORAGE tile missing 412 GB");
pass("STORAGE tile shows 412/512 GB used");

// Q returns to HOME and unmounts POWER cleanly
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Q" }));
await new Promise((r) => setTimeout(r, 10));
if (document.querySelector(".screen-power")) fail("POWER did not unmount on Q");
if (!document.querySelector(".screen-home")) fail("HOME did not remount on Q");
pass("Q unmounts POWER and remounts HOME");


// ---- Sprint 5 KNOWLEDGE module assertions ------------------------
// Press Q to return HOME first (smoke is currently in HOME from the
// "Q unmounts POWER" check). Then K → KNOWLEDGE mounts.
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "K" }));
await new Promise((r) => setTimeout(r, 50));
const kb = document.querySelector(".screen-knowledge");
if (!kb) fail("KNOWLEDGE screen not mounted on K");
pass("press K then KNOWLEDGE screen mounts");

const tabs = kb.querySelectorAll(".kb-tab");
if (tabs.length !== 3) fail(`KNOWLEDGE expected 3 tabs (C/L/B), got ${tabs.length}`);
pass(`KNOWLEDGE has ${tabs.length} sub-screen tabs`);

// Default sub-screen is chat — input + log present.
if (!kb.querySelector(".kb-log") || !kb.querySelector(".kb-input")) fail("chat sub-screen missing log/input");
pass("KNOWLEDGE chat sub-screen has log + input");

// Switch to library (clicking the second tab is the most direct path)
tabs[1].click();
await new Promise((r) => setTimeout(r, 50));
const miller = kb.querySelector(".kb-miller");
if (!miller) fail("library Miller columns not mounted on tab switch");
const cols = miller.querySelectorAll(".kb-col");
if (cols.length !== 3) fail(`library expected 3 cols, got ${cols.length}`);
pass(`library Miller columns has ${cols.length} cols (archives | articles | preview)`);

// Archives populated from /api/k/library/archives mock
await new Promise((r) => setTimeout(r, 30));
const items = miller.querySelectorAll(".kb-col:first-child .kb-item");
if (items.length < 2) fail(`archive list expected ≥2 items, got ${items.length}`);
pass(`library shows ${items.length} archives from mocked /api/k/library/archives`);

// Branches sub-screen
tabs[2].click();
await new Promise((r) => setTimeout(r, 30));
const tree = kb.querySelector(".kb-tree");
if (!tree) fail("branches tree node not mounted");
pass("branches sub-screen mounts (tree present)");

console.log("\nALL CHECKS PASSED");
