import { defineConfig, devices } from '@playwright/test';

const isCi = Boolean(process.env.CI);

// Ports of their own, so the browser tests never meet a `pnpm dev` that is
// running, and never its database.
const API_PORT = 3001;
const WEB_PORT = 5174;

const output = isCi ? 'pipe' : 'ignore';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: isCi,
  reporter: 'list',
  // Runs when both servers answer: creates the accounts the tests sign in with.
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${String(WEB_PORT)}`,
    trace: 'retain-on-failure',
    // A click or a read whose element never comes fails here with its line, never after the
    // whole test's time: a stalled page walk ran into CI's 10-minute step limit with no report
    // and no trace (30 October 2026).
    actionTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Never an existing server: every run has its own database `sodiq_e2e`,
  // built again from the migrations by the API of the tests
  // (apps/api/src/testing/e2e). `sodiq_dev` is not touched. `pnpm test:e2e`
  // at the root builds that API first.
  webServer: [
    {
      command: 'pnpm --filter @sodiq/api e2e:server',
      cwd: '../..',
      env: {
        E2E_API_PORT: String(API_PORT),
        // The address in the links of the mails (task 2.3c-2).
        E2E_WEB_ORIGIN: `http://localhost:${String(WEB_PORT)}`,
      },
      url: `http://127.0.0.1:${String(API_PORT)}/api/health`,
      reuseExistingServer: false,
      // In CI the servers' output is the only way to see why they did not start.
      stdout: output,
      timeout: 120_000,
    },
    {
      // The web app as a developer runs it; the URL goes through its proxy to the API.
      command: `pnpm exec vite --port ${String(WEB_PORT)} --strictPort`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${String(API_PORT)}` },
      url: `http://localhost:${String(WEB_PORT)}/api/health`,
      reuseExistingServer: false,
      stdout: output,
      timeout: 120_000,
    },
  ],
});
