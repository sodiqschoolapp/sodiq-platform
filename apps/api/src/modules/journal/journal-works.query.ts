import { lessonStateOf } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { awayLessons } from '../timetable/away-read.js';
import type { GridLessonRow, JournalRow } from './journal-grid.query.js';
import {
  lessonColumns,
  type ColumnLesson,
  type LessonColumns,
  type PlannedWork,
  type StoredWork,
} from './lesson-columns.js';

/**
 * The reads behind the work columns of a journal (task 8.1, pull request
 * #217): every lesson of the journal in its year, the works of the plan item
 * of each lesson (the place of the journal's plan at row p, row p being the
 * p-th lesson of the quarter not cancelled, as `planRows` reads it), and the
 * stored works. One statement each, through the branch filter.
 */

export interface JournalColumns {
  readonly lessons: readonly GridLessonRow[];
  readonly columns: ReadonlyMap<string, LessonColumns>;
  readonly stored: readonly StoredWork[];
}

/** The stored works of lessons, with whether a cell of each holds a number. */
export async function storedWorks(
  transaction: Transaction,
  lessonIds: readonly string[],
): Promise<StoredWork[]> {
  if (lessonIds.length === 0) return [];
  const ids = [...new Set(lessonIds)];
  const rows = await transaction
    .selectFrom('journal_works')
    .select([
      'journal_works.id',
      'journal_works.lesson_id',
      'journal_works.source_lesson_id',
      'journal_works.kind',
      'journal_works.plan_work_id',
      'journal_works.position',
      'journal_works.total',
      'journal_works.not_held',
      'journal_works.carried_from_lesson_id',
      'journal_works.version',
      (eb) =>
        eb
          .exists(
            eb
              .selectFrom('journal_cells')
              .select('journal_cells.id')
              .whereRef('journal_cells.work_id', '=', 'journal_works.id')
              .where('journal_cells.score', 'is not', null),
          )
          .as('has_numbers'),
    ])
    // One array parameter, not one per lesson: a statement holds at most
    // 65,535 parameters, and the closing checklist names every lesson of a
    // branch's quarter (the Speed run at three times the data, 28 October 2026).
    .where(
      sql<boolean>`journal_works.lesson_id = any(${ids}::uuid[]) or journal_works.source_lesson_id = any(${ids}::uuid[])`,
    )
    .orderBy('journal_works.id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    lessonId: row.lesson_id,
    sourceLessonId: row.source_lesson_id,
    kind: row.kind === 'homework' ? 'homework' : 'classwork',
    planWorkId: row.plan_work_id,
    position: row.position,
    total: row.total,
    notHeld: row.not_held,
    carriedFromLessonId: row.carried_from_lesson_id,
    version: row.version,
    hasNumbers: Boolean(row.has_numbers),
  }));
}

/** The item of a lesson's plan row: its topic and works (task 8.7: "lessons with no topic"). */
export interface LessonItem {
  /** Task 8.8: the item, for the lesson card and "topic not delivered". */
  readonly itemId: string;
  readonly topic: string;
  readonly works: readonly PlannedWork[];
}

/**
 * The item of the plan row of each lesson of journals, `null` for a lesson
 * whose row has no item ("No plan"; `edge/journal`: "the plan is missing or
 * that row is still empty"). A cancelled lesson is no row. One statement each
 * for every journal named (task 8.7).
 */
