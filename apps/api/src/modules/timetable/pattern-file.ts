import {
  fillText,
  timeText,
  type Language,
  type PatternExportTexts,
  type ViewExportTexts,
  type ViewKind,
} from '@sodiq/shared';
import type { Cell, Sheet } from '../../http/xlsx.js';
import { dateText, escapeHtml, printHtml } from './views-file.js';

/**
 * The printout and the Excel file of a version's weekly pattern (task 5.9c-2,
 * pull request #200; `edge/timetable`, "The wall timetable is out of date":
 * "A printed pattern carries the version, 'valid from', the print time and
 * 'one-day changes not included'. ... A draft print is marked DRAFT"). Both
 * are built from the `PatternPrint` the service reads with the board's own
 * read (decision 9) and nothing else; names are as entered.
 */

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A lesson slot of a day: its number among the lesson slots, breaks not counted, and its minutes. */
export interface PatternSlot {
  lessonNumber: number;
  start: number;
  end: number;
}

/** One lesson of the pattern as the file prints it. */
export interface PatternLesson {
  /** The pattern lesson (`pattern_block_lessons.id`). */
  id: string;
  weekday: Weekday;
  /**
   * Its number among the lesson slots of the day of its unit's first class's
   * grade, as 5.9a numbers a dated lesson (approval correction 3); `null`
   * when no lesson slot there has its times.
   */
  lessonNumber: number | null;
  start: number;
  end: number;
  /** The class ("7 Oxford") or the group, and the classes it draws from. */
  unit: { name: string; classIds: readonly string[] };
  subject: Readonly<Record<Language, string>>;
  /** The teacher or the vacancy, as entered. */
  teacher: string;
  room: string | null;
}

/** A weekday of the file: lesson numbers, or clock time when its lessons come from templates with different times. */
export interface PatternDay {
  weekday: Weekday;
  axis: 'slots' | 'clock';
  /** The lesson slots on the `slots` axis; none on `clock`. */
  slots: readonly PatternSlot[];
}

/** A class of the school print: a row of each weekday. */
export interface PatternClass {
  id: string;
  name: string;
}

export interface PatternPrint {
  kind: ViewKind;
  /** The class, teacher or room; `null` for the school. */
  subject: { id: string; name: string } | null;
  version: { number: number; status: 'draft' | 'published' | 'archived'; startsOn: string };
  days: readonly PatternDay[];
  lessons: readonly PatternLesson[];
  /** Every class of the school print, by grade and name; empty for the other kinds. */
  classes: readonly PatternClass[];
}

export interface PatternFileTexts {
  view: ViewExportTexts;
  pattern: PatternExportTexts;
}

/** The moment of the print in branch time, `DD.MM.YYYY HH:MM` (decision 7). */
export interface PrintStamp {
  printed: string;
}

/**
 * The stamp of every page and of the preamble: published, the four items of
 * `edge/timetable`; archived, the same after "Archived" (decision 2); a
 * draft, the same four with "planned from" for "valid from", after DRAFT
 * (decision 3 as changed by approval correction 1).
 */
export function stampLines(
  print: PatternPrint,
  texts: PatternFileTexts,
  stamp: PrintStamp,
): string[] {
  const { version } = print;
  const number = fillText(texts.view.version, { number: String(version.number) });
  const date = dateText(version.startsOn);
  const from =
    version.status === 'draft'
      ? fillText(texts.pattern.plannedFrom, { date })
      : fillText(texts.view.validFrom, { date });
  return [
    ...(version.status === 'draft' ? [texts.pattern.draft] : []),
    ...(version.status === 'archived' ? [texts.pattern.archived] : []),
    `${number}, ${from}`,
    fillText(texts.pattern.printed, { moment: stamp.printed }),
    texts.pattern.noDayChanges,
  ];
}

/** The title of the file: the kind, the class, teacher or room, "Weekly pattern". */
function titleOf(print: PatternPrint, texts: PatternFileTexts): string {
  return [texts.view.titles[print.kind], print.subject?.name, texts.pattern.weekly]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ');
}

/** The file name: `<version-N>-<kind>-<name>.<ext>`, with an ASCII fallback, as 5.9c-1's. */
export function patternFileName(
  print: PatternPrint,
  texts: PatternFileTexts,
  ascii: string,
  extension: 'pdf' | 'xlsx',
): { fileName: string; asciiName: string } {
  const number = String(print.version.number);
  const name = [
    `${texts.pattern.fileName}-${number}`,
    texts.view.fileNames[print.kind],
    print.subject?.name ?? '',
  ]
    .filter((part) => part !== '')
    .join('-')
    .replace(/\s+/g, '-');
  return {
    fileName: `${name}.${extension}`,
    asciiName: `version-${number}-${ascii}.${extension}`,
  };
}

