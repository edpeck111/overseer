// NAVIGATION module — waypoints, compass, sextant text-map, overlays.
//
// Sprint 8. Hotkey N from HOME mounts on waypoints. Sub-screens
// routed by W (waypoints), C (compass), M (text-map), O (overlays).
//
// The text-map sub-screen is THE first real consumer of
// shell/src/sextant/ in production code (ADR-0009). It fetches the
// 1-bit terrain bitmap from /api/n/terrain and runs it through
// rasterize() locally — so the parity guarantee from Sprint 4 has
// real teeth here.

import { el, txt } from "../chrome/_dom.js";
import { rasterize } from "../sextant/index.js";

const SUBS = { W: "waypoints", C: "compass", M: "map", O: "overlays" };
// Default operator location — Sheffield-ish. Real GPS swap in Sprint 8.5.
const ME_LL = { lat: 53.38, lon: -1.47 };

const local = {
  sub: "waypoints",
  waypoints: null,
  selectedCat: null,
  selectedWp: null,
  compass: null,
  mapBitmap: null,
  mapText: null,
  overlays: null,
};

export function mountNavigation(root, store, ctx) {
  const screen = el("div", "screen-nav nav");
  root.replaceChildren(screen);
  const tabs = el("div", "kb-tabs");
  const body = el("div", "kb-body");
  screen.append(tabs, body);

  function paint() {
    tabs.replaceChildren(...["waypoints","compass","map","overlays"].map((s, i) => {
      const t = el("span", "kb-tab" + (local.sub === s ? " active" : ""));
      t.append(el("span", "k", "WCMO"[i]), el("span", "l", s));
      t.addEventListener("click", () => { local.sub = s; paint(); });
      return t;
    }));
    if (local.sub === "waypoints") paintWaypoints(body);
    if (local.sub === "compass")   paintCompass(body);
    if (local.sub === "map")       paintMap(body);
    if (local.sub === "overlays")  paintOverlays(body);
  }

  function onKey(e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (!SUBS[e.key]) return;
    local.sub = SUBS[e.key]; e.preventDefault(); paint();
  }
  document.addEventListener("keydown", onKey, true);

  // Bootstrap a couple of demo waypoints if there are none yet so the
  // gate has something to display on first mount.
  bootstrap().then(paint);

  return function unmount() {
    document.removeEventListener("keydown", onKey, true);
  };
}

async function bootstrap() {
  try {
    const wps = await (await fetch("/api/n/waypoints")).json();
    if (!wps || wps.length === 0) {
      const demo = [
        { name: "Cache-7",  cat: "cache",   lat: 53.39, lon: -1.46, notes: "under the cairn" },
        { name: "RV-North", cat: "rdv",     lat: 53.42, lon: -1.45 },
        { name: "Spring",   cat: "water",   lat: 53.36, lon: -1.49 },
        { name: "Old-mill", cat: "shelter", lat: 53.38, lon: -1.51 },
      ];
      for (const w of demo) {
        await fetch("/api/n/waypoint", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(w),
        }).catch(() => {});
      }
    }
  } catch {}
  await refresh();
}

async function refresh() {
  try { local.waypoints = await (await fetch("/api/n/waypoints")).json(); }
  catch { local.waypoints = []; }
}

// --------------------------- waypoints ---------------------------
function paintWaypoints(body) {
  body.replaceChildren();
  const grid = el("div", "nav-grid");
  body.appendChild(grid);

  const cats = el("div", "kb-col");
  cats.appendChild(el("div", "kb-col-title", txt("CATEGORIES")));
  const wps = local.waypoints || [];
  const byCat = {};
  for (const w of wps) byCat[w.cat] = (byCat[w.cat] || 0) + 1;
  byCat["all"] = wps.length;
  for (const [c, n] of Object.entries(byCat)) {
    const row = el("div", "comms-folder" + ((local.selectedCat || "all") === c ? " sel" : ""));
    row.append(el("span", "fname", txt(c.toUpperCase())), el("span", "fct", txt(String(n))));
    row.addEventListener("click", () => {
      local.selectedCat = c === "all" ? null : c;
      local.selectedWp = null;
      paintWaypoints(body);
    });
    cats.appendChild(row);
  }
  grid.appendChild(cats);

  const items = el("div", "kb-col");
  items.appendChild(el("div", "kb-col-title", txt("WAYPOINTS")));
  const filtered = local.selectedCat ? wps.filter((w) => w.cat === local.selectedCat) : wps;
  for (const w of filtered) {
    const row = el("div", "nav-wp-row" + (local.selectedWp === w.id ? " sel" : ""));
    row.append(
      el("span", "name", txt(w.name)),
      el("span", "cat", txt(w.cat)),
      el("span", "ll", txt(`${w.lat.toFixed(3)}, ${w.lon.toFixed(3)}`)),
    );
    row.addEventListener("click", () => { local.selectedWp = w.id; paintWaypoints(body); });
    items.appendChild(row);
  }
  if (filtered.length === 0) items.appendChild(el("div", "kb-empty", txt("(no waypoints in category)")));
  grid.appendChild(items);

  const detail = el("div", "kb-col");
  detail.appendChild(el("div", "kb-col-title", txt("DETAIL")));
  const w = wps.find((x) => x.id === local.selectedWp);
  if (w) {
    const distKm = haversineKm(ME_LL.lat, ME_LL.lon, w.lat, w.lon);
    const bearing = bearingDeg(ME_LL.lat, ME_LL.lon, w.lat, w.lon);
    detail.append(
      _kv("NAME",  w.name),
      _kv("CAT",   w.cat),
      _kv("LAT",   w.lat.toFixed(5)),
      _kv("LON",   w.lon.toFixed(5)),
      _kv("ELEV",  w.elev != null ? `${Math.round(w.elev)} m` : "—"),
      _kv("BEARING", `${bearing.toFixed(1)}° ${cardinal(bearing)}`),
      _kv("DIST",  distKm < 1 ? `${Math.round(distKm * 1000)} m` : `${distKm.toFixed(2)} km`),
      _kv("VERIFY", w.verified ? "✓" : "—"),
    );
    if (w.notes) detail.appendChild(el("div", "nav-notes", txt(w.notes)));
  } else detail.appendChild(el("div", "kb-empty", txt("← select a waypoint")));
  grid.appendChild(detail);
}

