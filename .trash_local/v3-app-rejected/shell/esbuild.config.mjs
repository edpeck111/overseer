import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, statSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const dist = join(__dirname, 'dist');
mkdirSync(dist, { recursive: true });

// Copy static assets (index.html, manifest.json, icons, sounds, fonts)
function copyStatic() {
  const publicDir = join(__dirname, 'public');
  if (existsSync(publicDir)) {
    cpSync(publicDir, dist, { recursive: true });
  }
  // index.html lives at shell/src/index.html → dist/index.html
  const indexHtml = join(__dirname, 'src', 'index.html');
  if (existsSync(indexHtml)) {
    copyFileSync(indexHtml, join(dist, 'index.html'));
  }
}

const buildOptions = {
  entryPoints: [
    join(__dirname, 'src', 'main.js'),
    join(__dirname, 'src', 'styles', 'overseer.css'),
  ],
  bundle: true,
  outdir: dist,
  format: 'esm',
  target: ['es2020'],
  sourcemap: !watch ? 'linked' : 'inline',
  minify: !watch,
  loader: {
    '.svg': 'text',
    '.txt': 'text',
    '.json': 'json',
    '.woff2': 'file',
  },
  // chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  copyStatic();
  await ctx.watch();
  // Re-copy static files when src/index.html changes — esbuild watch doesn't track non-bundled files.
  // Simple poll-based approach for dev:
  let lastHtmlMtime = 0;
  setInterval(() => {
    const indexHtml = join(__dirname, 'src', 'index.html');
    if (existsSync(indexHtml)) {
      const m = statSync(indexHtml).mtimeMs;
      if (m !== lastHtmlMtime) {
        lastHtmlMtime = m;
        copyStatic();
      }
    }
  }, 500);
  console.log('[esbuild] watching shell/src/...  (Ctrl+C to stop)');
} else {
  await esbuild.build(buildOptions);
  copyStatic();
  console.log('[esbuild] build complete → dist/');
}
