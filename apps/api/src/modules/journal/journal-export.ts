import {
  fillText,
  type JournalCell,
  type JournalExportTexts,
  type JournalFigures,
  type JournalGrid,
  type JournalLesson,
  type JournalStudent,
  type Language,
} from '@sodiq/shared';
import type { Cell, Sheet } from '../../http/xlsx.js';
import { momentText } from '../timetable/views-export.service.js';
import { dateText, escapeHtml } from '../timetable/views-file.js';

/**
 * The file of a journal (task 8.9, pull request #227; `07`, Layout and last
 * paragraph; `edge/system-behaviour`: "Excel exports contain real numbers and
 * dates. PDFs are made on the server with fonts that cover Uzbek Latin and
 * Cyrillic"). It is written from the grid answer of the reader and nothing
 * else, so it never holds more than the grid shows that reader (`edge/people-
 * roles-accounts`: "An export contains only what the role may see"), and it
 * calculates nothing: every percent, score and figure is the grid's, which
 * comes from `packages/calc`. An exempt cell is 4 or 5; the exemption's
 * reason, category and document are never written (From 8.5, decision 21).
 * Comments and reasons of absence are left out (decision 10).
 */

export interface JournalFileInput {
  grid: JournalGrid;
  /** `YYYY-MM` of the month exported, `null` for the quarter. */
  month: string | null;
  language: Language;
  timeZone: string;
  /** The moment the grid was read at: the stamp "Provisional · <date> <time>" (decision 5). */
  asOf: Date;
}

