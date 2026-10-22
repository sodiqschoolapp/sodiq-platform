import { Injectable } from '@nestjs/common';
import {
  Fraction,
  groupAverage,
  lessonScore,
  quarterAttendanceAverage,
  quarterResult,
  shownPercent,
  type AttendanceMark,
  type QuarterLesson,
  type QuarterResult,
  type Work,
} from '@sodiq/calc';
import {
  compareStudentNames,
  journalGridSchema,
  journalListSchema,
  lessonStateOf,
  schoolDateOf,
  type JournalBottom,
  type JournalCell,
  type JournalFigures,
  type JournalGrid,
  type JournalGridQuery,
  type JournalList,
  type JournalListQuery,
  type JournalPart,
  type JournalShape,
  type JournalStudent,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { awayLessons } from '../timetable/away-read.js';
import { ownerFactsOf, ownerOn, type OwnerFacts } from '../timetable/journal-owners.js';
import { expectedStudents } from './expected-students.js';
import {
  classesOfStudents,
  gridWeights,
  journalLessons,
  journalRows,
  lessonCells,
  lessonWorks,
  slotNumbers,
  staffNames,
  studentsOf,
  unitMemberships,
  weightsChangedAt,
  type GridLessonRow,
  type GridWeights,
  type GridWorkRow,
  type JournalRow,
  type MembershipRow,
} from './journal-grid.query.js';
import { roleReadingOf, shapeOf, teaches, type JournalScopeKey } from './journal-scope.js';

/**
 * The journal grid, read only (task 6.2, pull request #210; `07`, Opening a
 * journal, Layout, Calculation rules; `edge/calculation`). Every figure comes
 * from `packages/calc` and is sent as shown (decision 7). A read writes no
 * audit entry (decision 17).
 */

const scopeRefusal = () => new ApiException('journal_scope', 403);

const keyOf = (journal: JournalRow): JournalScopeKey => ({
  subjectId: journal.subjectId,
  classId: journal.classId,
  groupClassIds: journal.groupClassIds,
});

const DAY_MS = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The last day of a month `YYYY-MM`. */
function monthEnd(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, number ?? 1, 0)).toISOString().slice(0, 10);
}

const memberOn = (rows: readonly MembershipRow[], date: string): boolean =>
  rows.some((row) => row.validFrom <= date && date < row.validUntil);

/** The reader's own staff record, read through the branch filter. */
async function ownStaff(transaction: Transaction, access: Access): Promise<string | null> {
  const found = await transaction
    .selectFrom('staff')
    .select('id')
    .where('account_id', '=', access.accountId)
    .executeTakeFirst();
  return found?.id ?? null;
}

/** Whether the person owns the journal on some day (a run of theirs, or an acting period). */
function ownsSomeDay(facts: OwnerFacts, journalId: string, staffId: string): boolean {
  return (
    (facts.runs.get(journalId) ?? []).some((run) => !run.vacancy && run.teacherId === staffId) ||
    (facts.periods.get(journalId) ?? []).some((period) => period.personId === staffId)
  );
}

const shown = (value: Fraction | null): number | null =>
  value === null ? null : Number(value.roundHalfUp());

/** The works of a lesson that count: held and with their total set. */
function countedWorks(
  works: readonly GridWorkRow[],
  kind: 'classwork' | 'homework',
  scores: ReadonlyMap<string, number | null>,
): Work[] {
  return works.flatMap((work) =>
    work.kind !== kind || work.notHeld || work.total === null
      ? []
      : [{ total: work.total, score: scores.get(work.id) ?? null }],
  );
}

/** Exact figures of one student kept for the bottom row. */
interface Exact {
  readonly attendance: Fraction | null;
  readonly classwork: Fraction | null;
  readonly homework: Fraction | null;
  readonly ratingExam: Fraction | null;
  readonly result: Fraction | null;
}

const NO_EXACT: Exact = {
  attendance: null,
  classwork: null,
  homework: null,
  ratingExam: null,
  result: null,
};

const weightsTotal100 = (weights: NonNullable<GridWeights['quarterly']>): boolean =>
  weights.attendance + weights.classwork + weights.homework + (weights.ratingExam ?? 0) === 100;

@Injectable()
export class JournalGridReader {
  constructor(private readonly transactions: Transactions) {}