function _kv(k, v) {
  const row = el("div", "med-form-row");
  row.append(el("span", "k", txt(k)), el("span", "v", txt(String(v))));
  return row;
}

// --------------------------- compass ---------------------------
async function paintCompass(body) {
  body.replaceChildren();
  body.appendChild(el("div", "kb-col-title", txt("COMPASS — NEAREST WAYPOINTS")));
  body.appendChild(el("div", "med-form-row",
    el("span", "k", txt("FROM")),
    el("span", "v", txt(`${ME_LL.lat.toFixed(4)}, ${ME_LL.lon.toFixed(4)} (default)`)),
  ));
  if (!local.compass) {
    try {
      local.compass = await (await fetch(`/api/n/nearest?lat=${ME_LL.lat}&lon=${ME_LL.lon}&max=10`)).json();
    } catch { local.compass = []; }
  }
  if (!local.compass.length) {
    body.appendChild(el("div", "kb-empty", txt("(no waypoints to point at)")));
    return;
  }
  const list = el("div", "nav-compass-list");
  for (const c of local.compass) {
    const row = el("div", "nav-compass-row");
    row.append(
      el("span", "bearing", txt(`${String(Math.round(c.bearing_deg)).padStart(3, "0")}°`)),
      el("span", "card",    txt(cardinal(c.bearing_deg))),
      el("span", "name",    txt(c.name)),
      el("span", "cat",     txt(c.cat)),
      el("span", "dist",    txt(c.dist_m < 1000 ? `${c.dist_m} m` : `${(c.dist_m/1000).toFixed(2)} km`)),
    );
    list.appendChild(row);
  }
  body.appendChild(list);
}

// --------------------------- map (sextant text-map) ---------------------------
async function paintMap(body) {
  body.replaceChildren();
  body.appendChild(el("div", "kb-col-title", txt("TEXT MAP · sextant rasterizer (ADR-0009)")));
  if (!local.mapBitmap) {
    try {
      const j = await (await fetch("/api/n/terrain?w=64&h=48&threshold_m=600")).json();
      local.mapBitmap = j.bitmap;
      local.mapText = rasterize(local.mapBitmap);
    } catch (e) {
      local.mapText = `[fetch failed: ${e.message}]`;
    }
  }
  const meta = el("div", "nav-map-meta", txt(
    `bitmap ${local.mapBitmap ? local.mapBitmap[0].length : 0}×${local.mapBitmap ? local.mapBitmap.length : 0}` +
    `  ·  rendered ${local.mapText ? local.mapText.split("\n").length : 0} sextant rows`,
  ));
  body.appendChild(meta);
  const pre = el("pre", "nav-map");
  pre.textContent = local.mapText || "(loading…)";
  body.appendChild(pre);
}

// --------------------------- overlays ---------------------------
async function paintOverlays(body) {
  body.replaceChildren();
  body.appendChild(el("div", "kb-col-title", txt("OVERLAYS")));
  if (!local.overlays) {
    try { local.overlays = await (await fetch("/api/n/overlays")).json(); }
    catch { local.overlays = []; }
  }
  if (!local.overlays.length) {
    body.appendChild(el("div", "kb-empty", txt(
      "no overlays — drawing UI lands in Sprint 8.5 (the polygon picker, hex search, route trace)",
    )));
    return;
  }
  const list = el("div", "nav-ovs");
  for (const o of local.overlays) {
    const row = el("div", "nav-ov-row");
    row.append(
      el("span", "name", txt(o.name)),
      el("span", "kind", txt(o.kind)),
    );
    list.appendChild(row);
  }
  body.appendChild(list);
}

// --------------------------- helpers (mirror server/modules/navigation.py) ---
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const dp = p2 - p1;
  const a = Math.sin(dp/2)**2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}
function cardinal(deg) {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}
