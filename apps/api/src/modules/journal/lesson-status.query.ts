import {
  lessonStateOf,
  lessonStatusOf,
  type StatusAnswer,
  type StatusFacts,
  type StatusWork,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { awayLessons } from '../timetable/away-read.js';
import { locksOfLessons } from './edit-window.js';
import { expectedStudents } from './expected-students.js';
import { journalRows, switchesOn, type JournalRow } from './journal-grid.query.js';
import { journalsColumns } from './journal-works.query.js';
import type { Column } from './lesson-columns.js';

/**
 * The facts of the status of lessons (task 8.7, pull request #225; `07`,
 * Lesson status, Reminders): the one reader every screen and count of the
 * status calls, set-based for any number of lessons of one branch, with the
 * status decided by `lessonStatusOf` (`packages/shared`). Nothing is stored:
 * the lock is worked out on each request (From 8.4).
 *
 * - Held: `lessonStateOf` with `awayLessons` (decision 5; From 5.6a-4).
 * - Waited for: `lesson_expected_students` (0123, 0124) less the students
 *   with a cell of `journal_optional_cells` not withdrawn (0127, From 8.6) or
 *   of `exemption_reopened_cells` (0123, From 8.5) on the lesson.
 * - Works: the columns of `lessonColumns` (decision 2), none in a quarter
 *   that takes attendance only; a homework is optional for the students not
 *   expected at the lesson where it was given (`edge/journal`, row 15).
 * - Data: a mark or a number, a stored total or "not held", a comment with a
 *   text (`edge/00-definitions`, Data on a lesson).
 */

export interface LessonStatusRow {
  readonly lessonId: string;
  readonly journalId: string | null;
  readonly date: string;
  readonly subjectId: string;
  /** `edge/00-definitions`, Held lesson. */
  readonly held: boolean;
  /** `null` for a lesson not held. */
  readonly answer: StatusAnswer | null;
  /** The quarter of the lesson is graded for its subject. */
  readonly graded: boolean;
  /** Held, graded and its plan row has no item or an empty topic (`07`, Reminders; decision 11). */
  readonly noTopic: boolean;
  /** The works of the lesson added by hand at a lesson with no plan item (`edge/journal`, row 18). */
  readonly unplanned: number;
  readonly locksAt: Date | null;
  /**
   * The empty cells waited for of each stored work with a total (`07`: "A present student
   * left without a number"), by work id: what "not graded" fills.
   */
  readonly waiting: ReadonlyMap<string, readonly string[]>;
}

interface LessonKey {
  readonly id: string;
  readonly subject_id: string;
  readonly class_id: string | null;
  readonly group_id: string | null;
  readonly lesson_date: string;
  readonly starts_at: Date;
  readonly teacher_id: string | null;
  readonly teacher_kind: string | null;
  readonly cancel_cause: string | null;
}

/**
 * A lesson of `lessonStatusFacts`: its row without the status, and the facts
 * the status is decided from (`null` for a lesson not held). Task 9.3b-1: the
 * prepared totals store these, never the status, which depends on the clock
 * of the request (the lock); `statusOfFacts` decides it on read.
 */
export interface LessonStatusFacts {
  readonly row: Omit<LessonStatusRow, 'answer'>;
  readonly facts: StatusFacts | null;
}

/** The status of a lesson from its facts at `now`. */
export const statusOfFacts = (one: LessonStatusFacts, now: Date): LessonStatusRow => ({
  ...one.row,
  answer: one.facts === null ? null : lessonStatusOf(one.facts, now),
});

/** The status facts of the lessons named, of the branch named, at `now`. */
export async function lessonStatuses(
  transaction: Transaction,
  branchId: string,
  lessonIds: readonly string[],
  now: Date,
): Promise<Map<string, LessonStatusRow>> {
  const facts = await lessonStatusFacts(transaction, branchId, lessonIds, now);
  return new Map([...facts].map(([id, one]) => [id, statusOfFacts(one, now)]));
}

/**
 * The facts of the lessons named at `now`: whether each is held, and what its
 * status is decided from. They change with the data and when a lesson of the
 * journal starts (held, `started` of the columns), never at another moment.
 */
export async function lessonStatusFacts(
  transaction: Transaction,
  branchId: string,
  lessonIds: readonly string[],
  now: Date,
): Promise<Map<string, LessonStatusFacts>> {
  const found = new Map<string, LessonStatusFacts>();
  if (lessonIds.length === 0) return found;
  const ids = [...new Set(lessonIds.map((id) => id.toLowerCase()))];
  const lessons: LessonKey[] = await transaction
    .selectFrom('lessons')
    .leftJoin('staff', 'staff.id', 'lessons.teacher_id')
    .select([
      'lessons.id',
      'lessons.subject_id',
      'lessons.class_id',
      'lessons.group_id',
      sql<string>`lessons.lesson_date::text`.as('lesson_date'),
      'lessons.starts_at',
      'lessons.teacher_id',
      'staff.kind as teacher_kind',
      'lessons.cancel_cause',
    ])
    .where('lessons.branch_id', '=', branchId)
    // One array parameter, not one per lesson: the closing checklist names every
    // lesson of a branch's quarter, past the 65,535 parameters of a statement.
    .where(sql<boolean>`lessons.id = any(${ids}::uuid[])`)
    .execute();
  if (lessons.length === 0) return found;
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const keys = await transaction
    .selectFrom('journals')
    .innerJoin('academic_years', 'academic_years.id', 'journals.academic_year_id')
    .select([
      'journals.id',
      'journals.subject_id',
      'journals.class_id',
      'journals.group_id',
      sql<string>`academic_years.start_date::text`.as('start_date'),
      sql<string>`academic_years.end_date::text`.as('end_date'),
    ])
    .where('journals.branch_id', '=', branchId)
    .where('journals.subject_id', 'in', [...new Set(lessons.map((one) => one.subject_id))])
    .execute();
  const unitKey = (one: {
    subject_id: string;
    class_id: string | null;
    group_id: string | null;
  }): string =>
    `${one.subject_id}|${one.class_id ?? ''}|${one.class_id === null ? (one.group_id ?? '') : ''}`;
  const byUnit = new Map<string, (typeof keys)[number][]>();
  for (const key of keys) byUnit.set(unitKey(key), [...(byUnit.get(unitKey(key)) ?? []), key]);
  const journalOf = new Map<string, string>();
  for (const lesson of lessons) {
    const journal = (byUnit.get(unitKey(lesson)) ?? []).find(
      (key) => key.start_date <= lesson.lesson_date && lesson.lesson_date <= key.end_date,
    );
    if (journal !== undefined) journalOf.set(lesson.id, journal.id);
  }
  const journals = await journalRows(transaction, branchId, {
    journalIds: [...new Set(journalOf.values())],
  });
  const journalById = new Map<string, JournalRow>(journals.map((one) => [one.id, one]));
  const columns = await journalsColumns(transaction, journals, branch.time_zone, now);
  // A lesson outside every journal (none is expected): held is read on its own.
  const loose = lessons.filter((one) => !journalOf.has(one.id));
  const looseAway = await awayLessons(
    transaction,
    loose.map((one) => ({ id: one.id, teacherId: one.teacher_id, startsAt: one.starts_at })),
  );
  const heldOf = (lesson: LessonKey): boolean =>
    journalOf.has(lesson.id)
      ? columns.held.has(lesson.id)
      : lessonStateOf(
          {
            startsAt: lesson.starts_at,
            cancelled: lesson.cancel_cause !== null,
            teacher:
              lesson.teacher_kind === null
                ? null
                : lesson.teacher_kind === 'vacancy'
                  ? 'vacancy'
                  : 'person',
            away: looseAway.has(lesson.id),
          },
          now,
        ) === 'held';
  const graded = (lesson: LessonKey): boolean => {
    const journal = journalById.get(journalOf.get(lesson.id) ?? '');
    return (
      journal !== undefined && switchesOn(journal, lesson.lesson_date)?.attendanceOnly === false
    );
  };
  const worksOf = new Map<string, readonly Column[]>();
  const notHeldOf = new Map<string, number>();
  for (const lesson of lessons) {
    const own = columns.journals.get(journalOf.get(lesson.id) ?? '')?.columns.get(lesson.id);
    worksOf.set(lesson.id, graded(lesson) ? (own?.columns ?? []) : []);
    notHeldOf.set(lesson.id, own?.notHeld.length ?? 0);
  }
  const held = lessons.filter(heldOf).map((one) => one.id);
  const heldIds = new Set(held);
  const sources = [
    ...new Set(
      [...worksOf.values()]
        .flat()
        .flatMap((column) =>
          column.kind === 'homework' && column.sourceLessonId !== null
            ? [column.sourceLessonId]
            : [],
        ),
    ),
  ];
  const [expected, locks, optional, cells, comments] = await Promise.all([
    expectedStudents(transaction, [...new Set([...held, ...sources])]),
    locksOfLessons(transaction, held),
    held.length === 0
      ? Promise.resolve([])
      : sql<{ lesson_id: string; student_id: string }>`
          select o.lesson_id, o.student_id from journal_optional_cells o
          where o.lesson_id = any(${held}::uuid[]) and o.withdrawn_at is null
          union
          select r.lesson_id, r.student_id from exemption_reopened_cells r
          where r.lesson_id = any(${held}::uuid[])
        `
          .execute(transaction)
          .then((result) => result.rows),
    held.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('journal_cells')
          .select(['lesson_id', 'student_id', 'work_id', 'mark', 'score', 'not_graded'])
          .where(sql<boolean>`lesson_id = any(${held}::uuid[])`)
          .where((eb) =>
            eb.or([
              eb('mark', 'is not', null),
              eb('score', 'is not', null),
              eb('not_graded', '=', true),
            ]),
          )
          .execute(),
    held.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('journal_comments')
          .select('lesson_id')
          .distinct()
          .where(sql<boolean>`lesson_id = any(${held}::uuid[])`)
          .where('body', 'is not', null)
          .execute(),
  ]);
  const optionalOf = new Map<string, Set<string>>();
  for (const row of optional) {
    const set = optionalOf.get(row.lesson_id) ?? new Set<string>();
    set.add(row.student_id);
    optionalOf.set(row.lesson_id, set);
  }
  const cellsOf = new Map<string, typeof cells>();
  for (const cell of cells) {
    const list = cellsOf.get(cell.lesson_id) ?? [];
    list.push(cell);
    cellsOf.set(cell.lesson_id, list);
  }
  const commented = new Set(
    comments.flatMap((row) => (row.lesson_id === null ? [] : [row.lesson_id])),
  );
  for (const lesson of lessons) {
    const journalId = journalOf.get(lesson.id) ?? null;
    const item = columns.items.get(lesson.id);
    const isHeld = heldIds.has(lesson.id);
    const works = worksOf.get(lesson.id) ?? [];
    const base = {
      lessonId: lesson.id,
      journalId,
      date: lesson.lesson_date,
      subjectId: lesson.subject_id,
      held: isHeld,
      graded: graded(lesson),
      noTopic:
        isHeld &&
        graded(lesson) &&
        (item === undefined || item === null || item.topic.trim() === ''),
      unplanned: works.filter((one) => one.unplanned).length,
      locksAt: locks.get(lesson.id) ?? null,
    };
    if (!isHeld) {
      found.set(lesson.id, { row: { ...base, waiting: new Map() }, facts: null });
      continue;
    }
    const out = optionalOf.get(lesson.id) ?? new Set<string>();
    const waited = (expected.get(lesson.id) ?? []).filter((student) => !out.has(student));
    const own = cellsOf.get(lesson.id) ?? [];
    const marks = new Map<string, number>();
    for (const cell of own) {
      if (cell.work_id === null && cell.mark !== null) marks.set(cell.student_id, cell.mark);
    }
    const statusWorks: StatusWork[] = works.map((column) => {
      const cellsOfWork =
        column.workId === null ? [] : own.filter((cell) => cell.work_id === column.workId);
      const givenAt =
        column.kind === 'homework' && column.sourceLessonId !== null
          ? new Set(expected.get(column.sourceLessonId) ?? [])
          : null;
      return {
        total: column.total,
        optional: givenAt === null ? [] : waited.filter((student) => !givenAt.has(student)),
        numbered: cellsOfWork.flatMap((cell) => (cell.score === null ? [] : [cell.student_id])),
        notGraded: cellsOfWork.flatMap((cell) => (cell.not_graded ? [cell.student_id] : [])),
      };
    });
    const facts: StatusFacts = {
      held: true,
      locksAt: base.locksAt,
      waited,
      marks,
      works: statusWorks,
      data:
        own.some((cell) => cell.mark !== null || cell.score !== null) ||
        works.some((column) => column.total !== null) ||
        (notHeldOf.get(lesson.id) ?? 0) > 0 ||
        commented.has(lesson.id),
    };
    const present = waited.filter((student) => [1, 2].includes(marks.get(student) ?? -1));
    const waiting = new Map<string, string[]>();
    works.forEach((column, index) => {
      const work = statusWorks[index];
      if (column.workId === null || column.total === null || work === undefined) return;
      const done = new Set([...work.numbered, ...work.notGraded, ...work.optional]);
      const empty = present.filter((student) => !done.has(student));
      if (empty.length > 0) waiting.set(column.workId, empty);
    });
    found.set(lesson.id, { row: { ...base, waiting }, facts });
  }
  return found;
}
