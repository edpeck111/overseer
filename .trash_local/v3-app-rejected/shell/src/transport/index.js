/**
 * Transport selection. The shell doesn't care whether it's talking to OPi5
 * directly over WiFi or via a Cardputer mesh bridge — this module picks one
 * adapter at boot and exposes the same interface to the rest of the code.
 *
 * Sprint 1: HTTP only. Sprint 2 adds the OMP adapter.
 *
 * Detection logic (kept simple for now):
 *   - if location.hostname === '192.168.4.1' AND user-agent suggests Cardputer SoftAP
 *     → mesh transport (OMP)
 *   - else → http
 */

import { http } from './http.js';

export function detectTransport() {
  // Phone connected to a Cardputer SoftAP → 192.168.4.1 with no upstream.
  // For now we just always use http; Sprint 2 wires the real detection.
  return 'wifi';
}

export const transport = {
  kind: detectTransport(),
  http,
  // omp: lazyLoadedInSprint2,
};
