import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch, setEditDays } from '../../testing/branch-filter-sql.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';

/** Wednesday 14 October 2026, a day of quarter 1 (1 September to 31 October). */
const DAY = '2026-10-14';
/** Monday 26 October: its lesson is still inside the 7 edit days at the close. */
const LATE_DAY = '2026-10-26';
/** Monday 9 November, the first day of quarter 2. */
const NEXT_DAY = '2026-11-09';
/** The close: Saturday 31 October 2026, the last day of quarter 1, 18:00 in Tashkent. */
const CLOSE = '2026-10-31T18:00:00+05:00';
const BEFORE = '2026-10-15T10:00:00+05:00';
const AFTER = '2026-11-10T10:00:00+05:00';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

const CLOSED = { code: CHECK_VIOLATION, constraint: 'quarters_closed' };

// Closing a quarter in the database (db/migrations/0133; task 9.2b, pull request #230).
// 07, Editing rules and locks: "Journals of that quarter become read only and the results are
// stored as final"; edge/journal, Closing and reopening; edge/developer-rules, Calculation.
// Every write is made as `sodiq_app` through the branch filter at the moment given, unless it
// says the migrator. Each test closes quarter 1 of a branch of its own. All names are invented.
describe('closing a quarter in the database', () => {
  let database: TestDatabase;
  let cells: CellsKit;
  let account: string;
  let vice: string;

  const inBranch = <T>(
    branch: string,
    moment: string,
    work: (transaction: Transaction) => Promise<T>,
  ): Promise<T> =>
    new Transactions(database.app, new FixedClock(moment)).run([branch], async (transaction) => {
      await transaction
        .insertInto('audit_log')
        .values({ occurred_at: new Date(moment), branch_id: branch, action: 'test.close' })
        .execute();
      return work(transaction);
    });

  const setting = (transaction: Transaction, name: string, value: string) =>
    sql`select set_config(${name}, ${value}, true)`.execute(transaction);

  /** A branch with its year, a class of one student, and lessons on DAY, LATE_DAY and NEXT_DAY. */
  let branches = 0;
  async function scene() {
    branches += 1;
    const branch = await insertBranch(database.migrator, `Closing ${String(branches)}`);
    await setEditDays(database.migrator, branch, 7);
    const { year, quarters } = await cells.lessons.year(branch);
    await cells.lessons.load.classes.role(vice, branch, 'academic_vice_principal');
    const classId = await cells.lessons.load.classes.schoolClass(branch, year, { grade: 7 });
    const [student] = await cells.lessons.pupils(branch, classId, 1);
    return {
      branch,
      year,
      first: quarters[0] ?? '',
      second: quarters[1] ?? '',
      classId,
      student: student ?? '',
      lesson: await cells.lesson(branch, year, classId, DAY),
      late: await cells.lesson(branch, year, classId, LATE_DAY),
      next: await cells.lesson(branch, year, classId, NEXT_DAY),
    };
  }

  /** A close of the quarter written as the close writes it. */
  const close = (branch: string, quarter: string, moment = CLOSE) =>
    inBranch(branch, moment, (transaction) =>
      transaction
        .insertInto('quarter_closings')
        .values({
          branch_id: branch,
          quarter_id: quarter,
          version: 0,
          closed_at: new Date(0),
          closed_by: vice,
          lock_now: false,
          start_quarter: null,
          warnings: JSON.stringify([]),
        })
        .returning(['id', 'version', 'closed_at'])
        .executeTakeFirstOrThrow(),
    );

  /** An attendance cell written as the application at a moment. */
  const mark = (
    branch: string,
    moment: string,
    input: { lesson: string; student: string },
    options: { how?: string; reason?: string; by?: string } = {},
  ) =>
    inBranch(branch, moment, async (transaction) => {
      if (options.reason !== undefined) {
        await setting(transaction, 'app.correction_reason', options.reason);
      }
      return transaction
        .insertInto('journal_cells')
        .values({
          branch_id: branch,
          lesson_id: input.lesson,
          student_id: input.student,
          mark: 1,
          version: 1,
          changed_by: options.by ?? account,
          changed_how: options.how ?? 'entry',
          changed_at: new Date(0),
        })
        .returning(['id', 'changed_how'])
        .executeTakeFirstOrThrow();
    });

  const lockOf = async (lessonId: string) =>
    (
      await sql<{
        lock: Date | null;
      }>`select journal_lesson_lock(${lessonId}::uuid) as lock`.execute(database.migrator)
    ).rows[0]?.lock ?? null;

  beforeAll(async () => {
    database = await createTestDatabase();
    cells = await CellsKit.create(database.migrator);
    account = await cells.lessons.load.classes.account();
    vice = await cells.lessons.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the closings', () => {
    it('write the moment of the transaction and number the closes of a quarter from 1', async () => {
      const { branch, first } = await scene();
      const row = await close(branch, first);
      expect(row.version).toBe(1);
      expect(row.closed_at).toEqual(new Date(CLOSE));
    });

    it('refuse a second close while one is in force, and number the close after a reopening 2', async () => {
      const { branch, first } = await scene();
      await close(branch, first);
      expect(await refusal(close(branch, first))).toMatchObject(CLOSED);
      // 9.2c writes the reopening; here the migrator stands in for it.
      await database.migrator
        .updateTable('quarter_closings')
        .set({ reopened_at: new Date('2026-11-02T09:00:00+05:00') })
        .where('quarter_id', '=', first)
        .execute();
      const again = await close(branch, first, '2026-11-04T09:00:00+05:00');
      expect(again.version).toBe(2);
    });

    it('are never changed or removed by the application', async () => {
      const { branch, first } = await scene();
      const { id } = await close(branch, first);
      const changed = await refusal(
        inBranch(branch, AFTER, (transaction) =>
          transaction
            .updateTable('quarter_closings')
            .set({ lock_now: true })
            .where('id', '=', id)
            .execute(),
        ),
      );
      expect(changed.code).toBe(INSUFFICIENT_PRIVILEGE);
      const removed = await refusal(
        inBranch(branch, AFTER, (transaction) =>
          transaction.deleteFrom('quarter_closings').where('id', '=', id).execute(),
        ),
      );
      expect(removed.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it('refuse a close in a closed year', async () => {
      const { branch, first, year } = await scene();
      await database.migrator
        .updateTable('academic_years')
        .set({ status: 'closed' })
        .where('id', '=', year)
        .execute();
      expect(await refusal(close(branch, first))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'academic_years_closed',
      });
    });

    it('keep the names of each journal with the closing', async () => {
      const { branch, first, year, classId } = await scene();
      const { id } = await close(branch, first);
      const journal = await database.migrator
        .insertInto('journals')
        .values({
          branch_id: branch,
          academic_year_id: year,
          class_id: classId,
          subject_id: cells.subject,
          runs: sql`'{[2026-09-01,)}'::datemultirange`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await inBranch(branch, AFTER, (transaction) =>
        transaction
          .insertInto('quarter_closing_journals')
          .values({
            branch_id: branch,
            closing_id: id,
            journal_id: journal.id,
            unit_name: '7 Oxford',
            subject_names: JSON.stringify({ uz: 'Fizika', ru: 'Физика', en: 'Physics' }),
            teacher_name: 'Dilnoza Karimova',
          })
          .execute(),
      );
      const changed = await refusal(
        inBranch(branch, AFTER, (transaction) =>
          transaction
            .updateTable('quarter_closing_journals')
            .set({ unit_name: '7 Cambridge' })
            .where('closing_id', '=', id)
            .execute(),
        ),
      );
      expect(changed.code).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  describe('the final results', () => {
    const record = { format: 1, kind: 'closing', moduleVersion: 1, inputs: {}, outcome: {} };

    async function stored() {
      const scenes = await scene();
      // Before the close: a student active from 1 September writes a status in quarter 1.
      const other = await cells.lessons.members.student(scenes.branch);
      const { id } = await close(scenes.branch, scenes.first);
      const journal = await database.migrator
        .insertInto('journals')
        .values({
          branch_id: scenes.branch,
          academic_year_id: scenes.year,
          class_id: scenes.classId,
          subject_id: cells.subject,
          runs: sql`'{[2026-09-01,)}'::datemultirange`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const row = await inBranch(scenes.branch, AFTER, (transaction) =>
        transaction
          .insertInto('quarter_final_results')
          .values({
            branch_id: scenes.branch,
            closing_id: id,
            quarter_id: scenes.first,
            subject_id: cells.subject,
            student_id: scenes.student,
            journal_id: journal.id,
            kind: 'closing',
            record: JSON.stringify(record),
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
      return { ...scenes, id: row.id, closing: id, journal: journal.id, other };
    }

    it('are never changed or removed by the application', async () => {
      const { branch, id } = await stored();
      const changed = await refusal(
        inBranch(branch, AFTER, (transaction) =>
          transaction
            .updateTable('quarter_final_results')
            .set({ record: JSON.stringify({ ...record, moduleVersion: 2 }) })
            .where('id', '=', id)
            .execute(),
        ),
      );
      expect(changed.code).toBe(INSUFFICIENT_PRIVILEGE);
      const removed = await refusal(
        inBranch(branch, AFTER, (transaction) =>
          transaction.deleteFrom('quarter_final_results').where('id', '=', id).execute(),
        ),
      );
      expect(removed.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it('move to another student only by the carry of a merge', async () => {
      const { branch, id, other } = await stored();
      const moved = await refusal(
        inBranch(branch, AFTER, (transaction) =>
          transaction
            .updateTable('quarter_final_results')
            .set({ student_id: other })
            .where('id', '=', id)
            .execute(),
        ),
      );
      expect(moved).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_merge_carry' });
    });

    it('refuse a record whose kind is not the column', async () => {
      const { branch, closing, first, journal, other } = await stored();
      const wrong = await refusal(
        inBranch(branch, AFTER, (transaction) =>
          transaction
            .insertInto('quarter_final_results')
            .values({
              branch_id: branch,
              closing_id: closing,
              quarter_id: first,
              subject_id: cells.subject,
              student_id: other,
              journal_id: journal,
              kind: 'closing',
              record: JSON.stringify({ ...record, kind: 'at_leaving' }),
            })
            .execute(),
        ),
      );
      expect(wrong).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'quarter_final_results_record_check',
      });
    });
  });

  // Plan decision 3 (Look first), review correction 4: "lock now and close" locks the lessons
  // still inside their edit period from the stored moment of the close, the first close.
  describe('the lock moment', () => {
    it('is no later than the first close of the quarter that holds the lesson', async () => {
      const { branch, first, late, next } = await scene();
      expect(await lockOf(late)).toEqual(new Date('2026-11-03T00:00:00+05:00'));
      await close(branch, first);
      expect(await lockOf(late)).toEqual(new Date(CLOSE));
      // A lesson of the next quarter keeps its own lock.
      expect(await lockOf(next)).toEqual(new Date('2026-11-17T00:00:00+05:00'));
    });

    it('stays at the first close after a reopening and a second close', async () => {
      const { branch, first, late } = await scene();
      await close(branch, first);
      await database.migrator
        .updateTable('quarter_closings')
        .set({ reopened_at: new Date('2026-11-02T09:00:00+05:00') })
        .where('quarter_id', '=', first)
        .execute();
      // Reopened: the lesson stays locked at the first close (edge/journal, "Lessons stay locked").
      expect(await lockOf(late)).toEqual(new Date(CLOSE));
      await close(branch, first, '2026-11-04T09:00:00+05:00');
      expect(await lockOf(late)).toEqual(new Date(CLOSE));
    });
  });

  // From 8.4: every person's write of a closed quarter is refused, a correction included.
  describe('the journal', () => {
    it('refuses an entry and a correction on a lesson of the closed quarter', async () => {
      const { branch, first, lesson, late, student } = await scene();
      await close(branch, first);
      expect(await refusal(mark(branch, AFTER, { lesson, student }))).toMatchObject(CLOSED);
      // Before its own lock, at the moment of the close (lock now).
      expect(
        await refusal(mark(branch, '2026-10-31T18:30:00+05:00', { lesson: late, student })),
      ).toMatchObject(CLOSED);
      expect(
        await refusal(
          mark(branch, AFTER, { lesson, student }, { reason: 'Typed in the wrong row', by: vice }),
        ),
      ).toMatchObject(CLOSED);
    });

    // edge/system-behaviour: the moments 23:59 and 00:00 for quarter end.
    it('refuses a save on the last day of the closed quarter at 23:59 and takes one on the next quarter', async () => {
      const { branch, first, year, classId, student } = await scene();
      const last = await cells.lesson(branch, year, classId, '2026-10-31');
      const opening = await cells.lesson(branch, year, classId, NEXT_DAY);
      await close(branch, first);
      expect(
        await refusal(mark(branch, '2026-10-31T23:59:00+05:00', { lesson: last, student })),
      ).toMatchObject(CLOSED);
      const saved = await mark(branch, '2026-11-09T23:59:00+05:00', { lesson: opening, student });
      expect(saved.changed_how).toBe('entry');
    });

    it('takes an entry on a lesson of the next quarter', async () => {
      const { branch, first, next, student } = await scene();
      await close(branch, first);
      const saved = await mark(branch, AFTER, { lesson: next, student });
      expect(saved.changed_how).toBe('entry');
    });

    it('refuses a work, a comment and the delete of a work of the closed quarter', async () => {
      const { branch, first, lesson, student } = await scene();
      const work = () =>
        inBranch(branch, BEFORE, (transaction) =>
          transaction
            .insertInto('journal_works')
            .values({
              branch_id: branch,
              lesson_id: lesson,
              source_lesson_id: lesson,
              kind: 'classwork',
              changed_by: account,
              changed_how: 'entry',
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
        );
      const kept = await work();
      await close(branch, first);
      expect(await refusal(work())).toMatchObject(CLOSED);
      expect(
        await refusal(
          inBranch(branch, AFTER, (transaction) =>
            transaction
              .insertInto('journal_comments')
              .values({
                branch_id: branch,
                student_id: student,
                target: 'note',
                lesson_id: lesson,
                body: 'Worked well in pairs',
                visibility: 'staff',
                version: 1,
                changed_by: account,
                changed_how: 'entry',
                changed_at: new Date(0),
              })
              .execute(),
          ),
        ),
      ).toMatchObject(CLOSED);
      // The delete of a work goes through the judge as `deleted`.
      expect(
        await refusal(
          inBranch(branch, AFTER, (transaction) =>
            transaction.deleteFrom('journal_works').where('id', '=', kept.id).execute(),
          ),
        ),
      ).toMatchObject(CLOSED);
    });

    // Review must-fix 1: the early returns of the cell guard.
    it('refuses a cell an exemption reopened, after the close', async () => {
      const { branch, first, year, lesson, student } = await scene();
      await inBranch(branch, BEFORE, async (transaction) => {
        const exemption = await transaction
          .insertInto('exemptions')
          .values({
            branch_id: branch,
            student_id: student,
            year_id: year,
            batch_id: '019a0000-0000-7000-8000-000000000009',
            kind: 'temporary',
            all_subjects: true,
            start_date: '2026-10-20',
            end_date: '2026-10-21',
            category: 'illness',
            detail: 'A certificate from the clinic',
            granted_by: vice,
            granted_at: new Date(0),
            version: 0,
            changed_at: new Date(0),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('exemption_reopened_cells')
          .values({
            branch_id: branch,
            exemption_id: exemption.id,
            lesson_id: lesson,
            student_id: student,
            reopened_at: new Date(BEFORE),
            open_until: new Date('2026-11-30T00:00:00+05:00'),
          })
          .execute();
      });
      // Open for that cell after the lock, before the close.
      const reopened = await mark(branch, '2026-10-23T10:00:00+05:00', { lesson, student });
      expect(reopened.changed_how).toBe('late_entry');
      await close(branch, first);
      expect(
        await refusal(
          inBranch(branch, AFTER, (transaction) =>
            transaction
              .updateTable('journal_cells')
              .set({ mark: 2, changed_by: account, changed_how: 'entry' })
              .where('id', '=', reopened.id)
              .execute(),
          ),
        ),
      ).toMatchObject(CLOSED);
    });

    it('refuses an optional cell after the close', async () => {
      const { branch, first, lesson, student } = await scene();
      const status = (
        await database.migrator
          .selectFrom('student_statuses')
          .select('id')
          .where('student_id', '=', student)
          .executeTakeFirstOrThrow()
      ).id;
      await inBranch(branch, BEFORE, (transaction) =>
        transaction
          .insertInto('journal_optional_cells')
          .values({
            branch_id: branch,
            lesson_id: lesson,
            student_id: student,
            open_until: new Date('2026-11-30T00:00:00+05:00'),
            opened_at: new Date(BEFORE),
            return_status_id: status,
          })
          .execute(),
      );
      const optional = await mark(branch, '2026-10-23T10:00:00+05:00', { lesson, student });
      expect(optional.changed_how).toBe('late_entry');
      await close(branch, first);
      expect(
        await refusal(
          inBranch(branch, AFTER, (transaction) =>
            transaction
              .updateTable('journal_cells')
              .set({ mark: 2, changed_by: account, changed_how: 'entry' })
              .where('id', '=', optional.id)
              .execute(),
          ),
        ),
      ).toMatchObject(CLOSED);
    });

    it('refuses a rating entry, the corrector\'s "exempt" and a change of the exam date', async () => {
      const { branch, first, year, classId, student } = await scene();
      const rated = await cells.lessons.load.classes.subject({ grades: [7] });
      await database.migrator
        .updateTable('subjects')
        .set({ rating_exam: true })
        .where('id', '=', rated)
        .execute();
      const journal = await database.migrator
        .insertInto('journals')
        .values({
          branch_id: branch,
          academic_year_id: year,
          class_id: classId,
          subject_id: rated,
          runs: sql`'{[2026-09-01,)}'::datemultirange`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const exam = await inBranch(branch, BEFORE, (transaction) =>
        transaction
          .insertInto('journal_rating_exams')
          .values({
            branch_id: branch,
            journal_id: journal.id,
            quarter_id: first,
            exam_date: DAY,
            version: 1,
            changed_by: account,
            changed_at: new Date(0),
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
      await close(branch, first);
      const entry = (kind: string | null, score: number | null, by: string) =>
        inBranch(branch, AFTER, (transaction) =>
          transaction
            .insertInto('journal_rating_entries')
            .values({
              branch_id: branch,
              rating_exam_id: exam.id,
              student_id: student,
              kind,
              score,
              reason: null,
              version: 1,
              changed_by: by,
              changed_how: 'entry',
              changed_at: new Date(0),
            })
            .execute(),
        );
      expect(await refusal(entry('score', 70, account))).toMatchObject(CLOSED);
      expect(await refusal(entry('exempt', null, vice))).toMatchObject(CLOSED);
      expect(
        await refusal(
          inBranch(branch, AFTER, (transaction) =>
            transaction
              .updateTable('journal_rating_exams')
              .set({ exam_date: '2026-10-15', changed_by: vice })
              .where('id', '=', exam.id)
              .execute(),
          ),
        ),
      ).toMatchObject(CLOSED);
    });

    it('refuses an unlock request, and its approval, in the closed quarter', async () => {
      const { branch, first, lesson } = await scene();
      const teacher = await cells.lessons.load.classes.person(branch, ['uz']);
      const request = () =>
        inBranch(branch, '2026-10-30T10:00:00+05:00', (transaction) =>
          transaction
            .insertInto('journal_unlocks')
            .values({
              branch_id: branch,
              target: 'lesson',
              lesson_id: lesson,
              staff_id: teacher.staffId,
              requested_by: teacher.accountId,
              reason: 'I was ill that week',
              requested_at: new Date(0),
              status: 'sent',
              version: 1,
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
        );
      const waiting = await request();
      await close(branch, first);
      expect(
        await refusal(
          inBranch(branch, AFTER, (transaction) =>
            transaction
              .updateTable('journal_unlocks')
              .set({ status: 'approved', days: 2, decided_by: vice })
              .where('id', '=', waiting.id)
              .execute(),
          ),
        ),
      ).toMatchObject(CLOSED);
      // A refusal of it stays possible.
      await inBranch(branch, AFTER, (transaction) =>
        transaction
          .updateTable('journal_unlocks')
          .set({ status: 'refused', decided_by: vice, refuse_reason: 'The quarter is closed' })
          .where('id', '=', waiting.id)
          .execute(),
      );
      expect(
        await refusal(
          inBranch(branch, AFTER, (transaction) =>
            transaction
              .insertInto('journal_unlocks')
              .values({
                branch_id: branch,
                target: 'lesson',
                lesson_id: lesson,
                staff_id: teacher.staffId,
                requested_by: teacher.accountId,
                reason: 'I was ill that week',
                requested_at: new Date(0),
                status: 'sent',
                version: 1,
              })
              .execute(),
          ),
        ),
      ).toMatchObject(CLOSED);
    });
  });

  describe('the other records of the quarter', () => {
    // From 6.3: "The class Tutor and the Academic Vice Principal can edit it until the quarter
    // closes."
    it('refuses a reason of absence dated in the closed quarter, and takes one after it', async () => {
      const { branch, first, student } = await scene();
      const reason = (date: string) =>
        inBranch(branch, AFTER, (transaction) =>
          transaction
            .insertInto('student_absence_reasons')
            .values({
              branch_id: branch,
              student_id: student,
              absence_date: date,
              category: 'illness',
              note: '',
              changed_by: vice,
              changed_at: new Date(0),
            })
            .execute(),
        );
      await close(branch, first);
      expect(await refusal(reason(DAY))).toMatchObject(CLOSED);
      await reason(NEXT_DAY);
    });

    it('refuses a decision and a quarterly distribution of the closed quarter', async () => {
      const { branch, first, student } = await scene();
      await close(branch, first);
      expect(
        await refusal(
          inBranch(branch, AFTER, (transaction) =>
            transaction
              .insertInto('quarter_result_decisions')
              .values({
                branch_id: branch,
                quarter_id: first,
                subject_id: cells.subject,
                student_id: student,
                decision: 'keep',
                decided_by: vice,
                decided_at: new Date(0),
              })
              .execute(),
          ),
        ),
      ).toMatchObject(CLOSED);
      expect(
        await refusal(
          database.migrator
            .insertInto('subject_quarter_weights')
            .values({
              branch_id: branch,
              subject_id: cells.subject,
              quarter_id: first,
              attendance: 20,
              classwork: 40,
              homework: 40,
              rating_exam: null,
            })
            .execute(),
        ),
      ).toMatchObject(CLOSED);
    });

    // From 1.6 and 5.6b-5a; plan decision 9.
    it('freezes the late and skipped values and the dates of a closed quarter, also after a reopening', async () => {
      const { branch, first } = await scene();
      await close(branch, first);
      const change = (values: Record<string, unknown>) =>
        refusal(
          inBranch(branch, AFTER, (transaction) =>
            transaction.updateTable('quarters').set(values).where('id', '=', first).execute(),
          ),
        );
      expect(await change({ late_value: 75 })).toMatchObject(CLOSED);
      expect(await change({ end_date: '2026-10-30' })).toMatchObject(CLOSED);
      await database.migrator
        .updateTable('quarter_closings')
        .set({ reopened_at: new Date('2026-11-02T09:00:00+05:00') })
        .where('quarter_id', '=', first)
        .execute();
      expect(await change({ skipped_value: 10 })).toMatchObject(CLOSED);
    });

    // From 3.3a; plan decision 12.
    it('refuses a membership changed on a day of the closed quarter, and takes a cut after it', async () => {
      const { branch, first, student } = await scene();
      await close(branch, first);
      const cut = (db: Pick<Transaction, 'updateTable'>, until: string, leaving: string) =>
        db
          .updateTable('class_memberships')
          .set({ valid_until: until, ended_by: 'leaving', leaving_id: leaving })
          .where('student_id', '=', student)
          .execute();
      // A leaving after the closed quarter, as its service writes it (the migrator: the guard
      // of the closed quarter only).
      const leaving = await database.migrator.transaction().execute(async (transaction) => {
        const id = await cells.lessons.members.leaving(transaction, branch, student, '2026-11-20');
        await cut(transaction, '2026-11-20', id);
        return id;
      });
      expect(
        await refusal(
          inBranch(branch, AFTER, (transaction) => cut(transaction, '2026-10-20', leaving)),
        ),
      ).toMatchObject(CLOSED);
    });

    // From 2.4b-1: "A date in a closed quarter is refused", for the migrator too.
    it('refuses a leaving dated in the closed quarter', async () => {
      const { branch, first, student } = await scene();
      await close(branch, first);
      expect(
        await refusal(
          cells.lessons.members.leaving(database.migrator, branch, student, '2026-10-20'),
        ),
      ).toMatchObject(CLOSED);
    });

    // From 8.5: "The part inside a closed quarter is refused until that quarter is reopened".
    it('refuses an exemption that reaches the closed quarter, and takes one after it', async () => {
      const { branch, first, year, student } = await scene();
      await close(branch, first);
      const add = (from: string, until: string) =>
        inBranch(branch, AFTER, (transaction) =>
          transaction
            .insertInto('exemptions')
            .values({
              branch_id: branch,
              student_id: student,
              year_id: year,
              batch_id: '019a0000-0000-7000-8000-000000000010',
              kind: 'temporary',
              all_subjects: true,
              start_date: from,
              end_date: until,
              category: 'illness',
              detail: 'A certificate from the clinic',
              granted_by: vice,
              granted_at: new Date(0),
              version: 0,
              changed_at: new Date(0),
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
        );
      expect(await refusal(add('2026-10-28', '2026-11-10'))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'exemption_closed_quarter',
      });
      const { id } = await add('2026-11-09', '2026-11-12');
      // Its end moved inside the open quarter is taken.
      await inBranch(branch, AFTER, (transaction) =>
        transaction
          .updateTable('exemptions')
          .set({ end_date: '2026-11-11', end_cause: 'end' })
          .where('id', '=', id)
          .execute(),
      );
    });
  });
});
