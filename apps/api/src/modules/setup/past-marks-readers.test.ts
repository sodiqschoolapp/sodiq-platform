import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The files that may name the tables of past marks (task 11.26; `edge/developer-rules`, Past
 * marks: "The portal's Grades, Attendance and Homework reads and the personal data report are
 * their only readers"; review finding 8 of the plan): the import itself, the go-live check, the
 * merge's carry, the personal data report and the portal's one reader. Every other file of the
 * API (every staff screen, report, export, result, the digest and the assistant's reads) never
 * names them, so it can never show or count a past mark.
 */
const ALLOWED: readonly string[] = [
  'database/types.generated.ts',
  'modules/setup/past-marks.service.ts',
  'modules/setup/branches.service.ts',
  'modules/people/student-merges.service.ts',
  'modules/people/personal-data-past-marks.query.ts',
  'modules/portal/portal-past-marks.query.ts',
];

const TABLES = /\b(past_attendance|past_works|past_mark_uploads|portal_past_mark_branches)\b/;

function filesOf(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return name === 'testing' ? [] : filesOf(full);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('the readers of past marks', () => {
  it('are the import, the go-live check, the merge, the personal data report and the portal only', () => {
    const naming = filesOf(SOURCE)
      .filter((file) => TABLES.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SOURCE, file).split(path.sep).join('/'))
      .sort();
    expect(naming).toEqual([...ALLOWED].sort());
  });
});
