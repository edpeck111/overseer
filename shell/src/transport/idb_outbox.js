// Hand-rolled IndexedDB wrapper for the action outbox.
//
// Schema:
//   db:    overseer
//   store: outbox  (autoIncrement key)
//   value: { request, optimistic?, queuedAt: number }
//   index: queuedAt (for 7-day prune)
//
// Per Ted's Sprint-4 directive: minimal deps, no idb-keyval. ~80 LOC of
// raw IDB API, scoped to exactly the operations the queue needs.
//
// Falls back to a Map-backed in-memory store when indexedDB is absent
// (jsdom smoke, certain SSR contexts). Same async contract.

const DB_NAME    = "overseer";
const STORE_NAME = "outbox";
const VERSION    = 1;

let _dbPromise = null;

function _hasIDB() {
  return typeof indexedDB !== "undefined";
}

function _openDB() {
  if (_dbPromise) return _dbPromise;
  if (!_hasIDB()) return null;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key", autoIncrement: true });
        store.createIndex("queuedAt", "queuedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return _dbPromise;
}

// --- Memory fallback (used when indexedDB is unavailable) ----------
const _mem = new Map();
let _memSeq = 0;

async function _txn(mode) {
  const db = await _openDB();
  if (!db) return null;
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

/** Append an entry. @returns the assigned key. */
export async function append(entry) {
  const store = await _txn("readwrite");
  if (!store) {
    const key = ++_memSeq;
    _mem.set(key, { ...entry, key });
    return key;
  }
  return new Promise((resolve, reject) => {
    const req = store.add(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Read all entries in key-ascending order (FIFO). */
export async function readAll() {
  const store = await _txn("readonly");
  if (!store) return [..._mem.values()].sort((a, b) => a.key - b.key);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Delete one entry by key. */
export async function remove(key) {
  const store = await _txn("readwrite");
  if (!store) { _mem.delete(key); return; }
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/** Count outstanding entries. */
export async function count() {
  const store = await _txn("readonly");
  if (!store) return _mem.size;
  return new Promise((resolve, reject) => {
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Drop everything older than ``olderThanMs`` (queuedAt < cutoff).
 *  @returns number of entries pruned. */
export async function pruneOlderThan(cutoffMs) {
  const store = await _txn("readwrite");
  if (!store) {
    let n = 0;
    for (const [k, v] of _mem) if (v.queuedAt < cutoffMs) { _mem.delete(k); n++; }
    return n;
  }
  return new Promise((resolve, reject) => {
    let n = 0;
    const idx = store.index("queuedAt");
    const range = IDBKeyRange.upperBound(cutoffMs, true);   // exclusive
    const req = idx.openCursor(range);
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        cur.delete();
        n++;
        cur.continue();
      } else {
        resolve(n);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/** Test-only hard reset. */
export async function clearForTests() {
  const store = await _txn("readwrite");
  if (!store) { _mem.clear(); _memSeq = 0; return; }
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}
