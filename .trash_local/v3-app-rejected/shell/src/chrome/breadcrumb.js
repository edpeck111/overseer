/**
 * Breadcrumb. Subscribes to `route.breadcrumb` (string[]) and `route.pill` (string|null).
 */

/** @param {HTMLElement} root */
export function mountBreadcrumb(root, store) {
  root.classList.add('breadcrumb');

  function paint(route) {
    const crumbs = route.breadcrumb || ['HOME'];
    const html = crumbs.map((c, i) => {
      const last = i === crumbs.length - 1;
      const arrow = i === 0 ? '' : '<span class="arrow">›</span>';
      return `${arrow}<span class="crumb${last ? ' active' : ''}">${c}</span>`;
    }).join('');
    const pill = route.pill ? `<span class="pill">${route.pill}</span>` : '';
    root.innerHTML = html + pill;
  }

  return store.subscribe((s) => s.route, paint);
}
