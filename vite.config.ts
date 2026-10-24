import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(root, 'src/renderer');

export default defineConfig({
  root: rendererRoot,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(root, 'src/shared'),
      '@renderer': resolve(rendererRoot, 'src'),
    },
  },
  build: {
    outDir: resolve(root, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome140',
    cssCodeSplit: false,
    assetsInlineLimit: 4096,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        panel: resolve(rendererRoot, 'index.html'),
        ball: resolve(rendererRoot, 'ball.html'),
        overlay: resolve(rendererRoot, 'overlay.html'),
        recorder: resolve(rendererRoot, 'recorder.html'),
        settings: resolve(rendererRoot, 'settings.html'),
        editor: resolve(rendererRoot, 'editor.html'),
        search: resolve(rendererRoot, 'search.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});



