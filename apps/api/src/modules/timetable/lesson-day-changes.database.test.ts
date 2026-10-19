import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit, type LessonSource } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
const DATE = '2026-10-21';

/** What a promise came to: `written`, or the constraint or code that refused it. */
const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => {
      const found = error as { constraint?: string; code?: string };
      return found.constraint ?? found.code ?? String(error);
    },
  );

// The record of a one-day room change and move (db/migrations/0085; task
// 5.6a-2, pull request #161, decision 8), and the block of a moved lesson
// guarded by 0058 (edge/developer-rules: Teacher in one place, Room in one
// use; edge/time-dates-calendar: "A one-day move stays inside the same
// quarter"). Written as `sodiq_app` through the branch filter, as the routes
// write them. All names are invented.
describe('the record of a one-day change in the database', () => {
  let database: TestDatabase;
  let kit: LessonsKit;
  let subject: string;
  let account: string;
  let branchCount = 0;

  const app = () => new Transactions(database.app, new FixedClock(NOW));

  /** A branch with a dated year, a class of grade 7, a room and one lesson on `DATE` at 09:00. */
  async function fresh() {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branchCount)}`);
    const { year, quarters } = await kit.year(branch);
    const classId = await kit.load.classes.schoolClass(branch, year, { grade: 7 });
    const room = await kit.load.classes.room(branch);
    const source = await kit.source(
      branch,
      year,
      [{ classId, groupId: null, subjectId: subject }],
      '2026-10-19',
    );
    const lesson = await lessonOn(branch, year, quarters[0] ?? '', source, classId, room, '09:00');
    return { branch, year, quarters, classId, room, source, lesson };
  }

  type Fresh = Awaited<ReturnType<typeof fresh>>;

  /** A lesson of the class in a block of its own at `time` for 45 minutes, by the migrator. */
  async function lessonOn(
    branch: string,
    year: string,
    quarter: string,
    source: LessonSource,
    classId: string,
    room: string,
    time: string,
  ) {
    const startsAt = at(DATE, time);
    const block = await database.migrator
      .insertInto('lesson_blocks')
      .values({
        branch_id: branch,
        academic_year_id: year,
        quarter_id: quarter,
        lesson_date: DATE,
        starts_at: startsAt,
        ends_at: new Date(startsAt.getTime() + 45 * 60_000),
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
        room_id: room,
      })
      .returning(['id', 'block_id', 'starts_at', 'ends_at'])
      .executeTakeFirstOrThrow();
    return lesson;
  }

  /** A record of a room change of the scene's lesson, as the route writes it. */
  const record = (place: Fresh, values: Record<string, unknown> = {}) =>
    app().run([place.branch], (transaction) =>
      transaction
        .insertInto('lesson_day_changes')
        .values({
          branch_id: place.branch,
          lesson_id: place.lesson.id,
          kind: 'room',
          class_id: place.classId,
          group_id: null,
          subject_id: subject,
          load_row_id: place.source.lessons[0]?.loadRowId ?? null,
          from_date: DATE,
          from_starts_at: place.lesson.starts_at,
          from_ends_at: place.lesson.ends_at,
          from_room_id: place.room,
          to_date: DATE,
          to_starts_at: place.lesson.starts_at,
          to_ends_at: place.lesson.ends_at,
          to_room_id: place.room,
          reason: 'The room is painted',
          changed_at: new Date(NOW),
          changed_by: account,
          ...values,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    kit = await LessonsKit.create(database.migrator);
    subject = await kit.load.classes.subject({ grades: [7] });
    account = await kit.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('keeps a record to its branch: another branch sees nothing', async () => {
    const place = await fresh();
    const other = await fresh();
    const { id } = await record(place);
    const seen = await app().run([other.branch], (transaction) =>
      transaction.selectFrom('lesson_day_changes').select('id').where('id', '=', id).execute(),
    );
    expect(seen).toEqual([]);
    const own = await app().run([place.branch], (transaction) =>
      transaction.selectFrom('lesson_day_changes').select('id').where('id', '=', id).execute(),
    );
    expect(own).toEqual([{ id }]);
  });

  it('refuses the application an update and a delete of a record', async () => {
    const place = await fresh();
    const { id } = await record(place);
    expect(
      await outcome(
        app().run([place.branch], (transaction) =>
          transaction
            .updateTable('lesson_day_changes')
            .set({ reason: 'Another reason' })
            .where('id', '=', id)
            .execute(),
        ),
      ),
    ).toBe('42501');
    expect(
      await outcome(
        app().run([place.branch], (transaction) =>
          transaction.deleteFrom('lesson_day_changes').where('id', '=', id).execute(),
        ),
      ),
    ).toBe('42501');
  });

  it('refuses a record with both or neither of a class and a group, and a reason of spaces or of 501 characters', async () => {
    const place = await fresh();
    const group = await kit.load.classes.group(place.branch, place.year, subject, [place.classId]);
    expect(await outcome(record(place, { class_id: null }))).toBe('lesson_day_changes_unit_check');
    expect(await outcome(record(place, { group_id: group }))).toBe('lesson_day_changes_unit_check');
    for (const reason of ['   ', 'x'.repeat(501)]) {
      expect(await outcome(record(place, { reason }))).toBe('lesson_day_changes_reason_check');
    }
  });

  it('keeps the record with no lesson once the lesson is removed', async () => {
    const place = await fresh();
    const { id } = await record(place);
    // As a publish removes it, dated after today.
    await app().run([place.branch], (transaction) =>
      transaction.deleteFrom('lessons').where('id', '=', place.lesson.id).execute(),
    );
    const kept = await database.migrator
      .selectFrom('lesson_day_changes')
      .select(['lesson_id', 'from_room_id', 'reason'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(kept).toEqual({
      lesson_id: null,
      from_room_id: place.room,
      reason: 'The room is painted',
    });
  });

  it('moves a block’s lessons and their claims with it, and refuses a move into a taken room or another quarter', async () => {
    const place = await fresh();
    // Another class's lesson in the same room at 10:00.
    const otherClass = await kit.load.classes.schoolClass(place.branch, place.year, { grade: 7 });
    const otherSource = await kit.source(
      place.branch,
      place.year,
      [{ classId: otherClass, groupId: null, subjectId: subject }],
      '2026-10-19',
    );
    await lessonOn(
      place.branch,
      place.year,
      place.quarters[0] ?? '',
      otherSource,
      otherClass,
      place.room,
      '10:00',
    );
    const moveTo = (date: string, time: string) =>
      outcome(
        app().run([place.branch], (transaction) =>
          transaction
            .updateTable('lesson_blocks')
            .set({
              lesson_date: date,
              starts_at: at(date, time),
              ends_at: new Date(at(date, time).getTime() + 45 * 60_000),
            })
            .where('id', '=', place.lesson.block_id)
            .execute(),
        ),
      );
    expect(await moveTo(DATE, '10:00')).toBe('time_claims_room_excl');
    expect(await moveTo('2026-11-09', '09:00')).toBe('lesson_block_quarter');
    expect(await moveTo(DATE, '11:00')).toBe('written');
    const lesson = await database.migrator
      .selectFrom('lessons')
      .select('starts_at')
      .where('id', '=', place.lesson.id)
      .executeTakeFirstOrThrow();
    expect(lesson.starts_at).toEqual(at(DATE, '11:00'));
    const claim = await database.migrator
      .selectFrom('time_claims')
      .select(sql<Date>`lower(during)`.as('starts'))
      .where('lesson_id', '=', place.lesson.id)
      .where('kind', '=', 'lesson')
      .executeTakeFirstOrThrow();
    expect(claim.starts).toEqual(at(DATE, '11:00'));
  });
});
