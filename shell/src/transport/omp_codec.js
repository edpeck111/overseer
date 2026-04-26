// OMP wire codec — JS mirror of server/omp/codec.py.
//
// Sprint 4 JS scope: encode v0x01 (raw MessagePack) and decode v0x01.
// Server-side encodes Brotli (v0x02) into Cardputer-bound packets, but
// the WiFi-served browser shell stays on v0x01 because:
//   - Browser bundle bloat (~150 KB) for an esbuild-iife setup that
//     can't easily dynamic-split brotli-wasm (ADR-0010).
//   - The browser path is HTTP/JSON anyway; OMP is only used by the
//     Cardputer-served shell, which will get its own bundle later.
//
// The decoder detects v0x02 and raises a clear, deferred error rather
// than silently failing — call sites learn the limit.

import { pack, unpack } from "msgpackr";
import { Op, isFragment, realOp } from "./omp_opcodes.js";

export const VERSION = 0x01;
export const SERVER_VERSION = 0x02;       // what server.encode emits by default
export const HEADER_LEN = 4;

/** Encode (op, msgId, payload) into an OMP packet (Uint8Array). */
export async function encode(op, msgId, payload, { version = VERSION, dictionary } = {}) {
  if (!(op >= 0 && op < 0x80)) throw new Error(`op out of range: ${op}`);
  if (!(msgId >= 0 && msgId < 0x10000)) throw new Error(`msg_id out of range: ${msgId}`);
  if (version !== VERSION) {
    throw new Error(
      `JS encode at v0x${version.toString(16)} not supported in Sprint 4 — see ADR-0010`,
    );
  }
  if (dictionary) throw new Error("v0x01 does not support dictionaries");
  const body = pack(payload);
  const out = new Uint8Array(HEADER_LEN + body.byteLength);
  const view = new DataView(out.buffer);
  view.setUint8(0, version);
  view.setUint8(1, op);
  view.setUint16(2, msgId, false);
  out.set(body, HEADER_LEN);
  return out;
}

/** Decode an OMP packet -> { op, msgId, payload }. */
export async function decode(packet) {
  if (packet.byteLength < HEADER_LEN) throw new Error("packet too short");
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const ver = view.getUint8(0);
  if (ver === SERVER_VERSION) {
    throw new Error(
      "JS decoder received Brotli (v0x02) packet — Sprint 4 ships v0x01 only " +
      "in the WiFi-served bundle. The Cardputer-served bundle will add v0x02 " +
      "when the Cardputer firmware lands (~Sprint 11). See ADR-0010.",
    );
  }
  if (ver !== VERSION) throw new Error(`unsupported OMP version 0x${ver.toString(16)}`);
  const opByte = view.getUint8(1);
  if (isFragment(opByte)) throw new Error("fragmented OMP packets — Sprint 12");
  const op = realOp(opByte);
  const msgId = view.getUint16(2, false);
  const body = new Uint8Array(packet.buffer, packet.byteOffset + HEADER_LEN, packet.byteLength - HEADER_LEN);
  const payload = unpack(body);
  return { op, msgId, payload };
}

export { Op };
