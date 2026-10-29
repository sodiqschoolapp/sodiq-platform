import type { Fraction } from '@sodiq/calc';
import { sql } from 'kysely';
import type { Transaction } from '../../../database/transactions.js';
import { lessonStatusFacts, type LessonStatusFacts } from '../../journal/lesson-status.query.js';
import { closingOf } from '../../setup/closed-quarters.js';
import type { BranchMoment } from '../branch-moment.js';
import {
  quarterFigures,
  workFiguresOf,
  type JudgedFigures,
  type QuarterRow,
} from '../early-warning.service.js';
import { outcomesOf, quarterStateOf, type Outcomes } from '../rating.service.js';
import { attendanceOfJournal } from './attendance.js';
import { resultItemsOf, type ResultItems } from '../closing-results.js';
import { journalRows } from '../../journal/journal-grid.query.js';
import { journalProgressOf } from '../../plans/plan-progress.js';
import type { UnitKey } from './prepared.query.js';

/**
 * The units of the prepared report totals (task 9.3b-1) and what each holds. Each value is what
 * the reader of today gives for that unit, by the same code; nothing is calculated here.
 *
 * - `outcomes` (a quarter and a subject): `outcomesOf` of the rating, the outcome of every member
 *   of the subject's graded journals, the stored record of a closed quarter in force (review of
 *   the plan, finding 6).
 * - `figures` (a quarter and a subject): the early-warning figures that do not depend on the
 *   thresholds (`quarterFigures`), and the figure the next quarter compares with
 *   (`workFiguresOf`).
 * - `statuses` (a quarter and a journal): the status facts of each lesson of the journal in the
 *   quarter (`lessonStatusFacts`), never the status (finding 1).
 * - `attendance` (a quarter and a journal; task 9.3b-2): the counts of the attendance cells of each
 *   held lesson of the journal by class (`attendanceOfJournal`).
 */

export interface FiguresValue {
  readonly figures: ReadonlyMap<string, JudgedFigures>;
  readonly work: ReadonlyMap<string, Fraction | null>;
}

const quarterColumns = [
  'quarters.id',
  'quarters.number',
  'quarters.academic_year_id',
  sql<string | null>`quarters.start_date::text`.as('start_date'),
  sql<string | null>`quarters.end_date::text`.as('end_date'),
] as const;

/** The dated quarters of the branch begun by `today`, with whether each is closed. */
export async function startedQuarters(moment: BranchMoment): Promise<QuarterRow[]> {
  const rows = await moment.transaction
    .selectFrom('quarters')
    .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
    .select(quarterColumns)
    .where('academic_years.branch_id', '=', moment.branchId)
    .where('quarters.start_date', '<=', moment.today)
    .orderBy('quarters.start_date')
    .execute();
  const quarters: QuarterRow[] = [];
  for (const row of rows) {
    if (row.start_date === null || row.end_date === null) continue;
    quarters.push({
      id: row.id,
      number: row.number,
      academicYearId: row.academic_year_id,
      startDate: row.start_date,
      endDate: row.end_date,
      closed: (await closingOf(moment.transaction, row.id)) !== undefined,
    });
  }
  return quarters;
}

/** The journals of the branch in a year: id and subject. */
export async function journalsOfYear(
  transaction: Transaction,
  branchId: string,
  yearId: string,
): Promise<{ id: string; subjectId: string }[]> {
  const rows = await transaction
    .selectFrom('journals')
    .select(['id', 'subject_id'])
    .where('branch_id', '=', branchId)
    .where('academic_year_id', '=', yearId)
    .orderBy('id')
    .execute();
  return rows.map((row) => ({ id: row.id, subjectId: row.subject_id }));
}

/**
 * The lessons of a journal in a quarter: of its subject, its class (or its group when it has no
 * class), dated in the quarter, as `lessonStatuses` gives a lesson its journal.
 */
async function lessonsOfJournal(
  transaction: Transaction,
  branchId: string,
  journalId: string,
  quarter: QuarterRow,
): Promise<string[]> {
  const rows = await sql<{ id: string }>`
    select l.id
    from journals j
    join lessons l on l.branch_id = j.branch_id and l.subject_id = j.subject_id
      and (
        (j.class_id is not null and l.class_id = j.class_id)
        or (j.class_id is null and l.class_id is null and l.group_id = j.group_id)
      )
    where j.id = ${journalId} and j.branch_id = ${branchId}
      and l.lesson_date between ${quarter.startDate}::date and ${quarter.endDate}::date
    order by l.id
  `.execute(transaction);
  return rows.rows.map((row) => row.id);
}

/**
 * The next moment at which a unit's value can change with no change of data: the start of the
 * next lesson of the subject (a lesson becomes held: `edge/00-definitions`) or of the journal,
 * and, for a quarter not yet over, the next midnight of the branch (the reference date and the
 * date four weeks before it move).
 */
