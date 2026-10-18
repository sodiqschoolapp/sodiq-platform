import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';
const FOREIGN_KEY_VIOLATION = '23503';
const INSUFFICIENT_PRIVILEGE = '42501';
const NOT_NULL_VIOLATION = '23502';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
/** Monday 19 October 2026, a school day of quarter 1. */
const MONDAY = '2026-10-19';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

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

/** One lesson of a block as a test writes it. */
interface LessonInput {
  classId?: string;
  groupId?: string;
  subjectId?: string;
  teacherId?: string | null;
  roomId?: string | null;
  loadRowId?: string;
  patternEntryId?: string;
  cancel?: boolean;
}

/** A block as a test writes it: a date and clock times in Tashkent. */
interface BlockInput {
  date?: string;
  start: string;
  end: string;
  versionId?: string;
  patternBlockId?: string;
  quarterId?: string;
  pairId?: string | null;
}

// The clash rules that the database itself keeps over the dated lessons
// (db/migrations/0058; task 5.1a, pull request #107), also when the
// application has a fault: every write below is made as `sodiq_app` through
// the branch filter, with no service in between. 06, Rules: "A teacher cannot
// be in two lessons at the same time." "A room cannot hold two lessons at the
// same time, unless the room is marked as shared". "A class cannot have two
// lessons at the same time. No student can be in two lessons at once".
// edge/developer-rules: Lesson times, Teacher in one place, Room in one use,
// Class in one block, Exams (the one table of time claims). All names are
// invented.
describe('dated lessons and their time claims in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LessonsKit;
  let north: string;
  let south: string;
  const years = new Map<string, { year: string; quarters: string[] }>();
  let subject: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** The quarter of the branch's year that holds the date (quarter 1 for October). */
  const quarterOf = (branch: string, date: string): string => {
    const quarters = years.get(branch)?.quarters ?? [];
    const index = date < '2026-11-01' ? 0 : date < '2027-01-01' ? 1 : date < '2027-03-25' ? 2 : 3;
    return quarters[index] ?? '';
  };

  /**
   * A block and its lessons, written in the transaction given. Without a
   * version named, the block and its lessons stand on a version and pattern of
   * their own that the migrator writes first (`LessonsKit.source`).
   */
  async function write(
    transaction: Transaction,
    branch: string,
    block: BlockInput,
    lessons: readonly LessonInput[],
  ): Promise<{ block: string; lessons: string[] }> {
    const date = block.date ?? MONDAY;
    const source =
      block.versionId === undefined
        ? await kit.source(
            branch,
            years.get(branch)?.year ?? '',
            lessons.map((lesson) => ({
              classId: lesson.classId ?? null,
              groupId: lesson.groupId ?? null,
              subjectId: lesson.subjectId ?? subject,
            })),
          )
        : null;
    const written = await transaction
      .insertInto('lesson_blocks')
      .values({
        branch_id: branch,
        academic_year_id: years.get(branch)?.year ?? '',
        quarter_id: block.quarterId ?? quarterOf(branch, date),
        lesson_date: date,
        starts_at: at(date, block.start),
        ends_at: at(date, block.end),
        version_id: block.versionId ?? source?.versionId ?? '',
        pattern_block_id: block.patternBlockId ?? source?.patternBlockId ?? '',
        double_pair_id: block.pairId ?? null,
      })
      .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
      .executeTakeFirstOrThrow();
    const ids: string[] = [];
    for (const [index, lesson] of lessons.entries()) {
      const from = source?.lessons[index];
      const row = await transaction
        .insertInto('lessons')
        .values({
          branch_id: branch,
          block_id: written.id,
          lesson_date: written.lesson_date,
          starts_at: written.starts_at,
          ends_at: written.ends_at,
          class_id: lesson.classId ?? null,
          group_id: lesson.groupId ?? null,
          subject_id: lesson.subjectId ?? subject,
          load_row_id: lesson.loadRowId ?? from?.loadRowId ?? '',
          pattern_entry_id: lesson.patternEntryId ?? from?.patternEntryId ?? '',
          teacher_id: lesson.teacherId ?? null,
          room_id: lesson.roomId ?? null,
          cancel_cause: lesson.cancel === true ? 'reason' : null,
          cancel_reason: lesson.cancel === true ? 'Excursion to the museum' : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      ids.push(row.id);
    }
    return { block: written.id, lessons: ids };
  }

  /** A block and its lessons, written as the application writes them. */
  const place = (branch: string, block: BlockInput, lessons: readonly LessonInput[]) =>
    inBranch(branch, (transaction) => write(transaction, branch, block, lessons));

  /** Lessons updated as the application updates them, in one transaction. */
  const updateLesson = (
    branch: string,
    id: string,
    values: {
      teacher_id?: string | null;
      room_id?: string | null;
      cancel_cause?: 'reason' | null;
      cancel_reason?: string | null;
    },
  ) =>
    inBranch(branch, (transaction) =>
      transaction.updateTable('lessons').set(values).where('id', '=', id).execute(),
    );

  const cancel = (branch: string, id: string) =>
    updateLesson(branch, id, { cancel_cause: 'reason', cancel_reason: 'Excursion to the museum' });

  const restore = (branch: string, id: string) =>
    updateLesson(branch, id, { cancel_cause: null, cancel_reason: null });

  /** A block moved whole to another date and clock time. */
  const moveBlock = (branch: string, id: string, date: string, start: string, end: string) =>
    inBranch(branch, (transaction) =>
      transaction
        .updateTable('lesson_blocks')
        .set({ lesson_date: date, starts_at: at(date, start), ends_at: at(date, end) })
        .where('id', '=', id)
        .execute(),
    );

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  async function untilWaiting(count: number): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await waitingForALock()) >= count) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Nothing waited for a lock.');
  }

  /** The claims of a lesson or a block, as the database wrote them. */
  const claimsOf = (blockId: string) =>
    database.migrator
      .selectFrom('time_claims')
      .select(['kind', 'lesson_id', 'class_id', 'teacher_id', 'room_id', 'during'])
      .where('block_id', '=', blockId)
      .orderBy('kind')
      .orderBy('class_id')
      .execute();

  const schoolClass = (branch = north, grade = 7) =>
    kit.load.classes.schoolClass(branch, years.get(branch)?.year ?? '', { grade });

  const teacher = async (branch = north) => (await kit.load.teacher(branch)).staffId;

  const group = (classIds: readonly string[], subjectId: string, branch = north) =>
    kit.load.classes.group(branch, years.get(branch)?.year ?? '', subjectId, classIds);

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    years.set(north, await kit.year(north));
    years.set(south, await kit.year(south));
    subject = await kit.load.classes.subject({ grades: [5, 6, 7, 8, 9, 10, 11] });
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('a teacher in one place (time_claims_teacher_excl)', () => {
    it('refuses two lessons of one teacher at once, and passes one that starts as the other ends', async () => {
      const smith = await teacher();
      await place(north, { start: '09:00', end: '09:45' }, [
        { classId: await schoolClass(), teacherId: smith },
      ]);
      expect(
        await refusal(
          place(north, { start: '09:30', end: '10:15' }, [
            { classId: await schoolClass(), teacherId: smith },
          ]),
        ),
      ).toMatchObject({ code: EXCLUSION_VIOLATION, constraint: 'time_claims_teacher_excl' });
      // Half-open: a lesson ending at 09:45 does not overlap one starting at 09:45.
      await place(north, { start: '09:45', end: '10:30' }, [
        { classId: await schoolClass(), teacherId: smith },
      ]);
    });

    it('refuses the teacher in two branches by clock time, each written with its own branch only', async () => {
      // Grades 1–4 have 40-minute lessons and grades 5–11 have 45: slot 3 of
      // the one (10:20 to 11:00) overlaps slot 2 of the other (10:00 to 10:45).
      const smith = await teacher(north);
      await place(north, { start: '10:00', end: '10:45' }, [
        { classId: await schoolClass(north, 7), teacherId: smith },
      ]);
      expect(
        await refusal(
          place(south, { start: '10:20', end: '11:00' }, [
            { classId: await schoolClass(south, 3), teacherId: smith },
          ]),
        ),
      ).toMatchObject({ code: EXCLUSION_VIOLATION, constraint: 'time_claims_teacher_excl' });
      await place(south, { start: '10:45', end: '11:25' }, [
        { classId: await schoolClass(south, 3), teacherId: smith },
      ]);
    });

    it('refuses a vacancy in two lessons at once, as a teacher', async () => {
      const wanted = await kit.load.vacancy(north);
      await place(north, { start: '11:00', end: '11:45' }, [
        { classId: await schoolClass(), teacherId: wanted },
      ]);
      expect(
        await refusal(
          place(north, { start: '11:00', end: '11:45' }, [
            { classId: await schoolClass(), teacherId: wanted },
          ]),
        ),
      ).toMatchObject({ constraint: 'time_claims_teacher_excl' });
    });

    it('frees the teacher of a cancelled lesson, and refuses its restore while the time is taken', async () => {
      const smith = await teacher();
      const first = await place(north, { start: '12:00', end: '12:45' }, [
        { classId: await schoolClass(), teacherId: smith },
      ]);
      const lesson = first.lessons[0] ?? '';
      await cancel(north, lesson);
      expect(await claimsOf(first.block)).toEqual([]);
      await place(north, { start: '12:00', end: '12:45' }, [
        { classId: await schoolClass(), teacherId: smith },
      ]);
      expect(await refusal(restore(north, lesson))).toMatchObject({
        constraint: 'time_claims_teacher_excl',
      });
    });

    it('claims no teacher for a lesson that names nobody', async () => {
      const one = await place(north, { start: '13:00', end: '13:45' }, [
        { classId: await schoolClass(), teacherId: null },
      ]);
      await place(north, { start: '13:00', end: '13:45' }, [
        { classId: await schoolClass(), teacherId: null },
      ]);
      expect((await claimsOf(one.block)).find((c) => c.kind === 'lesson')).toMatchObject({
        teacher_id: null,
      });
    });

    it('refuses a substitute who is in another lesson at that time', async () => {
      const smith = await teacher();
      const jones = await teacher();
      await place(north, { start: '14:00', end: '14:45' }, [
        { classId: await schoolClass(), teacherId: jones },
      ]);
      const other = await place(north, { start: '14:15', end: '15:00' }, [
        { classId: await schoolClass(), teacherId: smith },
      ]);
      expect(
        await refusal(updateLesson(north, other.lessons[0] ?? '', { teacher_id: jones })),
      ).toMatchObject({ constraint: 'time_claims_teacher_excl' });
    });
  });

  describe('a room in one use (time_claims_room_excl, room_shared_full, room_shared_capacity)', () => {
    it('refuses two lessons in a room that is not shared, and a room change into it', async () => {
      const room = await kit.room(north);
      await place(north, { date: '2026-10-20', start: '09:00', end: '09:45' }, [
        { classId: await schoolClass(), roomId: room },
      ]);
      expect(
        await refusal(
          place(north, { date: '2026-10-20', start: '09:00', end: '09:45' }, [
            { classId: await schoolClass(), roomId: room },
          ]),
        ),
      ).toMatchObject({ code: EXCLUSION_VIOLATION, constraint: 'time_claims_room_excl' });
      const elsewhere = await place(north, { date: '2026-10-20', start: '09:10', end: '09:55' }, [
        { classId: await schoolClass(), roomId: await kit.room(north) },
      ]);
      expect(
        await refusal(updateLesson(north, elsewhere.lessons[0] ?? '', { room_id: room })),
      ).toMatchObject({ constraint: 'time_claims_room_excl' });
    });

    it('takes a shared room up to its number of lessons at once and refuses one more', async () => {
      const hall = await kit.room(north, { most: 2 });
      const at10 = { date: '2026-10-20', start: '10:00', end: '10:45' };
      await place(north, at10, [{ classId: await schoolClass(), roomId: hall }]);
      await place(north, at10, [{ classId: await schoolClass(), roomId: hall }]);
      expect(
        await refusal(place(north, at10, [{ classId: await schoolClass(), roomId: hall }])),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'room_shared_full' });
    });

    it('counts at the start of the new lesson too, not only at the starts of the others (correction 3)', async () => {
      const hall = await kit.room(north, { most: 2 });
      const at9 = { date: '2026-10-21', start: '09:00', end: '09:45' };
      await place(north, at9, [{ classId: await schoolClass(), roomId: hall }]);
      await place(north, at9, [{ classId: await schoolClass(), roomId: hall }]);
      expect(
        await refusal(
          place(north, { date: '2026-10-21', start: '09:10', end: '09:55' }, [
            { classId: await schoolClass(), roomId: hall },
          ]),
        ),
      ).toMatchObject({ constraint: 'room_shared_full' });
      // After both have ended, the room is free again.
      await place(north, { date: '2026-10-21', start: '09:45', end: '10:30' }, [
        { classId: await schoolClass(), roomId: hall },
      ]);
    });

    it('refuses a room change into a full shared room', async () => {
      const hall = await kit.room(north, { most: 2 });
      const at11 = { date: '2026-10-21', start: '11:00', end: '11:45' };
      await place(north, at11, [{ classId: await schoolClass(), roomId: hall }]);
      await place(north, at11, [{ classId: await schoolClass(), roomId: hall }]);
      const other = await place(north, at11, [
        { classId: await schoolClass(), roomId: await kit.room(north) },
      ]);
      expect(
        await refusal(updateLesson(north, other.lessons[0] ?? '', { room_id: hall })),
      ).toMatchObject({ constraint: 'room_shared_full' });
    });

    it('refuses a shared room whose lessons hold more students together than its capacity', async () => {
      // edge/timetable, Structure: "Capacity is checked against the students
      // of all of them together" (decision 2).
      const hall = await kit.room(north, { most: 3, capacity: 3 });
      const oxford = await schoolClass();
      const princeton = await schoolClass();
      await kit.pupils(north, oxford, 2);
      await kit.pupils(north, princeton, 2);
      const at12 = { date: '2026-10-21', start: '12:00', end: '12:45' };
      await place(north, at12, [{ classId: oxford, roomId: hall }]);
      expect(
        await refusal(place(north, at12, [{ classId: princeton, roomId: hall }])),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'room_shared_capacity' });
      // Three students fit.
      const cambridge = await schoolClass();
      await kit.pupils(north, cambridge, 1);
      await place(north, at12, [{ classId: cambridge, roomId: hall }]);
    });

    it('checks two lessons added at the same moment one after the other', async () => {
      const hall = await kit.room(north, { most: 2 });
      const at13 = { date: '2026-10-21', start: '13:00', end: '13:45' };
      await place(north, at13, [{ classId: await schoolClass(), roomId: hall }]);
      const oxford = await schoolClass();
      const princeton = await schoolClass();
      const held = holding(
        (work) => inBranch(north, work),
        async (transaction) => {
          await write(transaction, north, at13, [{ classId: oxford, roomId: hall }]);
          await sql`set constraints time_claims_shared_room immediate`.execute(transaction);
        },
      );
      await held.ready;
      const second = place(north, at13, [{ classId: princeton, roomId: hall }]).then(
        () => 'written',
        (error: unknown) => (error as { constraint?: string }).constraint,
      );
      await untilWaiting(1);
      held.release();
      await held.done;
      expect(await second).toBe('room_shared_full');
    });
  });

  describe('a class in one block (time_claims_class_excl)', () => {
    it('refuses a class lesson and a group lesson of that class in two blocks at once', async () => {
      const oxford = await schoolClass();
      const english = await kit.load.classes.subject({ grades: [7] });
      const half = await group([oxford], english);
      await place(north, { date: '2026-10-22', start: '09:00', end: '09:45' }, [
        { classId: oxford },
      ]);
      expect(
        await refusal(
          place(north, { date: '2026-10-22', start: '09:30', end: '10:15' }, [
            { groupId: half, subjectId: english },
          ]),
        ),
      ).toMatchObject({ code: EXCLUSION_VIOLATION, constraint: 'time_claims_class_excl' });
    });

    it('passes the two halves of a split in one block', async () => {
      const oxford = await schoolClass();
      const english = await kit.load.classes.subject({ grades: [7] });
      const first = await group([oxford], english);
      const second = await group([oxford], english);
      const split = await place(north, { date: '2026-10-22', start: '10:00', end: '10:45' }, [
        { groupId: first, subjectId: english, teacherId: await teacher() },
        { groupId: second, subjectId: english, teacherId: await teacher() },
      ]);
      expect((await claimsOf(split.block)).filter((c) => c.kind === 'block_class')).toEqual([
        expect.objectContaining({ class_id: oxford }),
      ]);
    });

    it('refuses two groups that share a class in two blocks at once', async () => {
      const oxford = await schoolClass();
      const princeton = await schoolClass();
      const english = await kit.load.classes.subject({ grades: [7] });
      const physics = await kit.load.classes.subject({ grades: [7] });
      await place(north, { date: '2026-10-22', start: '11:00', end: '11:45' }, [
        { groupId: await group([oxford, princeton], english), subjectId: english },
      ]);
      expect(
        await refusal(
          place(north, { date: '2026-10-22', start: '11:00', end: '11:45' }, [
            { groupId: await group([princeton], physics), subjectId: physics },
          ]),
        ),
      ).toMatchObject({ constraint: 'time_claims_class_excl' });
    });

    it('lets a group of two grades occupy both classes', async () => {
      const edinburgh = await schoolClass(north, 9);
      const brown = await schoolClass(north, 10);
      const sport = await kit.load.classes.subject({ grades: [9, 10] });
      await place(north, { date: '2026-10-22', start: '12:00', end: '12:45' }, [
        { groupId: await group([edinburgh, brown], sport), subjectId: sport },
      ]);
      expect(
        await refusal(
          place(north, { date: '2026-10-22', start: '12:00', end: '12:45' }, [{ classId: brown }]),
        ),
      ).toMatchObject({ constraint: 'time_claims_class_excl' });
    });
  });

  describe('a student in one lesson of a block (lesson_block_student_twice)', () => {
    /** A class of two pupils, and a mixed block's two groups of two subjects that draw from it. */
    async function mixed() {
      const oxford = await schoolClass();
      const [first = '', second = ''] = await kit.pupils(north, oxford, 2);
      const sport = await kit.load.classes.subject({ grades: [7] });
      const technology = await kit.load.classes.subject({ grades: [7] });
      const boys = await group([oxford], sport);
      const girls = await group([oxford], technology);
      return { oxford, first, second, sport, technology, boys, girls };
    }

    it('refuses a mixed block with a student in both groups, and passes it without', async () => {
      const m = await mixed();
      await kit.inGroup(north, m.boys, m.sport, m.first);
      await kit.inGroup(north, m.girls, m.technology, m.second);
      await place(north, { date: '2026-10-23', start: '09:00', end: '09:45' }, [
        { groupId: m.boys, subjectId: m.sport },
        { groupId: m.girls, subjectId: m.technology },
      ]);
      // From the next school day: a membership that put the student twice
      // into the block above is refused by itself since 5.1b (0060).
      await kit.inGroup(north, m.girls, m.technology, m.first, '2026-10-24');
      expect(
        await refusal(
          place(north, { date: '2026-10-26', start: '10:00', end: '10:45' }, [
            { groupId: m.boys, subjectId: m.sport },
            { groupId: m.girls, subjectId: m.technology },
          ]),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'lesson_block_student_twice' });
    });

    it('leaves a cancelled part out, and refuses its restore', async () => {
      const m = await mixed();
      await kit.inGroup(north, m.boys, m.sport, m.first);
      await kit.inGroup(north, m.girls, m.technology, m.first);
      const block = await place(north, { date: '2026-10-23', start: '11:00', end: '11:45' }, [
        { groupId: m.boys, subjectId: m.sport },
        { groupId: m.girls, subjectId: m.technology, cancel: true },
      ]);
      expect(await refusal(restore(north, block.lessons[1] ?? ''))).toMatchObject({
        constraint: 'lesson_block_student_twice',
      });
    });

    it('refuses a block moved to a date on which a student is in two of its groups', async () => {
      const m = await mixed();
      await kit.inGroup(north, m.boys, m.sport, m.first);
      await kit.inGroup(north, m.girls, m.technology, m.first, '2026-10-26');
      const block = await place(north, { date: '2026-10-23', start: '12:00', end: '12:45' }, [
        { groupId: m.boys, subjectId: m.sport },
        { groupId: m.girls, subjectId: m.technology },
      ]);
      expect(
        await refusal(moveBlock(north, block.block, '2026-10-26', '12:00', '12:45')),
      ).toMatchObject({ constraint: 'lesson_block_student_twice' });
      await moveBlock(north, block.block, '2026-10-22', '15:00', '15:45');
    });

    it('checks two parts of one block restored at the same moment one after the other', async () => {
      // The two sides meet on no row and no index: the class claim of the
      // block is already written by its third part, so only the advisory lock
      // of the block orders them (spec review of the build, must-fix 1).
      const m = await mixed();
      await kit.inGroup(north, m.boys, m.sport, m.first);
      await kit.inGroup(north, m.girls, m.technology, m.first);
      const music = await kit.load.classes.subject({ grades: [7] });
      const choir = await group([m.oxford], music);
      const block = await place(north, { date: '2026-10-23', start: '13:00', end: '13:45' }, [
        { groupId: m.boys, subjectId: m.sport, cancel: true },
        { groupId: m.girls, subjectId: m.technology, cancel: true },
        { groupId: choir, subjectId: music },
      ]);
      const restoreIn = (transaction: Transaction, id: string) =>
        transaction
          .updateTable('lessons')
          .set({ cancel_cause: null, cancel_reason: null })
          .where('id', '=', id)
          .execute();
      const held = holding(
        (work) => inBranch(north, work),
        async (transaction) => {
          await restoreIn(transaction, block.lessons[0] ?? '');
          await sql`set constraints lessons_block_students immediate`.execute(transaction);
        },
      );
      await held.ready;
      const second = inBranch(north, (transaction) =>
        restoreIn(transaction, block.lessons[1] ?? ''),
      ).then(
        () => 'written',
        (error: unknown) => (error as { constraint?: string }).constraint,
      );
      await untilWaiting(1);
      held.release();
      await held.done;
      expect(await second).toBe('lesson_block_student_twice');
    });
  });

  describe('the times of a block', () => {
    it('moves its lessons and their claims with it, and refuses a move into a teacher’s other lesson', async () => {
      const smith = await teacher();
      const oxford = await schoolClass();
      const block = await place(north, { date: '2026-10-26', start: '09:00', end: '09:45' }, [
        { classId: oxford, teacherId: smith },
      ]);
      await moveBlock(north, block.block, '2026-10-27', '10:00', '10:45');
      const lesson = await database.migrator
        .selectFrom('lessons')
        .select(['lesson_date', 'starts_at', 'ends_at'])
        .where('id', '=', block.lessons[0] ?? '')
        .executeTakeFirstOrThrow();
      expect(lesson.starts_at).toEqual(at('2026-10-27', '10:00'));
      expect(lesson.ends_at).toEqual(at('2026-10-27', '10:45'));
      const claims = await claimsOf(block.block);
      expect(claims).toHaveLength(2);
      for (const claim of claims) {
        expect(claim.during).toContain('2026-10-27 05:00:00+00');
      }
      await place(north, { date: '2026-10-28', start: '09:00', end: '09:45' }, [
        { classId: await schoolClass(), teacherId: smith },
      ]);
      expect(
        await refusal(moveBlock(north, block.block, '2026-10-28', '09:30', '10:15')),
      ).toMatchObject({ constraint: 'time_claims_teacher_excl' });
    });

    it('swaps two blocks in one transaction with the constraints deferred', async () => {
      const smith = await teacher();
      const one = await place(north, { date: '2026-10-29', start: '09:00', end: '09:45' }, [
        { classId: await schoolClass(), teacherId: smith },
      ]);
      const two = await place(north, { date: '2026-10-29', start: '10:00', end: '10:45' }, [
        { classId: await schoolClass(), teacherId: smith },
      ]);
      await inBranch(north, async (transaction) => {
        await sql`set constraints time_claims_teacher_excl deferred`.execute(transaction);
        for (const [id, start, end] of [
          [one.block, '10:00', '10:45'],
          [two.block, '09:00', '09:45'],
        ] as const) {
          await transaction
            .updateTable('lesson_blocks')
            .set({ starts_at: at('2026-10-29', start), ends_at: at('2026-10-29', end) })
            .where('id', '=', id)
            .execute();
        }
      });
    });

    it('refuses a date that is not the local date of the start, or an end on another day', async () => {
      const source = await kit.source(north, years.get(north)?.year ?? '', []);
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .insertInto('lesson_blocks')
              .values({
                branch_id: north,
                academic_year_id: years.get(north)?.year ?? '',
                quarter_id: quarterOf(north, MONDAY),
                lesson_date: '2026-10-20',
                starts_at: at(MONDAY, '09:00'),
                ends_at: at(MONDAY, '09:45'),
                version_id: source.versionId,
                pattern_block_id: source.patternBlockId,
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'lesson_block_date' });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .insertInto('lesson_blocks')
              .values({
                branch_id: north,
                academic_year_id: years.get(north)?.year ?? '',
                quarter_id: quarterOf(north, MONDAY),
                lesson_date: MONDAY,
                starts_at: at(MONDAY, '23:30'),
                ends_at: at('2026-10-20', '00:15'),
                version_id: source.versionId,
                pattern_block_id: source.patternBlockId,
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'lesson_block_date' });
    });

    it('refuses an end before the start', async () => {
      expect(
        await refusal(place(north, { date: '2026-10-29', start: '11:00', end: '11:00' }, [])),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'lesson_blocks_order_check' });
    });

    it('refuses a date in no quarter of the year: a vacation, after the year', async () => {
      expect(
        await refusal(
          place(
            north,
            {
              date: '2026-11-03',
              start: '09:00',
              end: '09:45',
              quarterId: quarterOf(north, MONDAY),
            },
            [],
          ),
        ),
      ).toMatchObject({ constraint: 'lesson_block_quarter' });
      expect(
        await refusal(
          place(
            north,
            {
              date: '2026-11-03',
              start: '09:00',
              end: '09:45',
              quarterId: quarterOf(north, '2026-11-10'),
            },
            [],
          ),
        ),
      ).toMatchObject({ constraint: 'lesson_block_quarter' });
      expect(
        await refusal(
          place(
            north,
            {
              date: '2027-06-07',
              start: '09:00',
              end: '09:45',
              quarterId: quarterOf(north, '2027-05-31'),
            },
            [],
          ),
        ),
      ).toMatchObject({ constraint: 'lesson_block_quarter' });
    });

    it('refuses a quarter of another branch', async () => {
      expect(
        await refusal(
          place(north, { start: '09:00', end: '09:45', quarterId: quarterOf(south, MONDAY) }, []),
        ),
      ).toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    });
  });

  describe('the quarter of a block (lesson_block_quarter_fixed)', () => {
    /** Quarter 1 ends on 25 October and quarter 2 starts on 26 October, in the migrator's transaction. */
    const moveBoundary = (transaction: Transaction) =>
      sql`
        update quarters set end_date = '2026-10-25' where id = ${quarterOf(north, MONDAY)}::uuid;
      `
        .execute(transaction)
        .then(() =>
          sql`update quarters set start_date = '2026-10-26' where id = ${quarterOf(north, '2026-11-10')}::uuid`.execute(
            transaction,
          ),
        );

    const setQuarter = (
      transaction: Transaction,
      block: string,
      quarter: string,
      moment?: string,
    ) =>
      (moment === undefined
        ? Promise.resolve()
        : sql`select set_config('app.now', ${moment}, true)`
            .execute(transaction)
            .then(() => undefined)
      ).then(() =>
        transaction
          .updateTable('lesson_blocks')
          .set({ quarter_id: quarter })
          .where('id', '=', block)
          .execute(),
      );

    it('moves a future block into the quarter that now holds its date, and only then', async () => {
      const future = await place(north, { date: '2026-10-30', start: '09:00', end: '09:45' }, []);
      const q2 = quarterOf(north, '2026-11-10');
      const held = await place(north, { date: '2026-10-14', start: '09:00', end: '09:45' }, []);
      await expect(
        database.migrator.transaction().execute(async (transaction) => {
          await moveBoundary(transaction);
          await setQuarter(transaction, future.block, q2, NOW);
          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');
      // Without a moment of the transaction, no quarter changes (correction 4).
      expect(
        await refusal(
          database.migrator.transaction().execute(async (transaction) => {
            await moveBoundary(transaction);
            await setQuarter(transaction, future.block, q2);
          }),
        ),
      ).toMatchObject({ constraint: 'lesson_block_quarter_fixed' });
      // A held lesson never changes quarter.
      expect(
        await refusal(
          database.migrator.transaction().execute(async (transaction) => {
            await sql`update quarters set start_date = '2026-10-10' where id = ${q2}::uuid`.execute(
              transaction,
            );
            await sql`update quarters set end_date = '2026-10-09' where id = ${quarterOf(north, MONDAY)}::uuid`.execute(
              transaction,
            );
            await setQuarter(transaction, held.block, q2, NOW);
          }),
        ),
      ).toMatchObject({ constraint: 'lesson_block_quarter_fixed' });
    });

    it('keeps the quarter of a block dated today whose start is still to come (spec review, should-fix 3)', async () => {
      const today = await place(north, { date: '2026-10-15', start: '15:00', end: '15:45' }, []);
      const q2 = quarterOf(north, '2026-11-10');
      expect(
        await refusal(
          database.migrator.transaction().execute(async (transaction) => {
            await sql`update quarters set end_date = '2026-10-14' where id = ${quarterOf(north, MONDAY)}::uuid`.execute(
              transaction,
            );
            await sql`update quarters set start_date = '2026-10-15' where id = ${q2}::uuid`.execute(
              transaction,
            );
            await setQuarter(transaction, today.block, q2, NOW);
          }),
        ),
      ).toMatchObject({ constraint: 'lesson_block_quarter_fixed' });
    });

    it('refuses a quarter changed together with the date', async () => {
      const block = await place(north, { date: '2026-10-30', start: '10:00', end: '10:45' }, []);
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('lesson_blocks')
              .set({
                quarter_id: quarterOf(north, '2026-11-10'),
                lesson_date: '2026-11-10',
                starts_at: at('2026-11-10', '10:00'),
                ends_at: at('2026-11-10', '10:45'),
              })
              .where('id', '=', block.block)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'lesson_block_quarter_fixed' });
    });
  });

  describe('the source of a lesson', () => {
    it('refuses a regular block of a draft version', async () => {
      const version = await kit.load.version(north, years.get(north)?.year ?? '');
      const block = await sql<{ id: string }>`
        insert into pattern_blocks (branch_id, version_id, weekday, slot_position, start_minutes, end_minutes)
        values (${north}::uuid, ${version}::uuid, 1, 1, 540, 585) returning id
      `.execute(database.migrator);
      expect(
        await refusal(
          place(
            north,
            {
              start: '15:00',
              end: '15:45',
              versionId: version,
              patternBlockId: block.rows[0]?.id ?? '',
            },
            [],
          ),
        ),
      ).toMatchObject({ constraint: 'lesson_block_version' });
    });

    // Migration 0066 (task 3.6c-1, decision 4): no extra lessons; every block comes from a
    // version's pattern (06, Changes after publishing, "No extra lessons").
    it('refuses a block without a version or without a pattern block', async () => {
      const source = await kit.source(north, years.get(north)?.year ?? '', []);
      const block = (versionId: string | null, patternBlockId: string | null) =>
        inBranch(north, (transaction) =>
          sql`
            insert into lesson_blocks (branch_id, academic_year_id, quarter_id, lesson_date,
              starts_at, ends_at, version_id, pattern_block_id)
            values (${north}::uuid, ${years.get(north)?.year ?? ''}::uuid,
              ${quarterOf(north, MONDAY)}::uuid, ${MONDAY}::date, ${at(MONDAY, '15:00')},
              ${at(MONDAY, '15:45')}, ${versionId}::uuid, ${patternBlockId}::uuid)
          `.execute(transaction),
        );
      expect(await refusal(block(null, null))).toMatchObject({
        code: NOT_NULL_VIOLATION,
        column: 'version_id',
      });
      expect(await refusal(block(source.versionId, null))).toMatchObject({
        code: NOT_NULL_VIOLATION,
        column: 'pattern_block_id',
      });
      await block(source.versionId, source.patternBlockId);
    });

    it('refuses a lesson of a class of another year, and a group lesson of another subject', async () => {
      // The lesson stands on a valid row and entry of a class of this year: the unit checks of
      // `lessons_check` come before those of the row and the entry, and before the keys.
      const source = await kit.source(north, years.get(north)?.year ?? '', [
        { classId: await schoolClass(), groupId: null, subjectId: subject },
      ]);
      const on = {
        date: '2026-10-30',
        start: '11:00',
        end: '11:45',
        versionId: source.versionId,
        patternBlockId: source.patternBlockId,
      };
      const from = source.lessons[0] ?? { loadRowId: '', patternEntryId: '' };
      const nextYear = await kit.load.classes.year(north, 'planned', '2027-09-01', '2028-05-31');
      const old = await kit.load.classes.schoolClass(north, nextYear, { grade: 7 });
      expect(await refusal(place(north, on, [{ classId: old, ...from }]))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'lesson_unit_year',
      });
      const english = await kit.load.classes.subject({ grades: [7] });
      const half = await group([await schoolClass()], english);
      expect(
        await refusal(place(north, on, [{ groupId: half, subjectId: subject, ...from }])),
      ).toMatchObject({ constraint: 'lesson_group_subject' });
    });

    it('refuses a cancel without a typed reason for the cause "reason"', async () => {
      const block = await place(north, { date: '2026-10-30', start: '13:00', end: '13:45' }, [
        { classId: await schoolClass() },
      ]);
      expect(
        await refusal(updateLesson(north, block.lessons[0] ?? '', { cancel_cause: 'reason' })),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'lessons_reason_check' });
    });

    it('refuses a lesson on a block of another branch', async () => {
      const oxford = await schoolClass();
      // A valid row and entry of the branch, so that only the block's key refuses.
      const source = await kit.source(north, years.get(north)?.year ?? '', [
        { classId: oxford, groupId: null, subjectId: subject },
      ]);
      const from = source.lessons[0] ?? { loadRowId: '', patternEntryId: '' };
      const southern = await place(south, { start: '15:00', end: '15:45' }, []);
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .insertInto('lessons')
              .values({
                branch_id: north,
                block_id: southern.block,
                lesson_date: MONDAY,
                starts_at: at(MONDAY, '15:00'),
                ends_at: at(MONDAY, '15:45'),
                class_id: oxford,
                group_id: null,
                subject_id: subject,
                load_row_id: from.loadRowId,
                pattern_entry_id: from.patternEntryId,
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ code: FOREIGN_KEY_VIOLATION, constraint: 'lessons_block_fkey' });
    });
  });

  describe('a regular lesson and its version, load row and pattern entry (correction 2)', () => {
    let published: string;
    let other: string;
    let oxford: string;
    let princeton: string;
    let oxfordRow: string;
    let princetonRow: string;
    let otherRow: string;
    let firstBlock: string;
    let secondBlock: string;
    let otherBlock: string;
    let oxfordEntry: string;
    let princetonEntry: string;

    /** A pattern block of the version with one entry, written by the migrator. */
    async function patternOf(versionId: string, rowId: string, teacherId: string, start: number) {
      const block = await sql<{ id: string }>`
        insert into pattern_blocks (branch_id, version_id, weekday, slot_position, start_minutes, end_minutes)
        values (${north}::uuid, ${versionId}::uuid, 1, 1, ${start}, ${start + 45}) returning id
      `.execute(database.migrator);
      const blockId = block.rows[0]?.id ?? '';
      const entry = await sql<{ id: string }>`
        insert into pattern_entries (branch_id, version_id, block_id, weekday, start_minutes, end_minutes, load_row_id, teacher_id)
        values (${north}::uuid, ${versionId}::uuid, ${blockId}::uuid, 1, ${start}, ${start + 45}, ${rowId}::uuid, ${teacherId}::uuid)
        returning id
      `.execute(database.migrator);
      return { block: blockId, entry: entry.rows[0]?.id ?? '' };
    }

    beforeAll(async () => {
      const year = years.get(north)?.year ?? '';
      published = await kit.load.version(north, year);
      other = await kit.load.version(north, year);
      oxford = await schoolClass();
      princeton = await schoolClass();
      const smith = (await kit.load.teacher(north, { subjects: [{ subject, grades: [7] }] }))
        .staffId;
      const jones = (await kit.load.teacher(north, { subjects: [{ subject, grades: [7] }] }))
        .staffId;
      const values = (versionId: string, classId: string, teacherId: string) => ({
        branch_id: north,
        version_id: versionId,
        class_id: classId,
        subject_id: subject,
        teacher_id: teacherId,
      });
      oxfordRow = await kit.load.row(values(published, oxford, smith));
      princetonRow = await kit.load.row(values(published, princeton, jones));
      otherRow = await kit.load.row(values(other, oxford, smith));
      const first = await patternOf(published, oxfordRow, smith, 540);
      const second = await patternOf(published, princetonRow, jones, 600);
      const third = await patternOf(other, otherRow, smith, 540);
      firstBlock = first.block;
      secondBlock = second.block;
      otherBlock = third.block;
      oxfordEntry = first.entry;
      princetonEntry = second.entry;
      await kit.load.setVersion(published, 'published');
      await kit.load.setVersion(other, 'published');
    });

    const regular = (
      patternBlockId: string,
      lessons: readonly LessonInput[],
      versionId = published,
    ) =>
      place(
        north,
        { date: '2026-11-16', start: '09:00', end: '09:45', versionId, patternBlockId },
        lessons,
      );

    it('writes a lesson of a published version with its own load row and pattern entry', async () => {
      const written = await regular(firstBlock, [
        { classId: oxford, loadRowId: oxfordRow, patternEntryId: oxfordEntry },
      ]);
      expect((await claimsOf(written.block)).map((claim) => claim.kind)).toEqual([
        'block_class',
        'lesson',
      ]);
    });

    // Migration 0066: every lesson names its load row and pattern entry.
    it('refuses a lesson with no load row, and one with no pattern entry', async () => {
      const lesson = (loadRowId: string | null, patternEntryId: string | null) =>
        inBranch(north, async (transaction) => {
          const block = await write(
            transaction,
            north,
            {
              date: '2026-11-16',
              start: '09:00',
              end: '09:45',
              versionId: published,
              patternBlockId: firstBlock,
            },
            [],
          );
          await sql`
            insert into lessons (branch_id, block_id, lesson_date, starts_at, ends_at, class_id,
              subject_id, load_row_id, pattern_entry_id)
            values (${north}::uuid, ${block.block}::uuid, '2026-11-16'::date,
              ${at('2026-11-16', '09:00')}, ${at('2026-11-16', '09:45')}, ${oxford}::uuid,
              ${subject}::uuid, ${loadRowId}::uuid, ${patternEntryId}::uuid)
          `.execute(transaction);
        });
      expect(await refusal(lesson(null, null))).toMatchObject({
        code: NOT_NULL_VIOLATION,
        column: 'load_row_id',
      });
      expect(await refusal(lesson(oxfordRow, null))).toMatchObject({
        code: NOT_NULL_VIOLATION,
        column: 'pattern_entry_id',
      });
    });

    it('refuses the load row of another class, and of another version', async () => {
      expect(
        await refusal(
          regular(firstBlock, [
            { classId: oxford, loadRowId: princetonRow, patternEntryId: oxfordEntry },
          ]),
        ),
      ).toMatchObject({ constraint: 'lesson_load_row' });
      expect(
        await refusal(
          regular(firstBlock, [
            { classId: oxford, loadRowId: otherRow, patternEntryId: oxfordEntry },
          ]),
        ),
      ).toMatchObject({ constraint: 'lesson_load_row' });
    });

    it('refuses the pattern entry of another pattern block (lesson_pattern_entry)', async () => {
      expect(
        await refusal(
          regular(firstBlock, [
            { classId: princeton, loadRowId: princetonRow, patternEntryId: princetonEntry },
          ]),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'lesson_pattern_entry' });
      await regular(secondBlock, [
        { classId: princeton, loadRowId: princetonRow, patternEntryId: princetonEntry },
      ]);
    });

    it('refuses a block on a pattern block of another version', async () => {
      expect(await refusal(regular(otherBlock, []))).toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
        constraint: 'lesson_blocks_pattern_fkey',
      });
    });

    it('refuses a version of another year (lesson_block_version)', async () => {
      const nextYear = await kit.load.classes.year(north, 'planned', '2028-09-01', '2029-05-31');
      const later = await kit.load.version(north, nextYear, { startsOn: '2028-09-04' });
      const block = await sql<{ id: string }>`
        insert into pattern_blocks (branch_id, version_id, weekday, slot_position, start_minutes, end_minutes)
        values (${north}::uuid, ${later}::uuid, 1, 1, 540, 585) returning id
      `.execute(database.migrator);
      await kit.load.setVersion(later, 'published');
      expect(await refusal(regular(block.rows[0]?.id ?? '', [], later))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'lesson_block_version',
      });
    });
  });

  describe('double lessons (lesson_double_pair)', () => {
    it('refuses a third block in a pair, and a pair on two dates', async () => {
      const pair = '00000000-0000-7000-8000-000000000001';
      await place(north, { date: '2026-11-10', start: '09:00', end: '09:45', pairId: pair }, []);
      await place(north, { date: '2026-11-10', start: '09:50', end: '10:35', pairId: pair }, []);
      expect(
        await refusal(
          place(north, { date: '2026-11-10', start: '10:40', end: '11:25', pairId: pair }, []),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'lesson_double_pair' });
      const other = '00000000-0000-7000-8000-000000000002';
      await place(north, { date: '2026-11-10', start: '11:30', end: '12:15', pairId: other }, []);
      expect(
        await refusal(
          place(north, { date: '2026-11-11', start: '09:00', end: '09:45', pairId: other }, []),
        ),
      ).toMatchObject({ constraint: 'lesson_double_pair' });
    });
  });

  describe('the claims are the database’s', () => {
    it('refuses an insert, an update and a delete of a claim by the application', async () => {
      const block = await place(north, { date: '2026-11-12', start: '09:00', end: '09:45' }, [
        { classId: await schoolClass(), teacherId: await teacher() },
      ]);
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .insertInto('time_claims')
              .values({
                branch_id: north,
                kind: 'block_class',
                block_id: block.block,
                holder: block.block,
                during: '[2026-11-12 04:00:00+00,2026-11-12 04:45:00+00)',
                class_id: null,
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'time_claims_direct' });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('time_claims')
              .set({ teacher_id: null })
              .where('block_id', '=', block.block)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'time_claims_direct' });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction.deleteFrom('time_claims').where('block_id', '=', block.block).execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'time_claims_direct' });
      expect(await claimsOf(block.block)).toHaveLength(2);
    });

    // Task 5.5b-1 (decision 2, Look first): a lesson or block dated after today
    // may be deleted by a publish; one dated today or earlier is refused by
    // date (dated-lessons.database.test.ts), no longer by a missing grant.
    it('refuses a change of class, group or subject', async () => {
      const block = await place(north, { date: '2026-11-12', start: '10:00', end: '10:45' }, [
        { classId: await schoolClass() },
      ]);
      const oxford = await schoolClass();
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('lessons')
              .set({ class_id: oxford })
              .where('id', '=', block.lessons[0] ?? '')
              .execute(),
          ),
        ),
      ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('refuses a temporary table to the application and never grants TRUNCATE on the claims', async () => {
      expect(
        await refusal(sql`create temporary table claims_of_my_own (id int)`.execute(database.app)),
      ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      const rights = await sql<{ temp: boolean; claims: boolean; classes: boolean }>`
        select
          has_database_privilege('sodiq_app', current_database(), 'TEMP') as temp,
          has_table_privilege('sodiq_app', 'time_claims', 'TRUNCATE') as claims,
          has_table_privilege('sodiq_app', 'pattern_block_classes', 'TRUNCATE') as classes
      `.execute(database.migrator);
      expect(rights.rows[0]).toEqual({ temp: false, claims: false, classes: false });
    });
  });
});
