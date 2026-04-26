/**
 * Tiny reactive store. ~80 LOC. Hand-rolled per Implementation Plan §7 ADR.
 *
 * Two surface areas:
 *   - `state` — a frozen snapshot returned by `get()`
 *   - `update(mutator)` — apply a mutator function, broadcast changes
 *
 * Components subscribe with `subscribe(selector, fn)`; the selector is called
 * after every update and `fn` runs only when its return value changes
 * (shallow ref equality). That keeps re-renders cheap.
 */

/** @typedef {Record<string, any>} State */

/** @param {State} initial */
export function createStore(initial = {}) {
  /** @type {State} */
  let state = structuredClone(initial);
  /** @type {Set<{ select: (s:State)=>any, last: any, fn: (v:any)=>void }>} */
  const subs = new Set();

  function get() {
    return state;
  }

  /** @param {(draft: State) => State | void} mutator */
  function update(mutator) {
    const draft = structuredClone(state);
    const next = mutator(draft);
    state = next === undefined ? draft : next;
    for (const s of subs) {
      const v = s.select(state);
      if (!Object.is(v, s.last)) {
        s.last = v;
        try { s.fn(v); } catch (e) { console.error('[store sub]', e); }
      }
    }
  }

  /**
   * @param {(s: State) => any} select
   * @param {(v: any) => void} fn
   */
  function subscribe(select, fn) {
    const entry = { select, fn, last: select(state) };
    subs.add(entry);
    // Fire once with current value so subscribers paint on mount.
    try { fn(entry.last); } catch (e) { console.error('[store sub init]', e); }
    return () => subs.delete(entry);
  }

  return { get, update, subscribe };
}

/**
 * Initial app state shape. Each module gets a top-level slot. Chrome reads
 * `status` (status strip) and `route` (breadcrumb + screen).
 */
export const initialState = {
  route: { module: 'home', sub: null, params: {}, breadcrumb: ['HOME'], pill: null },
  status: {
    brand: 'OVERSEER',
    version: 'v3.0.0-dev',
    operator: 'ALPHA-1',
    system: 'OK',
    ai: { model: 'QWEN-7B', ready: false },
    kb: { mounted: 0, total: 0 },
    power: { battery_pct: 82, draw_w: 4.2, runtime_s: 14 * 24 * 3600 },
    mesh: { reachable: 2, known: 3 },
    day_counter: 0,
    wall_time_iso: new Date().toISOString(),
  },
  // Each module contributes its own slot lazily.
};
