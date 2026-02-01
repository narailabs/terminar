/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;

export default defineConfig({
  plugins: isTest
    ? []
    : [
        svelte(),
        electron([
          {
            // Main process entry
            entry: 'src/main/index.ts',
            vite: {
              build: {
                outDir: 'dist/main',
                rollupOptions: {
                  external: ['electron', 'electron-store'],
                },
              },
            },
          },
          {
            // Preload scripts entry
            entry: 'src/preload/index.ts',
            onstart(args) {
              args.reload();
            },
            vite: {
              build: {
                outDir: 'dist/preload',
                rollupOptions: {
                  external: ['electron'],
                },
              },
            },
          },
        ]),
        renderer(),
      ],
  root: isTest ? '.' : 'src/renderer',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 3002,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
