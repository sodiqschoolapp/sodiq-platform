import {
  PAST_MARK_COLUMNS,
  PAST_MARK_MAX_LESSON,
  PAST_MARK_MAX_ROWS,
  PAST_MARK_SHEET,
  PAST_MARK_TITLE_MAX,
  pastMarkTitleKey,
  staffImportNameKey,
  studentNameKey,
  WORK_TOTAL_MAX,
  type PastMarkColumn,
  type PastMarkImportRow,
  type PastMarkProblem,
  type PastWorkKind,
} from '@sodiq/shared';
import { dayOn, isSchoolDay, type CalendarSettings } from '@sodiq/timetable-rules';
import ExcelJS from 'exceljs';
import { ApiException } from '../../http/api-exception.js';
import { cellText, dottedDateOf, FIRST_DATA_ROW } from '../people/student-import-read.js';

/**
 * Reading and checking a file of past marks from before go-live (task 11.26; `10`, Past marks
 * from before go-live, The file and The rules of a row; `edge/academic-year`, Past marks from
 * before go-live). Only the system's template, in the way of the subject import. Pure: the
 * service hands in what the database holds (`PastMarkContext`), and checks the repeats across the
 * uploads that stand itself.
 */

const notTemplate = () => new ApiException('import_not_template', 422);

/** The rows of an upload: the sheet whose first row holds exactly the keys, in order; empty rows skipped. */
export async function readPastMarkWorkbook(bytes: Buffer): Promise<PastMarkImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS types its own Buffer; a Node Buffer is one.
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    throw notTemplate();
  }
  const sheet = workbook.getWorksheet(PAST_MARK_SHEET);
  if (sheet === undefined) {
    throw notTemplate();
  }
  const keys = sheet.getRow(1);
  const marked = PAST_MARK_COLUMNS.every(
    (column, index) => cellText(keys.getCell(index + 1).value) === column,
  );
  if (!marked || cellText(keys.getCell(PAST_MARK_COLUMNS.length + 1).value) !== undefined) {
    throw notTemplate();
  }
  const rows: PastMarkImportRow[] = [];
  for (let number = FIRST_DATA_ROW; number <= sheet.rowCount; number += 1) {
    const row = sheet.getRow(number);
    const cells: Partial<Record<PastMarkColumn, string>> = {};
    PAST_MARK_COLUMNS.forEach((column, index) => {
      const value = row.getCell(index + 1).value;
      // A date cell is read as its day (`yyyy-mm-dd`), whatever the time zone of the machine.
      const text = value instanceof Date ? isoDayOf(value) : cellText(value)?.trim();
      if (text !== undefined && text !== '') {
        cells[column] = text;
      }
    });
    if (Object.keys(cells).length > 0) {
      rows.push({ rowNumber: number, cells });
      if (rows.length > PAST_MARK_MAX_ROWS) {
        throw new ApiException('import_too_many_rows', 422);
      }
    }
  }
  if (rows.length === 0) {
    throw new ApiException('import_empty', 422);
  }
  return rows;
}

/** An Excel date (stored as midnight UTC of the day typed) as its school date. */
const isoDayOf = (date: Date): string => date.toISOString().slice(0, 10);

/** A date typed as `yyyy-mm-dd` or `dd.mm.yyyy`, when it is a real day. */
export function pastMarkDateOf(text: string): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso !== null) {
    const [, year = '', month = '', day = ''] = iso;
    return dottedDateOf(`${day}.${month}.${year}`);
  }
  return dottedDateOf(text);
}

/**
 * A score or a total as typed (`10`: "at most two digits after the decimal point"; `edge/academic-
 * year`: "As in the journal: a point only, at most two digits after it; an Excel number cell is
 * read as its value"). The value is the plain decimal of the text, which a JS number writes back
 * exactly (`String`), and which `packages/calc` reads from that text.
 */
export function pastMarkAmountOf(
  text: string,
): { value: number } | { code: 'amount_comma' | 'amount_decimals' | 'amount_invalid' } {
  if (text.includes(',')) return { code: 'amount_comma' };
  const parts = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (parts === null) return { code: 'amount_invalid' };
  const [, whole = '', decimals = ''] = parts;
  if (decimals.length > 2) return { code: 'amount_decimals' };
  const value = Number(decimals === '' ? whole : `${whole}.${decimals}`);
  return Number.isFinite(value) ? { value } : { code: 'amount_invalid' };
}

