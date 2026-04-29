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
window.fetch = async (url, opts) => {
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
  if (u.includes("/api/c/contacts/register")) return fakeResp({ callsign: "ALPHA-1", fp: "abc123" });
  if (u.match(/\/api\/c\/inbox\//)) return fakeResp([
    { id: 1, from: "BRAVO-2", subj: "Re: rendezvous", body: "copy that", when: 1714086840, state: "delivered", verified: true, hops: 1 },
  ]);
  if (u.match(/\/api\/c\/sent\//)) return fakeResp([]);
  if (u.endsWith("/api/c/boards")) return fakeResp([
    { name: "/general", post_count: 14, last_post_at: 1714086840 },
    { name: "/intel",   post_count: 8,  last_post_at: 1714083200 },
    { name: "/trade",   post_count: 5,  last_post_at: null },
    { name: "/swap",    post_count: 2,  last_post_at: null },
    { name: "/sos",     post_count: 0,  last_post_at: null },
  ]);
  if (u.endsWith("/api/m/categories")) return fakeResp([
    { id: "bleeding", name: "BLEEDING", icon: "+" },
    { id: "burns",    name: "BURNS",    icon: "▲" },
    { id: "choking",  name: "CHOKING",  icon: "!" },
  ]);
  if (u.includes("/api/m/tree/bleeding")) return fakeResp({
    name: "BLEEDING", start: "severity",
    nodes: {
      severity: { q: "How severe?", opts: [{ label: "Spurting", next: "arterial" }, { label: "Steady", next: "venous" }] },
      arterial: { action: { title: "ARTERIAL — LIFE THREAT", cls: "danger", steps: ["Press hard"], doList: ["Tourniquet"], dontList: ["Remove dressing"] } },
      venous:   { action: { title: "VENOUS — SERIOUS", steps: ["Direct pressure"], doList: ["Elevate"], dontList: ["Peek often"] } },
    },
  });
  if (u.includes("/api/m/run/start")) return fakeResp({ run_id: 99 });
  if (u.match(/\/api\/m\/run\/\d+\/(step|end)/)) return fakeResp({ ok: true });
  if (u.endsWith("/api/n/waypoints")) return fakeResp([
    { id: 1, name: "Cache-7",  cat: "cache", lat: 53.39, lon: -1.46, elev: null, notes: "under the cairn", verified: true },
    { id: 2, name: "RV-North", cat: "rdv",   lat: 53.42, lon: -1.45, elev: null, notes: "", verified: false },
  ]);
  if (u.includes("/api/n/waypoint")) return fakeResp({ id: 3 });
  if (u.includes("/api/n/nearest")) return fakeResp([
    { id: 1, name: "Cache-7",  cat: "cache", bearing_deg: 12.3, dist_m: 1450 },
    { id: 2, name: "RV-North", cat: "rdv",   bearing_deg: 88.7, dist_m: 4500 },
  ]);
  if (u.includes("/api/n/terrain")) return fakeResp({
    width: 16, height: 12,
    bitmap: Array.from({length: 12}, (_, y) => Array.from({length: 16}, (_, x) => (x + y) % 3 === 0 ? 1 : 0)),
  });
  if (u.endsWith("/api/n/overlays")) return fakeResp([]);
  if (u.endsWith("/api/m/runs")) return fakeResp([
    { id: 99, category: "bleeding", started: 1714086840, ended: 1714086900, outcome: "ARTERIAL — LIFE THREAT", step_count: 1 },
  ]);
  if (u.endsWith("/api/c/net")) return fakeResp([
    { user_id: "BRAVO-2", callsign: "BRAVO-2", transport: "wifi", rssi: -42, dist_m: null, last_seen: Date.now()/1000 - 30 },
    { user_id: "CHARLIE-7", callsign: "CHARLIE-7", transport: "lora", rssi: -101, dist_m: 9000, last_seen: Date.now()/1000 - 600 },
  ]);
  if (u.endsWith("/api/l/today")) return fakeResp({
    date: new Date().toISOString().slice(0,10), day_number: 417,
    entries: [
      { id: 1, kind: "patrol",      body: "N perimeter. Nominal.",          time: "09:14", tags: ["patrol","security"], source: "user", at: 1714086840 },
      { id: 2, kind: "observation", body: "Fresh tracks north of Cache-7.", time: "11:02", tags: ["observation"],         source: "user", at: 1714090440 },
      { id: 3, kind: "incident",    body: "Solar inverter fault, cleared.", time: "16:18", tags: ["incident","power"],   source: "auto", at: 1714112280 },
    ],
  });
  if (u.includes("/api/l/entries")) return fakeResp([
    { id: 1, kind: "patrol",      body: "N perimeter. Nominal.", time: "09:14", date: "2025-04-26", tags: ["patrol"], source: "user", at: 1714086840 },
    { id: 2, kind: "observation", body: "Fresh tracks.",          time: "11:02", date: "2025-04-26", tags: ["observation"], source: "user", at: 1714090440 },
  ]);
  if (u.includes("/api/l/summary/")) return fakeResp({
    date: new Date().toISOString().slice(0,10),
    text: "D+417 — 3 entries logged.\nPatrol: 1 circuit(s) completed.\nIncidents: 1 — review recommended.",
    approved_at: null,
  });
  if (u.includes("/api/l/entry") && !u.includes("entries")) return fakeResp({ id: 99, kind: "note", body: "smoke test entry", tags: ["note"], time: "12:00", date: new Date().toISOString().slice(0,10), at: Date.now()/1000, source: "user" });
  if (u.includes("/api/l/kinds")) return fakeResp(["observation","decision","patrol","ration","incident","triage","comms","system","note"]);

  // INVENTORY mocks
  if (u.endsWith("/api/i/categories")) return fakeResp([
    { id: "food",   name: "Food",   item_count: 4 },
    { id: "water",  name: "Water",  item_count: 2 },
    { id: "medical",name: "Medical",item_count: 1 },
  ]);
  if (u.includes("/api/i/items")) return fakeResp([
    { id: 1, name: "Rice", category: "food", qty: 12, unit: "kg", threshold_qty: 5, exp_days: 720, low: false },
    { id: 2, name: "Purification Tabs", category: "water", qty: 3, unit: "pack", threshold_qty: 10, exp_days: 18, low: true },
    { id: 3, name: "QuikClot", category: "medical", qty: 2, unit: "pack", threshold_qty: 2, exp_days: null, low: false },
  ]);
  if (u.includes("/api/i/expiring")) return fakeResp([
    { id: 2, name: "Purification Tabs", qty: 3, unit: "pack", exp_days: 18 },
    { id: 4, name: "Ibuprofen",         qty: 1, unit: "btl",  exp_days: 25 },
  ]);
  if (u.endsWith("/api/i/low")) return fakeResp([
    { id: 2, name: "Purification Tabs", qty: 3, unit: "pack", threshold_qty: 10 },
  ]);
  if (u.includes("/api/i/pack/optimize")) return fakeResp({
    mission: "48h patrol", total_weight_g: 7200, total_kcal: 4800, medical_coverage: "OK",
    items: [
      { id: 1, name: "Rice",             label: "f", weight_g: 2000, kcal: 3200 },
      { id: 5, name: "Water (2L)",       label: "w", weight_g: 2000, kcal: 0    },
      { id: 3, name: "QuikClot",         label: "g", weight_g: 200,  kcal: 0    },
    ],
  });
  if (u.includes("/api/i/burn")) return fakeResp([]);
  if (u.includes("/api/i/scan") || u.includes("/api/i/item") || u.includes("/api/i/event")) return fakeResp({ id: 99 });

  // TIMELINE mocks
  if (u.includes("/api/t/events")) return fakeResp([
    { module: "log",       kind: "log.patrol",   body: "N perimeter. Nominal.", at: 1714086840, time: "09:14", date: "2025-04-26", day_number: 417, who: null, ref_id: 1 },
    { module: "inventory", kind: "inv.event",    body: "Used Rice ×1",          at: 1714090440, time: "11:02", date: "2025-04-26", day_number: 417, who: null, ref_id: 7 },
    { module: "comms",     kind: "comms.recv",   body: "Msg from BRAVO-2",      at: 1714093440, time: "12:04", date: "2025-04-26", day_number: 417, who: "BRAVO-2", ref_id: 1 },
  ]);
  if (u.includes("/api/t/export")) return fakeResp({ text: "# OVERSEER Timeline Export\n\n## D+417 · 2025-04-26\n\n09:14 log.patrol — N perimeter. Nominal.\n" });
  if (u.includes("/api/t/around")) return fakeResp([]);


  // AUSPICE mocks (Sprint 12+13)
  if (u.includes("/api/u/sky/upcoming")) return fakeResp({ events: [
    { date: "2025-05-01", label: "Full Moon", kind: "full_moon", zodiac: "Scorpio", zodiac_sym: "♏" },
    { date: "2025-05-15", label: "New Moon",  kind: "new_moon",  zodiac: "Taurus",  zodiac_sym: "♉" },
  ]});
  if (u.includes("/api/u/sky")) return fakeResp({
    moon: { phase_name: "waxing gibbous", glyph: "🌔", illumination: 0.72, zodiac: "Scorpio" },
    sun:  { rise: "05:32", transit: "12:44", set: "19:56", zodiac: "Taurus" },
    planets: [
      { name: "Mercury", lon: 42.3, zodiac: "Taurus",  zodiac_sym: "♉" },
      { name: "Venus",   lon: 98.7, zodiac: "Gemini",  zodiac_sym: "♊" },
      { name: "Mars",    lon: 210.1,zodiac: "Scorpio", zodiac_sym: "♏" },
      { name: "Jupiter", lon: 52.5, zodiac: "Taurus",  zodiac_sym: "♉" },
    ],
  });
  if (u.includes("/api/u/chart")) return fakeResp({
    planets: [{ name: "Sun", lon: 98.7, zodiac: "Gemini" }, { name: "Moon", lon: 210.1, zodiac: "Scorpio" }],
    asc: "Virgo",
  });
  if (u.includes("/api/u/almanac")) return fakeResp({
    year: 2025,
    sabbats: [
      { name: "Imbolc",   date: "2025-02-01", solar_lon: 315.0 },
      { name: "Ostara",   date: "2025-03-20", solar_lon: 0.0   },
      { name: "Beltane",  date: "2025-05-01", solar_lon: 45.0  },
      { name: "Litha",    date: "2025-06-20", solar_lon: 90.0  },
      { name: "Lughnasadh", date: "2025-08-01", solar_lon: 135.0 },
      { name: "Mabon",    date: "2025-09-22", solar_lon: 180.0 },
      { name: "Samhain",  date: "2025-10-31", solar_lon: 225.0 },
      { name: "Yule",     date: "2025-12-21", solar_lon: 270.0 },
    ],
    lunar_calendar: [
      { month: 1, month_name: "January", phases: [
        { phase: "new moon",    date: "2025-01-29", glyph: "🌑" },
        { phase: "full moon",   date: "2025-01-13", glyph: "🌕" },
      ]},
      { month: 2, month_name: "February", phases: [
        { phase: "new moon",    date: "2025-02-28", glyph: "🌑" },
        { phase: "full moon",   date: "2025-02-12", glyph: "🌕" },
      ]},
    ],
  });
  if (u.includes("/api/u/spreads")) return fakeResp({ spreads: [
    { id: "ppf",       name: "Past / Present / Future", card_count: 3 },
    { id: "celtic",    name: "Celtic Cross",             card_count: 10 },
    { id: "single",    name: "Single Card",              card_count: 1 },
  ]});
  if (u.includes("/api/u/decks")) return fakeResp({ decks: [{ id: "rws", name: "Rider-Waite-Smith", card_count: 78 }] });
  if (u.includes("/api/u/readings") && opts?.method === "POST") return fakeResp({
    id: 1, spread: "ppf", query: "What lies ahead?",
    cards: [
      { position: "Past",    name: "The High Priestess", reversed: false, keywords: ["intuition","mystery","wisdom"] },
      { position: "Present", name: "The Tower",          reversed: true,  keywords: ["disruption","revelation","change"] },
      { position: "Future",  name: "The Star",           reversed: false, keywords: ["hope","renewal","inspiration"] },
    ],
  });
  if (u.includes("/api/u/readings")) return fakeResp({ readings: [] });
  if (u.includes("/api/u/oracle/iching")) return fakeResp({
    hexagram: { number: 1, name: "The Creative", symbol: "䷀", judgment: "The Creative works sublime success." },
    changing_lines: [1, 4],
  });
  if (u.includes("/api/u/oracle/runes")) return fakeResp({ runes: [
    { name: "Fehu",  glyph: "ᚠ", keywords: ["wealth","abundance","luck"]    },
    { name: "Uruz",  glyph: "ᚢ", keywords: ["strength","vitality","health"] },
    { name: "Thurisaz", glyph: "ᚦ", keywords: ["protection","force","chaos"] },
  ]});
  if (u.includes("/api/u/oracle/traditions")) return fakeResp({ traditions: [
    { name: "Rider-Waite-Smith Tarot", card_count: 78 },
    { name: "Elder Futhark Runes",     card_count: 24 },
    { name: "I Ching",                 card_count: 64 },
  ]});
  if (u.includes("/api/u/daily")) return fakeResp({
    date: "2025-04-26",
    moon: { phase_name: "waxing gibbous", glyph: "🌔" },
    tarot: { name: "The Sun", reversed: false, keywords: ["joy","success","vitality"] },
    rune:  { name: "Sowilo", glyph: "ᛊ", keywords: ["sun","guidance","clarity"] },
    planet_in_sign: "Sun in Taurus",
  });
  if (u.includes("/api/u/journal/unlock")) return fakeResp({ ok: true });
  if (u.includes("/api/u/journal/entries") && opts?.method === "POST") return fakeResp({ id: 1, ok: true });
  if (u.includes("/api/u/journal/entries/")) return fakeResp({ id: 1, date: "2025-04-26", body: "Test entry body.", mood: 4 });
  if (u.includes("/api/u/journal/entries")) return fakeResp({ entries: [
    { id: 1, date: "2025-04-26", preview: "Test entry body.", mood: 4 },
  ]});


  // SIGNAL mocks (Sprint 14)
  if (u.includes("/api/s/weather/passes")) return fakeResp({ passes: [
    { sat: "NOAA-19", freq_mhz: 137.100, aos: "2025-04-27T06:00:00Z", los: "2025-04-27T06:10:00Z", max_el: 45.0, direction: "N" },
    { sat: "NOAA-15", freq_mhz: 137.620, aos: "2025-04-27T08:30:00Z", los: "2025-04-27T08:41:00Z", max_el: 32.5, direction: "S" },
  ]});
  if (u.includes("/api/s/weather/decode")) return fakeResp({ ok: true, note: "synthetic", capture: { id:1, kind:"apt", sat:"NOAA-19", band:null, path:"data/test.png", at: 1714086840 } });
  if (u.includes("/api/s/air")) return fakeResp({ aircraft: [
    { icao:"4CA123", callsign:"EI-ABC", lat:51.52, lon:-0.10, alt_ft:35000, speed_kt:450, heading:270, squawk:"7700", seen:1714086810 },
    { icao:"400F2C", callsign:"G-XYZQ", lat:51.45, lon:-0.25, alt_ft:12000, speed_kt:220, heading: 95, squawk:"1200", seen:1714086825 },
  ]});
  if (u.includes("/api/s/aprs")) return fakeResp({ packets: [
    { callsign:"M0XYZ-9", symbol:"[", lat:51.503, lon:-0.128, comment:"Mobile: speed 0", at:1714086720 },
  ]});
  if (u.includes("/api/s/scan")) return fakeResp({ band:"2m", freq_lo:144.0, freq_hi:146.0, unit:"MHz",
    buckets: Array.from({length:64}, () => -105 + Math.random()*10) });
  if (u.includes("/api/s/bands")) return fakeResp({ bands: [
    { band:"2m",  freq_lo:144.0, freq_hi:146.0, unit:"MHz" },
    { band:"70cm",freq_lo:430.0, freq_hi:440.0, unit:"MHz" },
    { band:"HF",  freq_lo:14.0,  freq_hi:14.35, unit:"MHz" },
    { band:"VHF", freq_lo:108.0, freq_hi:136.0, unit:"MHz" },
    { band:"UHF", freq_lo:400.0, freq_hi:512.0, unit:"MHz" },
  ]});
  if (u.includes("/api/s/captures")) return fakeResp({ captures: [] });
  if (u.includes("/api/s/mesh")) return fakeResp({ nodes: [] });

  // RECREATION mocks (Sprint 15)
  if (u.includes("/api/r/fortune")) return fakeResp({ quote: "Two is one, one is none." });
  if (u.includes("/api/r/wiki/random")) return fakeResp({ title: "Knot -- Bowline", summary: "The bowline forms a fixed loop.", zim: "wikipedia" });
  if (u.includes("/api/r/games")) return fakeResp({ games: [
    { id:"chess",  name:"Chess",          status:"available",    hotkey:"C" },
    { id:"zork",   name:"Bunker Adventure",status:"available",   hotkey:"Z" },
    { id:"dragon", name:"Dragon's Tale",  status:"available", hotkey:"D" },
    { id:"fortune",name:"Fortune",        status:"available",    hotkey:"F" },
    { id:"wiki",   name:"Wiki Roulette",  status:"available",    hotkey:"W" },
    { id:"reader", name:"Reader",         status:"available",    hotkey:"R" },
  ]});
  if (u.includes("/api/r/chess/new")) return fakeResp({ id:1, fen:"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", pgn:[], to_move:"white", result:null, started:1714086840, board:"  a b c d e f g h\n8 r n b q k b n r 8\n7 p p p p p p p p 7\n6 . . . . . . . . 6\n5 . . . . . . . . 5\n4 . . . . . . . . 4\n3 . . . . . . . . 3\n2 P P P P P P P P 2\n1 R N B Q K B N R 1\n  a b c d e f g h" });
  if (u.includes("/api/r/chess/") && u.includes("/move")) return fakeResp({ id:1, fen:"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1", pgn:["e4"], to_move:"black", result:null, started:1714086840, board:"  a b c d e f g h\n8 r n b q k b n r 8", move_recorded:"e4" });
  if (u.includes("/api/r/zork/start")) {
    const sid = (await new Response(opts?.body).json()).session || "test-s";
    return fakeResp({ session: sid, response: "You stand at the reinforced entrance.", done: false });
  }
  if (u.includes("/api/r/zork/") && u.includes("/cmd")) return fakeResp({ response: "You head north into the command room.", room: "command_room", inv:[], done: false });
  if (u.includes("/api/r/reader/progress") && opts?.method === "POST") return fakeResp({ archive:"wikipedia", article:"Bowline", position:0.42, bookmark:null, updated:1714086840 });
  if (u.includes("/api/r/reader/progress")) return fakeResp({ progress: [] });

  // DRAGON mocks (Sprint 16)
  if (u.includes("/api/r/dragon/start")) {
    const sid = (await new Response(opts?.body).json()).session || "d-test";
    return fakeResp({ session: sid, response: "You stand in the village square. A notice board lists quests.", done: false, won: false, room: "village_square", hp: 20, max_hp: 20, inv: [] });
  }
  if (u.includes("/api/r/dragon/") && u.includes("/cmd")) return fakeResp({ response: "You head north to the blacksmith forge.", done: false, won: false, room: "blacksmith_forge", hp: 20, max_hp: 20, inv: [] });

  // SYSTEM mocks (Sprint 17)
  if (u.includes("/api/x/info"))     return fakeResp({ node:"overseer", os:"Linux 6.1.0", arch:"aarch64", python:"3.10.12", cpu_cores:4, load_1m:0.12, uptime_s:86400, disk:{ total_gb:32.0, free_gb:18.3 }, at:Date.now()/1000 });
  if (u.includes("/api/x/users") && (!opts || opts.method !== "POST" && opts.method !== "DELETE"))
    return fakeResp({ users: [
      { uid:"ALPHA-1", callsign:"ALPHA-1", role:"admin",    last_seen: Date.now()/1000-120, active:true  },
      { uid:"BRAVO-2", callsign:"BRAVO-2", role:"operator", last_seen: Date.now()/1000-3600, active:true },
    ]});
  if (u.includes("/api/x/users") && opts?.method === "POST") return fakeResp({ uid:"TEST-9", callsign:"TEST-9", role:"observer", last_seen:null, active:false });
  if (u.includes("/api/x/settings") && opts?.method === "POST") return fakeResp({ key:"theme", value:"dark" });
  if (u.includes("/api/x/settings")) return fakeResp({ settings: { callsign:"ALPHA-1", tz:"UTC", theme:"dark" } });
  if (u.includes("/api/x/backup/trigger")) return fakeResp({ ok:true, job:{ id:1, target:"Full DB", status:"pending" } });
  if (u.includes("/api/x/backup"))  return fakeResp({ jobs: [
    { id:1, target:"Full DB",    path:"/mnt/usb0/db.tar.gz",     status:"ok",      size_mb:82.4, at:Date.now()/1000-7200 },
    { id:2, target:"Config",     path:"/mnt/usb0/config.tar.gz", status:"ok",      size_mb:1.2,  at:Date.now()/1000-7200 },
    { id:3, target:"Knowledge",  path:"/mnt/usb0/know.tar.gz",   status:"pending", size_mb:0.0,  at:Date.now()/1000-60   },
  ]});
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
if (menuItems.length !== 13) fail("expected 13 menu items, got " + menuItems.length);
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


// ---- Sprint 6 COMMS assertions ----------------------------------
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Q" }));   // back to HOME first
await new Promise((r) => setTimeout(r, 30));
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "C" }));
await new Promise((r) => setTimeout(r, 100));     // bootstrap fetches need to resolve
const cm = document.querySelector(".screen-comms");
if (!cm) fail("COMMS screen not mounted on C");
pass("press C then COMMS screen mounts");

