import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Builds the template database that each test file copies (task 0.2).
    globalSetup: ['src/testing/global-setup.ts'],
    // The local-only key of .env.example, so the tests do not depend on the
    // .env of the machine. It encrypts the invented second steps of the tests.
    env: { SECOND_STEP_KEY: 'c29kaXEtbG9jYWwtc2Vjb25kLXN0ZXAta2V5LTAwMDE=' },
    // Starting the whole NestJS application takes seconds when every package is
    // tested at once; the defaults (5 s per test, 10 s per hook) are too close.
    testTimeout: 30_000,
    // A hook creates or drops whole databases. With every test file doing so at
    // once, two drops in one hook were seen to take more than 30 s (task 0.5b).
    hookTimeout: 60_000,
  },
});
