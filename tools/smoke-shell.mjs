// Sprint 1+2 gate smoke test for the shell. jsdom + the built IIFE
// bundle, simulating the Sprint 1 keystrokes plus the Sprint 2
// transport/queue gate ('HOME's MESH indicator reacts to simulated
// mesh health changes; optimistic action queues drain correctly').
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

// fetch() lives in node 22 globally, but jsdom's window doesn't have
// it — give it a no-op so OmpTransport's heartbeat doesn't throw.
window.fetch = () => Promise.reject(new Error("smoke: no network"));
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

// ---- Sprint 1 chrome assertions (preserved) -----------------------
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

// MESH indicator reacts to mesh state changes.
// Re-query after each set: statusbar.js replaces children on re-render
// so a cached node reference is detached after the first update.
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
if (!meshDotsOff.includes("○") || meshDotsOff.includes("●")) {
  fail(`MESH indicator did not flip to all-hollow on offline: "${meshDotsOff}"`);
}
pass(`MESH indicator on offline: "${meshDotsOff}"`);

overseer.store.set({ mesh: { reachable: 3, known: 3 } });
await new Promise((r) => setTimeout(r, 5));
const meshDotsOn = meshDotsNow();
if (!meshDotsOn.includes("●") || meshDotsOn.includes("○")) {
  fail(`MESH indicator did not flip to all-filled on healthy: "${meshDotsOn}"`);
}
pass(`MESH indicator on healthy: "${meshDotsOn}"`);

// Optimistic action queue drains correctly when transport returns
const t = overseer.transport;
// Force the transport offline so next dispatch queues.
t.healthState = "offline";
let ran = [];
const promise1 = overseer.dispatch({
  optimistic: { _testFlag: 1 },
  run: async () => { ran.push("a"); return "a"; },
  reconcile: () => ({}),
});
const promise2 = overseer.dispatch({
  optimistic: {},
  run: async () => { ran.push("b"); return "b"; },
});
await new Promise((r) => setTimeout(r, 10));
if (ran.length !== 0) fail(`offline queue ran prematurely: ${ran}`);
if (overseer.queue.size() !== 2) fail(`queue size expected 2, got ${overseer.queue.size()}`);
pass(`offline queue holds 2 actions (size=${overseer.queue.size()}, ran=${ran.length})`);

// Now flip transport back to "wifi" — onHealthRecovered should fire,
// queue should drain in order.
t._setHealth("wifi");
await new Promise((r) => setTimeout(r, 50));
if (ran.length !== 2 || ran[0] !== "a" || ran[1] !== "b") {
  fail(`queue drained wrong: ${ran}`);
}
if (overseer.queue.size() !== 0) fail(`queue not emptied: size=${overseer.queue.size()}`);
pass(`queue drained FIFO on recovery: ${ran.join(",")}`);

console.log("\nALL CHECKS PASSED");
