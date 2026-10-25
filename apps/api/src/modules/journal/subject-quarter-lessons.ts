import type { AttendanceMark, QuarterLesson, RatingExamEntry, Work } from '@sodiq/calc';
import { lessonStateOf, type CarriedIn, type ExemptionKind } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { awayLessons } from '../timetable/away-read.js';
import { exemptionMarksOf } from './exemption-read.js';
import { expectedStudents } from './expected-students.js';
import {
  journalRows,
  lessonCells,
  type GridCellRow,
  type GridWorkRow,
  type JournalRow,
} from './journal-grid.query.js';
import { journalColumns } from './journal-works.query.js';
import { entryOf } from './rating.js';

/**
 * A student's lessons of one subject in one quarter across journals (task
 * 8.6, pull request #224; `07`, Transfers: "Results follow the student. The
 * quarter result in a subject uses all of the student's lessons in that
 * subject during the quarter, from the old and the new class or group";
 * `edge/calculation`, the few-lessons, at leaving, week 6, left the subject,
 * between branches and left and came back rows).
 *
 * The journals that follow the student are the class and group journals of
 * the same subject in the same branch and academic year the student was a
 * member of in the quarter (decision 1, Look first): read through the branch
 * filter of the transaction, so a move between branches never merges. No
 * calculation here: the lessons go to `packages/calc` as the grid sends its
 * own (`countedLessons` of `journal-grid.service.ts`): a held lesson where
 * the student is expected, or exempt as mark 4 or 5 with no number (task 8.5).
 *
 * - N (`heldInJournals`, 4.3 decision 10): for each school day of the
 *   quarter, the held lessons of the journal the student belonged to that
 *   day; before the first membership and in a gap, the journal of the next
 *   membership; after leaving the subject or the branch, none.
 * - `atLeaving`: the last day of the student's last class row of the branch
 *   that ends inside the quarter by a leaving or a branch move, with no class
 *   row of the branch after it in the quarter (a student who came back has
 *   none: `edge/calculation`, left and came back).
 * - `leftSubjectOn` (decision 2, Look first): the last day of the student's
 *   last membership of the subject in the quarter, when it ends inside the
 *   quarter while the student stays active in the branch (a class row the
 *   day after it) with no later journal of the subject; `atLeaving` wins
 *   (4.3 decision 12).
 */

/** A membership of a journal of the subject, within the quarter (both days included). */
export interface SubjectSpan {
  readonly journalId: string;
  readonly unitName: string;
  readonly from: string;
  readonly until: string;
}

/** A counted work's column: its row, title and place among its kind in the lesson. */
export interface CountedWork {
  readonly workId: string;
  readonly title: string | null;
  readonly position: number;
}

/** One lesson counted for the student, with its journal and date (for the month figures). */
export interface CountedLesson {
  readonly journalId: string;
  readonly lessonId: string;
  readonly date: string;
  readonly lesson: QuarterLesson;
  /** The work of each of `lesson.classworks` and `lesson.homeworks`, in order (task 9.1, the trace). */
  readonly classworkColumns: readonly CountedWork[];
  readonly homeworkColumns: readonly CountedWork[];
}

export interface StudentSubjectQuarter {
  readonly studentId: string;
  /** The held lessons where the student is expected or exempt, across journals, in date order. */
  readonly lessons: readonly CountedLesson[];
  /** N of `studentQuarterOutcome`, for the whole quarter. */
  readonly heldInJournals: number;
  readonly spans: readonly SubjectSpan[];
  /**
   * The student's rating entry of the quarter: from the journal of the latest
   * membership whose exam is marked "not held" or holds an entry of the
   * student, so that every journal shows the same full result; `null` when none.
   */
  readonly ratingExam: RatingExamEntry | null;
  readonly leftSubjectOn: string | null;
  readonly atLeaving: string | null;
}

/** What the caller already read of one journal of the quarter (the grid's own). */
export interface KnownJournal {
  readonly journal: JournalRow;
  readonly lessons: readonly { readonly id: string; readonly date: string }[];
  readonly held: ReadonlyMap<string, boolean>;
  readonly worksOf: ReadonlyMap<string, readonly GridWorkRow[]>;
  readonly cells: readonly GridCellRow[];
  readonly expected: ReadonlyMap<string, ReadonlySet<string>>;
  readonly exempt: ReadonlyMap<string, ReadonlyMap<string, ExemptionKind>>;
}