  /** The Journals page: the journals the reader may open in a year (`07`, Opening a journal). */
  list(access: Access, query: JournalListQuery): Promise<JournalList> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await todayOf(transaction, branchId);
      const years = await yearsOf(transaction, branchId);
      let yearId: string | null;
      if (query.yearId !== undefined) {
        if (!years.some((year) => year.id === query.yearId)) throw notFound();
        yearId = query.yearId;
      } else {
        yearId =
          years.find((year) => year.startDate <= today && today <= year.endDate)?.id ??
          years[0]?.id ??
          null;
      }
      const journals =
        yearId === null ? [] : await readableJournals(transaction, access, branchId, yearId);
      return journalListSchema.parse({
        years,
        yearId,
        journals: journals.map(listed),
      });
    });
  }

  /** One journal for one quarter. */
  grid(access: Access, journalId: string, query: JournalGridQuery): Promise<JournalGrid> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, (transaction) =>
      this.gridIn(transaction, access, branchId, journalId, query),
    );
  }

  private async gridIn(
    transaction: Transaction,
    access: Access,
    branchId: string,
    journalId: string,
    query: JournalGridQuery,
  ): Promise<JournalGrid> {
    const [journal] = await journalRows(transaction, branchId, { journalId });
    if (journal === undefined) throw notFound();
    const { timeZone, today, now } = await clockOf(transaction, branchId);
    const years = await yearsOf(transaction, branchId);
    const year = years.find((one) => one.id === journal.academicYearId);
    if (year === undefined) throw notFound();
    const quarters = await transaction
      .selectFrom('quarters')
      .select([
        'id',
        'number',
        sql<string | null>`start_date::text`.as('start_date'),
        sql<string | null>`end_date::text`.as('end_date'),
      ])
      .where('academic_year_id', '=', year.id)
      .orderBy('number')
      .execute();
    const dated = quarters.flatMap((one) =>
      one.start_date === null || one.end_date === null
        ? []
        : [{ id: one.id, number: one.number, startDate: one.start_date, endDate: one.end_date }],
    );
    let quarter: (typeof dated)[number] | undefined;
    if (query.quarterId !== undefined) {
      if (!quarters.some((one) => one.id === query.quarterId)) throw notFound();
      quarter = dated.find((one) => one.id === query.quarterId);
      if (quarter === undefined) throw new ApiException('journal_no_quarter', 409);
    } else {
      quarter =
        dated.find((one) => one.startDate <= today && today <= one.endDate) ??
        dated.find((one) => today < one.startDate) ??
        dated.at(-1);
      if (quarter === undefined) throw new ApiException('journal_no_quarter', 409);
    }
    // edge/00-definitions, Reference date: the quarter's last day, or today while it is open.
    const referenceDate =
      today > quarter.endDate
        ? quarter.endDate
        : today < quarter.startDate
          ? quarter.startDate
          : today;

    // Who reads what (decisions 2, 3 and 20; review correction 1).
    const facts = await ownerFactsOf(transaction, branchId, [
      {
        id: journal.id,
        academic_year_id: journal.academicYearId,
        class_id: journal.classId,
        group_id: journal.groupId,
        subject_id: journal.subjectId,
      },
    ]);
    const runs = facts.runs.get(journal.id) ?? [];
    const periods = facts.periods.get(journal.id) ?? [];
    const owner = ownerOn(runs, periods, facts.out, referenceDate);
    const ownerId = owner === null || owner.kind === 'none' ? null : owner.staffId;
    let reading = roleReadingOf(access, keyOf(journal));
    let ownLessons: ((lesson: GridLessonRow) => boolean) | null = null;
    if (reading?.kind !== 'whole' && teaches(access)) {
      const own = await ownStaff(transaction, access);
      if (own !== null && ownerId === own) {
        reading = { kind: 'whole' };
      } else if (reading === null && own !== null) {
        ownLessons = (lesson) =>
          lesson.teacherId === own ||
          (() => {
            const found = ownerOn(runs, periods, facts.out, lesson.date);
            return found !== null && found.kind !== 'none' && found.staffId === own;
          })();
      }
    }
    if (reading === null && ownLessons === null) throw scopeRefusal();
    const shape: JournalShape = reading === null ? 'lessons' : shapeOf(reading);

    let lessons = await journalLessons(
      transaction,
      journal,
      timeZone,
      quarter.startDate,
      quarter.endDate,
    );
    if (ownLessons !== null) {
      lessons = lessons.filter(ownLessons);
      if (lessons.length === 0) {
        // A lesson reader with no lesson of theirs in this quarter, but some in the year: no
        // lesson to show. With none in the year at all the journal is not theirs.
        const anywhere = await this.ownsAnyLesson(transaction, journal, access, facts);
        if (!anywhere) throw scopeRefusal();
      }
    }
    const lessonIds = lessons.map((one) => one.id);
    const [away, slots, works, cells, expected, memberships, weights, changedAt, names] =
      await Promise.all([
        awayLessons(
          transaction,
          lessons.map((one) => ({ id: one.id, teacherId: one.teacherId, startsAt: one.startsAt })),
        ),
        slotNumbers(
          transaction,
          branchId,
          journal.grades.length === 0 ? undefined : Math.min(...journal.grades),
          lessons,
        ),
        lessonWorks(transaction, lessonIds),
        lessonCells(transaction, lessonIds),
        expectedStudents(transaction, lessonIds),
        unitMemberships(transaction, journal, quarter.startDate, quarter.endDate),
        gridWeights(transaction, branchId, journal.subjectId, quarter.id),
        weightsChangedAt(transaction, branchId, journal.subjectId, quarter.id, timeZone),
        staffNames(transaction, ownerId === null ? [] : [ownerId]),
      ]);

    const held = new Map(
      lessons.map((one) => [
        one.id,
        lessonStateOf(
          {
            startsAt: one.startsAt,
            cancelled: one.cancelCause !== null,
            teacher: one.teacherKind,
            away: away.has(one.id),
          },
          now,
        ) === 'held',
      ]),
    );
    const worksOf = new Map<string, GridWorkRow[]>(lessonIds.map((id) => [id, []]));
    for (const work of works) worksOf.get(work.lessonId)?.push(work);
    const expectedOf = new Map(
      [...expected].map(([lessonId, students]) => [lessonId, new Set(students)]),
    );

    // The students: everyone expected at a lesson of the quarter, and the members on the
    // reference date (07, Layout); the folded section holds those who left or moved.
    const rowsOf = new Map<string, MembershipRow[]>();
    for (const row of memberships) {
      const own = rowsOf.get(row.studentId) ?? [];
      own.push(row);
      rowsOf.set(row.studentId, own);
    }
    const studentIds = new Set<string>();
    for (const students of expected.values()) for (const id of students) studentIds.add(id);
    // A reader of their own lessons only sees the students expected at them (`02`, Teacher:
    // "the students they teach ... and no other student"; permission review, should-fix 1).
    if (shape !== 'lessons') {
      for (const row of memberships)
        if (row.validFrom <= referenceDate) studentIds.add(row.studentId);
    }
    let students = (await studentsOf(transaction, [...studentIds])).sort(compareStudentNames);
    const folded = (studentId: string): boolean => {
      const rows = rowsOf.get(studentId) ?? [];
      return !memberOn(rows, referenceDate) && !rows.some((row) => row.validFrom > referenceDate);
    };

    // A Tutor reading a group journal: own classes' rows only, and no averages while any
    // row of another class is left out (edge/journal).
    let trimmed = false;
    if (reading?.kind === 'tutor') {
      const tutorClasses = reading.classIds;
      const onDates = new Map<string, string[]>();
      for (const student of students) {
        const rows = rowsOf.get(student.id) ?? [];
        const lastDay = rows.reduce(
          (latest, row) =>
            addDays(row.validUntil, -1) > latest ? addDays(row.validUntil, -1) : latest,
          '0000-01-01',
        );
        const on =
          memberOn(rows, referenceDate) || lastDay === '0000-01-01' ? referenceDate : lastDay;
        onDates.set(on, [...(onDates.get(on) ?? []), student.id]);
      }
      const ofOwn = new Set<string>();
      for (const [on, ids] of onDates) {
        const classes = await classesOfStudents(transaction, ids, on);
        for (const id of ids) {
          if ((classes.get(id) ?? []).some((classId) => tutorClasses.has(classId))) ofOwn.add(id);
        }
      }
      trimmed = students.some((student) => !ofOwn.has(student.id));
      students = students.filter((student) => ofOwn.has(student.id));
    }

    const attendanceValues = { lateValue: weights.lateValue, skippedValue: weights.skippedValue };
    const quarterly =
      weights.quarterly !== null && weightsTotal100(weights.quarterly) ? weights.quarterly : null;
    const daily = weights.daily;
    const ratingShown =
      !journal.subject.attendanceOnly &&
      journal.subject.ratingExam &&
      (quarterly?.ratingExam ?? null) !== null;
    const months = [...new Set(lessons.map((one) => one.date.slice(0, 7)))];

    const exactOf = new Map<string, { quarter: Exact; months: Map<string, Exact> }>();
    const gridStudents: JournalStudent[] = students.map((student, index) => {
      const marks = new Map<string, number | null>();
      const scores = new Map<string, number | null>();
      for (const cell of cells) {
        if (cell.studentId !== student.id) continue;
        if (cell.workId === null) marks.set(cell.lessonId, cell.mark);
        else scores.set(cell.workId, cell.score);
      }
      const gridCells: JournalCell[] = lessons.map((lesson) => {
        const isExpected = expectedOf.get(lesson.id)?.has(student.id) ?? false;
        const lessonWorksOf = worksOf.get(lesson.id) ?? [];
        const mark = marks.get(lesson.id) ?? null;
        let score: number | null = null;
        if (
          shape !== 'attendance' &&
          !journal.subject.attendanceOnly &&
          daily !== null &&
          lesson.cancelCause === null &&
          isExpected
        ) {
          const found = lessonScore({
            weights: daily,
            mark: mark as AttendanceMark | null,
            attendanceValues,
            classworks: countedWorks(lessonWorksOf, 'classwork', scores),
            homeworks: countedWorks(lessonWorksOf, 'homework', scores),
          });
          score = found.kind === 'score' ? Number(found.value.roundHalfUp()) : null;
        }
        return {
          closed: !isExpected || lesson.startsAt.getTime() > now.getTime(),
          mark,
          works:
            shape === 'attendance'
              ? []
              : lessonWorksOf.map((work) => {
                  const typed = scores.get(work.id) ?? null;
                  return {
                    score: typed,
                    percent:
                      typed === null || work.total === null
                        ? null
                        : Number(shownPercent(typed, work.total)),
                  };
                }),
          score,
        };
      });

      const countedLessons = (inMonth: string | null): QuarterLesson[] =>
        lessons.flatMap((lesson) =>
          held.get(lesson.id) === true &&
          (expectedOf.get(lesson.id)?.has(student.id) ?? false) &&
          (inMonth === null || lesson.date.startsWith(inMonth))
            ? [
                {
                  mark: (marks.get(lesson.id) ?? null) as AttendanceMark | null,
                  classworks: countedWorks(worksOf.get(lesson.id) ?? [], 'classwork', scores),
                  homeworks: countedWorks(worksOf.get(lesson.id) ?? [], 'homework', scores),
                },
              ]
            : [],
        );

      const figuresOf = (inMonth: string | null): { figures: JournalFigures; exact: Exact } => {
        const counted = countedLessons(inMonth);
        if (journal.subject.attendanceOnly || quarterly === null || shape === 'attendance') {
          const attendance = quarterAttendanceAverage({ attendanceValues, lessons: counted });
          return {
            figures: {
              attendance: shown(attendance),
              classwork: null,
              homework: null,
              ratingExam: null,
              result: null,
            },
            exact: { ...NO_EXACT, attendance },
          };
        }
        const result: QuarterResult = quarterResult({
          weights: quarterly,
          attendanceValues,
          lessons: counted,
          // The rating exam is stored from 8.2 on (decision 9); a month leaves it out (From 4.3).
          ratingExam: null,
          quarterClosed: false,
        });
        const { averages } = result;
        const figures: JournalFigures = {
          attendance: shown(averages.attendance),
          classwork: shown(averages.classwork),
          homework: shown(averages.homework),
          ratingExam: ratingShown ? shown(averages.ratingExam) : null,
          result:
            result.kind === 'no_result'
              ? { kind: 'no_result' }
              : (() => {
                  // A month leaves the rating exam out by the rule itself, labelled so,
                  // never provisional for it (decision 23).
                  const leftOut = result.leftOut.filter(
                    (one) => inMonth === null || one.part !== 'ratingExam',
                  );
                  return {
                    kind: 'number' as const,
                    shown: Number(result.shown),
                    grade: result.grade,
                    provisional:
                      inMonth === null
                        ? result.provisional
                        : leftOut.some((one) => one.reason === 'no_data'),
                    leftOut: leftOut.map((one): JournalPart => one.part),
                  };
                })(),
        };
        return {
          figures,
          exact: {
            ...averages,
            result: result.kind === 'number' ? result.value : null,
          },
        };
      };

      let quarterFigures: JournalFigures | null = null;
      let monthFigures: Record<string, JournalFigures> | null = null;
      if (shape !== 'lessons') {
        const whole = figuresOf(null);
        quarterFigures = whole.figures;
        monthFigures = {};
        const exactMonths = new Map<string, Exact>();
        for (const month of months) {
          const found = figuresOf(month);
          monthFigures[month] = found.figures;
          exactMonths.set(month, found.exact);
        }
        exactOf.set(student.id, { quarter: whole.exact, months: exactMonths });
      }
      return {
        id: student.id,
        number: index + 1,
        firstName: student.firstName,
        lastName: student.lastName,
        paternalName: student.paternalName,
        uid: student.uid,
        folded: folded(student.id),
        cells: gridCells,
        quarter: quarterFigures,
        months: monthFigures,
      };
    });

    // The bottom row (07, Layout; edge/calculation, week 6; decision 5): the members on the
    // reference date, each once, over those with a number.
    const bottomOf = (
      pick: (exact: { quarter: Exact; months: Map<string, Exact> }) => Exact | undefined,
      on: string,
    ): JournalBottom => {
      const counted = students
        .filter((student) => memberOn(rowsOf.get(student.id) ?? [], on))
        .flatMap((student) => {
          const found = exactOf.get(student.id);
          const exact = found === undefined ? undefined : pick(found);
          return exact === undefined ? [] : [exact];
        });
      const average = (part: keyof Exact): number | null => {
        const found = groupAverage(
          counted.flatMap((one) => (one[part] === null ? [] : [one[part]])),
        );
        return found === null ? null : Number(found.shown);
      };
      return {
        attendance: average('attendance'),
        classwork: average('classwork'),
        homework: average('homework'),
        ratingExam: ratingShown ? average('ratingExam') : null,
        result: average('result'),
      };
    };
    const bottom =
      shape === 'lessons' || trimmed
        ? null
        : {
            quarter: bottomOf((exact) => exact.quarter, referenceDate),
            months: Object.fromEntries(
              months.map((month) => {
                const end = monthEnd(month);
                const on = today < end ? (today < `${month}-01` ? `${month}-01` : today) : end;
                return [month, bottomOf((exact) => exact.months.get(month), on)];
              }),
            ),
          };

    const others = (await readableJournals(transaction, access, branchId, year.id)).map(listed);
    return journalGridSchema.parse({
      journal: {
        id: journal.id,
        unit: unitOf(journal),
        subject: subjectOf(journal),
        year,
        attendanceOnly: journal.subject.attendanceOnly,
        ratingExam: ratingShown,
      },
      others,
      quarters: quarters.map((one) => ({
        id: one.id,
        number: one.number,
        startDate: one.start_date,
        endDate: one.end_date,
      })),
      quarter,
      today,
      referenceDate,
      teacher: ownerId === null ? null : { id: ownerId, name: names.get(ownerId) ?? '' },
      shape,
      months,
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        date: lesson.date,
        start: lesson.start,
        end: lesson.end,
        slot: slots.get(lesson.id) ?? null,
        held: held.get(lesson.id) === true,
        cancelled:
          lesson.cancelCause === null
            ? null
            : { cause: lesson.cancelCause, reason: lesson.cancelReason },
        month: lesson.date.slice(0, 7),
        works:
          shape === 'attendance'
            ? []
            : (() => {
                const counts = { classwork: 0, homework: 0 };
                return (worksOf.get(lesson.id) ?? []).map((work) => {
                  counts[work.kind] += 1;
                  return {
                    id: work.id,
                    kind: work.kind,
                    position: counts[work.kind],
                    total: work.total,
                    notHeld: work.notHeld,
                  };
                });
              })(),
      })),
      students: gridStudents,
      bottom,
      legend: {
        lateValue: weights.lateValue,
        skippedValue: weights.skippedValue,
        daily: journal.subject.attendanceOnly ? null : weights.daily,
        quarterly: journal.subject.attendanceOnly ? null : weights.quarterly,
        weightsChangedOn:
          changedAt !== null && changedAt > quarter.startDate && !journal.subject.attendanceOnly
            ? changedAt
            : null,
      },
    });
  }

  /** Whether the reader taught or owned a lesson of the journal in its year. */
  private async ownsAnyLesson(
    transaction: Transaction,
    journal: JournalRow,
    access: Access,
    facts: OwnerFacts,
  ): Promise<boolean> {
    const own = await ownStaff(transaction, access);
    if (own === null) return false;
    if (ownsSomeDay(facts, journal.id, own)) return true;
    const year = await transaction
      .selectFrom('academic_years')
      .select([sql<string>`start_date::text`.as('start'), sql<string>`end_date::text`.as('end')])
      .where('id', '=', journal.academicYearId)
      .executeTakeFirstOrThrow();
    let query = transaction
      .selectFrom('lessons')
      .select('id')
      .where('teacher_id', '=', own)
      .where('subject_id', '=', journal.subjectId)
      .where('lesson_date', '>=', year.start)
      .where('lesson_date', '<=', year.end);
    query =
      journal.classId === null
        ? query.where('group_id', '=', journal.groupId)
        : query.where('class_id', '=', journal.classId);
    return (await query.limit(1).executeTakeFirst()) !== undefined;
  }
}

