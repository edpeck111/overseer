// HttpTransport — WiFi adapter against the OPi5 (or any local Flask).
// Implements the Transport contract documented in transport.js.
//
// Cache layer: per-request `cacheClass` selects TTL from CACHE_CLASS
// (ADR-0008). Stale-while-revalidate: cached entries return immediately
// with `as-of <age>` metadata; a background refetch fires when age >=
// ttl. EXPENSIVE/HOT bypass the cache.
//
// WebSocket subscriptions ride on /ws (server/ws.py — flask-sock hub).
// Subscription messages are JSON; the OMP-binary push channel is
// reserved for OmpTransport.

import { CACHE_CLASS, ttlFor } from "./cache_classes.js";

const KIND = "wifi";

export class HttpTransport {
  constructor({ store, baseUrl = "" } = {}) {
    this.store    = store;
    this.baseUrl  = baseUrl;
    this.cache    = new Map();           // path -> { value, at }
    this.healthState = "wifi";
    /** @type {WebSocket | null} */
    this.ws = null;
    /** @type {Map<string, Set<Function>>} */
    this.subs = new Map();
    this._wsBuffer = [];
    this._healthRecoveredCbs = [];
    this._connectWs();
  }

  kind()   { return KIND; }
  health() { return this.healthState; }
  /** Register a fn called when health flips from "offline" to up. */
  onHealthRecovered(fn) { this._healthRecoveredCbs.push(fn); return () => {
    const i = this._healthRecoveredCbs.indexOf(fn);
    if (i >= 0) this._healthRecoveredCbs.splice(i, 1);
  }; }

  /** request(method, path, body?, { cacheClass = "WARM", signal? }) */
  async request(method, path, body, opts = {}) {
    const cls = opts.cacheClass || "WARM";
    const ttl = ttlFor(cls, KIND);
    const cacheable = method === "GET" && ttl > 0;

    if (cacheable) {
      const hit = this.cache.get(path);
      if (hit) {
        const age = Date.now() - hit.at;
        if (age < ttl) return { ...hit.value, _cache: { age, fresh: true } };
        // SWR: serve stale + fire revalidate
        this._refetch(method, path, body, cls).catch(() => {});
        return { ...hit.value, _cache: { age, fresh: false } };
      }
    }

    const value = await this._fetch(method, path, body, opts);
    if (cacheable) this.cache.set(path, { value, at: Date.now() });
    return value;
  }

  /** subscribe(channel, onMessage) → unsubscribe fn */
  subscribe(channel, onMessage) {
    let subs = this.subs.get(channel);
    if (!subs) {
      this.subs.set(channel, (subs = new Set()));
      this._send({ op: "subscribe", topics: [channel] });
    }
    subs.add(onMessage);
    return () => {
      subs.delete(onMessage);
      if (subs.size === 0) {
        this.subs.delete(channel);
        this._send({ op: "unsubscribe", topics: [channel] });
      }
    };
  }

  // ---- internals --------------------------------------------------

  async _fetch(method, path, body, opts) {
    const init = { method, headers: { "Accept": "application/json" }, signal: opts.signal };
    if (body !== undefined && method !== "GET") {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const url = this.baseUrl + path;
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
    return res.json();
  }

  async _refetch(method, path, body, cls) {
    const value = await this._fetch(method, path, body, {});
    this.cache.set(path, { value, at: Date.now() });
    // Publish so any subscribed view rerenders
    for (const fn of this.subs.get("cache:" + path) || []) fn(value);
  }

  _connectWs() {
    if (typeof WebSocket === "undefined") return;  // node-side smoke
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws`;
    let ws;
    try { ws = new WebSocket(url); } catch { this._setHealth("offline"); return; }
    this.ws = ws;
    ws.addEventListener("open",  () => {
      this._setHealth("wifi");
      // Replay pending sends
      for (const m of this._wsBuffer.splice(0)) ws.send(JSON.stringify(m));
      // Resubscribe (in case of reconnect)
      const topics = [...this.subs.keys()];
      if (topics.length) ws.send(JSON.stringify({ op: "subscribe", topics }));
    });
    ws.addEventListener("close", () => { this._setHealth("offline"); setTimeout(() => this._connectWs(), 2_000); });
    ws.addEventListener("error", () => { this._setHealth("degraded"); });
    ws.addEventListener("message", (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.op === "push") {
          for (const fn of this.subs.get(msg.topic) || []) fn(msg.data);
        }
      } catch (err) { /* swallow malformed push */ }
    });
  }

  _send(payload) {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(payload));
    } else {
      this._wsBuffer.push(payload);
    }
  }

  _setHealth(s) {
    const prev = this.healthState;
    if (prev === s) return;
    this.healthState = s;
    if (this.store) {
      const isUp = s === "wifi";
      this.store.set({ mesh: { reachable: isUp ? this.store.get("mesh")?.known ?? 1 : 0,
                                known:     this.store.get("mesh")?.known ?? 1 } });
    }
    if (prev === "offline" && (s === "wifi" || s === "mesh")) {
      for (const fn of this._healthRecoveredCbs) {
        try { fn(); } catch { /* ignore */ }
      }
    }
  }
}

export { CACHE_CLASS };
