import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The keys of the second steps that tests set up, kept in the output folder of the run (task
 * 10.5). The school has at most three Super Admins and `setup.spec.ts` signs in to all three of
 * the seed's, so the demo clock test, which runs after every other spec, signs in again to one of
 * them with the key its first sign-in kept. Playwright empties the folder at the start of a run.
 */
const FOLDER = path.join(import.meta.dirname, '..', 'test-results', 'second-steps');

export function keepSecondStep(login: string, key: string): void {
  mkdirSync(FOLDER, { recursive: true });
  writeFileSync(path.join(FOLDER, login), key);
}

/** The key kept for the login in this run, or `undefined` when none was set up. */
export function keptSecondStep(login: string): string | undefined {
  try {
    return readFileSync(path.join(FOLDER, login), 'utf8');
  } catch {
    return undefined;
  }
}