export async function planItemsOf(
  transaction: Transaction,
  journals: readonly JournalRow[],
  lessonsOf: ReadonlyMap<string, readonly GridLessonRow[]>,
): Promise<Map<string, LessonItem | null>> {
  const found = new Map<string, LessonItem | null>();
  const quartersOf = new Map(
    journals.map((journal) => [
      journal.id,
      journal.quarters.flatMap((one) =>
        one.startDate === null || one.endDate === null
          ? []
          : [{ id: one.id, startDate: one.startDate, endDate: one.endDate }],
      ),
    ]),
  );
  const quarterIds = [...new Set([...quartersOf.values()].flat().map((one) => one.id))];
  const plans =
    quarterIds.length === 0 || journals.length === 0
      ? []
      : await transaction
          .selectFrom('lesson_plan_journals')
          .innerJoin('lesson_plan_places', (join) =>
            join
              .onRef('lesson_plan_places.plan_id', '=', 'lesson_plan_journals.plan_id')
              .onRef('lesson_plan_places.journal_id', '=', 'lesson_plan_journals.journal_id'),
          )
          .select([
            'lesson_plan_journals.journal_id',
            'lesson_plan_journals.quarter_id',
            'lesson_plan_places.position',
            'lesson_plan_places.item_id',
          ])
          .where(
            'lesson_plan_journals.journal_id',
            'in',
            journals.map((one) => one.id),
          )
          .where('lesson_plan_journals.quarter_id', 'in', quarterIds)
          .execute();
  const itemOf = new Map<string, string>();
  const lessonItem = new Map<string, string>();
  for (const plan of plans) {
    itemOf.set(`${plan.journal_id}/${plan.quarter_id}/${String(plan.position)}`, plan.item_id);
  }
  for (const journal of journals) {
    const lessons = lessonsOf.get(journal.id) ?? [];
    for (const quarter of quartersOf.get(journal.id) ?? []) {
      const rows = lessons.filter(
        (lesson) =>
          lesson.cancelCause === null &&
          quarter.startDate <= lesson.date &&
          lesson.date <= quarter.endDate,
      );
      rows.forEach((lesson, index) => {
        const item = itemOf.get(`${journal.id}/${quarter.id}/${String(index + 1)}`);
        if (item === undefined) found.set(lesson.id, null);
        else lessonItem.set(lesson.id, item);
      });
    }
  }
  const itemIds = [...new Set(lessonItem.values())];
  const [items, works] =
    itemIds.length === 0
      ? [[], []]
      : await Promise.all([
          transaction
            .selectFrom('lesson_plan_items')
            .select(['id', 'topic'])
            .where('id', 'in', itemIds)
            .execute(),
          transaction
            .selectFrom('lesson_plan_works')
            .select(['id', 'item_id', 'kind', 'title'])
            .where('item_id', 'in', itemIds)
            .orderBy('kind')
            .orderBy('position')
            .orderBy('id')
            .execute(),
        ]);
  const topicOf = new Map(items.map((item) => [item.id, item.topic]));
  const worksOf = new Map<string, PlannedWork[]>();
  for (const work of works) {
    const list = worksOf.get(work.item_id) ?? [];
    list.push({
      id: work.id,
      kind: work.kind === 'homework' ? 'homework' : 'classwork',
      title: work.title,
    });
    worksOf.set(work.item_id, list);
  }
  for (const [lessonId, itemId] of lessonItem) {
    found.set(lessonId, {
      itemId,
      topic: topicOf.get(itemId) ?? '',
      works: worksOf.get(itemId) ?? [],
    });
  }
  return found;
}

/**
 * The number of each lesson of a journal in its quarter (task 8.8; `edge/lesson-plans`, "Lesson
 * numbers after a cancellation": "The number is the position among lessons that are not
 * cancelled. It is worked out for display."), as `planItemsOf` numbers the rows; a cancelled
 * lesson and a lesson outside every dated quarter have none.
 */
export function lessonNumbersOf(
  journal: JournalRow,
  lessons: readonly GridLessonRow[],
): Map<string, number> {
  const found = new Map<string, number>();
  for (const quarter of journal.quarters) {
    if (quarter.startDate === null || quarter.endDate === null) continue;
    const { startDate, endDate } = quarter;
    lessons
      .filter((one) => one.cancelCause === null && startDate <= one.date && one.date <= endDate)
      .forEach((lesson, index) => found.set(lesson.id, index + 1));
  }
  return found;
}

/**
 * Task 8.8: the planned homeworks marked "not given" at lessons, as `<lesson>/<plan work>`, and
 * the lessons whose topic is marked "not delivered" (`edge/lesson-plans`, "A substitute
 * supervises the class").
 */
