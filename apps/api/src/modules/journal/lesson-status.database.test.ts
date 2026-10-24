import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch, setEditDays } from '../../testing/branch-filter-sql.js';
import { ActingKit } from '../../testing/acting-kit.js';
import { workWithTotal } from '../../testing/cells-kit.js';
import { lessonsCounted } from './lesson-counted.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

/** Wednesday 14 October 2026, the date of the lessons; with 7 edit days they lock at 00:00 on the 22nd. */
const DAY = '2026-10-14';
const OPEN = '2026-10-15T10:00:00+05:00';
const LOCKED = '2026-10-23T10:00:00+05:00';

async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// "Not graded" and the orphan assignments in the database (db/migrations/0129; task 8.7,
// pull request #225, decisions 3 and 4). Every write is made as `sodiq_app` through the
// branch filter, at the moment of `clock`. All names are invented.
describe('lesson status in the database', () => {
  let database: TestDatabase;
  let clock: FixedClock;
  let transactions: Transactions;
  let kit: LessonsKit;
  let north: string;
  let year: { year: string; quarters: string[] };
  let subject: string;
  let teacher: { staffId: string; accountId: string };
  let helper: { staffId: string; accountId: string };
  let vice: string;

  const inBranch = <T>(
    moment: string,
    work: (transaction: Transaction) => Promise<T>,
  ): Promise<T> => {
    clock.set(moment);
    return transactions.run([north], async (transaction) => {
      await transaction
        .insertInto('audit_log')
        .values({ occurred_at: new Date(moment), branch_id: north, action: 'test.status' })
        .execute();
      return work(transaction);
    });
  };

  let slot = 0;
  async function lesson(classId: string): Promise<string> {
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
          lesson_date: DAY,
          starts_at: at(DAY, start),
          ends_at: at(DAY, end),
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

  async function scene() {
    const classId = await kit.load.classes.schoolClass(north, year.year, { grade: 7 });
    const [student] = await kit.pupils(north, classId, 1);
    const id = await lesson(classId);
    return {
      classId,
      student: student ?? '',
      lesson: id,
      work: await workWithTotal(database.migrator, { branchId: north, lessonId: id, total: 10 }),
    };
  }

  /** A cell written as the application at a moment, with the settings given. */
  const cell = (
    moment: string,
    input: {
      lesson: string;
      student: string;
      work: string | null;
      score?: number | null;
      notGraded: boolean;
    },
    options: { by?: string; assignment?: string } = {},
  ) =>
    inBranch(moment, async (transaction) => {
      if (options.assignment !== undefined) {
        await sql`select set_config('app.orphan_assignment_id', ${options.assignment}, true)`.execute(
          transaction,
        );
      }
      return transaction
        .insertInto('journal_cells')
        .values({
          branch_id: north,
          lesson_id: input.lesson,
          student_id: input.student,
          work_id: input.work,
          score: input.score ?? null,
          not_graded: input.notGraded,
          version: 1,
          changed_by: options.by ?? teacher.accountId,
          changed_how: 'entry',
          changed_at: new Date(0),
        })
        .returning(['id', 'changed_how', 'not_graded'])
        .executeTakeFirstOrThrow();
    });

  const assign = (
    moment: string,
    input: { lesson: string; staffId: string; days?: number; reason?: string },
  ) =>
    inBranch(moment, (transaction) =>
      transaction
        .insertInto('journal_orphan_assignments')
        .values({
          branch_id: north,
          lesson_id: input.lesson,
          staff_id: input.staffId,
          reason: input.reason ?? 'Completes the lesson',
          days: input.days ?? 2,
          assigned_by: vice,
          assigned_at: new Date(0),
          open_until: new Date(0),
        })
        .returning(['id', 'assigned_at', 'open_until'])
        .executeTakeFirstOrThrow(),
    );

  const withdraw = (moment: string, id: string) =>
    inBranch(moment, (transaction) =>
      transaction
        .updateTable('journal_orphan_assignments')
        .set({ withdrawn_by: vice })
        .where('id', '=', id)
        .returning(['withdrawn_at'])
        .executeTakeFirstOrThrow(),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    clock = new FixedClock(OPEN);
    transactions = new Transactions(database.app, clock);
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    await setEditDays(database.migrator, north, 7);
    year = await kit.year(north);
    subject = await kit.load.classes.subject({ grades: [7] });
    teacher = await kit.load.classes.person(north, ['uz']);
    helper = await kit.load.classes.person(north, ['uz']);
    vice = await kit.load.classes.account();
    await kit.load.classes.role(vice, north, 'academic_vice_principal');
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('"not graded"', () => {
    it('is refused on an attendance cell', async () => {
      const s = await scene();
      const failed = await refusal(cell(OPEN, { ...s, work: null, notGraded: true }));
      expect([failed.code, failed.constraint]).toEqual([
        CHECK_VIOLATION,
        'journal_cells_not_graded_check',
      ]);
    });

    it('is ended by a number, and kept in the history before and after', async () => {
      const s = await scene();
      const written = await cell(OPEN, { ...s, notGraded: true });
      expect(written.not_graded).toBe(true);
      await inBranch(OPEN, (transaction) =>
        transaction
          .updateTable('journal_cells')
          .set({ score: 6, not_graded: true, changed_by: teacher.accountId, changed_how: 'entry' })
          .where('id', '=', written.id)
          .execute(),
      );
      const stored = await database.migrator
        .selectFrom('journal_cells')
        .select(['score', 'not_graded'])
        .where('id', '=', written.id)
        .executeTakeFirstOrThrow();
      expect(stored).toEqual({ score: 6, not_graded: false });
      const lines = await database.migrator
        .selectFrom('journal_cell_history')
        .select(['version', 'not_graded_before', 'not_graded_after', 'score_after'])
        .where('cell_id', '=', written.id)
        .orderBy('version')
        .execute();
      expect(lines).toEqual([
        { version: 1, not_graded_before: false, not_graded_after: true, score_after: null },
        { version: 2, not_graded_before: true, not_graded_after: false, score_after: 6 },
      ]);
    });

    it('is refused on a work with no total, a work marked "not held" and a student not expected', async () => {
      const s = await scene();
      // A second classwork of the lesson whose total is not set yet.
      const bare = await database.migrator
        .insertInto('journal_works')
        .values({
          branch_id: north,
          lesson_id: s.lesson,
          source_lesson_id: s.lesson,
          position: 2,
          kind: 'classwork',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      expect((await refusal(cell(OPEN, { ...s, work: bare.id, notGraded: true }))).constraint).toBe(
        'journal_cell_no_total',
      );
      const held = await scene();
      await inBranch(OPEN, (transaction) =>
        transaction
          .updateTable('journal_works')
          .set({ not_held: true, changed_by: teacher.accountId, changed_how: 'not_held' })
          .where('id', '=', held.work)
          .execute(),
      );
      expect((await refusal(cell(OPEN, { ...held, notGraded: true }))).constraint).toBe(
        'journal_cell_not_held',
      );
      const other = await scene();
      expect(
        (await refusal(cell(OPEN, { ...other, student: held.student, notGraded: true })))
          .constraint,
      ).toBe('journal_cell_not_member');
    });
  });

  describe('the orphan assignments', () => {
    it('take their moment and end from the clock: 00:00 of the day after the assignment day plus the days', async () => {
      const s = await scene();
      const row = await assign(LOCKED, { lesson: s.lesson, staffId: helper.staffId, days: 2 });
      expect(row.assigned_at.toISOString()).toBe(new Date(LOCKED).toISOString());
      expect(row.open_until.toISOString()).toBe(
        new Date('2026-10-26T00:00:00+05:00').toISOString(),
      );
    });

    it('refuse an empty reason, days outside 1 to 7, a second open one and a vacancy', async () => {
      const s = await scene();
      expect(
        (await refusal(assign(LOCKED, { lesson: s.lesson, staffId: helper.staffId, reason: ' ' })))
          .constraint,
      ).toBe('journal_orphan_assignments_reason_check');
      expect(
        (await refusal(assign(LOCKED, { lesson: s.lesson, staffId: helper.staffId, days: 8 })))
          .constraint,
      ).toBe('journal_orphan_assignments_days_check');
      await assign(LOCKED, { lesson: s.lesson, staffId: helper.staffId });
      const twice = await refusal(assign(LOCKED, { lesson: s.lesson, staffId: teacher.staffId }));
      expect([twice.code, twice.constraint]).toEqual([
        UNIQUE_VIOLATION,
        'journal_orphan_assignments_open_key',
      ]);
      const vacancy = await kit.load.vacancy(north);
      const other = await scene();
      expect(
        (await refusal(assign(LOCKED, { lesson: other.lesson, staffId: vacancy }))).constraint,
      ).toBe('orphan_teacher_inactive');
    });

    it('refuse a person inactive today, and a second withdraw', async () => {
      const s = await scene();
      const away = await kit.load.classes.person(north, ['uz']);
      await database.migrator
        .updateTable('staff_statuses')
        .set({ valid_until: '2026-10-20' })
        .where('staff_id', '=', away.staffId)
        .where('valid_until', 'is', null)
        .execute();
      await database.migrator
        .insertInto('staff_statuses')
        .values({ staff_id: away.staffId, status: 'inactive', valid_from: '2026-10-20' })
        .execute();
      expect(
        (await refusal(assign(LOCKED, { lesson: s.lesson, staffId: away.staffId }))).constraint,
      ).toBe('orphan_teacher_inactive');
      const row = await assign(LOCKED, { lesson: s.lesson, staffId: helper.staffId });
      expect((await withdraw(LOCKED, row.id)).withdrawn_at?.toISOString()).toBe(
        new Date(LOCKED).toISOString(),
      );
      expect((await refusal(withdraw(LOCKED, row.id))).constraint).toBe(
        'orphan_assignment_withdrawn',
      );
    });
  });

  describe('the guard of the edit period with an orphan assignment', () => {
    it('takes the assigned person’s write after the lock as a late entry under the assignment, and nobody else’s', async () => {
      const s = await scene();
      const row = await assign(LOCKED, { lesson: s.lesson, staffId: helper.staffId });
      const marked = await inBranch(LOCKED, async (transaction) => {
        await sql`select set_config('app.orphan_assignment_id', ${row.id}, true)`.execute(
          transaction,
        );
        return transaction
          .insertInto('journal_cells')
          .values({
            branch_id: north,
            lesson_id: s.lesson,
            student_id: s.student,
            work_id: s.work,
            score: 5,
            version: 1,
            changed_by: helper.accountId,
            changed_how: 'entry',
            changed_at: new Date(0),
          })
          .returning(['id', 'changed_how'])
          .executeTakeFirstOrThrow();
      });
      expect(marked.changed_how).toBe('late_entry');
      const line = await database.migrator
        .selectFrom('journal_cell_history')
        .select(['changed_how', 'unlock_id', 'orphan_assignment_id'])
        .where('cell_id', '=', marked.id)
        .executeTakeFirstOrThrow();
      expect(line).toEqual({
        changed_how: 'late_entry',
        unlock_id: null,
        orphan_assignment_id: row.id,
      });
      // Another person with the same setting is refused.
      const other = await scene();
      const own = await assign(LOCKED, { lesson: other.lesson, staffId: helper.staffId });
      expect(
        (
          await refusal(
            cell(
              LOCKED,
              { ...other, score: 3, notGraded: false },
              { by: teacher.accountId, assignment: own.id },
            ),
          )
        ).constraint,
      ).toBe('journal_locked');
      // The assignment of another lesson covers nothing here.
      const third = await scene();
      expect(
        (
          await refusal(
            cell(
              LOCKED,
              { ...third, score: 3, notGraded: false },
              { by: helper.accountId, assignment: own.id },
            ),
          )
        ).constraint,
      ).toBe('journal_locked');
    });

    it('refuses it from the assignment’s end, and after a withdraw while the end is still ahead', async () => {
      const ended = await scene();
      const row = await assign(LOCKED, { lesson: ended.lesson, staffId: helper.staffId, days: 1 });
      // Open until 00:00 on the 25th: refused at that minute, the assignment not withdrawn.
      expect(
        (
          await refusal(
            cell(
              '2026-10-25T00:00:00+05:00',
              { ...ended, score: 3, notGraded: false },
              {
                by: helper.accountId,
                assignment: row.id,
              },
            ),
          )
        ).constraint,
      ).toBe('journal_locked');
      const withdrawn = await scene();
      const second = await assign(LOCKED, {
        lesson: withdrawn.lesson,
        staffId: helper.staffId,
        days: 7,
      });
      await withdraw(LOCKED, second.id);
      expect(
        (
          await refusal(
            cell(
              LOCKED,
              { ...withdrawn, score: 3, notGraded: false },
              { by: helper.accountId, assignment: second.id },
            ),
          )
        ).constraint,
      ).toBe('journal_locked');
    });

    it('needs nothing before the lock: the route decides who writes', async () => {
      const s = await scene();
      const written = await cell(
        OPEN,
        { ...s, score: 4, notGraded: false },
        { by: helper.accountId },
      );
      expect(written.changed_how).toBe('entry');
    });
  });

  describe('who a lesson counts for (decision 13)', () => {
    it('counts a lesson of a vacancy for nobody, and for the acting teacher while a period names them', async () => {
      const east = await insertBranch(database.migrator, 'East counted');
      const acting = new ActingKit(database.migrator);
      const scene = await acting.scene(east);
      // A lesson of the journal on a day of the vacancy, as the reader is given it.
      const lesson = {
        id: scene.version,
        journalId: scene.journal,
        date: '2026-10-14',
        teacherId: scene.vacancy,
      };
      const counted = () =>
        transactions.run([east], (transaction) => lessonsCounted(transaction, east, [lesson]));
      expect((await counted()).get(lesson.id)).toBeNull();
      await acting.period(scene, '2026-09-07');
      expect((await counted()).get(lesson.id)).toBe(scene.person);
    });
  });
});
