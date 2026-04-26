// Transport interface + factory.
//
// Two concrete implementations: HttpTransport (WiFi → OPi5 directly)
// and OmpTransport (LoRa mesh → Cardputer bridge → OPi5). Both
// implement the same public surface so module code never knows or
// cares which one is active. P10: graceful degradation.
//
// Boot-time selection: detectTransport() inspects URL params and
// network hints. Override with ?transport=mesh|wifi for testing.

import { HttpTransport } from "./http.js";
import { OmpTransport }  from "./omp.js";

/**
 * @typedef {Object} Transport
 * @property {(method: string, path: string, body?: any, opts?: object) => Promise<any>} request
 * @property {(channel: string, onMessage: (data: any) => void) => () => void} subscribe
 * @property {() => "wifi"|"mesh"|"offline"|"degraded"} health
 * @property {() => "wifi"|"mesh"} kind
 */

/** Inspect URL + hints to choose a transport flavour. */
export function detectTransport() {
  if (typeof window === "undefined") return "wifi";
  const url = new URL(window.location.href);
  const forced = url.searchParams.get("transport");
  if (forced === "mesh" || forced === "wifi") return forced;
  // Cardputer's flash-served shell sets ?transport=mesh on its index.
  // The OPi5-served shell has no override → default to WiFi.
  return "wifi";
}

/** @returns {Transport} */
export function makeTransport({ store, kind = detectTransport() } = {}) {
  return kind === "mesh"
    ? new OmpTransport({ store })
    : new HttpTransport({ store });
}
