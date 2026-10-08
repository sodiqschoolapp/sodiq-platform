import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The release of the error reports: the commit Render builds (task 0.10).
  define: {
    'import.meta.env.VITE_RELEASE': JSON.stringify(process.env.RENDER_GIT_COMMIT ?? ''),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // In development the browser reaches the API through the web server, on one origin.
    // The address is the default HOST of the API (apps/api/src/config/config.ts);
    // the browser tests name the API of their own (playwright.config.ts).
    proxy: {
      // `ws`: the live connection of the notifications (task 0.9) is under /api too.
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    // tooling: tests of generated files; they run in Node, not in a browser-like page.
    include: ['src/**/*.test.{ts,tsx}', 'tooling/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
    // At most this many test files at once, as in the API (apps/api/vitest.config.ts).
    // A page test draws the whole app in jsdom; with one file per processor the
    // first test of the sample list, 2 seconds alone, ran past its 5 seconds in
    // the full run once a further file of page tests existed (task 0.8b-2).
    // `pnpm test` runs these beside the API tests, which take 4 processors.
    maxWorkers: 2,
    // A page test draws the whole app in jsdom, and the first test of a file
    // pays the cold start of its worker: the first test of the sample list
    // (100 rows, 1.4 s here) ran to 5.26 s on a CI runner and failed at the
    // default 5 s (task 0.8b-3). As the API's 30 s: the limit of a test, not
    // what it asserts.
    testTimeout: 15_000,
  },
});
