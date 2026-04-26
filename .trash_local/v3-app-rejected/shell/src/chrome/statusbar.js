/**
 * Status strip — top of every screen. Renders 8 segments per design spec §5.1.
 *
 * Order: BRAND · OP · SYS · AI · KB · POWER · MESH · CLOCK
 * Hide priority on narrow viewports: KB → AI → SYS → MESH → POWER → BRAND/OP/CLOCK.
 *
 * Subscribes to store.status; rerenders on change.
 */

const SEG_HIDE_SM = new Set(['sys', 'ai', 'kb']);

function fmtRuntime(seconds) {
  if (!seconds || seconds < 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}h`;
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, '0')}m`;
  return `${mins}m`;
}

function fmtClock(s) {
  const day = s.day_counter ?? 0;
  let hhmm = '00:00';
  if (s.wall_time_iso) {
    const d = new Date(s.wall_time_iso);
    if (!isNaN(d.getTime())) {
      hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }
  return `D+${day} · ${hhmm}`;
}

function fmtMesh(m) {
  const reach = m?.reachable ?? 0;
  const known = m?.known ?? 0;
  const dots = '●'.repeat(reach) + '○'.repeat(Math.max(0, known - reach));
  return dots || '—';
}

function powerSeg(power) {
  const pct = power?.battery_pct ?? 0;
  let cls = '';
  if (pct < 15) cls = 'alert';
  else if (pct < 30) cls = 'warn';
  return { cls, value: `${pct}%` };
}

/**
 * @param {HTMLElement} root
 * @param {{subscribe: Function, get: Function}} store
 */
export function mountStatusbar(root, store) {
  root.classList.add('statusbar');

  const segs = [
    { id: 'brand', cls: 'brand', label: 'OVERSEER',  // brand is amber
      render: (s) => ({ k: s.version, v: s.brand }) },
    { id: 'op',                    label: 'OP',
      render: (s) => ({ k: 'OP', v: s.operator }) },
    { id: 'sys',                   label: 'SYS',
      render: (s) => ({ k: 'SYS', v: s.system, alert: s.system === 'FAULT' }) },
    { id: 'ai',                    label: 'AI',
      render: (s) => ({ k: 'AI', v: s.ai?.ready ? s.ai.model : (s.ai?.model || '—') }) },
    { id: 'kb',                    label: 'KB',
      render: (s) => ({ k: 'KB', v: `${s.kb?.mounted ?? 0}/${s.kb?.total ?? 0}` }) },
    { id: 'power',                 label: 'PWR',
      render: (s) => ({ k: 'PWR', ...powerSeg(s.power) }) },
    { id: 'mesh',                  label: 'MESH',
      render: (s) => ({ k: 'MESH', v: fmtMesh(s.mesh) }) },
    { id: 'clock', cls: 'flex',    label: 'CLOCK',
      render: (s) => ({ v: fmtClock(s) }) },
  ];

  const els = segs.map((seg) => {
    const el = document.createElement('div');
    el.className = `seg ${seg.cls || ''} ${SEG_HIDE_SM.has(seg.id) ? 'hide-sm' : ''}`.trim();
    el.dataset.seg = seg.id;
    root.appendChild(el);
    return el;
  });

  function paint(status) {
    segs.forEach((seg, i) => {
      const data = seg.render(status);
      const el = els[i];
      el.classList.toggle('alert', !!data.alert);
      el.classList.toggle('warn', data.cls === 'warn');
      const parts = [];
      if (data.k) parts.push(`<span class="k">${data.k}</span>`);
      if (data.v !== undefined && data.v !== null) parts.push(`<span class="v">${data.v}</span>`);
      el.innerHTML = parts.join('');
      // Keep clock segment using .clock style:
      if (seg.id === 'clock') el.querySelector('.v')?.classList.add('clock');
    });
  }

  return store.subscribe((s) => s.status, paint);
}
