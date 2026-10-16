import { sql } from 'kysely';
import { afterAll, beforeAll } from 'vitest';
import { Transactions, type Transaction } from '../database/transactions.js';
import { insertBranch } from './branch-filter-sql.js';
import { FixedClock } from './fixed-clock.js';
import { at, LessonsKit } from './lessons-kit.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

export const CHECK_VIOLATION = '23514';
export const EXCLUSION_VIOLATION = '23P01';
export const FOREIGN_KEY_VIOLATION = '23503';
export const INSUFFICIENT_PRIVILEGE = '42501';

/** Thursday 15 October 2026, 10:00 in Tashkent: the moment of every transaction. */
export const NOW = '2026-10-15T10:00:00+05:00';

/** The error a promise was refused with, or a failure when it was not refused. */
export async function refusal(
  work: Promise<unknown>,
): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

/** The constraint a promise was refused with, or "written". */
export const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => (error as { constraint?: string }).constraint,
  );

/** A transaction held open after `work`, released by the test. */
export function holding(
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
export interface LessonInput {
  classId?: string;
  groupId?: string;
  subjectId?: string;
  teacherId?: string | null;
  roomId?: string | null;
  cancel?: boolean;
}

/** A block as a test writes it: a date and clock times in Tashkent. */
export interface BlockInput {
  date: string;
  start: string;
  end: string;
  pairId?: string | null;
}

/** One room of an exam as a test writes it. */
export interface ExamRoomInput {
  roomId: string;
  classes?: readonly string[];
  groups?: readonly string[];
  invigilators?: readonly string[];
}

/** An exam as a test writes it: a date and clock times in Tashkent. */
export interface ExamInput {
  date: string;
  start: string;
  end: string;
  subjectId?: string | null;
  rooms: readonly ExamRoomInput[];
  /** Classes taken out of blocks for this exam, written before its rooms. */
  outs?: readonly { blockId: string; classId: string }[];
}

/**
 * Two branches with a dated year each, a subject, and the writes of lessons
 * and exams as the application makes them (as `sodiq_app`, through the
 * branch filter, at `NOW`), for the database tests of the time claims (tasks
 * 5.1a and 5.1b). Registers its own `beforeAll` and `afterAll`.
 */
export function claimsHarness() {
  const state = {
    database: undefined as unknown as TestDatabase,
    transactions: undefined as unknown as Transactions,
    kit: undefined as unknown as LessonsKit,
    north: '',
    south: '',
    subject: '',
    years: new Map<string, { year: string; quarters: string[] }>(),
  };

  beforeAll(async () => {
    state.database = await createTestDatabase();
    state.transactions = new Transactions(state.database.app, new FixedClock(NOW));
    state.kit = await LessonsKit.create(state.database.migrator);
    state.north = await insertBranch(state.database.migrator, 'North');
    state.south = await insertBranch(state.database.migrator, 'South');
    state.years.set(state.north, await state.kit.year(state.north));
    state.years.set(state.south, await state.kit.year(state.south));
    state.subject = await state.kit.load.classes.subject({ grades: [5, 6, 7, 8, 9, 10, 11] });
  });

  afterAll(async () => {
    await state.database.destroy();
  });

  const yearOf = (branch: string) => state.years.get(branch)?.year ?? '';

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    state.transactions.run([branch], work);

  /** The quarter of the branch's year that holds the date. */
  const quarterOf = (branch: string, date: string): string => {
    const quarters = state.years.get(branch)?.quarters ?? [];
    const index = date < '2026-11-01' ? 0 : date < '2027-01-01' ? 1 : date < '2027-03-25' ? 2 : 3;
    return quarters[index] ?? '';
  };

  /**
   * A block and its lessons, written in the transaction given, on a version
   * and pattern of their own that the migrator writes first (`LessonsKit.source`).
   */
  async function writeBlock(
    transaction: Transaction,
    branch: string,
    block: BlockInput,
    lessons: readonly LessonInput[],
  ): Promise<{ block: string; lessons: string[] }> {
    const source = await state.kit.source(
      branch,
      yearOf(branch),
      lessons.map((lesson) => ({
        classId: lesson.classId ?? null,
        groupId: lesson.groupId ?? null,
        subjectId: lesson.subjectId ?? state.subject,
      })),
    );
    const written = await transaction
      .insertInto('lesson_blocks')
      .values({
        branch_id: branch,
        academic_year_id: yearOf(branch),
        quarter_id: quarterOf(branch, block.date),
        lesson_date: block.date,
        starts_at: at(block.date, block.start),
        ends_at: at(block.date, block.end),
        version_id: source.versionId,
        pattern_block_id: source.patternBlockId,
        double_pair_id: block.pairId ?? null,
      })
      .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
      .executeTakeFirstOrThrow();
    const ids: string[] = [];
    for (const [index, lesson] of lessons.entries()) {
      const from = source.lessons[index];
      if (from === undefined) throw new Error('No source for the lesson.');
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
          subject_id: lesson.subjectId ?? state.subject,
          load_row_id: from.loadRowId,
          pattern_entry_id: from.patternEntryId,
          teacher_id: lesson.teacherId ?? null,
          room_id: lesson.roomId ?? null,
          cancel_cause: lesson.cancel === true ? 'exam' : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      ids.push(row.id);
    }
    return { block: written.id, lessons: ids };
  }

  /** An exam with its out rows, rooms, classes and invigilators, in the transaction given. */
  async function writeExam(
    transaction: Transaction,
    branch: string,
    exam: ExamInput,
  ): Promise<{ exam: string; rooms: string[] }> {
    const written = await transaction
      .insertInto('exams')
      .values({
        branch_id: branch,
        academic_year_id: yearOf(branch),
        exam_date: exam.date,
        starts_at: at(exam.date, exam.start),
        ends_at: at(exam.date, exam.end),
        first_slot: 3,
        last_slot: 4,
        title: 'Quarter exam in English',
        subject_id: exam.subjectId === undefined ? state.subject : exam.subjectId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const out of exam.outs ?? []) {
      await transaction
        .insertInto('lesson_block_class_outs')
        .values({
          branch_id: branch,
          block_id: out.blockId,
          class_id: out.classId,
          exam_id: written.id,
        })
        .execute();
    }
    const rooms: string[] = [];
    for (const room of exam.rooms) {
      const row = await transaction
        .insertInto('exam_rooms')
        .values({ branch_id: branch, exam_id: written.id, room_id: room.roomId })
        .returning('id')
        .executeTakeFirstOrThrow();
      rooms.push(row.id);
      for (const classId of room.classes ?? []) {
        await transaction
          .insertInto('exam_room_classes')
          .values({
            branch_id: branch,
            exam_id: written.id,
            exam_room_id: row.id,
            class_id: classId,
          })
          .execute();
      }
      for (const groupId of room.groups ?? []) {
        await transaction
          .insertInto('exam_room_classes')
          .values({
            branch_id: branch,
            exam_id: written.id,
            exam_room_id: row.id,
            group_id: groupId,
          })
          .execute();
      }
      for (const staffId of room.invigilators ?? []) {
        await transaction
          .insertInto('exam_invigilators')
          .values({
            branch_id: branch,
            exam_id: written.id,
            exam_room_id: row.id,
            staff_id: staffId,
          })
          .execute();
      }
    }
    return { exam: written.id, rooms };
  }

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(state.database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  return {
    state,
    yearOf,
    inBranch,
    writeBlock,
    writeExam,
    /** A block and its lessons, written as the application writes them. */
    place: (branch: string, block: BlockInput, lessons: readonly LessonInput[]) =>
      inBranch(branch, (transaction) => writeBlock(transaction, branch, block, lessons)),
    /** An exam, written as the application writes it. */
    exam: (branch: string, exam: ExamInput) =>
      inBranch(branch, (transaction) => writeExam(transaction, branch, exam)),
    /** Waits until `count` connections wait for a lock. */
    async untilWaiting(count: number): Promise<void> {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((await waitingForALock()) >= count) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Nothing waited for a lock.');
    },
    /** The claims the database wrote for an exam. */
    examClaims: (examId: string) =>
      state.database.migrator
        .selectFrom('time_claims')
        .select(['kind', 'block_id', 'class_id', 'teacher_id', 'room_id', 'during'])
        .where('exam_id', '=', examId)
        .orderBy('kind')
        .orderBy('class_id')
        .execute(),
    /** The classes a block claims. */
    blockClasses: async (blockId: string): Promise<string[]> =>
      (
        await state.database.migrator
          .selectFrom('time_claims')
          .select('class_id')
          .where('block_id', '=', blockId)
          .where('kind', '=', 'block_class')
          .orderBy('class_id')
          .execute()
      ).map((row) => row.class_id ?? ''),
    schoolClass: (branch: string, grade = 7) =>
      state.kit.load.classes.schoolClass(branch, yearOf(branch), { grade }),
    teacher: async (branch: string) => (await state.kit.load.teacher(branch)).staffId,
    group: (branch: string, classIds: readonly string[], subjectId: string) =>
      state.kit.load.classes.group(branch, yearOf(branch), subjectId, classIds),
  };
}