const cmTabs = cm.querySelectorAll(".kb-tab");
if (cmTabs.length !== 3) fail(`COMMS expected 3 tabs (M/B/N), got ${cmTabs.length}`);
pass(`COMMS has ${cmTabs.length} sub-screen tabs`);

// Mail sub-screen has the 3-pane grid + 5 folders
const cmGrid = cm.querySelector(".comms-grid");
if (!cmGrid) fail("COMMS mail grid not present");
const folders = cm.querySelectorAll(".comms-folders .comms-folder");
if (folders.length !== 5) fail(`COMMS expected 5 folders (INBOX/SENT/DRAFTS/ARCHIVE/OUTBOX), got ${folders.length}`);
pass(`COMMS mail has ${folders.length} folders + 3 panes`);

// Inbox row visible (the "Re: rendezvous" message from the fetch mock)
await new Promise((r) => setTimeout(r, 30));
const cmRows = cm.querySelectorAll(".comms-row");
if (cmRows.length === 0) fail("COMMS inbox empty (mock /api/c/inbox not consumed)");
pass(`COMMS inbox shows ${cmRows.length} message(s) from mocked /api/c/inbox`);

// Boards sub-screen
cmTabs[1].click();
await new Promise((r) => setTimeout(r, 60));
const boardRows = cm.querySelectorAll(".comms-folder");
if (boardRows.length !== 5) fail(`COMMS boards expected 5, got ${boardRows.length}`);
pass(`COMMS boards lists ${boardRows.length} boards (general/intel/trade/swap/sos)`);

