import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = join(import.meta.dirname, '..', '..');

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(path);
      }
      return Promise.resolve(
        entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [],
      );
    }),
  );
  return files.flat();
}

// Correction 2 of the review of pull request #66: `password_reset_address`
// hands any account's email to any caller of the application user, which the
// API shares with the worker, so one file names it: the mail job.
describe('the email of a password reset', () => {
  it('is read by the mail job only', async () => {
    const naming: string[] = [];
    for (const file of await sourceFiles(SOURCE)) {
      if (file.endsWith('types.generated.ts')) {
        continue;
      }
      if ((await readFile(file, 'utf8')).includes('password_reset_address')) {
        naming.push(relative(SOURCE, file));
      }
    }
    expect(naming).toEqual(['modules/auth/password-reset-mail.job.ts']);
  });
});
