// OMP opcode table — JS mirror of server/omp/opcodes.py.
//
// MUST stay in sync with the Python side. tests/unit/test_omp_codec.py
// asserts roundtrip equality via shared fixture vectors; if you edit
// this file, edit opcodes.py too.

export const Op = Object.freeze({
  // Protocol control
  HELLO:          0x00,
  HELLO_ACK:      0x01,
  ACK:            0x02,
  NACK:           0x03,
  PING:           0x04,
  PONG:           0x05,
  ERROR:          0x06,
  FRAG_REQ:       0x07,
  DICT_HASH:      0x08,
  DICT_FETCH:     0x09,
  SYNC_HELLO:     0x0A,
  TIME_SYNC:      0x0B,
  TIME_SYNC_RESP: 0x0C,
  SUBSCRIBE:      0x0D,
  UNSUBSCRIBE:    0x0E,
  PUSH:           0x0F,

  // Comms (subset)
  INBOX_HEADERS:    0x10,
  MESSAGE_FETCH:    0x11,
  MESSAGE_SEND:     0x12,
  MESSAGE_MARK_READ: 0x13,
  BOARD_LIST:       0x19,
  NET_NODES:        0x20,

  // Knowledge
  LLM_QUERY: 0x30,
  LLM_TOKEN: 0x31,

  // Power & System
  POWER_NOW:      0x90,
  POWER_HISTORY:  0x91,
  SYS_STATUS:     0xA0,
  SYS_PIN_VERIFY: 0xA4,
});

export const FRAGMENT_BIT = 0x80;

export function isFragment(byte) { return (byte & FRAGMENT_BIT) !== 0; }
export function realOp(byte)     { return byte & 0x7F; }
