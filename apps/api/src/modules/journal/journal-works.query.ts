import { lessonStateOf } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { datedQuarters } from '../plans/plan-read.js';
import { awayLessons } from '../timetable/away-read.js';
import { journalLessons, type GridLessonRow, type JournalRow } from './journal-grid.query.js';
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

/** The year of a journal with its dates. */
async function yearOf(
  transaction: Transaction,
  yearId: string,
): Promise<{ startDate: string; endDate: string }> {
  const year = await transaction
    .selectFrom('academic_years')
    .select([
      sql<string>`start_date::text`.as('start_date'),
      sql<string>`end_date::text`.as('end_date'),
    ])
    .where('id', '=', yearId)
    .executeTakeFirstOrThrow();
  return { startDate: year.start_date, endDate: year.end_date };
}

/** The stored works of lessons, with whether a cell of each holds a number. */
export async function storedWorks(
  transaction: Transaction,
  lessonIds: readonly string[],
): Promise<StoredWork[]> {
  if (lessonIds.length === 0) return [];
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
    .where((eb) =>
      eb.or([
        eb('journal_works.lesson_id', 'in', [...lessonIds]),
        eb('journal_works.source_lesson_id', 'in', [...lessonIds]),
      ]),
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

/**
 * The works of the plan item of each lesson, `null` for a lesson whose row
 * has no item ("No plan"; `edge/journal`: "the plan is missing or that row is
 * still empty"). A cancelled lesson is no row.
 */
export async function plannedWorks(
  transaction: Transaction,
  journal: JournalRow,
  lessons: readonly GridLessonRow[],
): Promise<Map<string, readonly PlannedWork[] | null>> {
  const found = new Map<string, readonly PlannedWork[] | null>();
  const quarters = await datedQuarters(transaction, journal.academicYearId);
  const plans =
    quarters.length === 0
      ? []
      : await transaction
          .selectFrom('lesson_plan_journals')
          .innerJoin('lesson_plan_places', (join) =>
            join
              .onRef('lesson_plan_places.plan_id', '=', 'lesson_plan_journals.plan_id')
              .onRef('lesson_plan_places.journal_id', '=', 'lesson_plan_journals.journal_id'),
          )
          .select([
            'lesson_plan_journals.quarter_id',
            'lesson_plan_places.position',
            'lesson_plan_places.item_id',
          ])
          .where('lesson_plan_journals.journal_id', '=', journal.id)
          .where(
            'lesson_plan_journals.quarter_id',
            'in',
            quarters.map((one) => one.id),
          )
          .execute();
  const itemOf = new Map<string, string>();
  const lessonItem = new Map<string, string>();
  for (const plan of plans) itemOf.set(`${plan.quarter_id}/${String(plan.position)}`, plan.item_id);
  for (const quarter of quarters) {
    const rows = lessons.filter(
      (lesson) =>
        lesson.cancelCause === null &&
        quarter.startDate <= lesson.date &&
        lesson.date <= quarter.endDate,
    );
    rows.forEach((lesson, index) => {
      const item = itemOf.get(`${quarter.id}/${String(index + 1)}`);
      if (item === undefined) found.set(lesson.id, null);
      else lessonItem.set(lesson.id, item);
    });
  }
  const itemIds = [...new Set(lessonItem.values())];
  const works =
    itemIds.length === 0
      ? []
      : await transaction
          .selectFrom('lesson_plan_works')
          .select(['id', 'item_id', 'kind', 'title'])
          .where('item_id', 'in', itemIds)
          .orderBy('kind')
          .orderBy('position')
          .orderBy('id')
          .execute();
  for (const [lessonId, itemId] of lessonItem) {
    found.set(
      lessonId,
      works
        .filter((work) => work.item_id === itemId)
        .map((work) => ({
          id: work.id,
          kind: work.kind === 'homework' ? 'homework' : 'classwork',
          title: work.title,
        })),
    );
  }
  return found;
}

/** Whether the journal has no run day left after its year's runs end early (7.1b decision 9). */
async function journalClosedEarly(
  transaction: Transaction,
  journalId: string,
  yearEnd: string,
): Promise<boolean> {
  const found = await transaction
    .selectFrom('journals')
    .select('id')
    .where('id', '=', journalId)
    .where(sql<boolean>`isempty(runs) or upper(runs) <= ${yearEnd}::date`)
    .executeTakeFirst();
  return found !== undefined;
}

/** The columns of every lesson of the journal in its year, at the moment `now`. */
export async function journalColumns(
  transaction: Transaction,
  journal: JournalRow,
  timeZone: string,
  now: Date,
): Promise<JournalColumns> {
  const year = await yearOf(transaction, journal.academicYearId);
  const lessons = await journalLessons(
    transaction,
    journal,
    timeZone,
    year.startDate,
    year.endDate,
  );
  const [away, planned, stored, closed] = await Promise.all([
    awayLessons(
      transaction,
      lessons.map((one) => ({ id: one.id, teacherId: one.teacherId, startsAt: one.startsAt })),
    ),
    plannedWorks(transaction, journal, lessons),
    storedWorks(
      transaction,
      lessons.map((one) => one.id),
    ),
    journalClosedEarly(transaction, journal.id, year.endDate),
  ]);
  const columnLessons: ColumnLesson[] = lessons.map((lesson) => ({
    id: lesson.id,
    startsAt: lesson.startsAt,
    cancelled: lesson.cancelCause !== null,
    started: lesson.startsAt.getTime() <= now.getTime(),
    held:
      lessonStateOf(
        {
          startsAt: lesson.startsAt,
          cancelled: lesson.cancelCause !== null,
          teacher: lesson.teacherKind,
          away: away.has(lesson.id),
        },
        now,
      ) === 'held',
  }));
  return {
    lessons,
    columns: lessonColumns({ lessons: columnLessons, planned, stored, journalClosed: closed }),
    stored,
  };
}