const DAY_MS = 86_400_000;

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The work rows of a lesson that count: held and with their total set (as the grid's `countedWorks`). */
const countedWorkRows = (
  works: readonly GridWorkRow[],
  kind: 'classwork' | 'homework',
): (GridWorkRow & { readonly total: number })[] =>
  works.filter(
    (work): work is GridWorkRow & { readonly total: number } =>
      work.kind === kind && !work.notHeld && work.total !== null,
  );

const columnOf = (work: GridWorkRow, index: number): CountedWork => ({
  workId: work.id,
  title: work.title ?? null,
  position: work.position ?? index + 1,
});

/** The counted works as `packages/calc` takes them, in the order of `countedWorkRows` (the trace pairs them). */
function countedWorks(
  works: readonly GridWorkRow[],
  kind: 'classwork' | 'homework',
  scores: ReadonlyMap<string, number | null>,
): Work[] {
  return countedWorkRows(works, kind).map((work) => ({
    total: work.total,
    score: scores.get(work.id) ?? null,
  }));
}

interface MemberRow {
  readonly studentId: string;
  readonly unitId: string;
  readonly from: string;
  /** Exclusive. */
  readonly until: string;
  readonly endedBy: string | null;
}

/** A journal's quarter as this reader counts it. */
type JournalData = KnownJournal;

/** The held lessons, works, cells, expected and exempt students of one journal in the quarter. */
async function journalData(
  transaction: Transaction,
  journal: JournalRow,
  timeZone: string,
  now: Date,
  quarter: { readonly startDate: string; readonly endDate: string },
  studentIds: readonly string[],
): Promise<JournalData> {
  const columns = await journalColumns(transaction, journal, timeZone, now);
  const lessons = columns.lessons.filter(
    (one) => one.date >= quarter.startDate && one.date <= quarter.endDate,
  );
  const lessonIds = lessons.map((one) => one.id);
  const [away, cells, expected, exempt] = await Promise.all([
    awayLessons(
      transaction,
      lessons.map((one) => ({ id: one.id, teacherId: one.teacherId, startsAt: one.startsAt })),
    ),
    lessonCells(transaction, lessonIds),
    expectedStudents(transaction, lessonIds),
    exemptionMarksOf(transaction, lessonIds),
  ]);
  const wanted = new Set(studentIds);
  return {
    journal,
    lessons: lessons.map((one) => ({ id: one.id, date: one.date })),
    held: new Map(
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
    ),
    worksOf: new Map(
      lessonIds.map((id) => [
        id,
        (columns.columns.get(id)?.columns ?? []).map((column) => ({
          id: column.workId ?? '',
          lessonId: id,
          kind: column.kind,
          total: column.total,
          notHeld: column.notHeld,
          title: column.title,
          position: column.position,
        })),
      ]),
    ),
    cells: cells.filter((cell) => wanted.has(cell.studentId)),
    expected: new Map([...expected].map(([id, students]) => [id, new Set(students)])),
    exempt,
  };
}

/** The class and group rows with days of the students that meet the quarter. */
async function memberRows(
  transaction: Transaction,
  studentIds: readonly string[],
  quarter: { readonly startDate: string; readonly endDate: string },
  subjectId: string,
): Promise<{ classRows: MemberRow[]; groupRows: MemberRow[] }> {
  const [classes, groups] = await Promise.all([
    transaction
      .selectFrom('class_memberships')
      .select([
        'student_id',
        'class_id',
        sql<string>`valid_from::text`.as('valid_from'),
        sql<string>`valid_until::text`.as('valid_until'),
        'ended_by',
      ])
      .where('student_id', 'in', [...studentIds])
      .whereRef('valid_from', '<', 'valid_until')
      .where('valid_from', '<=', quarter.endDate)
      .where('valid_until', '>', quarter.startDate)
      .execute(),
    transaction
      .selectFrom('group_memberships')
      .select([
        'student_id',
        'group_id',
        sql<string>`valid_from::text`.as('valid_from'),
        sql<string>`valid_until::text`.as('valid_until'),
        'ended_by',
      ])
      .where('student_id', 'in', [...studentIds])
      .where('subject_id', '=', subjectId)
      .whereRef('valid_from', '<', 'valid_until')
      .where('valid_from', '<=', quarter.endDate)
      .where('valid_until', '>', quarter.startDate)
      .execute(),
  ]);
  return {
    classRows: classes.map((row) => ({
      studentId: row.student_id,
      unitId: row.class_id,
      from: row.valid_from,
      until: row.valid_until,
      endedBy: row.ended_by,
    })),
    groupRows: groups.map((row) => ({
      studentId: row.student_id,
      unitId: row.group_id,
      from: row.valid_from,
      until: row.valid_until,
      endedBy: row.ended_by,
    })),
  };
}

/** The leaving or branch move that ends the student's time in the branch inside the quarter. */
function atLeavingOf(
  classRows: readonly MemberRow[],
  quarter: { readonly startDate: string; readonly endDate: string },
): string | null {
  const ended = classRows
    .filter(
      (row) =>
        (row.endedBy === 'leaving' || row.endedBy === 'branch_move') &&
        row.until <= addDays(quarter.endDate, 1),
    )
    .sort((a, b) => (a.until < b.until ? 1 : a.until > b.until ? -1 : 0))[0];
  if (ended === undefined) return null;
  // Came back in the same quarter: a class row after it (edge/calculation, left and came back).
  if (classRows.some((row) => row.from >= ended.until)) return null;
  return addDays(ended.until, -1);
}

/**
 * The student's figures' inputs of one subject in one quarter, for each
 * student named, across the journals that follow the student. `known` is a
 * journal the caller already read for the quarter (the grid's own), reused
 * rather than read again.
 */
export async function subjectQuarterLessons(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly timeZone: string;
    readonly now: Date;
    readonly academicYearId: string;
    readonly subjectId: string;
    readonly quarter: { readonly id: string; readonly startDate: string; readonly endDate: string };
    readonly studentIds: readonly string[];
    readonly known?: KnownJournal;
  },
): Promise<Map<string, StudentSubjectQuarter>> {
  const answer = new Map<string, StudentSubjectQuarter>();
  if (input.studentIds.length === 0) return answer;
  const { quarter } = input;
  const { classRows, groupRows } = await memberRows(
    transaction,
    input.studentIds,
    quarter,
    input.subjectId,
  );
  const classIds = [...new Set(classRows.map((row) => row.unitId))];
  const groupIds = [...new Set(groupRows.map((row) => row.unitId))];
  const journalIds =
    classIds.length === 0 && groupIds.length === 0
      ? []
      : await transaction
          .selectFrom('journals')
          .select(['id', 'class_id', 'group_id'])
          .where('branch_id', '=', input.branchId)
          .where('academic_year_id', '=', input.academicYearId)
          .where('subject_id', '=', input.subjectId)
          .where((eb) =>
            eb.or([
              ...(classIds.length === 0 ? [] : [eb('class_id', 'in', classIds)]),
              ...(groupIds.length === 0 ? [] : [eb('group_id', 'in', groupIds)]),
            ]),
          )
          .orderBy('id')
          .execute();
  const journalOfUnit = new Map<string, string>();
  for (const row of journalIds) journalOfUnit.set(row.class_id ?? row.group_id ?? '', row.id);

  const data = new Map<string, JournalData>();
  for (const row of journalIds) {
    if (input.known !== undefined && input.known.journal.id === row.id) {
      data.set(row.id, input.known);
      continue;
    }
    const [journal] = await journalRows(transaction, input.branchId, { journalId: row.id });
    if (journal === undefined) continue;
    data.set(
      row.id,
      await journalData(transaction, journal, input.timeZone, input.now, quarter, input.studentIds),
    );
  }

  // The rating exams of the quarter in those journals, with the entries of the students.
  const exams =
    journalIds.length === 0
      ? []
      : await transaction
          .selectFrom('journal_rating_exams')
          .select(['id', 'journal_id', 'not_held'])
          .where(
            'journal_id',
            'in',
            journalIds.map((row) => row.id),
          )
          .where('quarter_id', '=', quarter.id)
          .execute();
  const entries =
    exams.length === 0
      ? []
      : await transaction
          .selectFrom('journal_rating_entries')
          .select(['rating_exam_id', 'student_id', 'kind', 'score'])
          .where(
            'rating_exam_id',
            'in',
            exams.map((one) => one.id),
          )
          .where('student_id', 'in', [...input.studentIds])
          .execute();

  for (const studentId of input.studentIds) {
    const ownClassRows = classRows.filter((row) => row.studentId === studentId);
    const subjectRows = [...ownClassRows, ...groupRows.filter((row) => row.studentId === studentId)]
      .flatMap((row) => {
        const journalId = journalOfUnit.get(row.unitId);
        return journalId === undefined ? [] : [{ ...row, journalId }];
      })
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    const spans: SubjectSpan[] = subjectRows.map((row) => ({
      journalId: row.journalId,
      unitName: data.get(row.journalId)?.journal.unitName ?? '',
      from: row.from < quarter.startDate ? quarter.startDate : row.from,
      until: addDays(row.until, -1) > quarter.endDate ? quarter.endDate : addDays(row.until, -1),
    }));

    // The journals the student belonged to on a day, or of the next membership (decision 10).
    const journalsOn = (date: string): ReadonlySet<string> => {
      const covering = subjectRows.filter((row) => row.from <= date && date < row.until);
      if (covering.length > 0) return new Set(covering.map((row) => row.journalId));
      const next = subjectRows.find((row) => row.from > date);
      if (next === undefined) return new Set();
      return new Set(
        subjectRows.filter((row) => row.from === next.from).map((row) => row.journalId),
      );
    };

    const lessons: CountedLesson[] = [];
    let held = 0;
    for (const [journalId, one] of data) {
      if (!subjectRows.some((row) => row.journalId === journalId)) continue;
      const marks = new Map<string, number | null>();
      const scores = new Map<string, number | null>();
      for (const cell of one.cells) {
        if (cell.studentId !== studentId) continue;
        if (cell.workId === null) marks.set(cell.lessonId, cell.mark);
        else scores.set(cell.workId, cell.score);
      }
      for (const lesson of one.lessons) {
        if (one.held.get(lesson.id) !== true) continue;
        if (journalsOn(lesson.date).has(journalId)) held += 1;
        const exempt = one.exempt.get(lesson.id)?.get(studentId);
        if (exempt !== undefined) {
          lessons.push({
            journalId,
            lessonId: lesson.id,
            date: lesson.date,
            lesson: { mark: exempt === 'full' ? 5 : 4, classworks: [], homeworks: [] },
            classworkColumns: [],
            homeworkColumns: [],
          });
          continue;
        }
        if (one.expected.get(lesson.id)?.has(studentId) !== true) continue;
        const works = one.worksOf.get(lesson.id) ?? [];
        lessons.push({
          journalId,
          lessonId: lesson.id,
          date: lesson.date,
          lesson: {
            mark: (marks.get(lesson.id) ?? null) as AttendanceMark | null,
            classworks: countedWorks(works, 'classwork', scores),
            homeworks: countedWorks(works, 'homework', scores),
          },
          classworkColumns: countedWorkRows(works, 'classwork').map(columnOf),
          homeworkColumns: countedWorkRows(works, 'homework').map(columnOf),
        });
      }
    }
    lessons.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // The rating entry of the latest membership's journal that has one (or "not held").
    let ratingExam: RatingExamEntry | null = null;
    for (const row of [...subjectRows].reverse()) {
      const exam = exams.find((one) => one.journal_id === row.journalId);
      if (exam === undefined) continue;
      if (exam.not_held) {
        ratingExam = { kind: 'not_held' };
        break;
      }
      const stored = entries.find(
        (one) => one.rating_exam_id === exam.id && one.student_id === studentId,
      );
      const entry = stored === undefined ? null : entryOf(stored);
      if (entry !== null) {
        ratingExam = entry;
        break;
      }
    }

    const atLeaving = atLeavingOf(ownClassRows, quarter);
    let leftSubjectOn: string | null = null;
    const last = subjectRows.reduce<(typeof subjectRows)[number] | undefined>(
      (latest, row) => (latest === undefined || row.until > latest.until ? row : latest),
      undefined,
    );
    if (atLeaving === null && last !== undefined && last.until <= quarter.endDate) {
      // Still a student of the branch the day after (a class row then or later in the quarter).
      const stays = ownClassRows.some((row) => row.until > last.until);
      if (stays) leftSubjectOn = addDays(last.until, -1);
    }

    answer.set(studentId, {
      studentId,
      lessons,
      heldInJournals: held,
      spans,
      ratingExam,
      leftSubjectOn,
      atLeaving,
    });
  }
  return answer;
}

/** The journals other than `journalId` the student's figures also come from (07, Transfers). */
export const carriedInOf = (spans: readonly SubjectSpan[], journalId: string): CarriedIn[] =>
  spans
    .filter((span) => span.journalId !== journalId)
    .map((span) => ({
      journalId: span.journalId,
      unitName: span.unitName,
      from: span.from,
      until: span.until,
    }));