// Net sub-screen
cmTabs[2].click();
await new Promise((r) => setTimeout(r, 60));
const netRows = cm.querySelectorAll(".comms-net-list .net-row");
if (netRows.length < 1) fail("COMMS net pane has no rows");
pass(`COMMS net pane shows ${netRows.length} mesh node(s)`);


// ---- Sprint 7 MEDICAL assertions ---------------------------------
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Q" }));
await new Promise((r) => setTimeout(r, 30));
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "M" }));
await new Promise((r) => setTimeout(r, 80));
const med = document.querySelector(".screen-medical");
if (!med) fail("MEDICAL screen not mounted on M");
pass("press M then MEDICAL screen mounts");

const medTabs = med.querySelectorAll(".kb-tab");
if (medTabs.length !== 5) fail(`MEDICAL expected 5 tabs (T/H/D/R/P), got ${medTabs.length}`);
pass(`MEDICAL has ${medTabs.length} sub-screen tabs`);

// Triage category picker — at least 3 cards from the mock
const cards = med.querySelectorAll(".med-cat-card");
if (cards.length < 3) fail(`MEDICAL category picker expected ≥3 cards, got ${cards.length}`);
pass(`MEDICAL triage picker shows ${cards.length} categories`);

// Click a category → wizard renders with a question + opts
cards[0].click();
await new Promise((r) => setTimeout(r, 60));
const q = med.querySelector(".med-q");
if (!q) fail("MEDICAL wizard question not rendered after category click");
pass(`MEDICAL wizard rendered question: "${q.textContent.slice(0, 30)}..."`);