export async function deliveryMarksOf(
  transaction: Transaction,
  lessonIds: readonly string[],
): Promise<{ notGiven: Set<string>; notDelivered: Set<string> }> {
  if (lessonIds.length === 0) return { notGiven: new Set(), notDelivered: new Set() };
  // One array parameter, not one per lesson (65,535 parameters a statement).
  const ids = [...new Set(lessonIds)];
  const [given, delivered] = await Promise.all([
    transaction
      .selectFrom('journal_homework_not_given')
      .select(['lesson_id', 'plan_work_id'])
      .where(sql<boolean>`lesson_id = any(${ids}::uuid[])`)
      .where('undone_at', 'is', null)
      .execute(),
    transaction
      .selectFrom('journal_lesson_deliveries')
      .select('lesson_id')
      .where(sql<boolean>`lesson_id = any(${ids}::uuid[])`)
      .where('not_delivered', '=', true)
      .execute(),
  ]);
  return {
    notGiven: new Set(given.map((row) => `${row.lesson_id}/${row.plan_work_id}`)),
    notDelivered: new Set(delivered.map((row) => row.lesson_id)),
  };
}

/** The works of the plan item of each lesson of one journal (`planItemsOf`). */
export async function plannedWorks(
  transaction: Transaction,
  journal: JournalRow,
  lessons: readonly GridLessonRow[],
): Promise<Map<string, readonly PlannedWork[] | null>> {
  const items = await planItemsOf(transaction, [journal], new Map([[journal.id, lessons]]));
  return new Map([...items].map(([lessonId, item]) => [lessonId, item?.works ?? null]));
}

/** The journals named whose runs end early in their year: no run day left (7.1b decision 9). */
async function journalsClosedEarly(
  transaction: Transaction,
  journalIds: readonly string[],
): Promise<Set<string>> {
  if (journalIds.length === 0) return new Set();
  const found = await transaction
    .selectFrom('journals')
    .innerJoin('academic_years', 'academic_years.id', 'journals.academic_year_id')
    .select('journals.id')
    .where('journals.id', 'in', [...journalIds])
    .where(sql<boolean>`isempty(journals.runs) or upper(journals.runs) <= academic_years.end_date`)
    .execute();
  return new Set(found.map((row) => row.id));
}

/** The dated lessons of each journal in its year, in date and time order (one statement). */
export async function yearLessonsOf(
  transaction: Transaction,
  journals: readonly JournalRow[],
  timeZone: string,
): Promise<Map<string, GridLessonRow[]>> {
  const found = new Map<string, GridLessonRow[]>(journals.map((one) => [one.id, []]));
  if (journals.length === 0) return found;
  const rows = await transaction
    .selectFrom('journals')
    .innerJoin('academic_years', 'academic_years.id', 'journals.academic_year_id')
    .innerJoin('lessons', (join) =>
      join
        .onRef('lessons.subject_id', '=', 'journals.subject_id')
        .on((eb) =>
          eb.or([
            eb('lessons.class_id', '=', eb.ref('journals.class_id')),
            eb('lessons.group_id', '=', eb.ref('journals.group_id')),
          ]),
        )
        .onRef('lessons.lesson_date', '>=', 'academic_years.start_date')
        .onRef('lessons.lesson_date', '<=', 'academic_years.end_date'),
    )
    .leftJoin('staff', 'staff.id', 'lessons.teacher_id')
    .select([
      'journals.id as journal_id',
      'lessons.id',
      sql<string>`lessons.lesson_date::text`.as('lesson_date'),
      'lessons.starts_at',
      sql<number>`(extract(epoch from (lessons.starts_at at time zone ${timeZone})::time) / 60)::int`.as(
        'start_minutes',
      ),
      sql<number>`(extract(epoch from (lessons.ends_at at time zone ${timeZone})::time) / 60)::int`.as(
        'end_minutes',
      ),
      'lessons.teacher_id',
      'staff.kind as teacher_kind',
      'lessons.cancel_cause',
      'lessons.cancel_reason',
    ])
    .where(
      'journals.id',
      'in',
      journals.map((one) => one.id),
    )
    .orderBy('lessons.starts_at')
    .orderBy('lessons.id')
    .execute();
  for (const row of rows) {
    found.get(row.journal_id)?.push({
      id: row.id,
      date: row.lesson_date,
      startsAt: row.starts_at,
      start: row.start_minutes,
      // A lesson ending at midnight reads 0: the end of the day.
      end: row.end_minutes === 0 ? 24 * 60 : row.end_minutes,
      teacherId: row.teacher_id,
      teacherKind:
        row.teacher_kind === null ? null : row.teacher_kind === 'vacancy' ? 'vacancy' : 'person',
      cancelCause: row.cancel_cause,
      cancelReason: row.cancel_reason,
    });
  }
  return found;
}

