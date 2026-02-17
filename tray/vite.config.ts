import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  plugins: [
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
    port: 5174,
  },
  test: {
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