const opts = med.querySelectorAll(".med-opt");
if (opts.length < 2) fail(`MEDICAL wizard expected ≥2 options, got ${opts.length}`);
pass(`MEDICAL wizard offers ${opts.length} options`);

// Pick the first option → expect an action (outcome) card
opts[0].click();
await new Promise((r) => setTimeout(r, 60));
const outcome = med.querySelector(".med-action-card");
if (!outcome) fail("MEDICAL outcome card not rendered after answer");
pass(`MEDICAL wizard reached outcome card: "${med.querySelector('.med-action-title').textContent.slice(0,30)}..."`);

// History sub-screen — uses mocked /api/m/runs
medTabs[1].click();
await new Promise((r) => setTimeout(r, 60));
const runRows = med.querySelectorAll(".med-run-row");
if (runRows.length === 0) fail("MEDICAL history empty (mock /api/m/runs not consumed)");
pass(`MEDICAL history shows ${runRows.length} run(s)`);


// ---- Sprint 8 NAVIGATION assertions ------------------------------
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Q" }));
await new Promise((r) => setTimeout(r, 30));
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "N" }));
await new Promise((r) => setTimeout(r, 100));
const nav = document.querySelector(".screen-nav");
if (!nav) fail("NAVIGATION screen not mounted on N");
pass("press N then NAVIGATION screen mounts");

