/**
 * Shell entry point.
 *
 * Boot sequence:
 *   1. Build state store with initial state
 *   2. Mount chrome (status strip, breadcrumb, hotkey bar)
 *   3. Register palette + bootstrap core commands
 *   4. Initialize router → defaults to HOME
 *   5. Fire one-shot status fetch from /api/x/status to populate the strip
 *   6. (Future) open WebSocket + start poll loops per cache class
 */

import { createStore, initialState } from './state/store.js';
import { mountStatusbar } from './chrome/statusbar.js';
import { mountBreadcrumb } from './chrome/breadcrumb.js';
import { mountHotkeybar } from './chrome/hotkeybar.js';
import { mountPalette, registerCoreCommands } from './palette/palette.js';
import { initRouter } from './router.js';
import { transport } from './transport/index.js';

const store = createStore(initialState);

const term       = document.getElementById('term');
const statusbar  = document.getElementById('statusbar');
const breadcrumb = document.getElementById('breadcrumb');
const content    = document.getElementById('content');
const hotkeybar  = document.getElementById('hotkeybar');
const palette    = document.getElementById('palette');

if (!term || !statusbar || !breadcrumb || !content || !hotkeybar || !palette) {
  console.error('[overseer] DOM scaffolding missing — chrome cannot mount');
} else {
  mountStatusbar(statusbar, store);
  mountBreadcrumb(breadcrumb, store);
  mountHotkeybar(hotkeybar, store);
  mountPalette(palette);
  registerCoreCommands();
  initRouter({ store, content });

  // Adaptive viewport class (01-DESIGN-SPEC §3).
  const setMode = () => {
    const w = window.innerWidth;
    const mode = w < 900 ? 'phone' : w < 1200 ? 'tablet' : 'desktop';
    term.dataset.mode = mode;
  };
  setMode();
  window.addEventListener('resize', setMode);

  // One-shot status fetch.
  refreshStatus();
  // Heartbeat — every 30s while the tab is foreground. Sprint 2 replaces this
  // with WS push for HOT-class endpoints.
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshStatus();
  }, 30_000);
}

async function refreshStatus() {
  try {
    const data = await transport.http.get('/api/x/status');
    store.update((draft) => {
      Object.assign(draft.status, data);
      draft.status.wall_time_iso = data.wall_time_iso || new Date().toISOString();
    });
  } catch (e) {
    // Backend not up yet (e.g. running shell-only) — keep the placeholder values.
    console.warn('[overseer] status fetch failed:', e?.message || e);
  }
}
