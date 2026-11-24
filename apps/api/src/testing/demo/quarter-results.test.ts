import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ResultsTable } from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../create-test-app.js';
import { FixedClock } from '../fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../test-database.js';
import { SETUP_MOMENT } from './data.js';
import { fillJournals } from './journal.js';
import { SignIns } from './people.js';
import { buildDemoSchool, type DemoSchool } from './school.js';

// Task 11.17, Done when: "a test computes every quarter result of the demo school before and after
// the change and finds them the same" (`edge/calculation`: the lesson score "never enters a
// quarter figure"). The demo school is built through the real application and its journals are
// filled up to a fixed day of quarter 1 (plan decision 6: the demo plans works only in the quarter
// of its "today", so every quarter result of the demo is a result of quarter 1).
//
// The demo is not the same from run to run (its teachers enter their journals at the same time
// from one random source, and its rows are ordered by ids made new each run), so the results of
// one run cannot be pinned for another (three runs gave three lists; the report of pull request
// #382). The comparison is made on one database instead: the results are read, then a daily
// distribution is stored for every graded subject in every branch, as the demo did before the
// change, and the results read again are the same: a stored daily distribution enters no result.
// The quarter code itself is unchanged (`quarter.ts` and `record.ts` change their import line
// only), and a quarter closed on version 7 compares on version 8 with no difference
// (`closing.test.ts`).

const PASSWORD = 'demo-results-password-1';
/** A Friday of quarter 1, three weeks into the year: the journals are filled up to the day before. */
const TODAY = '2026-09-25';
const READ_AT = `${TODAY}T10:00:00+05:00`;

describe('the quarter results of the demo school', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clock: FixedClock;
  let school: DemoSchool;

  beforeAll(async () => {
    database = await createTestDatabase();
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
  }, 1_200_000);

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  /** Every result of the results table of every class, as `branch | class | n | student | subject | result`. */
  async function resultLines(): Promise<string[]> {
    const migrator = database.migrator;
    // Read by the Super Admin of the demo, in the session of the test.
    const admin = school.superAdmin;
    const caller = (branch: string, path: string) =>
      admin.caller.in(branch).get<ResultsTable>(path);
    const subjects = new Map(
      (await migrator.selectFrom('subjects').select(['id', 'name_en']).execute()).map((row) => [
        row.id,
        row.name_en,
      ]),
    );
    const branches = await migrator
      .selectFrom('branches')
      .select(['id', 'name'])
      .orderBy('name')
      .execute();
    const lines: string[] = [];
    for (const branch of branches) {
      const quarter = await migrator
        .selectFrom('quarters')
        .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
        .select('quarters.id')
        .where('quarters.branch_id', '=', branch.id)
        .where('quarters.number', '=', 1)
        .where('academic_years.start_date', '=', '2026-09-02')
        .executeTakeFirst();
      if (quarter === undefined) continue;
      const classes = await migrator
        .selectFrom('classes')
        .select(['id', 'name'])
        .where('branch_id', '=', branch.id)
        .orderBy('name')
        .execute();
      for (const one of classes) {
        const table = await caller(
          branch.id,
          `/api/results/reports/results-table?quarterId=${quarter.id}&classId=${one.id}`,
        );
        for (const [index, row] of table.rows.entries()) {
          for (const result of row.results) {
            lines.push(
              [
                branch.name,
                one.name,
                String(index + 1).padStart(2, '0'),
                `${row.student.lastName} ${row.student.firstName}`,
                subjects.get(result.subjectId) ?? result.subjectId,
                `${result.state} ${String(result.value)} ${String(result.grade)}`,
              ].join(' | '),
            );
          }
        }
      }
    }
    return lines.sort();
  }

  it('are the same with and without a stored daily distribution, one result at least for each graded subject taught', async () => {
    // One new session of the Super Admin at the moment of reading, for both reads.
    clock.set(READ_AT);
    await new SignIns(app, clock, PASSWORD).again(school.superAdmin);
    const without = await resultLines();

    // The comparison can fail: every graded subject that the demo's quarter-1 lessons teach has
    // a number for at least one student.
    const taught = await database.migrator
      .selectFrom('lessons')
      .innerJoin('subjects', 'subjects.id', 'lessons.subject_id')
      .select('subjects.name_en')
      .distinct()
      .where('subjects.journal_type', '=', 'graded')
      .where('lessons.lesson_date', '<', TODAY)
      .where('lessons.cancel_cause', 'is', null)
      .execute();
    expect(taught.length).toBeGreaterThan(0);
    const withNumber = new Set(
      without
        .map((line) => line.split(' | '))
        .filter((parts) => parts[5]?.startsWith('number ') === true)
        .map((parts) => parts[4]),
    );
    for (const { name_en: subject } of taught) {
      expect(withNumber, subject).toContain(subject);
    }

    // As the demo stored them before the change: 20 · 40 · 40 in every branch, of the current round.
    const graded = await database.migrator
      .selectFrom('subjects')
      .select(['id', 'weights_round'])
      .where('journal_type', '=', 'graded')
      .execute();
    const branches = await database.migrator.selectFrom('branches').select('id').execute();
    await database.migrator
      .insertInto('subject_daily_weights')
      .values(
        branches.flatMap((branch) =>
          graded.map((subject) => ({
            branch_id: branch.id,
            subject_id: subject.id,
            attendance: 20,
            classwork: 40,
            homework: 40,
            weights_round: subject.weights_round,
          })),
        ),
      )
      .onConflict((conflict) => conflict.doNothing())
      .execute();
    const stored = await database.migrator
      .selectFrom('subject_daily_weights')
      .select('subject_id')
      .execute();
    expect(stored.length).toBe(branches.length * graded.length);

    const withDaily = await resultLines();
    expect(withDaily).toEqual(without);
  });
});
