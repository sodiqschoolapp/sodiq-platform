import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';

/** What a promise came to: `written`, or the constraint or message that refused it. */
const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => (error as { constraint?: string }).constraint ?? (error as Error).message,
  );

// Teacher absences in the database (db/migrations/0096; task 5.7a-1, pull
// request #185, decisions 2, 3, 5 and 12). docs/spec/06-timetable.md,
// Teachers who work in several branches: "An absence is entered once for the
// person and covers every branch." Every write is made as `sodiq_app`
// through the filters, as the routes write it. All names are invented.
describe('absences in the database', () => {
  let database: TestDatabase;
  let kit: LessonsKit;
  let north: string;
  let south: string;
  let third: string;
  let author: string;
  let branchCount = 0;

  const asApp = <T>(branches: readonly string[], work: (transaction: Transaction) => Promise<T>) =>
    new Transactions(database.app, new FixedClock(NOW)).run(branches, work);

  /** A live absence of the person over `[from, until)`, written from `branch`. */
  const absence = (
    branch: string,
    staffId: string,
    from: Date,
    until: Date | null,
    days: { startsOn: string; endsOn: string | null },
  ) =>
    asApp([branch], (transaction) =>
      transaction
        .insertInto('absences')
        .values({
          staff_id: staffId,
          starts_on: days.startsOn,
          ends_on: days.endsOn,
          applies_from: from,
          applies_until: until,
          reason: 'Ill',
          created_by: author,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );

  const week = (staffId: string, branch = north) =>
    absence(branch, staffId, at('2026-10-19', '00:00'), at('2026-10-24', '00:00'), {
      startsOn: '2026-10-19',
      endsOn: '2026-10-23',
    });

  /** A lesson of the person in the branch on `date` at 09:00 to 09:45, by the migrator. */
  async function lessonOf(branch: string, staffId: string, date: string): Promise<string> {
    const { year, quarters } = await kit.year(branch);
    const subject = await kit.load.classes.subject({ grades: [7] });
    const classId = await kit.load.classes.schoolClass(branch, year, { grade: 7 });
    const source = await kit.source(
      branch,
      year,
      [{ classId, groupId: null, subjectId: subject }],
      '2026-09-07',
    );
    const block = await database.migrator
      .insertInto('lesson_blocks')
      .values({
        branch_id: branch,
        academic_year_id: year,
        quarter_id: quarters[0] ?? '',
        lesson_date: date,
        starts_at: at(date, '09:00'),
        ends_at: at(date, '09:45'),
        version_id: source.versionId,
        pattern_block_id: source.patternBlockId,
      })
      .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
      .executeTakeFirstOrThrow();
    const from = source.lessons[0];
    const lesson = await database.migrator
      .insertInto('lessons')
      .values({
        branch_id: branch,
        block_id: block.id,
        lesson_date: block.lesson_date,
        starts_at: block.starts_at,
        ends_at: block.ends_at,
        class_id: classId,
        group_id: null,
        subject_id: subject,
        load_row_id: from?.loadRowId ?? '',
        pattern_entry_id: from?.patternEntryId ?? '',
        teacher_id: staffId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return lesson.id;
  }

  const newBranch = () => {
    branchCount += 1;
    return insertBranch(database.migrator, `Branch ${String(branchCount)}`);
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    third = await insertBranch(database.migrator, 'Third');
    author = await kit.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('absences_no_overlap', () => {
    it('refuses a second live absence of the person that meets the first, from any branch', async () => {
      const person = await kit.load.teacher(north, { further: [south] });
      await week(person.staffId);
      expect(
        await outcome(
          absence(south, person.staffId, at('2026-10-23', '12:00'), null, {
            startsOn: '2026-10-23',
            endsOn: null,
          }),
        ),
      ).toBe('absences_no_overlap');
    });

    it('takes an absence that starts where the other ends, half-open', async () => {
      const person = await kit.load.teacher(north);
      await week(person.staffId);
      expect(
        await outcome(
          absence(north, person.staffId, at('2026-10-24', '00:00'), null, {
            startsOn: '2026-10-24',
            endsOn: null,
          }),
        ),
      ).toBe('written');
    });

    it('does not count a withdrawn absence, nor another person', async () => {
      const person = await kit.load.teacher(north);
      const other = await kit.load.teacher(north);
      const first = await week(person.staffId);
      expect(await outcome(week(other.staffId))).toBe('written');
      await asApp([north], (transaction) =>
        transaction
          .updateTable('absences')
          .set({ withdrawn_at: new Date(NOW) })
          .where('id', '=', first)
          .execute(),
      );
      expect(await outcome(week(person.staffId))).toBe('written');
    });
  });

  describe('the checks of a row', () => {
    it('refuses a last day before the first, an end before the start, and an open end on one side only', async () => {
      const person = await kit.load.teacher(north);
      const from = at('2026-11-02', '00:00');
      expect(
        await outcome(
          absence(north, person.staffId, from, at('2026-11-03', '00:00'), {
            startsOn: '2026-11-02',
            endsOn: '2026-11-01',
          }),
        ),
      ).toBe('absences_days_check');
      expect(
        await outcome(
          absence(north, person.staffId, from, from, {
            startsOn: '2026-11-02',
            endsOn: '2026-11-02',
          }),
        ),
      ).toBe('absences_moments_check');
      expect(
        await outcome(
          absence(north, person.staffId, from, null, {
            startsOn: '2026-11-02',
            endsOn: '2026-11-02',
          }),
        ),
      ).toBe('absences_open_check');
    });
  });

  describe('the membership filter', () => {
    it('shows the absence in every branch of the person and in no other', async () => {
      const person = await kit.load.teacher(north, { further: [south] });
      const id = await week(person.staffId);
      const seen = (branch: string) =>
        asApp([branch], (transaction) =>
          transaction.selectFrom('absences').select('id').where('id', '=', id).execute(),
        );
      expect(await seen(north)).toHaveLength(1);
      expect(await seen(south)).toHaveLength(1);
      expect(await seen(third)).toHaveLength(0);
      // Nor can the third branch write one for the person.
      expect(await outcome(week(person.staffId, third))).toMatch(/row-level security/);
    });
  });

  describe('the grants', () => {
    it('never deletes, and never changes the person or the reason', async () => {
      const person = await kit.load.teacher(north);
      const other = await kit.load.teacher(north);
      const id = await week(person.staffId);
      expect(
        await outcome(
          asApp([north], (transaction) =>
            transaction.deleteFrom('absences').where('id', '=', id).execute(),
          ),
        ),
      ).toMatch(/permission denied/);
      expect(
        await outcome(
          asApp([north], (transaction) =>
            transaction
              .updateTable('absences')
              .set({ staff_id: other.staffId })
              .where('id', '=', id)
              .execute(),
          ),
        ),
      ).toMatch(/permission denied/);
      expect(
        await outcome(
          asApp([north], (transaction) =>
            transaction
              .updateTable('absences')
              .set({ reason: 'Another reason' })
              .where('id', '=', id)
              .execute(),
          ),
        ),
      ).toMatch(/permission denied/);
    });
  });

  describe('absences_of_teachers', () => {
    it('answers in a branch whose link to the person was removed while it holds their lessons (decision 3)', async () => {
      const east = await newBranch();
      const person = await kit.load.teacher(north, { further: [east] });
      await lessonOf(east, person.staffId, '2026-10-20');
      const id = await week(person.staffId);
      await database.migrator
        .deleteFrom('staff_branches')
        .where('staff_id', '=', person.staffId)
        .where('branch_id', '=', east)
        .execute();
      const read = await asApp([east], async (transaction) => ({
        filtered: await transaction
          .selectFrom('absences')
          .select('id')
          .where('id', '=', id)
          .execute(),
        spans: (
          await sql<{ absence_id: string; applies_from: Date }>`
            select absence_id, applies_from
            from absences_of_teachers(array[${person.staffId}]::uuid[], ${at('2026-10-20', '00:00')}, ${at('2026-10-21', '00:00')})
          `.execute(transaction)
        ).rows,
      }));
      expect(read.filtered).toHaveLength(0);
      expect(read.spans).toEqual([{ absence_id: id, applies_from: at('2026-10-19', '00:00') }]);
    });

    it('leaves out a withdrawn absence and one outside the range', async () => {
      const person = await kit.load.teacher(north);
      const id = await week(person.staffId);
      const spans = (from: string, until: string) =>
        asApp([north], async (transaction) =>
          (
            await sql<{ absence_id: string }>`
              select absence_id from absences_of_teachers(array[${person.staffId}]::uuid[], ${at(from, '00:00')}, ${at(until, '00:00')})
            `.execute(transaction)
          ).rows.map((row) => row.absence_id),
        );
      expect(await spans('2026-10-24', '2026-10-26')).toEqual([]);
      expect(await spans('2026-10-12', '2026-10-19')).toEqual([]);
      expect(await spans('2026-10-23', '2026-10-24')).toEqual([id]);
      await asApp([north], (transaction) =>
        transaction
          .updateTable('absences')
          .set({ withdrawn_at: new Date(NOW) })
          .where('id', '=', id)
          .execute(),
      );
      expect(await spans('2026-10-23', '2026-10-24')).toEqual([]);
    });
  });

  describe('absence_notice_accounts', () => {
    it('names the Academic Vice Principals of the linked branches and of a branch holding the person’s lessons, and nobody else', async () => {
      const east = await newBranch();
      const fourth = await newBranch();
      const person = await kit.load.teacher(north, { further: [south, east] });
      await lessonOf(east, person.staffId, '2026-10-20');
      await database.migrator
        .deleteFrom('staff_branches')
        .where('staff_id', '=', person.staffId)
        .where('branch_id', '=', east)
        .execute();
      const vice = async (branch: string) => {
        const account = await kit.load.classes.account();
        await kit.load.classes.role(account, branch, 'academic_vice_principal');
        return account;
      };
      const northVice = await vice(north);
      const southVice = await vice(south);
      const eastVice = await vice(east);
      await vice(fourth);
      // A Principal of the branch is not told.
      await kit.load.classes.role(await kit.load.classes.account(), north, 'principal');
      // An Academic Vice Principal whose role ended is not told.
      await kit.load.classes.role(
        await kit.load.classes.account(),
        south,
        'academic_vice_principal',
        new Date('2026-09-01T00:00:00+05:00'),
        new Date('2026-10-01T00:00:00+05:00'),
      );
      const accounts = (branch: string, from: string, until: string | null) =>
        asApp(
          [branch],
          async (transaction) =>
            (
              await sql<{ branch_id: string; account_id: string }>`
              select branch_id, account_id
              from absence_notice_accounts(${person.staffId}::uuid, ${at(from, '00:00')}, ${until === null ? null : at(until, '00:00')})
            `.execute(transaction)
            ).rows,
        );
      const all = await accounts(north, '2026-10-19', null);
      expect(all.map((row) => row.account_id).sort()).toEqual(
        [northVice, southVice, eastVice].sort(),
      );
      // The lesson of the unlinked branch is outside this range.
      const later = await accounts(north, '2026-10-21', '2026-10-24');
      expect(later.map((row) => row.account_id).sort()).toEqual([northVice, southVice].sort());
      // A branch that does not see the person gets nothing.
      expect(await accounts(fourth, '2026-10-19', null)).toEqual([]);
    });
  });

  describe('lesson_absence_taught', () => {
    it('keeps to the branch of its lesson', async () => {
      const east = await newBranch();
      const person = await kit.load.teacher(east);
      const lesson = await lessonOf(east, person.staffId, '2026-10-20');
      const record = (branch: string, rowBranch: string) =>
        asApp([branch], (transaction) =>
          transaction
            .insertInto('lesson_absence_taught')
            .values({
              branch_id: rowBranch,
              lesson_id: lesson,
              recorded_by: author,
              recorded_at: new Date(NOW),
            })
            .execute(),
        );
      // Another branch's lesson is refused by the composite key.
      expect(await outcome(record(north, north))).toBe('lesson_absence_taught_lesson_fkey');
      expect(await outcome(record(north, east))).toMatch(/row-level security/);
      expect(await outcome(record(east, east))).toBe('written');
      expect(
        await asApp([north], (transaction) =>
          transaction.selectFrom('lesson_absence_taught').select('lesson_id').execute(),
        ),
      ).toEqual([]);
    });
  });
});