/** A class membership of a student: its branch, the grade of its class, its half-open days. */
export interface PastMarkMembership {
  /** The branch of the import, or `null` for another branch (`past_mark_students` names no other). */
  branchId: string | null;
  grade: number;
  validFrom: string;
  validUntil: string;
}

/** A student the file may name, as `past_mark_students` gives it. */
export interface PastMarkStudent {
  id: string;
  uid: string;
  lastName: string;
  firstName: string;
  /** The student's present branch when it is the branch of the import; `null` otherwise. */
  branchId: string | null;
  /** Every class membership, in every branch, by its start. */
  memberships: readonly PastMarkMembership[];
}

export interface PastMarkSubject {
  id: string;
  names: readonly string[];
  attendanceOnly: boolean;
}

/** What the database holds that a row is checked against, read by the service. */
export interface PastMarkContext {
  branchId: string;
  goLiveDate: string | null;
  /** The branch's current academic year, or `null`. */
  year: { id: string; startDate: string; endDate: string } | null;
  quarters: readonly { startDate: string; endDate: string }[];
  calendar: CalendarSettings;
  /** The students by UID. */
  students: ReadonlyMap<string, PastMarkStudent>;
  subjects: readonly PastMarkSubject[];
}

/** A work of a row, ready to save. */
export interface ParsedPastWork {
  kind: PastWorkKind;
  title: string;
  titleKey: string;
  total: number;
  score: number;
}

/** A row read and checked on its own. */
export interface ParsedPastMarkRow {
  rowNumber: number;
  problems: PastMarkProblem[];
  /** What the row saves; `null` when it has problems. */
  record: {
    studentId: string;
    subjectId: string;
    date: string;
    lesson: number;
    mark: number | null;
    works: ParsedPastWork[];
  } | null;
  /** The lesson's key, when the student, subject, date and lesson were read (for repeats). */
  lessonKey: string | null;
  /** Whether the row carries an attendance mark that was read, and the works read (for repeats). */
  markRead: boolean;
  worksRead: ParsedPastWork[];
  /** For the preview: the cells that find the row. */
  shown: { uid: string | null; name: string | null; date: string | null; subject: string | null };
}

/**
 * The class membership that decides a row (review correction 1, plan decision 19): the one on
 * the row's date, or else the first one after it, or else the last one before it (a student whose
 * classes all ended earlier; build decision); `null` only for a student with no membership at
 * all, who is checked against the record's branch.
 */
export function membershipFor(student: PastMarkStudent, date: string): PastMarkMembership | null {
  const on = student.memberships.find((one) => one.validFrom <= date && date < one.validUntil);
  if (on !== undefined) return on;
  const ordered = [...student.memberships]
    .filter((one) => one.validFrom < one.validUntil)
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  return ordered.find((one) => one.validFrom > date) ?? ordered.at(-1) ?? null;
}

/** The one subject a name stands for, or why there is none (`10`: "by its name in any of the three languages"). */
function subjectOf(
  subjects: readonly PastMarkSubject[],
  text: string,
): PastMarkSubject | 'subject_unknown' | 'subject_ambiguous' {
  const key = staffImportNameKey(text);
  const found = subjects.filter((one) =>
    one.names.some((name) => staffImportNameKey(name) === key),
  );
  const [only] = found;
  if (only === undefined) return 'subject_unknown';
  return found.length === 1 ? only : 'subject_ambiguous';
}

const KIND_COLUMNS: Readonly<
  Record<PastWorkKind, { title: PastMarkColumn; total: PastMarkColumn; score: PastMarkColumn }>
> = {
  classwork: { title: 'classworkTitle', total: 'classworkTotal', score: 'classworkScore' },
  homework: { title: 'homeworkTitle', total: 'homeworkTotal', score: 'homeworkScore' },
};

