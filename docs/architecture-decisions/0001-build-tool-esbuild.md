# ADR-0001: Use esbuild over Vite for the shell bundle

**Status:** Accepted (Sprint 0)
**Deciders:** Ted; recorded by author of plan §7

## Context

The shell needs a build tool to bundle ES modules, transpile minimally,
and emit a deployable artifact under the 2 MB gzipped budget (plan §5).
Vite gives richer dev experience and HMR; esbuild is faster, smaller,
and has a simpler dependency tree.

## Decision

Use **esbuild ^0.21**.

## Consequences

- One dev dependency in `shell/package.json` instead of a Vite tree.
- HMR is not free; we run `npm run watch` for incremental builds and
  reload manually. Acceptable for the scope of v3 UI work.
- Bundle config is plain JS in `shell/esbuild.config.mjs` — readable,
  no plugin sprawl.
- Aligns with the prepper/minimal ethos: fewer moving parts.