const unitOf = (journal: JournalRow) => ({
  kind: journal.classId === null ? ('group' as const) : ('class' as const),
  id: journal.classId ?? journal.groupId ?? '',
  name: journal.unitName,
});

const subjectOf = (journal: JournalRow) => ({
  id: journal.subjectId,
  names: journal.subject.names,
  colour: journal.subject.colour,
});

const listed = (journal: JournalRow) => ({
  id: journal.id,
  unit: unitOf(journal),
  subject: subjectOf(journal),
});

async function clockOf(
  transaction: Transaction,
  branchId: string,
): Promise<{ timeZone: string; today: string; now: Date }> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const now = await transactionMoment(transaction);
  return { timeZone: branch.time_zone, today: schoolDateOf(now, branch.time_zone), now };
}

async function todayOf(transaction: Transaction, branchId: string): Promise<string> {
  return (await clockOf(transaction, branchId)).today;
}

async function yearsOf(transaction: Transaction, branchId: string) {
  const rows = await transaction
    .selectFrom('academic_years')
    .select([
      'id',
      sql<string>`start_date::text`.as('start_date'),
      sql<string>`end_date::text`.as('end_date'),
      'status',
    ])
    .where('branch_id', '=', branchId)
    .orderBy('start_date', 'desc')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    closed: row.status === 'closed',
  }));
}