/** Reads and checks one row against the context (`10`, The rules of a row). */
export function parsePastMarkRow(
  row: PastMarkImportRow,
  context: PastMarkContext,
): ParsedPastMarkRow {
  const problems: PastMarkProblem[] = [];
  const problem = (column: PastMarkColumn | null, code: PastMarkProblem['code']) => {
    problems.push({ column, code });
  };
  const cell = (column: PastMarkColumn): string | undefined => row.cells[column];
  const shownName = [cell('lastName'), cell('firstName')].filter((one) => one !== undefined);
  const shown = {
    uid: cell('uid') ?? null,
    name: shownName.length === 0 ? null : shownName.join(' '),
    date: cell('date') ?? null,
    subject: cell('subject') ?? null,
  };

  // The student, and the name checked against the UID.
  let student: PastMarkStudent | null = null;
  const uid = cell('uid');
  if (uid === undefined) {
    problem('uid', 'required');
  } else {
    student = context.students.get(uid) ?? null;
    if (student === null) problem('uid', 'uid_unknown');
  }
  const lastName = cell('lastName');
  const firstName = cell('firstName');
  if (lastName === undefined) problem('lastName', 'required');
  if (firstName === undefined) problem('firstName', 'required');
  if (
    student !== null &&
    lastName !== undefined &&
    firstName !== undefined &&
    studentNameKey(lastName, firstName) !== studentNameKey(student.lastName, student.firstName)
  ) {
    problem('lastName', 'name_mismatch');
  }

  // The date: a real day, before go-live, in the current year and a quarter of it.
  let date: string | null = null;
  const dateText = cell('date');
  if (dateText === undefined) {
    problem('date', 'required');
  } else {
    const day = pastMarkDateOf(dateText) ?? null;
    date = day;
    if (day === null) {
      problem('date', 'date_invalid');
    } else if (context.goLiveDate === null) {
      problem('date', 'no_go_live');
    } else if (day >= context.goLiveDate) {
      problem('date', 'date_not_before_go_live');
    } else if (
      context.year === null ||
      day < context.year.startDate ||
      day > context.year.endDate
    ) {
      problem('date', 'date_outside_year');
    } else if (!context.quarters.some((one) => one.startDate <= day && day <= one.endDate)) {
      problem('date', 'date_outside_quarter');
    }
  }

  // The branch of the import and the grade, from the class membership (correction 1, decision 19).
  if (student !== null && date === null && student.branchId !== context.branchId) {
    problem('uid', 'student_other_branch');
  }
  if (student !== null && date !== null) {
    const membership = membershipFor(student, date);
    const branchId = membership === null ? student.branchId : membership.branchId;
    if (branchId !== context.branchId) {
      problem('uid', 'student_other_branch');
    } else if (!problems.some((one) => one.column === 'date')) {
      const schoolDay =
        membership === null
          ? isSchoolDay(date, context.calendar)
          : (() => {
              const day = dayOn(membership.grade, date, context.calendar);
              return day.lessons || day.reason === 'no_template';
            })();
      if (!schoolDay) problem('date', 'date_not_school_day');
    }
  }

  // The subject, by any of its three names.
  let subject: PastMarkSubject | null = null;
  const subjectText = cell('subject');
  if (subjectText === undefined) {
    problem('subject', 'required');
  } else {
    const found = subjectOf(context.subjects, subjectText);
    if (typeof found === 'string') problem('subject', found);
    else subject = found;
  }

  // The lesson: empty means 1.
  let lesson: number | null = 1;
  const lessonText = cell('lesson');
  if (lessonText !== undefined) {
    const number = /^\d{1,2}$/.test(lessonText) ? Number(lessonText) : Number.NaN;
    if (!(number >= 1 && number <= PAST_MARK_MAX_LESSON)) {
      problem('lesson', 'invalid');
      lesson = null;
    } else {
      lesson = number;
    }
  }

  // The attendance mark: 0, 1, 2 or 3, 4 or 5 for exempt, or empty.
  let mark: number | null = null;
  const markText = cell('attendance');
  if (markText !== undefined) {
    if (/^[0-5]$/.test(markText)) mark = Number(markText);
    else problem('attendance', 'invalid');
  }

  // The works: three cells together.
  const works: ParsedPastWork[] = [];
  let anyWork = false;
  for (const kind of ['classwork', 'homework'] as const) {
    const columns = KIND_COLUMNS[kind];
    const title = cell(columns.title);
    const totalText = cell(columns.total);
    const scoreText = cell(columns.score);
    const filled = [title, totalText, scoreText].filter((one) => one !== undefined).length;
    if (filled === 0) continue;
    anyWork = true;
    if (filled < 3) {
      for (const column of [columns.title, columns.total, columns.score]) {
        if (cell(column) === undefined) problem(column, 'work_incomplete');
      }
      continue;
    }
    if (subject?.attendanceOnly === true) {
      problem(columns.title, 'subject_attendance_only');
      continue;
    }
    let good = true;
    if (title === undefined || title.length > PAST_MARK_TITLE_MAX) {
      problem(columns.title, 'title_too_long');
      good = false;
    }
    let total: number | null = null;
    const readTotal = pastMarkAmountOf(totalText ?? '');
    if ('code' in readTotal) {
      problem(columns.total, readTotal.code);
      good = false;
    } else if (readTotal.value < 1 || readTotal.value > WORK_TOTAL_MAX) {
      problem(columns.total, 'total_range');
      good = false;
    } else {
      total = readTotal.value;
    }
    const readScore = pastMarkAmountOf(scoreText ?? '');
    if ('code' in readScore) {
      problem(columns.score, readScore.code);
      good = false;
    } else if (total !== null && readScore.value > total) {
      problem(columns.score, 'score_range');
      good = false;
    } else if (readScore.value > WORK_TOTAL_MAX) {
      problem(columns.score, 'score_range');
      good = false;
    }
    if (good && title !== undefined && total !== null && !('code' in readScore)) {
      works.push({ kind, title, titleKey: pastMarkTitleKey(title), total, score: readScore.value });
    }
  }
  if (mark === null && markText === undefined && !anyWork) {
    problem(null, 'row_empty');
  }

  const lessonKey =
    student !== null && subject !== null && date !== null && lesson !== null
      ? `${student.id}|${subject.id}|${date}|${String(lesson)}`
      : null;
  return {
    rowNumber: row.rowNumber,
    problems,
    record:
      problems.length === 0 &&
      student !== null &&
      subject !== null &&
      date !== null &&
      lesson !== null
        ? { studentId: student.id, subjectId: subject.id, date, lesson, mark, works }
        : null,
    lessonKey,
    markRead: mark !== null,
    worksRead: works,
    shown,
  };
}

