import { readFileSync, writeFileSync } from 'node:fs';
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
// of its "today", so every quarter result of the demo is a result of quarter 1). Every result of
// the results table, of every class of every branch, is compared with the list pinned in
// `quarter-results.expected.json`, which was written on the code before the lesson score was
// removed (the first build commit of 11.17) and is never written again by this test in CI.
// `PIN_DEMO_RESULTS=write` writes the list again; a change of the demo that moves a result shows
// which one in the diff of that file.

const PASSWORD = 'demo-results-password-1';
/** A Friday of quarter 1, three weeks into the year: the journals are filled up to the day before. */
const TODAY = '2026-09-25';
const EXPECTED = new URL('./quarter-results.expected.json', import.meta.url);

describe('the quarter results of the demo school', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let school: DemoSchool;
  let clock: FixedClock;

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
  }, 1_800_000);

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('are the results pinned before the lesson score was removed', async () => {
    clock.set(`${TODAY}T10:00:00+05:00`);
    await new SignIns(app, clock, PASSWORD).again(school.superAdmin);
    const subjectName = new Map([...school.subjects.entries()].map(([name, id]) => [id, name]));
    const lines: string[] = [];
    const subjectsWithNumber = new Set<string>();
    for (const branch of school.branches) {
      const reader = school.superAdmin.caller.in(branch.id);
      const quarterId = branch.quarterIds[0] ?? '';
      for (const one of branch.classes) {
        const table = await reader.get<ResultsTable>(
          `/api/results/reports/results-table?quarterId=${quarterId}&classId=${one.id}`,
        );
        for (const [index, row] of table.rows.entries()) {
          for (const result of row.results) {
            const subject = subjectName.get(result.subjectId) ?? result.subjectId;
            if (result.value !== null) subjectsWithNumber.add(subject);
            lines.push(
              [
                branch.name,
                one.name,
                String(index + 1).padStart(2, '0'),
                `${row.student.lastName} ${row.student.firstName}`,
                subject,
                `${result.state} ${String(result.value)} ${String(result.grade)}`,
              ].join(' | '),
            );
          }
        }
      }
    }
    lines.sort();

    // The comparison can fail: a demo that wrote no marks gives no number to compare.
    const gradedSubjects = new Set(
      (
        await database.migrator
          .selectFrom('subjects')
          .select('name_en')
          .where('journal_type', '=', 'graded')
          .where('archived_at', 'is', null)
          .execute()
      ).map((row) => row.name_en),
    );
    const taught = new Set(lines.map((line) => line.split(' | ')[4] ?? ''));
    for (const subject of gradedSubjects) {
      if (taught.has(subject)) expect(subjectsWithNumber, subject).toContain(subject);
    }
    expect(subjectsWithNumber.size).toBeGreaterThan(0);

    if (process.env.PIN_DEMO_RESULTS === 'write') {
      writeFileSync(EXPECTED, `${JSON.stringify(lines, null, 1)}\n`);
    }
    const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')) as string[];
    expect(lines).toEqual(expected);
  });
});
