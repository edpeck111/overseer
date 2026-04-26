// Viewport-mode observer — sets data-mode="phone|tablet|desktop" on
// the terminal element based on its rendered width (NOT window width;
// the terminal has its own max-width per mode). Thresholds match
// docs/00-VISUAL-REFERENCE.html: phone <720, tablet 720-1099, desktop ≥1100.
//
// Uses ResizeObserver where available (every browser since 2020); falls
// back to window resize on ancient platforms (P10 graceful degradation).

const PHONE  = 720;
const TABLET = 1100;

export function observeMode(term) {
  const apply = () => {
    const w = term.getBoundingClientRect().width || window.innerWidth;
    const mode = w < PHONE ? "phone" : w < TABLET ? "tablet" : "desktop";
    if (term.getAttribute("data-mode") !== mode) {
      term.setAttribute("data-mode", mode);
    }
  };
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(apply);
    ro.observe(term);
  } else {
    window.addEventListener("resize", apply, { passive: true });
  }
  apply();
}
