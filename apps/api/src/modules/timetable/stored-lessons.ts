import type { ImpactLesson } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { dayBeginnings } from './dated-check.js';
import { isGeneratedCause, storedPairOf } from './dated-lessons.js';

/**
 * The dated lessons stored in a branch from `firstDate` to `lastDate`, as the
 * impact preview compares them (task 5.5b-2, pull request #154; `06`, How
 * surprises are prevented, Impact preview). They are read as the writer reads
 * them, by branch and dates (`writeDatedLessons`), their times by
 * `storedPairOf`, so a lesson the publish keeps reads the same on both sides
 * (decision 1). The weekday is that of the lesson's pattern block, so a worked
 * Saturday shows the weekday it follows, and the classes are those of its
 * unit (`classIdsOf`), as `impactLessonOf` gives them (decision 3); a null
 * teacher is none ("needs a teacher").
 *
 * A lesson the expansion created cancelled is left out, as the preview leaves
 * it out of both sides (5.5a-2b-1, decision 4); one with a one-day cancel is
 * kept as a lesson held, as the writer keeps it (5.5b-1, decision 8), unless
 * `cancelled` is `'none'`: the transition week counts no cancelled lesson
 * (5.5a-2b-1, decision 10; decision 4).
 */
export async function storedImpactLessons(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly firstDate: string;
    readonly lastDate: string;
    readonly classIdsOf: (unitId: string) => readonly string[] | undefined;
    readonly cancelled: 'one_day' | 'none';
  },
): Promise<ImpactLesson[]> {
  const rows = await storedLessonRows(transaction, { ...input, lock: false });
  return rows.map((row) => row.lesson);
}

/** A stored lesson as `storedImpactLessons` gives it, with what a notice and the mark need. */
export interface StoredLesson {
  readonly id: string;
  readonly lesson: ImpactLesson;
  /** The cause of a one-day cancel kept on it (`reason`, `exam`), `null` for none. */
  readonly cancelCause: string | null;
  /** Its "changed" mark (`lesson_changes`, 0084), `null` for none. */
  readonly changedAt: Date | null;
}

/**
 * The rows of `storedImpactLessons`, with each lesson's id, one-day cancel and
 * mark (task 5.5c-3a, spec review should-fix 4: one reader). With `lock`, the
 * lessons are read `for update`, as the writer reads them (`writeDatedLessons`,
 * `removeDatedLessons`): the side read before a publish or withdraw writes
 * stays as read until its commit (spec review should-fix 2).
 */
export async function storedLessonRows(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly firstDate: string;
    readonly lastDate: string;
    readonly classIdsOf: (unitId: string) => readonly string[] | undefined;
    readonly cancelled: 'one_day' | 'none';
    readonly lock: boolean;
  },
): Promise<StoredLesson[]> {
  if (input.firstDate > input.lastDate) return [];
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', input.branchId)
    .executeTakeFirstOrThrow();
  const query = transaction
    .selectFrom('lessons')
    .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
    .innerJoin('pattern_blocks', 'pattern_blocks.id', 'lesson_blocks.pattern_block_id')
    .leftJoin('lesson_changes', 'lesson_changes.lesson_id', 'lessons.id')
    .select([
      'lessons.id',
      'lessons.block_id',
      sql<string>`lessons.lesson_date::text`.as('lesson_date'),
      'lessons.starts_at',
      'lessons.ends_at',
      'lessons.class_id',
      'lessons.group_id',
      'lessons.subject_id',
      'lessons.teacher_id',
      'lessons.room_id',
      'lessons.cancel_cause',
      'pattern_blocks.weekday',
      'lesson_changes.changed_at',
    ])
    .where('lessons.branch_id', '=', input.branchId)
    .where('lessons.lesson_date', '>=', input.firstDate)
    .where('lessons.lesson_date', '<=', input.lastDate)
    .orderBy('lessons.id');
  const [rows, begins] = await Promise.all([
    (input.lock ? query.forUpdate('lessons') : query).execute(),
    dayBeginnings(transaction, branch.time_zone, input.firstDate, input.lastDate),
  ]);
  return rows.flatMap((row) => {
    if (
      input.cancelled === 'none' ? row.cancel_cause !== null : isGeneratedCause(row.cancel_cause)
    ) {
      return [];
    }
    const pair = storedPairOf(row, begins);
    return [
      {
        id: row.id,
        cancelCause: row.cancel_cause,
        changedAt: row.changed_at,
        lesson: {
          date: pair.date,
          weekday: row.weekday,
          start: pair.start,
          end: pair.end,
          unitId: pair.unitId,
          subjectId: pair.subjectId,
          classIds: input.classIdsOf(pair.unitId) ?? (row.class_id === null ? [] : [row.class_id]),
          teacherIds: pair.teacherId === null ? [] : [pair.teacherId],
          roomId: pair.roomId,
        },
      },
    ];
  });
}

/** Whether a version has any dated lesson block stored: none for one published before 0079 (decision 2). */
export async function hasStoredLessons(
  transaction: Transaction,
  versionId: string,
): Promise<boolean> {
  const found = await transaction
    .selectFrom('lesson_blocks')
    .select('id')
    .where('version_id', '=', versionId)
    .limit(1)
    .executeTakeFirst();
  return found !== undefined;
}
