import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';
import { en } from '../src/i18n/locales/en';
import { ACCOUNTS_VARIABLE } from './accounts';

/** How long the first page may take on a cold start, for example in CI. */
const FIRST_PAGE_MS = 120_000;

/**
 * Opens the app once in a browser before any test runs. Vite compiles a module
 * when a browser first asks for it, and on a cold start it also prepares the
 * libraries and reloads the page: the readiness check of the web server asks
 * for no module, so without this the first test paid for all of it inside its
 * own time limit and could fail at its first step.
 */
async function openAppOnce(baseURL: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    // Nobody is signed in: every address leads to the sign-in page.
    await page.goto('/', { timeout: FIRST_PAGE_MS });
    const language = page.getByRole('combobox', { name: en.language.label, exact: true });
    await language.waitFor({ timeout: FIRST_PAGE_MS });
    // The reload after the libraries were prepared, if there is one, is over
    // when the page stands still again.
    await page.waitForLoadState('networkidle', { timeout: FIRST_PAGE_MS });
    await language.waitFor({ timeout: FIRST_PAGE_MS });
  } finally {
    await browser.close();
  }
}

/**
 * Runs once, after the API of the tests has built the database `sodiq_e2e`:
 * the seed command of the API creates the accounts and prints them as one line
 * of JSON. They reach the tests through the environment and are written to no
 * file; the database is dropped at the start of the next run.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const printed = execFileSync(process.execPath, ['dist-e2e/testing/e2e/seed.js'], {
    cwd: path.resolve(import.meta.dirname, '../../api'),
    encoding: 'utf8',
  });
  const line = printed.trim().split('\n').at(-1);
  if (line === undefined || !line.startsWith('{')) {
    throw new Error('The seed command of the browser tests printed no accounts.');
  }
  process.env[ACCOUNTS_VARIABLE] = line;

  const baseURL = config.projects[0]?.use.baseURL;
  if (baseURL === undefined) {
    throw new Error('The browser tests have no address of the web app (baseURL).');
  }
  await openAppOnce(baseURL);
}
