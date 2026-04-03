/* === CORE: State, Audio, Boot, Dashboard, Module Switching, Utilities === */

let chat, input, sendBtn;
const conversationHistory = [];
let charQueue = [];
let isTyping = false;
let outputArea = null;
let charsSinceSound = 0;
let CHAR_DELAY = 18;
const CHAR_DELAY_NORMAL = 18;
const CHAR_DELAY_FAST = 3;
const STORAGE_KEY = 'overseer_chat_history';
let bootInfo = null;

// === VIRTUAL KEYBOARD HANDLING (hide bottom nav when keyboard opens) ===
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const nav = document.querySelector('.module-nav');
    if (!nav) return;
    const keyboardOpen = window.visualViewport.height < window.innerHeight * 0.75;
    nav.style.display = keyboardOpen ? 'none' : 'flex';
  });
}

// === MODULE SWITCHING ===
const MODULE_COLORS = {
  knowledge:  { glow: '#33ff33', dim: '#1a8c1a', border: '#1a3a1a' },
  comms:      { glow: '#ffaa00', dim: '#996600', border: '#3a2a0a' },
  medical:    { glow: '#ff4444', dim: '#991a1a', border: '#3a0a0a' },
  system:     { glow: '#cccccc', dim: '#666666', border: '#2a2a2a' }
};

function switchModule(name) {
  const screen = document.getElementById('terminal');
  screen.setAttribute('data-module', name);

  const nav = document.querySelector('.module-nav');
  const colors = MODULE_COLORS[name];
  if (nav && colors) {
    nav.style.setProperty('--glow', colors.glow);
    nav.style.setProperty('--glow-dim', colors.dim);
    nav.style.setProperty('--border', colors.border);
    nav.style.borderTopColor = colors.border;
  }

  document.querySelectorAll('.module-nav button').forEach(btn => btn.classList.remove('active'));
  document.getElementById('nav-' + name).classList.add('active');

  document.querySelectorAll('.module-panel').forEach(panel => panel.classList.remove('active'));
  document.getElementById('module-' + name).classList.add('active');

  if (name === 'knowledge' && input) {
    setTimeout(() => input.focus(), 50);
  }

  if (name === 'system' && bootInfo) {
    populateSystemInfo(bootInfo);
  }

  if (name === 'comms' && !commsUserId) {
    commsLoadUserList();
  }
}

function populateSystemInfo(info) {
  let coreHtml = '';
  coreHtml += '<div class="sys-row"><span class="sys-label">VERSION:</span><span class="sys-value">v' + info.version + '</span></div>';
  coreHtml += '<div class="sys-row"><span class="sys-label">BUILD DATE:</span><span class="sys-value">' + info.build_date + '</span></div>';
  coreHtml += '<div class="sys-row"><span class="sys-label">CODENAME:</span><span class="sys-value">' + info.codename + '</span></div>';
  coreHtml += '<div class="sys-row"><span class="sys-label">SYSTEM RAM:</span><span class="sys-value">' + info.ram_total_gb + ' GB total / ' + info.ram_free_gb + ' GB free</span></div>';
  coreHtml += '<div class="sys-row"><span class="sys-label">INFERENCE ENGINE:</span><span class="sys-value">' + info.inference_engine + '</span></div>';
  coreHtml += '<div class="sys-row"><span class="sys-label">KB SERVER:</span><span class="sys-value">' + info.knowledge_server + '</span></div>';
  document.getElementById('sys-core-info').innerHTML = coreHtml;

  let modelsHtml = '';
  if (info.models.length > 0) {
    info.models.forEach(m => {
      modelsHtml += '<div class="sys-row"><span class="sys-label">' + m.name + '</span><span class="sys-value">' + m.size_gb + ' GB  |  Pulled: ' + m.date + '</span></div>';
    });
  } else {
    modelsHtml = '<div style="color:var(--red);">[!] NO MODELS DETECTED</div>';
  }
  document.getElementById('sys-models').innerHTML = modelsHtml;

  let archivesHtml = '';
  if (info.zim_files.length > 0) {
    info.zim_files.forEach(z => {
      archivesHtml += '<div class="sys-row"><span class="sys-label">' + z.name + '</span><span class="sys-value">[' + z.size_gb + ' GB]  (' + z.date + ')</span></div>';
      archivesHtml += '<div style="padding-left:168px;color:var(--glow-dim);font-size:0.9em;">' + z.desc + '</div>';
    });
    archivesHtml += '<div class="sys-row" style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;"><span class="sys-label">TOTAL ARCHIVE SIZE:</span><span class="sys-value">' + info.total_kb_size_gb + ' GB</span></div>';
  } else {
    archivesHtml = '<div style="color:var(--red);">[!] NO KNOWLEDGE ARCHIVES FOUND</div>';
  }
  document.getElementById('sys-archives').innerHTML = archivesHtml;
}

