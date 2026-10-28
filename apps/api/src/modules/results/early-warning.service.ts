import { Injectable } from '@nestjs/common';
import {
  currentAbsenceRun,
  currentWorkFigure,
  earlyWarningReasons,
  MIN_GRADED_WORKS,
  ownGradedWorks,
  quarterAttendanceAverage,
  storedQuarterInputs,
  storedQuarterOutcome,
  type EarlyWarningReason,
  type EarlyWarningThresholds,
  type Fraction,
  type StudentQuarterInput,
  type StudentQuarterOutcome,
} from '@sodiq/calc';
import {
  earlyWarningListSchema,
  schoolDateOf,
  type EarlyWarningHandle,
  type EarlyWarningHandled,
  type EarlyWarningList,
  type EarlyWarningQuery,
  type EarlyWarningReasonKind,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { ownStaffOf } from '../journal/attendance-entry.js';
import { addDays } from '../journal/exemption-effects.js';
import { journalRows, type JournalRow } from '../journal/journal-grid.query.js';
import { WHOLE_ROLES } from '../journal/journal-scope.js';
import type { CountedLesson } from '../journal/subject-quarter-lessons.js';
import { ownerIdOn } from '../plans/plan-scope.js';
import { closingOf } from '../setup/closed-quarters.js';
import { notFound } from '../setup/setup-refusals.js';
import { accountNames } from '../timetable/edit-lock.js';
import { ownerFactsOf, ownerOn } from '../timetable/journal-owners.js';
import type { QuarterRef } from './grade-changes.js';
import type { BranchMoment } from './branch-moment.js';
import { Freshness, preparedFigures } from './prepared/read.js';
import { quarterOutcomes } from './quarter-outcomes.js';
import { storedRecordsOf } from './stored-records.js';

/**
 * The early-warning list (task 9.4a, pull request #235; `08`, Early-warning list;
 * `edge/calculation`, "The early-warning list compares ..."; `edge/journal`, "Three absences in a
 * row"). Worked out on read for one quarter of the branch of the request (plan decision 13):
 * every figure and reason comes from `packages/calc` (`currentWorkFigure`, `ownGradedWorks`,
 * `currentAbsenceRun`, `earlyWarningReasons`); nothing is calculated here.
 *
 * - One entry per student and subject, at the journal of the student's last membership of the
 *   subject in the quarter; the student's figures read the lessons of every journal of the
 *   subject (`subjectQuarterLessons` through `quarterOutcomes`; From 8.6, "A transferred student
 *   is judged on their own results"). The run of absences is of that journal ("of one journal").
 * - A student with a result at leaving, or who left the subject, is not listed (build decision).
 * - "28 days ago" is the reference date (`edge/00-definitions`) less 28 days, in branch time;
 *   the figure over the lessons dated on or before it, with the values stored now (decision 3).
 * - The previous quarter is the one before in the same year (decision 9): its current-work
 *   figure from the stored inputs of its close in force, the exam left out (never the stored
 *   result), else from its live lessons.
 * - In a closed quarter the result, the current-work figure, the attendance and the works are
 *   read from the stored record in force (From 9.2b: never calculated again); the run and the
 *   figure of 28 days ago need dated lessons and are read live.
 * - Handled: the newest row of `early_warning_handled` per student, subject and reason hides the
 *   reason until its figure is worse: a lower result or attendance, a larger drop, a longer run,
 *   or a new run that began after it was handled (decision 11, review correction 2).
 *
 * Who reads (decisions 1 and 7), from the assignments that permit the route, never `access.role`:
 *
 * | Reader | Entries |
 * | --- | --- |
 * | Super Admin, Principal, Academic Vice Principal | the branch |
 * | Head Teacher, Senior Head Teacher | own subjects |
 * | Tutor | the students of own classes on the reference date, all subjects |
 * | Teacher | own journals: the owner on the reference date, an acting teacher included |
 * | Head Tutor, Spiritual Vice Principal | every entry, the attendance reasons only |
 *
 * Marking handled (the Teacher and the Tutor in their scope, the Super Admin in the branch) is
 * refused in a closed quarter (review correction 1) and for a reason the list does not show now.
 */

const SUBJECT_ROLES = ['head_teacher', 'senior_head_teacher'] as const;
const ATTENDANCE_ROLES = ['head_tutor', 'spiritual_vice_principal'] as const;
const ATTENDANCE_REASONS: readonly EarlyWarningReasonKind[] = ['low_attendance', 'absences_in_row'];

/** `branch_settings` defaults (0019) for a branch with no row. */
const DEFAULT_THRESHOLDS: EarlyWarningThresholds = {
  lowResult: 50,
  resultDrop: 15,
  attendancePercent: 80,
  absencesInRow: 3,
};

const DAYS_AGO = 28;

const lower = (id: string) => id.toLowerCase();

interface Context extends BranchMoment {
  readonly access: Access;
}

export interface QuarterRow extends QuarterRef {
  readonly closed: boolean;
}

/** One student and subject as `packages/calc` judged it. */
/**
 * The figures of a student and subject that do not depend on the thresholds (task 9.3b-1: what the
 * prepared totals keep): everything the list shows but the reasons and the previous quarter's
 * figure, which is read from that quarter. `outcome` is what `earlyWarningReasons` judges.
 */
export interface JudgedFigures {
  readonly studentId: string;
  readonly subjectId: string;
  readonly journalId: string;
  readonly result: bigint | null;
  readonly currentWork: { readonly now: Fraction | null; readonly daysAgo: Fraction | null };
  readonly attendance: Fraction | null;
  readonly absenceRun: number;
  readonly runStartsAt: Date | null;
  readonly gradedWorks: number;
  readonly outcome: StudentQuarterOutcome;
}

interface Judged {
  readonly studentId: string;
  readonly subjectId: string;
  readonly journal: JournalRow;
  readonly result: bigint | null;
  readonly currentWork: {
    readonly now: Fraction | null;
    readonly daysAgo: Fraction | null;
    readonly previousQuarter: Fraction | null;
  };
  readonly attendance: Fraction | null;
  readonly absenceRun: number;
  /** The start of the first lesson of the current run of absences. */
  readonly runStartsAt: Date | null;
  readonly gradedWorks: number;
  readonly reasons: readonly EarlyWarningReason[];
}

interface HandledRow {
  readonly figure: number;
  readonly note: string;
  readonly handledAt: Date;
  readonly handledBy: string;
}

const keyOf = (studentId: string, subjectId: string) => `${subjectId}|${studentId}`;

/** The figure of a reason as the list compares and stores it. */
export function reasonFigure(reason: EarlyWarningReason): number {
  switch (reason.kind) {
    case 'low_result':
    case 'low_attendance':
      return Number(reason.shown);
    case 'result_drop':
      return Number(reason.points);
    case 'absences_in_row':
      return Number(reason.length);
  }
}

/** Whether a reason handled earlier is listed again: its figure got worse (decision 11). */
function returned(reason: EarlyWarningReason, judged: Judged, handled: HandledRow): boolean {
  const figure = reasonFigure(reason);
  switch (reason.kind) {
    case 'low_result':
    case 'low_attendance':
      return figure < handled.figure;
    case 'result_drop':
      return figure > handled.figure;
    case 'absences_in_row':
      // Review correction 2: a new run that began after the handling returns as well.
      return (
        figure > handled.figure ||
        (judged.runStartsAt !== null && judged.runStartsAt > handled.handledAt)
      );
  }
}

const shownOf = (value: Fraction | null): number | null =>
  value === null ? null : Number(value.roundHalfUp());

@Injectable()
export class EarlyWarningService {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  list(access: Access, query: EarlyWarningQuery): Promise<EarlyWarningList> {
    return this.run(access, (context) => listIn(context, query));
  }

  handle(
    access: Access,
    input: EarlyWarningHandle,
    requestId: string,
  ): Promise<EarlyWarningHandled> {
    return this.run(access, async (context) => {
      const { transaction } = context;
      // Every id of the body against the branch first: unknown or of another branch, 404.
      const quarter = await quarterOf(context, input.quarterId);
      const student = await transaction
        .selectFrom('students')
        .select('id')
        .where('id', '=', input.studentId)
        .where('branch_id', '=', context.branchId)
        .executeTakeFirst();
      if (student === undefined) throw notFound();
      const subject = await transaction
        .selectFrom('subjects')
        .select('id')
        .where('id', '=', input.subjectId)
        .executeTakeFirst();
      if (subject === undefined) throw notFound();

      const judged = (await judgeQuarter(context, quarter, [subject.id])).get(
        keyOf(student.id, subject.id),
      );
      const referenceDate = referenceDateOf(quarter, context.today);
      const scope = new Scope(context, referenceDate);
      await scope.load([student.id]);
      const assignmentId = await scope.handlingAssignment(student.id, judged?.journal ?? null);
      if (assignmentId === null) throw new ApiException('permission_denied', 403);
      if (quarter.closed) throw new ApiException('quarter_closed', 409);
      const reason = judged?.reasons.find((one) => one.kind === input.reason);
      if (judged === undefined || reason === undefined) {
        throw new ApiException('early_warning_not_listed', 409);
      }
      const handled = (await handledOf(transaction, quarter.id, [subject.id])).get(
        `${keyOf(student.id, subject.id)}|${reason.kind}`,
      );
      if (handled !== undefined && !returned(reason, judged, handled)) {
        throw new ApiException('early_warning_not_listed', 409);
      }

      const figure = reasonFigure(reason);
      const row = await transaction
        .insertInto('early_warning_handled')
        .values({
          branch_id: context.branchId,
          quarter_id: quarter.id,
          student_id: student.id,
          subject_id: subject.id,
          reason: reason.kind,
          figure,
          note: input.note,
          handled_by: access.accountId,
          assignment_id: assignmentId,
          handled_at: context.now,
        })
        .returning(['id', 'handled_at'])
        .executeTakeFirstOrThrow();
      await this.audit.record(transaction, {
        branchId: context.branchId,
        actorId: access.accountId,
        assignmentId,
        action: 'early_warning.handled',
        record: { type: 'early_warning_handled', id: row.id },
        newValue: {
          quarterId: quarter.id,
          studentId: student.id,
          subjectId: subject.id,
          reason: reason.kind,
          figure,
          note: input.note,
        },
        requestId,
      });
      return { handledAt: row.handled_at.toISOString() };
    });
  }

  private run<T>(access: Access, work: (context: Context) => Promise<T>): Promise<T> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const branch = await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow();
      const now = await transactionMoment(transaction);
      return work({
        transaction,
        access,
        branchId,
        timeZone: branch.time_zone,
        now,
        today: schoolDateOf(now, branch.time_zone),
      });
    });
  }
}

