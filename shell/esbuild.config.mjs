// esbuild build for the OVERSEER v3 shell.
// Emits dist/bundle.{js,css} from src/main.js and src/styles/tokens.css.
// Bundle target ≤ 2 MB gzipped (per implementation plan §5).

import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/main.js"],
  bundle: true,
  outdir: "dist",
  format: "esm",
  target: "es2022",
  sourcemap: true,
  minify: !watch,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
  console.log("watching shell/src/...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
