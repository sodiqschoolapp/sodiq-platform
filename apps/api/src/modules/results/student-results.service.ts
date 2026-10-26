import { Injectable } from '@nestjs/common';
import {
  attendanceValue,
  Fraction,
  outcomeForYear,
  quarterAttendanceAverage,
  quarterResult,
  shownPercent,
  storedQuarterInputs,
  storedQuarterOutcome,
  studentQuarterOutcome,
  yearResult,
  type FlagDecision,
  type QuarterOutcome,
  type StudentQuarterInput,
  type StudentQuarterOutcome,
} from '@sodiq/calc';
import {
  schoolDateOf,
  studentAttendanceSchema,
  studentResultLessonsSchema,
  studentResultsSchema,
  studentResultTabsSchema,
  type JournalPart,
  type QuarterOutcomeShown,
  type StudentAttendance,
  type StudentResultLessons,
  type StudentResults,
  type StudentResultTabs,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { NO_PLACES, studentPlaces, studentReaderOf } from '../access/class-scope.js';
import type { Access } from '../access/permission.guard.js';
import { branchOf } from '../classes/classes.service.js';
import { ownStaffOf } from '../journal/attendance-entry.js';
import { decisionOf } from './quarter-decisions.js';
import {
  gridWeights,
  journalRows,
  switchesIn,
  type GridWeights,
  type JournalRow,
} from '../journal/journal-grid.query.js';
import { roleReadingOf, teaches } from '../journal/journal-scope.js';
import { subjectsOf } from '../journal/leaving-results.service.js';
import { countsFromOf, goLiveOf, notInSystem } from '../journal/start-quarter.js';
import { studentRowReading, type StudentRowReading } from '../journal/student-row-reading.js';
import {
  subjectQuarterLessons,
  type StudentSubjectQuarter,
} from '../journal/subject-quarter-lessons.js';
import { notFound } from '../setup/setup-refusals.js';
import { storedRecordsOf } from './stored-records.js';

/**
 * A student's results and attendance on the profile (task 9.1; `08`, Student
 * results; `04`, Profile tabs). Worked out on read, as the grid and the result
 * at leaving are: for each subject and quarter, the student's lessons across
 * the journals that follow the student (`subject-quarter-lessons.ts`; `07`,
 * Transfers) go to `packages/calc`, which gives every figure: the quarter's
 * outcome (`studentQuarterOutcome`, From 4.3), its averages (`quarterResult`),
 * the attendance average (`quarterAttendanceAverage`), the year
 * (`outcomeForYear`, `yearResult`), the percents of the works (`shownPercent`)
 * and the attendance values (`attendanceValue`). Nothing is calculated here.
 *
 * Who reads (decision 4, Look first): the readers of the student's record
 * (`students` `view`, its class scope); each subject and quarter only for a
 * reader of the student's row of the journal of the last membership in the
 * quarter, on its last day capped at today (`studentRowReading`): whole for
 * Results and the works of the lessons, attendance also for the Attendance tab
 * and the marks. A subject the reader may not read is left out, never named.
 * Everything is read through the branch filter of the request. A read writes
 * no audit entry (6.2 decision 17).
 *
 * - A quarter with no held lesson of the subject and no rating entry has no row there
 *   (decision 9).
 * - A graded quarter with no quarterly distribution that fits its switches
 *   (`gridWeights`, decision 13) has no result: the grid shows none either, so
 *   it has no row in Results.
 * - The decision on a flag is the closing checklist's (task 9.2a,
 *   `quarter-decisions.ts`).
 * - Task 9.2b (From 9.1, decision 1, Look first): every figure of a closed quarter is read from
 *   its stored final record (`storedQuarterOutcome`, the averages of a number from it, of
 *   another outcome from the stored inputs), never calculated again; the year result is answered
 *   once the fourth quarter is closed (`08`: "The year result is shown when the fourth quarter
 *   is closed"), or the year; a start quarter closed "not official" is left out of it.
 */

const shown = (value: Fraction | null): number | null =>
  value === null ? null : Number(value.roundHalfUp());

interface YearRow {
  readonly id: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: 'planned' | 'current' | 'closed';
}

interface QuarterRow {
  readonly id: string;
  readonly number: number;
  readonly startDate: string;
  readonly endDate: string;
}

interface Context {
  readonly transaction: Transaction;
  readonly access: Access;
  readonly branchId: string;
  readonly timeZone: string;
  readonly now: Date;
  readonly today: string;
  readonly studentId: string;
  readonly staffId: string | null;
  readonly goLive: string | null;
}

/** One subject in one quarter as the reader may read it. */
interface SubjectQuarter {
  readonly quarter: QuarterRow;
  readonly found: StudentSubjectQuarter;
  readonly journal: JournalRow;
  readonly reading: StudentRowReading;
  readonly attendanceOnly: boolean;
  readonly ratingExam: boolean;
  readonly weights: GridWeights;
}

const yearStatus = (status: string): YearRow['status'] =>
  status === 'closed' ? 'closed' : status === 'current' ? 'current' : 'planned';

/** The day the reading is decided on: the span's last day, capped at today, never before its first. */
const readingDay = (span: { from: string; until: string }, today: string): string =>
  span.until <= today ? span.until : today < span.from ? span.from : today;

@Injectable()
export class StudentResultsService {
  constructor(private readonly transactions: Transactions) {}

  tabs(access: Access, studentId: string): Promise<StudentResultTabs> {
    return this.run(access, studentId, async (context) => {
      // Every year of the branch, so a student with figures only in an earlier year has the
      // tabs too (spec review of the code, should-fix 2).
      const readings: StudentRowReading[] = [];
      for (const year of await yearsOf(context)) {
        readings.push(...(await membershipReadings(context, year)));
        if (readings.includes('whole')) break;
      }
      return studentResultTabsSchema.parse({
        results: readings.includes('whole'),
        attendance: readings.some((one) => one !== null),
      });
    });
  }

  results(access: Access, studentId: string, yearId: string | undefined): Promise<StudentResults> {
    return this.run(access, studentId, async (context) => {
      const year = await yearOf(context, yearId);
      const years = await yearsOf(context);
      if (year === null) {
        return studentResultsSchema.parse({ year, years, quarters: [], subjects: [] });
      }
      const quarters = await quartersOf(context, year.id);
      const closings = await closingsOf(
        context.transaction,
        quarters.map((one) => one.id),
      );
      const fourthClosed = quarters.some((one) => one.number === 4 && closings.has(one.id));
      const subjects = [];
      for (const subjectId of await subjectsOf(context.transaction, studentId, year.id, year)) {
        const rows: unknown[] = [];
        const outcomes = new Map<number, StudentQuarterOutcome>();
        // The year is the mean of every quarter's result (`07`, rule 11): a reader who does
        // not read the subject in each quarter with a result sees no year (review must-fix 1).
        let readsEveryQuarter = true;
        let subject: JournalRow['subject'] | undefined;
        for (const quarter of quarters) {
          const one = await subjectQuarter(context, year, quarter, subjectId);
          if (one === undefined || one.attendanceOnly) continue;
          const quarterly = one.weights.quarterly;
          if (quarterly === null) continue;
          const closing = closings.get(quarter.id);
          const found =
            closing === undefined
              ? { record: undefined, reopened: false }
              : await storedRecordOf(context.transaction, quarter.id, subjectId, studentId);
          const stored = found.record;
          const input = inputOf(
            context,
            one,
            quarterly,
            await decisionOf(context.transaction, quarter.id, subjectId, context.studentId),
            // A journal with an unfinished reopening is read live and provisional (task 9.2c).
            closing !== undefined && !found.reopened,
          );
          const outcome =
            stored === undefined ? studentQuarterOutcome(input) : storedQuarterOutcome(stored);
          outcomes.set(quarter.number, outcome);
          if (one.reading !== 'whole') {
            readsEveryQuarter = false;
            continue;
          }
          const averages =
            outcome.kind === 'number'
              ? outcome.result.averages
              : quarterResult(stored === undefined ? input : storedQuarterInputs(stored)).averages;
          subject = one.journal.subject;
          rows.push({
            quarterId: quarter.id,
            unit: unitOf(one.journal),
            attendance: shown(averages.attendance),
            classwork: shown(averages.classwork),
            homework: shown(averages.homework),
            ratingExam: ratingShownOf(one) ? shown(averages.ratingExam) : null,
            ratingShown: ratingShownOf(one),
            outcome: outcomeShown(outcome),
            basedOn: outcome.basedOn,
            countsFrom: outcome.from,
            leftSubjectOn: outcome.leftSubjectOn,
            atLeaving: outcome.atLeaving,
          });
        }
        if (subject === undefined) continue;
        subjects.push({
          subject: { id: subjectId, names: subject.names, colour: subject.colour },
          quarters: rows,
          year:
            (year.status === 'closed' || fourthClosed) && readsEveryQuarter
              ? yearShown(context.goLive, quarters, outcomes, notOfficialOf(closings))
              : null,
        });
      }
      subjects.sort((a, b) => a.subject.names.en.localeCompare(b.subject.names.en, 'en'));
      return studentResultsSchema.parse({
        year,
        years,
        quarters: quarters.map((quarter) => ({
          ...quarter,
          notInSystem: notInSystem(context.goLive, quarter),
          notOfficial: closings.get(quarter.id)?.startQuarter === 'not_official',
          closed: closings.has(quarter.id),
        })),
        subjects,
      });
    });
  }

  attendance(
    access: Access,
    studentId: string,
    yearId: string | undefined,
  ): Promise<StudentAttendance> {
    return this.run(access, studentId, async (context) => {
      const year = await yearOf(context, yearId);
      const years = await yearsOf(context);
      if (year === null) {
        return studentAttendanceSchema.parse({ year, years, quarters: [], subjects: [] });
      }
      const quarters = await quartersOf(context, year.id);
      const closings = await closingsOf(
        context.transaction,
        quarters.map((one) => one.id),
      );
      const subjects = [];
      for (const subjectId of await subjectsOf(context.transaction, studentId, year.id, year)) {
        const rows: unknown[] = [];
        let subject: JournalRow['subject'] | undefined;
        for (const quarter of quarters) {
          const one = await subjectQuarter(context, year, quarter, subjectId);
          if (one === undefined || one.reading === null) continue;
          subject = one.journal.subject;
          const lessons = one.found.lessons.map((lesson) => lesson.lesson);
          const counts = { present: 0, absent: 0, late: 0, skipped: 0, exempt: 0, unmarked: 0 };
          for (const lesson of lessons) {
            if (lesson.mark === null) counts.unmarked += 1;
            else if (lesson.mark === 1) counts.present += 1;
            else if (lesson.mark === 0) counts.absent += 1;
            else if (lesson.mark === 2) counts.late += 1;
            else if (lesson.mark === 3) counts.skipped += 1;
            else counts.exempt += 1;
          }
          rows.push({
            quarterId: quarter.id,
            unit: unitOf(one.journal),
            attendanceOnly: one.attendanceOnly,
            average: shown(
              quarterAttendanceAverage({ attendanceValues: valuesOf(one.weights), lessons }),
            ),
            counts,
          });
        }
        if (subject === undefined) continue;
        subjects.push({
          subject: { id: subjectId, names: subject.names, colour: subject.colour },
          quarters: rows,
        });
      }
      subjects.sort((a, b) => a.subject.names.en.localeCompare(b.subject.names.en, 'en'));
      return studentAttendanceSchema.parse({
        year,
        years,
        quarters: quarters.map((quarter) => ({
          ...quarter,
          notInSystem: notInSystem(context.goLive, quarter),
          notOfficial: closings.get(quarter.id)?.startQuarter === 'not_official',
          closed: closings.has(quarter.id),
        })),
        subjects,
      });
    });
  }

  lessons(
    access: Access,
    studentId: string,
    subjectId: string,
    quarterId: string,
  ): Promise<StudentResultLessons> {
    return this.run(access, studentId, async (context) => {
      const { transaction } = context;
      const quarter = await transaction
        .selectFrom('quarters')
        .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
        .select([
          'quarters.id',
          'quarters.number',
          sql<string | null>`quarters.start_date::text`.as('start_date'),
          sql<string | null>`quarters.end_date::text`.as('end_date'),
          'academic_years.id as year_id',
          sql<string>`academic_years.start_date::text`.as('year_start'),
          sql<string>`academic_years.end_date::text`.as('year_end'),
          'academic_years.status',
        ])
        .where('quarters.id', '=', quarterId)
        .where('academic_years.branch_id', '=', context.branchId)
        .executeTakeFirst();
      const subject = await transaction
        .selectFrom('subjects')
        .select('id')
        .where('id', '=', subjectId)
        .executeTakeFirst();
      if (
        quarter === undefined ||
        subject === undefined ||
        quarter.start_date === null ||
        quarter.end_date === null
      ) {
        throw notFound();
      }
      const year: YearRow = {
        id: quarter.year_id,
        startDate: quarter.year_start,
        endDate: quarter.year_end,
        status: yearStatus(quarter.status),
      };
      const one = await subjectQuarter(
        context,
        year,
        {
          id: quarter.id,
          number: quarter.number,
          startDate: quarter.start_date,
          endDate: quarter.end_date,
        },
        subjectId,
      );
      // No journal of the subject in the quarter: nothing of it to show. Only a reader of the
      // subject by role learns that (404); anyone else gets the scope refusal it would get for a
      // journal it may not read, so a subject outside the scope tells nothing (.claude/rules/api.md).
      if (one === undefined) {
        const byRole = roleReadingOf(context.access, {
          subjectId,
          classId: null,
          groupClassIds: [],
        });
        if (byRole === null) throw new ApiException('permission_denied', 403);
        throw notFound();
      }
      if (one.reading === null) throw new ApiException('permission_denied', 403);
      const whole = one.reading === 'whole' && !one.attendanceOnly;
      const values = valuesOf(one.weights);
      const unitNames = new Map(one.found.spans.map((span) => [span.journalId, span.unitName]));
      const ratingIn = whole && one.weights.quarterly !== null && ratingShownOf(one);
      return studentResultLessonsSchema.parse({
        subject: {
          id: subjectId,
          names: one.journal.subject.names,
          colour: one.journal.subject.colour,
        },
        quarter: { id: quarter.id, number: quarter.number },
        reading: whole ? 'whole' : 'attendance',
        lessons: one.found.lessons.map((counted) => {
          const { mark } = counted.lesson;
          const value = mark === null ? null : attendanceValue(mark, values);
          const worksOf = (
            works: typeof counted.lesson.classworks,
            columns: typeof counted.classworkColumns,
          ) =>
            !whole
              ? []
              : works.map((work, index) => ({
                  workId: columns[index]?.workId,
                  title: columns[index]?.title ?? null,
                  position: columns[index]?.position ?? index + 1,
                  score: work.score,
                  total: work.total,
                  percent:
                    work.score === null ? null : Number(shownPercent(work.score, work.total)),
                }));
          return {
            lessonId: counted.lessonId,
            date: counted.date,
            unit: { journalId: counted.journalId, name: unitNames.get(counted.journalId) ?? '' },
            mark,
            attendanceValue: value instanceof Fraction ? shown(value) : null,
            classworks: worksOf(counted.lesson.classworks, counted.classworkColumns),
            homeworks: worksOf(counted.lesson.homeworks, counted.homeworkColumns),
          };
        }),
        ratingExam: ratingIn ? one.found.ratingExam : null,
      });
    });
  }

  /** The checks every route makes first: the student of the branch (404), its record's reader (403). */
  private run<T>(
    access: Access,
    studentId: string,
    work: (context: Context) => Promise<T>,
  ): Promise<T> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const student = await transaction
        .selectFrom('students')
        .select('id')
        .where('id', '=', studentId)
        .executeTakeFirst();
      if (student === undefined) throw notFound();
      const branch = await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow();
      const now = await transactionMoment(transaction);
      const today = schoolDateOf(now, branch.time_zone);
      const places = (await studentPlaces(transaction, today, studentId)).get(studentId);
      if (studentReaderOf(access, 'students', places ?? NO_PLACES) === undefined) {
        throw new ApiException('permission_denied', 403);
      }
      return work({
        transaction,
        access,
        branchId,
        timeZone: branch.time_zone,
        now,
        today,
        studentId,
        staffId: teaches(access) ? await ownStaffOf(transaction, access.accountId) : null,
        goLive: await goLiveOf(transaction, branchId),
      });
    });
  }
}

