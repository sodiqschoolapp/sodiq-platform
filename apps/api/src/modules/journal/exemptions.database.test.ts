import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch, setEditDays } from '../../testing/branch-filter-sql.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';

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

interface ExemptionValues {
  student: string;
  kind?: 'temporary' | 'full';
  from: string;
  until: string;
  times?: readonly [string, string];
  subjects?: readonly string[];
}

// Exemptions in the database (db/migrations/0123; task 8.5, pull request
// #223). 07, Exemptions; edge/exemptions; edge/00-definitions, Expected
// student. Every write is made as `sodiq_app` through the branch filter. All
// names are invented.
describe('exemptions in the database', () => {
  let database: TestDatabase;
  let cells: CellsKit;
  let north: string;
  let south: string;
  let northYear: string;
  let account: string;
  let physics: string;

  const transactionsAt = (moment: string) => new Transactions(database.app, new FixedClock(moment));
  const inBranch = <T>(
    branch: string,
    work: (transaction: Transaction) => Promise<T>,
    moment = NOW,
  ) => transactionsAt(moment).run([branch], work);

  const audited = (transaction: Transaction, branch: string) =>
    transaction
      .insertInto('audit_log')
      .values({ occurred_at: new Date(NOW), branch_id: branch, action: 'test.exemptions' })
      .execute();

  /** An exemption written as the service writes one. */
  async function exemption(
    transaction: Transaction,
    branch: string,
    year: string,
    input: ExemptionValues,
  ): Promise<string> {
    const row = await transaction
      .insertInto('exemptions')
      .values({
        branch_id: branch,
        student_id: input.student,
        year_id: year,
        batch_id: '019a0000-0000-7000-8000-000000000001',
        kind: input.kind ?? 'temporary',
        all_subjects: input.subjects === undefined,
        start_date: input.from,
        end_date: input.until,
        start_time: input.times?.[0] ?? null,
        end_time: input.times?.[1] ?? null,
        category: 'illness',
        detail: 'A certificate from the clinic',
        granted_by: account,
        granted_at: new Date(0),
        version: 0,
        changed_at: new Date(0),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const subject of input.subjects ?? []) {
      await transaction
        .insertInto('exemption_subjects')
        .values({ branch_id: branch, exemption_id: row.id, subject_id: subject })
        .execute();
    }
    return row.id;
  }

  const add = (input: ExemptionValues, branch = north, year = northYear, moment = NOW) =>
    inBranch(branch, (transaction) => exemption(transaction, branch, year, input), moment);

  const expected = (lesson: string, student: string) =>
    sql<{ expected: boolean; kind: string | null }>`
      select lesson_student_expected(${lesson}::uuid, ${student}::uuid) as expected,
        lesson_student_exemption(${lesson}::uuid, ${student}::uuid) as kind
    `
      .execute(database.migrator)
      .then((found) => found.rows[0]);

  /** A class of grade 7 with one student from 1 September and a lesson of it on the date. */
  async function scene(date = '2026-10-14') {
    const classId = await cells.lessons.load.classes.schoolClass(north, northYear, { grade: 7 });
    const [student] = await cells.lessons.pupils(north, classId, 1);
    const lesson = await cells.lesson(north, northYear, classId, date);
    return { classId, student: student ?? '', lesson };
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    cells = await CellsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    northYear = (await cells.lessons.year(north)).year;
    await cells.lessons.year(south);
    account = await cells.lessons.load.classes.account();
    physics = await cells.lessons.load.classes.subject({ grades: [7] });
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the overlap (edge/exemptions, row 1)', () => {
    it('refuses two all-subject exemptions whose days overlap', async () => {
      const { student } = await scene();
      await add({ student, from: '2026-10-20', until: '2026-10-22' });
      const refused = await refusal(add({ student, from: '2026-10-22', until: '2026-10-23' }));
      expect(refused).toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'exemption_spans_no_overlap',
      });
    });

    it('refuses two that name the same subject', async () => {
      const { student } = await scene();
      await add({ student, from: '2026-10-20', until: '2026-10-22', subjects: [physics] });
      const refused = await refusal(
        add({ student, from: '2026-10-21', until: '2026-10-21', subjects: [physics] }),
      );
      expect(refused).toMatchObject({ constraint: 'exemption_spans_no_overlap' });
    });

    it('takes a year-long subject exemption and a short all-subjects one together', async () => {
      const { student } = await scene();
      await add({
        student,
        kind: 'full',
        from: '2026-10-20',
        until: '2027-05-31',
        subjects: [physics],
      });
      await expect(add({ student, from: '2026-11-10', until: '2026-11-12' })).resolves.toBeTypeOf(
        'string',
      );
    });

    it('takes two slot exemptions of one day whose times are apart (decision 7)', async () => {
      const { student } = await scene();
      await add({ student, from: '2026-10-21', until: '2026-10-21', times: ['08:00', '10:00'] });
      await expect(
        add({ student, from: '2026-10-21', until: '2026-10-21', times: ['12:00', '14:00'] }),
      ).resolves.toBeTypeOf('string');
      const refused = await refusal(
        add({ student, from: '2026-10-21', until: '2026-10-21', times: ['09:00', '12:30'] }),
      );
      expect(refused).toMatchObject({ constraint: 'exemption_spans_no_overlap' });
    });

    it('takes an overlapping one once the first is voided', async () => {
      const { student } = await scene();
      const first = await add({ student, from: '2026-10-26', until: '2026-10-28' });
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('exemptions')
          .set({
            voided_at: new Date(NOW),
            voided_by: account,
            void_cause: 'error',
            void_reason: 'Entered for the wrong student',
          })
          .where('id', '=', first)
          .execute(),
      );
      await expect(add({ student, from: '2026-10-26', until: '2026-10-28' })).resolves.toBeTypeOf(
        'string',
      );
    });

    it('meets an exemption of the student in another branch', async () => {
      const { student } = await scene();
      await add({ student, from: '2026-11-10', until: '2026-11-11' });
      const southYear = await database.migrator
        .selectFrom('academic_years')
        .select('id')
        .where('branch_id', '=', south)
        .executeTakeFirstOrThrow();
      const refused = await refusal(
        add({ student, from: '2026-11-11', until: '2026-11-12' }, south, southYear.id),
      );
      expect(refused).toMatchObject({ constraint: 'exemption_spans_no_overlap' });
    });
  });

  describe('the shape', () => {
    it('refuses a slot exemption of chosen subjects (row 2: "covers every subject in that time")', async () => {
      const { student } = await scene();
      const refused = await refusal(
        add({
          student,
          from: '2026-10-21',
          until: '2026-10-21',
          times: ['08:00', '10:00'],
          subjects: [physics],
        }),
      );
      expect(refused).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'exemptions_slots_check',
      });
    });

    it('refuses a full exemption for chosen slots (row 2: "Not offered")', async () => {
      const { student } = await scene();
      const refused = await refusal(
        add({
          student,
          kind: 'full',
          from: '2027-05-31',
          until: '2027-05-31',
          times: ['08:00', '10:00'],
        }),
      );
      expect(refused).toMatchObject({ constraint: 'exemptions_slots_check' });
    });

    it('enters a full exemption to the last day of its year only (07, Kind)', async () => {
      const { student } = await scene();
      const refused = await refusal(
        add({ student, kind: 'full', from: '2026-10-21', until: '2027-03-01' }),
      );
      expect(refused).toMatchObject({ constraint: 'exemption_full_end' });
    });

    it('refuses an end past the last day of the year (row 7: "No exemption extends past ...")', async () => {
      const { student } = await scene();
      const refused = await refusal(add({ student, from: '2027-05-01', until: '2027-06-15' }));
      expect(refused).toMatchObject({ constraint: 'exemption_outside_year' });
    });

    it('refuses chosen subjects with none named, at the commit', async () => {
      const { student } = await scene();
      const refused = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('exemptions')
            .values({
              branch_id: north,
              student_id: student,
              year_id: northYear,
              batch_id: '019a0000-0000-7000-8000-000000000002',
              kind: 'temporary',
              all_subjects: false,
              start_date: '2026-11-02',
              end_date: '2026-11-03',
              category: 'family',
              detail: 'A family event',
              granted_by: account,
              granted_at: new Date(0),
              version: 0,
              changed_at: new Date(0),
            })
            .execute(),
        ),
      );
      expect(refused).toMatchObject({ constraint: 'exemption_subjects_missing' });
    });

    it('changes only the end after the start (row 4)', async () => {
      const { student } = await scene();
      const id = await add({ student, from: '2026-10-12', until: '2026-10-16' });
      const refused = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('exemptions')
            .set({ category: 'family' })
            .where('id', '=', id)
            .execute(),
        ),
      );
      expect(refused).toMatchObject({ constraint: 'exemption_started' });
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('exemptions')
          .set({ end_date: '2026-10-15' })
          .where('id', '=', id)
          .execute(),
      );
      const row = await database.migrator
        .selectFrom('exemptions')
        .select(['end_date', 'version'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ end_date: '2026-10-15', version: 2 });
    });

    it('keeps a void final', async () => {
      const { student } = await scene();
      const id = await add({ student, from: '2026-11-16', until: '2026-11-18' });
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('exemptions')
          .set({
            voided_at: new Date(NOW),
            voided_by: account,
            void_cause: 'error',
            void_reason: 'Entered for the wrong student',
          })
          .where('id', '=', id)
          .execute(),
      );
      const refused = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('exemptions')
            .set({ end_date: '2026-11-17' })
            .where('id', '=', id)
            .execute(),
        ),
      );
      expect(refused).toMatchObject({ constraint: 'exemption_voided' });
    });

    it('refuses a write of a closed year', async () => {
      const branch = await insertBranch(database.migrator, 'Closed');
      const year = await cells.lessons.load.classes.year(
        branch,
        'current',
        '2025-09-01',
        '2026-05-31',
      );
      const student = await cells.lessons.members.student(branch, { startsOn: '2025-09-01' });
      await cells.lessons.load.classes.setYear(year, 'closed');
      const refused = await refusal(
        add({ student, from: '2026-03-02', until: '2026-03-03' }, branch, year),
      );
      expect(refused).toMatchObject({ constraint: 'exemption_closed_year' });
    });

    it('refuses a direct write of a span', async () => {
      const { student } = await scene();
      const id = await add({ student, from: '2026-12-01', until: '2026-12-02' });
      const refused = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('exemption_spans')
            .values({
              branch_id: north,
              exemption_id: id,
              student_id: student,
              subject_key: physics,
              span: '[2026-12-01,2026-12-02)',
              live: true,
            })
            .execute(),
        ),
      );
      expect(refused).toMatchObject({ constraint: 'exemption_spans_direct' });
    });
  });

  describe('who is expected (edge/00-definitions)', () => {
    it('takes an exempt student out of the lesson, 5 when one covering exemption is full (row 1)', async () => {
      const { student, lesson } = await scene('2026-10-27');
      expect(await expected(lesson, student)).toEqual({ expected: true, kind: null });
      await add({ student, from: '2026-10-26', until: '2026-10-28' });
      expect(await expected(lesson, student)).toEqual({ expected: false, kind: 'temporary' });
      await add({
        student,
        kind: 'full',
        from: '2026-10-19',
        until: '2027-05-31',
        subjects: [cells.subject],
      });
      expect(await expected(lesson, student)).toEqual({ expected: false, kind: 'full' });
    });

    it('leaves a lesson of another subject open under a subject exemption', async () => {
      const { student, lesson } = await scene('2026-11-11');
      await add({ student, from: '2026-11-10', until: '2026-11-13', subjects: [physics] });
      expect(await expected(lesson, student)).toEqual({ expected: true, kind: null });
    });

    it('keeps the cell closed while another exemption still covers it (row 1)', async () => {
      const { student, lesson } = await scene('2026-11-12');
      const short = await add({ student, from: '2026-11-12', until: '2026-11-13' });
      await add({ student, from: '2026-11-12', until: '2026-11-12', subjects: [cells.subject] });
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('exemptions')
          .set({
            voided_at: new Date(NOW),
            voided_by: account,
            void_cause: 'error',
            void_reason: 'Entered twice',
          })
          .where('id', '=', short)
          .execute(),
      );
      expect(await expected(lesson, student)).toEqual({ expected: false, kind: 'temporary' });
    });

    it('opens a lesson the late-entry choice kept as attended', async () => {
      const { student, lesson } = await scene('2026-10-13');
      const id = await add({ student, from: '2026-10-12', until: '2026-10-13' });
      await inBranch(north, (transaction) =>
        transaction
          .insertInto('exemption_skips')
          .values({ branch_id: north, exemption_id: id, lesson_id: lesson })
          .execute(),
      );
      expect(await expected(lesson, student)).toEqual({ expected: true, kind: null });
    });

    it('covers a lesson moved into a slot range and reopens one moved out (row 3)', async () => {
      const { student, lesson } = await scene('2026-10-30');
      const moveTo = (start: string, end: string) =>
        database.migrator.transaction().execute(async (transaction) => {
          const block = await transaction
            .selectFrom('lessons')
            .select('block_id')
            .where('id', '=', lesson)
            .executeTakeFirstOrThrow();
          await transaction
            .updateTable('lesson_blocks')
            .set({ starts_at: at('2026-10-30', start), ends_at: at('2026-10-30', end) })
            .where('id', '=', block.block_id)
            .execute();
          await transaction
            .updateTable('lessons')
            .set({ starts_at: at('2026-10-30', start), ends_at: at('2026-10-30', end) })
            .where('id', '=', lesson)
            .execute();
        });
      await moveTo('08:00', '08:45');
      await add({ student, from: '2026-10-30', until: '2026-10-30', times: ['11:00', '13:00'] });
      expect(await expected(lesson, student)).toEqual({ expected: true, kind: null });
      // Partly inside the range: "Any held lesson ... that overlaps it is exempt".
      await moveTo('10:30', '11:15');
      expect(await expected(lesson, student)).toEqual({ expected: false, kind: 'temporary' });
      await moveTo('13:00', '13:45');
      expect(await expected(lesson, student)).toEqual({ expected: true, kind: null });
    });
  });

  describe('the cells (edge/exemptions, row 14: "Someone tries to type 4 or 5")', () => {
    const typed = (lesson: string, student: string, mark: number, moment = NOW) =>
      inBranch(
        north,
        async (transaction) => {
          await audited(transaction, north);
          await transaction
            .insertInto('journal_cells')
            .values({
              branch_id: north,
              lesson_id: lesson,
              student_id: student,
              mark,
              version: 1,
              changed_by: account,
              changed_how: 'entry',
              changed_at: new Date(0),
            })
            .execute();
        },
        moment,
      );

    it('refuses a typed mark in an exempt cell', async () => {
      const { student, lesson } = await scene('2026-10-14');
      await add({ student, from: '2026-10-14', until: '2026-10-14' });
      expect(await refusal(typed(lesson, student, 1))).toMatchObject({
        constraint: 'journal_cell_not_member',
      });
    });

    it('refuses 4 and 5 in any cell', async () => {
      const { student, lesson } = await scene('2026-10-14');
      for (const mark of [4, 5]) {
        expect(await refusal(typed(lesson, student, mark))).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'journal_cells_mark_check',
        });
      }
    });

    it('opens a reopened cell of a locked lesson as a late entry until its end, for that cell only (decision 5)', async () => {
      const branch = await insertBranch(database.migrator, 'Reopen');
      const { year } = await cells.lessons.year(branch);
      await setEditDays(database.migrator, branch, 7);
      const classId = await cells.lessons.load.classes.schoolClass(branch, year, { grade: 7 });
      const [student, other] = await cells.lessons.pupils(branch, classId, 2);
      const lesson = await cells.lesson(branch, year, classId, '2026-10-01');
      const id = await add(
        { student: student ?? '', from: '2026-10-01', until: '2026-10-02' },
        branch,
        year,
      );
      await inBranch(branch, async (transaction) => {
        await transaction
          .updateTable('exemptions')
          .set({
            voided_at: new Date(NOW),
            voided_by: account,
            void_cause: 'error',
            void_reason: 'Entered for the wrong dates',
          })
          .where('id', '=', id)
          .execute();
        await transaction
          .insertInto('exemption_reopened_cells')
          .values({
            branch_id: branch,
            exemption_id: id,
            lesson_id: lesson,
            student_id: student ?? '',
            reopened_at: new Date(NOW),
            open_until: new Date('2026-10-19T00:00:00+05:00'),
          })
          .execute();
      });
      const write = (who: string, moment: string) =>
        inBranch(
          branch,
          async (transaction) => {
            await audited(transaction, branch);
            return transaction
              .insertInto('journal_cells')
              .values({
                branch_id: branch,
                lesson_id: lesson,
                student_id: who,
                mark: 1,
                version: 1,
                changed_by: account,
                changed_how: 'entry',
                changed_at: new Date(0),
              })
              .returning(['id', 'changed_how'])
              .executeTakeFirstOrThrow();
          },
          moment,
        );
      expect(await refusal(write(other ?? '', '2026-10-18T23:59:00+05:00'))).toMatchObject({
        constraint: 'journal_locked',
      });
      const written = await write(student ?? '', '2026-10-18T23:59:00+05:00');
      expect(written.changed_how).toBe('late_entry');
      await database.migrator
        .deleteFrom('journal_cell_history')
        .where('cell_id', '=', written.id)
        .execute()
        .catch(() => undefined);
      const after = await refusal(
        inBranch(
          branch,
          async (transaction) => {
            await audited(transaction, branch);
            await transaction
              .updateTable('journal_cells')
              .set({ mark: 0, changed_by: account, changed_how: 'entry' })
              .where('id', '=', written.id)
              .execute();
          },
          '2026-10-19T00:00:00+05:00',
        ),
      );
      expect(after).toMatchObject({ constraint: 'journal_locked' });
    });
  });

  describe('the kept blocks (decision 12)', () => {
    /** Classes A (grade 7) and B (grade 8), one student each, and a group of both with its lesson on the date. */
    async function shared(date: string, withB = true) {
      const classA = await cells.lessons.load.classes.schoolClass(north, northYear, { grade: 7 });
      const classB = await cells.lessons.load.classes.schoolClass(north, northYear, { grade: 8 });
      const [a] = await cells.lessons.pupils(north, classA, 1);
      const b = await cells.lessons.members.student(north, { grade: 8, startsOn: '2026-09-01' });
      await cells.lessons.members.member({
        branch: north,
        classId: classB,
        studentId: b,
        from: '2026-09-01',
      });
      const group = await cells.lessons.load.classes.group(north, northYear, cells.subject, [
        classA,
        classB,
      ]);
      for (const student of withB ? [a ?? '', b] : [a ?? '']) {
        await cells.lessons.inGroup(north, group, cells.subject, student);
      }
      const lesson = await cells.groupLesson(north, northYear, group, date);
      const row = await database.migrator
        .selectFrom('lessons')
        .select(['block_id', 'starts_at', 'ends_at', 'lesson_date'])
        .where('id', '=', lesson)
        .executeTakeFirstOrThrow();
      return { classA, classB, a: a ?? '', b, group, lesson, row };
    }

    it('takes the chosen class out of a block a bulk cancel kept (From 5.6a-3)', async () => {
      const { classA, a, b, lesson, row } = await shared('2026-10-20');
      await database.migrator.transaction().execute(async (transaction) => {
        const cancel = await transaction
          .insertInto('bulk_cancels')
          .values({
            branch_id: north,
            cancel_date: row.lesson_date,
            lesson_numbers: [1],
            reason: 'Excursion',
            changed_at: new Date(NOW),
            changed_by: account,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('bulk_cancel_classes')
          .values({ branch_id: north, bulk_cancel_id: cancel.id, class_id: classA })
          .execute();
        await transaction
          .insertInto('bulk_cancel_spans')
          .values({
            branch_id: north,
            bulk_cancel_id: cancel.id,
            class_id: classA,
            lesson_number: 1,
            starts_at: row.starts_at,
            ends_at: row.ends_at,
          })
          .execute();
        await transaction
          .insertInto('bulk_cancel_blocks')
          .values({
            branch_id: north,
            bulk_cancel_id: cancel.id,
            block_id: row.block_id,
            choice: 'keep',
            lesson_date: row.lesson_date,
            starts_at: row.starts_at,
            ends_at: row.ends_at,
          })
          .execute();
      });
      expect(await expected(lesson, a)).toEqual({ expected: false, kind: 'temporary' });
      expect(await expected(lesson, b)).toEqual({ expected: true, kind: null });
    });

    it('takes nobody out of a lesson fed by the chosen classes alone (From 6.1b-2)', async () => {
      const { classA, a, lesson, row } = await shared('2026-10-21', false);
      // Only a student of class A is a member: the lesson is fed by class A alone.
      await database.migrator.transaction().execute(async (transaction) => {
        const cancel = await transaction
          .insertInto('bulk_cancels')
          .values({
            branch_id: north,
            cancel_date: row.lesson_date,
            lesson_numbers: [1],
            reason: 'Excursion',
            changed_at: new Date(NOW),
            changed_by: account,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('bulk_cancel_classes')
          .values({ branch_id: north, bulk_cancel_id: cancel.id, class_id: classA })
          .execute();
        await transaction
          .insertInto('bulk_cancel_spans')
          .values({
            branch_id: north,
            bulk_cancel_id: cancel.id,
            class_id: classA,
            lesson_number: 1,
            starts_at: row.starts_at,
            ends_at: row.ends_at,
          })
          .execute();
        await transaction
          .insertInto('bulk_cancel_blocks')
          .values({
            branch_id: north,
            bulk_cancel_id: cancel.id,
            block_id: row.block_id,
            choice: 'keep',
            lesson_date: row.lesson_date,
            starts_at: row.starts_at,
            ends_at: row.ends_at,
          })
          .execute();
      });
      expect(await expected(lesson, a)).toEqual({ expected: true, kind: null });
    });

    it('takes the grade that is off out of a two-grade group kept on a day off (From 5.6b-3)', async () => {
      const { a, b, lesson, row, group } = await shared('2026-10-22');
      await database.migrator.transaction().execute(async (transaction) => {
        await sql`select set_config('app.now', ${NOW}, true)`.execute(transaction);
        const entry = await transaction
          .insertInto('calendar_entries')
          .values({
            branch_id: north,
            kind: 'day_off',
            name: 'Grade 8 trip',
            first_date: row.lesson_date,
            last_date: row.lesson_date,
            grade_from: 8,
            grade_to: 8,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const local = new Date(row.starts_at);
        const minutes = (local.getUTCHours() + 5) * 60 + local.getUTCMinutes();
        const kept = await transaction
          .insertInto('calendar_group_blocks')
          .values({
            branch_id: north,
            calendar_entry_id: entry.id,
            lesson_date: row.lesson_date,
            weekday: 4,
            start_minutes: minutes,
            end_minutes: minutes + 45,
            choice: 'keep',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('calendar_group_block_groups')
          .values({
            branch_id: north,
            block_id: kept.id,
            group_id: group,
            calendar_entry_id: entry.id,
            lesson_date: row.lesson_date,
            start_minutes: minutes,
          })
          .execute();
      });
      expect(await expected(lesson, b)).toEqual({ expected: false, kind: 'temporary' });
      expect(await expected(lesson, a)).toEqual({ expected: true, kind: null });
    });

    it('takes a class a standing exam keeps out of the block, while the exam stands (From 5.6c-1)', async () => {
      const { classA, a, b, lesson, row } = await shared('2026-10-23');
      const room = await cells.lessons.room(north);
      const { staffId: staff } = await cells.lessons.load.classes.person(north, ['uz']);
      const exam = await database.migrator.transaction().execute(async (transaction) => {
        const written = await transaction
          .insertInto('exams')
          .values({
            branch_id: north,
            academic_year_id: northYear,
            exam_date: row.lesson_date,
            starts_at: row.starts_at,
            ends_at: row.ends_at,
            first_slot: 1,
            last_slot: 1,
            title: 'Quarter exam',
            subject_id: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('lesson_block_class_outs')
          .values({
            branch_id: north,
            block_id: row.block_id,
            class_id: classA,
            exam_id: written.id,
          })
          .execute();
        const examRoom = await transaction
          .insertInto('exam_rooms')
          .values({ branch_id: north, exam_id: written.id, room_id: room })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('exam_room_classes')
          .values({
            branch_id: north,
            exam_id: written.id,
            exam_room_id: examRoom.id,
            class_id: classA,
          })
          .execute();
        await transaction
          .insertInto('exam_invigilators')
          .values({
            branch_id: north,
            exam_id: written.id,
            exam_room_id: examRoom.id,
            staff_id: staff,
          })
          .execute();
        return written.id;
      });
      expect(await expected(lesson, a)).toEqual({ expected: false, kind: 'temporary' });
      expect(await expected(lesson, b)).toEqual({ expected: true, kind: null });
      await database.migrator
        .updateTable('exams')
        .set({ cancel_cause: 'cancelled' })
        .where('id', '=', exam)
        .execute();
      expect(await expected(lesson, a)).toEqual({ expected: true, kind: null });
    });
  });
});
