/**
 * Pre-render smoke tests (`npm run test:prerender`), run after `npm run build`:
 * test/globalSetup.ts pre-renders the small fixture dataset in
 * test/fixtures/dataset/ into a temporary folder with the built server bundle
 * (dist-ssr/), then the tests check the files and hydrate a page in jsdom.
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    globalSetup: ['test/globalSetup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
