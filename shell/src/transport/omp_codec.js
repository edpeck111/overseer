// OMP wire codec — JS mirror of server/omp/codec.py.
//
// Sprint 2 ships VERSION=0x01 with raw MessagePack bodies. Sprint 4
// will introduce VERSION=0x02 with Brotli + shared dictionary once
// brotli-wasm is in the bundle. Both sides honour the `compress`
// flag; default is false in Sprint 2 to keep the wire shape symmetric
// with the simulator backend.

import { pack, unpack } from "msgpackr";
import { Op, isFragment, realOp } from "./omp_opcodes.js";

export const VERSION = 0x01;
export const HEADER_LEN = 4;

/** Encode (op, msgId, payload) into an OMP packet (Uint8Array).
 *  Sprint 2: msgpack only. compress kwarg is reserved for Sprint 4. */
export function encode(op, msgId, payload, { compress = false } = {}) {
  if (!(op >= 0 && op < 0x80)) throw new Error(`op out of range: ${op}`);
  if (!(msgId >= 0 && msgId < 0x10000)) throw new Error(`msg_id out of range: ${msgId}`);
  if (compress) throw new Error("Brotli compression — Sprint 4 (brotli-wasm)");
  const body = pack(payload);
  const out = new Uint8Array(HEADER_LEN + body.byteLength);
  const view = new DataView(out.buffer);
  view.setUint8(0, VERSION);
  view.setUint8(1, op);
  view.setUint16(2, msgId, false);    // big-endian
  out.set(body, HEADER_LEN);
  return out;
}

/** Decode an OMP packet → { op, msgId, payload }. */
export function decode(packet, { compress = false } = {}) {
  if (packet.byteLength < HEADER_LEN) throw new Error("packet too short");
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const ver = view.getUint8(0);
  if (ver !== VERSION) throw new Error(`unsupported OMP version 0x${ver.toString(16)}`);
  const opByte = view.getUint8(1);
  if (isFragment(opByte)) throw new Error("fragmented OMP packets — Sprint 12");
  if (compress) throw new Error("Brotli decompression — Sprint 4 (brotli-wasm)");
  const op = realOp(opByte);
  const msgId = view.getUint16(2, false);
  const body = new Uint8Array(packet.buffer, packet.byteOffset + HEADER_LEN, packet.byteLength - HEADER_LEN);
  const payload = unpack(body);
  return { op, msgId, payload };
}

export { Op };
