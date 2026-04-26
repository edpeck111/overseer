/**
 * Stub module — the rest of the modules render this until their real sprint lands.
 * Keeps the chrome consistent and gives a useful "where will I be when this is built?" message.
 */

const SPRINT_BY_MODULE = {
  power:      'Sprint 3',
  knowledge:  'Sprint 5',
  comms:      'Sprint 6',
  medical:    'Sprint 7',
  navigation: 'Sprint 8',
  log:        'Sprint 9',
  inventory:  'Sprint 10',
  timeline:   'Sprint 11',
  signal:     'Sprint 12',
  recreation: 'Sprint 13',
  system:     'Sprint 15',
  help:       'Sprint 15',
  auspice:    'Sprint A (post-Sprint 15)',
};

/**
 * @param {HTMLElement} root
 * @param {any} store
 * @param {{ id: string, label: string }} mod
 */
export function stubModule(root, store, mod) {
  root.innerHTML = '';
  root.classList.add('module-stub');
  root.dataset.module = mod.id;

  const el = document.createElement('div');
  el.className = 'module-stub';
  el.innerHTML = `
    <div class="stub-title">${mod.label}</div>
    <div class="stub-body">
      <p>This module is scheduled for <code>${SPRINT_BY_MODULE[mod.id] || 'a later sprint'}</code>.</p>
      <p>Press <code>Q</code> to return HOME, or <code>:</code> to open the command palette.</p>
    </div>
    <div class="stub-meta">
      module = <code>${mod.id}</code> · sprint roadmap in <code>v3/Notes/04-IMPLEMENTATION-PLAN.md</code>
    </div>
  `;
  root.appendChild(el);

  // Module-specific hotkeys + breadcrumb
  store.update((draft) => {
    draft.route.module     = mod.id;
    draft.route.breadcrumb = ['HOME', mod.label];
    draft.route.pill       = null;
    draft.route.hotkeys    = [
      { key: ':', label: 'palette', cls: 'special' },
      { key: '/', label: 'find',    cls: 'special' },
      { key: '?', label: 'help' },
      { key: 'Q', label: 'back',    cls: 'danger' },
    ];
  });

  return () => {
    root.classList.remove('module-stub');
    delete root.dataset.module;
  };
}
