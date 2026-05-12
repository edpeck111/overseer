// NAVIGATION module — waypoints, compass, Leaflet map, overlays.
//
// Sprint 8.  Hotkey N from HOME mounts on waypoints.  Sub-screens
// routed by W (waypoints), C (compass), M (map), O (overlays).
//
// Sprint 21: M sub-screen upgraded from sextant text-map to real
// Leaflet tile map served from /api/n/tiles/{z}/{x}/{y} (MBTiles).

import { el, txt } from "../chrome/_dom.js";

const SUBS = { W: "waypoints", C: "compass", M: "map", O: "overlays" };
// Default operator location when /api/n/gps/fix returns 204 (no fix yet).
// Sheffield-ish so the map opens to UK by default; replaced as soon as
// the configured GPS backend produces a fix.
const ME_LL = { lat: 53.38, lon: -1.47 };

// Poll cadence for the GPS fix endpoint (ms). Synthetic walks ≤10 m / read;
// real gpsd / NMEA updates are typically 1 Hz, but we don't need to keep up
// with that on a Leaflet marker.
const GPS_POLL_MS = 10_000;

const local = {
  sub: "waypoints",
  waypoints: null,
  selectedCat: null,
  selectedWp: null,
  compass: null,
  overlays: null,
  leafletMap: null,     // live Leaflet instance — destroyed on unmount
  tilesAvailable: null, // null=unchecked, true/false
  operatorMarker: null, // live Leaflet circleMarker for the operator
  gpsPollId: null,      // setInterval handle for /api/n/gps/fix
  lastFix: null,        // most recent fix dict, or null
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
    if (local.gpsPollId) { clearInterval(local.gpsPollId); local.gpsPollId = null; }
    if (local.leafletMap) { local.leafletMap.remove(); local.leafletMap = null; }
    local.operatorMarker = null;
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

// --------------------------- map (Leaflet, real OSM tiles) ---------------------------

// Fetch the current GPS fix; returns null on 204 / network error / non-OK.
async function fetchGpsFix() {
  try {
    const resp = await fetch("/api/n/gps/fix");
    if (resp.status === 204) return null;
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

// Update the operator marker + recenter (only if no manual pan since the
// last fix — Leaflet's hasUserInteracted is not exposed, so we keep it
// simple: recenter on first fix only).
function applyFix(map, fix, isFirstFix) {
  if (!fix || !local.operatorMarker) return;
  local.operatorMarker.setLatLng([fix.lat, fix.lon]);
  const popup = `<b>YOUR POSITION</b><br>` +
                `${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}` +
                (fix.alt_m != null ? `<br>alt ${fix.alt_m.toFixed(0)} m` : "") +
                (fix.sats ? `<br>${fix.sats} sat · ${fix.fix_type}` : "");
  local.operatorMarker.setPopupContent(popup);
  if (isFirstFix) map.setView([fix.lat, fix.lon], Math.max(map.getZoom(), 10));
  local.lastFix = fix;
}

async function paintMap(body) {
  // Always destroy the previous Leaflet instance before replacing the DOM.
  // Also stop any GPS poll the previous instance left running.
  if (local.gpsPollId) { clearInterval(local.gpsPollId); local.gpsPollId = null; }
  if (local.leafletMap) { local.leafletMap.remove(); local.leafletMap = null; }
  local.operatorMarker = null;

  body.replaceChildren();

  // Check tile availability once per session
  if (local.tilesAvailable === null) {
    try {
      const s = await (await fetch("/api/n/tiles/status")).json();
      local.tilesAvailable = s.available && s.tiles > 0;
      local._tilesMeta = s;
    } catch { local.tilesAvailable = false; }
  }

  const header = el("div", "nav-map-header");
  if (!local.tilesAvailable) {
    const banner = el("div", "nav-disabled-banner");
    banner.appendChild(el("span", "icon", txt("⚠")));
    banner.appendChild(el("span", "msg", txt(
      "MAP TILES NOT DOWNLOADED — run: python tools/download_tiles.py  " +
      "(or: set MBTILES_MAX_ZOOM=8 for a quick z0-8 set)"
    )));
    header.appendChild(banner);
  } else {
    const m = local._tilesMeta || {};
    header.appendChild(el("div", "nav-map-meta",
      txt(`OSM tiles: ${(m.tiles||0).toLocaleString()} · z${m.minzoom||0}-${m.maxzoom||14} · ${m.bounds||"UK"}`)));
  }
  body.appendChild(header);

  if (!window.L) {
    body.appendChild(el("div", "kb-empty", txt("Leaflet unavailable — check network")));
    return;
  }

  const mapDiv = document.createElement("div");
  mapDiv.className = "nav-leaflet-map";
  body.appendChild(mapDiv);

  // Leaflet must initialise after the container is in the DOM
  requestAnimationFrame(() => {
    const map = window.L.map(mapDiv, { zoomControl: true }).setView([ME_LL.lat, ME_LL.lon], 7);

    window.L.tileLayer("/api/n/tiles/{z}/{x}/{y}", {
      maxZoom: 14,
      minZoom: 0,
      attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
      // silent on missing tiles -- shows blank rather than broken-image icon
      errorTileUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScAAAAAElFTkSuQmCC",
    }).addTo(map);

    // Operator position — starts at default, updated by /api/n/gps/fix poll.
    local.operatorMarker = window.L.circleMarker(
      [ME_LL.lat, ME_LL.lon],
      { radius: 7, color: "#0f0", fillColor: "#0f0", fillOpacity: 0.8 }
    )
      .bindPopup("<b>YOUR POSITION</b><br>(default — waiting for GPS fix)")
      .addTo(map);

    // Kick off an immediate fetch + recurring poll. If the configured GPS
    // backend never produces a fix (and the synthetic source is disabled),
    // /api/n/gps/fix returns 204 and we stay at the default position.
    let firstFix = true;
    fetchGpsFix().then((fix) => {
      if (fix) { applyFix(map, fix, firstFix); firstFix = false; }
    });
    local.gpsPollId = setInterval(() => {
      fetchGpsFix().then((fix) => {
        if (fix) { applyFix(map, fix, firstFix); firstFix = false; }
      });
    }, GPS_POLL_MS);

    // Waypoints
    const wps = local.waypoints || [];
    const catColors = { cache: "#f80", rdv: "#0bf", water: "#48f", shelter: "#fa0", default: "#aaa" };
    for (const w of wps) {
      const col = catColors[w.cat] || catColors.default;
      window.L.circleMarker([w.lat, w.lon], { radius: 6, color: col, fillColor: col, fillOpacity: 0.9 })
        .bindPopup(
          `<b>${w.name}</b><br>` +
          `cat: ${w.cat}<br>` +
          `${w.lat.toFixed(5)}, ${w.lon.toFixed(5)}` +
          (w.notes ? `<br><em>${w.notes}</em>` : "")
        )
        .addTo(map);
    }

    local.leafletMap = map;
  });
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