/**
 * The year named (404 when unknown or of another branch); else the current one;
 * else the newest that has started (a year not yet marked current can hold lessons);
 * else `null`.
 */
async function yearOf(context: Context, yearId: string | undefined): Promise<YearRow | null> {
  const years = await yearsOf(context);
  if (yearId !== undefined) {
    const named = years.find((one) => one.id === yearId.toLowerCase());
    if (named === undefined) throw notFound();
    return named;
  }
  return (
    years.find((one) => one.status === 'current') ??
    years.find((one) => one.startDate <= context.today) ??
    null
  );
}

/** The years of the branch, newest first, for the selector. */
async function yearsOf(context: Context): Promise<YearRow[]> {
  const rows = await context.transaction
    .selectFrom('academic_years')
    .select([
      'id',
      'status',
      sql<string>`start_date::text`.as('start_date'),
      sql<string>`end_date::text`.as('end_date'),
    ])
    .where('branch_id', '=', context.branchId)
    .orderBy('start_date', 'desc')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    status: yearStatus(row.status),
  }));
}

/** The quarters of the year with their dates set, in order. */
async function quartersOf(context: Context, yearId: string): Promise<QuarterRow[]> {
  const rows = await context.transaction
    .selectFrom('quarters')
    .select([
      'id',
      'number',
      sql<string | null>`start_date::text`.as('start_date'),
      sql<string | null>`end_date::text`.as('end_date'),
    ])
    .where('academic_year_id', '=', yearId)
    .orderBy('number')
    .execute();
  return rows.flatMap((row) =>
    row.start_date === null || row.end_date === null
      ? []
      : [{ id: row.id, number: row.number, startDate: row.start_date, endDate: row.end_date }],
  );
}

