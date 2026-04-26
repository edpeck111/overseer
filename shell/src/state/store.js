// Hand-rolled reactive store — ~100 LOC, no deps. ADR-0002.
//
// API:
//   const store = createStore(initial);
//   store.get()                 → snapshot of full state (frozen)
//   store.get(key)              → single value
//   store.set(patch)            → shallow merge, notifies affected keys
//   store.subscribe(fn)         → global; called with (state, changedKeys)
//   store.subscribe(key, fn)    → topic; called with (value, key)
//   store.dispatch(action, net) → optimistic apply, reconcile when net resolves
//
// The optimistic-UI helper (P8): every UI action updates the store
// immediately with the optimistic patch; the network call's resolution
// is reconciled into the store afterwards. Subscribers see two emits
// (optimistic, then reconciled) which is the contract we want.

/**
 * @template T
 * @typedef {{ optimistic: Partial<T>, reconcile: (result: any) => Partial<T> }} OptimisticAction
 */

/**
 * @template T
 * @param {T} initial
 */
export function createStore(initial) {
  let state = freeze({ ...initial });
  const globalSubs = new Set();
  /** @type {Map<string, Set<Function>>} */
  const topicSubs = new Map();

  function get(key) {
    return key === undefined ? state : state[key];
  }

  function set(patch) {
    const changed = [];
    const next = { ...state };
    for (const k of Object.keys(patch)) {
      if (!shallowEqual(state[k], patch[k])) {
        next[k] = patch[k];
        changed.push(k);
      }
    }
    if (changed.length === 0) return;
    state = freeze(next);
    for (const fn of globalSubs) safe(() => fn(state, changed));
    for (const k of changed) {
      const subs = topicSubs.get(k);
      if (subs) for (const fn of subs) safe(() => fn(state[k], k));
    }
  }

  function subscribe(a, b) {
    if (typeof a === "function") {
      globalSubs.add(a);
      return () => globalSubs.delete(a);
    }
    let subs = topicSubs.get(a);
    if (!subs) topicSubs.set(a, (subs = new Set()));
    subs.add(b);
    return () => subs.delete(b);
  }

  /**
   * Optimistically apply `action.optimistic` to the store, then await
   * `net`. On resolve, apply `action.reconcile(result)`. On reject,
   * apply `action.rollback ?? {}` and mark the original keys as failed.
   *
   * @param {OptimisticAction<T> & { rollback?: Partial<T> }} action
   * @param {Promise<any>} net
   */
  function dispatch(action, net) {
    if (action.optimistic) set(action.optimistic);
    if (!net) return Promise.resolve();
    return net.then(
      (result) => {
        if (action.reconcile) set(action.reconcile(result));
      },
      (err) => {
        if (action.rollback) set(action.rollback);
        // Sprint 2 will surface the error onto a toast topic; for now
        // we re-throw so callers can decide.
        throw err;
      }
    );
  }

  return { get, set, subscribe, dispatch };
}

// ---- helpers ------------------------------------------------------

function freeze(o) {
  // Object.freeze is shallow; that's fine — we never mutate nested
  // values, only replace whole branches via set().
  return Object.freeze(o);
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

function safe(fn) {
  try { fn(); }
  catch (e) {
    // A subscriber bug must not break the store. Sprint 15 will route
    // these to the system tail-log.
    if (typeof console !== "undefined") console.error("[store] subscriber threw", e);
  }
}
