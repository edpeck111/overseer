// esbuild build for the OVERSEER v3 shell.
// Bundles src/main.js into public/dist/main.{js,css}. Browser entry
// is shell/public/index.html. Bundle target <= 2 MB gzipped per plan.

import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/main.js"],
  bundle: true,
  outdir: "public/dist",
  format: "iife",
  target: "es2022",
  sourcemap: true,
  minify: !watch,
  logLevel: "info",
  loader: { ".svg": "file", ".png": "file", ".woff2": "file" },
});

if (watch) {
  await ctx.watch();
  console.log("watching shell/src/...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}