/**
 * The student's lessons of one subject in one quarter with the reader's reading
 * of the journal of the last membership; `undefined` when the student had no
 * journal of it there or no lesson of it was held (decision 9).
 */
async function subjectQuarter(
  context: Context,
  year: YearRow,
  quarter: QuarterRow,
  subjectId: string,
): Promise<SubjectQuarter | undefined> {
  if (quarter.startDate > context.today) return undefined;
  const found = (
    await subjectQuarterLessons(context.transaction, {
      branchId: context.branchId,
      timeZone: context.timeZone,
      now: context.now,
      academicYearId: year.id,
      subjectId,
      quarter,
      studentIds: [context.studentId],
    })
  ).get(context.studentId);
  // A rating entry with no held lesson still makes a result, as the grid shows it.
  if (
    found === undefined ||
    (found.heldInJournals === 0 && found.lessons.length === 0 && found.ratingExam === null)
  ) {
    return undefined;
  }
  const last = found.spans.reduce<(typeof found.spans)[number] | undefined>(
    (latest, span) => (latest === undefined || span.until > latest.until ? span : latest),
    undefined,
  );
  if (last === undefined) return undefined;
  const [journal] = await journalRows(context.transaction, context.branchId, {
    journalId: last.journalId,
  });
  if (journal === undefined) return undefined;
  const switches = switchesIn(journal, quarter.id);
  if (switches === undefined) return undefined;
  const reading = await studentRowReading(context.transaction, context.access, {
    branchId: context.branchId,
    journal,
    studentId: context.studentId,
    day: readingDay(last, context.today),
    staffId: context.staffId,
  });
  return {
    quarter,
    found,
    journal,
    reading,
    attendanceOnly: switches.attendanceOnly,
    ratingExam: switches.ratingExam,
    weights: await gridWeights(context.transaction, context.branchId, subjectId, quarter.id),
  };
}