/** The reference date of a quarter (`edge/00-definitions`). */
const referenceDateOf = (quarter: QuarterRef, today: string): string =>
  today > quarter.endDate ? quarter.endDate : today < quarter.startDate ? quarter.startDate : today;

const quarterColumns = [
  'quarters.id',
  'quarters.number',
  'quarters.academic_year_id',
  sql<string | null>`quarters.start_date::text`.as('start_date'),
  sql<string | null>`quarters.end_date::text`.as('end_date'),
] as const;

async function withClosed(
  context: BranchMoment,
  row: {
    id: string;
    number: number;
    academic_year_id: string;
    start_date: string | null;
    end_date: string | null;
  },
): Promise<QuarterRow | null> {
  if (row.start_date === null || row.end_date === null) return null;
  return {
    id: row.id,
    number: row.number,
    academicYearId: row.academic_year_id,
    startDate: row.start_date,
    endDate: row.end_date,
    closed: (await closingOf(context.transaction, row.id)) !== undefined,
  };
}

/** A dated quarter of the branch; 404 when unknown, undated or of another branch. */
async function quarterOf(context: Context, quarterId: string): Promise<QuarterRow> {
  const row = await context.transaction
    .selectFrom('quarters')
    .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
    .select(quarterColumns)
    .where('quarters.id', '=', quarterId)
    .where('academic_years.branch_id', '=', context.branchId)
    .executeTakeFirst();
  const quarter = row === undefined ? null : await withClosed(context, row);
  if (quarter === null) throw notFound();
  return quarter;
}

