import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../database/migrate.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../db/migrations',
);
const RATING_GRADES = '0168_rating_exams_from_grade_two.sql';
/** Thursday 15 October 2026, 10:00 in Tashkent: quarter 1 has started. */
const NOW = '2026-10-15T10:00:00+05:00';

/** A database with every migration before 0168, and the folder its migrations run from. */
async function before0168(prefix: string): Promise<{ database: TestDatabase; directory: string }> {
  const database = await createTestDatabase({ empty: true });
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  for (const name of (await readdir(MIGRATIONS)).filter((one) => one.endsWith('.sql'))) {
    if (name < RATING_GRADES) {
      await copyFile(path.join(MIGRATIONS, name), path.join(directory, name));
    }
  }
  await migrate({ connectionString: database.migrationUrl, directory });
  return { database, directory };
}

/** 0168 run on the database. */
async function run0168(x: { database: TestDatabase; directory: string }): Promise<string[]> {
  await copyFile(path.join(MIGRATIONS, RATING_GRADES), path.join(x.directory, RATING_GRADES));
  return migrate({ connectionString: x.database.migrationUrl, directory: x.directory });
}

/**
 * Data written under 0153 with the rules then: a branch with a dated year, a rating subject of
 * grades 1, 2 and 3, and the helpers that write a journal, its rating exam and an entry.
 */
async function kitOf(database: TestDatabase) {
  const kit = await LessonsKit.create(database.migrator);
  return {
    database,
    kit,
    transactions: new Transactions(database.app, new FixedClock(NOW)),
    account: await kit.load.classes.account(),
  };
}

