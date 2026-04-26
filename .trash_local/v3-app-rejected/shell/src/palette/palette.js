/**
 * Command palette — the `:` overlay. Fuzzy-matched against the registered
 * command set. Sprint 1: HOME-level commands (jump to each module + a few
 * meta commands). Subsequent sprints register their own.
 */

import { modulesByKey, modulesById } from '../modules/registry.js';
import { navigate } from '../router.js';

/** @type {{ name: string, hint: string, run: () => void }[]} */
const _commands = [];

let _wrap, _input, _list;
let _selIdx = 0;

/** Public: register a command. Modules call this at boot. */
export function registerCommand(cmd) {
  _commands.push(cmd);
}

/** Bootstrap: register `home.<module>` for every module. */
export function registerCoreCommands() {
  for (const [id, mod] of modulesById) {
    registerCommand({
      name: `home.${id}`,
      hint: `open ${mod.label.toLowerCase()} · ${mod.key}`,
      run: () => navigate(id),
    });
  }
  registerCommand({
    name: 'home',
    hint: 'go to HOME · Q',
    run: () => navigate('home'),
  });
  registerCommand({
    name: 'crt.toggle',
    hint: 'scanlines on/off',
    run: () => {
      const html = document.documentElement;
      html.dataset.crt = html.dataset.crt === 'off' ? 'on' : 'off';
    },
  });
}

/** @param {HTMLElement} root */
export function mountPalette(root) {
  root.classList.add('palette-wrap');
  root.innerHTML = `
    <div class="palette" role="dialog" aria-label="command palette">
      <div class="palette-input">
        <span class="sigil">:</span>
        <span class="field" contenteditable="plaintext-only" spellcheck="false"></span>
        <span class="hint">[ESC close · ↑↓ nav · ↵ run]</span>
      </div>
      <div class="palette-list"></div>
    </div>
  `;
  _wrap  = root;
  _input = root.querySelector('.field');
  _list  = root.querySelector('.palette-list');

  // Click on overlay (not the inner panel) closes.
  _wrap.addEventListener('click', (e) => {
    if (e.target === _wrap) closePalette();
  });

  _input.addEventListener('input', () => {
    _selIdx = 0;
    refresh();
  });
  _input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
    if (e.key === 'Enter')  { e.preventDefault(); runSelected(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); moveSel(-1); return; }
  });
}

export function isPaletteOpen() {
  return _wrap?.classList.contains('show');
}

/** @param {any} _store reserved for future store-aware filtering */
export function openPalette(_store) {
  if (!_wrap) return;
  _wrap.classList.add('show');
  _input.textContent = '';
  _selIdx = 0;
  refresh();
  // Focus after layout — contenteditable focus can be flaky if synchronous.
  requestAnimationFrame(() => _input.focus());
}

export function closePalette() {
  if (!_wrap) return;
  _wrap.classList.remove('show');
  _input.textContent = '';
}

function moveSel(delta) {
  const rows = _list.querySelectorAll('.palette-row');
  if (!rows.length) return;
  rows[_selIdx]?.classList.remove('sel');
  _selIdx = (_selIdx + delta + rows.length) % rows.length;
  rows[_selIdx]?.classList.add('sel');
  rows[_selIdx]?.scrollIntoView({ block: 'nearest' });
}

function runSelected() {
  const rows = _list.querySelectorAll('.palette-row[data-cmd]');
  const row = rows[_selIdx];
  if (!row) return;
  const cmd = _commands.find(c => c.name === row.dataset.cmd);
  if (cmd) {
    closePalette();
    try { cmd.run(); } catch (e) { console.error('[palette run]', e); }
  }
}

function refresh() {
  const q = (_input.textContent || '').trim().toLowerCase();
  const matches = q ? fuzzyMatch(_commands, q) : _commands.slice(0, 12);
  if (matches.length === 0) {
    _list.innerHTML = `<div class="palette-row"><span class="empty">no matches</span><span></span></div>`;
    return;
  }
  _list.innerHTML = matches.map((m, i) => `
    <div class="palette-row${i === _selIdx ? ' sel' : ''}" data-cmd="${m.name}">
      <span class="name">${highlight(m.name, q)}</span>
      <span class="hint">${m.hint}</span>
    </div>
  `).join('');
  _list.querySelectorAll('.palette-row[data-cmd]').forEach((row, i) => {
    row.addEventListener('mouseenter', () => {
      _list.querySelectorAll('.palette-row.sel').forEach(r => r.classList.remove('sel'));
      row.classList.add('sel');
      _selIdx = i;
    });
    row.addEventListener('click', () => { _selIdx = i; runSelected(); });
  });
}

/**
 * Tiny fuzzy: return commands where every char of `q` appears in name in order.
 * Score = lower index of first match + length penalty. Stable enough for v1.
 */
function fuzzyMatch(commands, q) {
  const out = [];
  for (const c of commands) {
    const name = c.name.toLowerCase();
    let i = 0;
    let firstHit = -1;
    for (let j = 0; j < name.length && i < q.length; j++) {
      if (name[j] === q[i]) {
        if (firstHit < 0) firstHit = j;
        i++;
      }
    }
    if (i === q.length) {
      out.push({ ...c, _score: firstHit + name.length * 0.01 });
    }
  }
  out.sort((a, b) => a._score - b._score);
  return out.slice(0, 30);
}

function highlight(name, q) {
  if (!q) return name;
  // Bold the first contiguous occurrence of q's chars in order.
  const lower = name.toLowerCase();
  let i = 0;
  let out = '';
  for (let j = 0; j < name.length; j++) {
    if (i < q.length && lower[j] === q[i]) {
      out += `<b>${name[j]}</b>`;
      i++;
    } else {
      out += name[j];
    }
  }
  return out;
}
