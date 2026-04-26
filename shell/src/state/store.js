// Hand-rolled reactive store (~100 LOC target per implementation plan §7).
//
// Sprint 0 stub: minimal get/set without subscribe wiring. Sprint 1
// fills in subscribe/dispatch/optimistic-action support per P8.

/**
 * @template T
 * @param {T} initial
 */
export function createStore(initial) {
  let state = { ...initial };
  return {
    /** @param {keyof T} key */
    get(key) {
      return state[key];
    },
    /** @param {Partial<T>} patch */
    set(patch) {
      state = { ...state, ...patch };
    },
  };
}
