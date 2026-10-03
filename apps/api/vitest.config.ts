import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Starting the whole NestJS application takes seconds when every package is
    // tested at once; the defaults (5 s per test, 10 s per hook) are too close.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
