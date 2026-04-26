// OmpTransport — mesh adapter. Same Transport contract as HttpTransport
// (transport.js) but encodes every request/response as an OMP packet
// per docs/05-OMP-PROTOCOL.md.
//
// Sprint 2: the bridgeUrl defaults to "/omp" (same origin) so the
// shell can talk to the OPi5's OMP endpoint directly. tools/sim-mesh.py
// stands up a proxy that injects latency/loss between this transport
// and the real /omp; configure with bridgeUrl when running tests.
//
// PING heartbeat: every 5 s on WiFi-equivalent latency, every 30 s on
// real LoRa (ADR-0008 HOT class on mesh). Drives store.mesh so the
// status strip's MESH:●●○ pip reflects actual reachability.
//
// Subscribe is poll-based for Sprint 2; Sprint 6 wires real OMP PUSH.

import { encode, decode } from "./omp_codec.js";
import { Op } from "./omp_opcodes.js";
import { CACHE_CLASS, ttlFor, pollFor } from "./cache_classes.js";

const KIND = "mesh";

// Map (method, path) -> opcode for HTTP-style call sites that don't
// know about opcodes yet. Sprint 6+ will phase this out as modules
// start calling op-id directly.
const ROUTE_TO_OP = {
  "GET /api/c/inbox":   Op.INBOX_HEADERS,
  "GET /api/c/net":     Op.NET_NODES,
  "GET /api/p/now":     Op.POWER_NOW,
  "GET /api/x/status":  Op.SYS_STATUS,
  "POST /api/ping":     Op.PING,
};

export class OmpTransport {
  constructor({ store, bridgeUrl = "/omp", heartbeatMs = 5_000 } = {}) {
    this.store     = store;
    this.bridgeUrl = bridgeUrl;
    this.healthState = "offline";
    this.msgIdSeq  = 1;
    /** @type {Map<string, {value:any, at:number}>} */
    this.cache     = new Map();
    /** @type {Map<string, {fn: Function, timer: any}>} */
    this.subs      = new Map();
    this._healthRecoveredCbs = [];
    this._heartbeat(heartbeatMs);
  }

  kind()   { return KIND; }
  health() { return this.healthState; }
  onHealthRecovered(fn) { this._healthRecoveredCbs.push(fn); return () => {
    const i = this._healthRecoveredCbs.indexOf(fn);
    if (i >= 0) this._healthRecoveredCbs.splice(i, 1);
  }; }

  /** request(method, path, body?, { cacheClass = "WARM" }) */
  async request(method, path, body, opts = {}) {
    const cls = opts.cacheClass || "WARM";
    const ttl = ttlFor(cls, KIND);
    const cacheable = method === "GET" && ttl > 0 && ttl !== Infinity;

    if (cacheable) {
      const hit = this.cache.get(path);
      if (hit && Date.now() - hit.at < ttl) {
        return { ...hit.value, _cache: { age: Date.now() - hit.at, fresh: true } };
      }
    }

    const op = ROUTE_TO_OP[`${method} ${path}`];
    if (op === undefined) {
      throw new Error(`OmpTransport: no opcode mapping for ${method} ${path}`);
    }
    const value = await this._roundtrip(op, body || {});
    if (cacheable) this.cache.set(path, { value, at: Date.now() });
    return value;
  }

  /** subscribe(channel, onMessage) — poll-based for Sprint 2. */
  subscribe(channel, onMessage) {
    const cls = channelToCacheClass(channel);
    const interval = pollFor(cls, KIND) || 30_000;
    const fetcher = channelToRefetch(channel);
    if (!fetcher) return () => {};   // unknown channel; no-op for Sprint 2
    const tick = async () => {
      try {
        const value = await this._roundtrip(fetcher.op, {});
        onMessage(value);
      } catch { /* swallow; next tick retries */ }
    };
    const timer = setInterval(tick, interval);
    tick();
    this.subs.set(channel, { fn: onMessage, timer });
    return () => { clearInterval(timer); this.subs.delete(channel); };
  }

  // ---- internals --------------------------------------------------

  async _roundtrip(op, payload) {
    const msgId = this._nextMsgId();
    const pkt = encode(op, msgId, payload);
    let res;
    try {
      res = await fetch(this.bridgeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: pkt,
      });
    } catch (e) {
      this._setHealth("offline");
      throw e;
    }
    if (!res.ok) {
      this._setHealth("degraded");
      throw new Error(`OMP bridge ${this.bridgeUrl} -> ${res.status}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const { op: respOp, msgId: respId, payload: respPayload } = decode(buf);
    if (respId !== msgId) {
      throw new Error(`OMP msg_id mismatch: req=${msgId} resp=${respId}`);
    }
    if (respOp === Op.ERROR) {
      this._setHealth("degraded");
      throw new Error(`OMP server error: ${respPayload.code} ${respPayload.msg}`);
    }
    this._setHealth("mesh");
    return respPayload;
  }

  _heartbeat(ms) {
    const tick = async () => {
      try {
        await this._roundtrip(Op.PING, {});
      } catch { /* health flipped inside _roundtrip */ }
    };
    if (typeof setInterval !== "undefined") setInterval(tick, ms);
    tick();
  }

  _setHealth(s) {
    const prev = this.healthState;
    if (prev === s) return;
    this.healthState = s;
    if (this.store) {
      const known = this.store.get("mesh")?.known ?? 1;
      const reachable = s === "mesh" ? known : 0;
      this.store.set({ mesh: { reachable, known } });
    }
    if (prev === "offline" && (s === "mesh" || s === "wifi")) {
      for (const fn of this._healthRecoveredCbs) {
        try { fn(); } catch { /* ignore */ }
      }
    }
  }

  _nextMsgId() {
    const id = this.msgIdSeq;
    this.msgIdSeq = (this.msgIdSeq + 1) & 0xFFFF;
    if (this.msgIdSeq === 0) this.msgIdSeq = 1;   // reserve 0 for pushes
    return id;
  }
}

// ---- channel ↔ poll mapping (extends as modules ship) ----
function channelToCacheClass(channel) {
  if (channel === "comms.inbox" || channel === "comms.delivery") return "WARM";
  if (channel === "power.now")                                    return "HOT";
  return "WARM";
}
function channelToRefetch(channel) {
  if (channel === "comms.inbox") return { op: Op.INBOX_HEADERS };
  if (channel === "comms.net")   return { op: Op.NET_NODES };
  if (channel === "power.now")   return { op: Op.POWER_NOW };
  return null;
}

export { CACHE_CLASS };
