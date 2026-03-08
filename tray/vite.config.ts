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
            rollupOptions: {
              output: { entryFileNames: '[name].mjs', format: 'es' },
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
            rollupOptions: {
              output: { entryFileNames: '[name].mjs', format: 'es' },
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