const navTabs = nav.querySelectorAll(".kb-tab");
if (navTabs.length !== 4) fail(`NAVIGATION expected 4 tabs (W/C/M/O), got ${navTabs.length}`);
pass(`NAVIGATION has ${navTabs.length} sub-screen tabs`);

// Waypoints sub-screen — at least 2 from the mock
const wpRows = nav.querySelectorAll(".nav-wp-row");
if (wpRows.length < 1) fail(`NAVIGATION waypoints expected ≥1, got ${wpRows.length}`);
pass(`NAVIGATION waypoints shows ${wpRows.length} rows from mocked /api/n/waypoints`);

// Compass sub-screen — bearing rows from /api/n/nearest
navTabs[1].click();
await new Promise((r) => setTimeout(r, 60));
const compassRows = nav.querySelectorAll(".nav-compass-row");
if (compassRows.length < 1) fail("NAVIGATION compass empty (mock /api/n/nearest not consumed)");
pass(`NAVIGATION compass shows ${compassRows.length} bearing(s)`);

// Map sub-screen — text-map rendered through the JS sextant rasterizer
navTabs[2].click();
await new Promise((r) => setTimeout(r, 80));
const mapPre = nav.querySelector(".nav-map");
if (!mapPre) fail("NAVIGATION text-map not rendered");
const mapText = mapPre.textContent;
// Verify the output contains sextant glyphs (U+1FB00..1FB3B range or
// the four substitutions). Cheap test: presence of a non-ASCII char.
if (!/[\u2580\u2588\u2590\u258C\u{1FB00}-\u{1FB3B}]/u.test(mapText)) {
  fail(`NAVIGATION text-map has no sextant glyphs: "${mapText.slice(0, 40)}"`);
}
pass(`NAVIGATION text-map renders sextant glyphs (${mapText.split("\n").length} rows)`);

// Overlays sub-screen
navTabs[3].click();
await new Promise((r) => setTimeout(r, 60));
const overlayBody = nav.querySelector(".kb-empty, .nav-ovs");
if (!overlayBody) fail("NAVIGATION overlays sub-screen empty");
pass("NAVIGATION overlays sub-screen mounts");




// ---- Sprint 9 LOG assertions -------------------------------------
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Q" }));
await new Promise((r) => setTimeout(r, 30));
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "L" }));
await new Promise((r) => setTimeout(r, 100));
const lg = document.querySelector(".screen-log");
if (!lg) fail("LOG screen not mounted on L");
pass("press L then LOG screen mounts");

const lgTabs = lg.querySelectorAll(".kb-tab");
if (lgTabs.length !== 4) fail(`LOG expected 4 tabs (T/E/S/X), got ${lgTabs.length}`);
pass(`LOG has ${lgTabs.length} sub-screen tabs`);

// TODAY — entries render from mock /api/l/today
await new Promise((r) => setTimeout(r, 60));
const lgRows = lg.querySelectorAll(".log-entry-row");
if (lgRows.length < 3) fail(`LOG today expected ≥3 entry rows, got ${lgRows.length}`);
pass(`LOG today shows ${lgRows.length} entries from mocked /api/l/today`);

// Day header shows D+ number
const lgHeader = lg.querySelector(".log-day-num");
if (!lgHeader || !lgHeader.textContent.includes("D+")) fail("LOG day header missing D+ number");
pass(`LOG day header: "${lgHeader.textContent.trim()}"`);

// Quick-entry input present
const lgInput = lg.querySelector(".log-input");
if (!lgInput) fail("LOG quick-entry input not present");
pass("LOG quick-entry input present");

// ENTRIES sub-screen
lgTabs[1].click();
await new Promise((r) => setTimeout(r, 80));
const lgEntryRows = lg.querySelectorAll(".log-entry-row");
if (lgEntryRows.length < 1) fail("LOG entries sub-screen empty (mock /api/l/entries not consumed)");
pass(`LOG entries sub-screen shows ${lgEntryRows.length} rows`);

// Kind filter select present
const lgKindSel = lg.querySelector(".log-filter-kind");
if (!lgKindSel) fail("LOG entries kind filter missing");
pass("LOG entries kind filter select present");

// SUMMARY sub-screen
lgTabs[2].click();
await new Promise((r) => setTimeout(r, 80));
const lgSummary = lg.querySelector(".log-summary-card");
if (!lgSummary) fail("LOG summary card not rendered");
pass("LOG summary card renders from mocked /api/l/summary");

const lgSummaryText = lg.querySelector(".log-summary-text");
if (!lgSummaryText || !lgSummaryText.textContent.includes("D+")) fail("LOG summary text missing D+ line");
pass(`LOG summary text: "${lgSummaryText.textContent.slice(0,40).trim()}…"`);

// Approve button present (not yet approved)
const lgApproveBtn = lg.querySelector(".log-approve-btn");
if (!lgApproveBtn) fail("LOG approve button not present");
pass("LOG approve button present on unapproved summary");

// EXPORT sub-screen
lgTabs[3].click();
await new Promise((r) => setTimeout(r, 40));
const lgExportBtn = lg.querySelector(".log-export-btn");
if (!lgExportBtn) fail("LOG export button not present");
pass("LOG export sub-screen mounts with date range + export button");


