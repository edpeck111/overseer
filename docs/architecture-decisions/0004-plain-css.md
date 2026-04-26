# ADR-0004: Plain CSS with custom properties

**Status:** Accepted (Sprint 0)

## Context

We considered Tailwind / utility frameworks. The visual reference
already demonstrates the styling pattern: tokens at `:root`, BEM-ish
classes per component.

## Decision

Plain CSS, organised one file per component under `shell/src/styles/`.
Tokens declared in `tokens.css` (extracted from `00-VISUAL-REFERENCE.html`
in Sprint 1).

## Consequences

- No build-time CSS pipeline beyond esbuild's CSS bundling.
- Explicit, readable component CSS — matches box-drawing aesthetic.
- Easier to audit when adapting for different theme presets in Sprint 15.
