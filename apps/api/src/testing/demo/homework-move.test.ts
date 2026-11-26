import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../create-test-app.js';
import { FixedClock } from '../fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../test-database.js';
import { SETUP_MOMENT } from './data.js';
import { fillJournals } from './journal.js';
import { SignIns } from './people.js';
import { studentResultLines } from './result-lines.js';
import { buildDemoSchool, type DemoSchool } from './school.js';

const MOVE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../db/migrations/0186_homework_at_its_lesson.sql',
);

const PASSWORD = 'demo-homework-move-password-1';
/** A Friday of quarter 1, three weeks into the year: the journals are filled up to the day before. */
const TODAY = '2026-09-25';
/** The moment of the reads and of the move: quarter 2 has begun, so both quarters have results. */
const READ_AT = '2026-11-14T18:00:00+05:00';

/** The move itself: the `do` block of 0186, as the migration runs it. */
async function moveBlock(): Promise<string> {
  const text = await readFile(MOVE, 'utf8');
  const start = text.indexOf('\ndo $$\n');
  const end = text.indexOf('\nend\n$$;\n', start);
  if (start < 0 || end < 0) throw new Error('0186 has no move block.');
  return text.slice(start + 1, end + '\nend\n$$;'.length);
}

// Task 11.24, Done when: "a test computes every quarter result of the demo school before and
// after the move and finds them the same except where a homework crossed a quarter boundary".
// Within a quarter each work counts equally whatever lesson holds it (`07`, rule 6), so moving
// a homework from the lesson that checked it back to the lesson where it was given changes no
// figure; homework given at the last lesson of a quarter and checked in the next one moves into
// its own quarter (`07`, Closing a quarter: "Homework given at the last lesson of the quarter
// belongs to that quarter").
//
// The demo school is built and filled through the real application, which since 11.24 writes
// each homework at the lesson where it was given. The old placement is then made back as a
// fixture: each homework row is moved to the lesson that checked it under the rule before 0186
// (the next lesson of its journal that is not cancelled), its cells and comments following by
// cascade. That is a write no code can make any more: 0186 fixes a work's lesson
// (journal_work_fixed, journal_works_at_source) and a cell's (journal_cell_lesson_fixed), so the
// fixture lifts the check and the user triggers of the three tables for its own statements and
// puts them back; the shape it leaves is the one the code before 0186 left (a homework row at
// the check lesson, its source the lesson where it was given, its cells at the check lesson).
// One homework is added at the last lesson of quarter 1 of one journal, stored with a number at
// the journal's first lesson of quarter 2. The results are read, the move block of 0186 runs
// as the migration runs it, and the results read again. The demo is not the same from run to
// run (quarter-results.test.ts), so the comparison is made on one database. Names are invented.
describe('the quarter results of the demo school across the homework move', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clock: FixedClock;
  let school: DemoSchool;
  let crafted: { student: string; uid: string; subject: string; work: string };
  let original: string[];
  let before: string[];
  let after: string[];
  let moved: number;

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
    const migrator = database.migrator;
    // No lesson of the demo is locked at the move (the owner: none is on the live system); the
    // demo keeps 7 edit days, which would lock every lesson of September by November.
    await migrator.updateTable('branch_edit_days').set({ edit_days: 3650 }).execute();

    clock.set(READ_AT);
    await new SignIns(app, clock, PASSWORD).again(school.superAdmin);
    original = await studentResultLines(migrator, school);

    // The crafted homework: a class journal of a graded subject with a lesson on each side of
    // the boundary, and a student of the class.
    const pair = await sql<{
      journal: string;
      subject: string;
      last: string;
      first: string;
      branch: string;
    }>`
      with journal_lessons as (
        select lesson_journal(l.id) as journal, l.id, l.lesson_date, l.starts_at, l.subject_id,
          l.branch_id, l.class_id
        from lessons l
        join subjects s on s.id = l.subject_id
        where l.cancel_cause is null and l.class_id is not null and s.journal_type = 'graded'
      )
      select a.journal, a.subject_id as subject, a.branch_id as branch,
        (select x.id from journal_lessons x where x.journal = a.journal
          and x.lesson_date <= '2026-10-31' order by x.starts_at desc limit 1) as last,
        (select x.id from journal_lessons x where x.journal = a.journal
          and x.lesson_date >= '2026-11-09' and x.starts_at < ${new Date(READ_AT)}
          order by x.starts_at limit 1) as first
      from journal_lessons a
      group by a.journal, a.subject_id, a.branch_id
      having bool_or(a.lesson_date <= '2026-10-31')
        and bool_or(a.lesson_date >= '2026-11-09' and a.starts_at < ${new Date(READ_AT)})
      order by a.journal
      limit 1
    `.execute(migrator);
    const found = pair.rows[0];
    if (found === undefined)
      throw new Error('No journal with a lesson on each side of the boundary.');
    const member = await migrator
      .selectFrom('lessons')
      .innerJoin('class_memberships', 'class_memberships.class_id', 'lessons.class_id')
      .innerJoin('students', 'students.id', 'class_memberships.student_id')
      .select(['students.id', 'students.uid'])
      .where('lessons.id', '=', found.first)
      .where('class_memberships.valid_from', '<=', '2026-10-01')
      .orderBy('students.uid')
      .executeTakeFirstOrThrow();

    // The old placement, as a fixture (above).
    await migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${new Date(READ_AT).toISOString()}, true)`.execute(
        transaction,
      );
      await sql`alter table journal_works drop constraint journal_works_at_source`.execute(
        transaction,
      );
      for (const table of ['journal_works', 'journal_cells', 'journal_comments']) {
        await sql`alter table ${sql.table(table)} disable trigger user`.execute(transaction);
      }
      const placed = await sql<{ id: string }>`
        with next_lessons as (
          select w.id as work_id, (
            select n.id from lessons n
            where lesson_journal(n.id) = lesson_journal(l.id)
              and n.cancel_cause is null
              and (n.starts_at, n.id) > (l.starts_at, l.id)
            order by n.starts_at, n.id
            limit 1
          ) as next_id
          from journal_works w
          join lessons l on l.id = w.source_lesson_id
          where w.kind = 'homework' and w.lesson_id = w.source_lesson_id
        )
        update journal_works w set lesson_id = x.next_id
        from next_lessons x
        where w.id = x.work_id and x.next_id is not null
        returning w.id
      `.execute(transaction);
      moved = placed.rows.length;
      const work = await transaction
        .insertInto('journal_works')
        .values({
          branch_id: found.branch,
          lesson_id: found.first,
          source_lesson_id: found.last,
          kind: 'homework',
          position: 10,
          title: 'Holiday reading',
          total: 10,
          // Task 11.25a: written with the user triggers off, so the mirror of 0188 does not fill
          // the exact twin; it is written as the fill of 0188 leaves it.
          total_exact: 10,
          changed_how: 'entry',
          version: 1,
          changed_at: new Date(READ_AT),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('journal_cells')
        .values({
          branch_id: found.branch,
          lesson_id: found.first,
          student_id: member.id,
          work_id: work.id,
          score: 1,
          score_exact: 1,
          version: 1,
          changed_by: school.superAdmin.accountId,
          changed_how: 'entry',
          changed_at: new Date(READ_AT),
        })
        .execute();
      for (const table of ['journal_works', 'journal_cells', 'journal_comments']) {
        await sql`alter table ${sql.table(table)} enable trigger user`.execute(transaction);
      }
      crafted = {
        student: member.id,
        uid: member.uid ?? member.id,
        subject: found.subject,
        work: work.id,
      };
    });
    before = await studentResultLines(migrator, school);

    const block = await moveBlock();
    await migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${new Date(READ_AT).toISOString()}, true)`.execute(
        transaction,
      );
      await sql.raw(block).execute(transaction);
      await sql`
        alter table journal_works add constraint journal_works_at_source check (
          source_lesson_id is null or lesson_id = source_lesson_id
        )
      `.execute(transaction);
    });
    after = await studentResultLines(migrator, school);
  }, 1_800_000);

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('moved the homework of the demo, with numbers', async () => {
    expect(moved).toBeGreaterThan(0);
    const scored = await database.migrator
      .selectFrom('journal_cells')
      .innerJoin('journal_works', 'journal_works.id', 'journal_cells.work_id')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('journal_works.kind', '=', 'homework')
      .where('journal_cells.score', 'is not', null)
      .executeTakeFirstOrThrow();
    expect(Number(scored.count)).toBeGreaterThan(0);
    const audit = await database.migrator
      .selectFrom('audit_log')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('action', '=', 'journal.homework_move')
      .executeTakeFirstOrThrow();
    expect(Number(audit.count)).toBe(moved + 1);
    const stray = await database.migrator
      .selectFrom('journal_works')
      .select('id')
      .whereRef('lesson_id', '<>', 'source_lesson_id')
      .execute();
    expect(stray).toEqual([]);
  });

  it('finds every quarter result the same after the move, but the homework that crossed the boundary', async () => {
    const subjectName = (
      await database.migrator
        .selectFrom('subjects')
        .select('name_en')
        .where('id', '=', crafted.subject)
        .executeTakeFirstOrThrow()
    ).name_en;
    const crossing = (line: string) => line.includes(` | ${crafted.uid} | ${subjectName} | `);
    expect(after.filter((line) => !crossing(line))).toEqual(
      before.filter((line) => !crossing(line)),
    );
    // Within the crafted student's subject: the number left quarter 2 for quarter 1.
    const of = (lines: string[], quarter: string) =>
      lines.find((line) => crossing(line) && line.includes(` | ${quarter} | `));
    expect(of(before, 'Q1')).toBeDefined();
    expect(of(after, 'Q1')).not.toEqual(of(before, 'Q1'));
    expect(of(after, 'Q2')).not.toEqual(of(before, 'Q2'));
    // And with the crafted homework given at its own lesson from the start, the results are the
    // ones the application gave before the fixture, but for that one homework.
    expect(after.filter((line) => !crossing(line))).toEqual(
      original.filter((line) => !crossing(line)),
    );
  });
});
