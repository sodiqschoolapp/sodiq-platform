import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Thursday 15 October 2026, 10:00 in Tashkent: quarter 1 has started. */
const NOW = '2026-10-15T10:00:00+05:00';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(
  work: Promise<unknown>,
): Promise<{ code?: string; constraint?: string; message?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string; message?: string };
  }
  throw new Error('The database did not refuse it.');
}

// Rating exams in grades 2–11 in the database (db/migrations/0168; the owner's spec change of
// 10 November 2026). `edge/00-definitions`, Rating journal: "A journal of a rating subject ... in
// grades 2–11. A journal of grades 0 and 1 of a rating subject has no rating exam column"; `05`,
// Group: "a group of grades 1 and 2 in a rating subject is refused". There is no setting. Every
// write of the application is made as `sodiq_app` through the branch filter. All names are
// invented.
describe('rating exams in grades 2–11 in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LessonsKit;
  let account: string;
  const years = new Map<string, { year: string; quarters: string[] }>();

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  const audited = (transaction: Transaction, branch: string) =>
    transaction
      .insertInto('audit_log')
      .values({ occurred_at: new Date(NOW), branch_id: branch, action: 'test.rating_grades' })
      .execute();

  const quarterOf = (branch: string, number: number) =>
    years.get(branch)?.quarters[number - 1] ?? '';
  const yearOf = (branch: string) => years.get(branch)?.year ?? '';

  let branches = 0;
  /** A branch of its own with a dated year. */
  const fresh = async () => {
    branches += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branches)}`);
    years.set(branch, await kit.year(branch));
    return branch;
  };

  /** A graded subject of these grades with the rating exam (or none). */
  const subject = async (grades: readonly number[], rating = true) => {
    const id = await kit.load.classes.subject({ grades, journalType: 'graded' });
    if (rating) {
      await database.migrator
        .updateTable('subjects')
        .set({ rating_exam: true })
        .where('id', '=', id)
        .execute();
    }
    return id;
  };

  const classOf = (branch: string, grade: number) =>
    kit.load.classes.schoolClass(branch, yearOf(branch), { grade });

  /** A class of the grade with one pupil, and its journal of the subject. */
  async function journalOf(branch: string, subjectId: string, grade: number) {
    const classId = await classOf(branch, grade);
    const student = await kit.members.student(branch, { startsOn: '2026-09-01', grade });
    await kit.members.member({ branch, classId, studentId: student, from: '2026-09-01' });
    const journal = await database.migrator
      .insertInto('journals')
      .values({
        branch_id: branch,
        academic_year_id: yearOf(branch),
        class_id: classId,
        subject_id: subjectId,
        runs: sql`'{[2026-09-01,)}'::datemultirange`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { classId, student, journal: journal.id };
  }

  /** A journal of a class with no pupil (a class with members cannot change its grade). */
  async function emptyJournalOf(branch: string, subjectId: string, grade: number) {
    const classId = await classOf(branch, grade);
    await database.migrator
      .insertInto('journals')
      .values({
        branch_id: branch,
        academic_year_id: yearOf(branch),
        class_id: classId,
        subject_id: subjectId,
        runs: sql`'{[2026-09-01,)}'::datemultirange`,
      })
      .execute();
    return classId;
  }

  /** The rating exam row of a journal, as the application writes it. */
  const examRow = (branch: string, journal: string, quarter = quarterOf(branch, 1)) =>
    inBranch(branch, async (transaction) => {
      await audited(transaction, branch);
      return (
        await transaction
          .insertInto('journal_rating_exams')
          .values({
            branch_id: branch,
            journal_id: journal,
            quarter_id: quarter,
            exam_date: '2026-10-12',
            version: 1,
            changed_by: account,
            changed_at: new Date(0),
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    });

  const entry = (branch: string, exam: string, student: string) =>
    inBranch(branch, async (transaction) => {
      await audited(transaction, branch);
      await transaction
        .insertInto('journal_rating_entries')
        .values({
          branch_id: branch,
          rating_exam_id: exam,
          student_id: student,
          kind: 'score',
          score: 60,
          version: 1,
          changed_by: account,
          changed_how: 'entry',
          changed_at: new Date(0),
        })
        .execute();
    });

  const ratingOn = async (journal: string, quarter: string) =>
    (
      await sql<{ on: boolean }>`
        select journal_rating_on(${journal}::uuid, ${quarter}::uuid) as on
      `.execute(database.migrator)
    ).rows[0]?.on;

  /** A group of the subject drawing from the classes, written in one transaction (its rules run at the commit). */
  const group = (branch: string, subjectId: string, classIds: readonly string[]) =>
    database.migrator.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto('groups')
        .values({
          branch_id: branch,
          academic_year_id: yearOf(branch),
          subject_id: subjectId,
          name: `Group ${String(Math.random()).slice(2, 8)}`,
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

  const groupJournal = async (branch: string, groupId: string, subjectId: string) =>
    (
      await database.migrator
        .insertInto('journals')
        .values({
          branch_id: branch,
          academic_year_id: yearOf(branch),
          group_id: groupId,
          subject_id: subjectId,
          runs: sql`'{[2026-09-01,)}'::datemultirange`,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /** A closing of the quarter, as the close writes its row. */
  const closeQuarterOf = (branch: string, quarter: string) =>
    inBranch(branch, async (transaction) => {
      await audited(transaction, branch);
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
        .execute();
    });

  const regrade = (classId: string, grade: number) =>
    database.migrator.updateTable('classes').set({ grade }).where('id', '=', classId).execute();

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = await LessonsKit.create(database.migrator);
    account = await kit.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('gives the rating exam to journals of grades 2 to 11 only, by class and by the classes of a group', async () => {
    const b = await fresh();
    const id = await subject([0, 1, 2, 3, 4, 7, 11]);
    const quarter = quarterOf(b, 1);
    for (const [grade, on] of [
      [0, false],
      [1, false],
      [2, true],
      [4, true],
      [11, true],
    ] as const) {
      const { journal } = await journalOf(b, id, grade);
      expect(await ratingOn(journal, quarter), `grade ${String(grade)}`).toBe(on);
    }
    const lower = await group(b, id, [await classOf(b, 0), await classOf(b, 1)]);
    const upper = await group(b, id, [await classOf(b, 3), await classOf(b, 4)]);
    expect(await ratingOn(await groupJournal(b, lower, id), quarter)).toBe(false);
    expect(await ratingOn(await groupJournal(b, upper, id), quarter)).toBe(true);
    // A subject without the rating exam has none in any grade.
    const plain = await subject([7], false);
    expect(await ratingOn((await journalOf(b, plain, 7)).journal, quarter)).toBe(false);
  });

  it('ignores the setting and the state of a quarter of 0153', async () => {
    const b = await fresh();
    const id = await subject([1, 3]);
    const first = await journalOf(b, id, 1);
    const third = await journalOf(b, id, 3);
    const quarter = quarterOf(b, 1);
    for (const on of [true, false]) {
      await database.migrator
        .updateTable('quarter_rating_states')
        .set({ rating_exams_primary: on })
        .where('quarter_id', '=', quarter)
        .execute();
      expect(await ratingOn(first.journal, quarter)).toBe(false);
      expect(await ratingOn(third.journal, quarter)).toBe(true);
    }
  });

  it('refuses the rating exam of a grade 1 journal and takes one of grade 2 with its entry', async () => {
    const b = await fresh();
    const id = await subject([1, 2]);
    const first = await journalOf(b, id, 1);
    const second = await journalOf(b, id, 2);
    expect((await refusal(examRow(b, first.journal))).constraint).toBe('journal_rating_switch_off');
    const exam = await examRow(b, second.journal);
    await entry(b, exam, second.student);
    const stored = await database.migrator
      .selectFrom('journal_rating_entries')
      .select('score')
      .where('rating_exam_id', '=', exam)
      .executeTakeFirstOrThrow();
    expect(stored.score).toBe(60);
  });

  describe('a group of grades 1 and 2 (`05`, Group)', () => {
    it('is refused for a rating subject on create and on a class added, and allowed otherwise', async () => {
      const b = await fresh();
      const id = await subject([1, 2, 4, 5]);
      const first = await classOf(b, 1);
      const second = await classOf(b, 2);
      expect((await refusal(group(b, id, [first, second]))).message).toContain(
        'groups_rating_grades_span',
      );
      // On a class added to a group of grade 1.
      const one = await group(b, id, [first]);
      expect(
        (
          await refusal(
            database.migrator
              .insertInto('group_classes')
              .values({ branch_id: b, group_id: one, class_id: second })
              .execute(),
          )
        ).message,
      ).toContain('groups_rating_grades_span');
      // Grades 4 and 5 of a rating subject: allowed now.
      await group(b, id, [await classOf(b, 4), await classOf(b, 5)]);
      // Grades 1 and 2 of a subject without the rating exam: allowed.
      const plain = await subject([1, 2], false);
      await group(b, plain, [await classOf(b, 1), await classOf(b, 2)]);
    });

    it('refuses the rating switch turned on while such a group exists', async () => {
      const groupBranch = await fresh();
      const id = await subject([1, 2], false);
      await group(groupBranch, id, [await classOf(groupBranch, 1), await classOf(groupBranch, 2)]);
      // The route test of the subject edit makes it for another branch (`subjects.test.ts`).
      const turnedOn = await refusal(
        database.migrator
          .updateTable('subjects')
          .set({ rating_exam: true })
          .where('id', '=', id)
          .execute(),
      );
      expect(turnedOn.message).toContain('groups_rating_grades_span');
      // A group of grades 2 and 3 refuses nothing.
      const upper = await subject([2, 3], false);
      await group(groupBranch, upper, [
        await classOf(groupBranch, 2),
        await classOf(groupBranch, 3),
      ]);
      await database.migrator
        .updateTable('subjects')
        .set({ rating_exam: true })
        .where('id', '=', upper)
        .execute();
    });
  });

  describe('a class moved across grades 1 and 2', () => {
    it('is refused while its journal of a rating subject holds an entry in an open quarter', async () => {
      const b = await fresh();
      const id = await subject([1, 2]);
      const second = await journalOf(b, id, 2);
      const exam = await examRow(b, second.journal);
      await entry(b, exam, second.student);
      expect((await refusal(regrade(second.classId, 1))).message).toContain(
        'classes_grade_rating_primary',
      );
      // Without an entry the move is made, both ways.
      const empty = await emptyJournalOf(b, id, 2);
      await regrade(empty, 1);
      await regrade(empty, 2);
    });

    it('is refused either way where a quarter of the year has a closing in force', async () => {
      const b = await fresh();
      const id = await subject([1, 2, 3]);
      const second = await emptyJournalOf(b, id, 2);
      const first = await emptyJournalOf(b, id, 1);
      await closeQuarterOf(b, quarterOf(b, 1));
      expect((await refusal(regrade(second, 1))).message).toContain('classes_grade_rating_primary');
      expect((await refusal(regrade(first, 2))).message).toContain('classes_grade_rating_primary');
      // A move that does not cross grades 1 and 2 changes nothing of the rating exam: allowed.
      await regrade(second, 3);
    });
  });

  it('leaves the distribution without the rating exam to read only', async () => {
    const b = await fresh();
    const id = await subject([2]);
    const refused = await refusal(
      inBranch(b, async (transaction) => {
        await audited(transaction, b);
        await transaction
          .insertInto('subject_quarter_primary_weights')
          .values({
            branch_id: b,
            subject_id: id,
            quarter_id: quarterOf(b, 1),
            attendance: 10,
            classwork: 50,
            homework: 40,
            weights_round: 1,
            rating_round: 1,
          })
          .execute();
      }),
    );
    expect(refused.code).toBe('42501');
  });
});