/** The ISO weekday of a school date, Monday 0 to Sunday 6. */
function weekdayIndex(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

/** The lessons of the period, in the grid's order, with their place in `cells`. */
function periodLessons(input: JournalFileInput): { lesson: JournalLesson; index: number }[] {
  return input.grid.lessons.flatMap((lesson, index) =>
    input.month === null || lesson.month === input.month ? [{ lesson, index }] : [],
  );
}

/**
 * The name of a student in the file, surname first (`listName`); the paternal
 * name is added when another student of the journal has the same surname and
 * name (`edge/journal`, "Two students in the list have the same surname and
 * name": "The paternal name is added; if they are still equal, the UID tells
 * them apart"; the UID is a column of its own).
 */
function namesOf(students: readonly JournalStudent[]): Map<string, string> {
  const plain = (student: JournalStudent) => `${student.lastName} ${student.firstName}`;
  const counts = new Map<string, number>();
  for (const student of students) {
    counts.set(plain(student), (counts.get(plain(student)) ?? 0) + 1);
  }
  return new Map(
    students.map((student) => [
      student.id,
      (counts.get(plain(student)) ?? 0) > 1 && student.paternalName !== null
        ? `${plain(student)} ${student.paternalName}`
        : plain(student),
    ]),
  );
}

/** Which figure columns the reader's grid answers. */
interface FigureColumns {
  attendance: boolean;
  works: boolean;
  ratingExam: boolean;
  result: boolean;
}

function figureColumnsOf(input: JournalFileInput): FigureColumns {
  const { grid } = input;
  const figures = grid.students.flatMap((student) => {
    const found = figuresOf(student, input.month);
    return found === null ? [] : [found];
  });
  const any = figures.length > 0;
  const graded = any && !grid.journal.attendanceOnly && grid.shape === 'whole';
  return {
    attendance: any,
    works: graded,
    ratingExam: graded && grid.journal.ratingExam && input.month === null,
    result: graded && figures.some((one) => one.result !== null),
  };
}

function figuresOf(student: JournalStudent, month: string | null): JournalFigures | null {
  if (month === null) return student.quarter;
  return student.months?.[month] ?? null;
}

/** "Sinf jurnali", then Class · Subject · Quarter · Month, "Teacher: name", the stamp (`07`, Opening a journal). */
export function journalHeader(input: JournalFileInput, texts: JournalExportTexts): string[] {
  const { grid } = input;
  const line = [
    grid.journal.unit.name,
    grid.journal.subject.names[input.language],
    fillText(texts.quarter, { number: String(grid.quarter.number) }),
    ...(input.month === null ? [] : [fillText(texts.month, { month: input.month })]),
  ].join(' · ');
  return [
    texts.title,
    line,
    grid.teacher === null ? texts.noTeacher : fillText(texts.teacher, { name: grid.teacher.name }),
    stampOf(input, texts),
  ];
}

/** `edge/journal`, "A results table is exported in week 6": "Provisional" with date and time (decision 5). */
export function stampOf(input: JournalFileInput, texts: JournalExportTexts): string {
  return fillText(texts.provisional, { moment: momentText(input.asOf, input.timeZone) });
}

/** The label of a lesson's block: date, weekday, slot (`07`, Layout, row 1). */
function lessonLabel(lesson: JournalLesson, texts: JournalExportTexts): string {
  const weekday = texts.weekdays[weekdayIndex(lesson.date)] ?? '';
  return [
    dateText(lesson.date),
    weekday,
    ...(lesson.slot === null ? [] : [String(lesson.slot)]),
  ].join(' ');
}

function workLabel(
  lesson: JournalLesson,
  work: JournalLesson['works'][number],
  texts: JournalExportTexts,
): string {
  const short =
    work.kind === 'classwork' ? texts.columns.classworkShort : texts.columns.homeworkShort;
  return [
    `${short}${String(work.position)}`,
    ...(work.title === null ? [] : [work.title]),
    ...(work.total === null ? [] : [fillText(texts.columns.total, { total: String(work.total) })]),
  ].join(' ');
}

/** Whether the reader's grid shows the works and the lesson score of a lesson. */
const showsWorks = (input: JournalFileInput): boolean =>
  input.grid.shape !== 'attendance' && !input.grid.journal.attendanceOnly;

/** One column of the table: its heading and its cell of a student. */
interface Column {
  heading: string;
  cell: (student: JournalStudent) => Cell;
  /** The PDF writes the cell with the next one ("12 · 40%"). */
  joinNext?: boolean;
  /** The date of the lesson whose block the column opens: the date row of Excel. */
  date?: string;
}

function resultCells(figures: JournalFigures | null, texts: JournalExportTexts): [Cell, Cell] {
  const result = figures?.result ?? null;
  if (result === null) return [null, null];
  if (result.kind === 'exempt') return [texts.exempt, null];
  if (result.kind === 'no_result') return [texts.noResult, null];
  return [result.shown, result.grade];
}

function noteOf(figures: JournalFigures | null, texts: JournalExportTexts): Cell {
  const result = figures?.result ?? null;
  if (result?.kind !== 'number') return null;
  const notes = [
    ...(result.provisional ? [texts.provisionalResult] : []),
    ...(result.basedOn === null
      ? []
      : [
          fillText(texts.basedOn, {
            held: String(result.basedOn.held),
            expected: String(result.basedOn.expected),
          }),
        ]),
  ];
  return notes.length === 0 ? null : notes.join('; ');
}

/** The mark of a cell: the digit, 4 or 5 for an exempt cell, the cancel's word on a cancelled lesson. */
function markCell(
  lesson: JournalLesson,
  cell: JournalCell | undefined,
  texts: JournalExportTexts,
): Cell {
  if (lesson.cancelled !== null) return texts.cancelled;
  if (cell === undefined) return null;
  if (cell.exempt !== null) return cell.exempt === 'temporary' ? 4 : 5;
  return cell.mark;
}

function columnsOf(input: JournalFileInput, texts: JournalExportTexts): Column[] {
  const figures = figureColumnsOf(input);
  const names = namesOf(input.grid.students);
  const c = texts.columns;
  const columns: Column[] = [
    { heading: c.number, cell: (student) => student.number },
    { heading: c.name, cell: (student) => names.get(student.id) ?? '' },
    { heading: c.uid, cell: (student) => student.uid },
  ];
  const own = (student: JournalStudent) => figuresOf(student, input.month);
  if (figures.attendance) {
    columns.push({ heading: c.attendance, cell: (student) => own(student)?.attendance ?? null });
  }
  if (figures.works) {
    columns.push(
      { heading: c.classwork, cell: (student) => own(student)?.classwork ?? null },
      { heading: c.homework, cell: (student) => own(student)?.homework ?? null },
    );
  }
  if (figures.ratingExam) {
    columns.push({ heading: c.ratingExam, cell: (student) => own(student)?.ratingExam ?? null });
  }
  if (figures.result) {
    columns.push(
      { heading: c.result, cell: (student) => resultCells(own(student), texts)[0] },
      { heading: c.grade, cell: (student) => resultCells(own(student), texts)[1] },
      { heading: c.note, cell: (student) => noteOf(own(student), texts) },
    );
  }
  const works = showsWorks(input);
  for (const { lesson, index } of periodLessons(input)) {
    const label = lessonLabel(lesson, texts);
    const cellOf = (student: JournalStudent) => student.cells[index];
    columns.push({
      heading: `${label} · ${c.mark}`,
      date: lesson.date,
      cell: (student) => markCell(lesson, cellOf(student), texts),
    });
    if (!works || lesson.cancelled !== null) continue;
    lesson.works.forEach((work, place) => {
      const heading = `${label} · ${workLabel(lesson, work, texts)}`;
      columns.push(
        {
          heading,
          cell: (student) => cellOf(student)?.works[place]?.score ?? null,
          joinNext: true,
        },
        {
          heading: `${heading} ${c.percent}`,
          cell: (student) => cellOf(student)?.works[place]?.percent ?? null,
        },
      );
    });
    columns.push({
      heading: `${label} · ${c.lessonScore}`,
      cell: (student) => cellOf(student)?.score ?? null,
    });
  }
  return columns;
}

/** The order of the rows: the list, then the folded "Exempt" and "Left or moved" sections (`07`). */
function sectionsOf(input: JournalFileInput): {
  members: JournalStudent[];
  exempt: JournalStudent[];
  folded: JournalStudent[];
} {
  const shown = periodLessons(input).map((one) => one.index);
  // `07`, In the journal: "A student who is exempt for the whole month on screen is moved to a
  // folded 'Exempt' section at the bottom" (the grid page's own rule, `journal-page.tsx`).
  const exemptAll = (student: JournalStudent) =>
    shown.length > 0 &&
    shown.every((index) => {
      const cell = student.cells[index];
      return cell !== undefined && cell.exempt !== null;
    });
  const listed = input.grid.students.filter((one) => !one.folded);
  return {
    members: listed.filter((one) => !exemptAll(one)),
    exempt: listed.filter(exemptAll),
    folded: input.grid.students.filter((one) => one.folded),
  };
}

/** The bottom row: the class or group averages, `null` where the reader may not see them. */
function bottomRow(input: JournalFileInput, columns: readonly Column[], texts: JournalExportTexts) {
  const bottom =
    input.grid.bottom === null
      ? null
      : input.month === null
        ? input.grid.bottom.quarter
        : (input.grid.bottom.months[input.month] ?? null);
  if (bottom === null) return null;
  const c = texts.columns;
  const values: Readonly<Record<string, Cell>> = {
    [c.attendance]: bottom.attendance,
    [c.classwork]: bottom.classwork,
    [c.homework]: bottom.homework,
    [c.ratingExam]: bottom.ratingExam,
    [c.result]: bottom.result,
  };
  return columns.map((column, index) =>
    index === 1 ? texts.bottom : (values[column.heading] ?? null),
  );
}

/** The legend under the table: marks, grade bands and the weights in force (`07`, Layout). */
export function legendLines(input: JournalFileInput, texts: JournalExportTexts): string[] {
  const l = texts.legend;
  const marks = (['1', '0', '2', '3', '4', '5'] as const)
    .map((mark) => `${mark} ${l.markNames[mark]}`)
    .join(', ');
  const { legend } = input.grid;
  return [
    `${l.marks}: ${marks}`,
    ...(input.grid.journal.attendanceOnly ? [] : [l.bands]),
    ...(legend.daily === null
      ? []
      : [
          fillText(l.daily, {
            attendance: String(legend.daily.attendance),
            classwork: String(legend.daily.classwork),
            homework: String(legend.daily.homework),
          }),
        ]),
    ...(legend.quarterly === null
      ? []
      : [
          fillText(l.quarterly, {
            attendance: String(legend.quarterly.attendance),
            classwork: String(legend.quarterly.classwork),
            homework: String(legend.quarterly.homework),
            ratingExam: String(legend.quarterly.ratingExam ?? 0),
          }),
        ]),
  ];
}

/** A sheet name Excel takes: at most 31 letters, none of `[]:*?/\`, unique in the workbook. */
export function sheetNameOf(name: string, taken: Set<string>): string {
  const clean =
    name
      .replace(/[[\]:*?/\\]/g, ' ')
      .trim()
      .slice(0, 31) || 'journal';
  let candidate = clean;
  for (let count = 2; taken.has(candidate.toLowerCase()); count += 1) {
    const suffix = ` (${String(count)})`;
    candidate = `${clean.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** The journal as one sheet of Excel. The number of student rows is `rows`. */
export function journalSheet(
  input: JournalFileInput,
  texts: JournalExportTexts,
  name: string,
): { sheet: Sheet; rows: number } {
  const columns = columnsOf(input, texts);
  const sections = sectionsOf(input);
  const width = columns.length;
  const line = (text: string): Cell[] => [text, ...Array.from({ length: width - 1 }, () => null)];
  const rowOf = (student: JournalStudent): Cell[] => columns.map((column) => column.cell(student));
  const bottom = bottomRow(input, columns, texts);
  // The dates of the lessons as real dates (edge/system-behaviour: "Excel exports contain real
  // numbers and dates"), in the row under the headings.
  const dates: Cell[] = columns.map((column, index) =>
    column.date !== undefined ? { date: column.date } : index === 1 ? texts.columns.date : null,
  );
  const rows: Cell[][] = [
    dates,
    ...sections.members.map(rowOf),
    ...(bottom === null ? [] : [bottom]),
    ...(sections.exempt.length === 0
      ? []
      : [line(texts.exemptSection), ...sections.exempt.map(rowOf)]),
    ...(sections.folded.length === 0 ? [] : [line(texts.folded), ...sections.folded.map(rowOf)]),
    line(''),
    ...legendLines(input, texts).map(line),
  ];
  return {
    sheet: {
      name,
      preamble: journalHeader(input, texts),
      headings: columns.map((column) => column.heading),
      rows,
    },
    rows: input.grid.students.length,
  };
}

const cellText = (cell: Cell): string =>
  cell === null
    ? ''
    : typeof cell === 'object'
      ? 'date' in cell
        ? dateText(cell.date)
        : `${String(Math.floor(cell.time / 60)).padStart(2, '0')}:${String(cell.time % 60).padStart(2, '0')}`
      : String(cell);

/** The fixed columns of every part of the PDF's table: number, name, UID and the figures. */
const FIXED_COLUMNS_MAX = 11;

/** Lesson columns in one part of the PDF's table, so that a part fits a landscape page. */
const PDF_LESSON_COLUMNS = 16;

/**
 * The journal as one section of the PDF: its header, the table in parts of
 * at most `PDF_LESSON_COLUMNS` lesson columns (each part repeats the names),
 * a number and its percent in one cell ("12 · 40%", decision 9), the
 * sections, the bottom row and the legend.
 */
export function journalHtml(
  input: JournalFileInput,
  texts: JournalExportTexts,
  first: boolean,
): string {
  const all = columnsOf(input, texts);
  // The PDF writes a number with its percent in one cell.
  const merged: Column[] = [];
  for (let index = 0; index < all.length; index += 1) {
    const column = all[index];
    if (column === undefined) continue;
    const next = all[index + 1];
    if (column.joinNext === true && next !== undefined) {
      merged.push({
        heading: column.heading,
        cell: (student) => {
          const number = column.cell(student);
          const percent = next.cell(student);
          return number === null ? null : `${cellText(number)} · ${cellText(percent)}%`;
        },
      });
      index += 1;
    } else {
      merged.push(column);
    }
  }
  const figures = figureColumnsOf(input);
  const fixed = Math.min(
    3 +
      (figures.attendance ? 1 : 0) +
      (figures.works ? 2 : 0) +
      (figures.ratingExam ? 1 : 0) +
      (figures.result ? 3 : 0),
    FIXED_COLUMNS_MAX,
  );
  const head = merged.slice(0, fixed);
  const rest = merged.slice(fixed);
  const parts: Column[][] = [];
  for (let start = 0; start < rest.length || parts.length === 0; start += PDF_LESSON_COLUMNS) {
    parts.push([...head, ...rest.slice(start, start + PDF_LESSON_COLUMNS)]);
  }
  const sections = sectionsOf(input);
  const bottomAll = bottomRow(input, merged, texts);
  const tableOf = (columns: readonly Column[]) => {
    const heading = columns.map((one) => `<th>${escapeHtml(one.heading)}</th>`).join('');
    const rowHtml = (student: JournalStudent) =>
      `<tr>${columns.map((one) => `<td>${escapeHtml(cellText(one.cell(student)))}</td>`).join('')}</tr>`;
    const lineHtml = (text: string) =>
      `<tr><td colspan="${String(columns.length)}"><b>${escapeHtml(text)}</b></td></tr>`;
    const bottom =
      bottomAll === null
        ? ''
        : `<tr>${columns
            .map((one) => {
              const at = merged.indexOf(one);
              return `<td><b>${escapeHtml(cellText(bottomAll[at] ?? null))}</b></td>`;
            })
            .join('')}</tr>`;
    return `<table class="journal"><thead><tr>${heading}</tr></thead><tbody>${[
      ...sections.members.map(rowHtml),
      bottom,
      ...(sections.exempt.length === 0
        ? []
        : [lineHtml(texts.exemptSection), ...sections.exempt.map(rowHtml)]),
      ...(sections.folded.length === 0
        ? []
        : [lineHtml(texts.folded), ...sections.folded.map(rowHtml)]),
    ].join('')}</tbody></table>`;
  };
  const header = journalHeader(input, texts);
  return `<div class="${first ? 'journal-part' : 'journal-part next-day'}"><h2>${escapeHtml(header[1] ?? '')}</h2><div class="stamp">${header
    .slice(2)
    .map((one) => `<p>${escapeHtml(one)}</p>`)
    .join('')}</div>${parts.map(tableOf).join('')}<div class="stamp">${legendLines(input, texts)
    .map((one) => `<p class="quiet">${escapeHtml(one)}</p>`)
    .join('')}</div></div>`;
}
