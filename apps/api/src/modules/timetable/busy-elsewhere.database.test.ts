import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';

interface ElsewhereRow {
  staff_id: string;
  branch_id: string;
  entry_id: string;
  weekday: number;
  start_minutes: number;
  end_minutes: number;
  tutor_lesson?: boolean;
}

// The other branches' patterns a draft's checks count (db/migrations/0071;
// task 5.4b-1, pull request #132): 06, Teachers who work in several branches,
// "Busy elsewhere" and "Two drafts at once". Each function answers for a
// branch of the transaction, for staff linked to it, with the weekday, the
// times and the branch of the other branches' entries and nothing else
// (decision 2, Look first). All names are invented.
describe('the patterns of other branches (timetable_busy_elsewhere, timetable_drafts_elsewhere)', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LessonsKit;
  let north: string;
  let south: string;
  let east: string;
  let southYear: string;
  let subject: string;
  /** A teacher of the north who also works in the south. */
  let shared: string;
  /** A teacher of the south only. */
  let southOnly: string;

  /** A version of the south, its one entry at Monday 9:00 for the teacher, then its status. */
  async function southVersion(
    teacher: string,
    input: {
      status?: 'draft' | 'published' | 'archived';
      startsOn?: string;
      weekday?: number;
      start?: number;
    } = {},
  ): Promise<{ version: string; entry: string }> {
    const year = southYear;
    const version = await kit.load.version(south, year, {
      startsOn: input.startsOn ?? '2026-09-07',
    });
    const row = await kit.load.row({
      branch_id: south,
      version_id: version,
      class_id: await kit.load.classes.schoolClass(south, year, { grade: 7 }),
      subject_id: subject,
      teacher_id: teacher,
    });
    const weekday = input.weekday ?? 1;
    const start = input.start ?? 540;
    const entry = await transactions.run([south], async (transaction) => {
      const block = await transaction
        .insertInto('pattern_blocks')
        .values({
          branch_id: south,
          version_id: version,
          weekday,
          slot_position: 1,
          start_minutes: start,
          end_minutes: start + 45,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return (
        await transaction
          .insertInto('pattern_entries')
          .values({
            branch_id: south,
            version_id: version,
            block_id: block.id,
            weekday,
            start_minutes: start,
            end_minutes: start + 45,
            load_row_id: row,
            teacher_id: teacher,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    });
    if (input.status !== undefined && input.status !== 'draft') {
      await kit.load.setVersion(version, input.status);
    }
    return { version, entry };
  }

  const busy = (
    branches: readonly string[],
    branchRef: string,
    staff: readonly string[],
    on: string,
  ): Promise<ElsewhereRow[]> =>
    transactions.run(branches, async (transaction: Transaction) => {
      const found = await sql<ElsewhereRow>`
        select * from timetable_busy_elsewhere(${branchRef}::uuid, ${sql.val(staff)}::uuid[], ${on}::date)
      `.execute(transaction);
      return found.rows;
    });

  const drafts = (
    branchRef: string,
    staff: readonly string[],
    from: string,
    until: string,
  ): Promise<ElsewhereRow[]> =>
    transactions.run([branchRef], async (transaction: Transaction) => {
      const found = await sql<ElsewhereRow>`
        select * from timetable_drafts_elsewhere(${branchRef}::uuid, ${sql.val(staff)}::uuid[], ${from}::date, ${until}::date)
      `.execute(transaction);
      return found.rows;
    });

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    east = await insertBranch(database.migrator, 'East');
    southYear = (await kit.year(south)).year;
    subject = await kit.load.classes.subject({ grades: [7] });
    shared = (
      await kit.load.teacher(north, { subjects: [{ subject, grades: [7] }], further: [south] })
    ).staffId;
    southOnly = (await kit.load.teacher(south, { subjects: [{ subject, grades: [7] }] })).staffId;
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('timetable_busy_elsewhere', () => {
    it('gives the entries of the published version in force, times and branch only, and nothing of a later, earlier or unpublished one', async () => {
      const earlier = await southVersion(shared, { status: 'published', startsOn: '2026-09-07' });
      const inForce = await southVersion(shared, {
        status: 'published',
        startsOn: '2026-10-05',
        weekday: 2,
        start: 600,
      });
      const later = await southVersion(shared, { status: 'published', startsOn: '2026-11-02' });
      const draft = await southVersion(shared, { startsOn: '2026-10-01' });
      const archived = await southVersion(shared, { status: 'archived', startsOn: '2026-10-12' });

      const found = await busy([north], north, [shared], '2026-10-19');

      expect(found).toEqual([
        {
          staff_id: shared,
          branch_id: south,
          entry_id: inForce.entry,
          weekday: 2,
          start_minutes: 600,
          end_minutes: 645,
          tutor_lesson: false,
        },
      ]);
      const ids = found.map((one) => one.entry_id);
      for (const other of [earlier, later, draft, archived]) {
        expect(ids).not.toContain(other.entry);
      }
    });

    it('leaves out the published version of a year that does not hold the date', async () => {
      // Review must-fix 1 of the plan: a next-year draft read in September
      // must not meet this year's published version, the latest start before it.
      const teacher = (
        await kit.load.teacher(north, { subjects: [{ subject, grades: [7] }], further: [south] })
      ).staffId;
      const thisYear = await southVersion(teacher, { status: 'published', startsOn: '2026-10-05' });
      expect(
        (await busy([north], north, [teacher], '2026-10-19')).map((one) => one.entry_id),
      ).toEqual([thisYear.entry]);
      expect(await busy([north], north, [teacher], '2027-09-15')).toEqual([]);
    });

    it('answers nothing for a teacher not linked to the branch named, and never the branch’s own entries', async () => {
      const own = await southVersion(southOnly, { status: 'published', startsOn: '2026-10-06' });
      expect(await busy([north], north, [southOnly], '2026-10-19')).toEqual([]);
      const fromSouth = await busy([south], south, [shared, southOnly], '2026-10-19');
      expect(fromSouth.map((one) => one.entry_id)).not.toContain(own.entry);
      expect(fromSouth.every((one) => one.branch_id !== south)).toBe(true);
    });

    it('refuses a branch outside the transaction', async () => {
      await expect(busy([east], north, [shared], '2026-10-19')).rejects.toMatchObject({
        constraint: 'timetable_elsewhere_branch',
      });
    });

    it('names no class, group, subject, room or person', async () => {
      const columns = await sql<{ name: string }>`
        select unnest(p.proargnames) as name
        from pg_proc p where p.proname = 'timetable_busy_elsewhere'
      `.execute(database.migrator);
      expect(columns.rows.map((one) => one.name)).toEqual([
        'branch_ref',
        'staff_ids',
        'on_date',
        'staff_id',
        'branch_id',
        'entry_id',
        'weekday',
        'start_minutes',
        'end_minutes',
        'tutor_lesson',
      ]);
    });
  });

  describe('timetable_drafts_elsewhere', () => {
    it('gives the entries of other branches’ drafts that can overlap the range, and no published one', async () => {
      const teacher = (
        await kit.load.teacher(north, { subjects: [{ subject, grades: [7] }], further: [south] })
      ).staffId;
      const inRange = await southVersion(teacher, { startsOn: '2026-11-02', weekday: 3 });
      const afterRange = await southVersion(teacher, { startsOn: '2027-06-01' });
      const published = await southVersion(teacher, {
        status: 'published',
        startsOn: '2026-10-05',
      });

      const found = await drafts(north, [teacher], '2026-10-19', '2027-05-31');

      expect(found).toEqual([
        {
          staff_id: teacher,
          branch_id: south,
          entry_id: inRange.entry,
          weekday: 3,
          start_minutes: 540,
          end_minutes: 585,
        },
      ]);
      const ids = found.map((one) => one.entry_id);
      for (const other of [afterRange, published]) {
        expect(ids).not.toContain(other.entry);
      }
      // A draft of a year that ends before the range starts.
      expect(await drafts(north, [teacher], '2027-09-01', '2028-05-31')).toEqual([]);
    });

    it('answers nothing for a teacher not linked to the branch named, and refuses a branch outside the transaction', async () => {
      await southVersion(southOnly, { startsOn: '2026-11-02' });
      expect(await drafts(north, [southOnly], '2026-10-19', '2027-05-31')).toEqual([]);
      await expect(
        transactions.run([east], (transaction) =>
          sql`select * from timetable_drafts_elsewhere(${north}::uuid, ${sql.val([shared])}::uuid[], '2026-10-19'::date, '2027-05-31'::date)`.execute(
            transaction,
          ),
        ),
      ).rejects.toMatchObject({ constraint: 'timetable_elsewhere_branch' });
    });
  });
});
