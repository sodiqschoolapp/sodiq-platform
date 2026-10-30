import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['check/**/*.test.ts'],
    // Each check runs the solver for up to a minute.
    testTimeout: 180_000,
  },
});