async function nextChangeOf(
  moment: BranchMoment,
  quarter: QuarterRow,
  filter: { readonly subjectId: string } | { readonly journalId: string },
  withMidnight: boolean,
): Promise<Date | null> {
  const lessons =
    'subjectId' in filter
      ? sql<{ next: Date | null }>`
          select min(l.starts_at) as next from lessons l
          where l.branch_id = ${moment.branchId} and l.subject_id = ${filter.subjectId}
            and l.lesson_date between ${quarter.startDate}::date and ${quarter.endDate}::date
            and l.starts_at > ${moment.now}
        `
      : sql<{ next: Date | null }>`
          select min(l.starts_at) as next
          from journals j
          join lessons l on l.branch_id = j.branch_id and l.subject_id = j.subject_id
            and (
              (j.class_id is not null and l.class_id = j.class_id)
              or (j.class_id is null and l.class_id is null and l.group_id = j.group_id)
            )
          where j.id = ${filter.journalId} and j.branch_id = ${moment.branchId}
            and l.lesson_date between ${quarter.startDate}::date and ${quarter.endDate}::date
            and l.starts_at > ${moment.now}
        `;
  const found = (await lessons.execute(moment.transaction)).rows[0]?.next ?? null;
  const next = found === null ? null : new Date(found);
  if (!withMidnight || moment.today > quarter.endDate) return next;
  const midnight = await sql<{ at: Date }>`
    select ((${moment.today}::date + 1)::timestamp at time zone ${moment.timeZone}) as at
  `.execute(moment.transaction);
  const at = midnight.rows[0]?.at;
  if (at === undefined) return next;
  const day = new Date(at);
  return next === null || day < next ? day : next;
}

export interface UnitValue {
  readonly journalIds: readonly string[];
  readonly value: unknown;
  readonly lessons?: ReadonlyMap<string, LessonStatusFacts>;
  readonly nextChangeAt: Date | null;
}

/** The value of a unit now, read from source. */
export async function unitValue(
  moment: BranchMoment,
  quarter: QuarterRow,
  unit: UnitKey,
): Promise<UnitValue> {
  const journals = await journalsOfYear(
    moment.transaction,
    moment.branchId,
    quarter.academicYearId,
  );
  switch (unit.kind) {
    case 'outcomes': {
      const state = await quarterStateOf(moment, quarter);
      const value: Outcomes = await outcomesOf(moment, quarter, state, [unit.unitId]);
      return {
        journalIds: journals.filter((one) => one.subjectId === unit.unitId).map((one) => one.id),
        value,
        nextChangeAt: await nextChangeOf(moment, quarter, { subjectId: unit.unitId }, true),
      };
    }
    case 'figures': {
      const value: FiguresValue = {
        figures: await quarterFigures(moment, quarter, [unit.unitId]),
        work: await workFiguresOf(moment, quarter, [unit.unitId]),
      };
      return {
        journalIds: journals.filter((one) => one.subjectId === unit.unitId).map((one) => one.id),
        value,
        nextChangeAt: await nextChangeOf(moment, quarter, { subjectId: unit.unitId }, true),
      };
    }
    case 'statuses': {
      const lessonIds = await lessonsOfJournal(
        moment.transaction,
        moment.branchId,
        unit.unitId,
        quarter,
      );
      const lessons = await lessonStatusFacts(
        moment.transaction,
        moment.branchId,
        lessonIds,
        moment.now,
      );
      return {
        journalIds: [unit.unitId],
        value: null,
        lessons,
        nextChangeAt: await nextChangeOf(moment, quarter, { journalId: unit.unitId }, false),
      };
    }
    case 'attendance': {
      return {
        journalIds: [unit.unitId],
        value: await attendanceOfJournal(moment, quarter, unit.unitId),
        // A lesson becomes held at its start; nothing else moves with the clock.
        nextChangeAt: await nextChangeOf(moment, quarter, { journalId: unit.unitId }, false),
      };
    }
    case 'closing': {
      // Task 10.1b: the result items of the closing checklist of the subject's journals.
      const value: ResultItems = await resultItemsOf(moment.transaction, { ...moment, quarter }, [
        unit.unitId,
      ]);
      return {
        journalIds: journals.filter((one) => one.subjectId === unit.unitId).map((one) => one.id),
        value,
        // A lesson becomes held at its start; the reference date of the owners moves at midnight.
        nextChangeAt: await nextChangeOf(moment, quarter, { subjectId: unit.unitId }, true),
      };
    }
    case 'plan_progress': {
      // Task 10.1b: what the progress report of `09` counts of the journal.
      const journals = await journalRows(moment.transaction, moment.branchId, {
        journalIds: [unit.unitId],
      });
      const value = (
        await journalProgressOf(moment.transaction, journals, quarter, moment.timeZone, moment.now)
      ).get(unit.unitId);
      return {
        journalIds: [unit.unitId],
        value: value ?? null,
        // A lesson becomes held at its start; nothing else moves with the clock.
        nextChangeAt: await nextChangeOf(moment, quarter, { journalId: unit.unitId }, false),
      };
    }
    case 'class_figures':
      throw new Error(`The unit kind ${unit.kind} is not prepared yet.`);
  }
}

/** Every unit of the branch's begun quarters: each subject and each journal of their year. */
export async function unitsOf(moment: BranchMoment): Promise<UnitKey[]> {
  const units: UnitKey[] = [];
  for (const quarter of await startedQuarters(moment)) {
    const journals = await journalsOfYear(
      moment.transaction,
      moment.branchId,
      quarter.academicYearId,
    );
    const subjects = [...new Set(journals.map((one) => one.subjectId))].sort();
    for (const subjectId of subjects) {
      units.push({ kind: 'outcomes', quarterId: quarter.id, unitId: subjectId });
      units.push({ kind: 'figures', quarterId: quarter.id, unitId: subjectId });
      units.push({ kind: 'closing', quarterId: quarter.id, unitId: subjectId });
    }
    for (const journal of journals) {
      units.push({ kind: 'statuses', quarterId: quarter.id, unitId: journal.id });
      units.push({ kind: 'attendance', quarterId: quarter.id, unitId: journal.id });
      units.push({ kind: 'plan_progress', quarterId: quarter.id, unitId: journal.id });
    }
  }
  return units;
}
