# ADR-0010: Brotli backend — brotlicffi + brotli-wasm

**Status:** Accepted (Sprint 4)
**Deciders:** Ted (delegated; standing autonomous mandate); recorded by Sprint 4 author

## Context

Sprint 2 shipped the OMP wire codec with `compress=False` default and a
note that Sprint 4 would enable Brotli on the wire. The Python `brotli`
package (Mozilla-maintained C wrapper) does not expose the
`BrotliEncoderSetCustomDictionary` / `BrotliDecoderAttachDictionary`
entry points; `brotlicffi` (the CFFI binding) doesn't either, despite
being the more flexible cousin. Sprint 2's `tools/build-dictionary.py`
already produces `server/omp/dictionary.bin` from sample server
responses — the question for Sprint 4 was how to put it on the wire.

## Decision

**Backends:** `brotlicffi` server-side, `brotli-wasm` browser-side (lazy init).
`brotlicffi` is preferred over `Brotli` (Mozilla) because the CFFI
interface lets us extend the FFI with the missing dict entry points
without recompiling. `brotli-wasm` natively supports
`customDictionary` via `compress({customDictionary, ...})` and
`decompress({customDictionary, ...})`.

**Wire format:** OMP `VERSION` bumps from `0x01` (raw MessagePack) to
`0x02` (Brotli-wrapped MessagePack). Both codecs handle both versions
on decode for graceful upgrade. Senders emit `0x02` when their
counterpart advertises Brotli support in `HELLO_ACK.caps`; default for
Sprint 4 is `caps: ["brotli", ...]` on both sides.

**Dictionary on the wire:** raw Brotli first, dictionary second.

  - Raw Brotli (no shared dict) ships in this Sprint 4 commit set.
    That's the immediate bandwidth win — typical OMP payload ratios
    of 30–50% reduction without any dictionary work.
  - Shared-dictionary Brotli ships **on the JS side** in this same
    sprint (brotli-wasm exposes `customDictionary`); senders that
    detect the peer is browser-side use the dict.
  - Shared-dictionary Brotli **on the Python side** is gated on
    binding the missing FFI entry points. brotlicffi makes this
    relatively cheap (extend the cdef, call the symbols directly off
    `_brotlicffi.lib`). Slotted: Sprint 4 lands the binding shim if it
    fits comfortably; otherwise it lands as a Sprint-4.5 follow-on
    commit. The dictionary file is shipped, hashed, and version-stamped
    in HELLO regardless — only the runtime use waits.

## Future migration path

Native browser `CompressionStream("br")` shipped in Chrome 119 (Oct
2023), Firefox 113 (May 2023), Safari 17.4 (Mar 2024). Native dict
support is in WICG draft and Chrome 124+; Firefox/Safari are behind.
When 90%+ of target browsers support `compressionStream` with shared
dictionaries:

  1. JS side drops `brotli-wasm` (~200 KB bundle savings).
  2. The codec swaps `brotli-wasm.compress({customDictionary, …})` for
     `new CompressionStream("br", {dictionary})`.
  3. Wire format unchanged — we just lose a dependency.

Track readiness on https://caniuse.com/?search=compressionstream and
https://wicg.github.io/compression-dictionary-transport/.

## Consequences

- **Bundle size up.** `brotli-wasm` adds ~200 KB minified to the shell
  bundle. We were at 24 KB gzipped after Sprint 3; we'll be at
  ~150–200 KB gzipped after Sprint 4. Still inside the 2 MB budget by
  an order of magnitude. Sprint 4's bundle-size CI guard catches any
  regression past the budget regardless.
- **Sprint 4 codec is asymmetric for now.** Server compresses without
  the dict; browser can compress with the dict. Both can decode with
  or without the dict. Once the Python ctypes/cffi binding lands, the
  asymmetry closes.
- **Requirements update.** `brotlicffi` joins `requirements.txt`;
  legacy `brotli` stays for the existing `tools/build-dictionary.py`
  read path (it's only used to compute compression-ratio statistics,
  not on the wire).

## Why not vendor a ctypes wrapper now

Considered. The Brotli C library exposes the dictionary entry points
(`BrotliEncoderSetCustomDictionary`, `BrotliDecoderAttachDictionary`),
and a 60–80-line ctypes shim against `libbrotlienc.so.1` /
`libbrotlidec.so.1` would do it. The reason it's deferred: Sprint 4's
gate is offline-shell-with-cached-data, IDB queue persistence, the
WS-push producer, the sextant port, and the service worker. Adding a
hand-rolled FFI shim alongside that load is real risk for marginal
gain (the dict only kicks in when both sides can decode it; until both
sides do, the wire reverts to raw-Brotli regardless). A focused
follow-on commit that does only the FFI shim — with proper byte-level
test vectors — is the cleaner path.

## Sprint 4 implementation note

After two evaluation passes (`brotli-wasm`, then native
`CompressionStream`), Sprint 4 ships an asymmetric Brotli setup:

  - **Server-side encodes v0x02 (Brotli) by default**, decodes both
    v0x01 and v0x02. brotlicffi handles raw Brotli without dict.
  - **Browser bundle stays v0x01** (raw MessagePack). esbuild iife
    can't easily dynamic-split brotli-wasm, and shipping it eagerly
    pulls ~150 KB into the bundle for a path the WiFi-shell never
    uses (HTTP/JSON is the WiFi path). The Cardputer-served shell
    (Sprint 11+) gets its own bundle that adds v0x02 then.
  - **Server omp_endpoint echoes the request's wire version**, so JS
    clients sending v0x01 get v0x01 replies; future Cardputer clients
    sending v0x02 get v0x02 replies. No client misalignment.

Native `CompressionStream("br")` was rejected because the format name
diverges (browsers: `"br"`, Node 22 sandbox: `"brotli"`), making
feature-detection brittle. When the Web Compression Streams Level 2
draft (with shared-dictionary support) ships uniformly, we revisit:
the JS side migrates to native, the bundle drops brotli-wasm, the
Cardputer bundle gets dict-on-the-wire, and (with the matching Python
ctypes shim) server-side dict-Brotli goes live.

Bandwidth-budget impact: Sprint 4 LoRa-bound traffic (server →
Cardputer) gets full compression (40-70% reduction on typical
payloads). WiFi-bound traffic stays uncompressed — the LAN bandwidth
savings would be marginal anyway.
