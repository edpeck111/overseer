# ADR-0006: MessagePack body codec — msgpack (Py) + msgpackr (JS)

**Status:** Accepted (Sprint 0)

## Context

OMP body codec. Both libs are well-maintained, fast, and have stable
wire formats. Alternative considered: CBOR.

## Decision

`msgpack` on Python and `msgpackr` on JS. Use the `extensionCodec`
feature for Overseer-specific tags (e.g. compact GPS coords).

## Consequences

- Wire format aligns with the rest of the mesh ecosystem.
- Both libraries support extension types and streaming.
- Sprint 2's `server/omp/codec.py` and `shell/src/transport/omp.js`
  share the same extension-tag table.
