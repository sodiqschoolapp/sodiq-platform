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
/** Monday 9 November, the first day of quarter 2. */
const NEXT_DAY = '2026-11-09';
/** The close: Saturday 31 October 2026, 18:00 in Tashkent. */
const CLOSE = '2026-10-31T18:00:00+05:00';
/** The reopening: Monday 2 November 2026, 09:00 in Tashkent, for 3 days: open until 00:00 of 6 November. */
const REOPEN = '2026-11-02T09:00:00+05:00';
const OPEN_UNTIL = '2026-11-06T00:00:00+05:00';
const INSIDE = '2026-11-03T10:00:00+05:00';
const LAST_MINUTE = '2026-11-05T23:59:00+05:00';
const AFTER_END = '2026-11-06T00:00:00+05:00';
const BEFORE = '2026-10-15T10:00:00+05:00';

async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

const refused = (constraint: string) => ({ code: CHECK_VIOLATION, constraint });
const CLOSED = refused('quarters_closed');
const LOCKED = refused('journal_locked');

// Reopening a closed quarter in the database (db/migrations/0135; task 9.2c, pull request #231).
// edge/journal, Closing and reopening: "Reopening is for one journal or the whole branch, for a
// set number of days. Lessons stay locked; only corrections and explicit unlocks apply. The
// earlier final results are kept as a version"; edge/exemptions: "The closed part is applied
// after the affected journals of that quarter are reopened". Every write is made as `sodiq_app`
// at the moment given, unless it says the migrator. All names are invented.
describe('reopening a quarter in the database', () => {
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
        .values({ occurred_at: new Date(moment), branch_id: branch, action: 'test.reopen' })
        .execute();
      return work(transaction);
    });

  const setting = (transaction: Transaction, name: string, value: string) =>
    sql`select set_config(${name}, ${value}, true)`.execute(transaction);

  let branches = 0;
  /** A branch with its year, two classes of one student each, their journals and lessons on DAY. */
  async function scene() {
    branches += 1;
    const branch = await insertBranch(database.migrator, `Reopening ${String(branches)}`);
    await setEditDays(database.migrator, branch, 7);
    const { year, quarters } = await cells.lessons.year(branch);
    await cells.lessons.load.classes.role(vice, branch, 'academic_vice_principal');
    const classId = await cells.lessons.load.classes.schoolClass(branch, year, { grade: 7 });
    const otherClass = await cells.lessons.load.classes.schoolClass(branch, year, { grade: 7 });
    const [student, classmate] = await cells.lessons.pupils(branch, classId, 2);
    const [otherStudent] = await cells.lessons.pupils(branch, otherClass, 1);
    const lesson = await cells.lesson(branch, year, classId, DAY);
    const otherLesson = await cells.lesson(branch, year, otherClass, DAY);
    const journalOf = async (unit: string) =>
      (
        await database.migrator
          .selectFrom('journals')
          .select('id')
          .where('class_id', '=', unit)
          .where('subject_id', '=', cells.subject)
          .executeTakeFirst()
      )?.id ??
      (
        await database.migrator
          .insertInto('journals')
          .values({
            branch_id: branch,
            academic_year_id: year,
            class_id: unit,
            group_id: null,
            subject_id: cells.subject,
            runs: '{[2026-09-01,)}',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    return {
      branch,
      year,
      first: quarters[0] ?? '',
      classId,
      student: student ?? '',
      classmate: classmate ?? '',
      otherStudent: otherStudent ?? '',
      lesson,
      otherLesson,
      journal: await journalOf(classId),
      otherJournal: await journalOf(otherClass),
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** The branch close, with the names of both journals (and `more`) as the close stores them. */
  async function close(s: Scene, moment = CLOSE, more: readonly string[] = []) {
    return inBranch(s.branch, moment, async (transaction) => {
      const row = await transaction
        .insertInto('quarter_closings')
        .values({
          branch_id: s.branch,
          quarter_id: s.first,
          version: 0,
          closed_at: new Date(0),
          closed_by: vice,
          lock_now: false,
          start_quarter: null,
          warnings: '[]',
        })
        .returning(['id', 'version'])
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('quarter_closing_journals')
        .values(
          [s.journal, s.otherJournal, ...more].map((journal) => ({
            branch_id: s.branch,
            closing_id: row.id,
            journal_id: journal,
            unit_name: '7 Oxford',
            subject_names: JSON.stringify({ uz: 'Fizika', ru: 'Физика', en: 'Physics' }),
            teacher_name: null,
          })),
        )
        .execute();
      return row;
    });
  }

  /** A version of another cause written as its route writes it. */
  const version = (
    s: Scene,
    moment: string,
    values: { cause: 'journal_close' | 'recalculation'; journal?: string; reason?: string },
  ) =>
    inBranch(s.branch, moment, (transaction) =>
      transaction
        .insertInto('quarter_closings')
        .values({
          branch_id: s.branch,
          quarter_id: s.first,
          version: 0,
          closed_at: new Date(0),
          closed_by: vice,
          lock_now: false,
          start_quarter: null,
          warnings: '[]',
          cause: values.cause,
          journal_id: values.journal ?? null,
          reason: values.reason ?? null,
        })
        .returning(['id', 'version'])
        .executeTakeFirstOrThrow(),
    );

  const reopen = (
    s: Scene,
    closingId: string,
    options: { journal?: string | null; days?: number; moment?: string } = {},
  ) =>
    inBranch(s.branch, options.moment ?? REOPEN, (transaction) =>
      transaction
        .insertInto('quarter_reopenings')
        .values({
          branch_id: s.branch,
          quarter_id: s.first,
          closing_id: closingId,
          journal_id: options.journal ?? null,
          reason: 'A mark was typed in the wrong row',
          days: options.days ?? 3,
          reopened_at: new Date(0),
          open_until: new Date(0),
          reopened_by: vice,
        })
        .returning(['id', 'reopened_at', 'open_until', 'ended_by_closing_id'])
        .executeTakeFirstOrThrow(),
    );

  /** An attendance cell written as the application at a moment. */
  const mark = (
    branch: string,
    moment: string,
    input: { lesson: string; student: string },
    options: { reason?: string; by?: string; unlock?: string } = {},
  ) =>
    inBranch(branch, moment, async (transaction) => {
      if (options.reason !== undefined) {
        await setting(transaction, 'app.correction_reason', options.reason);
      }
      if (options.unlock !== undefined) await setting(transaction, 'app.unlock_id', options.unlock);
      return transaction
        .insertInto('journal_cells')
        .values({
          branch_id: branch,
          lesson_id: input.lesson,
          student_id: input.student,
          mark: 1,
          version: 1,
          changed_by: options.by ?? account,
          changed_how: 'entry',
          changed_at: new Date(0),
        })
        .returning(['id', 'changed_how'])
        .executeTakeFirstOrThrow();
    });

  const correct = (s: Scene, moment: string, lesson = s.lesson, student = s.student) =>
    mark(s.branch, moment, { lesson, student }, { reason: 'Typed in the wrong row', by: vice });

  /** An unlock of a lesson for a teacher, approved at `decided`. */
  async function unlock(s: Scene, decided: string) {
    const teacher = await cells.lessons.load.classes.person(s.branch, ['uz']);
    const row = await inBranch(s.branch, '2026-10-24T10:00:00+05:00', (transaction) =>
      transaction
        .insertInto('journal_unlocks')
        .values({
          branch_id: s.branch,
          target: 'lesson',
          lesson_id: s.lesson,
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
    await inBranch(s.branch, decided, (transaction) =>
      transaction
        .updateTable('journal_unlocks')
        .set({ status: 'approved', days: 7, decided_by: vice })
        .where('id', '=', row.id)
        .execute(),
    );
    return { id: row.id, teacher };
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    cells = await CellsKit.create(database.migrator);
    account = await cells.lessons.load.classes.account();
    vice = await cells.lessons.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('a reopening', () => {
    it('takes the moment of the transaction and ends at 00:00 of the day after the days', async () => {
      const s = await scene();
      const closing = await close(s);
      const row = await reopen(s, closing.id);
      expect(row.reopened_at).toEqual(new Date(REOPEN));
      expect(row.open_until).toEqual(new Date(OPEN_UNTIL));
      expect(row.ended_by_closing_id).toBeNull();
    });

    it('takes the versions in force out of force when it is for the whole branch', async () => {
      const s = await scene();
      const closing = await close(s);
      await reopen(s, closing.id);
      const rows = await database.migrator
        .selectFrom('quarter_closings')
        .select('reopened_at')
        .where('quarter_id', '=', s.first)
        .execute();
      expect(rows).toEqual([{ reopened_at: new Date(REOPEN) }]);
    });

    it('leaves the branch close in force when it is for one journal', async () => {
      const s = await scene();
      const closing = await close(s);
      await reopen(s, closing.id, { journal: s.journal });
      const rows = await database.migrator
        .selectFrom('quarter_closings')
        .select('reopened_at')
        .where('quarter_id', '=', s.first)
        .execute();
      expect(rows).toEqual([{ reopened_at: null }]);
    });

    it('is refused without a branch close in force, or naming another close', async () => {
      const s = await scene();
      const closing = await close(s);
      await reopen(s, closing.id);
      // Reopened: no branch close in force any more.
      expect(await refusal(reopen(s, closing.id, { moment: INSIDE }))).toMatchObject(
        refused('quarter_not_closed'),
      );
      expect(
        await refusal(reopen(s, closing.id, { journal: s.journal, moment: INSIDE })),
      ).toMatchObject(refused('quarter_not_closed'));
    });

    it('is refused for a journal reopened and not closed again, and for the branch while one is', async () => {
      const s = await scene();
      const closing = await close(s);
      await reopen(s, closing.id, { journal: s.journal });
      expect(
        await refusal(reopen(s, closing.id, { journal: s.journal, moment: INSIDE })),
      ).toMatchObject(refused('quarter_reopened'));
      expect(await refusal(reopen(s, closing.id, { moment: INSIDE }))).toMatchObject(
        refused('quarter_journal_reopened'),
      );
      // Another journal may be reopened beside it.
      await reopen(s, closing.id, { journal: s.otherJournal, moment: INSIDE });
    });

    it('is refused for a journal the close did not store', async () => {
      const s = await scene();
      const closing = await close(s);
      const stranger = await cells.lessons.load.classes.schoolClass(s.branch, s.year, {
        grade: 9,
      });
      const journal = await database.migrator
        .insertInto('journals')
        .values({
          branch_id: s.branch,
          academic_year_id: s.year,
          class_id: stranger,
          group_id: null,
          subject_id: cells.subject,
          runs: '{[2026-09-01,)}',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      expect(await refusal(reopen(s, closing.id, { journal: journal.id }))).toMatchObject(
        refused('quarter_journal_not_closed'),
      );
    });

    it('is refused in a closed year and for a number of days out of 1 to 14', async () => {
      const s = await scene();
      const closing = await close(s);
      expect((await refusal(reopen(s, closing.id, { days: 15 }))).code).toBe(CHECK_VIOLATION);
      expect((await refusal(reopen(s, closing.id, { days: 0 }))).code).toBe(CHECK_VIOLATION);
      await database.migrator
        .updateTable('academic_years')
        .set({ status: 'closed' })
        .where('id', '=', s.year)
        .execute();
      expect(await refusal(reopen(s, closing.id))).toMatchObject(refused('academic_years_closed'));
    });

    // Review must-fix 7: no write reopens a quarter without a reopening of its transaction.
    it('is the only way the application takes a version out of force', async () => {
      const s = await scene();
      const closing = await close(s);
      expect(
        await refusal(
          inBranch(s.branch, REOPEN, (transaction) =>
            transaction
              .updateTable('quarter_closings')
              .set({ reopened_at: new Date(REOPEN) })
              .where('id', '=', closing.id)
              .execute(),
          ),
        ),
      ).toMatchObject(refused('quarter_closings_reopen'));
      // Its other columns stay the application's to read only.
      expect(
        (
          await refusal(
            inBranch(s.branch, REOPEN, (transaction) =>
              transaction
                .updateTable('quarter_closings')
                .set({ lock_now: true })
                .where('id', '=', closing.id)
                .execute(),
            ),
          )
        ).code,
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });

    // Review must-fix 8.
    it('is ended only by a close of this transaction, of its quarter and journal', async () => {
      const s = await scene();
      const closing = await close(s);
      const own = await reopen(s, closing.id, { journal: s.journal });
      const other = await reopen(s, closing.id, { journal: s.otherJournal });
      // The application sets the end by hand: refused, also naming a version of earlier.
      expect(
        await refusal(
          inBranch(s.branch, INSIDE, (transaction) =>
            transaction
              .updateTable('quarter_reopenings')
              .set({ ended_by_closing_id: closing.id })
              .where('id', '=', own.id)
              .execute(),
          ),
        ),
      ).toMatchObject(refused('quarter_reopenings_end'));
      // A journal's re-close ends its own reopening only.
      const again = await version(s, INSIDE, { cause: 'journal_close', journal: s.journal });
      const rows = await database.migrator
        .selectFrom('quarter_reopenings')
        .select(['id', 'ended_by_closing_id'])
        .where('quarter_id', '=', s.first)
        .orderBy('reopened_at')
        .orderBy('id')
        .execute();
      expect(new Map(rows.map((row) => [row.id, row.ended_by_closing_id]))).toEqual(
        new Map([
          [own.id, again.id],
          [other.id, null],
        ]),
      );
      // A reopening ended is not taken back.
      expect(
        await refusal(
          inBranch(s.branch, LAST_MINUTE, (transaction) =>
            transaction
              .updateTable('quarter_reopenings')
              .set({ ended_by_closing_id: null })
              .where('id', '=', own.id)
              .execute(),
          ),
        ),
      ).toMatchObject(refused('quarter_reopenings_end'));
    });

    // Spec review must-fix 3: each branch of `quarter_reopenings_end` reached on its own, by a
    // version written in the same transaction (so only the version's quarter, cause or journal
    // decides).
    it('is not ended by a version of this transaction of another quarter, another journal or a recalculation', async () => {
      const s = await scene();
      const elsewhere = await scene();
      const closing = await close(s);
      const own = await reopen(s, closing.id, { journal: s.journal });
      const other = await reopen(s, closing.id, { journal: s.otherJournal });
      const endBy = (transaction: Transaction, id: string) =>
        transaction
          .updateTable('quarter_reopenings')
          .set({ ended_by_closing_id: id })
          .where('id', '=', own.id)
          .execute();
      const newVersion = (
        transaction: Transaction,
        scene: Scene,
        values: { cause: 'close' | 'journal_close' | 'recalculation'; journal?: string },
      ) =>
        transaction
          .insertInto('quarter_closings')
          .values({
            branch_id: scene.branch,
            quarter_id: scene.first,
            version: 0,
            closed_at: new Date(0),
            closed_by: vice,
            lock_now: false,
            start_quarter: null,
            warnings: '[]',
            cause: values.cause,
            journal_id: values.journal ?? null,
            reason:
              values.cause === 'recalculation' ? 'A rounding bug of an earlier release' : null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
      // A branch close of another quarter (another branch's), in this transaction.
      expect(
        await refusal(
          new Transactions(database.app, new FixedClock(INSIDE)).run(
            [s.branch, elsewhere.branch],
            async (transaction) => {
              const row = await newVersion(transaction, elsewhere, { cause: 'close' });
              await endBy(transaction, row.id);
            },
          ),
        ),
      ).toMatchObject(refused('quarter_reopenings_end'));
      // Another journal's re-close, in this transaction: it ends that journal's reopening only.
      expect(
        await refusal(
          inBranch(s.branch, INSIDE, async (transaction) => {
            const row = await newVersion(transaction, s, {
              cause: 'journal_close',
              journal: s.otherJournal,
            });
            await endBy(transaction, row.id);
          }),
        ),
      ).toMatchObject(refused('quarter_reopenings_end'));
      // A recalculation of this quarter, in this transaction.
      expect(
        await refusal(
          inBranch(s.branch, INSIDE, async (transaction) => {
            const row = await newVersion(transaction, s, { cause: 'recalculation' });
            await endBy(transaction, row.id);
          }),
        ),
      ).toMatchObject(refused('quarter_reopenings_end'));
      const rows = await database.migrator
        .selectFrom('quarter_reopenings')
        .select(['id', 'ended_by_closing_id'])
        .where('id', 'in', [own.id, other.id])
        .execute();
      expect(rows.map((row) => row.ended_by_closing_id)).toEqual([null, null]);
    });

    // Spec review must-fix 3: `quarter_closings_reopen` refuses a version already out of force,
    // also in the transaction of a whole-branch reopening at its own moment.
    it('takes a version out of force only once', async () => {
      const s = await scene();
      const closing = await close(s);
      expect(
        await refusal(
          inBranch(s.branch, REOPEN, async (transaction) => {
            await transaction
              .insertInto('quarter_reopenings')
              .values({
                branch_id: s.branch,
                quarter_id: s.first,
                closing_id: closing.id,
                journal_id: null,
                reason: 'A mark was typed in the wrong row',
                days: 3,
                reopened_at: new Date(0),
                open_until: new Date(0),
                reopened_by: vice,
              })
              .execute();
            // The reopening took it out of force at REOPEN; written again, same moment.
            await transaction
              .updateTable('quarter_closings')
              .set({ reopened_at: new Date(REOPEN) })
              .where('id', '=', closing.id)
              .execute();
          }),
        ),
      ).toMatchObject(refused('quarter_closings_reopen'));
      const row = await database.migrator
        .selectFrom('quarter_closings')
        .select('reopened_at')
        .where('id', '=', closing.id)
        .executeTakeFirstOrThrow();
      expect(row.reopened_at).toBeNull();
    });

    it('of the whole branch is ended by the next branch close, which is version 2', async () => {
      const s = await scene();
      const closing = await close(s);
      const row = await reopen(s, closing.id);
      const again = await close(s, LAST_MINUTE);
      expect(again.version).toBe(2);
      const ended = await database.migrator
        .selectFrom('quarter_reopenings')
        .select('ended_by_closing_id')
        .where('id', '=', row.id)
        .executeTakeFirstOrThrow();
      expect(ended.ended_by_closing_id).toBe(again.id);
    });
  });

  describe('the versions', () => {
    it('number every cause in one row, and keep the branch close in force beside them', async () => {
      const s = await scene();
      const closing = await close(s);
      await reopen(s, closing.id, { journal: s.journal });
      const again = await version(s, INSIDE, { cause: 'journal_close', journal: s.journal });
      const applied = await version(s, LAST_MINUTE, {
        cause: 'recalculation',
        reason: 'A rounding bug of version 1',
      });
      expect([closing.version, again.version, applied.version]).toEqual([1, 2, 3]);
      const inForce = await database.migrator
        .selectFrom('quarter_closings')
        .select('id')
        .where('quarter_id', '=', s.first)
        .where('reopened_at', 'is', null)
        .execute();
      expect(inForce).toHaveLength(3);
    });

    it('refuse a journal close without its reopening, and a recalculation without a reason or a close', async () => {
      const s = await scene();
      expect(
        await refusal(version(s, INSIDE, { cause: 'recalculation', reason: 'A bug' })),
      ).toMatchObject(refused('quarter_not_closed'));
      await close(s);
      expect(
        await refusal(version(s, INSIDE, { cause: 'journal_close', journal: s.journal })),
      ).toMatchObject(refused('quarter_journal_not_reopened'));
      expect(await refusal(version(s, INSIDE, { cause: 'recalculation' }))).toMatchObject(
        refused('quarter_closings_cause_journal_check'),
      );
    });
  });

  describe('the journal of a reopened quarter', () => {
    // edge/journal: "Lessons stay locked; only corrections and explicit unlocks apply."
    it('takes a correction, refuses a plain entry and an unlock decided before the close, takes one decided after', async () => {
      const s = await scene();
      const before = await unlock(s, '2026-10-28T10:00:00+05:00');
      const closing = await close(s);
      await reopen(s, closing.id);
      expect((await correct(s, INSIDE)).changed_how).toBe('correction');
      expect(
        await refusal(mark(s.branch, INSIDE, { lesson: s.lesson, student: s.student })),
      ).toMatchObject(LOCKED);
      // The unlock of 28 October is open until 5 November, but decided before the close.
      expect(
        await refusal(
          mark(
            s.branch,
            INSIDE,
            { lesson: s.lesson, student: s.classmate },
            { by: before.teacher.accountId, unlock: before.id },
          ),
        ),
      ).toMatchObject(LOCKED);
      const after = await unlock(s, INSIDE);
      const taken = await mark(
        s.branch,
        '2026-11-04T10:00:00+05:00',
        { lesson: s.lesson, student: s.classmate },
        { by: after.teacher.accountId, unlock: after.id },
      );
      expect(taken.changed_how).toBe('late_entry');
    });

    // Plan decision 5: the cells an exemption reopened and the optional cells give no entry in a
    // reopened quarter (they are neither a correction nor an explicit unlock).
    it('refuses a cell an exemption reopened and an optional cell, which they took before the close', async () => {
      const s = await scene();
      await inBranch(s.branch, BEFORE, async (transaction) => {
        const exemption = await transaction
          .insertInto('exemptions')
          .values({
            branch_id: s.branch,
            student_id: s.student,
            year_id: s.year,
            batch_id: '019a0000-0000-7000-8000-000000000012',
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
            branch_id: s.branch,
            exemption_id: exemption.id,
            lesson_id: s.lesson,
            student_id: s.student,
            reopened_at: new Date(BEFORE),
            open_until: new Date('2026-11-30T00:00:00+05:00'),
          })
          .execute();
        const status = await transaction
          .selectFrom('student_statuses')
          .select('id')
          .where('student_id', '=', s.classmate)
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('journal_optional_cells')
          .values({
            branch_id: s.branch,
            lesson_id: s.lesson,
            student_id: s.classmate,
            open_until: new Date('2026-11-30T00:00:00+05:00'),
            opened_at: new Date(BEFORE),
            return_status_id: status.id,
          })
          .execute();
      });
      // Both open after the lock, before the close.
      const reopenedCell = await mark(s.branch, '2026-10-23T10:00:00+05:00', {
        lesson: s.lesson,
        student: s.student,
      });
      expect(reopenedCell.changed_how).toBe('late_entry');
      const optional = await mark(s.branch, '2026-10-23T10:00:00+05:00', {
        lesson: s.lesson,
        student: s.classmate,
      });
      expect(optional.changed_how).toBe('late_entry');
      const closing = await close(s);
      await reopen(s, closing.id);
      for (const id of [reopenedCell.id, optional.id]) {
        expect(
          await refusal(
            inBranch(s.branch, INSIDE, (transaction) =>
              transaction
                .updateTable('journal_cells')
                .set({ mark: 2, changed_by: account, changed_how: 'entry' })
                .where('id', '=', id)
                .execute(),
            ),
          ),
        ).toMatchObject(LOCKED);
      }
    });

    // Plan decision 5: an orphan assignment gives no entry in a reopened quarter, though it is
    // still open and took one before the close.
    it('refuses an entry under an orphan assignment, which it took before the close', async () => {
      const s = await scene();
      const teacher = await cells.lessons.load.classes.person(s.branch, ['uz']);
      // Assigned on 29 October for 7 days: open until 00:00 of 6 November.
      const assignment = await inBranch(s.branch, '2026-10-29T10:00:00+05:00', (transaction) =>
        transaction
          .insertInto('journal_orphan_assignments')
          .values({
            branch_id: s.branch,
            lesson_id: s.lesson,
            staff_id: teacher.staffId,
            reason: 'Completes the lesson',
            days: 7,
            assigned_by: vice,
            assigned_at: new Date(0),
            open_until: new Date(0),
          })
          .returning(['id', 'open_until'])
          .executeTakeFirstOrThrow(),
      );
      expect(assignment.open_until).toEqual(new Date('2026-11-06T00:00:00+05:00'));
      const under = (moment: string, student: string) =>
        inBranch(s.branch, moment, async (transaction) => {
          await setting(transaction, 'app.orphan_assignment_id', assignment.id);
          return transaction
            .insertInto('journal_cells')
            .values({
              branch_id: s.branch,
              lesson_id: s.lesson,
              student_id: student,
              mark: 1,
              version: 1,
              changed_by: teacher.accountId,
              changed_how: 'entry',
              changed_at: new Date(0),
            })
            .returning('changed_how')
            .executeTakeFirstOrThrow();
        });
      expect((await under('2026-10-29T11:00:00+05:00', s.student)).changed_how).toBe('late_entry');
      const closing = await close(s);
      await reopen(s, closing.id);
      expect(await refusal(under(INSIDE, s.classmate))).toMatchObject(LOCKED);
    });

    // edge/system-behaviour: the moments 23:59 and 00:00 (plan decision 3).
    it('takes entries until the end of the reopening, and none from 00:00 of its end', async () => {
      const s = await scene();
      const closing = await close(s);
      await reopen(s, closing.id);
      expect((await correct(s, LAST_MINUTE)).changed_how).toBe('correction');
      expect(await refusal(correct(s, AFTER_END, s.otherLesson, s.otherStudent))).toMatchObject(
        CLOSED,
      );
    });

    it('of one journal takes that journal’s correction until its end, and never another journal’s', async () => {
      const s = await scene();
      const closing = await close(s);
      await reopen(s, closing.id, { journal: s.journal });
      expect((await correct(s, INSIDE)).changed_how).toBe('correction');
      expect(await refusal(correct(s, INSIDE, s.otherLesson, s.otherStudent))).toMatchObject(
        CLOSED,
      );
      expect(
        await refusal(
          mark(
            s.branch,
            AFTER_END,
            { lesson: s.lesson, student: s.classmate },
            {
              reason: 'Typed in the wrong row',
              by: vice,
            },
          ),
        ),
      ).toMatchObject(CLOSED);
    });

    it('takes the closing decisions of the subject until the re-close, also after the end', async () => {
      const s = await scene();
      const closing = await close(s);
      const decide = (moment: string) =>
        inBranch(s.branch, moment, (transaction) =>
          transaction
            .insertInto('quarter_result_decisions')
            .values({
              branch_id: s.branch,
              quarter_id: s.first,
              subject_id: cells.subject,
              student_id: s.student,
              decision: 'keep',
              decided_by: vice,
              decided_at: new Date(0),
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
        );
      expect(await refusal(decide(INSIDE))).toMatchObject(CLOSED);
      await reopen(s, closing.id, { journal: s.journal });
      // Review must-fix 1: after the end of the reopening, before its re-close.
      await decide(AFTER_END);
      await version(s, AFTER_END, { cause: 'journal_close', journal: s.journal });
      expect(
        await refusal(
          inBranch(s.branch, '2026-11-07T10:00:00+05:00', (transaction) =>
            transaction
              .updateTable('quarter_result_decisions')
              .set({ decision: 'not_assessed', decided_by: vice })
              .where('student_id', '=', s.student)
              .execute(),
          ),
        ),
      ).toMatchObject(CLOSED);
    });
  });

  describe('the other records of a reopened quarter', () => {
    const reason = (s: Scene, moment: string) =>
      inBranch(s.branch, moment, (transaction) =>
        transaction
          .insertInto('student_absence_reasons')
          .values({
            branch_id: s.branch,
            student_id: s.student,
            absence_date: DAY,
            category: 'illness',
            note: 'A certificate from the clinic',
            changed_by: vice,
            changed_at: new Date(0),
          })
          .execute(),
      );

    // Plan decision 4: the whole branch reopened opens the quarter; a journal reopened does not.
    it('take a reason of absence while the whole branch is reopened, not while a journal is', async () => {
      const journal = await scene();
      const closing = await close(journal);
      await reopen(journal, closing.id, { journal: journal.journal });
      expect(await refusal(reason(journal, INSIDE))).toMatchObject(CLOSED);
      const whole = await scene();
      const closed = await close(whole);
      await reopen(whole, closed.id);
      await reason(whole, INSIDE);
    });

    // Spec review must-fix 10: the statuses and the memberships (0133, plan decision 12) refuse
    // a day of a closed quarter; the whole branch reopened opens it, a journal reopened does not.
    it('take a leaving dated in the quarter while the whole branch is reopened, not while a journal is', async () => {
      // As the leaving's service writes it: the status rows, then the class row cut.
      const leave = (s: Scene, firstInactiveDay: string) =>
        inBranch(s.branch, INSIDE, async (transaction) => {
          const leaving = await cells.lessons.members.leaving(
            transaction,
            s.branch,
            s.student,
            firstInactiveDay,
          );
          await transaction
            .updateTable('class_memberships')
            .set({ valid_until: firstInactiveDay, ended_by: 'leaving', leaving_id: leaving })
            .where('student_id', '=', s.student)
            .execute();
        });
      const statusOnly = (s: Scene, firstInactiveDay: string) =>
        inBranch(s.branch, INSIDE, (transaction) =>
          cells.lessons.members.leaving(transaction, s.branch, s.student, firstInactiveDay),
        );
      const journal = await scene();
      const closing = await close(journal);
      await reopen(journal, closing.id, { journal: journal.journal });
      expect(await refusal(statusOnly(journal, '2026-10-20'))).toMatchObject(CLOSED);
      // The membership alone: a leaving on the 20th written by the migrator past both guards, then
      // the application moves the cut to the 22nd (days of the closed quarter, statuses untouched).
      await database.migrator.transaction().execute(async (transaction) => {
        const guards = [
          sql`alter table student_statuses disable trigger student_statuses_closed_quarter`,
          sql`alter table class_memberships disable trigger class_memberships_closed_quarter`,
        ];
        for (const one of guards) await one.execute(transaction);
        const id = await cells.lessons.members.leaving(
          transaction,
          journal.branch,
          journal.student,
          '2026-10-20',
        );
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-20', ended_by: 'leaving', leaving_id: id })
          .where('student_id', '=', journal.student)
          .execute();
        // The deferred checks of the rows run first: a table with pending events is not altered.
        await sql`set constraints all immediate`.execute(transaction);
        await sql`alter table student_statuses enable trigger student_statuses_closed_quarter`.execute(
          transaction,
        );
        await sql`alter table class_memberships enable trigger class_memberships_closed_quarter`.execute(
          transaction,
        );
      });
      expect(
        await refusal(
          inBranch(journal.branch, INSIDE, (transaction) =>
            transaction
              .updateTable('class_memberships')
              .set({ valid_until: '2026-10-22' })
              .where('student_id', '=', journal.student)
              .execute(),
          ),
        ),
      ).toMatchObject(CLOSED);
      const whole = await scene();
      const closed = await close(whole);
      await reopen(whole, closed.id);
      await leave(whole, '2026-10-20');
      const rows = await database.migrator
        .selectFrom('class_memberships')
        .select(sql<string>`valid_until::text`.as('until'))
        .where('student_id', '=', whole.student)
        .execute();
      expect(rows.map((row) => row.until)).toEqual(['2026-10-20']);
    });

    // The quarterly weights refuse only a closed quarter (9.2b, `subject_quarter_weights_closed_quarter`).
    it('take the quarterly weights while the whole branch is reopened, not while a journal is', async () => {
      const weights = (s: Scene) =>
        database.migrator
          .insertInto('subject_quarter_weights')
          .values({
            branch_id: s.branch,
            subject_id: cells.subject,
            quarter_id: s.first,
            attendance: 20,
            classwork: 40,
            homework: 40,
            rating_exam: null,
          })
          .execute();
      const journal = await scene();
      const closing = await close(journal);
      await reopen(journal, closing.id, { journal: journal.journal });
      expect(await refusal(weights(journal))).toMatchObject(CLOSED);
      const whole = await scene();
      const closed = await close(whole);
      await reopen(whole, closed.id);
      await weights(whole);
    });
  });

  // Review correction 1: edge/exemptions, "The closed part is applied after the affected
  // journals of that quarter are reopened".
  describe('an exemption that reaches a reopened quarter', () => {
    const add = (s: Scene, moment: string, allSubjects = true) =>
      inBranch(s.branch, moment, async (transaction) => {
        const row = await transaction
          .insertInto('exemptions')
          .values({
            branch_id: s.branch,
            student_id: s.student,
            year_id: s.year,
            batch_id: '019a0000-0000-7000-8000-000000000011',
            kind: 'temporary',
            all_subjects: allSubjects,
            start_date: DAY,
            end_date: '2026-11-10',
            category: 'illness',
            detail: 'A certificate from the clinic',
            granted_by: vice,
            granted_at: new Date(0),
            version: 0,
            changed_at: new Date(0),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (!allSubjects) {
          await transaction
            .insertInto('exemption_subjects')
            .values({ branch_id: s.branch, exemption_id: row.id, subject_id: cells.subject })
            .execute();
        }
        return row;
      });
    const EXEMPTION_CLOSED = refused('exemption_closed_quarter');

    it('is applied when the journal its closed days reach is reopened', async () => {
      const s = await scene();
      const closing = await close(s);
      await reopen(s, closing.id, { journal: s.journal });
      await add(s, INSIDE);
      await add(s, '2026-11-04T10:00:00+05:00', false);
    });

    it('is refused when the reopened journal is another one', async () => {
      const s = await scene();
      const closing = await close(s);
      await reopen(s, closing.id, { journal: s.otherJournal });
      expect(await refusal(add(s, INSIDE))).toMatchObject(EXEMPTION_CLOSED);
      // Of some subjects: refused when its subject rows are written (deferred to the commit).
      expect(await refusal(add(s, INSIDE, false))).toMatchObject(EXEMPTION_CLOSED);
    });

    // Spec review must-fix 2: closed days that reach two journals (the class's and a group's of
    // the same student) are applied only once both are reopened, never with one of them.
    it('is refused while one of the two journals its closed days reach is not reopened', async () => {
      const s = await scene();
      const group = await cells.lessons.load.classes.group(s.branch, s.year, cells.subject, [
        s.classId,
      ]);
      await cells.lessons.inGroup(s.branch, group, cells.subject, s.student);
      await cells.groupLesson(s.branch, s.year, group, DAY);
      const groupJournal =
        (
          await database.migrator
            .selectFrom('journals')
            .select('id')
            .where('group_id', '=', group)
            .executeTakeFirst()
        )?.id ??
        (
          await database.migrator
            .insertInto('journals')
            .values({
              branch_id: s.branch,
              academic_year_id: s.year,
              class_id: null,
              group_id: group,
              subject_id: cells.subject,
              runs: '{[2026-09-01,)}',
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      const closing = await close(s, CLOSE, [groupJournal]);
      await reopen(s, closing.id, { journal: s.journal });
      expect(await refusal(add(s, INSIDE))).toMatchObject(EXEMPTION_CLOSED);
      expect(await refusal(add(s, INSIDE, false))).toMatchObject(EXEMPTION_CLOSED);
      await reopen(s, closing.id, { journal: groupJournal });
      await add(s, INSIDE);
    });

    it('is refused once the end of the reopening has passed', async () => {
      const s = await scene();
      const closing = await close(s);
      await reopen(s, closing.id, { journal: s.journal });
      expect(await refusal(add(s, AFTER_END))).toMatchObject(EXEMPTION_CLOSED);
    });

    it('is applied when the whole branch is reopened', async () => {
      const s = await scene();
      const closing = await close(s);
      await reopen(s, closing.id);
      await add(s, INSIDE);
    });
  });

  describe('the nightly check', () => {
    it('finishes a run once, and takes a difference only into a run still going', async () => {
      const s = await scene();
      const run = await inBranch(s.branch, '2026-11-03T02:00:00+05:00', (transaction) =>
        transaction
          .insertInto('result_checks')
          .values({ branch_id: s.branch, day: '2026-11-03', started_at: new Date(0) })
          .returning(['id', 'started_at'])
          .executeTakeFirstOrThrow(),
      );
      expect(run.started_at).toEqual(new Date('2026-11-03T02:00:00+05:00'));
      const difference = (moment: string) =>
        inBranch(s.branch, moment, (transaction) =>
          transaction
            .insertInto('result_check_differences')
            .values({
              branch_id: s.branch,
              check_id: run.id,
              quarter_id: s.first,
              journal_id: s.journal,
              kind: 'cell_history',
              detail: JSON.stringify({ cellId: s.lesson }),
            })
            .execute(),
        );
      await difference('2026-11-03T02:01:00+05:00');
      const finish = (moment: string) =>
        inBranch(s.branch, moment, (transaction) =>
          transaction
            .updateTable('result_checks')
            .set({ finished_at: new Date(0), summary: '{}' })
            .where('id', '=', run.id)
            .returning('finished_at')
            .executeTakeFirstOrThrow(),
        );
      expect((await finish('2026-11-03T02:05:00+05:00')).finished_at).toEqual(
        new Date('2026-11-03T02:05:00+05:00'),
      );
      expect(await refusal(finish('2026-11-03T02:06:00+05:00'))).toMatchObject(
        refused('result_checks_finished'),
      );
      expect(await refusal(difference('2026-11-03T02:07:00+05:00'))).toMatchObject(
        refused('result_checks_finished'),
      );
      expect(
        (
          await refusal(
            inBranch(s.branch, '2026-11-03T03:00:00+05:00', (transaction) =>
              transaction.deleteFrom('result_check_differences').execute(),
            ),
          )
        ).code,
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  describe('the purge of a forced delete', () => {
    /** A store row written on 1 October 10:00: its restore time is 31 October 10:00. */
    async function store(s: Scene) {
      return database.migrator.transaction().execute(async (transaction) => {
        await setting(transaction, 'app.now', '2026-10-01T10:00:00+05:00');
        return (
          await transaction
            .insertInto('forced_deletes')
            .values({
              branch_id: s.branch,
              record_type: 'lesson',
              record_id: s.otherLesson,
              rows: JSON.stringify({ lessons: [{ id: s.otherLesson }] }),
              reason: 'Entered by mistake',
              deleted_by: vice,
              deleted_at: new Date(0),
              restore_until: new Date(0),
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      });
    }
    const purge = (s: Scene, id: string, moment: string, rows = '{}') =>
      inBranch(s.branch, moment, (transaction) =>
        transaction
          .updateTable('forced_deletes')
          .set({ rows, purged_at: new Date(moment) })
          .where('id', '=', id)
          .execute(),
      );

    it('empties the kept rows only after the restore time, once', async () => {
      const s = await scene();
      const id = await store(s);
      expect(await refusal(purge(s, id, '2026-10-31T09:59:00+05:00'))).toMatchObject(
        refused('forced_deletes_purge'),
      );
      // Rows other than empty are never written.
      expect(
        await refusal(purge(s, id, '2026-10-31T10:00:00+05:00', '{"lessons":[]}')),
      ).toMatchObject(refused('forced_deletes_purge'));
      await purge(s, id, '2026-10-31T10:00:00+05:00');
      expect(await refusal(purge(s, id, '2026-11-01T10:00:00+05:00'))).toMatchObject(
        refused('forced_deletes_purge'),
      );
    });

    it('never empties a restored one', async () => {
      const s = await scene();
      const id = await store(s);
      await database.migrator.transaction().execute(async (transaction) => {
        await setting(transaction, 'app.now', BEFORE);
        await transaction
          .updateTable('forced_deletes')
          .set({ restored_at: new Date(BEFORE), restored_by: vice })
          .where('id', '=', id)
          .execute();
      });
      expect(await refusal(purge(s, id, NEXT_DAY + 'T10:00:00+05:00'))).toMatchObject(
        refused('forced_deletes_purge'),
      );
    });
  });
});
