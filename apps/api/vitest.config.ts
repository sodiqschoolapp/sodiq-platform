import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Builds the template database that each test file copies (task 0.2).
    globalSetup: ['src/testing/global-setup.ts'],
    // Starting the whole NestJS application takes seconds when every package is
    // tested at once; the defaults (5 s per test, 10 s per hook) are too close.
    testTimeout: 30_000,
    // A hook creates or drops whole databases. With every test file doing so at
    // once, two drops in one hook were seen to take more than 30 s (task 0.5b).
    hookTimeout: 60_000,
  },
});
