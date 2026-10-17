import { build, context } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, rm, mkdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(rootDir, 'dist');
const watch = process.argv.includes('--watch');

const mainOptions = {
  entryPoints: [path.join(rootDir, 'src/main/index.ts')],
  outfile: path.join(dist, 'main/index.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  sourcemap: 'inline',
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
};

const preloadEntries = ['panel', 'ball', 'overlay', 'plugin-window', 'recorder'];
const preloadOptions = {
  entryPoints: preloadEntries.map((n) => path.join(rootDir, `src/preload/${n}.ts`)),
  outdir: path.join(dist, 'preload'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  sourcemap: 'inline',
  logLevel: 'warning',
};

function runVite() {
  const viteBin = path.join(rootDir, 'node_modules/vite/bin/vite.js');
  execFileSync(process.execPath, [viteBin, 'build'], { cwd: rootDir, stdio: 'inherit' });
}

async function main() {
  await rm(path.join(dist, 'main'), { recursive: true, force: true });
  await rm(path.join(dist, 'preload'), { recursive: true, force: true });
  await mkdir(path.join(dist, 'main'), { recursive: true });
  await mkdir(path.join(dist, 'preload'), { recursive: true });

  if (watch) {
    const mainCtx = await context(mainOptions);
    const preloadCtx = await context(preloadOptions);
    await Promise.all([mainCtx.watch(), preloadCtx.watch()]);
    console.log('[build] watching main/preload …');
    runVite();
    return;
  }

  const t0 = Date.now();
  await Promise.all([build(mainOptions), build(preloadOptions)]);
  runVite();
  console.log(`[build] done in ${Date.now() - t0}ms`);
}

main().catch((err) => {
  console.error('[build] failed:', err);
  process.exit(1);
});