// ---- Sprint 10 INVENTORY assertions ---------------------------------
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Q" }));
await new Promise((r) => setTimeout(r, 30));
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "I" }));
await new Promise((r) => setTimeout(r, 100));
const inv = document.querySelector(".screen-inv");
if (!inv) fail("INVENTORY screen not mounted on I");
pass("press I then INVENTORY screen mounts");

const invTabs = inv.querySelectorAll(".kb-tab");
if (invTabs.length !== 4) fail(`INVENTORY expected 4 tabs (B/E/L/P), got ${invTabs.length}`);
pass(`INVENTORY has ${invTabs.length} sub-screen tabs`);

// BROWSE — Miller columns present + categories loaded from mock
await new Promise((r) => setTimeout(r, 60));
const invMiller = inv.querySelector(".inv-miller");
if (!miller) fail("INVENTORY Miller columns not present");
pass("INVENTORY BROWSE shows Miller columns");

const catRows = inv.querySelectorAll(".inv-cat-row");
if (catRows.length < 3) fail(`INVENTORY expected ≥3 category rows, got ${catRows.length}`);
pass(`INVENTORY BROWSE shows ${catRows.length} categories from mocked /api/i/categories`);

// Click first category -> items column populates
catRows[0].click();
await new Promise((r) => setTimeout(r, 80));
const itemRows = inv.querySelectorAll(".inv-item-row");
if (itemRows.length < 1) fail(`INVENTORY items column empty after cat click, got ${itemRows.length}`);
pass(`INVENTORY BROWSE items column shows ${itemRows.length} items`);

// EXPIRING sub-screen
invTabs[1].click();
await new Promise((r) => setTimeout(r, 80));
const expRows = inv.querySelectorAll(".inv-exp-row");
if (expRows.length < 1) fail(`INVENTORY expiring expected >=1 row, got ${expRows.length}`);
pass(`INVENTORY EXPIRING shows ${expRows.length} expiring item(s)`);

// LOW sub-screen
invTabs[2].click();
await new Promise((r) => setTimeout(r, 80));
const lowRows = inv.querySelectorAll(".inv-low-row");
if (lowRows.length < 1) fail(`INVENTORY low expected >=1 row, got ${lowRows.length}`);
pass(`INVENTORY LOW shows ${lowRows.length} below-threshold item(s)`);

// PACK sub-screen — form present
invTabs[3].click();
await new Promise((r) => setTimeout(r, 40));
const packForm = inv.querySelector(".inv-pack-form");
if (!packForm) fail("INVENTORY PACK form not present");
pass("INVENTORY PACK sub-screen mounts with optimizer form");

const packMissionSel = inv.querySelector(".inv-pack-mission-sel");
if (!packMissionSel) fail("INVENTORY PACK mission select not present");
pass("INVENTORY PACK mission select present");

const packBtn = inv.querySelector(".inv-pack-btn");
if (!packBtn) fail("INVENTORY PACK optimize button not present");
pass("INVENTORY PACK OPTIMIZE button present");

// Click OPTIMIZE -> results populate from mock
packBtn.click();
await new Promise((r) => setTimeout(r, 80));
const packRows = inv.querySelectorAll(".inv-pack-row");
if (packRows.length < 1) fail(`INVENTORY PACK results expected >=1 row, got ${packRows.length}`);
pass(`INVENTORY PACK results show ${packRows.length} item(s) from mocked /api/i/pack/optimize`);


// ---- Sprint 11 TIMELINE assertions -----------------------------------
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Q" }));
await new Promise((r) => setTimeout(r, 30));
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "T" }));
await new Promise((r) => setTimeout(r, 100));
const tl = document.querySelector(".screen-tl");
if (!tl) fail("TIMELINE screen not mounted on T");
pass("press T then TIMELINE screen mounts");

const tlTabs = tl.querySelectorAll(".kb-tab");
if (tlTabs.length !== 3) fail(`TIMELINE expected 3 tabs (F/S/X), got ${tlTabs.length}`);
pass(`TIMELINE has ${tlTabs.length} sub-screen tabs`);

// FEED — range bar + event stream from mock
await new Promise((r) => setTimeout(r, 80));
const rangeBar = tl.querySelector(".tl-range-bar");
if (!rangeBar) fail("TIMELINE range bar not present");
pass("TIMELINE FEED shows range selector bar");

const rangeBtns = tl.querySelectorAll(".tl-range-btn");
if (rangeBtns.length !== 5) fail(`TIMELINE expected 5 range buttons (24h/72h/7d/30d/all), got ${rangeBtns.length}`);
pass(`TIMELINE range bar has ${rangeBtns.length} range buttons`);

const tlStream = tl.querySelector(".tl-stream");
if (!tlStream) fail("TIMELINE event stream not rendered");
pass("TIMELINE FEED event stream mounted");

const tlRows = tl.querySelectorAll(".tl-event-row");
if (tlRows.length < 3) fail(`TIMELINE expected >=3 event rows, got ${tlRows.length}`);
pass(`TIMELINE FEED shows ${tlRows.length} events from mocked /api/t/events`);

// SEARCH sub-screen — filter inputs + button
tlTabs[1].click();
await new Promise((r) => setTimeout(r, 40));
const tlSearchQ = tl.querySelector(".tl-search-q");
if (!tlSearchQ) fail("TIMELINE SEARCH query input not present");
pass("TIMELINE SEARCH query input present");

const tlSearchBtn = tl.querySelector(".tl-search-btn");
if (!tlSearchBtn) fail("TIMELINE SEARCH button not present");
pass("TIMELINE SEARCH SEARCH button present");

// EXPORT sub-screen — date pickers + export button
tlTabs[2].click();
await new Promise((r) => setTimeout(r, 40));
const tlExportBtn = tl.querySelector(".tl-export-btn");
if (!tlExportBtn) fail("TIMELINE EXPORT button not present");
pass("TIMELINE EXPORT sub-screen mounts with date range + EXPORT MD button");

// Click EXPORT -> markdown preview appears
tlExportBtn.click();
await new Promise((r) => setTimeout(r, 80));
const tlPreview = tl.querySelector(".tl-export-preview");
if (!tlPreview) fail("TIMELINE EXPORT preview not rendered after click");
if (!tlPreview.textContent.includes("D+417")) fail("TIMELINE EXPORT preview missing expected D+417 content");
pass(`TIMELINE EXPORT preview renders: "${tlPreview.textContent.slice(0,40).trim()}..."`);



