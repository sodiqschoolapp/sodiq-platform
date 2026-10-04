import { defineConfig, devices } from '@playwright/test';

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  forbidOnly: isCi,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Starts web app and API the way a developer does. The URL goes through the web
  // server's proxy, so the tests begin only when both answer.
  webServer: {
    command: 'pnpm dev',
    cwd: '../..',
    url: 'http://localhost:5173/api/health',
    reuseExistingServer: !isCi,
    // In CI the servers' output is the only way to see why they did not start.
    stdout: isCi ? 'pipe' : 'ignore',
    timeout: 120_000,
  },
});
