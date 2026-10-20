import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
const TODAY = '2026-10-15';
const DATE = '2026-10-21';
const MINUTE = 60_000;

/** What a promise came to: `written`, or the constraint or code that refused it. */
const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => {
      const found = error as { constraint?: string; code?: string };
      return found.constraint ?? found.code ?? String(error);
    },
  );

const later = (moment: Date, minutes: number) => new Date(moment.getTime() + minutes * MINUTE);

// The times of a stored one-day change and of a bulk cancel follow their
// lessons when a day template changes (db/migrations/0092; task 5.6b-4b, pull
// request #178, decision 1 and review correction 1): only the time columns
// change, only on a side dated after today in the branch's time zone, and
// only to times on that same date (`06`, "Day template changed": held lessons
// keep their times, future lessons take the new ones). Written as `sodiq_app`
// through the branch filter, as the template change writes them. All names
// are invented.
describe('the times of a stored one-day change or bulk cancel in the database', () => {
  let database: TestDatabase;
  let kit: LessonsKit;
  let subject: string;
  let account: string;
  let branchCount = 0;

  const app = () => new Transactions(database.app, new FixedClock(NOW));

  /** A branch with a dated year, a class of grade 7 and one lesson on `DATE` at 09:00. */
  async function fresh() {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branchCount)}`);
    const { year, quarters } = await kit.year(branch);
    const classId = await kit.load.classes.schoolClass(branch, year, { grade: 7 });
    const source = await kit.source(
      branch,
      year,
      [{ classId, groupId: null, subjectId: subject }],
      '2026-10-19',
    );
    const startsAt = at(DATE, '09:00');
    const block = await database.migrator
      .insertInto('lesson_blocks')
      .values({
        branch_id: branch,
        academic_year_id: year,
        quarter_id: quarters[0] ?? '',
        lesson_date: DATE,
        starts_at: startsAt,
        ends_at: later(startsAt, 45),
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
        subject_id: subject,
        load_row_id: from?.loadRowId ?? '',
        pattern_entry_id: from?.patternEntryId ?? '',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { branch, classId, block, lesson };
  }

  type Fresh = Awaited<ReturnType<typeof fresh>>;

  /** A move of the scene's lesson from `fromDate` 09:00 to `DATE` 09:00, as the route writes it. */
  const move = (place: Fresh, fromDate: string) =>
    app().run([place.branch], (transaction) =>
      transaction
        .insertInto('lesson_day_changes')
        .values({
          branch_id: place.branch,
          lesson_id: place.lesson.id,
          kind: 'move',
          class_id: place.classId,
          group_id: null,
          subject_id: subject,
          from_date: fromDate,
          from_starts_at: at(fromDate, '09:00'),
          from_ends_at: later(at(fromDate, '09:00'), 45),
          to_date: DATE,
          to_starts_at: place.block.starts_at,
          to_ends_at: place.block.ends_at,
          reason: 'The teacher is at a seminar',
          changed_at: new Date(NOW),
          changed_by: account,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );

  /** A bulk cancel of the scene's class on `date` from lesson 2, with its span and a `keep` of a block. */
  const bulk = (place: Fresh, date: string) =>
    app().run([place.branch], async (transaction) => {
      const cancel = await transaction
        .insertInto('bulk_cancels')
        .values({
          branch_id: place.branch,
          cancel_date: date,
          lesson_numbers: [2],
          reason: 'Excursion to the museum',
          changed_at: new Date(NOW),
          changed_by: account,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('bulk_cancel_classes')
        .values({ branch_id: place.branch, bulk_cancel_id: cancel.id, class_id: place.classId })
        .execute();
      await transaction
        .insertInto('bulk_cancel_spans')
        .values({
          branch_id: place.branch,
          bulk_cancel_id: cancel.id,
          class_id: place.classId,
          lesson_number: 2,
          starts_at: at(date, '09:00'),
          ends_at: later(at(date, '09:00'), 45),
        })
        .execute();
      await transaction
        .insertInto('bulk_cancel_blocks')
        .values({
          branch_id: place.branch,
          bulk_cancel_id: cancel.id,
          block_id: place.block.id,
          choice: 'keep',
          lesson_date: date,
          starts_at: at(date, '09:00'),
          ends_at: later(at(date, '09:00'), 45),
        })
        .execute();
      return cancel.id;
    });

  beforeAll(async () => {
    database = await createTestDatabase();
    kit = await LessonsKit.create(database.migrator);
    subject = await kit.load.classes.subject({ grades: [7] });
    account = await kit.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('of a room change or move', () => {
    const retime = (
      place: Fresh,
      id: string,
      values: Partial<
        Record<'from_starts_at' | 'from_ends_at' | 'to_starts_at' | 'to_ends_at', Date>
      >,
    ) =>
      outcome(
        app().run([place.branch], (transaction) =>
          transaction.updateTable('lesson_day_changes').set(values).where('id', '=', id).execute(),
        ),
      );

    it('moves the times of a side after today on its own date, and refuses another date', async () => {
      const place = await fresh();
      const { id } = await move(place, '2026-10-20');
      expect(
        await retime(place, id, {
          from_starts_at: at('2026-10-20', '09:10'),
          from_ends_at: at('2026-10-20', '09:50'),
          to_starts_at: at(DATE, '09:10'),
          to_ends_at: at(DATE, '09:50'),
        }),
      ).toBe('written');
      const stored = await database.migrator
        .selectFrom('lesson_day_changes')
        .select(['from_starts_at', 'to_starts_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(stored).toEqual({
        from_starts_at: at('2026-10-20', '09:10'),
        to_starts_at: at(DATE, '09:10'),
      });
      // Correction 1: a time on another date than the row's own.
      expect(
        await retime(place, id, {
          to_starts_at: at('2026-10-22', '09:10'),
          to_ends_at: at('2026-10-22', '09:50'),
        }),
      ).toBe('day_change_time_fixed');
      expect(
        await retime(place, id, {
          from_starts_at: at('2026-10-19', '09:10'),
          from_ends_at: at('2026-10-19', '09:50'),
        }),
      ).toBe('day_change_time_fixed');
    });

    it('keeps the side of today: a move from today takes new times on its future side only', async () => {
      const place = await fresh();
      const { id } = await move(place, TODAY);
      expect(
        await retime(place, id, { to_starts_at: at(DATE, '09:10'), to_ends_at: at(DATE, '09:50') }),
      ).toBe('written');
      expect(
        await retime(place, id, {
          from_starts_at: at(TODAY, '11:10'),
          from_ends_at: at(TODAY, '11:50'),
        }),
      ).toBe('day_change_time_fixed');
      const stored = await database.migrator
        .selectFrom('lesson_day_changes')
        .select(['from_starts_at', 'to_starts_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(stored).toEqual({
        from_starts_at: at(TODAY, '09:00'),
        to_starts_at: at(DATE, '09:10'),
      });
    });

    it('refuses the application every other column, and a time with no moment of the transaction', async () => {
      const place = await fresh();
      const { id } = await move(place, '2026-10-20');
      expect(
        await outcome(
          app().run([place.branch], (transaction) =>
            transaction
              .updateTable('lesson_day_changes')
              .set({ to_date: '2026-10-22' })
              .where('id', '=', id)
              .execute(),
          ),
        ),
      ).toBe('42501');
      // The migrator sets no `app.now`.
      expect(
        await outcome(
          database.migrator
            .updateTable('lesson_day_changes')
            .set({ to_starts_at: at(DATE, '09:10'), to_ends_at: at(DATE, '09:50') })
            .where('id', '=', id)
            .execute(),
        ),
      ).toBe('day_change_time_fixed');
    });
  });

  describe('of a bulk cancel', () => {
    const retime = (
      place: Fresh,
      table: 'bulk_cancel_spans' | 'bulk_cancel_blocks',
      id: string,
      day: string,
      time: string,
    ) =>
      outcome(
        app().run([place.branch], (transaction) =>
          transaction
            .updateTable(table)
            .set({ starts_at: at(day, time), ends_at: later(at(day, time), 40) })
            .where('bulk_cancel_id', '=', id)
            .execute(),
        ),
      );

    it('moves the times of a span and a block choice after today on their own date only', async () => {
      const place = await fresh();
      const id = await bulk(place, DATE);
      for (const table of ['bulk_cancel_spans', 'bulk_cancel_blocks'] as const) {
        expect(await retime(place, table, id, DATE, '09:10')).toBe('written');
        expect(await retime(place, table, id, '2026-10-22', '09:10')).toBe('day_change_time_fixed');
      }
      const span = await database.migrator
        .selectFrom('bulk_cancel_spans')
        .select('starts_at')
        .where('bulk_cancel_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(span.starts_at).toEqual(at(DATE, '09:10'));
    });

    it('keeps the times of today', async () => {
      const place = await fresh();
      const id = await bulk(place, TODAY);
      for (const table of ['bulk_cancel_spans', 'bulk_cancel_blocks'] as const) {
        expect(await retime(place, table, id, TODAY, '11:10')).toBe('day_change_time_fixed');
      }
    });

    it('refuses the application every other column', async () => {
      const place = await fresh();
      const id = await bulk(place, DATE);
      expect(
        await outcome(
          app().run([place.branch], (transaction) =>
            transaction
              .updateTable('bulk_cancel_spans')
              .set({ lesson_number: 3 })
              .where('bulk_cancel_id', '=', id)
              .execute(),
          ),
        ),
      ).toBe('42501');
      expect(
        await outcome(
          app().run([place.branch], (transaction) =>
            transaction
              .updateTable('bulk_cancel_blocks')
              .set({ lesson_date: '2026-10-22' })
              .where('bulk_cancel_id', '=', id)
              .execute(),
          ),
        ),
      ).toBe('42501');
    });
  });
});