/** The lessons of a weekday by start, then by unit. */
function lessonsOn(print: PatternPrint, weekday: Weekday): PatternLesson[] {
  return print.lessons
    .filter((one) => one.weekday === weekday)
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        a.unit.name.localeCompare(b.unit.name) ||
        a.id.localeCompare(b.id),
    );
}

// ---------------------------------------------------------------- Excel

/** The column keys of the Excel file, in their order (the `X-Export-Columns` header). */
export const PATTERN_SHEET_COLUMNS = [
  'weekday',
  'lessonNumber',
  'start',
  'end',
  'unit',
  'subject',
  'teacher',
  'room',
] as const;

/** The Excel sheet: the title and the stamp as a preamble, then one row per lesson, by weekday and time. */
export function patternSheet(
  print: PatternPrint,
  texts: PatternFileTexts,
  language: Language,
  stamp: PrintStamp,
): Sheet {
  const c = texts.view.columns;
  const rows = print.days.flatMap((day) =>
    lessonsOn(print, day.weekday).map((lesson): Cell[] => [
      texts.view.weekdays[lesson.weekday],
      lesson.lessonNumber,
      { time: lesson.start },
      { time: lesson.end },
      lesson.unit.name,
      lesson.subject[language],
      lesson.teacher,
      lesson.room ?? '',
    ]),
  );
  return {
    name: texts.view.sheet,
    // DRAFT or "Archived" first, then the title (decisions 2 and 4).
    preamble: (() => {
      const lines = stampLines(print, texts, stamp);
      const marked = print.version.status !== 'published';
      return marked
        ? [lines[0] ?? '', titleOf(print, texts), ...lines.slice(1)]
        : [titleOf(print, texts), ...lines];
    })(),
    headings: [c.weekday, c.lessonNumber, c.start, c.end, c.unit, c.subject, c.teacher, c.room],
    rows,
  };
}

// ---------------------------------------------------------------- PDF

const time = (item: { start: number; end: number }) =>
  `${timeText(item.start)}–${timeText(item.end)}`;

/** A lesson in a cell: the subject, then what the kind does not already name. */
function lessonHtml(lesson: PatternLesson, kind: ViewKind, language: Language): string {
  const parts = [
    ...(kind === 'class' || kind === 'branch' ? [] : [lesson.unit.name]),
    ...(kind === 'teacher' ? [] : [lesson.teacher]),
    ...(kind === 'room' ? [] : [lesson.room ?? '']),
  ].filter((part) => part !== '');
  return `<div class="item"><b>${escapeHtml(lesson.subject[language])}</b>${
    parts.length === 0 ? '' : `<br>${parts.map(escapeHtml).join(' · ')}`
  }</div>`;
}

const inSlot = (lessons: readonly PatternLesson[], slot: PatternSlot) =>
  lessons.filter((one) => one.start < slot.end && slot.start < one.end);

const dayName = (day: { weekday: Weekday }, texts: PatternFileTexts) =>
  escapeHtml(texts.view.weekdays[day.weekday]);

/** A class, teacher or room week as a grid: lesson numbers down, weekdays across. */
function weekGrid(print: PatternPrint, texts: PatternFileTexts, language: Language): string {
  const numbers = [
    ...new Set(print.days.flatMap((day) => day.slots.map((slot) => slot.lessonNumber))),
  ].sort((a, b) => a - b);
  const head = print.days.map((day) => `<th><h2>${dayName(day, texts)}</h2></th>`).join('');
  const placed = new Set<string>();
  const body = numbers
    .map((number) => {
      const cells = print.days
        .map((day) => {
          const slot = day.slots.find((one) => one.lessonNumber === number);
          if (slot === undefined) return '<td></td>';
          const lessons = inSlot(lessonsOn(print, day.weekday), slot);
          for (const one of lessons) placed.add(one.id);
          return `<td><div class="slot">${time(slot)}</div>${lessons
            .map((one) => lessonHtml(one, print.kind, language))
            .join('')}</td>`;
        })
        .join('');
      return `<tr><th class="num">${String(number)}</th>${cells}</tr>`;
    })
    .join('');
  // A lesson that meets no lesson slot of the day is listed under the grid.
  const rest = print.days.flatMap((day) =>
    lessonsOn(print, day.weekday).filter((one) => !placed.has(one.id)),
  );
  const restHtml =
    rest.length === 0
      ? ''
      : `<table class="list"><tbody>${rest
          .map(
            (one) =>
              `<tr><td class="time">${escapeHtml(texts.view.weekdays[one.weekday])} ${time(one)}</td><td>${lessonHtml(one, print.kind, language)}</td></tr>`,
          )
          .join('')}</tbody></table>`;
  return `<table class="grid"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>${restHtml}`;
}

