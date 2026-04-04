/* === MAPS MODULE: Waypoints, Navigation, GPS === */

let mapsInitialized = false;
let mapsWaypoints = [];

const MAP_CATEGORIES = [
  { id: 'camp',    label: 'CAMP',        icon: '^' },
  { id: 'water',   label: 'WATER',       icon: '~' },
  { id: 'cache',   label: 'CACHE',       icon: '#' },
  { id: 'hazard',  label: 'HAZARD',      icon: '!' },
  { id: 'rally',   label: 'RALLY POINT', icon: '*' },
  { id: 'medical', label: 'MEDICAL',     icon: '+' },
  { id: 'comms',   label: 'COMMS',       icon: '@' },
  { id: 'general', label: 'GENERAL',     icon: '.' },
];

function mapsInit() {
  if (mapsInitialized) return;
  mapsInitialized = true;
  mapsLoadWaypoints();
}

// === TABS ===
function switchMapsTab(tab) {
  document.querySelectorAll('#module-maps .maps-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('mtab-' + tab).classList.add('active');
  document.getElementById('maps-waypoints-panel').style.display = tab === 'waypoints' ? 'flex' : 'none';
  document.getElementById('maps-navigate-panel').style.display = tab === 'navigate' ? 'flex' : 'none';
  if (tab === 'navigate') mapsPopulateNavSelects();
}

// === WAYPOINTS ===
async function mapsLoadWaypoints() {
  try {
    const resp = await fetch('/maps/waypoints');
    const data = await resp.json();
    mapsWaypoints = data.waypoints || [];
    mapsRenderWaypoints();
  } catch (e) {
    document.getElementById('maps-wp-list').innerHTML = '<div class="maps-empty">[!] FAILED TO LOAD WAYPOINTS</div>';
  }
}

function mapsRenderWaypoints() {
  const list = document.getElementById('maps-wp-list');
  if (mapsWaypoints.length === 0) {
    list.innerHTML = '<div class="maps-empty">NO WAYPOINTS SAVED<br><br>Add waypoints manually or use GET POSITION to capture GPS coordinates from this device.</div>';
    return;
  }
  let html = '';
  mapsWaypoints.forEach(wp => {
    const cat = MAP_CATEGORIES.find(c => c.id === wp.category) || MAP_CATEGORIES[7];
    const latDir = wp.lat >= 0 ? 'N' : 'S';
    const lonDir = wp.lon >= 0 ? 'E' : 'W';
    html += '<div class="maps-wp-card" onclick="mapsShowWpDetail(' + wp.id + ')">';
    html += '  <div class="maps-wp-icon">' + esc(cat.icon) + '</div>';
    html += '  <div class="maps-wp-info">';
    html += '    <div class="maps-wp-name">' + esc(wp.name) + '</div>';
    html += '    <div class="maps-wp-coords">' + Math.abs(wp.lat).toFixed(6) + '\u00B0' + latDir + ' ' + Math.abs(wp.lon).toFixed(6) + '\u00B0' + lonDir + '</div>';
    if (wp.notes) html += '    <div class="maps-wp-notes">' + esc(wp.notes) + '</div>';
    html += '  </div>';
    html += '  <div class="maps-wp-cat">' + esc(cat.label) + '</div>';
    html += '</div>';
  });
  list.innerHTML = html;
}

function mapsShowWpDetail(id) {
  const wp = mapsWaypoints.find(w => w.id === id);
  if (!wp) return;
  const cat = MAP_CATEGORIES.find(c => c.id === wp.category) || MAP_CATEGORIES[7];
  const dms = mapsDecToDms(wp.lat, wp.lon);
  let html = '<div class="maps-detail">';
  html += '<div class="maps-detail-title">' + esc(cat.icon) + ' ' + esc(wp.name) + '</div>';
  html += '<div class="maps-detail-row"><span class="maps-lbl">CATEGORY:</span> ' + esc(cat.label) + '</div>';
  html += '<div class="maps-detail-row"><span class="maps-lbl">DECIMAL:</span> ' + wp.lat.toFixed(6) + ', ' + wp.lon.toFixed(6) + '</div>';
  html += '<div class="maps-detail-row"><span class="maps-lbl">DMS:</span> ' + dms + '</div>';
  if (wp.notes) html += '<div class="maps-detail-row"><span class="maps-lbl">NOTES:</span> ' + esc(wp.notes) + '</div>';
  html += '<div class="maps-detail-row"><span class="maps-lbl">SAVED:</span> ' + formatTime(wp.created_at) + '</div>';
  html += '<div style="margin-top:12px; display:flex; gap:8px;">';
  html += '  <button class="admin-btn" onclick="mapsDeleteWp(' + wp.id + ')">DELETE</button>';
  html += '  <button class="admin-btn" onclick="mapsNavToWp(' + wp.id + ')">NAVIGATE TO</button>';
  html += '</div>';
  html += '</div>';

  document.getElementById('maps-wp-list').innerHTML = '<div style="margin-bottom:8px;"><button class="article-back" onclick="mapsRenderWaypoints()">&lt; BACK</button></div>' + html;
}

async function mapsDeleteWp(id) {
  try {
    await fetch('/maps/waypoints/' + id, { method: 'DELETE' });
    mapsWaypoints = mapsWaypoints.filter(w => w.id !== id);
    mapsRenderWaypoints();
  } catch (e) {}
}

function mapsNavToWp(id) {
  const wp = mapsWaypoints.find(w => w.id === id);
  if (!wp) return;
  switchMapsTab('navigate');
  document.getElementById('nav-lat2').value = wp.lat.toFixed(6);
  document.getElementById('nav-lon2').value = wp.lon.toFixed(6);
  document.getElementById('nav-to-select').value = '';
}

// === ADD WAYPOINT ===
function mapsShowAddForm() {
  const form = document.getElementById('maps-add-form');
  form.style.display = form.style.display === 'none' ? 'flex' : 'none';
}

async function mapsAddWaypoint() {
  const name = document.getElementById('wp-name').value.trim();
  const lat = document.getElementById('wp-lat').value.trim();
  const lon = document.getElementById('wp-lon').value.trim();
  const category = document.getElementById('wp-category').value;
  const notes = document.getElementById('wp-notes').value.trim();
  const msg = document.getElementById('maps-add-msg');

  if (!name) { msg.textContent = '[!] NAME REQUIRED'; return; }
  if (!lat || !lon || isNaN(lat) || isNaN(lon)) { msg.textContent = '[!] VALID COORDINATES REQUIRED'; return; }

  msg.textContent = 'SAVING...';
  try {
    const resp = await fetch('/maps/waypoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, lat: parseFloat(lat), lon: parseFloat(lon), category, notes })
    });
    const data = await resp.json();
    if (data.ok) {
      msg.textContent = '[OK] WAYPOINT SAVED';
      document.getElementById('wp-name').value = '';
      document.getElementById('wp-lat').value = '';
      document.getElementById('wp-lon').value = '';
      document.getElementById('wp-notes').value = '';
      mapsLoadWaypoints();
      setTimeout(() => { msg.textContent = ''; }, 2000);
    } else {
      msg.textContent = '[!] ' + (data.error || 'SAVE FAILED');
    }
  } catch (e) {
    msg.textContent = '[!] CONNECTION ERROR';
  }
}

