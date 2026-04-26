/**
 * HOME — the dispatcher screen. Logo + flavor + side stack + 12-module menu.
 *
 * Mirrors 00-VISUAL-REFERENCE.html closely, but composed from the runtime
 * module registry rather than hand-coded HTML.
 */

import { moduleList } from './registry.js';
import { dispatchKey } from '../router.js';

const LOGO = [
  '╔═╗ ╦  ╦ ╔═╗ ╦═╗ ╔═╗ ╔═╗ ╔═╗ ╔═╗',
  '║ ║ ╚╗╔╝ ║╣  ╠╦╝ ╚═╗ ║╣  ║╣  ╠╦╝',
  '╚═╝  ╚╝  ╚═╝ ╩╚═ ╚═╝ ╚═╝ ╚═╝ ╩╚═',
].map(l => `<span class="accent">${l}</span>`).join('\n');

const TAGLINE = 'offline vault · essential records · survival, emergency &amp; endurance response';

// Placeholder side-stack content. Sprint 6 (COMMS) wires real unread; Sprint 3
// (POWER) wires real spark.
const PLACEHOLDER_UNREAD = [
  { from: 'BRAVO-2',   subj: 'Re: rendezvous shift — copy that',         when: '14m' },
  { from: 'CHARLIE-7', subj: 'Cache-7 inventory update',                  when: '02h' },
  { from: 'ECHO-3',    subj: '[BOARD/INTEL] vehicle traffic NW road',     when: '06h' },
];

const PLACEHOLDER_QUOTE = {
  body: '"If you do not change direction, you may end up where you are heading."',
  who: '— LAO TZU · posted by DELTA-4',
};

const PLACEHOLDER_SPARK_HTML = `
  <span class="lo">▁▁▂▂▂▃▃</span><span>▄▄▅▅▅▅▆</span><span class="hi">▆▇█▇▆▅▄</span><span>▄▃▃▃▂▂▂</span>
`;

function flavorRows(status) {
  const rows = [
    { k: 'UPTIME',     v: '17d 04h 22m', cls: '' },
    { k: 'BATTERY',    v: `${status.power?.battery_pct ?? '—'}% · 14d 02h`, cls: 'warn' },
    { k: 'ARCHIVE',    v: `READY · ${status.kb?.total ?? 0} vols`, cls: '' },
    { k: 'MESH',       v: `${status.mesh?.reachable ?? 0} nodes seen`, cls: 'cool' },
    { k: 'LAST QUERY', v: '02:14 ago', cls: '' },
    { k: 'WEATHER',    v: 'overcast · 11°C', cls: '' },
  ];
  return rows.map(r =>
    `<div class="row"><span class="k">${r.k}</span><span class="v ${r.cls}">${r.v}</span></div>`
  ).join('');
}

function menuHtml(items, activeKey) {
  return items.map(m => {
    const active = m.key.toUpperCase() === activeKey ? ' active' : '';
    const pip = m.pip ? `<span class="pip ${m.pip.cls || ''}">${m.pip.text}</span>` : '';
    return `
      <button class="menu-item${active}" data-key="${m.key.toUpperCase()}" type="button">
        <span class="key">${m.key}</span>
        <span class="label">${m.label}</span>
        <span class="desc">${m.desc}</span>
        ${pip}
      </button>
    `;
  }).join('');
}

/**
 * @param {HTMLElement} root
 * @param {any} store
 */
export function mountHome(root, store) {
  root.innerHTML = '';
  root.classList.add('home');
  root.dataset.module = 'home';

  // Initial render — re-runs only when status changes (because we'd want
  // updated battery / KB count etc).
  const unsubStatus = store.subscribe((s) => s.status, paint);

  function paint(status) {
    root.innerHTML = `
      <div class="home-top">
        <div>
          <div class="logo">${LOGO}</div>
          <div class="tagline">${TAGLINE}</div>
          <div class="flavor">${flavorRows(status)}</div>
        </div>

        <div class="side-stack hide-on-phone">
          <div class="panel">
            <div class="panel-title">UNREAD MAIL <span class="badge">${PLACEHOLDER_UNREAD.length}</span></div>
            <div class="unread-list">
              ${PLACEHOLDER_UNREAD.map(m => `
                <div class="msg">
                  <span class="from">${m.from}</span>
                  <span class="subj">${m.subj}</span>
                  <span class="when">${m.when}</span>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="panel">
            <div class="panel-title">ONE-LINER OF THE DAY</div>
            <div class="oneliner">
              ${PLACEHOLDER_QUOTE.body}
              <span class="who">${PLACEHOLDER_QUOTE.who}</span>
            </div>
          </div>
          <div class="panel">
            <div class="panel-title">POWER · 24H</div>
            <div class="tiny-spark">${PLACEHOLDER_SPARK_HTML}</div>
            <div style="font-size: 0.88em; color: var(--fg-dim); margin-top: 4px;">
              avg ${status.power?.draw_w ?? '—'}W · peak 11.6W · trough 2.1W
            </div>
          </div>
        </div>
      </div>

      <div>
        <div class="menu-section-title">PRIMARY MODULES</div>
        <div class="menu" data-tier="primary">${menuHtml(moduleList.primary, 'K')}</div>

        <div class="menu-section-title">SECONDARY MODULES</div>
        <div class="menu" data-tier="secondary">${menuHtml(moduleList.secondary, '')}</div>
      </div>

      <div class="prompt">
        <span class="sigil">&gt;_</span>
        <span class="input">_<span class="cursor"></span></span>
        <span class="hint">[ press a letter, or <span class="key">:</span> for palette ]</span>
      </div>
    `;

    // Wire menu clicks → dispatchKey
    root.querySelectorAll('.menu-item[data-key]').forEach(el => {
      el.addEventListener('click', () => dispatchKey(el.dataset.key));
    });
  }

  // HOME's hotkey bar = the primary module letters + the universal keys.
  store.update((draft) => {
    draft.route.module     = 'home';
    draft.route.breadcrumb = ['HOME'];
    draft.route.pill       = null;
    draft.route.hotkeys    = [
      ...moduleList.primary.map(m => ({ key: m.key, label: m.label.toLowerCase().split(' ')[0] })),
      { key: ':', label: 'palette', cls: 'special' },
      { key: '/', label: 'search',  cls: 'special' },
      { key: '?', label: 'help' },
      { key: 'Q', label: 'back',    cls: 'danger' },
    ];
  });

  return () => {
    unsubStatus();
    root.classList.remove('home');
    delete root.dataset.module;
  };
}
