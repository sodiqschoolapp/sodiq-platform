import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The files that may name the code columns (task 11.27; `09`, Codes: "Switching codes off for a
 * subject hides every code of that subject everywhere, exports and the API included, and keeps
 * them"; plan review 9: the columns are named `topic_code` and `work_code`, names no other table
 * uses). A reader answers a code only through `shownCode` (`plan-codes.ts`), with its subject's
 * switch; the writers that copy stored codes whatever the switch (plan decision 2) answer none.
 * A new file that names a column is added here only once it reads through `shownCode` or is such
 * a copy.
 */
const READERS: readonly string[] = [
  'modules/journal/journal-works.query.ts',
  'modules/journal/works.service.ts',
  'modules/plans/plan-follow.ts',
  'modules/plans/plan-masters-read.ts',
  'modules/plans/plan-masters.service.ts',
  'modules/plans/plan-outcomes.ts',
  'modules/plans/plan-read.ts',
  'modules/plans/plans.service.ts',
];

/** The system's own copies: they move stored codes from row to row and answer none. */
const COPIES: readonly string[] = [
  'modules/plans/plan-outcomes.service.ts',
  'modules/plans/plan-separate.ts',
];

const COLUMNS = /\b(topic_code|work_code)\b/;

function filesOf(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return name === 'testing' ? [] : filesOf(full);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('the readers of codes (task 11.27)', () => {
  it('are the files listed, and each reader shows a code through its subject switch', () => {
    const naming = filesOf(SOURCE)
      .filter((file) => COLUMNS.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SOURCE, file).split(path.sep).join('/'))
      .sort();
    expect(naming).toEqual(['database/types.generated.ts', ...READERS, ...COPIES].sort());
    for (const file of READERS) {
      const text = readFileSync(path.join(SOURCE, file), 'utf8');
      expect(/\b(shownCode|codeToWrite|codesOnOfMaster)\b/.test(text), file).toBe(true);
    }
  });
});
