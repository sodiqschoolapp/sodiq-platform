import type { Fraction, StudentQuarterOutcome } from '@sodiq/calc';
import { sql } from 'kysely';
import type { PreparedStamp } from '@sodiq/shared';
import {
  lessonStatusFacts,
  statusOfFacts,
  type LessonStatusFacts,
  type LessonStatusRow,
} from '../../journal/lesson-status.query.js';
import type { BranchMoment } from '../branch-moment.js';
import {
  previousQuarterOf,
  quarterFigures,
  workFiguresOf,
  type JudgedFigures,
  type QuarterRow,
} from '../early-warning.service.js';
import type { QuarterRef } from '../grade-changes.js';
import { outcomesOf, type Outcomes, type QuarterState } from '../rating.service.js';
import { freshLessons, freshUnits, PREPARED_SHAPE, type FreshUnit } from './prepared.query.js';
import { attendanceOfJournal, type AttendanceLesson } from './attendance.js';
import { resultItemsOf, type ResultDraft, type ResultItems } from '../closing-results.js';
import { journalsOfYear, type FiguresValue } from './units.js';

/**
 * The readers of the prepared report totals (task 9.3b-1). Each gives what the reader of today
 * gives, from the fresh prepared units and, for the units found behind, from source by the same
 * code (`edge/system-behaviour`: "A page that finds them behind calculates from source and shows
 * 'updating'"). A `Freshness` collects, for the answer, the oldest preparation used ("updated
 * at", plan decision 6) and whether any unit was behind.
 */
export class Freshness {
  private oldest: Date | null = null;
  private behind = false;

  used(preparedAt: Date): void {
    if (this.oldest === null || preparedAt < this.oldest) this.oldest = preparedAt;
  }

  missed(): void {
    this.behind = true;
  }

  get stamp(): PreparedStamp {
    return { updatedAt: this.oldest?.toISOString() ?? null, updating: this.behind };
  }
}

/** The subjects of the year's journals: every unit of a list over all subjects. */
async function subjectsOf(moment: BranchMoment, quarter: QuarterRef): Promise<string[]> {
  const journals = await journalsOfYear(
    moment.transaction,
    moment.branchId,
    quarter.academicYearId,
  );
  return [...new Set(journals.map((one) => one.subjectId))].sort();
}

/** The fresh units of the subjects named, and the subjects behind. */
async function split(
  moment: BranchMoment,
  freshness: Freshness,
  kind: 'outcomes' | 'figures' | 'closing',
  quarterId: string,
  subjectIds: readonly string[],
): Promise<{ fresh: Map<string, FreshUnit>; behind: string[] }> {
  const fresh = await freshUnits(moment.transaction, {
    branchId: moment.branchId,
    kind,
    quarterId,
    unitIds: subjectIds,
    now: moment.now,
    schoolInputs: PREPARED_SHAPE,
  });
  for (const one of fresh.values()) freshness.used(one.preparedAt);
  const behind = subjectIds.filter((id) => !fresh.has(id));
  if (behind.length > 0) freshness.missed();
  return { fresh, behind };
}

/** `outcomesOf` of the rating from the prepared units. */
export async function preparedOutcomes(
  moment: BranchMoment,
  quarter: QuarterRef,
  state: QuarterState,
  subjectIds: readonly string[] | null,
  freshness: Freshness,
): Promise<Outcomes> {
  const subjects = subjectIds ?? (await subjectsOf(moment, quarter));
  const { fresh, behind } = await split(moment, freshness, 'outcomes', quarter.id, subjects);
  const parts: Outcomes[] = [...fresh.values()].map((one) => one.value as Outcomes);
  if (behind.length > 0) parts.push(await outcomesOf(moment, quarter, state, behind));
  const byJournal = new Map<string, ReadonlyMap<string, StudentQuarterOutcome>>();
  const bySubject = new Map<string, ReadonlyMap<string, StudentQuarterOutcome>>();
  let readLive = false;
  for (const part of parts) {
    for (const [id, one] of part.byJournal) byJournal.set(id, one);
    for (const [id, one] of part.bySubject) bySubject.set(id, one);
    readLive ||= part.readLive;
  }
  return { byJournal, bySubject, readLive };
}

/**
 * The early-warning figures of a quarter (`quarterFigures`) and the previous quarter's figures
 * they are compared with (`workFiguresOf` of that quarter), from the prepared units.
 */