// === AUDIO ENGINE ===
let audioCtx = null;
let soundEnabled = true;
const keyBuffers = [];
let keysLoaded = false;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  document.getElementById('soundToggle').textContent = soundEnabled ? '[SND: ON]' : '[SND: OFF]';
}

function toggleContrast() {
  document.body.classList.toggle('high-contrast');
  const on = document.body.classList.contains('high-contrast');
  document.getElementById('contrastToggle').textContent = on ? '[HI-CON:ON]' : '[HI-CON]';
}

async function loadKeySounds() {
  const ctx = getAudioCtx();
  for (let i = 1; i <= 8; i++) {
    try {
      const num = String(i).padStart(2, '0');
      const resp = await fetch('/sounds/key' + num + '.wav');
      const buf = await resp.arrayBuffer();
      const decoded = await ctx.decodeAudioData(buf);
      keyBuffers.push(decoded);
    } catch(e) { console.warn('Failed to load key' + i, e); }
  }
  keysLoaded = keyBuffers.length > 0;
}

function playKeystroke() {
  if (!soundEnabled || !keysLoaded) return;
  try {
    const ctx = getAudioCtx();
    const buf = keyBuffers[Math.floor(Math.random() * keyBuffers.length)];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.95 + Math.random() * 0.1;
    const gain = ctx.createGain();
    gain.gain.value = 0.5 + Math.random() * 0.15;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  } catch(e) {}
}

function playNewline() {
  if (!soundEnabled || !keysLoaded) return;
  try {
    const ctx = getAudioCtx();
    const buf = keyBuffers[Math.floor(Math.random() * keyBuffers.length)];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  } catch(e) {}
}

function playError() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 330;
      gain.gain.setValueAtTime(0.2, t + i * 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.2 + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + i * 0.2);
      osc.stop(t + i * 0.2 + 0.15);
    }
  } catch(e) {}
}

// === CLOCK ===
function updateClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  el.textContent = h + ':' + m + ':' + s;
}
setInterval(updateClock, 1000);
updateClock();

// === TYPEWRITER WITH PHOSPHOR GLOW ===
function typeCharacters(area, text) {
  charQueue.push(...text.split(''));
  if (!isTyping) drainQueue(area);
}

function drainQueue(area) {
  if (charQueue.length === 0) { isTyping = false; return; }
  isTyping = true;

  const ch = charQueue.shift();

  if (ch === '\n') {
    area.appendChild(document.createTextNode('\n'));
  } else {
    const span = document.createElement('span');
    span.className = 'phosphor-char';
    span.textContent = ch;
    area.appendChild(span);
    charsSinceSound++;
    if (charsSinceSound >= 5 + Math.floor(Math.random() * 5)) {
      playKeystroke();
      charsSinceSound = 0;
    }
  }

  chat.scrollTop = chat.scrollHeight;
  setTimeout(() => drainQueue(area), CHAR_DELAY);
}

// === SPLASH & BOOT ===
let bootCharQueue = [];
let bootIsTyping = false;
let bootCharsSinceSound = 0;

function bootTypeCharacters(area, text) {
  bootCharQueue.push(...text.split(''));
  if (!bootIsTyping) bootDrainQueue(area);
}

function bootDrainQueue(area) {
  if (bootCharQueue.length === 0) { bootIsTyping = false; return; }
  bootIsTyping = true;
  const ch = bootCharQueue.shift();
  if (ch === '\n') {
    area.appendChild(document.createTextNode('\n'));
  } else {
    const span = document.createElement('span');
    span.className = 'phosphor-char';
    span.textContent = ch;
    area.appendChild(span);
    bootCharsSinceSound++;
    if (bootCharsSinceSound >= 5 + Math.floor(Math.random() * 5)) {
      playKeystroke();
      bootCharsSinceSound = 0;
    }
  }
  setTimeout(() => bootDrainQueue(area), CHAR_DELAY_FAST);
}

let bootStarted = false;
let bootFinished = false;

function bootTypeLine(area, text) {
  return new Promise(resolve => {
    bootTypeCharacters(area, text + '\n');
    const check = () => { if (!bootIsTyping) resolve(); else setTimeout(check, 30); };
    check();
  });
}

