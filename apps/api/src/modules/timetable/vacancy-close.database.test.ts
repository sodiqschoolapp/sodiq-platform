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
const TOMORROW = '2026-10-16';
const YESTERDAY = '2026-10-14';
/** A Monday before today, when the first versions start. */
const EARLY = '2026-09-07';
/** The last day of the test year (`ClassesKit.year`). */
const YEAR_END = '2027-05-31';

/** A transaction held open after `work`, released by the test. */
function holding(
  run: (work: (transaction: Transaction) => Promise<void>) => Promise<void>,
  work: (transaction: Transaction) => Promise<void>,
): { ready: Promise<void>; release: () => void; done: Promise<void> } {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready: () => void = () => undefined;
  const isReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const done = run(async (transaction) => {
    await work(transaction);
    ready();
    await released;
  });
  return { ready: Promise.race([isReady, done]), release, done };
}

/** What a promise came to: `written`, or the constraint that refused it. */
const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => (error as { constraint?: string }).constraint ?? String(error),
  );

// The close of a vacancy (db/migrations/0083; task 5.5c-2b, pull request
// #157, decisions 1, 2 and 4 with review corrections 1 to 3). 04, Vacancy: "A
// vacancy cannot be closed while a load row names it or a future lesson is
// under it. One that never held a load can be deleted; one that did is closed
// and kept." Every close is written as `sodiq_app` through the branch filter,
// with no service in between, as the route writes it. Each test has a branch
// of its own: the chain of one branch and year decides which rows hold. All
// names are invented.
describe('the close of a vacancy in the database', () => {
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

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    kit = await LessonsKit.create(database.migrator);
    subject = await kit.load.classes.subject({ grades: [7] });
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('is refused while a row of a draft names the vacancy', async () => {
    const place = await fresh();
    const draft = await naming(place, TOMORROW, 'draft');
    expect(await holders(place)).toEqual([
      { version_id: draft, version_number: 1, lesson_date: null },
    ]);
    expect(await close(place)).toBe('vacancy_has_load');
  });

  it('is refused while a published version in force today, or one not started, names it', async () => {
    const running = await fresh();
    await naming(running, EARLY);
    expect(await close(running)).toBe('vacancy_has_load');
    const coming = await fresh();
    await naming(coming, TOMORROW);
    expect(await close(coming)).toBe('vacancy_has_load');
  });

  it('is allowed once a later published version has started, and refused the day before', async () => {
    const place = await fresh();
    await naming(place, EARLY);
    await later(place, TODAY);
    expect(await holders(place)).toEqual([]);
    expect(await close(place)).toBe('written');

    // The later version starting tomorrow could still be withdrawn and run
    // the first one again: it holds.
    const before = await fresh();
    const held = await naming(before, EARLY);
    await later(before, TOMORROW);
    expect(await holders(before)).toEqual([
      { version_id: held, version_number: 1, lesson_date: null },
    ]);
    expect(await close(before)).toBe('vacancy_has_load');
  });

  it('is allowed once the year of the last version naming it has ended, the year not closed', async () => {
    const place = await fresh();
    await naming(place, EARLY);
    // The last day of the year is today: the version still runs.
    expect(await close(place, `${YEAR_END}T10:00:00+05:00`, YEAR_END)).toBe('vacancy_has_load');
    const status = await database.migrator
      .selectFrom('academic_years')
      .select('status')
      .where('id', '=', place.year)
      .executeTakeFirstOrThrow();
    expect(status.status).toBe('current');
    expect(await close(place, '2027-06-01T10:00:00+05:00', '2027-06-01')).toBe('written');
  });

  it('is allowed when the only rows are of a withdrawn version that had not started', async () => {
    const place = await fresh();
    await naming(place, TOMORROW, 'archived');
    expect(await holders(place)).toEqual([]);
    expect(await close(place)).toBe('written');
  });

  it('reads a tie on a start by number: the lower one holds until the start has come', async () => {
    const started = await fresh();
    await naming(started, TODAY);
    await later(started, TODAY);
    expect(await close(started)).toBe('written');

    const coming = await fresh();
    const lower = await naming(coming, TOMORROW);
    await later(coming, TOMORROW);
    expect(await holders(coming)).toEqual([
      { version_id: lower, version_number: 1, lesson_date: null },
    ]);
    expect(await close(coming)).toBe('vacancy_has_load');
  });

  it('is refused with a lesson dated after today under it, also a cancelled one, and not with one today', async () => {
    const place = await fresh();
    const source = await sourceOf(place);
    await later(place, TODAY);
    await lessonOn(place, source, TOMORROW, place.vacancy);
    expect(await holders(place)).toEqual([
      { version_id: null, version_number: null, lesson_date: TOMORROW },
    ]);
    expect(await close(place)).toBe('vacancy_has_load');

    const cancelledPlace = await fresh();
    const cancelledSource = await sourceOf(cancelledPlace);
    await later(cancelledPlace, TODAY);
    await lessonOn(cancelledPlace, cancelledSource, TOMORROW, cancelledPlace.vacancy, true);
    expect(await close(cancelledPlace)).toBe('vacancy_has_load');

    const todayPlace = await fresh();
    const todaySource = await sourceOf(todayPlace);
    await later(todayPlace, TODAY);
    await lessonOn(todayPlace, todaySource, TODAY, todayPlace.vacancy);
    await lessonOn(todayPlace, todaySource, YESTERDAY, todayPlace.vacancy);
    expect(await holders(todayPlace)).toEqual([]);
    expect(await close(todayPlace)).toBe('written');
  });

  it('holds every published row and lesson without a moment', async () => {
    const place = await fresh();
    const ended = await naming(place, EARLY);
    const source = await sourceOf(place);
    await later(place, TODAY);
    // A lesson today: with a moment neither it nor the ended version holds.
    await lessonOn(place, source, TODAY, place.vacancy);
    expect(await holders(place)).toEqual([]);
    const found = await sql<{ version_id: string | null; lesson_date: string | null }>`
      select version_id, lesson_date
      from vacancy_close_holders(${place.vacancy}::uuid, ${place.branch}::uuid, ${TODAY}::date)
    `.execute(database.migrator);
    expect(found.rows).toEqual([
      { version_id: ended, lesson_date: null },
      { version_id: null, lesson_date: TODAY },
    ]);
  });

  // The close day bounds the lessons (review correction 3): a close from a
  // later day counts the lessons from that day only.
  it('counts the lessons from the close day when it comes after today', async () => {
    const before = await fresh();
    const beforeSource = await sourceOf(before);
    await later(before, TODAY);
    await lessonOn(before, beforeSource, '2026-10-19', before.vacancy);
    expect(await holders(before, NOW, '2026-10-20')).toEqual([]);
    expect(await close(before, NOW, '2026-10-20')).toBe('written');

    const on = await fresh();
    const onSource = await sourceOf(on);
    await later(on, TODAY);
    await lessonOn(on, onSource, '2026-10-20', on.vacancy);
    expect(await holders(on, NOW, '2026-10-20')).toEqual([
      { version_id: null, version_number: null, lesson_date: '2026-10-20' },
    ]);
    expect(await close(on, NOW, '2026-10-20')).toBe('vacancy_has_load');
  });

  // Review correction 1 and the permission review of the code: the branch is
  // a parameter, a branch of the transaction, and the record a vacancy of it.
  describe('refuses an application caller', () => {
    const holdersAs = (branches: string[], record: string, branch: string) =>
      outcome(
        clockAt(NOW).run(branches, (transaction) =>
          sql`select * from vacancy_close_holders(${record}::uuid, ${branch}::uuid, ${TODAY}::date)`.execute(
            transaction,
          ),
        ),
      );

    it('nothing for its own vacancy, which a version holds', async () => {
      const place = await fresh();
      await naming(place, EARLY);
      expect(await holdersAs([place.branch], place.vacancy, place.branch)).toBe('written');
    });

    it('a vacancy of another branch, named with its own branch or with that one', async () => {
      const place = await fresh();
      await naming(place, EARLY);
      const other = await fresh();
      expect(await holdersAs([other.branch], place.vacancy, other.branch)).toBe(
        'vacancy_not_in_branch',
      );
      expect(await holdersAs([other.branch], place.vacancy, place.branch)).toBe(
        'vacancy_not_in_branch',
      );
    });

    it('a person who works in both branches, named by the load of the other one', async () => {
      const place = await fresh();
      const other = await fresh();
      const person = await kit.load.teacher(other.branch, {
        subjects: [{ subject, grades: [7] }],
        further: [place.branch],
      });
      await naming(other, EARLY, 'published', person.staffId);
      expect(await holdersAs([place.branch], person.staffId, place.branch)).toBe(
        'vacancy_not_in_branch',
      );
    });

    it('an unknown record', async () => {
      const place = await fresh();
      expect(
        await holdersAs([place.branch], '0199a000-0000-7000-8000-000000000099', place.branch),
      ).toBe('vacancy_not_in_branch');
    });
  });

  it('never refuses a closed row with an empty range (0055 guard kept)', async () => {
    const place = await fresh();
    await naming(place, EARLY);
    const written = await outcome(
      clockAt(NOW).run([place.branch], (transaction) =>
        transaction
          .insertInto('staff_statuses')
          .values({
            staff_id: place.vacancy,
            status: 'closed',
            valid_from: TOMORROW,
            valid_until: TOMORROW,
          })
          .execute(),
      ),
    );
    expect(written).toBe('written');
  });

  it('keeps the delete refused for a vacancy whose published rows have all ended', async () => {
    const place = await fresh();
    await naming(place, EARLY);
    await later(place, TODAY);
    expect(await close(place)).toBe('written');
    const deleted = await outcome(
      clockAt(NOW).run([place.branch], (transaction) =>
        sql`select vacancy_delete(${place.vacancy}::uuid)`.execute(transaction),
      ),
    );
    expect(deleted).toBe('vacancy_has_load');
  });

  describe('at the same moment as a lesson put under the vacancy', () => {
    /** A vacancy with no row, and a lesson of another teacher tomorrow of an ended version. */
    async function withLesson() {
      const place = await fresh();
      const source = await sourceOf(place);
      await later(place, TODAY);
      const teacher = await database.migrator
        .selectFrom('teaching_load_rows')
        .select('teacher_id')
        .where('id', '=', source.lessons[0]?.loadRowId ?? '')
        .executeTakeFirstOrThrow();
      const lesson = await lessonOn(place, source, TOMORROW, teacher.teacher_id);
      return { place, lesson };
    }

    it('closes the vacancy when no lesson is put under it', async () => {
      const { place } = await withLesson();
      expect(await close(place)).toBe('written');
    });

    it('waits for the lesson being moved under it and is refused', async () => {
      const { place, lesson } = await withLesson();
      const held = holding(
        (run) => clockAt(NOW).run([place.branch], run),
        async (transaction) => {
          await transaction
            .selectFrom('staff')
            .select('id')
            .where('id', '=', place.vacancy)
            .forKeyShare()
            .execute();
          await transaction
            .updateTable('lessons')
            .set({ teacher_id: place.vacancy })
            .where('id', '=', lesson)
            .execute();
        },
      );
      await held.ready;
      const closing = close(place);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await outcome(held.done)).toBe('written');
      expect(await closing).toBe('vacancy_has_load');
    });
  });
});