/** A week on the clock axis: each weekday a list by time. */
function weekLists(print: PatternPrint, texts: PatternFileTexts, language: Language): string {
  return print.days
    .map((day) => {
      const lessons = lessonsOn(print, day.weekday);
      const rows =
        lessons.length === 0
          ? `<tr><td colspan="3" class="quiet">${escapeHtml(texts.view.noLessons)}</td></tr>`
          : lessons
              .map(
                (one) =>
                  `<tr><td class="num">${one.lessonNumber === null ? '' : String(one.lessonNumber)}</td><td class="time">${time(one)}</td><td>${lessonHtml(one, print.kind, language)}</td></tr>`,
              )
              .join('');
      return `<section><div class="day"><h2>${dayName(day, texts)}</h2></div><table class="list"><tbody>${rows}</tbody></table></section>`;
    })
    .join('');
}

/**
 * A weekday of the whole school: a row for each class, its own lesson
 * numbers across; a list by time per class when the classes' templates
 * differ in time that day.
 */
function schoolDay(
  print: PatternPrint,
  day: PatternDay,
  texts: PatternFileTexts,
  language: Language,
): string {
  const lessons = lessonsOn(print, day.weekday);
  const ofClass = (classId: string) => lessons.filter((one) => one.unit.classIds.includes(classId));
  const heading = `<div class="day"><h2>${dayName(day, texts)}</h2></div>`;
  if (day.axis === 'clock' || day.slots.length === 0) {
    const rows = print.classes
      .map(
        (one) =>
          `<tr><th>${escapeHtml(one.name)}</th><td>${ofClass(one.id)
            .map(
              (lesson) =>
                `<div class="time">${time(lesson)}</div>${lessonHtml(lesson, print.kind, language)}`,
            )
            .join('')}</td></tr>`,
      )
      .join('');
    return `<section>${heading}<table class="grid"><tbody>${rows}</tbody></table></section>`;
  }
  const head = day.slots
    .map((slot) => `<th>${String(slot.lessonNumber)}<div class="slot">${time(slot)}</div></th>`)
    .join('');
  const rows = print.classes
    .map((one) => {
      const own = ofClass(one.id);
      return `<tr><th>${escapeHtml(one.name)}</th>${day.slots
        .map(
          (slot) =>
            `<td>${inSlot(own, slot)
              .map((lesson) => lessonHtml(lesson, print.kind, language))
              .join('')}</td>`,
        )
        .join('')}</tr>`;
    })
    .join('');
  return `<section>${heading}<table class="grid"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></section>`;
}

/**
 * The HTML the server prints (`docs/design-system.md`, Printouts and PDFs):
 * A4 landscape, the letterhead strip and Golos Text of 5.9c-1; the stamp
 * under the title and in the bottom margin box of every page; a draft's grey
 * DRAFT at the top right of every page (decision 4). The school starts each
 * weekday on a page of its own, as the school week of 5.9c-1.
 */
export function patternHtml(
  print: PatternPrint,
  texts: PatternFileTexts,
  language: Language,
  stamp: PrintStamp,
): string {
  const body =
    print.kind === 'branch'
      ? print.days
          .map((day) => schoolDay(print, day, texts, language))
          .join('<div class="next-day"></div>')
      : print.lessons.length === 0
        ? `<p class="quiet">${escapeHtml(texts.view.noLessons)}</p>`
        : print.days.some((day) => day.axis === 'clock')
          ? weekLists(print, texts, language)
          : weekGrid(print, texts, language);
  const lines = stampLines(print, texts, stamp);
  return printHtml({
    language,
    title: titleOf(print, texts),
    landscape: true,
    stamp: lines,
    bottomLeft: lines.join(' · '),
    ...(print.version.status === 'draft' ? { topRight: texts.pattern.draft } : {}),
    page: texts.view.page,
    body,
  });
}