function bootAppendSpan(area, text, className) {
  const span = document.createElement('span');
  span.className = className || '';
  span.textContent = text;
  area.appendChild(span);
}

async function bootTypeCheck(area, label, result, status) {
  const padded = label + ' ';
  const dots = '.'.repeat(Math.max(2, 32 - padded.length));
  await bootTypeLine(area, padded + dots + ' ');
  await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
  const lastChild = area.lastChild;
  if (lastChild && lastChild.textContent === '\n') area.removeChild(lastChild);
  const colorClass = status === 'ok' ? 'boot-ok' : status === 'warn' ? 'boot-warn' : 'boot-fail';
  bootAppendSpan(area, '[' + (status === 'ok' ? 'OK' : status === 'warn' ? 'WARN' : 'FAIL') + '] ', colorClass);
  bootAppendSpan(area, result + '\n', 'boot-dim');
  playKeystroke();
}

async function startBoot() {
  if (bootFinished) {
    enterTerminal();
    return;
  }
  if (bootStarted) return;
  bootStarted = true;

  document.getElementById('splash-boot').style.display = '';
  document.getElementById('splash-prompt').innerHTML = '<div style="color:var(--glow-dim);font-size:0.8em;">INITIALIZING...</div>';

  await loadKeySounds();

  const bootArea = document.getElementById('boot-output');

  await bootTypeLine(bootArea, '========================================');
  await bootTypeLine(bootArea, ' O.V.E.R.S.E.E.R.  BOOT SEQUENCE');
  await bootTypeLine(bootArea, '========================================');
  await bootTypeLine(bootArea, '');

  await bootTypeLine(bootArea, 'RUNNING SYSTEM DIAGNOSTICS...');
  await bootTypeLine(bootArea, '');

  try {
    const resp = await fetch('/boot');
    bootInfo = await resp.json();
  } catch(e) {
    bootInfo = null;
  }

  if (bootInfo) {
    await bootTypeCheck(bootArea, 'MEMORY SUBSYSTEM',
      bootInfo.ram_total_gb + ' GB TOTAL / ' + bootInfo.ram_free_gb + ' GB FREE', 'ok');

    const aiOk = bootInfo.models && bootInfo.models.length > 0;
    await bootTypeCheck(bootArea, 'AI ENGINE',
      aiOk ? bootInfo.inference_engine : 'OFFLINE',
      aiOk ? 'ok' : 'warn');

    if (aiOk) {
      bootInfo.models.forEach(m => {
        bootAppendSpan(bootArea, '    MODEL: ' + m.name + ' (' + m.size_gb + ' GB)\n', 'boot-dim');
      });
    }

    const kbOk = bootInfo.zim_files && bootInfo.zim_files.length > 0;
    await bootTypeCheck(bootArea, 'KNOWLEDGE BASE',
      kbOk ? bootInfo.zim_files.length + ' VOLUMES / ' + bootInfo.total_kb_size_gb + ' GB' : 'NO ARCHIVES',
      kbOk ? 'ok' : 'warn');

    const kbServerOk = bootInfo.knowledge_server && !bootInfo.knowledge_server.includes('unknown');
    await bootTypeCheck(bootArea, 'KB SERVER',
      bootInfo.knowledge_server || 'UNKNOWN',
      kbServerOk ? 'ok' : 'warn');

    await bootTypeCheck(bootArea, 'ENCRYPTION MODULE', 'ED25519 READY', 'ok');
    await bootTypeCheck(bootArea, 'COMMS ARRAY', 'STANDBY', 'ok');

    await bootTypeLine(bootArea, '');

    const allOk = aiOk && kbOk;
    if (allOk) {
      await bootTypeLine(bootArea, 'ALL SYSTEMS OPERATIONAL.');
    } else {
      bootAppendSpan(bootArea, 'SYSTEM DEGRADED \u2014 CHECK WARNINGS ABOVE.\n', 'boot-warn');
    }
    await bootTypeLine(bootArea, 'Stay sharp, operator.');
  } else {
    bootAppendSpan(bootArea, 'BOOT FAILED \u2014 Cannot reach server.\n', 'boot-fail');
  }

  bootFinished = true;

  await new Promise(r => setTimeout(r, 800));
  document.getElementById('splash').style.display = 'none';
  document.getElementById('dashboard').style.display = '';
  populateDashboard(bootInfo);
}

