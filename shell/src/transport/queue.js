// Outbound action queue. When transport.health() === "offline", any
// dispatched network operation is held here until the transport
// returns; on return, drain() runs them FIFO.
//
// Sprint 2: in-memory only. Sprint 4 (static-shell discipline) adds
// IndexedDB persistence so the queue survives page reloads + offline
// shutdowns. Until then, page reloads = queue lost (acceptable for
// Sprint 2 demo purposes).
//
// Design choice: queue stores zero-arg thunks, not request descriptors.
// The dispatcher closes over op + payload + reconcile, so the queue
// stays transport-agnostic.

export class ActionQueue {
  constructor({ store } = {}) {
    /** @type {Array<{ action: object, run: () => Promise<any> }>} */
    this.items = [];
    this.store = store;
    this._publishCount();
  }

  enqueue(item) {
    this.items.push(item);
    this._publishCount();
  }

  /** Pop items one at a time, awaiting each `execute(item)`. Stops
   *  on first failure (the failing item stays at the head of the queue
   *  for the next drain attempt). */
  async drain() {
    while (this.items.length > 0) {
      const head = this.items[0];
      try {
        await head.run();
      } catch {
        // Leave head in place; the caller decides what to do.
        return false;
      }
      this.items.shift();
      this._publishCount();
    }
    return true;
  }

  size() { return this.items.length; }
  peek() { return this.items[0]; }
  clear() { this.items.length = 0; this._publishCount(); }

  _publishCount() {
    if (this.store) this.store.set({ outboxCount: this.items.length });
  }
}