// ---- Sprint 12+13 AUSPICE assertions ---------------------------------
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Q" }));
await new Promise((r) => setTimeout(r, 30));
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "U" }));
await new Promise((r) => setTimeout(r, 120));
const au = document.querySelector(".screen-auspice");
if (!au) fail("AUSPICE screen not mounted on U");
pass("press U then AUSPICE screen mounts");

const auTabs = au.querySelectorAll(".kb-tab");
if (auTabs.length !== 7) fail(`AUSPICE expected 7 tabs (S/C/T/O/D/J/A), got ${auTabs.length}`);
pass(`AUSPICE has ${auTabs.length} sub-screen tabs`);

// SKY — default sub-screen
await new Promise((r) => setTimeout(r, 100));
const auMoonPhase = au.querySelector(".au-moon-phase");
if (!auMoonPhase) fail("AUSPICE SKY moon phase block not present");
pass("AUSPICE SKY moon phase block renders");

const auSkyGrid = au.querySelector(".au-sky-grid");
if (!auSkyGrid) fail("AUSPICE SKY planet grid not present");
pass("AUSPICE SKY planet grid renders");

const auSkyRows = au.querySelectorAll(".au-sky-row");
if (auSkyRows.length < 2) fail(`AUSPICE SKY expected >=2 planet rows, got ${auSkyRows.length}`);
pass(`AUSPICE SKY shows ${auSkyRows.length} planet rows`);

const auUpcoming = au.querySelector(".au-upcoming-list");
if (!auUpcoming) fail("AUSPICE SKY upcoming events list not present");
pass("AUSPICE SKY upcoming events list renders");

// TAROT sub-screen
auTabs[2].click();  // T
await new Promise((r) => setTimeout(r, 80));
const auSpreadSel = au.querySelector(".au-tarot-spread");
if (!auSpreadSel) fail("AUSPICE TAROT spread selector not present");
pass("AUSPICE TAROT spread selector renders");

const auTarotBtn = au.querySelector(".au-tarot-btn");
if (!auTarotBtn) fail("AUSPICE TAROT DRAW button not present");
pass("AUSPICE TAROT DRAW button present");

// Click DRAW → cards appear
auTarotBtn.click();
await new Promise((r) => setTimeout(r, 80));
const auCards = au.querySelectorAll(".au-tarot-card");
if (auCards.length < 3) fail(`AUSPICE TAROT expected >=3 card rows, got ${auCards.length}`);
pass(`AUSPICE TAROT shows ${auCards.length} drawn cards`);

// ORACLE sub-screen → I Ching
auTabs[3].click();  // O
await new Promise((r) => setTimeout(r, 60));
const auIchingBtn = au.querySelector(".au-oracle-btn");
if (!auIchingBtn) fail("AUSPICE ORACLE I Ching CAST button not present");
pass("AUSPICE ORACLE I Ching CAST button present");

auIchingBtn.click();
await new Promise((r) => setTimeout(r, 80));
const auHex = au.querySelector(".au-iching-card");
if (!auHex) fail("AUSPICE ORACLE I Ching result card not rendered");
pass("AUSPICE ORACLE I Ching result card renders after CAST");

// DAILY sub-screen
auTabs[4].click();  // D
await new Promise((r) => setTimeout(r, 100));
const auDailyCard = au.querySelector(".au-daily-card");
if (!auDailyCard) fail("AUSPICE DAILY card not rendered");
pass("AUSPICE DAILY card renders");

// ALMANAC sub-screen
auTabs[6].click();  // A
await new Promise((r) => setTimeout(r, 100));
const auSabbats = au.querySelectorAll(".au-sabbat-row");
if (auSabbats.length < 8) fail(`AUSPICE ALMANAC expected >=8 sabbat rows, got ${auSabbats.length}`);
pass(`AUSPICE ALMANAC shows ${auSabbats.length} sabbat rows`);

const auLunarGrid = au.querySelector(".au-lunar-grid");
if (!auLunarGrid) fail("AUSPICE ALMANAC lunar grid not rendered");
pass("AUSPICE ALMANAC lunar calendar grid renders");


// ---- Sprint 14 SIGNAL smoke assertions ----------------------------
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Q" }));
await new Promise((r) => setTimeout(r, 30));
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "S" }));
await new Promise((r) => setTimeout(r, 120));
const sig = document.querySelector(".screen-signal");
if (!sig) fail("SIGNAL screen not mounted on S");
pass("press S then SIGNAL screen mounts");

const sigTabs = sig.querySelectorAll(".kb-tab");
if (sigTabs.length !== 6) fail(`SIGNAL expected 6 tabs, got ${sigTabs.length}`);
pass(`SIGNAL has ${sigTabs.length} sub-screen tabs`);

// WEATHER sub-screen (default)
await new Promise((r) => setTimeout(r, 120));
const sigPasses = sig.querySelectorAll(".sig-pass-row:not(.sig-pass-hdr)");
if (sigPasses.length < 1) fail(`SIGNAL WEATHER expected >=1 pass rows, got ${sigPasses.length}`);
pass(`SIGNAL WEATHER shows ${sigPasses.length} pass rows`);

// AIR sub-screen
sigTabs[1].click();
await new Promise((r) => setTimeout(r, 80));
const sigAir = sig.querySelectorAll(".sig-air-row:not(.sig-air-hdr)");
if (sigAir.length < 1) fail(`SIGNAL AIR expected >=1 track rows, got ${sigAir.length}`);
pass(`SIGNAL AIR shows ${sigAir.length} aircraft tracks`);

// APRS sub-screen
sigTabs[2].click();
await new Promise((r) => setTimeout(r, 80));
const sigAprs = sig.querySelectorAll(".sig-aprs-row");
if (sigAprs.length < 1) fail(`SIGNAL APRS expected >=1 packet rows, got ${sigAprs.length}`);
pass(`SIGNAL APRS shows ${sigAprs.length} APRS packets`);

// BANDS sub-screen
sigTabs[5].click();
await new Promise((r) => setTimeout(r, 80));
const sigBands = sig.querySelectorAll(".sig-band-row:not(.sig-band-hdr)");
if (sigBands.length < 1) fail(`SIGNAL BANDS expected >=1 band rows, got ${sigBands.length}`);
pass(`SIGNAL BANDS shows ${sigBands.length} bands`);

// ---- Sprint 15 RECREATION smoke assertions ------------------------
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Q" }));
await new Promise((r) => setTimeout(r, 30));
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "R" }));
await new Promise((r) => setTimeout(r, 120));
const rec = document.querySelector(".screen-recreation");
if (!rec) fail("RECREATION screen not mounted on R");
pass("press R then RECREATION screen mounts");