/**
 * The repeats inside the file (`edge/academic-year`: "A lesson … has at most one attendance mark,
 * and a work (the same lesson, kind and title) appears once, in the file"): each repeat is a
 * problem of its row, naming the other rows. Added to the rows given.
 */
export function addPastMarkFileRepeats(rows: readonly ParsedPastMarkRow[]): void {
  const marks = new Map<string, number[]>();
  const works = new Map<string, number[]>();
  const markKey = (row: ParsedPastMarkRow) =>
    row.lessonKey !== null && hasMark(row) ? row.lessonKey : null;
  for (const row of rows) {
    const key = markKey(row);
    if (key !== null) marks.set(key, [...(marks.get(key) ?? []), row.rowNumber]);
    for (const work of workKeysOf(row)) {
      works.set(work, [...(works.get(work) ?? []), row.rowNumber]);
    }
  }
  for (const row of rows) {
    const key = markKey(row);
    const others =
      key === null ? [] : (marks.get(key) ?? []).filter((one) => one !== row.rowNumber);
    if (others.length > 0) {
      row.problems.push({
        column: 'attendance',
        code: 'attendance_repeated_in_file',
        rows: others,
      });
    }
    for (const [work, kind] of workKeysWithKind(row)) {
      const again = (works.get(work) ?? []).filter((one) => one !== row.rowNumber);
      if (again.length > 0) {
        row.problems.push({
          column: KIND_COLUMNS[kind].title,
          code: 'work_repeated_in_file',
          rows: again,
        });
      }
    }
    if (row.problems.length > 0) row.record = null;
  }
}

/** Whether a row carries an attendance mark (read or not). */
const hasMark = (row: ParsedPastMarkRow): boolean => row.markRead;

function workKeysWithKind(row: ParsedPastMarkRow): [string, PastWorkKind][] {
  if (row.lessonKey === null) return [];
  return row.worksRead.map((work) => [
    `${row.lessonKey ?? ''}|${work.kind}|${work.titleKey}`,
    work.kind,
  ]);
}

const workKeysOf = (row: ParsedPastMarkRow): string[] => workKeysWithKind(row).map(([key]) => key);
