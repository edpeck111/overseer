// Outbound action queue — IDB-backed since Sprint 4.
//
// When transport.health() === "offline", any dispatched mutating
// network operation is persisted here until the transport returns.
// On return, drain() replays the requests FIFO via the transport.
//
// Action shape that survives persistence:
//   {
//     optimistic?: <patch>,       // applied to store immediately by dispatcher
//     request:    { method, path, body?, options? },   // what to replay
//     queuedAt:   number,         // Date.now() at enqueue
//   }
//
// reconcile / rollback functions are NOT persisted (closures can't be
// serialised). Modules that need post-replay reconciliation should
// listen for normal data refreshes after the queue drains.

import * as outbox from "./idb_outbox.js";

const DEFAULT_PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days (Ted's directive)

export class ActionQueue {
  constructor({ store, pruneAgeMs = DEFAULT_PRUNE_AGE_MS } = {}) {
    this.store = store;
    this.pruneAgeMs = pruneAgeMs;
    this._publishCount();
    // Best-effort startup prune of stale entries.
    this.prune().catch(() => {});
  }

  async enqueue({ optimistic, request }) {
    if (!request || !request.method || !request.path) {
      throw new Error("ActionQueue.enqueue: action.request {method, path} required");
    }
    const queuedAt = Date.now();
    await outbox.append({ optimistic: optimistic || null, request, queuedAt });
    await this._publishCount();
  }

  /** Replay queued requests via the transport, FIFO. Stops on first
   *  failure leaving the head intact for the next drain attempt. */
  async drain(transport) {
    const all = await outbox.readAll();
    for (const entry of all) {
      try {
        await transport.request(
          entry.request.method,
          entry.request.path,
          entry.request.body,
          entry.request.options,
        );
        await outbox.remove(entry.key);
      } catch {
        await this._publishCount();
        return false;
      }
    }
    await this._publishCount();
    return true;
  }

  async size()  { return outbox.count(); }
  async clear() { await outbox.clearForTests(); await this._publishCount(); }

  /** Prune entries older than pruneAgeMs (default 7 d). */
  async prune() {
    const cutoff = Date.now() - this.pruneAgeMs;
    const n = await outbox.pruneOlderThan(cutoff);
    await this._publishCount();
    return n;
  }

  async _publishCount() {
    if (this.store) {
      const n = await outbox.count();
      this.store.set({ outboxCount: n });
    }
  }
}
