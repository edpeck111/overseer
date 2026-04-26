// Optimistic dispatcher. Wraps store.dispatch + ActionQueue + transport
// so module code calls a single ergonomic dispatch(action) without
// caring about offline/online state.
//
// Contract:
//   dispatch({ optimistic, run, reconcile, rollback }) -> Promise<void>
//
//   - `optimistic` is applied to the store immediately (P8)
//   - if transport.health() === "offline", `run` is queued for drain
//   - otherwise `run` executes; its resolve value is fed to reconcile
//   - on reject, rollback is applied (and the action stays out of queue)

export function makeDispatcher({ store, transport, queue }) {
  // Drain hook — called when transport health flips back to up.
  transport.onHealthRecovered?.(() => queue.drain());

  return async function dispatch(action) {
    if (action.optimistic) store.set(action.optimistic);

    const exec = async () => {
      try {
        const result = await action.run();
        if (action.reconcile) store.set(action.reconcile(result));
        return result;
      } catch (err) {
        if (action.rollback) store.set(action.rollback);
        throw err;
      }
    };

    if (transport.health() === "offline") {
      queue.enqueue({ action, run: exec });
      return;
    }
    return exec();
  };
}
