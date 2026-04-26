/**
 * Letter-key router. The shell's input model is keystroke-first per P1.
 *
 *   - On HOME: a primary letter (K/C/M/N/P/L) navigates into that module.
 *   - On any module: that module's own keystrokes are handled internally;
 *     the universal keys (`:`, `/`, `?`, `Q`) are handled here.
 *
 * Modules call `dispatchKey('X')` to simulate a key press (used by hotkey-bar
 * clicks). The router is the single source of truth for key handling.
 */

import { modulesByKey, mountFor } from './modules/registry.js';
import { openPalette, isPaletteOpen, closePalette } from './palette/palette.js';

let _store = null;
let _content = null;
let _currentUnmount = null;

/** @param {{store: any, content: HTMLElement}} ctx */
export function initRouter(ctx) {
  _store = ctx.store;
  _content = ctx.content;

  document.addEventListener('keydown', onKeyDown);

  // Initial route → HOME.
  navigate('home');
}

/** Programmatic navigation. */
export function navigate(moduleId) {
  if (!_store || !_content) return;
  const mountFn = mountFor(moduleId);
  if (_currentUnmount) {
    try { _currentUnmount(); } catch (e) { console.error('[router unmount]', e); }
    _currentUnmount = null;
  }
  _content.innerHTML = '';
  _currentUnmount = mountFn(_content, _store);
}

/** Simulate a keystroke from a click on a hotkey pill. */
export function dispatchKey(key) {
  return handleKey(key, /*synthetic=*/ true);
}

function onKeyDown(e) {
  // Ignore key events when typing into a real input/textarea/contenteditable.
  if (isTyping(e.target)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // Palette catches Escape itself; everything else routes here.
  const handled = handleKey(e.key);
  if (handled) e.preventDefault();
}

function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

function handleKey(key, synthetic = false) {
  // Universal keys
  if (key === ':') {
    openPalette(_store);
    return true;
  }
  if (key === 'Escape') {
    if (isPaletteOpen()) { closePalette(); return true; }
    return false;
  }
  if (key === 'q' || key === 'Q') {
    if (_store?.get().route.module !== 'home') {
      navigate('home');
      return true;
    }
    return false;
  }

  // Module letter keys — only when we're on HOME.
  const upper = key.toUpperCase();
  const route = _store?.get().route;
  if (route?.module === 'home') {
    const mod = modulesByKey.get(upper);
    if (mod) {
      navigate(mod.id);
      return true;
    }
  }
  return false;
}