/** The quarter containing today, else the last started one of the branch (decision 10). */
async function defaultQuarter(context: Context): Promise<QuarterRow | null> {
  const row = await context.transaction
    .selectFrom('quarters')
    .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
    .select(quarterColumns)
    .where('academic_years.branch_id', '=', context.branchId)
    .where('quarters.start_date', '<=', context.today)
    .orderBy('quarters.start_date', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row === undefined ? null : withClosed(context, row);
}

/** The started quarters of a year, in order. */
async function startedQuarters(context: Context, yearId: string): Promise<QuarterRow[]> {
  const rows = await context.transaction
    .selectFrom('quarters')
    .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
    .select(quarterColumns)
    .where('academic_years.branch_id', '=', context.branchId)
    .where('quarters.academic_year_id', '=', yearId)
    .where('quarters.start_date', '<=', context.today)
    .orderBy('quarters.number')
    .execute();
  const quarters: QuarterRow[] = [];
  for (const row of rows) {
    const quarter = await withClosed(context, row);
    if (quarter !== null) quarters.push(quarter);
  }
  return quarters;
}

async function thresholdsOf(context: BranchMoment): Promise<EarlyWarningThresholds> {
  const row = await context.transaction
    .selectFrom('branch_settings')
    .select(['low_result', 'result_drop', 'attendance_percent', 'absences_in_row'])
    .where('branch_id', '=', context.branchId)
    .executeTakeFirst();
  return row === undefined
    ? DEFAULT_THRESHOLDS
    : {
        lowResult: row.low_result,
        resultDrop: row.result_drop,
        attendancePercent: row.attendance_percent,
        absencesInRow: row.absences_in_row,
      };
}

/** The input given to the module without the rating exam, for the current-work figure. */
const currentWorkOf = (input: StudentQuarterInput, lessons = input.lessons): Fraction | null =>
  currentWorkFigure({
    weights: input.weights,
    attendanceValues: input.attendanceValues,
    lessons,
    quarterClosed: input.quarterClosed,
  });

/** The quarter before this one in its year, dated; `null` for the first or an undated one. */
export async function previousQuarterOf(
  context: BranchMoment,
  quarter: QuarterRef,
): Promise<QuarterRow | null> {
  const row = await context.transaction
    .selectFrom('quarters')
    .select(quarterColumns)
    .where('academic_year_id', '=', quarter.academicYearId)
    .where('number', '=', quarter.number - 1)
    .executeTakeFirst();
  return row === undefined ? null : withClosed(context, row);
}

/** The current-work figure of each student and subject in the previous quarter of the year. */
async function previousFigures(
  context: BranchMoment,
  quarter: QuarterRef,
  subjectIds: readonly string[] | null,
): Promise<Map<string, Fraction | null>> {
  const previous = await previousQuarterOf(context, quarter);
  return previous === null ? new Map() : workFiguresOf(context, previous, subjectIds);
}

/**
 * The current-work figure of each student and subject in a quarter, as the next quarter compares
 * with it (`edge/calculation`, early warning): the stored record of a closed quarter, else the
 * journal's.
 */
export async function workFiguresOf(
  context: BranchMoment,
  previous: QuarterRow,
  subjectIds: readonly string[] | null,
): Promise<Map<string, Fraction | null>> {
  const figures = new Map<string, Fraction | null>();
  const stored = previous.closed
    ? await storedRecordsOf(
        context.transaction,
        previous.id,
        subjectIds?.length === 1 && subjectIds[0] !== undefined ? { subjectId: subjectIds[0] } : {},
      )
    : new Map<string, { record: unknown; reopened: boolean }>();
  for (const [key, one] of stored) {
    if (one.record !== undefined) figures.set(key, currentWorkOf(storedQuarterInputs(one.record)));
  }
  const { journals } = await quarterOutcomes(context.transaction, {
    branchId: context.branchId,
    timeZone: context.timeZone,
    now: context.now,
    quarter: previous,
    subjectIds,
    quarterClosed: previous.closed,
  });
  for (const one of journals.values()) {
    for (const [studentId, member] of one.members) {
      const key = keyOf(studentId, one.journal.subjectId);
      if (figures.has(key) || member.input === null) continue;
      if (stored.get(key)?.record !== undefined) continue;
      figures.set(key, currentWorkOf(member.input));
    }
  }
  return figures;
}

/** The latest journal of the student's memberships of the subject in the quarter. */
function lastJournalId(spans: readonly { journalId: string; until: string }[]): string | null {
  let last: { journalId: string; until: string } | undefined;
  for (const span of spans) if (last === undefined || span.until > last.until) last = span;
  return last?.journalId ?? null;
}

/**
 * The starts of the lessons named, to order the lessons of one journal and
 * date the run. Each lesson once and all in one array parameter: the lessons
 * of every student of the branch's journals outgrow the 65,535 parameters of
 * a statement on a year of lessons (task 10.1, the speed run at full size).
 */
export async function startsOf(transaction: Transaction, lessonIds: readonly string[]) {
  if (lessonIds.length === 0) return new Map<string, Date>();
  const rows = await transaction
    .selectFrom('lessons')
    .select(['id', 'starts_at'])
    .where(sql<boolean>`id = any(${[...new Set(lessonIds)]}::uuid[])`)
    .execute();
  return new Map(rows.map((row) => [row.id, row.starts_at]));
}

/** Every student and subject of the quarter's graded journals, judged by `packages/calc`. */
async function judgeQuarter(
  context: Context,
  quarter: QuarterRow,
  subjectIds: readonly string[] | null,
  /** Task 10.1: the reader's own journals only; the previous quarter is still read by subject. */
  journalIds?: readonly string[],
): Promise<Map<string, Judged>> {
  const figures = await quarterFigures(context, quarter, subjectIds, journalIds);
  if (figures.size === 0) return new Map();
  return judgedOf(
    context,
    figures,
    await previousFigures(context, quarter, subjectIds),
    await thresholdsOf(context),
  );
}

/** The figures judged against the thresholds, with the previous quarter's figure of each. */
export async function judgedOf(
  context: BranchMoment,
  figures: ReadonlyMap<string, JudgedFigures>,
  previous: ReadonlyMap<string, Fraction | null>,
  thresholds?: EarlyWarningThresholds,
): Promise<Map<string, Judged>> {
  const judged = new Map<string, Judged>();
  if (figures.size === 0) return judged;
  const limits = thresholds ?? (await thresholdsOf(context));
  const journals = new Map(
    (
      await journalRows(context.transaction, context.branchId, {
        journalIds: [...new Set([...figures.values()].map((one) => one.journalId))],
      })
    ).map((journal) => [journal.id, journal]),
  );
  for (const [key, one] of figures) {
    const journal = journals.get(one.journalId);
    if (journal === undefined) continue;
    const currentWork = {
      ...one.currentWork,
      previousQuarter: previous.get(key) ?? null,
    };
    const judgement = earlyWarningReasons({
      thresholds: limits,
      gradedWorks: one.gradedWorks,
      outcome: one.outcome,
      currentWork,
      attendance: one.attendance,
      absenceRun: one.absenceRun,
    });
    judged.set(key, {
      studentId: one.studentId,
      subjectId: one.subjectId,
      journal,
      result: one.result,
      currentWork,
      attendance: one.attendance,
      absenceRun: one.absenceRun,
      runStartsAt: one.runStartsAt,
      gradedWorks: one.gradedWorks,
      reasons: judgement.reasons,
    });
  }
  return judged;
}

/**
 * The figures of every student and subject of the quarter's graded journals that do not depend on
 * the thresholds (`JudgedFigures`), by `packages/calc`.
 */
export async function quarterFigures(
  context: BranchMoment,
  quarter: QuarterRow,
  subjectIds: readonly string[] | null,
  journalIds?: readonly string[],
): Promise<Map<string, JudgedFigures>> {
  const judged = new Map<string, JudgedFigures>();
  const { journals } = await quarterOutcomes(context.transaction, {
    branchId: context.branchId,
    timeZone: context.timeZone,
    now: context.now,
    quarter,
    subjectIds,
    ...(journalIds === undefined ? {} : { journalIds }),
    quarterClosed: quarter.closed,
  });
  if (journals.size === 0) return judged;
  const daysAgoDate = addDays(referenceDateOf(quarter, context.today), -DAYS_AGO);
  const stored = quarter.closed
    ? await storedRecordsOf(
        context.transaction,
        quarter.id,
        subjectIds?.length === 1 && subjectIds[0] !== undefined ? { subjectId: subjectIds[0] } : {},
      )
    : new Map<string, { record: unknown; reopened: boolean }>();

  const pending: {
    studentId: string;
    journal: JournalRow;
    input: StudentQuarterInput;
    outcome: StudentQuarterOutcome;
    lessons: readonly CountedLesson[];
  }[] = [];
  for (const one of journals.values()) {
    for (const [studentId, member] of one.members) {
      const found = member.found;
      if (found === undefined || member.input === null || member.outcome === null) continue;
      if (lastJournalId(found.spans) !== one.journal.id) continue;
      if (found.atLeaving !== null || found.leftSubjectOn !== null) continue;
      const record = stored.get(keyOf(studentId, one.journal.subjectId))?.record;
      pending.push({
        studentId,
        journal: one.journal,
        input: record === undefined ? member.input : storedQuarterInputs(record),
        outcome: record === undefined ? member.outcome : storedQuarterOutcome(record),
        lessons: found.lessons,
      });
    }
  }
  const starts = await startsOf(
    context.transaction,
    pending.flatMap((one) =>
      one.lessons.filter((lesson) => lesson.journalId === one.journal.id).map((l) => l.lessonId),
    ),
  );
  const startOf = (lesson: CountedLesson) => starts.get(lesson.lessonId)?.getTime() ?? 0;

  for (const one of pending) {
    const subjectId = one.journal.subjectId;
    const earlier = one.lessons.filter((lesson) => lesson.date <= daysAgoDate);
    const daysAgo =
      earlier.length === 0
        ? null
        : currentWorkOf(
            one.input,
            earlier.map((lesson) => lesson.lesson),
          );
    const own = one.lessons
      .filter((lesson) => lesson.journalId === one.journal.id)
      .sort((a, b) => startOf(a) - startOf(b) || (a.lessonId < b.lessonId ? -1 : 1));
    const run = currentAbsenceRun(own.map((lesson) => lesson.lesson));
    const runStart = run.start === null ? undefined : own[run.start];
    judged.set(keyOf(one.studentId, subjectId), {
      studentId: one.studentId,
      subjectId,
      journalId: one.journal.id,
      result: one.outcome.kind === 'number' ? one.outcome.result.shown : null,
      currentWork: { now: currentWorkOf(one.input), daysAgo },
      attendance: quarterAttendanceAverage(one.input),
      absenceRun: run.length,
      runStartsAt: runStart === undefined ? null : (starts.get(runStart.lessonId) ?? null),
      gradedWorks: ownGradedWorks(one.input.lessons),
      outcome: one.outcome,
    });
  }
  return judged;
}

/** The newest handled row per student, subject and reason of the quarter. */
async function handledOf(
  transaction: Transaction,
  quarterId: string,
  subjectIds: readonly string[] | null,
): Promise<Map<string, HandledRow>> {
  // No subject (a reader of their own journals who owns none): nothing handled to read.
  if (subjectIds?.length === 0) return new Map();
  let query = transaction
    .selectFrom('early_warning_handled')
    .select(['student_id', 'subject_id', 'reason', 'figure', 'note', 'handled_at', 'handled_by'])
    .where('quarter_id', '=', quarterId)
    .orderBy('handled_at')
    .orderBy('id');
  if (subjectIds !== null) query = query.where('subject_id', 'in', [...subjectIds]);
  const handled = new Map<string, HandledRow>();
  for (const row of await query.execute()) {
    handled.set(`${keyOf(row.student_id, row.subject_id)}|${row.reason}`, {
      figure: row.figure,
      note: row.note,
      handledAt: row.handled_at,
      handledBy: row.handled_by,
    });
  }
  return handled;
}

const permittingOf = (context: Context, roles: readonly string[]) =>
  context.access.permitting.filter((assignment) => roles.includes(assignment.role));

/** The scope of the reader, decided per entry (decisions 1 and 7). */
class Scope {
  private readonly owners = new Map<string, string | null>();
  private classOf = new Map<string, string>();
  private staffId: string | null | undefined;

  constructor(
    private readonly context: Context,
    private readonly referenceDate: string,
  ) {}

  /** The class of each student on the reference date, for the Tutor's scope. */
  async load(studentIds: readonly string[]): Promise<void> {
    if (permittingOf(this.context, ['tutor']).length === 0 || studentIds.length === 0) return;
    const rows = await this.context.transaction
      .selectFrom('class_memberships')
      .select(['student_id', 'class_id'])
      .where('student_id', 'in', [...studentIds])
      .whereRef('valid_from', '<', 'valid_until')
      .where('valid_from', '<=', this.referenceDate)
      .where('valid_until', '>', this.referenceDate)
      .execute();
    this.classOf = new Map(rows.map((row) => [row.student_id, lower(row.class_id)]));
  }

  /** Whether the student is of the class on the reference date (task 9.4b, the Tutor's class card). */
  inClass(studentId: string, classId: string): boolean {
    return this.classOf.get(studentId) === lower(classId);
  }

  private tutorOf(studentId: string): boolean {
    const classId = this.classOf.get(studentId);
    return (
      classId !== undefined &&
      permittingOf(this.context, ['tutor']).some((one) => one.classIds.includes(classId))
    );
  }

  /**
   * The journals the reader owns on the reference date and their subjects, by the
   * owners of every journal of the year read at once (`ownsJournal`'s rule); none for a
   * reader who is no Teacher or has no staff record.
   */
  async ownJournals(quarter: QuarterRow): Promise<{ subjectIds: string[]; journalIds: string[] }> {
    const none = { subjectIds: [], journalIds: [] };
    if (permittingOf(this.context, ['teacher']).length === 0) return none;
    if (this.staffId === undefined) {
      this.staffId = await ownStaffOf(this.context.transaction, this.context.access.accountId);
    }
    const staffId = this.staffId;
    if (staffId === null) return none;
    const journals = await journalRows(this.context.transaction, this.context.branchId, {
      yearId: quarter.academicYearId,
    });
    const facts = await ownerFactsOf(
      this.context.transaction,
      this.context.branchId,
      journals.map((journal) => ({
        id: journal.id,
        academic_year_id: journal.academicYearId,
        class_id: journal.classId,
        group_id: journal.groupId,
        subject_id: journal.subjectId,
      })),
    );
    const subjects = new Set<string>();
    const owned: string[] = [];
    for (const journal of journals) {
      const owner = ownerOn(
        facts.runs.get(journal.id) ?? [],
        facts.periods.get(journal.id) ?? [],
        facts.out,
        this.referenceDate,
      );
      const id = owner === null || owner.kind === 'none' ? null : owner.staffId;
      this.owners.set(journal.id, id);
      if (id === staffId) {
        subjects.add(journal.subjectId);
        owned.push(journal.id);
      }
    }
    return { subjectIds: [...subjects].sort(), journalIds: owned };
  }

  async ownsJournal(journal: JournalRow): Promise<boolean> {
    if (permittingOf(this.context, ['teacher']).length === 0) return false;
    if (this.staffId === undefined) {
      this.staffId = await ownStaffOf(this.context.transaction, this.context.access.accountId);
    }
    if (this.staffId === null) return false;
    if (!this.owners.has(journal.id)) {
      this.owners.set(
        journal.id,
        await ownerIdOn(
          this.context.transaction,
          this.context.branchId,
          journal,
          this.referenceDate,
        ),
      );
    }
    return this.owners.get(journal.id) === this.staffId;
  }

  /** `full`, `attendance` (the attendance reasons only) or `none`. */
  async readOf(studentId: string, journal: JournalRow): Promise<'full' | 'attendance' | 'none'> {
    if (permittingOf(this.context, WHOLE_ROLES).length > 0) return 'full';
    const subject = lower(journal.subjectId);
    if (permittingOf(this.context, SUBJECT_ROLES).some((one) => one.subjectIds.includes(subject))) {
      return 'full';
    }
    if (this.tutorOf(studentId) || (await this.ownsJournal(journal))) return 'full';
    return permittingOf(this.context, ATTENDANCE_ROLES).length > 0 ? 'attendance' : 'none';
  }

  /** The Teacher of the journal, the Tutor of the student's class, or the Super Admin. */
  async mayHandle(studentId: string, journal: JournalRow | null): Promise<boolean> {
    return (await this.handlingAssignment(studentId, journal)) !== null;
  }

  /**
   * The assignment that allows the mark, named by the row and its audit entry (permission
   * review, should-fix 1): the Super Admin's, the Tutor's of the student's class, or the
   * Teacher's of the journal; `null` when none does.
   */
  async handlingAssignment(studentId: string, journal: JournalRow | null): Promise<string | null> {
    const superAdmin = permittingOf(this.context, ['super_admin'])[0];
    if (superAdmin !== undefined) return superAdmin.id;
    const classId = this.classOf.get(studentId);
    const tutor = permittingOf(this.context, ['tutor']).find(
      (one) => classId !== undefined && one.classIds.includes(classId),
    );
    if (tutor !== undefined) return tutor.id;
    const teacher = permittingOf(this.context, ['teacher'])[0];
    return teacher !== undefined && journal !== null && (await this.ownsJournal(journal))
      ? teacher.id
      : null;
  }
}

async function listIn(context: Context, query: EarlyWarningQuery): Promise<EarlyWarningList> {
  const quarter =
    query.quarterId === undefined
      ? await defaultQuarter(context)
      : await quarterOf(context, query.quarterId);
  const thresholds = await thresholdsOf(context);
  const shownThresholds = { ...thresholds, gradedWorks: MIN_GRADED_WORKS };
  if (quarter === null) {
    return {
      quarter: null,
      quarters: [],
      thresholds: shownThresholds,
      daysAgoDate: null,
      entries: [],
      prepared: new Freshness().stamp,
    };
  }
  const quarterShown = (one: QuarterRow) => ({
    id: one.id,
    number: one.number,
    startDate: one.startDate,
    endDate: one.endDate,
    closed: one.closed,
  });
  const referenceDate = referenceDateOf(quarter, context.today);
  // Task 9.4b: a class card reads one own class of the reader as Tutor; another branch's or an
  // unknown class is 404, a class not the reader's own 403, before anything is judged.
  if (query.classId !== undefined) {
    const classId = lower(query.classId);
    const found = await context.transaction
      .selectFrom('classes')
      .select('id')
      .where('id', '=', classId)
      .where('branch_id', '=', context.branchId)
      .executeTakeFirst();
    if (found === undefined) throw notFound();
    if (!permittingOf(context, ['tutor']).some((one) => one.classIds.includes(classId))) {
      throw new ApiException('permission_denied', 403);
    }
  }
  const scope = new Scope(context, referenceDate);
  // Task 10.1 (the speed run at full size: the Teacher's home took 35 s): the own journals
  // are judged by their subjects only, every entry is per student and subject, and each
  // entry is still kept only for a journal the reader owns (below).
  const own = query.for === 'own_journals' ? await scope.ownJournals(quarter) : null;
  const subjectIds = own === null ? null : own.subjectIds;
  // Task 9.3b-1: the figures from the prepared totals, judged against today's thresholds.
  const freshness = new Freshness();
  const prepared = await preparedFigures(context, quarter, subjectIds, freshness);
  const journalIds = own === null ? null : new Set(own.journalIds);
  const judged = await judgedOf(
    context,
    new Map(
      [...prepared.figures].filter(
        ([, one]) => journalIds === null || journalIds.has(one.journalId),
      ),
    ),
    prepared.previous,
    thresholds,
  );
  const handled = await handledOf(context.transaction, quarter.id, subjectIds);
  await scope.load([...new Set([...judged.values()].map((one) => one.studentId))]);

  const rows: {
    judged: Judged;
    read: 'full' | 'attendance';
    reasons: { reason: EarlyWarningReason; before: HandledRow | null }[];
    canHandle: boolean;
  }[] = [];
  for (const one of judged.values()) {
    if (one.reasons.length === 0) continue;
    // Task 9.4b: the narrowing of the home pages, inside the reader's scope only.
    if (query.classId !== undefined && !scope.inClass(one.studentId, query.classId)) continue;
    if (query.for === 'own_journals' && !(await scope.ownsJournal(one.journal))) continue;
    const read = await scope.readOf(one.studentId, one.journal);
    if (read === 'none') continue;
    const reasons = one.reasons
      .filter((reason) => read === 'full' || ATTENDANCE_REASONS.includes(reason.kind))
      .flatMap<{ reason: EarlyWarningReason; before: HandledRow | null }>((reason) => {
        const before = handled.get(`${keyOf(one.studentId, one.subjectId)}|${reason.kind}`);
        if (before === undefined) return [{ reason, before: null }];
        return returned(reason, one, before) ? [{ reason, before }] : [];
      });
    if (reasons.length === 0) continue;
    rows.push({
      judged: one,
      read,
      reasons,
      canHandle: !quarter.closed && (await scope.mayHandle(one.studentId, one.journal)),
    });
  }

  const studentIds = [...new Set(rows.map((row) => row.judged.studentId))];
  const students =
    studentIds.length === 0
      ? []
      : await context.transaction
          .selectFrom('students')
          .select(['id', 'first_name', 'last_name', 'paternal_name'])
          .where('id', 'in', studentIds)
          .execute();
  const nameOf = new Map(students.map((row) => [row.id, row]));
  const by = await accountNames(context.transaction, [
    ...new Set(rows.flatMap((row) => row.reasons.flatMap((one) => one.before?.handledBy ?? []))),
  ]);

  const entries = rows.flatMap(({ judged: one, read, reasons, canHandle }) => {
    const student = nameOf.get(one.studentId);
    if (student === undefined) return [];
    const attendanceOnly = read === 'attendance';
    return [
      {
        student: {
          id: student.id,
          firstName: student.first_name,
          lastName: student.last_name,
          paternalName: student.paternal_name,
        },
        subject: {
          id: one.subjectId,
          names: one.journal.subject.names,
          colour: one.journal.subject.colour,
        },
        journal: {
          id: one.journal.id,
          unit: {
            kind: one.journal.classId === null ? 'group' : 'class',
            id: one.journal.classId ?? one.journal.groupId ?? '',
            name: one.journal.unitName,
          },
        },
        attendanceOnly,
        figures: {
          result: attendanceOnly || one.result === null ? null : Number(one.result),
          currentWork: attendanceOnly
            ? { now: null, daysAgo: null, previousQuarter: null }
            : {
                now: shownOf(one.currentWork.now),
                daysAgo: shownOf(one.currentWork.daysAgo),
                previousQuarter: shownOf(one.currentWork.previousQuarter),
              },
          attendance: shownOf(one.attendance),
          absenceRun: one.absenceRun,
          gradedWorks: attendanceOnly ? null : one.gradedWorks,
        },
        reasons: reasons.map(({ reason, before }) => ({
          kind: reason.kind,
          figure: reasonFigure(reason),
          against: reason.kind === 'result_drop' ? [...reason.against] : [],
          handledBefore:
            before === null
              ? null
              : {
                  note: before.note,
                  handledAt: before.handledAt.toISOString(),
                  figure: before.figure,
                  by: by.get(before.handledBy) ?? '',
                },
        })),
        canHandle,
      },
    ];
  });
  entries.sort(
    (a, b) =>
      a.student.lastName.localeCompare(b.student.lastName, 'ru') ||
      a.student.firstName.localeCompare(b.student.firstName, 'ru') ||
      (a.student.id < b.student.id ? -1 : a.student.id > b.student.id ? 1 : 0) ||
      a.subject.names.en.localeCompare(b.subject.names.en, 'en'),
  );

  return earlyWarningListSchema.parse({
    quarter: quarterShown(quarter),
    quarters: (await startedQuarters(context, quarter.academicYearId)).map(quarterShown),
    thresholds: shownThresholds,
    daysAgoDate: addDays(referenceDate, -DAYS_AGO),
    entries,
    prepared: freshness.stamp,
  });
}