const valuesOf = (weights: GridWeights) => ({
  lateValue: weights.lateValue,
  skippedValue: weights.skippedValue,
});

/** The quarter has the rating exam part: the switch, and a part in its distribution. */
const ratingShownOf = (one: SubjectQuarter): boolean =>
  one.ratingExam && one.weights.quarterly !== null && one.weights.quarterly.ratingExam !== null;

/** The input of `studentQuarterOutcome`, as the grid and the result at leaving give it. */
function inputOf(
  context: Context,
  one: SubjectQuarter,
  quarterly: NonNullable<GridWeights['quarterly']>,
  decision: FlagDecision | null,
  quarterClosed = false,
): StudentQuarterInput {
  return {
    weights: quarterly,
    attendanceValues: valuesOf(one.weights),
    lessons: one.found.lessons.map((lesson) => lesson.lesson),
    ratingExam: ratingShownOf(one) ? one.found.ratingExam : null,
    quarterClosed,
    heldInJournals: one.found.heldInJournals,
    countsFrom: countsFromOf(context.goLive, one.quarter),
    leftSubjectOn: one.found.leftSubjectOn,
    atLeaving: one.found.atLeaving,
    decision,
  };
}

const unitOf = (journal: JournalRow) => ({
  kind: journal.classId === null ? ('group' as const) : ('class' as const),
  id: journal.classId ?? journal.groupId ?? '',
  name: journal.unitName,
});

