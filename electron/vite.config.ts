/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import electron from 'vite-plugin-electron/simple';

const isTest = process.env.NODE_ENV === 'test' || !!process.env.VITEST;

export default defineConfig({
  plugins: isTest
    ? []
    : [
        svelte(),
        electron({
          main: {
            entry: 'src/main/index.ts',
          },
          preload: {
            input: 'src/preload/index.ts',
          },
        }),
      ],
  clearScreen: false,
  server: {
    port: 3002,
  },
  resolve: {
    conditions: ['browser'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