async function sceneOf(base: Awaited<ReturnType<typeof kitOf>>, name: string) {
  const { database, kit, transactions, account } = base;
  const branch = await insertBranch(database.migrator, name);
  const { year, quarters } = await kit.year(branch);
  const subject = await kit.load.classes.subject({ grades: [0, 1, 2, 3], journalType: 'graded' });
  await database.migrator
    .updateTable('subjects')
    .set({ rating_exam: true })
    .where('id', '=', subject)
    .execute();
  const audited = (transaction: Transaction) =>
    transaction
      .insertInto('audit_log')
      .values({ occurred_at: new Date(NOW), branch_id: branch, action: 'test.rating_grades' })
      .execute();
  /** The quarters' states of 0153, as the change of the setting wrote them. */
  const states = (on: boolean) =>
    database.migrator
      .updateTable('quarter_rating_states')
      .set({ rating_exams_primary: on })
      .where('branch_id', '=', branch)
      .execute();
  const classOf = (grade: number) => kit.load.classes.schoolClass(branch, year, { grade });
  async function journalOf(grade: number) {
    const classId = await classOf(grade);
    const student = await kit.members.student(branch, { startsOn: '2026-09-01', grade });
    await kit.members.member({ branch, classId, studentId: student, from: '2026-09-01' });
    const journal = await database.migrator
      .insertInto('journals')
      .values({
        branch_id: branch,
        academic_year_id: year,
        class_id: classId,
        subject_id: subject,
        runs: sql`'{[2026-09-01,)}'::datemultirange`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { classId, student, journal: journal.id };
  }
  const scoreOf = (journal: { journal: string; student: string }) =>
    transactions.run([branch], async (transaction) => {
      await audited(transaction);
      const exam = await transaction
        .insertInto('journal_rating_exams')
        .values({
          branch_id: branch,
          journal_id: journal.journal,
          quarter_id: quarters[0] ?? '',
          exam_date: '2026-10-12',
          version: 1,
          changed_by: account,
          changed_at: new Date(0),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('journal_rating_entries')
        .values({
          branch_id: branch,
          rating_exam_id: exam.id,
          student_id: journal.student,
          kind: 'score',
          score: 60,
          version: 1,
          changed_by: account,
          changed_how: 'entry',
          changed_at: new Date(0),
        })
        .execute();
    });
  const close = (quarter: string) =>
    transactions.run([branch], async (transaction) => {
      await audited(transaction);
      return (
        await transaction
          .insertInto('quarter_closings')
          .values({
            branch_id: branch,
            quarter_id: quarter,
            version: 1,
            closed_at: new Date(0),
            closed_by: account,
            lock_now: false,
            warnings: sql`'[]'::jsonb`,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    });
  /** The final result a close stored for the student of a journal (its record as data only). */
  const finalResult = (
    closing: string,
    quarter: string,
    journal: { journal: string; student: string },
  ) =>
    database.migrator
      .insertInto('quarter_final_results')
      .values({
        branch_id: branch,
        closing_id: closing,
        quarter_id: quarter,
        subject_id: subject,
        student_id: journal.student,
        journal_id: journal.journal,
        kind: 'closing',
        record: sql`'{"kind": "closing"}'::jsonb`,
      })
      .execute();
  const groupOf = (classIds: string[]) =>
    database.migrator.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto('groups')
        .values({
          branch_id: branch,
          academic_year_id: year,
          subject_id: subject,
          name: 'PE 1-2',
          language: 'uz',
          max_size: 20,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const classId of classIds) {
        await transaction
          .insertInto('group_classes')
          .values({ branch_id: branch, group_id: row.id, class_id: classId })
          .execute();
      }
      return row.id;
    });
  return { branch, quarters, states, classOf, journalOf, scoreOf, close, finalResult, groupOf };
}

/** The rows 0153 wrote and 0168 must leave as they are. */
const keptRows = async (database: TestDatabase) => ({
  setting: await database.migrator.selectFrom('school_settings').selectAll().execute(),
  states: await database.migrator
    .selectFrom('quarter_rating_states')
    .selectAll()
    .orderBy('quarter_id')
    .execute(),
  entries: await database.migrator
    .selectFrom('journal_rating_entries')
    .selectAll()
    .orderBy('id')
    .execute(),
  results: await database.migrator
    .selectFrom('quarter_final_results')
    .selectAll()
    .orderBy('id')
    .execute(),
});

// All names are invented. 0168 (the owner's spec change of 10 November 2026) checks, before it
// changes anything, that no stored data reads differently under the new rule: a rating exam entry
// of a journal of grades 0 and 1, a closed quarter that closed without the rating exam in grades
// 0–4, a group of grades 1 and 2 of a rating subject. It changes no existing row.
describe('migration 0168: rating exams in grades 2–11', () => {
  const opened: { database: TestDatabase; directory: string }[] = [];

  afterAll(async () => {
    for (const one of opened) {
      await one.database.destroy();
      await rm(one.directory, { recursive: true, force: true });
    }
  });

  describe('on data that would read differently', () => {
    let x: { database: TestDatabase; directory: string };

    beforeAll(async () => {
      x = await before0168('sodiq-rating-grades-refused-');
      opened.push(x);
      const base = await kitOf(x.database);
      // (a) A score of a grade 1 journal, written while quarter 1's state was on.
      const a = await sceneOf(base, 'North');
      await a.states(true);
      await a.scoreOf(await a.journalOf(1));
      // (b) Quarter 1 closed with its state off (the default) while a grade 2 journal exists.
      const b = await sceneOf(base, 'South');
      await b.journalOf(2);
      await b.close(b.quarters[0] ?? '');
      // (c) A final result of a grade 1 journal stored by a close of quarter 1.
      const stored = await sceneOf(base, 'West');
      const first = await stored.journalOf(1);
      await stored.finalResult(
        await stored.close(stored.quarters[0] ?? ''),
        stored.quarters[0] ?? '',
        first,
      );
      // (d) A group of grades 0 and 2 of the subject, allowed under 0153.
      const c = await sceneOf(base, 'East');
      await c.groupOf([await c.classOf(0), await c.classOf(2)]);
    }, 240_000);

    it('stops with the count of each, and changes nothing', async () => {
      const before = await keptRows(x.database);
      await expect(run0168(x)).rejects.toThrow(
        /1 rating exam entries in journals of grades 0 and 1, 1 closed quarters without the rating exam in grades 0–4, 1 final results of journals of grades 0 and 1 in closed quarters, 1 groups of grades 0–1 with grades 2–11/,
      );
      const applied = await sql<{ last: number }>`
        select max(number) as last from schema_migrations
      `.execute(x.database.migrator);
      expect(applied.rows[0]?.last).toBe(167);
      expect(await keptRows(x.database)).toEqual(before);
    });
  });

  describe('on data that reads the same', () => {
    let x: { database: TestDatabase; directory: string };
    let s: Awaited<ReturnType<typeof sceneOf>>;

    beforeAll(async () => {
      x = await before0168('sodiq-rating-grades-applied-');
      opened.push(x);
      s = await sceneOf(await kitOf(x.database), 'North');
      // A score of grade 2 under a state on, its quarter closed with the state on (it had the
      // rating exam in grades 2–4 already), and a grade 1 journal with no entry.
      await s.states(true);
      const second = await s.journalOf(2);
      await s.scoreOf(second);
      await s.journalOf(1);
      await s.finalResult(await s.close(s.quarters[0] ?? ''), s.quarters[0] ?? '', second);
    }, 240_000);

    it('applies, keeps every row, and puts the branch behind for the prepared totals', async () => {
      const before = await keptRows(x.database);
      expect(await run0168(x)).toEqual([RATING_GRADES.replace(/\.sql$/, '')]);
      expect(await keptRows(x.database)).toEqual(before);
      const changes = await x.database.migrator
        .selectFrom('report_changes')
        .select(['branch_id', 'quarter_id', 'journal_id'])
        .where('branch_id', '=', s.branch)
        .where('quarter_id', 'is', null)
        .where('journal_id', 'is', null)
        .execute();
      expect(changes.length).toBeGreaterThan(0);
    });
  });
});