function outcomeShown(outcome: StudentQuarterOutcome): QuarterOutcomeShown {
  switch (outcome.kind) {
    case 'number':
      return {
        kind: 'number',
        shown: Number(outcome.result.shown),
        grade: outcome.result.grade,
        provisional: outcome.result.provisional,
        leftOut: outcome.result.leftOut.map((one): JournalPart => one.part),
        flags: [...outcome.flags],
      };
    case 'exempt':
      return { kind: 'exempt' };
    case 'not_assessed':
      return { kind: 'not_assessed' };
    default:
      return { kind: 'no_result' };
  }
}

/**
 * The year result of a subject (`07`, rule 11; `edge/calculation`, the year
 * row): the four quarters through `outcomeForYear`, a quarter ended before
 * the start date as "not in the system" (decision 8), a quarter with no
 * result row (no lesson, attendance only) as "No result".
 */
export function yearShown(
  goLive: string | null,
  quarters: readonly QuarterRow[],
  outcomes: ReadonlyMap<number, StudentQuarterOutcome>,
  notOfficial: ReadonlySet<string> = new Set(),
) {
  const four: QuarterOutcome[] = [1, 2, 3, 4].map((number) => {
    const quarter = quarters.find((one) => one.number === number);
    if (quarter !== undefined && notInSystem(goLive, quarter)) return 'not_in_system';
    // Task 9.2b: `edge/academic-year`, "A 'not official' quarter is left out of the year result".
    if (quarter !== undefined && notOfficial.has(quarter.id)) return 'not_official';
    const outcome = outcomes.get(number);
    return outcome === undefined ? 'no_result' : outcomeForYear(outcome);
  });
  const year = yearResult(four);
  return year.kind === 'no_result'
    ? { kind: 'no_result' as const }
    : {
        kind: 'number' as const,
        shown: Number(year.shown),
        grade: year.grade,
        basedOn: year.basedOn,
      };
}

