/**
 * Hotkey bar — bottom of every screen. The currently active module declares
 * its keys via the registry; this component renders them.
 *
 * The keys are real keys: clicking them dispatches the same key event as
 * pressing them on a keyboard. This honours design principle P1.
 */

import { dispatchKey } from '../router.js';

/**
 * @param {HTMLElement} root
 * @param {ReturnType<typeof import('../state/store.js').createStore>} store
 */
export function mountHotkeybar(root, store) {
  root.classList.add('hotkeybar');

  function paint(state) {
    const keys = state.route?.hotkeys || [];
    root.innerHTML = '';
    for (const k of keys) {
      const el = document.createElement('span');
      el.className = `key ${k.cls || ''}`.trim();
      el.innerHTML = `<span class="k">${k.key}</span><span class="l">${k.label}</span>`;
      el.addEventListener('click', () => dispatchKey(k.key));
      root.appendChild(el);
    }
  }

  return store.subscribe((s) => s.route, paint);
}
