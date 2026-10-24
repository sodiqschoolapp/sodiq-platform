import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch, setEditDays } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { moveStudentBranch } from '../../testing/members-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';

/** Wednesday 14 October 2026, the date of the lessons; with 7 edit days they lock at 00:00 of 22 October. */
const DAY = '2026-10-14';
const BEFORE = '2026-10-15T10:00:00+05:00';
/** An optional cell opened on 16 October is open until 00:00 of 24 October, branch time. */
const OPENED = '2026-10-16T10:00:00+05:00';
const LAST_MINUTE = '2026-10-23T23:59:59+05:00';
const CLOSED = '2026-10-24T00:00:00+05:00';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// The journal side of transfers and leaving in the database (db/migrations/0127
// and 0128; task 8.6, pull request #224). edge/students-classes-groups: "Entries
// in the old journals on or after the date are listed; he either moves the
// date past them or voids them with a reason ... cells of lessons already held
// open as optional ... can be filled for 7 days"; "Absences and zeros entered
// after it are voided: kept in history". Every write is made as `sodiq_app`
// through the branch filter at the moment of `clock`. All names are invented.
describe('transfers and leaving in the database', () => {
  let database: TestDatabase;
  let clock: FixedClock;
  let transactions: Transactions;
  let kit: LessonsKit;
  let north: string;
  let south: string;
  let year: { year: string; quarters: string[] };
  let subject: string;
  let teacher: { staffId: string; accountId: string };

  const inBranch = <T>(
    branch: string,
    moment: string,
    work: (transaction: Transaction) => Promise<T>,
  ): Promise<T> => {
    clock.set(moment);
    return transactions.run([branch], async (transaction) => {
      await transaction
        .insertInto('audit_log')
        .values({ occurred_at: new Date(moment), branch_id: branch, action: 'test.transfers' })
        .execute();
      return work(transaction);
    });
  };

  let slot = 0;
  /** A lesson of its own block on a date, with the teacher. */
  async function lesson(classId: string, date = DAY): Promise<string> {
    const source = await kit.source(north, year.year, [
      { classId, groupId: null, subjectId: subject },
    ]);
    slot += 1;
    const start = `${String(7 + (slot % 10)).padStart(2, '0')}:00`;
    const end = `${String(7 + (slot % 10)).padStart(2, '0')}:45`;
    return database.migrator.transaction().execute(async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: north,
          academic_year_id: year.year,
          quarter_id: year.quarters[0] ?? '',
          lesson_date: date,
          starts_at: at(date, start),
          ends_at: at(date, end),
          version_id: source.versionId,
          pattern_block_id: source.patternBlockId,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      const row = await transaction
        .insertInto('lessons')
        .values({
          branch_id: north,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: classId,
          subject_id: subject,
          load_row_id: source.lessons[0]?.loadRowId ?? '',
          pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
  }

  /** A class with one student and a lesson of it on DAY. */
  async function scene() {
    const classId = await kit.load.classes.schoolClass(north, year.year, { grade: 7 });
    const [student] = await kit.pupils(north, classId, 1);
    return { classId, student: student ?? '', lesson: await lesson(classId) };
  }

  /** The student's first status row, a row a void or an optional cell can name as its source. */
  const statusOf = async (student: string) =>
    (
      await database.migrator
        .selectFrom('student_statuses')
        .select('id')
        .where('student_id', '=', student)
        .executeTakeFirstOrThrow()
    ).id;

  /** An attendance cell written as the teacher at a moment. */
  const mark = (moment: string, input: { lesson: string; student: string; mark?: number }) =>
    inBranch(north, moment, (transaction) =>
      transaction
        .insertInto('journal_cells')
        .values({
          branch_id: north,
          lesson_id: input.lesson,
          student_id: input.student,
          work_id: null,
          mark: input.mark ?? 1,
          version: 1,
          changed_by: teacher.accountId,
          changed_how: 'entry',
          changed_at: new Date(0),
        })
        .returning(['id', 'changed_how'])
        .executeTakeFirstOrThrow(),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    clock = new FixedClock(BEFORE);
    transactions = new Transactions(database.app, clock);
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    await setEditDays(database.migrator, north, 7);
    year = await kit.year(north);
    subject = await kit.load.classes.subject({ grades: [7] });
    teacher = await kit.load.classes.person(north, ['uz']);
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('journal_voids', () => {
    /** A void row of the cell as the application writes it, with the columns given. */
    const voidRow = (cell: string, student: string, columns: Record<string, string | null>) =>
      inBranch(north, BEFORE, (transaction) =>
        transaction
          .insertInto('journal_voids')
          .values({
            branch_id: north,
            student_id: student,
            cell_id: cell,
            mark: 1,
            version: 2,
            reason: 'Recorded in the old class',
            voided_by: teacher.accountId,
            voided_at: new Date(BEFORE),
            ...columns,
          })
          .execute(),
      );

    it('takes one source, one target and a reason', async () => {
      const { lesson: id, student } = await scene();
      const cell = await mark(BEFORE, { lesson: id, student });
      const status = await statusOf(student);
      await voidRow(cell.id, student, { leaving_id: status });
      await voidRow(cell.id, student, { return_status_id: status });
    });

    it('refuses no source, and two', async () => {
      const { lesson: id, student } = await scene();
      const cell = await mark(BEFORE, { lesson: id, student });
      const status = await statusOf(student);
      const sources: Record<string, string | null>[] = [
        {},
        { leaving_id: status, return_status_id: status },
      ];
      for (const columns of sources) {
        const failed = await refusal(voidRow(cell.id, student, columns));
        expect(failed).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'journal_voids_one_source',
        });
      }
    });

    it('refuses no target, and two', async () => {
      const { lesson: id, student } = await scene();
      const cell = await mark(BEFORE, { lesson: id, student });
      const status = await statusOf(student);
      const none = await refusal(voidRow(cell.id, student, { leaving_id: status, cell_id: null }));
      expect(none).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_voids_one_target' });
      const comment = await inBranch(north, BEFORE, (transaction) =>
        transaction
          .insertInto('journal_comments')
          .values({
            branch_id: north,
            student_id: student,
            target: 'note',
            lesson_id: id,
            body: 'Came without the book',
            visibility: 'staff',
            version: 1,
            changed_by: teacher.accountId,
            changed_how: 'entry',
            changed_at: new Date(0),
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
      const two = await refusal(
        voidRow(cell.id, student, { leaving_id: status, comment_id: comment.id }),
      );
      expect(two).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_voids_one_target' });
    });

    it('takes no reason only for a leaving', async () => {
      const { lesson: id, student } = await scene();
      const cell = await mark(BEFORE, { lesson: id, student });
      const status = await statusOf(student);
      await voidRow(cell.id, student, { leaving_id: status, reason: null });
      const failed = await refusal(
        voidRow(cell.id, student, { return_status_id: status, reason: null }),
      );
      expect(failed).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_voids_reason' });
    });
  });

  describe('the kinds of a void', () => {
    it('writes `leaving` and `transfer` on a cell after its lock, the reason in the history line', async () => {
      const { lesson: id, student } = await scene();
      const cell = await mark(BEFORE, { lesson: id, student });
      for (const [how, version] of [
        ['leaving', 2],
        ['transfer', 3],
      ] as const) {
        await inBranch(north, CLOSED, async (transaction) => {
          await sql`select set_config('app.void_reason', 'Old class', true)`.execute(transaction);
          await transaction
            .updateTable('journal_cells')
            .set({
              mark: how === 'leaving' ? null : 1,
              changed_by: teacher.accountId,
              changed_how: how,
            })
            .where('id', '=', cell.id)
            .execute();
        });
        const line = await database.migrator
          .selectFrom('journal_cell_history')
          .select(['changed_how', 'reason'])
          .where('cell_id', '=', cell.id)
          .where('version', '=', version)
          .executeTakeFirstOrThrow();
        expect(line).toEqual({ changed_how: how, reason: 'Old class' });
      }
    });

    it('clears a comment with `leaving` and `transfer`, its body kept in the history line', async () => {
      const { lesson: id, student } = await scene();
      const comment = await inBranch(north, BEFORE, (transaction) =>
        transaction
          .insertInto('journal_comments')
          .values({
            branch_id: north,
            student_id: student,
            target: 'note',
            lesson_id: id,
            body: 'Came without the book',
            visibility: 'staff',
            version: 1,
            changed_by: teacher.accountId,
            changed_how: 'entry',
            changed_at: new Date(0),
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
      for (const [how, body] of [
        ['transfer', null],
        ['leaving', 'Came without the book'],
      ] as const) {
        await inBranch(north, CLOSED, (transaction) =>
          transaction
            .updateTable('journal_comments')
            .set({ body, changed_by: teacher.accountId, changed_how: how })
            .where('id', '=', comment.id)
            .execute(),
        );
      }
      const lines = await database.migrator
        .selectFrom('journal_comment_history')
        .select(['changed_how', 'body_before', 'body_after'])
        .where('comment_id', '=', comment.id)
        .orderBy('version')
        .execute();
      expect(lines.slice(1)).toEqual([
        { changed_how: 'transfer', body_before: 'Came without the book', body_after: null },
        { changed_how: 'leaving', body_before: null, body_after: 'Came without the book' },
      ]);
    });
  });

  describe('journal_optional_cells', () => {
    const open = (lessonId: string, student: string, source: Record<string, string>) =>
      inBranch(north, OPENED, (transaction) =>
        transaction
          .insertInto('journal_optional_cells')
          .values({
            branch_id: north,
            lesson_id: lessonId,
            student_id: student,
            open_until: new Date(CLOSED),
            opened_at: new Date(OPENED),
            ...source,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      );

    it('refuses no source, and two', async () => {
      const { lesson: id, student } = await scene();
      const status = await statusOf(student);
      // Two: the check refuses before the keys are looked at.
      const sources: Record<string, string>[] = [{}, { return_status_id: status, move_id: status }];
      for (const source of sources) {
        const failed = await refusal(open(id, student, source));
        expect(failed).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'journal_optional_cells_one_source',
        });
      }
    });

    it('takes a write of a locked lesson as a late entry until 23:59:59 of the seventh day, and refuses it at 00:00', async () => {
      const { lesson: id, student } = await scene();
      const status = await statusOf(student);
      await open(id, student, { return_status_id: status });
      const saved = await mark(LAST_MINUTE, { lesson: id, student });
      expect(saved.changed_how).toBe('late_entry');
      const { lesson: second, student: next } = await scene();
      await open(second, next, { return_status_id: await statusOf(next) });
      const failed = await refusal(mark(CLOSED, { lesson: second, student: next }));
      expect(failed).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_locked' });
    });

    it('refuses a write to a withdrawn optional cell', async () => {
      const { lesson: id, student } = await scene();
      const row = await open(id, student, { return_status_id: await statusOf(student) });
      await inBranch(north, OPENED, (transaction) =>
        transaction
          .updateTable('journal_optional_cells')
          .set({ withdrawn_at: new Date(OPENED) })
          .where('id', '=', row.id)
          .execute(),
      );
      const failed = await refusal(mark(LAST_MINUTE, { lesson: id, student }));
      expect(failed).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_locked' });
    });
  });

  describe('the merge carry (0128)', () => {
    it('refuses a change of the student of a cell outside a merge of the transaction', async () => {
      const { lesson: id, student } = await scene();
      const cell = await mark(BEFORE, { lesson: id, student });
      const [other] = await kit.pupils(north, (await scene()).classId, 1);
      const failed = await refusal(
        inBranch(north, BEFORE, (transaction) =>
          transaction
            .updateTable('journal_cells')
            .set({ student_id: other ?? '' })
            .where('id', '=', cell.id)
            .execute(),
        ),
      );
      expect(failed).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_merge_carry' });
    });
  });

  describe('journal_former_member_names (decision 7)', () => {
    it('names, past the row filter, a former member whose record is of another branch, names and UID only', async () => {
      const { classId, student } = await scene();
      const journal = await database.migrator
        .insertInto('journals')
        .values({
          branch_id: north,
          academic_year_id: year.year,
          class_id: classId,
          subject_id: subject,
          runs: '{[2026-09-01,2027-06-01)}',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const read = (branch: string, asked: string) =>
        inBranch(
          branch,
          BEFORE,
          async (transaction) =>
            (
              await sql<Record<string, unknown>>`
              select * from journal_former_member_names(${journal.id}::uuid, ${asked}::uuid)
            `.execute(transaction)
            ).rows,
        );
      expect(await read(north, north)).toEqual([]);
      await moveStudentBranch(database.migrator, student, north, south, '2026-10-15T18:55:00Z');
      const rows = await read(north, north);
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
        ['first_name', 'id', 'last_name', 'paternal_name', 'uid'].sort(),
      );
      expect(rows[0]?.id).toBe(student);
      // A branch outside the transaction reads nothing.
      expect(await read(south, north)).toEqual([]);
    });
  });
});
