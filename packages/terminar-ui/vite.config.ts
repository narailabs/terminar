import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        // Enable custom elements mode for all components in this package
        customElement: true,
      },
    }),
  ],
  build: {
    lib: {
      entry: {
        index: 'src/index.ts',
        'components/index': 'src/components/index.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['svelte', 'svelte/internal'],
    },
    outDir: 'dist',
    sourcemap: true,
  },
});
