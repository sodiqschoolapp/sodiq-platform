import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Fraction, workPercent } from '@sodiq/calc';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../database/migrate.js';
import { createTestApp } from '../create-test-app.js';
import { FixedClock } from '../fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../test-database.js';
import { SETUP_MOMENT } from './data.js';
import { fillJournals } from './journal.js';
import { SignIns } from './people.js';
import { studentResultLines } from './result-lines.js';
import { buildDemoSchool, type DemoSchool } from './school.js';

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../db/migrations',
);
const SWITCH = '0189_work_amounts_switch.sql';

const PASSWORD = 'demo-decimal-switch-password-1';
/** A Friday of quarter 1, three weeks into the year: the journals are filled up to the day before. */
const TODAY = '2026-09-25';
/** The moment of the reads: quarter 2 has begun, so quarter 1 has its results. */
const READ_AT = '2026-11-14T18:00:00+05:00';

// Task 11.25b, Done when: "a test computes every quarter result of the demo school before and
// after the change and finds them the same"; the build line: "The demo school's results before and
// after are also compared with the final records stored by version 8" (plan decision 8, confirmed
// at review). The demo school is built and filled by the application on a database migrated to
// 0188, the schema 11.25a left on production, where the scores and totals are whole integers
// beside their exact twins (the application writes only whole numbers there). Every result is
// read, then 0189 switches the columns, and every result is read again on the same database and
// with the same application, which kept its connections across the migration as a running
// version does. The code of version 8 cannot run on this branch, so its arithmetic stands in:
// every number of the demo gives the fraction version 8 gave (score × 100 / total). The demo
// enters no rating exam, so its quarters cannot be closed; a quarter closed on version 8 and
// compared on version 9 is in `closing.test.ts`. The demo is not the same from run to run
// (`quarter-results.test.ts`), so the comparison is made on one database. Names are invented.
describe('the quarter results of the demo school across the switch to decimal scores', () => {
  let database: TestDatabase;
  let directory: string;
  let app: NestExpressApplication;
  let clock: FixedClock;
  let school: DemoSchool;
  let before: string[];
  let after: string[];
  let numbers: { score: number; total: number }[];

  beforeAll(async () => {
    database = await createTestDatabase({ empty: true });
    directory = await mkdtemp(path.join(tmpdir(), 'sodiq-decimal-switch-'));
    for (const name of (await readdir(MIGRATIONS)).filter((one) => one.endsWith('.sql'))) {
      if (name < SWITCH) await copyFile(path.join(MIGRATIONS, name), path.join(directory, name));
    }
    await migrate({ connectionString: database.migrationUrl, directory });
    clock = new FixedClock(SETUP_MOMENT);
    app = await createTestApp({
      database: database.app,
      jobsDatabaseUrl: database.appUrl,
      clock,
      listen: true,
    });
    const say = () => undefined;
    school = await buildDemoSchool({
      app,
      migrator: database.migrator,
      clock,
      password: PASSWORD,
      say,
    });
    await fillJournals({
      app,
      migrator: database.migrator,
      clock,
      school,
      password: PASSWORD,
      today: TODAY,
      say,
    });
    const migrator = database.migrator;
    clock.set(READ_AT);
    await new SignIns(app, clock, PASSWORD).again(school.superAdmin);
    before = await studentResultLines(migrator, school);
    numbers = (
      await migrator
        .selectFrom('journal_cells')
        .innerJoin('journal_works', 'journal_works.id', 'journal_cells.work_id')
        .select(['journal_cells.score as score', 'journal_works.total as total'])
        .where('journal_cells.score', 'is not', null)
        .where('journal_works.total', 'is not', null)
        .execute()
    ).flatMap((row) =>
      row.score === null || row.total === null ? [] : [{ score: row.score, total: row.total }],
    );

    await copyFile(path.join(MIGRATIONS, SWITCH), path.join(directory, SWITCH));
    await migrate({ connectionString: database.migrationUrl, directory });
    await rm(directory, { recursive: true, force: true });
    after = await studentResultLines(migrator, school);
  }, 1_800_000);

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('has results and typed numbers to compare', () => {
    expect(before.length).toBeGreaterThan(0);
    expect(numbers.length).toBeGreaterThan(0);
  });

  it('gives every number of the demo the fraction version 8 gave: score x 100 / total', () => {
    for (const { score, total } of numbers) {
      expect(Number.isSafeInteger(score) && Number.isSafeInteger(total)).toBe(true);
      expect(
        workPercent(score, total).equals(Fraction.of(BigInt(score) * 100n, BigInt(total))),
      ).toBe(true);
    }
  });

  it('finds every quarter result the same after the switch', () => {
    expect(after).toEqual(before);
  });
});