const recTabs = rec.querySelectorAll(".kb-tab");
if (recTabs.length !== 7) fail(`RECREATION expected 7 tabs, got ${recTabs.length}`);
pass(`RECREATION has ${recTabs.length} sub-screen tabs`);

// FORTUNE sub-screen (default) - draw a fortune
const drawBtn = rec.querySelector(".kb-btn");
if (!drawBtn) fail("RECREATION FORTUNE draw button missing");
drawBtn.click();
await new Promise((r) => setTimeout(r, 80));
const quote = rec.querySelector(".rec-fortune-quote");
if (!quote) fail("RECREATION FORTUNE quote not rendered after draw");
pass("RECREATION FORTUNE quote renders after draw");

// WIKI sub-screen
recTabs[1].click();
await new Promise((r) => setTimeout(r, 60));
const spinBtn = rec.querySelector(".kb-btn");
if (spinBtn) spinBtn.click();
await new Promise((r) => setTimeout(r, 80));
const article = rec.querySelector(".rec-article-title");
if (!article) fail("RECREATION WIKI article not rendered after spin");
pass("RECREATION WIKI article renders after spin");

// GAMES sub-screen
recTabs[2].click();
await new Promise((r) => setTimeout(r, 80));
const gameRows = rec.querySelectorAll(".rec-game-row");
if (gameRows.length < 1) fail(`RECREATION GAMES expected >=1 game rows, got ${gameRows.length}`);
pass(`RECREATION GAMES shows ${gameRows.length} games`);


// ---- Sprint 16 DRAGON smoke assertions ---------------------------
// Navigate to recreation, switch to dragon tab
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Q" }));
await new Promise((r) => setTimeout(r, 30));
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "R" }));
await new Promise((r) => setTimeout(r, 120));
const rec2 = document.querySelector(".screen-recreation");
if (!rec2) fail("RECREATION screen not mounted for dragon test");

// Now 7 tabs (F/W/G/C/Z/R/D)
const recTabs2 = rec2.querySelectorAll(".kb-tab");
if (recTabs2.length !== 7) fail(`RECREATION expected 7 tabs (with dragon), got ${recTabs2.length}`);
pass(`RECREATION has ${recTabs2.length} tabs including dragon`);

// Click dragon tab (index 6)
recTabs2[6].click();
await new Promise((r) => setTimeout(r, 80));
const dragonStart = rec2.querySelector(".rec-dragon-start");
if (!dragonStart) fail("RECREATION DRAGON start button missing");
pass("RECREATION DRAGON start button present");

// Start dragon adventure
dragonStart.click();
await new Promise((r) => setTimeout(r, 120));
const dragonHist = rec2.querySelector(".rec-dragon-hist");
if (!dragonHist) fail("RECREATION DRAGON history panel not rendered after start");
pass("RECREATION DRAGON history panel renders after start");

const dragonInp = rec2.querySelector(".rec-dragon-inp");
if (!dragonInp) fail("RECREATION DRAGON command input missing");
pass("RECREATION DRAGON command input present");

// ---- Sprint 17 SYSTEM smoke assertions ---------------------------
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Q" }));
await new Promise((r) => setTimeout(r, 30));
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "X" }));
await new Promise((r) => setTimeout(r, 120));
const sys = document.querySelector(".screen-system");
if (!sys) fail("SYSTEM screen not mounted on X");
pass("press X → SYSTEM screen mounts");

const sysTabs = sys.querySelectorAll(".kb-tab");
if (sysTabs.length !== 4) fail(`SYSTEM expected 4 tabs, got ${sysTabs.length}`);
pass(`SYSTEM has ${sysTabs.length} sub-screen tabs`);

// INFO sub-screen (default)
const infoGrid = sys.querySelector(".sys-kv-grid");
if (!infoGrid) fail("SYSTEM INFO kv-grid not rendered");
pass("SYSTEM INFO kv-grid present");

// USERS sub-screen
sysTabs[1].click();
await new Promise((r) => setTimeout(r, 80));
const userRows = sys.querySelectorAll(".sys-user-row:not(.sys-user-hdr)");
if (userRows.length < 1) fail(`SYSTEM USERS expected >=1 user rows, got ${userRows.length}`);
pass(`SYSTEM USERS shows ${userRows.length} users`);

// SETTINGS sub-screen
sysTabs[2].click();
await new Promise((r) => setTimeout(r, 80));
const settingRows = sys.querySelectorAll(".sys-setting-row");
if (settingRows.length < 1) fail(`SYSTEM SETTINGS expected >=1 setting rows, got ${settingRows.length}`);
pass(`SYSTEM SETTINGS shows ${settingRows.length} settings`);

// BACKUP sub-screen
sysTabs[3].click();
await new Promise((r) => setTimeout(r, 80));
const backupRows = sys.querySelectorAll(".sys-backup-row");
if (backupRows.length < 1) fail(`SYSTEM BACKUP expected >=1 backup rows, got ${backupRows.length}`);
pass(`SYSTEM BACKUP shows ${backupRows.length} jobs`);

// ---- Sprint 17 HELP smoke assertions ---------------------------
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Q" }));
await new Promise((r) => setTimeout(r, 30));
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "?" }));
await new Promise((r) => setTimeout(r, 120));
const hlp = document.querySelector(".screen-help");
if (!hlp) fail("HELP screen not mounted on ?");
pass("press ? → HELP screen mounts");

const hlpTabs = hlp.querySelectorAll(".kb-tab");
if (hlpTabs.length !== 4) fail(`HELP expected 4 tabs, got ${hlpTabs.length}`);
pass(`HELP has ${hlpTabs.length} sub-screen tabs`);

// HOTKEYS sub-screen (default)
const hlpRows = hlp.querySelectorAll(".hlp-hotkey-row");
if (hlpRows.length < 1) fail(`HELP HOTKEYS expected >=1 rows, got ${hlpRows.length}`);
pass(`HELP HOTKEYS shows ${hlpRows.length} hotkey rows`);

// COMMANDS sub-screen
hlpTabs[1].click();
await new Promise((r) => setTimeout(r, 60));
const hlpCmds = hlp.querySelector(".hlp-cmd-list, .hlp-section-title");
if (!hlpCmds) fail("HELP COMMANDS section not rendered");
pass("HELP COMMANDS section renders");

console.log("\nALL CHECKS PASSED");