/**
 * The reader's readings of the student's rows of the journals of the year
 * (for the tabs): each class and group row meeting the year, on its last day
 * capped at today.
 */
async function membershipReadings(context: Context, year: YearRow): Promise<StudentRowReading[]> {
  const { transaction } = context;
  const [classes, groups] = await Promise.all([
    transaction
      .selectFrom('class_memberships')
      .select([
        'class_id as unit_id',
        sql<string>`valid_from::text`.as('valid_from'),
        sql<string>`(valid_until - 1)::text`.as('last_day'),
      ])
      .where('student_id', '=', context.studentId)
      .whereRef('valid_from', '<', 'valid_until')
      .where('valid_from', '<=', year.endDate)
      .where('valid_until', '>', year.startDate)
      .execute(),
    transaction
      .selectFrom('group_memberships')
      .select([
        'group_id as unit_id',
        sql<string>`valid_from::text`.as('valid_from'),
        sql<string>`(valid_until - 1)::text`.as('last_day'),
      ])
      .where('student_id', '=', context.studentId)
      .whereRef('valid_from', '<', 'valid_until')
      .where('valid_from', '<=', year.endDate)
      .where('valid_until', '>', year.startDate)
      .execute(),
  ]);
  const rows = [...classes, ...groups];
  if (rows.length === 0) return [];
  const journals = await journalRows(transaction, context.branchId, { yearId: year.id });
  const readings: StudentRowReading[] = [];
  for (const row of rows) {
    const span = {
      from: row.valid_from < year.startDate ? year.startDate : row.valid_from,
      until: row.last_day > year.endDate ? year.endDate : row.last_day,
    };
    for (const journal of journals) {
      if (journal.classId !== row.unit_id && journal.groupId !== row.unit_id) continue;
      const reading = await studentRowReading(transaction, context.access, {
        branchId: context.branchId,
        journal,
        studentId: context.studentId,
        day: readingDay(span, context.today),
        staffId: context.staffId,
      });
      // A journal attendance only in every quarter has no result to read (decision 10).
      const graded = journal.quarters.some((one) => !one.attendanceOnly);
      const counted = reading === 'whole' && !graded ? 'attendance' : reading;
      readings.push(counted);
      if (counted === 'whole') return readings;
    }
  }
  return readings;
}