// === GPS ===
function mapsGetPosition() {
  const msg = document.getElementById('maps-gps-msg');
  if (!navigator.geolocation) {
    msg.textContent = '[!] GPS NOT AVAILABLE ON THIS DEVICE';
    return;
  }
  msg.textContent = 'ACQUIRING POSITION...';
  navigator.geolocation.getCurrentPosition(
    pos => {
      document.getElementById('wp-lat').value = pos.coords.latitude.toFixed(6);
      document.getElementById('wp-lon').value = pos.coords.longitude.toFixed(6);
      const acc = pos.coords.accuracy ? ' (\u00B1' + Math.round(pos.coords.accuracy) + 'm)' : '';
      msg.textContent = '[OK] POSITION ACQUIRED' + acc;
      setTimeout(() => { msg.textContent = ''; }, 3000);
    },
    err => {
      if (err.code === 1) msg.textContent = '[!] LOCATION PERMISSION DENIED';
      else if (err.code === 2) msg.textContent = '[!] POSITION UNAVAILABLE';
      else msg.textContent = '[!] GPS TIMEOUT';
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// === NAVIGATION / DISTANCE ===
function mapsPopulateNavSelects() {
  const fromSel = document.getElementById('nav-from-select');
  const toSel = document.getElementById('nav-to-select');
  let opts = '<option value="">-- MANUAL ENTRY --</option>';
  mapsWaypoints.forEach(wp => {
    opts += '<option value="' + wp.id + '">' + esc(wp.name) + ' (' + wp.lat.toFixed(4) + ', ' + wp.lon.toFixed(4) + ')</option>';
  });
  fromSel.innerHTML = opts;
  toSel.innerHTML = opts;
}

function mapsNavSelectFrom() {
  const id = parseInt(document.getElementById('nav-from-select').value);
  const wp = mapsWaypoints.find(w => w.id === id);
  if (wp) {
    document.getElementById('nav-lat1').value = wp.lat.toFixed(6);
    document.getElementById('nav-lon1').value = wp.lon.toFixed(6);
  }
}

function mapsNavSelectTo() {
  const id = parseInt(document.getElementById('nav-to-select').value);
  const wp = mapsWaypoints.find(w => w.id === id);
  if (wp) {
    document.getElementById('nav-lat2').value = wp.lat.toFixed(6);
    document.getElementById('nav-lon2').value = wp.lon.toFixed(6);
  }
}

function mapsNavGetPos(target) {
  const msg = document.getElementById('maps-nav-msg');
  if (!navigator.geolocation) { msg.textContent = '[!] GPS NOT AVAILABLE'; return; }
  msg.textContent = 'ACQUIRING...';
  navigator.geolocation.getCurrentPosition(
    pos => {
      document.getElementById('nav-lat' + target).value = pos.coords.latitude.toFixed(6);
      document.getElementById('nav-lon' + target).value = pos.coords.longitude.toFixed(6);
      document.getElementById('nav-' + (target === '1' ? 'from' : 'to') + '-select').value = '';
      msg.textContent = '';
    },
    () => { msg.textContent = '[!] GPS FAILED'; },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

async function mapsCalculateRoute() {
  const lat1 = parseFloat(document.getElementById('nav-lat1').value);
  const lon1 = parseFloat(document.getElementById('nav-lon1').value);
  const lat2 = parseFloat(document.getElementById('nav-lat2').value);
  const lon2 = parseFloat(document.getElementById('nav-lon2').value);
  const result = document.getElementById('maps-nav-result');

  if ([lat1, lon1, lat2, lon2].some(isNaN)) {
    result.innerHTML = '<div class="maps-empty">[!] ENTER VALID COORDINATES FOR BOTH POINTS</div>';
    return;
  }

  try {
    const resp = await fetch('/maps/navigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat1, lon1, lat2, lon2 })
    });
    const data = await resp.json();
    if (data.error) { result.innerHTML = '<div class="maps-empty">[!] ' + esc(data.error) + '</div>'; return; }

    const cardinal = mapsCardinal(data.bearing_deg);
    let html = '<div class="maps-nav-results">';
    html += '<div class="maps-nav-big">' + data.distance_km + ' km</div>';
    html += '<div class="maps-nav-big-sub">' + data.distance_mi + ' mi</div>';
    html += '<div class="maps-nav-row"><span class="maps-lbl">BEARING:</span> ' + data.bearing_deg + '\u00B0 ' + cardinal + '</div>';
    html += '<div class="maps-nav-row"><span class="maps-lbl">FROM:</span> ' + lat1.toFixed(6) + ', ' + lon1.toFixed(6) + '</div>';
    html += '<div class="maps-nav-row"><span class="maps-lbl">TO:</span> ' + lat2.toFixed(6) + ', ' + lon2.toFixed(6) + '</div>';
    html += '<div class="maps-nav-row"><span class="maps-lbl">FROM DMS:</span> ' + mapsDecToDms(lat1, lon1) + '</div>';
    html += '<div class="maps-nav-row"><span class="maps-lbl">TO DMS:</span> ' + mapsDecToDms(lat2, lon2) + '</div>';
    html += '</div>';
    result.innerHTML = html;
  } catch (e) {
    result.innerHTML = '<div class="maps-empty">[!] CONNECTION ERROR</div>';
  }
}

// === COORDINATE UTILITIES ===
function mapsDecToDms(lat, lon) {
  function convert(dd, pos, neg) {
    const dir = dd >= 0 ? pos : neg;
    dd = Math.abs(dd);
    const d = Math.floor(dd);
    const mf = (dd - d) * 60;
    const m = Math.floor(mf);
    const s = ((mf - m) * 60).toFixed(1);
    return d + '\u00B0' + m + "'" + s + '"' + dir;
  }
  return convert(lat, 'N', 'S') + ' ' + convert(lon, 'E', 'W');
}

function mapsCardinal(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}
