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
  type RatingExamEntry,
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
import { entersByRole, ownStaffOf, teachesOrOwns } from './attendance-entry.js';
import { namedAccounts } from './cell-lines.query.js';
import { expectedStudents } from './expected-students.js';
import { journalColumns } from './journal-works.query.js';
import type { Column } from './lesson-columns.js';
import {
  classesOfStudents,
  gridWeights,
  absenceCategories,
  journalLessons,
  journalRows,
  lessonCells,
  slotNumbers,
  staffNames,
  studentsOf,
  unitMemberships,
  weightsChangedAt,
  type GridLessonRow,
  type GridWorkRow,
  type JournalRow,
  type MembershipRow,
  switchesIn,
  attendanceOnlyOn,
} from './journal-grid.query.js';
import { gridComments } from './comments.query.js';
import { ratingExamOf, ratingRightsOf } from './rating.js';
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

  /**
   * What the reader's grid shows of a student's cells in a lesson (task 6.3,
   * decision 16, review correction 3): the shape of the grid of the lesson's
   * journal and quarter when it shows that lesson and that student, else
   * `null`. The cell history answers through it, so it reads what the grid
   * reads and no more.
   */
  async cellShapeIn(
    transaction: Transaction,
    access: Access,
    branchId: string,
    lessonId: string,
    studentId: string,
  ): Promise<JournalShape | null> {
    const lesson = await transaction
      .selectFrom('lessons')
      .select([sql<string>`lesson_date::text`.as('date'), 'class_id', 'group_id', 'subject_id'])
      .where('id', '=', lessonId)
      .executeTakeFirstOrThrow();
    let journals = transaction
      .selectFrom('journals')
      .select(['id', 'academic_year_id'])
      .where('branch_id', '=', branchId)
      .where('subject_id', '=', lesson.subject_id);
    journals =
      lesson.class_id === null
        ? journals.where('group_id', '=', lesson.group_id ?? '')
        : journals.where('class_id', '=', lesson.class_id);
    const journal = await journals.executeTakeFirst();
    if (journal === undefined) return null;
    const quarter = await transaction
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', journal.academic_year_id)
      .where('start_date', '<=', lesson.date)
      .where('end_date', '>=', lesson.date)
      .executeTakeFirst();
    if (quarter === undefined) return null;
    let grid: JournalGrid;
    try {
      grid = await this.gridIn(transaction, access, branchId, journal.id, {
        quarterId: quarter.id,
      });
    } catch (error) {
      if (error instanceof ApiException && error.code === 'journal_scope') return null;
      throw error;
    }
    const shows =
      grid.lessons.some((one) => one.id === lessonId) &&
      grid.students.some((one) => one.id === studentId);
    return shows ? grid.shape : null;
  }

  /**
   * Whether the reader sees the rating exam of a journal in a quarter with the
   * student's row (task 8.2): the history of a rating entry and of its comment
   * is read with the grid's scope, as `cellShapeIn` reads a cell's.
   */
  async ratingShownIn(
    transaction: Transaction,
    access: Access,
    branchId: string,
    journalId: string,
    quarterId: string,
    studentId: string,
  ): Promise<boolean> {
    let grid: JournalGrid;
    try {
      grid = await this.gridIn(transaction, access, branchId, journalId, { quarterId });
    } catch (error) {
      if (
        error instanceof ApiException &&
        (error.code === 'journal_scope' || error.code === 'journal_no_quarter')
      ) {
        return false;
      }
      throw error;
    }
    return grid.rating !== null && grid.students.some((one) => one.id === studentId);
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
        journalColumns(transaction, journal, timeZone, now),
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
    // Task 8.1: the columns of each lesson (`lesson-columns.ts`); a column with no row has no number.
    const columnsOf = new Map(lessonIds.map((id) => [id, works.columns.get(id) ?? null] as const));
    const worksOf = new Map<string, GridWorkRow[]>(
      lessonIds.map((id) => [
        id,
        (columnsOf.get(id)?.columns ?? []).map((column) => ({
          id: column.workId ?? '',
          lessonId: id,
          kind: column.kind,
          total: column.total,
          notHeld: column.notHeld,
        })),
      ]),
    );
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
    // The database keeps the quarterly weights at a total of 100 (0020).
    const quarterly = weights.quarterly;
    const daily = weights.daily;
    // Task 8.2 (From 2.1 and 5.5c): the switches of the quarter shown.
    const quarterSwitches = switchesIn(journal, quarter.id);
    const attendanceOnly = quarterSwitches?.attendanceOnly ?? true;
    const ratingOn = !attendanceOnly && quarterSwitches?.ratingExam === true;
    const ratingShown = ratingOn && (quarterly?.ratingExam ?? null) !== null;
    // The rating exam of the quarter (task 8.2) for a reader of the whole journal.
    const ratingStaffId = await ownStaffOf(transaction, access.accountId);
    const rating =
      shape !== 'whole'
        ? null
        : await ratingExamOf(transaction, {
            journal,
            quarterId: quarter.id,
            rights: ratingRightsOf(access, branchId, {
              journal,
              facts,
              staffId: ratingStaffId,
              today,
            }),
            today,
            studentIds: students.map((student) => student.id),
          });
    /** The student's rating entry as `packages/calc` takes it (`null` while empty). */
    const ratingEntryOf = (studentId: string): RatingExamEntry | null => {
      if (rating === null || !ratingShown) return null;
      if (rating.notHeld) return { kind: 'not_held' };
      return rating.entries.find((one) => one.studentId === studentId)?.entry ?? null;
    };
    const comments = await gridComments(transaction, {
      studentIds: students.map((student) => student.id),
      lessonIds: lessons.map((lesson) => lesson.id),
      // The rating comments only while the grid shows the rating exam.
      ratingExamId:
        rating === null || !ratingShown
          ? null
          : ((await this.ratingIdOf(transaction, journal.id, quarter.id)) ?? null),
      shape,
    });
    const months = [...new Set(lessons.map((one) => one.date.slice(0, 7)))];

    const exactOf = new Map<string, { quarter: Exact; months: Map<string, Exact> }>();
    // Who typed each attendance cell (task 6.3, decision 16).
    const typists = await namedAccounts(
      transaction,
      cells.flatMap((cell) => (cell.workId === null ? [cell.changedBy] : [])),
    );
    const gridStudents: JournalStudent[] = students.map((student, index) => {
      const marks = new Map<string, number | null>();
      const scoreVersions = new Map<string, number>();
      const attendanceCells = new Map<string, { version: number; typedBy: string | null }>();
      const scores = new Map<string, number | null>();
      for (const cell of cells) {
        if (cell.studentId !== student.id) continue;
        if (cell.workId === null) {
          marks.set(cell.lessonId, cell.mark);
          const typist = typists.get(cell.changedBy);
          attendanceCells.set(cell.lessonId, {
            version: cell.version,
            typedBy: typist?.name ?? typist?.login ?? null,
          });
        } else {
          scores.set(cell.workId, cell.score);
          scoreVersions.set(cell.workId, cell.version);
        }
      }
      const gridCells: JournalCell[] = lessons.map((lesson) => {
        const isExpected = expectedOf.get(lesson.id)?.has(student.id) ?? false;
        const lessonWorksOf = worksOf.get(lesson.id) ?? [];
        const mark = marks.get(lesson.id) ?? null;
        let score: number | null = null;
        if (
          shape !== 'attendance' &&
          !attendanceOnly &&
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
          version: attendanceCells.get(lesson.id)?.version ?? null,
          typedBy: attendanceCells.get(lesson.id)?.typedBy ?? null,
          works:
            shape === 'attendance'
              ? []
              : lessonWorksOf.map((work) => {
                  const typed = work.id === '' ? null : (scores.get(work.id) ?? null);
                  return {
                    score: typed,
                    percent:
                      typed === null || work.total === null
                        ? null
                        : Number(shownPercent(typed, work.total)),
                    version: work.id === '' ? null : (scoreVersions.get(work.id) ?? null),
                    // edge/journal: "marked 'score on an absent student'".
                    onAbsent: typed !== null && (mark === 0 || mark === 3),
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
        if (attendanceOnly || quarterly === null || shape === 'attendance') {
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
          // Task 8.2: the student's entry; a month leaves it out (From 4.3).
          ratingExam: inMonth === null ? ratingEntryOf(student.id) : null,
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
        comments: comments.filter((one) => one.studentId === student.id),
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

    // Entry (task 6.3, decisions 1, 3 and 15): a held lesson the reader teaches or owns,
    // with a role that enters; the routes decide the same way.
    const entering = entersByRole(access, branchId);
    const staffId = entering ? await ownStaffOf(transaction, access.accountId) : null;
    // Task 8.1: works and numbers on a graded subject with a journal teacher that day (From 5.7a-3c).
    const worksTaken = (lesson: GridLessonRow): boolean => {
      if (attendanceOnlyOn(journal, lesson.date)) return false;
      const found = ownerOn(runs, periods, facts.out, lesson.date);
      return found === null || found.kind !== 'none';
    };
    const lastTotal = await lastTotalOf(transaction, access.accountId, works.lessons);
    const canEnter = (lesson: GridLessonRow): boolean =>
      entering &&
      held.get(lesson.id) === true &&
      teachesOrOwns(
        { date: lesson.date, teacherId: lesson.teacherId, journalId: journal.id },
        facts,
        staffId,
        today,
      );
    // The categories of absence of the students shown (decision 7), on the dates of the shown
    // lessons each student is expected at (permission review of the code, should-fix 4).
    const expectedOn = new Set(
      lessons.flatMap((lesson) =>
        [...(expectedOf.get(lesson.id) ?? [])].map((studentId) => `${studentId}|${lesson.date}`),
      ),
    );
    const absences = (
      await absenceCategories(
        transaction,
        students.map((student) => student.id),
        quarter.startDate,
        quarter.endDate,
      )
    ).filter((one) => expectedOn.has(`${one.studentId}|${one.date}`));

    const others = (await readableJournals(transaction, access, branchId, year.id)).map(listed);
    return journalGridSchema.parse({
      journal: {
        id: journal.id,
        unit: unitOf(journal),
        subject: subjectOf(journal),
        year,
        attendanceOnly,
        ratingExam: ratingShown,
      },
      rating: ratingShown ? rating : null,
      others,
      years,
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
        canEnter: canEnter(lesson),
        canEnterWorks: canEnter(lesson) && worksTaken(lesson),
        planItem: columnsOf.get(lesson.id)?.planItem ?? false,
        works:
          shape === 'attendance' ? [] : (columnsOf.get(lesson.id)?.columns ?? []).map(gridWork),
        notHeldWorks:
          shape === 'attendance' ? [] : (columnsOf.get(lesson.id)?.notHeld ?? []).map(gridWork),
        given:
          shape === 'attendance'
            ? []
            : (columnsOf.get(lesson.id)?.given ?? []).map((one) => ({
                title: one.title,
                checkAt: one.checkAt,
                ungraded: one.ungraded,
              })),
      })),
      students: gridStudents,
      lastTotal,
      bottom,
      absences,
      legend: {
        lateValue: weights.lateValue,
        skippedValue: weights.skippedValue,
        daily: attendanceOnly ? null : weights.daily,
        quarterly: attendanceOnly ? null : weights.quarterly,
        weightsChangedOn:
          changedAt !== null && changedAt > quarter.startDate && !attendanceOnly ? changedAt : null,
      },
    });
  }

  /** The id of the stored rating exam row of the journal and quarter, if any. */
  private async ratingIdOf(
    transaction: Transaction,
    journalId: string,
    quarterId: string,
  ): Promise<string | undefined> {
    const row = await transaction
      .selectFrom('journal_rating_exams')
      .select('id')
      .where('journal_id', '=', journalId)
      .where('quarter_id', '=', quarterId)
      .executeTakeFirst();
    return row?.id;
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

/** A column as the grid sends it (task 8.1). */
function gridWork(column: Column) {
  return {
    id: column.workId,
    planWorkId: column.planWorkId,
    sourceLessonId: column.sourceLessonId,
    kind: column.kind,
    position: column.position,
    title: column.title,
    unplanned: column.unplanned,
    total: column.total,
    notHeld: column.notHeld,
    carriedFrom: column.carriedFrom,
    version: column.version,
  };
}

/**
 * The last total the reader set in this journal (`07`: "The last total the
 * teacher used in that journal is offered for the next work"; decision 9),
 * from the work history of the journal's lessons in its year.
 */
async function lastTotalOf(
  transaction: Transaction,
  accountId: string,
  yearLessons: readonly GridLessonRow[],
): Promise<number | null> {
  if (yearLessons.length === 0) return null;
  const found = await transaction
    .selectFrom('journal_work_history')
    .select('total_after')
    .where('changed_by', '=', accountId)
    .where('total_after', 'is not', null)
    .where((eb) => eb('total_after', 'is distinct from', eb.ref('total_before')))
    .where(
      'lesson_id',
      'in',
      yearLessons.map((one) => one.id),
    )
    .orderBy('changed_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return found?.total_after ?? null;
}