/**
 * The journals of a year the reader may open (decisions 2, 3 and 20): by role
 * (`roleReadingOf`), and for a Teacher those they own on some day of the year
 * or taught a lesson of. In unit and subject order.
 */
async function readableJournals(
  transaction: Transaction,
  access: Access,
  branchId: string,
  yearId: string,
): Promise<JournalRow[]> {
  const journals = await journalRows(transaction, branchId, { yearId });
  const byRole = journals.filter((journal) => roleReadingOf(access, keyOf(journal)) !== null);
  let readable = byRole;
  if (teaches(access) && byRole.length < journals.length) {
    const own = await ownStaff(transaction, access);
    if (own !== null) {
      const rest = journals.filter((journal) => !byRole.includes(journal));
      const facts = await ownerFactsOf(
        transaction,
        branchId,
        rest.map((journal) => ({
          id: journal.id,
          academic_year_id: journal.academicYearId,
          class_id: journal.classId,
          group_id: journal.groupId,
          subject_id: journal.subjectId,
        })),
      );
      const year = await transaction
        .selectFrom('academic_years')
        .select([sql<string>`start_date::text`.as('start'), sql<string>`end_date::text`.as('end')])
        .where('id', '=', yearId)
        .executeTakeFirstOrThrow();
      const taught = await transaction
        .selectFrom('lessons')
        .select(['class_id', 'group_id', 'subject_id'])
        .distinct()
        .where('teacher_id', '=', own)
        .where('lesson_date', '>=', year.start)
        .where('lesson_date', '<=', year.end)
        .execute();
      const taughtKeys = new Set(
        taught.map((one) => `${one.class_id ?? ''}|${one.group_id ?? ''}|${one.subject_id}`),
      );
      const ownJournals = rest.filter(
        (journal) =>
          ownsSomeDay(facts, journal.id, own) ||
          taughtKeys.has(`${journal.classId ?? ''}|${journal.groupId ?? ''}|${journal.subjectId}`),
      );
      readable = journals.filter(
        (journal) => byRole.includes(journal) || ownJournals.includes(journal),
      );
    }
  }
  return readable.sort(
    (a, b) =>
      Number(a.classId === null) - Number(b.classId === null) ||
      (a.grades[0] ?? 0) - (b.grades[0] ?? 0) ||
      a.unitName.localeCompare(b.unitName, 'en') ||
      a.subject.names.en.localeCompare(b.subject.names.en, 'en'),
  );
}
