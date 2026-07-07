import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import electron from 'vite-plugin-electron';
import path from 'path';

export default defineConfig({
  plugins: [
    svelte(),
    electron([
      {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: { entryFileNames: '[name].js' },
            },
          },
        },
      },
      {
        entry: 'src/preload/index.ts',
        onstart({ reload }) { reload(); },
        vite: {
          build: {
            outDir: 'dist-electron',
            // vite-plugin-electron builds every entry in Vite library mode;
            // in library mode, `build.lib.formats` (not
            // rollupOptions.output.format) decides the emitted module
            // format. Since tray/package.json has "type": "module", the
            // plugin's default `formats` is ['es'] — Electron's preload
            // loader rejects `import` in a plain .js file, so without this
            // override the preload silently fails to load (no error surfaced
            // to the renderer; window.electronAPI/etc. are just undefined).
            lib: { formats: ['cjs'] },
            rollupOptions: {
              output: { entryFileNames: 'preload.js', format: 'cjs' },
            },
          },
        },
      },
      {
        entry: 'src/preload/terminal.ts',
        onstart({ reload }) { reload(); },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: { formats: ['cjs'] },
            rollupOptions: {
              output: { entryFileNames: '[name].js', format: 'cjs' },
            },
          },
        },
      },
    ]),
  ],
  clearScreen: false,
  server: {
    port: 5174,
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        terminal: path.resolve(__dirname, 'terminal.html'),
      },
    },
  },
  resolve: {
    conditions: ['browser'],
  },
  test: {
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
