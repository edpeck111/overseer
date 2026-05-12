# ADR-0003: Vanilla JS + JSDoc types over TypeScript

**Status:** Accepted (Sprint 0)

## Context

TypeScript adds a transpile step, an editor service, and another
config surface. JSDoc gets us most of the IDE benefit without those.

## Decision

Vanilla ES modules with JSDoc-flavoured type annotations. Pyright/tsc
in `--checkJs` mode is the type checker if we want it later.

## Consequences

- Smaller deploy artifact (no `.ts.map` overhead, no transpile).
- Sticking to the language the runtime already understands.
- Less type strictness than `.ts` — we accept the trade.