/** The columns of every lesson of journals in their years at `now`, with each lesson's plan item. */
export interface JournalsColumns {
  readonly journals: ReadonlyMap<string, JournalColumns>;
  readonly items: ReadonlyMap<string, LessonItem | null>;
  /** Each lesson's `edge/00-definitions` Held lesson at `now`. */
  readonly held: ReadonlySet<string>;
  /** Task 8.8: the homeworks marked "not given" (`<lesson>/<plan work>`). */
  readonly notGiven: ReadonlySet<string>;
  /** Task 8.8: the lessons whose topic is marked "not delivered". */
  readonly notDelivered: ReadonlySet<string>;
}

/**
 * The columns of the lessons of many journals of one branch (task 8.7: the
 * status of a branch's lessons), with the reads of `journalColumns` made once
 * for all of them; `lessonColumns` decides each journal as for one.
 */
export async function journalsColumns(
  transaction: Transaction,
  journals: readonly JournalRow[],
  timeZone: string,
  now: Date,
): Promise<JournalsColumns> {
  const lessonsOf = await yearLessonsOf(transaction, journals, timeZone);
  const all = [...lessonsOf.values()].flat();
  const [away, items, stored, closed, marks] = await Promise.all([
    awayLessons(
      transaction,
      all.map((one) => ({ id: one.id, teacherId: one.teacherId, startsAt: one.startsAt })),
    ),
    planItemsOf(transaction, journals, lessonsOf),
    storedWorks(
      transaction,
      all.map((one) => one.id),
    ),
    journalsClosedEarly(
      transaction,
      journals.map((one) => one.id),
    ),
    deliveryMarksOf(
      transaction,
      all.map((one) => one.id),
    ),
  ]);
  const held = new Set<string>();
  const columnLessonOf = (lesson: GridLessonRow): ColumnLesson => {
    const isHeld =
      lessonStateOf(
        {
          startsAt: lesson.startsAt,
          cancelled: lesson.cancelCause !== null,
          teacher: lesson.teacherKind,
          away: away.has(lesson.id),
        },
        now,
      ) === 'held';
    if (isHeld) held.add(lesson.id);
    return {
      id: lesson.id,
      startsAt: lesson.startsAt,
      cancelled: lesson.cancelCause !== null,
      started: lesson.startsAt.getTime() <= now.getTime(),
      held: isHeld,
    };
  };
  const found = new Map<string, JournalColumns>();
  for (const journal of journals) {
    const lessons = lessonsOf.get(journal.id) ?? [];
    const ids = new Set(lessons.map((one) => one.id));
    const own = stored.filter(
      (work) =>
        ids.has(work.lessonId) || (work.sourceLessonId !== null && ids.has(work.sourceLessonId)),
    );
    const planned = new Map<string, readonly PlannedWork[] | null>();
    for (const lesson of lessons) {
      if (items.has(lesson.id)) planned.set(lesson.id, items.get(lesson.id)?.works ?? null);
    }
    found.set(journal.id, {
      lessons,
      columns: lessonColumns({
        lessons: lessons.map(columnLessonOf),
        planned,
        stored: own,
        journalClosed: closed.has(journal.id),
        notGiven: marks.notGiven,
      }),
      stored: own,
    });
  }
  return { journals: found, items, held, ...marks };
}

/** The columns of every lesson of the journal in its year, at the moment `now`. */
export async function journalColumns(
  transaction: Transaction,
  journal: JournalRow,
  timeZone: string,
  now: Date,
): Promise<JournalColumns> {
  const found = (await journalsColumns(transaction, [journal], timeZone, now)).journals.get(
    journal.id,
  );
  if (found === undefined) throw new Error('Every journal named has its columns.');
  return found;
}
