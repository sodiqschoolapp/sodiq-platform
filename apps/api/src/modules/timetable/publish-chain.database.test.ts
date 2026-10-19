import type { Updateable } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DB } from '../../database/types.generated.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit } from '../../testing/load-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
const TODAY = '2026-10-15';
const FUTURE = '2026-10-19';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// What the database keeps of the chain (db/migrations/0076; task 5.5a-3a,
// pull request #145, decisions 2 and 3 with review correction 1, spec review
// of the plan, must-fix 2): a published version that has not started can be
// archived ("replace the versions that follow"), and a carry can change the
// teacher and the room of its load rows and the room of its pattern entries,
// nothing else; every other column, every insert and delete, the four other
// tables of `pattern_rows_draft`, an archived version and a started one stay
// refused. All names are invented.
describe('the chain of published versions in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LoadKit;
  let branchCount = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  interface Fixture {
    branch: string;
    year: string;
    version: string;
    classId: string;
    subject: string;
    row: string;
    block: string;
    entry: string;
    teacher: string;
    other: string;
    room: string;
    otherRoom: string;
  }

  /**
   * A version of a branch of its own with one load row placed once, published
   * unless said; `startsOn` in the future unless said.
   */
  async function fixture(
    input: { startsOn?: string; status?: 'draft' | 'published' | 'archived' } = {},
  ): Promise<Fixture> {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Chain branch ${String(branchCount)}`);
    const year = await kit.classes.year(branch);
    const version = await kit.version(branch, year, { startsOn: input.startsOn ?? FUTURE });
    const subject = await kit.classes.subject({ grades: [7] });
    const teacher = await kit.teacher(branch, { subjects: [{ subject, grades: [7] }] });
    const other = await kit.teacher(branch, { subjects: [{ subject, grades: [7] }] });
    const classId = await kit.classes.schoolClass(branch, year, { grade: 7 });
    const room = await kit.classes.room(branch);
    const otherRoom = await kit.classes.room(branch);
    const row = await kit.row({
      branch_id: branch,
      version_id: version,
      class_id: classId,
      subject_id: subject,
      teacher_id: teacher.staffId,
    });
    const block = await database.migrator
      .insertInto('pattern_blocks')
      .values({
        branch_id: branch,
        version_id: version,
        weekday: 1,
        slot_position: 1,
        start_minutes: 510,
        end_minutes: 555,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const entry = await database.migrator
      .insertInto('pattern_entries')
      .values({
        branch_id: branch,
        version_id: version,
        block_id: block.id,
        weekday: 1,
        start_minutes: 510,
        end_minutes: 555,
        load_row_id: row,
        teacher_id: teacher.staffId,
        room_id: room,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const status = input.status ?? 'published';
    if (status !== 'draft') {
      await kit.setVersion(version, status);
    }
    return {
      branch,
      year,
      version,
      classId,
      subject,
      row,
      block: block.id,
      entry: entry.id,
      teacher: teacher.staffId,
      other: other.staffId,
      room,
      otherRoom,
    };
  }

  const setStatus = (branch: string, version: string, status: 'draft' | 'published' | 'archived') =>
    inBranch(branch, (transaction) =>
      transaction
        .updateTable('timetable_versions')
        .set({ status })
        .where('id', '=', version)
        .execute(),
    );

  const statusOf = async (version: string) =>
    (
      await database.migrator
        .selectFrom('timetable_versions')
        .select('status')
        .where('id', '=', version)
        .executeTakeFirstOrThrow()
    ).status;

  const setRow = (f: Fixture, set: Updateable<DB['teaching_load_rows']>) =>
    inBranch(f.branch, (transaction) =>
      transaction.updateTable('teaching_load_rows').set(set).where('id', '=', f.row).execute(),
    );

  const setEntry = (f: Fixture, set: Updateable<DB['pattern_entries']>) =>
    inBranch(f.branch, (transaction) =>
      transaction.updateTable('pattern_entries').set(set).where('id', '=', f.entry).execute(),
    );

  const rowOf = (f: Fixture) =>
    database.migrator
      .selectFrom('teaching_load_rows')
      .select(['teacher_id', 'room_id'])
      .where('id', '=', f.row)
      .executeTakeFirstOrThrow();

  const entryOf = (f: Fixture) =>
    database.migrator
      .selectFrom('pattern_entries')
      .select(['teacher_id', 'room_id'])
      .where('id', '=', f.entry)
      .executeTakeFirstOrThrow();

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = new LoadKit(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('archiving a published version', () => {
    it('archives a published version that has not started', async () => {
      const f = await fixture();
      await setStatus(f.branch, f.version, 'archived');
      expect(await statusOf(f.version)).toBe('archived');
    });

    it('refuses a version that starts today', async () => {
      const f = await fixture({ startsOn: TODAY });
      expect(await refusal(setStatus(f.branch, f.version, 'archived'))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'version_archive_started',
      });
      expect(await statusOf(f.version)).toBe('published');
    });

    it('refuses a version that started before today', async () => {
      const f = await fixture({ startsOn: '2026-10-12' });
      expect(await refusal(setStatus(f.branch, f.version, 'archived'))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'version_archive_started',
      });
      expect(await statusOf(f.version)).toBe('published');
    });

    it('refuses a version of a closed year', async () => {
      const f = await fixture();
      await kit.classes.setYear(f.year, 'closed');
      expect(await refusal(setStatus(f.branch, f.version, 'archived'))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'version_year_closed',
      });
      expect(await statusOf(f.version)).toBe('published');
    });

    it('refuses a draft to archived and archived to published or draft', async () => {
      const draft = await fixture({ status: 'draft' });
      expect(await refusal(setStatus(draft.branch, draft.version, 'archived'))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'timetable_versions_status',
      });
      const archived = await fixture({ status: 'archived' });
      for (const status of ['published', 'draft'] as const) {
        expect(
          await refusal(setStatus(archived.branch, archived.version, status)),
          status,
        ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'timetable_versions_status' });
      }
    });
  });

  describe('a carry into a published version that has not started', () => {
    it('changes the teacher and the room of a load row, the entries following', async () => {
      const f = await fixture();
      await setRow(f, { teacher_id: f.other, room_id: f.otherRoom });
      expect(await rowOf(f)).toEqual({ teacher_id: f.other, room_id: f.otherRoom });
      // The cascade of pattern_entries_load_row_fkey carries the teacher.
      expect(await entryOf(f)).toEqual({ teacher_id: f.other, room_id: f.room });
    });

    it('changes the room of a pattern entry', async () => {
      const f = await fixture();
      await setEntry(f, { room_id: f.otherRoom });
      expect(await entryOf(f)).toEqual({ teacher_id: f.teacher, room_id: f.otherRoom });
    });

    it('still refuses a teacher without the subject', async () => {
      const f = await fixture();
      const stranger = await kit.teacher(f.branch);
      expect(await refusal(setRow(f, { teacher_id: stranger.staffId }))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'load_teacher_subject',
      });
      expect(await rowOf(f)).toEqual({ teacher_id: f.teacher, room_id: null });
    });

    it('refuses every other column of a load row', async () => {
      const f = await fixture();
      const changes = [
        { lessons_per_week: 3 },
        { room_type: 'laboratory' },
        { double_lessons: true },
        { mixed_block: true },
        { short_reason: 'Lab closed' },
      ] as const;
      for (const set of changes) {
        expect(await refusal(setRow(f, set)), JSON.stringify(set)).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'load_version_draft',
        });
      }
      // With the teacher in the same write, still refused.
      expect(await refusal(setRow(f, { teacher_id: f.other, lessons_per_week: 3 }))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'load_version_draft',
      });
    });

    it('refuses an insert and a delete of a load row', async () => {
      const f = await fixture();
      const subject = await kit.classes.subject({ grades: [7] });
      await kit.profile(f.teacher, [{ subject, grades: [7] }]);
      expect(
        await refusal(
          inBranch(f.branch, (transaction) =>
            transaction
              .insertInto('teaching_load_rows')
              .values({
                branch_id: f.branch,
                version_id: f.version,
                class_id: f.classId,
                subject_id: subject,
                teacher_id: f.teacher,
                lessons_per_week: 1,
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'load_version_draft' });
      expect(
        await refusal(
          inBranch(f.branch, (transaction) =>
            transaction.deleteFrom('teaching_load_rows').where('id', '=', f.row).execute(),
          ),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'load_version_draft' });
    });

    it('refuses a pattern entry insert or delete and every other column of an entry or a block', async () => {
      const f = await fixture();
      const writes: [string, (transaction: Transaction) => Promise<unknown>][] = [
        [
          'block slot',
          (transaction) =>
            transaction
              .updateTable('pattern_blocks')
              .set({ slot_position: 2 })
              .where('id', '=', f.block)
              .execute(),
        ],
        [
          'block minutes',
          (transaction) =>
            transaction
              .updateTable('pattern_blocks')
              .set({ start_minutes: 515, end_minutes: 560 })
              .where('id', '=', f.block)
              .execute(),
        ],
        [
          'entry delete',
          (transaction) =>
            transaction.deleteFrom('pattern_entries').where('id', '=', f.entry).execute(),
        ],
        [
          'entry insert',
          async (transaction) => {
            const block = await transaction
              .insertInto('pattern_blocks')
              .values({
                branch_id: f.branch,
                version_id: f.version,
                weekday: 2,
                slot_position: 1,
                start_minutes: 510,
                end_minutes: 555,
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            await transaction
              .insertInto('pattern_entries')
              .values({
                branch_id: f.branch,
                version_id: f.version,
                block_id: block.id,
                weekday: 2,
                start_minutes: 510,
                end_minutes: 555,
                load_row_id: f.row,
                teacher_id: f.teacher,
                room_id: null,
              })
              .execute();
          },
        ],
      ];
      for (const [name, write] of writes) {
        expect(await refusal(inBranch(f.branch, write)), name).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'pattern_version_draft',
        });
      }
    });

    // Review correction 1: the five tables of `pattern_rows_draft`. Task 5.6b-2b
    // (pull request #171, review correction 3): a published version's choice
    // for a date after today is let through (0089), so the choice here is for
    // today, which stays refused.
    it('refuses a pin, a lock and a shortened-day choice, written or removed', async () => {
      const f = await fixture();
      // One of each, written while the version was a draft.
      const g = await fixture({ status: 'draft' });
      await database.migrator
        .insertInto('timetable_pins')
        .values({
          branch_id: g.branch,
          version_id: g.version,
          load_row_id: g.row,
          weekday: 1,
          slot_position: 1,
        })
        .execute();
      await database.migrator
        .insertInto('timetable_locks')
        .values({ branch_id: g.branch, version_id: g.version, kind: 'block', block_id: g.block })
        .execute();
      await database.migrator
        .insertInto('timetable_day_keeps')
        .values({
          branch_id: g.branch,
          version_id: g.version,
          class_id: g.classId,
          kept_on: TODAY,
          slot_position: 1,
        })
        .execute();
      await kit.setVersion(g.version, 'published');
      const writes: [string, Fixture, (transaction: Transaction) => Promise<unknown>][] = [
        [
          'pin insert',
          f,
          (transaction) =>
            transaction
              .insertInto('timetable_pins')
              .values({
                branch_id: f.branch,
                version_id: f.version,
                load_row_id: f.row,
                weekday: 1,
                slot_position: 1,
              })
              .execute(),
        ],
        [
          'pin delete',
          g,
          (transaction) =>
            transaction.deleteFrom('timetable_pins').where('version_id', '=', g.version).execute(),
        ],
        [
          'lock insert',
          f,
          (transaction) =>
            transaction
              .insertInto('timetable_locks')
              .values({
                branch_id: f.branch,
                version_id: f.version,
                kind: 'block',
                block_id: f.block,
              })
              .execute(),
        ],
        [
          'lock delete',
          g,
          (transaction) =>
            transaction.deleteFrom('timetable_locks').where('version_id', '=', g.version).execute(),
        ],
        [
          'day keep insert',
          f,
          (transaction) =>
            transaction
              .insertInto('timetable_day_keeps')
              .values({
                branch_id: f.branch,
                version_id: f.version,
                class_id: f.classId,
                kept_on: TODAY,
                slot_position: 1,
              })
              .execute(),
        ],
        [
          'day keep delete',
          g,
          (transaction) =>
            transaction
              .deleteFrom('timetable_day_keeps')
              .where('version_id', '=', g.version)
              .execute(),
        ],
      ];
      for (const [name, on, write] of writes) {
        expect(await refusal(inBranch(on.branch, write)), name).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'pattern_version_draft',
        });
      }
    });

    it('refuses the teacher and room of an archived version', async () => {
      const f = await fixture({ status: 'archived' });
      expect(await refusal(setRow(f, { teacher_id: f.other }))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'load_version_draft',
      });
      expect(await refusal(setEntry(f, { room_id: f.otherRoom }))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'pattern_version_draft',
      });
    });

    it('refuses the teacher and room of a version started today or earlier', async () => {
      for (const startsOn of [TODAY, '2026-10-12']) {
        const f = await fixture({ startsOn });
        expect(await refusal(setRow(f, { teacher_id: f.other })), startsOn).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'load_version_draft',
        });
        expect(await refusal(setRow(f, { room_id: f.otherRoom })), startsOn).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'load_version_draft',
        });
        expect(await refusal(setEntry(f, { room_id: f.otherRoom })), startsOn).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'pattern_version_draft',
        });
      }
    });
  });
});
