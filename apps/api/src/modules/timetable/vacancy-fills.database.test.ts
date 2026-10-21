import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit, type LessonSource } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
const TODAY = '2026-10-15';
/** A Monday before today, when the first versions start. */
const EARLY = '2026-09-07';
/** A Monday after today: the day a fill closes the vacancy from. */
const CLOSE_DAY = '2026-10-26';
const DAY_BEFORE = '2026-10-25';

/** What a promise came to: `written`, or the constraint that refused it. */
const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => (error as { constraint?: string }).constraint ?? String(error),
  );

// Task 5.7a-3a, pull request #188 (db/migrations/0099): the close of a
// vacancy from a later day (decision 6, Look first: a published version no
// longer holds a close from a day on or after which a later version of its
// chain starts), the lesson guard of the From line of 5.5c-2b ("A write that
// puts a lesson under a staff record ... refuses a closed vacancy"), and the
// fills kept insert only (decision 11). Each test has a branch of its own.
// All names are invented.
describe('a vacancy closed from a later day in the database', () => {
  let database: TestDatabase;
  let kit: LessonsKit;
  let subject: string;
  let branchCount = 0;

  const clockAt = (moment: string) => new Transactions(database.app, new FixedClock(moment));

  /** A branch with a dated year, a class of grade 7 and an open vacancy that may take it. */
  async function fresh() {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branchCount)}`);
    const { year, quarters } = await kit.year(branch);
    const classId = await kit.load.classes.schoolClass(branch, year, { grade: 7 });
    const vacancy = await kit.load.vacancy(branch, { subjects: [{ subject, grades: [7] }] });
    const quarter = quarters[0] ?? '';
    return { branch, year, quarter, classId, vacancy };
  }

  type Fresh = Awaited<ReturnType<typeof fresh>>;

  /** A version of the branch's year with a row of the class naming `teacher`, published unless said. */
  async function naming(
    place: Fresh,
    startsOn: string,
    status: 'draft' | 'published' | 'archived' = 'published',
    teacher = place.vacancy,
  ): Promise<string> {
    const version = await kit.load.version(place.branch, place.year, { startsOn });
    await kit.load.row({
      branch_id: place.branch,
      version_id: version,
      class_id: place.classId,
      subject_id: subject,
      teacher_id: teacher,
    });
    if (status !== 'draft') {
      await kit.load.setVersion(version, status);
    }
    return version;
  }

  /** A published version of the branch's year with no rows. */
  const later = async (place: Fresh, startsOn: string) => {
    const version = await kit.load.version(place.branch, place.year, { startsOn });
    await kit.load.setVersion(version, 'published');
    return version;
  };

  /** The close of the vacancy from today of `moment`, as the route writes it. */
  const close = (place: Fresh, moment = NOW, day = TODAY) =>
    outcome(
      clockAt(moment).run([place.branch], async (transaction) => {
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', place.vacancy)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('staff_statuses')
          .set({ valid_until: day })
          .where('staff_id', '=', place.vacancy)
          .where('valid_until', 'is', null)
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: place.vacancy, status: 'closed', valid_from: day })
          .execute();
      }),
    );

  /** What `vacancy_close_holders` gives for a close from `day`, read at `moment`. */
  const holders = (place: Fresh, moment = NOW, day = TODAY) =>
    clockAt(moment).run([place.branch], async (transaction) =>
      sql<{ version_id: string | null; version_number: number | null; lesson_date: string | null }>`
        select version_id, version_number, lesson_date
        from vacancy_close_holders(${place.vacancy}::uuid, ${place.branch}::uuid, ${day}::date)
      `
        .execute(transaction)
        .then((found) => found.rows),
    );

  /** A published source of one lesson of the class (`LessonsKit.source`). */
  const sourceOf = (place: Fresh, startsOn = EARLY) =>
    kit.source(
      place.branch,
      place.year,
      [{ classId: place.classId, groupId: null, subjectId: subject }],
      startsOn,
    );

  /** A lesson of the class on `date` at 23:00 to 23:30, by the migrator. */
  async function lessonOn(
    place: Fresh,
    source: LessonSource,
    date: string,
    teacher: string | null,
    cancelled = false,
  ): Promise<string> {
    const block = await database.migrator
      .insertInto('lesson_blocks')
      .values({
        branch_id: place.branch,
        academic_year_id: place.year,
        quarter_id: place.quarter,
        lesson_date: date,
        starts_at: at(date, '23:00'),
        ends_at: at(date, '23:30'),
        version_id: source.versionId,
        pattern_block_id: source.patternBlockId,
      })
      .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
      .executeTakeFirstOrThrow();
    const from = source.lessons[0];
    const lesson = await database.migrator
      .insertInto('lessons')
      .values({
        branch_id: place.branch,
        block_id: block.id,
        lesson_date: block.lesson_date,
        starts_at: block.starts_at,
        ends_at: block.ends_at,
        class_id: place.classId,
        group_id: null,
        subject_id: subject,
        load_row_id: from?.loadRowId ?? '',
        pattern_entry_id: from?.patternEntryId ?? '',
        teacher_id: teacher,
        ...(cancelled ? { cancel_cause: 'reason', cancel_reason: 'Excursion' } : {}),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return lesson.id;
  }

  /** The vacancy closed from `day` by the migrator: the open row cut there, a closed row from it. */
  async function closedFrom(place: Fresh, day: string) {
    await database.migrator.transaction().execute(async (transaction) => {
      await transaction
        .updateTable('staff_statuses')
        .set({ valid_until: day })
        .where('staff_id', '=', place.vacancy)
        .where('valid_until', 'is', null)
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: place.vacancy, status: 'closed', valid_from: day })
        .execute();
    });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    kit = await LessonsKit.create(database.migrator);
    subject = await kit.load.classes.subject({ grades: [7] });
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('vacancy_close_holders from a later day (decision 6)', () => {
    it('lets go a published version once a later one starts on or before the close day; today reads as 0083', async () => {
      const place = await fresh();
      const held = await naming(place, EARLY);
      await later(place, CLOSE_DAY);
      expect(await holders(place, NOW, CLOSE_DAY)).toEqual([]);
      // The day before, the earlier version still runs.
      expect(await holders(place, NOW, DAY_BEFORE)).toEqual([
        { version_id: held, version_number: 1, lesson_date: null },
      ]);
      // From today the later version has not started: it holds, as before.
      expect(await holders(place)).toEqual([
        { version_id: held, version_number: 1, lesson_date: null },
      ]);
      expect(await close(place, NOW, CLOSE_DAY)).toBe('written');
    });

    it('holds a draft that names the vacancy and a lesson under it from the day, whatever the chain', async () => {
      const drafted = await fresh();
      const draft = await naming(drafted, EARLY, 'draft');
      await later(drafted, CLOSE_DAY);
      expect(await holders(drafted, NOW, CLOSE_DAY)).toEqual([
        { version_id: draft, version_number: 1, lesson_date: null },
      ]);
      expect(await close(drafted, NOW, CLOSE_DAY)).toBe('vacancy_has_load');
      const taught = await fresh();
      const source = await sourceOf(taught);
      await lessonOn(taught, source, '2026-10-28', taught.vacancy);
      expect(await holders(taught, NOW, CLOSE_DAY)).toEqual([
        { version_id: null, version_number: null, lesson_date: '2026-10-28' },
      ]);
      expect(await close(taught, NOW, CLOSE_DAY)).toBe('vacancy_has_load');
    });
  });

  describe('lessons_vacancy_closed', () => {
    it('refuses a lesson written under the vacancy on a closed day, and lets one before it', async () => {
      const place = await fresh();
      const source = await sourceOf(place);
      await closedFrom(place, CLOSE_DAY);
      expect(await outcome(lessonOn(place, source, CLOSE_DAY, place.vacancy))).toBe(
        'lesson_vacancy_closed',
      );
      expect(await outcome(lessonOn(place, source, '2026-10-30', place.vacancy))).toBe(
        'lesson_vacancy_closed',
      );
      expect(await outcome(lessonOn(place, source, DAY_BEFORE, place.vacancy))).toBe('written');
      // Another teacher on the closed day is written.
      expect(await outcome(lessonOn(place, source, CLOSE_DAY, null))).toBe('written');
    });

    it('refuses a change of a lesson of a closed day to the vacancy', async () => {
      const place = await fresh();
      const source = await sourceOf(place);
      await closedFrom(place, CLOSE_DAY);
      const lesson = await lessonOn(place, source, CLOSE_DAY, null);
      expect(
        await outcome(
          database.migrator
            .updateTable('lessons')
            .set({ teacher_id: place.vacancy })
            .where('id', '=', lesson)
            .execute(),
        ),
      ).toBe('lesson_vacancy_closed');
    });

    it('refuses a move of a lesson of the vacancy onto a closed day', async () => {
      const place = await fresh();
      const source = await sourceOf(place);
      await closedFrom(place, CLOSE_DAY);
      const lesson = await lessonOn(place, source, DAY_BEFORE, place.vacancy);
      const { block_id: blockId } = await database.migrator
        .selectFrom('lessons')
        .select('block_id')
        .where('id', '=', lesson)
        .executeTakeFirstOrThrow();
      // The block's date and times move; the lesson's follow by its key.
      expect(
        await outcome(
          database.migrator
            .updateTable('lesson_blocks')
            .set({
              lesson_date: CLOSE_DAY,
              starts_at: at(CLOSE_DAY, '23:00'),
              ends_at: at(CLOSE_DAY, '23:30'),
            })
            .where('id', '=', blockId)
            .execute(),
        ),
      ).toBe('lesson_vacancy_closed');
    });
  });

  describe('vacancy_fills (decision 11)', () => {
    it('is insert only for the application', async () => {
      const place = await fresh();
      const person = (await kit.load.teacher(place.branch)).staffId;
      const account = await database.migrator
        .selectFrom('accounts')
        .select('id')
        .executeTakeFirstOrThrow();
      const fill = await clockAt(NOW).run([place.branch], (transaction) =>
        transaction
          .insertInto('vacancy_fills')
          .values({
            branch_id: place.branch,
            vacancy_id: place.vacancy,
            person_id: person,
            fills_from: CLOSE_DAY,
            version_id: null,
            created_by: account.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
      const denied = (work: (transaction: Transaction) => Promise<unknown>) =>
        clockAt(NOW)
          .run([place.branch], work)
          .then(
            () => 'written',
            (error: unknown) => (error as { code?: string }).code,
          );
      expect(
        await denied((transaction) =>
          transaction
            .updateTable('vacancy_fills')
            .set({ fills_from: DAY_BEFORE })
            .where('id', '=', fill.id)
            .execute(),
        ),
      ).toBe('42501');
      expect(
        await denied((transaction) =>
          transaction.deleteFrom('vacancy_fills').where('id', '=', fill.id).execute(),
        ),
      ).toBe('42501');
      expect(
        await denied((transaction) =>
          transaction.deleteFrom('vacancy_fill_rows').where('fill_id', '=', fill.id).execute(),
        ),
      ).toBe('42501');
    });
  });
});
