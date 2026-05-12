/* === POWER MODULE: System vitals, thermal monitoring === */

let powerInitialized = false;
let powerPollTimer = null;

function powerInit() {
  if (powerInitialized) return;
  powerInitialized = true;
  powerRefresh();
  powerStartPolling();
}

function powerStartPolling() {
  powerStopPolling();
  powerPollTimer = setInterval(powerRefresh, 10000);
}

function powerStopPolling() {
  if (powerPollTimer) { clearInterval(powerPollTimer); powerPollTimer = null; }
}

async function powerRefresh() {
  const container = document.getElementById('power-vitals');
  try {
    const resp = await fetch('/power/status');
    const d = await resp.json();
    powerRender(d);
  } catch (e) {
    container.innerHTML = '<div class="power-section"><div class="power-section-title">--- ERROR ---</div><div class="power-row">[!] FAILED TO REACH HOST</div></div>';
  }
}

function powerRender(d) {
  const container = document.getElementById('power-vitals');
  let html = '';

  // Thermal
  html += '<div class="power-section">';
  html += '<div class="power-section-title">--- THERMAL ---</div>';
  if (d.cpu_temp_c !== null) {
    const tempClass = d.cpu_temp_c >= 75 ? 'power-hot' : d.cpu_temp_c >= 60 ? 'power-warm' : 'power-cool';
    html += '<div class="power-row"><span class="power-lbl">CPU TEMP:</span><span class="' + tempClass + '">' + d.cpu_temp_c + '\u00B0C</span></div>';
    html += '<div class="power-bar-wrap">' + powerBar(d.cpu_temp_c, 100, tempClass) + '</div>';
  } else {
    html += '<div class="power-row"><span class="power-lbl">CPU TEMP:</span><span class="power-dim">N/A</span></div>';
  }
  html += '</div>';

  // CPU
  html += '<div class="power-section">';
  html += '<div class="power-section-title">--- CPU ---</div>';
  html += '<div class="power-row"><span class="power-lbl">USAGE:</span>' + d.cpu_percent + '%</div>';
  html += '<div class="power-bar-wrap">' + powerBar(d.cpu_percent, 100) + '</div>';
  html += '</div>';

  // Memory
  html += '<div class="power-section">';
  html += '<div class="power-section-title">--- MEMORY ---</div>';
  html += '<div class="power-row"><span class="power-lbl">USED:</span>' + d.ram_used_gb + ' / ' + d.ram_total_gb + ' GB (' + d.ram_percent + '%)</div>';
  html += '<div class="power-bar-wrap">' + powerBar(d.ram_percent, 100) + '</div>';
  html += '</div>';

  // Storage
  html += '<div class="power-section">';
  html += '<div class="power-section-title">--- STORAGE ---</div>';
  html += '<div class="power-row"><span class="power-lbl">USED:</span>' + d.disk_used_gb + ' / ' + d.disk_total_gb + ' GB (' + d.disk_percent + '%)</div>';
  html += '<div class="power-bar-wrap">' + powerBar(d.disk_percent, 100) + '</div>';
  html += '</div>';

  // Uptime
  html += '<div class="power-section">';
  html += '<div class="power-section-title">--- UPTIME ---</div>';
  html += '<div class="power-row"><span class="power-lbl">RUNNING:</span>' + d.uptime_str + '</div>';
  html += '</div>';

  // Timestamp
  const now = new Date();
  const ts = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
  html += '<div class="power-refresh-ts">LAST UPDATE: ' + ts + ' \u2014 AUTO-REFRESH 10s</div>';

  container.innerHTML = html;
}

function powerBar(value, max, colorClass) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const filled = Math.round(pct / 100 * 20);
  const empty = 20 - filled;
  const cls = colorClass || (pct >= 90 ? 'power-hot' : pct >= 70 ? 'power-warm' : 'power-cool');
  return '<span class="power-bar ' + cls + '">[' + '\u2588'.repeat(filled) + '\u2591'.repeat(empty) + ']</span> <span class="power-bar-pct">' + Math.round(pct) + '%</span>';
}