/** The closes in force of the quarters given, by quarter (task 9.2b). */
async function closingsOf(
  transaction: Transaction,
  quarterIds: readonly string[],
): Promise<Map<string, { id: string; startQuarter: string | null }>> {
  if (quarterIds.length === 0) return new Map();
  const rows = await transaction
    .selectFrom('quarter_closings')
    .select(['id', 'quarter_id', 'start_quarter'])
    .where('quarter_id', 'in', [...quarterIds])
    .where('reopened_at', 'is', null)
    .where('cause', '=', 'close')
    .execute();
  return new Map(
    rows.map((row) => [row.quarter_id, { id: row.id, startQuarter: row.start_quarter }]),
  );
}

/** The quarters closed "not official" (task 9.2b). */
const notOfficialOf = (
  closings: ReadonlyMap<string, { startQuarter: string | null }>,
): Set<string> =>
  new Set(
    [...closings].flatMap(([quarterId, one]) =>
      one.startQuarter === 'not_official' ? [quarterId] : [],
    ),
  );

/**
 * The final record in force of a student and subject (task 9.2b), as stored (`storedRecordsOf`);
 * `undefined` when the journal it is listed under has an unfinished reopening, which is read live.
 */
async function storedRecordOf(
  transaction: Transaction,
  quarterId: string,
  subjectId: string,
  studentId: string,
): Promise<{ record: unknown; reopened: boolean }> {
  return (
    (await storedRecordsOf(transaction, quarterId, { subjectId, studentId })).get(
      `${subjectId}|${studentId}`,
    ) ?? { record: undefined, reopened: false }
  );
}