function populateDashboard(info) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', {weekday:'short', year:'numeric', month:'short', day:'numeric'});
  const timeStr = now.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
  document.getElementById('dash-date').textContent = dateStr.toUpperCase() + ' \u2014 ' + timeStr;

  if (!info) {
    document.getElementById('dash-sys-status').textContent = 'OFFLINE';
    document.getElementById('dash-sys-status').className = 'dash-card-value val-offline';
    return;
  }

  const aiOk = info.models && info.models.length > 0;
  const kbOk = info.zim_files && info.zim_files.length > 0;
  const allOk = aiOk && kbOk;
  const sysEl = document.getElementById('dash-sys-status');
  sysEl.textContent = allOk ? 'OPERATIONAL' : 'DEGRADED';
  sysEl.className = 'dash-card-value ' + (allOk ? 'val-ok' : 'val-warn');

  const aiEl = document.getElementById('dash-ai-status');
  if (aiOk) {
    aiEl.textContent = 'ONLINE';
    aiEl.className = 'dash-card-value val-ok';
    document.getElementById('dash-ai-detail').textContent = info.models.map(m => m.name).join(', ');
  } else {
    aiEl.textContent = 'OFFLINE';
    aiEl.className = 'dash-card-value val-offline';
  }

  const kbEl = document.getElementById('dash-kb-status');
  if (kbOk) {
    kbEl.textContent = info.zim_files.length + ' VOLUMES';
    kbEl.className = 'dash-card-value val-ok';
    document.getElementById('dash-kb-detail').textContent = info.total_kb_size_gb + ' GB loaded';
  } else {
    kbEl.textContent = 'EMPTY';
    kbEl.className = 'dash-card-value val-warn';
  }

  fetch('/comms/summary').then(r => r.json()).then(data => {
    const commsEl = document.getElementById('dash-comms-status');
    commsEl.textContent = data.operators + ' OPERATORS';
    commsEl.className = 'dash-card-value val-ok';
    const detail = document.getElementById('dash-comms-detail');
    detail.textContent = data.unread > 0 ? data.unread + ' UNREAD MESSAGES' : 'NO UNREAD MESSAGES';
  }).catch(() => {
    document.getElementById('dash-comms-status').textContent = 'STANDBY';
  });

  const lastQuery = localStorage.getItem('overseer_last_query_time');
  document.getElementById('dash-last-query').textContent = lastQuery || 'NONE';

  if (info.build_date) {
    const buildDate = new Date(info.build_date);
    const days = Math.floor((now - buildDate) / (1000 * 60 * 60 * 24));
    document.getElementById('dash-day-count').textContent = 'DAY ' + days;
  }
}

function enterTerminal() {
  document.getElementById('splash').style.display = 'none';
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('terminal').style.display = 'flex';

  chat = document.getElementById('chat');
  input = document.getElementById('input');
  sendBtn = document.getElementById('send');
  bindInputEvents();

  restoreChat();

  if (bootInfo) {
    updateStatusBar(bootInfo);
    populateSystemInfo(bootInfo);
  }

  setInterval(pollStatus, 30000);
  input.focus();
}

// === LIVE STATUS BAR ===
async function pollStatus() {
  try {
    const resp = await fetch('/status');
    const data = await resp.json();
    document.getElementById('statusRam').textContent = 'RAM: ' + data.ram_free_gb + 'GB FREE';
    document.getElementById('sysStatus').textContent = 'OPERATIONAL';
  } catch(e) {
    document.getElementById('sysStatus').textContent = 'DEGRADED';
    document.getElementById('sysStatus').style.color = 'var(--red)';
  }
}

function updateStatusBar(info) {
  document.getElementById('sysStatus').textContent = 'OPERATIONAL';
  if (info.models.length > 0) {
    const name = info.models[0].name.split(':')[0].toUpperCase();
    document.getElementById('statusModel').textContent = 'MODEL: ' + name;
  }
  document.getElementById('statusRam').textContent = 'RAM: ' + info.ram_free_gb + 'GB FREE';
  document.getElementById('statusKb').textContent = 'KB: ' + info.total_kb_size_gb + 'GB';
}

// === UTILITIES ===
function cleanMarkdown(text) {
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/```[a-z]*\n?/g, '');
  text = text.replace(/^#{1,4}\s+/gm, '');
  return text;
}

function formatArticleText(text) {
  let html = esc(text);
  html = html.replace(/&lt;&lt;H([1-4])&gt;&gt;(.*?)&lt;&lt;\/\1&gt;&gt;/g,
    function(match, level, title) {
      return '<span class="ah ah-' + level + '">' + title + '</span>';
    });
  return html;
}

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(ts) {
  const d = new Date(ts * 1000);
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
