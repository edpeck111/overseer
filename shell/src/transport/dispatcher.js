// Optimistic dispatcher. Wraps store.dispatch + ActionQueue + transport.
//
// Action shape (Sprint 4):
//   {
//     optimistic?: <patch>,
//     request:    { method, path, body?, options? },
//     reconcile?: (result) => <patch>,    // best-effort, in-process only
//     rollback?:  <patch>,
//   }
//
// The action is "persistable" because the request is data, not a fn.
// reconcile/rollback close over module state and live in process —
// they fire when this dispatch resolves, but if the action was queued
// to IDB and a page reload happened, only the request gets replayed.
// Modules that care about post-replay reconciliation listen for the
// normal data refresh that follows.

export function makeDispatcher({ store, transport, queue }) {
  // Drain hook — called when transport health flips back to up.
  transport.onHealthRecovered?.(async () => {
    try { await queue.drain(transport); }
    catch (e) { console.warn("[dispatch] drain failed:", e); }
  });

  return async function dispatch(action) {
    if (action.optimistic) store.set(action.optimistic);

    if (transport.health() === "offline") {
      await queue.enqueue({
        optimistic: action.optimistic,
        request:    action.request,
      });
      return;
    }

    try {
      const result = await transport.request(
        action.request.method,
        action.request.path,
        action.request.body,
        action.request.options,
      );
      if (action.reconcile) store.set(action.reconcile(result));
      return result;
    } catch (err) {
      if (action.rollback) store.set(action.rollback);
      throw err;
    }
  };
}
