// esbuild build for the OVERSEER v3 shell.
// Bundles src/main.js (and the CSS graph it imports) into
// public/dist/main.{js,css}. The browser entry is shell/public/index.html
// so everything served lives under public/. Bundle target ≤ 2 MB gzipped
// per implementation plan §5.

import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/main.js"],
  bundle: true,
  outdir: "public/dist",
  format: "esm",
  target: "es2022",
  sourcemap: true,
  minify: !watch,
  logLevel: "info",
  loader: { ".svg": "file",