export async function preparedFigures(
  moment: BranchMoment,
  quarter: QuarterRow,
  subjectIds: readonly string[] | null,
  freshness: Freshness,
): Promise<{
  figures: Map<string, JudgedFigures>;
  previous: Map<string, Fraction | null>;
}> {
  const subjects = subjectIds ?? (await subjectsOf(moment, quarter));
  const own = await split(moment, freshness, 'figures', quarter.id, subjects);
  const figures = new Map<string, JudgedFigures>();
  for (const one of own.fresh.values()) {
    for (const [key, value] of (one.value as FiguresValue).figures) figures.set(key, value);
  }
  if (own.behind.length > 0) {
    for (const [key, value] of await quarterFigures(moment, quarter, own.behind)) {
      figures.set(key, value);
    }
  }
  const previous = new Map<string, Fraction | null>();
  const before = figures.size === 0 ? null : await previousQuarterOf(moment, quarter);
  if (before !== null) {
    const earlier = await split(moment, freshness, 'figures', before.id, subjects);
    for (const one of earlier.fresh.values()) {
      for (const [key, value] of (one.value as FiguresValue).work) previous.set(key, value);
    }
    if (earlier.behind.length > 0) {
      for (const [key, value] of await workFiguresOf(moment, before, earlier.behind)) {
        previous.set(key, value);
      }
    }
  }
  return { figures, previous };
}

/** `lessonStatuses` from the prepared facts of each lesson, the status decided at `now`. */
export async function preparedLessonStatuses(
  moment: Pick<BranchMoment, 'transaction' | 'branchId' | 'now'>,
  lessonIds: readonly string[],
  freshness: Freshness,
): Promise<Map<string, LessonStatusRow>> {
  const found = new Map<string, LessonStatusRow>();
  if (lessonIds.length === 0) return found;
  const ids = [...new Set(lessonIds.map((id) => id.toLowerCase()))];
  const fresh = await freshLessons(moment.transaction, {
    branchId: moment.branchId,
    lessonIds: ids,
    now: moment.now,
    schoolInputs: PREPARED_SHAPE,
  });
  for (const [id, one] of fresh) {
    freshness.used(one.preparedAt);
    found.set(id, statusOfFacts(one.value as LessonStatusFacts, moment.now));
  }
  const behind = ids.filter((id) => !fresh.has(id));
  if (behind.length > 0) {
    const read = await lessonStatusFacts(moment.transaction, moment.branchId, behind, moment.now);
    // A lesson of no journal, or dated in no quarter, is never prepared: read from source, and not
    // counted as behind, or the stamp would never clear (code review, should-fix 3).
    const quarters = (
      await sql<{ start: string; end: string }>`
        select start_date::text as start, end_date::text as end from quarters
        where branch_id = ${moment.branchId} and start_date is not null
      `.execute(moment.transaction)
    ).rows;
    const dated = (date: string) => quarters.some((one) => one.start <= date && date <= one.end);
    for (const [id, one] of read) {
      if (one.row.journalId !== null && dated(one.row.date)) freshness.missed();
      found.set(id, statusOfFacts(one, moment.now));
    }
  }
  return found;
}

/**
 * The attendance of the journals named in a quarter (task 9.3b-2), from the prepared units and,
 * for the units found behind, from source by the same reader (`attendanceOfJournal`).
 */
export async function preparedAttendance(
  moment: BranchMoment,
  quarter: QuarterRow,
  journalIds: readonly string[],
  freshness: Freshness,
): Promise<AttendanceLesson[]> {
  if (journalIds.length === 0) return [];
  const ids = [...new Set(journalIds.map((id) => id.toLowerCase()))].sort();
  const fresh = await freshUnits(moment.transaction, {
    branchId: moment.branchId,
    kind: 'attendance',
    quarterId: quarter.id,
    unitIds: ids,
    now: moment.now,
    schoolInputs: PREPARED_SHAPE,
  });
  const lessons: AttendanceLesson[] = [];
  for (const one of fresh.values()) {
    freshness.used(one.preparedAt);
    lessons.push(...(one.value as AttendanceLesson[]));
  }
  const behind = ids.filter((id) => !fresh.has(id));
  if (behind.length > 0) freshness.missed();
  for (const journalId of behind) {
    lessons.push(...(await attendanceOfJournal(moment, quarter, journalId)));
  }
  return lessons;
}

/**
 * The result items of the closing checklist (task 10.1b; `resultItemsOf`) from the prepared
 * `closing` units of the subjects named (`null`: every subject of the year) and, for the units
 * found behind, from source by the same function, one subject at a time.
 */
export async function preparedClosing(
  moment: BranchMoment,
  quarter: QuarterRef,
  subjectIds: readonly string[] | null,
  freshness: Freshness,
): Promise<ResultItems> {
  const subjects = subjectIds ?? (await subjectsOf(moment, quarter));
  const { fresh, behind } = await split(moment, freshness, 'closing', quarter.id, subjects);
  const parts: ResultItems[] = [...fresh.values()].map((one) => one.value as ResultItems);
  if (behind.length > 0)
    parts.push(await resultItemsOf(moment.transaction, { ...moment, quarter }, behind));
  const weightsMissing: string[] = [];
  const drafts: ResultDraft[] = [];
  for (const part of parts) {
    weightsMissing.push(...part.weightsMissing);
    drafts.push(...part.drafts);
  }
  return { weightsMissing, drafts };
}
