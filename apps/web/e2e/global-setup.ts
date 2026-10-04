import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ACCOUNTS_VARIABLE } from './accounts';

/**
 * Runs once, after the API of the tests has built the database `sodiq_e2e`:
 * the seed command of the API creates the accounts and prints them as one line
 * of JSON. They reach the tests through the environment and are written to no
 * file; the database is dropped at the start of the next run.
 */
export default function globalSetup(): void {
  const printed = execFileSync(process.execPath, ['dist-e2e/testing/e2e/seed.js'], {
    cwd: path.resolve(import.meta.dirname, '../../api'),
    encoding: 'utf8',
  });
  const line = printed.trim().split('\n').at(-1);
  if (line === undefined || !line.startsWith('{')) {
    throw new Error('The seed command of the browser tests printed no accounts.');
  }
  process.env[ACCOUNTS_VARIABLE] = line;
}
