import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch, setEditDays } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const INSUFFICIENT_PRIVILEGE = '42501';

/** Wednesday 14 October 2026, the date of the lessons. */
const DAY = '2026-10-14';
/** With 7 edit days: the last minute of 21 October, branch time, is still open. */
const LAST_MINUTE = '2026-10-21T23:59:59+05:00';
/** ... and the lesson is locked from 00:00 of 22 October. */
const LOCKED = '2026-10-22T00:00:00+05:00';
const BEFORE = '2026-10-15T10:00:00+05:00';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// The edit period in the database (db/migrations/0122; task 8.4, pull request #222).
// edge/00-definitions, Lock moment: "23:59 branch time on the lesson's date plus the edit
// days. Fixed per lesson; changing the setting affects only lessons dated after the change."
// edge/journal, Locks, unlocks and corrections; edge/developer-rules, Time-based state.
// Every write is made as `sodiq_app` through the branch filter, at the moment of `clock`.
// All names are invented.
describe('the edit period in the database', () => {
  let database: TestDatabase;
  let clock: FixedClock;
  let transactions: Transactions;
  let kit: LessonsKit;
  let north: string;
  let year: { year: string; quarters: string[] };
  let subject: string;
  let teacher: { staffId: string; accountId: string };
  let colleague: { staffId: string; accountId: string };
  let vice: string;
  let approver: string;

  const inBranch = <T>(
    branch: string,
    moment: string,
    work: (transaction: Transaction) => Promise<T>,
  ): Promise<T> => {
    clock.set(moment);
    return transactions.run([branch], async (transaction) => {
      await transaction
        .insertInto('audit_log')
        .values({ occurred_at: new Date(moment), branch_id: branch, action: 'test.locks' })
        .execute();
      return work(transaction);
    });
  };

  const setting = (transaction: Transaction, name: string, value: string) =>
    sql`select set_config(${name}, ${value}, true)`.execute(transaction);

  let slot = 0;
  /** A lesson of its own block on a date, as the application writes one. */
  async function lesson(branch: string, classId: string, date = DAY): Promise<string> {
    const source = await kit.source(branch, year.year, [
      { classId, groupId: null, subjectId: subject },
    ]);
    slot += 1;
    const start = `${String(7 + (slot % 10)).padStart(2, '0')}:00`;
    const end = `${String(7 + (slot % 10)).padStart(2, '0')}:45`;
    return database.migrator.transaction().execute(async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: branch,
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
          branch_id: branch,
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
    return { classId, student: student ?? '', lesson: await lesson(north, classId) };
  }

  const lockOf = async (lessonId: string) =>
    (
      await sql<{
        lock: Date | null;
      }>`select journal_lesson_lock(${lessonId}::uuid) as lock`.execute(database.migrator)
    ).rows[0]?.lock ?? null;

  /** An attendance cell written as the application at a moment, with the settings given. */
  const mark = (
    moment: string,
    input: { lesson: string; student: string; mark?: number },
    options: { by?: string; how?: string; unlock?: string; reason?: string } = {},
  ) =>
    inBranch(north, moment, async (transaction) => {
      if (options.unlock !== undefined) await setting(transaction, 'app.unlock_id', options.unlock);
      if (options.reason !== undefined) {
        await setting(transaction, 'app.correction_reason', options.reason);
      }
      return transaction
        .insertInto('journal_cells')
        .values({
          branch_id: north,
          lesson_id: input.lesson,
          student_id: input.student,
          work_id: null,
          mark: input.mark ?? 1,
          version: 1,
          changed_by: options.by ?? teacher.accountId,
          changed_how: options.how ?? 'entry',
          changed_at: new Date(0),
        })
        .returning(['id', 'changed_how'])
        .executeTakeFirstOrThrow();
    });

  /** An unlock request of a person on a lesson, written as the application. */
  const request = (lessonId: string, person = teacher) =>
    inBranch(north, BEFORE, (transaction) =>
      transaction
        .insertInto('journal_unlocks')
        .values({
          branch_id: north,
          target: 'lesson',
          lesson_id: lessonId,
          staff_id: person.staffId,
          requested_by: person.accountId,
          reason: 'I was ill that week',
          requested_at: new Date(0),
          status: 'sent',
          version: 1,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );

  const decide = (
    id: string,
    moment: string,
    decision: { status: 'approved'; days: number } | { status: 'refused' | 'withdrawn' },
  ) =>
    inBranch(north, moment, (transaction) =>
      transaction
        .updateTable('journal_unlocks')
        .set({
          status: decision.status,
          days: decision.status === 'approved' ? decision.days : null,
          decided_by: decision.status === 'withdrawn' ? null : approver,
        })
        .where('id', '=', id)
        .returning(['version', 'open_until'])
        .executeTakeFirstOrThrow(),
    );

  /** An approved unlock of the lesson for the person, open for `days` from 22 October. */
  const unlocked = async (lessonId: string, person = teacher, days = 2) => {
    const id = await request(lessonId, person);
    await decide(id, '2026-10-22T09:00:00+05:00', { status: 'approved', days });
    return id;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    clock = new FixedClock(BEFORE);
    transactions = new Transactions(database.app, clock);
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    await setEditDays(database.migrator, north, 7);
    year = await kit.year(north);
    subject = await kit.load.classes.subject({ grades: [7] });
    teacher = await kit.load.classes.person(north, ['uz']);
    colleague = await kit.load.classes.person(north, ['uz']);
    vice = await kit.load.classes.account();
    await kit.load.classes.role(vice, north, 'academic_vice_principal');
    approver = await kit.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the lock moment', () => {
    it('is 00:00 of the branch day after the lesson date plus the edit days', async () => {
      const { lesson: id } = await scene();
      expect((await lockOf(id))?.toISOString()).toBe(new Date(LOCKED).toISOString());
    });

    it('takes an entry at 23:59:59 of the last day and refuses one at 00:00', async () => {
      const { lesson: id, student } = await scene();
      const saved = await mark(LAST_MINUTE, { lesson: id, student });
      expect(saved.changed_how).toBe('entry');
      const { lesson: second, student: next } = await scene();
      const failed = await refusal(mark(LOCKED, { lesson: second, student: next }));
      expect(failed.code).toBe(CHECK_VIOLATION);
      expect(failed.constraint).toBe('journal_locked');
    });

    it('follows a change of the edit days only for lessons dated after the change day', async () => {
      const east = await insertBranch(database.migrator, 'East');
      await setEditDays(database.migrator, east, 7);
      const eastYear = await kit.year(east);
      const classId = await kit.load.classes.schoolClass(east, eastYear.year, { grade: 7 });
      const keepYear = year;
      year = eastYear;
      try {
        const onDay = await lesson(east, classId, '2026-10-20');
        const after = await lesson(east, classId, '2026-10-21');
        const change = (days: number) =>
          inBranch(east, '2026-10-20T12:00:00+05:00', (transaction) =>
            transaction
              .updateTable('branch_settings')
              .set({ edit_days: days })
              .where('branch_id', '=', east)
              .execute(),
          );
        await change(5);
        // Two changes on one day leave the last one (spec review must-fix 3).
        await change(3);
        expect((await lockOf(onDay))?.toISOString()).toBe(
          new Date('2026-10-28T00:00:00+05:00').toISOString(),
        );
        expect((await lockOf(after))?.toISOString()).toBe(
          new Date('2026-10-25T00:00:00+05:00').toISOString(),
        );
        const log = await database.migrator
          .selectFrom('branch_edit_days')
          .select(['edit_days', sql<string>`changed_on::text`.as('day')])
          .where('branch_id', '=', east)
          .orderBy('changed_on')
          .execute();
        expect(log).toEqual([
          { edit_days: 7, day: '-infinity' },
          { edit_days: 3, day: '2026-10-20' },
        ]);
      } finally {
        year = keepYear;
      }
    });

    it('moves with the lesson to its new date', async () => {
      const { lesson: id } = await scene();
      await database.migrator.transaction().execute(async (transaction) => {
        const row = await transaction
          .selectFrom('lessons')
          .select('block_id')
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        await transaction
          .updateTable('lesson_blocks')
          .set({
            lesson_date: '2026-10-16',
            starts_at: at('2026-10-16', '15:00'),
            ends_at: at('2026-10-16', '15:45'),
          })
          .where('id', '=', row.block_id)
          .execute();
        await transaction
          .updateTable('lessons')
          .set({
            lesson_date: '2026-10-16',
            starts_at: at('2026-10-16', '15:00'),
            ends_at: at('2026-10-16', '15:45'),
          })
          .where('id', '=', id)
          .execute();
      });
      expect((await lockOf(id))?.toISOString()).toBe(
        new Date('2026-10-24T00:00:00+05:00').toISOString(),
      );
    });

    it('is lengthened by an extension of its range, and never shortened', async () => {
      // Dates no other test of the file uses: the extension holds for the whole branch.
      const classId = await kit.load.classes.schoolClass(north, year.year, { grade: 7 });
      const inside = { lesson: await lesson(north, classId, '2026-10-13'), classId };
      const outside = await lesson(north, classId, '2026-10-12');
      await inBranch(north, '2026-10-23T09:00:00+05:00', (transaction) =>
        transaction
          .insertInto('journal_edit_extensions')
          .values({
            branch_id: north,
            from_date: '2026-10-13',
            to_date: '2026-10-13',
            days: 2,
            open_until: new Date(0),
            reason: 'The server was down',
            created_by: vice,
            created_at: new Date(0),
          })
          .execute(),
      );
      expect((await lockOf(inside.lesson))?.toISOString()).toBe(
        new Date('2026-10-26T00:00:00+05:00').toISOString(),
      );
      expect((await lockOf(outside))?.toISOString()).toBe(
        new Date('2026-10-20T00:00:00+05:00').toISOString(),
      );
      // An extension shorter than a lesson's own period leaves it as it is.
      const later = await lesson(north, inside.classId, '2026-10-22');
      await inBranch(north, '2026-10-23T10:00:00+05:00', (transaction) =>
        transaction
          .insertInto('journal_edit_extensions')
          .values({
            branch_id: north,
            from_date: '2026-10-22',
            to_date: '2026-10-22',
            days: 1,
            open_until: new Date(0),
            reason: 'The server was down',
            created_by: vice,
            created_at: new Date(0),
          })
          .execute(),
      );
      expect((await lockOf(later))?.toISOString()).toBe(
        new Date('2026-10-30T00:00:00+05:00').toISOString(),
      );
    });

    it('refuses an extension that reaches a day after today', async () => {
      const failed = await refusal(
        inBranch(north, '2026-10-23T09:00:00+05:00', (transaction) =>
          transaction
            .insertInto('journal_edit_extensions')
            .values({
              branch_id: north,
              from_date: '2026-10-20',
              to_date: '2026-10-24',
              days: 2,
              open_until: new Date(0),
              reason: 'Ahead of time',
              created_by: vice,
              created_at: new Date(0),
            })
            .execute(),
        ),
      );
      expect(failed.constraint).toBe('journal_extension_future');
    });
  });

  describe('the guard on cells', () => {
    it('takes a write under an approved unlock of that lesson and person as late_entry', async () => {
      const { lesson: id, student } = await scene();
      const unlock = await unlocked(id);
      const saved = await mark('2026-10-23T10:00:00+05:00', { lesson: id, student }, { unlock });
      expect(saved.changed_how).toBe('late_entry');
      const line = await database.migrator
        .selectFrom('journal_cell_history')
        .select(['changed_how', 'unlock_id'])
        .where('cell_id', '=', saved.id)
        .executeTakeFirstOrThrow();
      expect(line).toEqual({ changed_how: 'late_entry', unlock_id: unlock });
    });

    it("refuses another person's unlock, another lesson's, an expired and a refused one", async () => {
      const { lesson: id, student } = await scene();
      const theirs = await unlocked(id, colleague);
      expect(
        (
          await refusal(
            mark('2026-10-23T10:00:00+05:00', { lesson: id, student }, { unlock: theirs }),
          )
        ).constraint,
      ).toBe('journal_locked');
      const other = await scene();
      const elsewhere = await unlocked(other.lesson);
      expect(
        (
          await refusal(
            mark('2026-10-23T10:00:00+05:00', { lesson: id, student }, { unlock: elsewhere }),
          )
        ).constraint,
      ).toBe('journal_locked');
      // Approved on 22 October for 2 days: open until 00:00 of 25 October.
      const own = await unlocked(id);
      expect(
        (await refusal(mark('2026-10-25T00:00:00+05:00', { lesson: id, student }, { unlock: own })))
          .constraint,
      ).toBe('journal_locked');
      const refused = await request(other.lesson, colleague);
      await decide(refused, '2026-10-22T09:00:00+05:00', { status: 'refused' });
      expect(
        (
          await refusal(
            mark(
              '2026-10-23T10:00:00+05:00',
              { lesson: other.lesson, student: other.student },
              { by: colleague.accountId, unlock: refused },
            ),
          )
        ).constraint,
      ).toBe('journal_locked');
    });

    it('takes an unlock until the last moment before its end', async () => {
      const { lesson: id, student } = await scene();
      const own = await unlocked(id);
      const saved = await mark(
        '2026-10-24T23:59:59+05:00',
        { lesson: id, student },
        { unlock: own },
      );
      expect(saved.changed_how).toBe('late_entry');
    });

    it('judges an offline entry like a live one', async () => {
      const { lesson: id, student } = await scene();
      expect(
        (await refusal(mark(LOCKED, { lesson: id, student }, { how: 'offline_entry' }))).constraint,
      ).toBe('journal_locked');
    });

    it('takes a correction of the Academic Vice Principal with its reason, at any moment', async () => {
      const { lesson: id, student } = await scene();
      const saved = await mark(
        LOCKED,
        { lesson: id, student, mark: 0 },
        { by: vice, reason: 'The register shows an absence' },
      );
      expect(saved.changed_how).toBe('correction');
      const line = await database.migrator
        .selectFrom('journal_cell_history')
        .select(['changed_how', 'reason', 'unlock_id'])
        .where('cell_id', '=', saved.id)
        .executeTakeFirstOrThrow();
      expect(line).toEqual({
        changed_how: 'correction',
        reason: 'The register shows an absence',
        unlock_id: null,
      });
    });

    it('refuses a correction without a reason, and one by someone who does not correct', async () => {
      const { lesson: id, student } = await scene();
      expect(
        (await refusal(mark(LOCKED, { lesson: id, student }, { by: vice, how: 'correction' })))
          .constraint,
      ).toBe('journal_correction_reason');
      expect(
        (await refusal(mark(LOCKED, { lesson: id, student }, { by: vice, reason: '   ' })))
          .constraint,
      ).toBe('journal_correction_reason');
      expect(
        (await refusal(mark(LOCKED, { lesson: id, student }, { reason: 'A teacher tries' })))
          .constraint,
      ).toBe('journal_correction_role');
    });

    it('takes a write of the system after the lock', async () => {
      for (const how of ['exemption', 'cancellation']) {
        const { lesson: id, student } = await scene();
        const saved = await mark(LOCKED, { lesson: id, student }, { how });
        expect(saved.changed_how).toBe(how);
      }
    });

    it('refuses a write of the application without the moment', async () => {
      const { lesson: id, student } = await scene();
      const failed = await refusal(
        database.app.transaction().execute(async (transaction) => {
          await sql`select set_config('app.branch_ids', ${`{${north}}`}, true)`.execute(
            transaction,
          );
          await transaction
            .insertInto('journal_cells')
            .values({
              branch_id: north,
              lesson_id: id,
              student_id: student,
              mark: 1,
              version: 1,
              changed_by: teacher.accountId,
              changed_how: 'entry',
              changed_at: new Date(0),
            })
            .execute();
        }),
      );
      expect(failed.constraint).toBe('journal_cell_moment');
    });
  });

  describe('the guard on works and comments', () => {
    const work = (moment: string, lessonId: string) =>
      inBranch(north, moment, (transaction) =>
        transaction
          .insertInto('journal_works')
          .values({
            branch_id: north,
            lesson_id: lessonId,
            source_lesson_id: lessonId,
            kind: 'homework',
            changed_by: teacher.accountId,
            changed_how: 'entry',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
          .then((row) => row.id),
      );

    it('refuses a carry, a total and the delete of a work after the lock', async () => {
      const { lesson: id, classId } = await scene();
      const next = await lesson(north, classId, '2026-10-21');
      const homework = await work(BEFORE, id);
      const carry = await refusal(
        inBranch(north, LOCKED, (transaction) =>
          transaction
            .updateTable('journal_works')
            .set({
              carried_from_lesson_id: id,
              changed_by: teacher.accountId,
              changed_how: 'carry',
            })
            .where('id', '=', homework)
            .execute(),
        ),
      );
      expect(carry.constraint).toBe('journal_locked');
      const total = await refusal(
        inBranch(north, LOCKED, (transaction) =>
          transaction
            .updateTable('journal_works')
            .set({ total: 10, changed_by: teacher.accountId, changed_how: 'entry' })
            .where('id', '=', homework)
            .execute(),
        ),
      );
      expect(total.constraint).toBe('journal_locked');
      const removed = await refusal(
        inBranch(north, LOCKED, (transaction) =>
          transaction.deleteFrom('journal_works').where('id', '=', homework).execute(),
        ),
      );
      expect(removed.constraint).toBe('journal_locked');
      // The next lesson is still open: the work's own lesson decides (should-fix 3).
      expect(next).not.toBe(id);
    });

    it('writes a carry under an unlock as late_entry with the unlock in its line', async () => {
      const { lesson: id } = await scene();
      const homework = await work(BEFORE, id);
      const unlock = await unlocked(id);
      await inBranch(north, '2026-10-23T10:00:00+05:00', async (transaction) => {
        await setting(transaction, 'app.unlock_id', unlock);
        await transaction
          .updateTable('journal_works')
          .set({ total: 10, changed_by: teacher.accountId, changed_how: 'entry' })
          .where('id', '=', homework)
          .execute();
      });
      const line = await database.migrator
        .selectFrom('journal_work_history')
        .select(['changed_how', 'unlock_id', 'total_after'])
        .where('work_id', '=', homework)
        .executeTakeFirstOrThrow();
      expect(line).toEqual({ changed_how: 'late_entry', unlock_id: unlock, total_after: 10 });
    });

    it('judges a note at its lesson', async () => {
      const { lesson: id, student } = await scene();
      const note = (moment: string) =>
        inBranch(north, moment, (transaction) =>
          transaction
            .insertInto('journal_comments')
            .values({
              branch_id: north,
              student_id: student,
              target: 'note',
              lesson_id: id,
              body: 'Helped a classmate',
              visibility: 'staff',
              version: 1,
              changed_by: teacher.accountId,
              changed_how: 'entry',
              changed_at: new Date(0),
            })
            .returning('changed_how')
            .executeTakeFirstOrThrow(),
        );
      expect((await refusal(note(LOCKED))).constraint).toBe('journal_locked');
      expect((await note(LAST_MINUTE)).changed_how).toBe('entry');
    });
  });

  describe('the rating exam', () => {
    async function exam() {
      const { classId, student } = await scene();
      const rated = await kit.load.classes.subject({ grades: [7], journalType: 'graded' });
      await database.migrator
        .updateTable('subjects')
        .set({ rating_exam: true })
        .where('id', '=', rated)
        .execute();
      const journal = await database.migrator
        .insertInto('journals')
        .values({
          branch_id: north,
          academic_year_id: year.year,
          class_id: classId,
          subject_id: rated,
          runs: sql`'{[2026-09-01,)}'::datemultirange`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const row = await inBranch(north, BEFORE, (transaction) =>
        transaction
          .insertInto('journal_rating_exams')
          .values({
            branch_id: north,
            journal_id: journal.id,
            quarter_id: year.quarters[0] ?? '',
            exam_date: DAY,
            version: 1,
            changed_by: teacher.accountId,
            changed_at: new Date(0),
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
      return { id: row.id, student };
    }

    const entry = (
      moment: string,
      examId: string,
      student: string,
      values: { kind: string; score?: number; how?: string; reason?: string; by?: string },
    ) =>
      inBranch(north, moment, (transaction) =>
        transaction
          .insertInto('journal_rating_entries')
          .values({
            branch_id: north,
            rating_exam_id: examId,
            student_id: student,
            kind: values.kind,
            score: values.score ?? null,
            reason: values.reason ?? null,
            version: 1,
            changed_by: values.by ?? teacher.accountId,
            changed_how: values.how ?? 'entry',
            changed_at: new Date(0),
          })
          .returning('changed_how')
          .executeTakeFirstOrThrow(),
      );

    it('locks an entry from the lock of the date in force', async () => {
      const one = await exam();
      expect(
        (await entry(LAST_MINUTE, one.id, one.student, { kind: 'score', score: 70 })).changed_how,
      ).toBe('entry');
      const two = await exam();
      expect(
        (await refusal(entry(LOCKED, two.id, two.student, { kind: 'score', score: 70 })))
          .constraint,
      ).toBe('journal_locked');
    });

    it('takes a correction of a score with its own reason, and "exempt" of the Academic Vice Principal', async () => {
      const one = await exam();
      expect(
        (
          await entry(LOCKED, one.id, one.student, {
            kind: 'score',
            score: 64,
            how: 'correction',
            reason: 'A late sitting',
            by: vice,
          })
        ).changed_how,
      ).toBe('correction');
      expect(
        (
          await refusal(
            entry(LOCKED, one.id, (await scene()).student, {
              kind: 'score',
              score: 64,
              how: 'correction',
              by: vice,
            }),
          )
        ).constraint,
      ).toBe('journal_correction_reason');
      const two = await exam();
      expect(
        (await entry(LOCKED, two.id, two.student, { kind: 'exempt', by: vice })).changed_how,
      ).toBe('entry');
    });

    it('lets only the Academic Vice Principal change the date and "not held" once locked', async () => {
      const one = await exam();
      const setDate = (moment: string, by: string) =>
        inBranch(north, moment, (transaction) =>
          transaction
            .updateTable('journal_rating_exams')
            .set({ exam_date: '2026-10-15', changed_by: by })
            .where('id', '=', one.id)
            .execute(),
        );
      expect((await refusal(setDate(LOCKED, teacher.accountId))).constraint).toBe('journal_locked');
      const notHeld = (moment: string, by: string) =>
        inBranch(north, moment, (transaction) =>
          transaction
            .updateTable('journal_rating_exams')
            .set({ not_held: true, changed_by: by })
            .where('id', '=', one.id)
            .execute(),
        );
      // Decision 6 as the review changed it: "not held" is judged by the exam's window.
      expect((await refusal(notHeld(LOCKED, teacher.accountId))).constraint).toBe('journal_locked');
      await setDate(LAST_MINUTE, teacher.accountId);
      await notHeld('2026-10-30T10:00:00+05:00', vice);
      const row = await database.migrator
        .selectFrom('journal_rating_exams')
        .select(['not_held', sql<string>`exam_date::text`.as('date')])
        .where('id', '=', one.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ not_held: true, date: '2026-10-15' });
    });
  });

  describe('unlock requests', () => {
    it('keeps one waiting request of a person per lesson', async () => {
      const { lesson: id } = await scene();
      await request(id);
      const failed = await refusal(request(id));
      expect(failed.code).toBe(UNIQUE_VIOLATION);
      expect(failed.constraint).toBe('journal_unlocks_lesson_waiting_key');
      await request(id, colleague);
    });

    it('decides a request once, and stores the end of an approval from the decision day', async () => {
      const { lesson: id } = await scene();
      const sent = await request(id);
      const approved = await decide(sent, '2026-10-22T23:30:00+05:00', {
        status: 'approved',
        days: 1,
      });
      expect(approved.version).toBe(2);
      expect(approved.open_until?.toISOString()).toBe(
        new Date('2026-10-24T00:00:00+05:00').toISOString(),
      );
      expect(
        (await refusal(decide(sent, '2026-10-23T09:00:00+05:00', { status: 'refused' })))
          .constraint,
      ).toBe('journal_unlock_decided');
      expect(
        (await refusal(decide(sent, '2026-10-23T09:00:00+05:00', { status: 'withdrawn' })))
          .constraint,
      ).toBe('journal_unlock_decided');
    });

    it('refuses a decision by the requester', async () => {
      const { lesson: id } = await scene();
      const sent = await request(id);
      const failed = await refusal(
        inBranch(north, BEFORE, (transaction) =>
          transaction
            .updateTable('journal_unlocks')
            .set({ status: 'approved', days: 1, decided_by: teacher.accountId })
            .where('id', '=', sent)
            .execute(),
        ),
      );
      expect(failed.constraint).toBe('journal_unlock_own');
    });

    it('ties each status to its columns', async () => {
      const { lesson: id } = await scene();
      const sent = await request(id);
      const failed = await refusal(
        inBranch(north, BEFORE, (transaction) =>
          transaction
            .updateTable('journal_unlocks')
            .set({ status: 'approved', decided_by: approver })
            .where('id', '=', sent)
            .execute(),
        ),
      );
      expect(failed.constraint).toBe('journal_unlocks_decision_check');
    });

    it('refuses a request in the name of another person', async () => {
      const { lesson: id } = await scene();
      const failed = await refusal(
        inBranch(north, BEFORE, (transaction) =>
          transaction
            .insertInto('journal_unlocks')
            .values({
              branch_id: north,
              target: 'lesson',
              lesson_id: id,
              staff_id: colleague.staffId,
              requested_by: teacher.accountId,
              reason: 'For a colleague',
              requested_at: new Date(0),
              status: 'sent',
              version: 1,
            })
            .execute(),
        ),
      );
      expect(failed.constraint).toBe('journal_unlock_write');
    });

    it('cannot be deleted by the application, nor the log of the edit days written directly', async () => {
      const { lesson: id } = await scene();
      const sent = await request(id);
      const deleted = await refusal(
        inBranch(north, BEFORE, (transaction) =>
          transaction.deleteFrom('journal_unlocks').where('id', '=', sent).execute(),
        ),
      );
      expect(deleted.code).toBe(INSUFFICIENT_PRIVILEGE);
      const direct = await refusal(
        inBranch(north, BEFORE, (transaction) =>
          transaction
            .updateTable('branch_edit_days')
            .set({ edit_days: 30 })
            .where('branch_id', '=', north)
            .execute(),
        ),
      );
      expect(direct.constraint).toBe('branch_edit_days_direct');
    });
  });
});
