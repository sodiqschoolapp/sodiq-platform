import {
  fillText,
  timeText,
  type Language,
  type TimetableView,
  type ViewBusy,
  type ViewDay,
  type ViewExam,
  type ViewExportTexts,
  type ViewLesson,
} from '@sodiq/shared';
import type { Cell, Sheet } from '../../http/xlsx.js';
import {
  letterheadLogo,
  PDF_FONT_FAMILY,
  pdfFontFaces,
  UZBEK_MARK_FAMILY,
} from '../../http/pdf.js';

/**
 * The printout and the Excel file of a timetable view (task 5.9c-1, pull
 * request #199), both built from the answer of the 5.9a view and nothing else
 * (decision 7; `06`, One source). Every text comes from `VIEW_EXPORT_TEXTS`
 * in the language of the account (correction 1); names are as entered.
 */

/** What the file says about the moment it shows (decision 8). */
export interface FileStamp {
  /** The moment of the request in branch time, `DD.MM.YYYY HH:MM`. */
  asOf: string;
}

/** One thing of a day: a lesson, an exam, or a busy block of another branch. */
type Item =
  | { kind: 'lesson'; start: number; end: number; lesson: ViewLesson }
  | { kind: 'exam'; start: number; end: number; exam: ViewExam }
  | { kind: 'busy'; start: number; end: number; busy: ViewBusy };

function itemsOf(view: TimetableView, date: string): Item[] {
  return [
    ...view.lessons
      .filter((one) => one.date === date)
      .map((lesson) => ({ kind: 'lesson' as const, start: lesson.start, end: lesson.end, lesson })),
    ...view.exams
      .filter((one) => one.date === date)
      .map((exam) => ({ kind: 'exam' as const, start: exam.start, end: exam.end, exam })),
    ...view.busy
      .filter((one) => one.date === date)
      .map((busy) => ({ kind: 'busy' as const, start: busy.start, end: busy.end, busy })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** A school date as `DD.MM.YYYY`, the same in the three languages. */
export function dateText(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day ?? ''}.${month ?? ''}.${year ?? ''}`;
}

/** The ISO weekday of a school date, Monday 1 to Sunday 7. */
function weekdayOf(date: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** The marks of a lesson, as the views page writes them (5.9a): cancelled, replaced, needs, changed. */
export function lessonMarks(lesson: ViewLesson, texts: ViewExportTexts): string[] {
  return [
    ...(lesson.cancelCause === 'reason'
      ? [fillText(texts.cancelledReason, { reason: lesson.cancelReason ?? '' })]
      : lesson.cancelCause !== null
        ? [texts.causes[lesson.cancelCause]]
        : []),
    ...(lesson.replacedHere && lesson.teacher !== null
      ? [fillText(texts.replacedBy, { name: lesson.teacher.name })]
      : []),
    ...(!lesson.replacedHere && lesson.substitution?.replaced
      ? [fillText(texts.substituteFor, { name: lesson.substitution.replaced.name })]
      : []),
    ...(lesson.teacher === null || lesson.away !== null ? [texts.needsTeacher] : []),
    ...(lesson.room === null || lesson.roomOut !== null ? [texts.needsRoom] : []),
    ...(lesson.changed ? [texts.changed] : []),
  ];
}

/** The teacher a lesson shows: the one replaced on the replaced teacher's view (5.9a, decision 8). */
const teacherOf = (lesson: ViewLesson): string =>
  lesson.replacedHere ? (lesson.substitution?.replaced?.name ?? '') : (lesson.teacher?.name ?? '');

/** The lines under a day's date: its version and "valid from", or why it has none (decision 9). */
export function dayLines(day: ViewDay, texts: ViewExportTexts): string[] {
  return [
    ...(day.outsideYear ? [texts.outsideYear] : []),
    ...(!day.outsideYear && day.version === null ? [texts.noVersion] : []),
    ...(day.version === null
      ? []
      : [
          `${fillText(texts.version, { number: String(day.version.number) })}, ${fillText(
            texts.validFrom,
            { date: dateText(day.version.startsOn) },
          )}`,
        ]),
    ...(day.dayOff === null ? [] : [fillText(texts.dayOff, { name: day.dayOff })]),
    // `edge/timetable`, "The wall timetable is out of date": a day read from
    // its pattern does not hold the one-day changes (spec review must-fix 1).
    ...(day.fromPattern ? [texts.fromPattern] : []),
  ];
}

/** The title of the file: the kind, the class, teacher or room, the span and its dates. */
function titleOf(view: TimetableView, texts: ViewExportTexts): string {
  const first = view.days[0]?.date ?? view.today;
  const last = view.days[view.days.length - 1]?.date ?? first;
  const dates = first === last ? dateText(first) : `${dateText(first)} – ${dateText(last)}`;
  return [texts.titles[view.kind], view.subject?.name, `${texts.spans[view.span]} ${dates}`]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ');
}

/** The file name: `<view>-<name>-<date>.<ext>` (decision 10). */
export function fileNameOf(
  view: TimetableView,
  texts: ViewExportTexts,
  ascii: string,
  extension: 'pdf' | 'xlsx',
): { fileName: string; asciiName: string } {
  const date = view.days[0]?.date ?? view.today;
  const name = view.subject?.name ?? '';
  const join = (first: string) =>
    [first, name, date]
      .filter((part) => part !== '')
      .join('-')
      .replace(/\s+/g, '-');
  return {
    fileName: `${join(texts.fileNames[view.kind])}.${extension}`,
    asciiName: `${ascii}-${date}.${extension}`,
  };
}

// ---------------------------------------------------------------- Excel

/**
 * The Excel file (decision 11): the title, "as of" and the version of each
 * day above the heading row; one row per lesson, exam or busy block with date
 * and time cells; one row for a day that holds nothing and is a day off,
 * outside the year or without a published version.
 */
export function viewSheet(
  view: TimetableView,
  texts: ViewExportTexts,
  language: Language,
  stamp: FileStamp,
): Sheet {
  const c = texts.columns;
  const versions = [
    ...new Map(
      view.days.flatMap((day) =>
        day.version === null ? [] : [[day.version.number, day.version] as const],
      ),
    ).values(),
  ].map(
    (version) =>
      `${fillText(texts.version, { number: String(version.number) })}, ${fillText(texts.validFrom, {
        date: dateText(version.startsOn),
      })}`,
  );
  const rows: Cell[][] = [];
  for (const day of view.days) {
    const version: Cell[] =
      day.version === null ? [null, null] : [day.version.number, { date: day.version.startsOn }];
    const base = (): Cell[] => [{ date: day.date }, texts.weekdays[weekdayOf(day.date)]];
    const pattern = day.fromPattern ? texts.fromPattern : null;
    const items = itemsOf(view, day.date);
    for (const item of items) {
      if (item.kind === 'lesson') {
        const { lesson } = item;
        rows.push([
          ...base(),
          lesson.lessonNumber,
          { time: lesson.start },
          { time: lesson.end },
          lesson.unit.name,
          lesson.subject.names[language],
          teacherOf(lesson),
          lesson.room?.name ?? '',
          texts.kinds.lesson,
          [...lessonMarks(lesson, texts), ...(pattern === null ? [] : [pattern])].join('; '),
          ...version,
        ]);
      } else if (item.kind === 'exam') {
        const { exam } = item;
        rows.push([
          ...base(),
          null,
          { time: exam.start },
          { time: exam.end },
          exam.rooms.flatMap((room) => room.units).join(', '),
          [exam.title, ...(exam.subject === null ? [] : [exam.subject.names[language]])].join(
            ' · ',
          ),
          exam.rooms.flatMap((room) => room.invigilators).join(', '),
          exam.rooms.map((room) => room.room.name).join(', '),
          texts.kinds.exam,
          pattern ?? '',
          ...version,
        ]);
      } else {
        rows.push([
          ...base(),
          null,
          { time: item.start },
          { time: item.end },
          '',
          '',
          '',
          '',
          texts.kinds.busy,
          fillText(texts.busyIn, { branch: item.busy.branch.name }),
          ...version,
        ]);
      }
    }
    if (items.length === 0 && (day.outsideYear || day.dayOff !== null || day.version === null)) {
      rows.push([
        ...base(),
        null,
        null,
        null,
        '',
        '',
        '',
        '',
        texts.kinds.day,
        dayLines(day, texts).join('; '),
        ...version,
      ]);
    }
  }
  return {
    name: texts.sheet,
    preamble: [titleOf(view, texts), fillText(texts.asOf, { moment: stamp.asOf }), ...versions],
    headings: [
      c.date,
      c.weekday,
      c.lessonNumber,
      c.start,
      c.end,
      c.unit,
      c.subject,
      c.teacher,
      c.room,
      c.kind,
      c.mark,
      c.version,
      c.validFrom,
    ],
    rows,
  };
}

// ---------------------------------------------------------------- PDF

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Every text of the printout goes through here (spec review should-fix 2): a
 * name typed as markup is printed as typed and never read as markup.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (one) => ESCAPES[one] ?? one);
}

/** A CSS string for `content:` in a margin box. */
const cssString = (text: string): string =>
  `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;

const time = (item: { start: number; end: number }) =>
  `${timeText(item.start)}–${timeText(item.end)}`;

/** The text of an item inside a cell of a grid or a row of a list. */
function itemHtml(
  item: Item,
  view: TimetableView,
  texts: ViewExportTexts,
  language: Language,
): string {
  if (item.kind === 'busy') {
    return `<div class="item busy">${escapeHtml(fillText(texts.busyIn, { branch: item.busy.branch.name }))}</div>`;
  }
  if (item.kind === 'exam') {
    const { exam } = item;
    const parts = [
      exam.title,
      ...(exam.subject === null ? [] : [exam.subject.names[language]]),
      ...(view.kind === 'class' || view.kind === 'branch'
        ? []
        : [exam.rooms.flatMap((room) => room.units).join(', ')]),
      ...(view.kind === 'room' ? [] : [exam.rooms.map((room) => room.room.name).join(', ')]),
      ...(view.kind === 'teacher'
        ? []
        : [exam.rooms.flatMap((room) => room.invigilators).join(', ')]),
    ].filter((part) => part !== '');
    return `<div class="item exam"><b>${escapeHtml(texts.exam)}</b> ${parts
      .map(escapeHtml)
      .join(' · ')}</div>`;
  }
  const { lesson } = item;
  const parts = [
    ...(view.kind === 'class' || view.kind === 'branch' ? [] : [lesson.unit.name]),
    ...(view.kind === 'teacher' ? [] : [teacherOf(lesson)]),
    ...(view.kind === 'room' ? [] : [lesson.room?.name ?? '']),
  ].filter((part) => part !== '');
  const marks = lessonMarks(lesson, texts);
  const cancelled = lesson.cancelCause !== null ? ' cancelled' : '';
  return `<div class="item${cancelled}"><b>${escapeHtml(lesson.subject.names[language])}</b>${
    parts.length === 0 ? '' : `<br>${parts.map(escapeHtml).join(' · ')}`
  }${marks.length === 0 ? '' : `<br><i>${marks.map(escapeHtml).join(' · ')}</i>`}</div>`;
}

function dayHeading(day: ViewDay, texts: ViewExportTexts): string {
  const lines = dayLines(day, texts);
  return `<div class="day"><h2>${escapeHtml(texts.weekdays[weekdayOf(day.date)])}, ${escapeHtml(
    dateText(day.date),
  )}</h2>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div>`;
}

/** A day as a list by time (a day view, or a day on the clock axis). */
function dayList(
  view: TimetableView,
  day: ViewDay,
  texts: ViewExportTexts,
  language: Language,
): string {
  const items = itemsOf(view, day.date);
  const rows =
    items.length === 0
      ? `<tr><td colspan="3" class="quiet">${escapeHtml(texts.noLessons)}</td></tr>`
      : items
          .map(
            (item) =>
              `<tr${item.kind === 'busy' ? ' class="busy"' : ''}><td class="num">${
                item.kind === 'lesson' && item.lesson.lessonNumber !== null
                  ? String(item.lesson.lessonNumber)
                  : ''
              }</td><td class="time">${time(item)}</td><td>${itemHtml(item, view, texts, language)}</td></tr>`,
          )
          .join('');
  return `<section>${dayHeading(day, texts)}<table class="list"><tbody>${rows}</tbody></table></section>`;
}

/** The items of a list that fall into a slot: their time meets the slot's. */
const inSlot = (items: readonly Item[], slot: { start: number; end: number }) =>
  items.filter((item) => item.start < slot.end && slot.start < item.end);

/** A week of one class, teacher or room as a grid: lesson numbers down, days across. */
function weekGrid(view: TimetableView, texts: ViewExportTexts, language: Language): string {
  const numbers = [
    ...new Set(view.days.flatMap((day) => day.slots.map((slot) => slot.lessonNumber))),
  ].sort((a, b) => a - b);
  const head = view.days.map((day) => `<th>${dayHeading(day, texts)}</th>`).join('');
  const placed = new Set<Item>();
  const body = numbers
    .map((number) => {
      const cells = view.days
        .map((day) => {
          const slot = day.slots.find((one) => one.lessonNumber === number);
          if (slot === undefined) return '<td></td>';
          const items = inSlot(itemsOf(view, day.date), slot);
          for (const item of items) placed.add(item);
          return `<td><div class="slot">${time(slot)}</div>${items
            .map((item) => itemHtml(item, view, texts, language))
            .join('')}</td>`;
        })
        .join('');
      return `<tr><th class="num">${String(number)}</th>${cells}</tr>`;
    })
    .join('');
  // Whatever meets no lesson slot (an exam after the last one) is listed under the grid.
  const rest = view.days.flatMap((day) =>
    itemsOf(view, day.date)
      .filter((item) => ![...placed].some((one) => sameItem(one, item)))
      .map((item) => ({ day, item })),
  );
  const restHtml =
    rest.length === 0
      ? ''
      : `<table class="list"><tbody>${rest
          .map(
            ({ day, item }) =>
              `<tr><td class="time">${escapeHtml(texts.weekdays[weekdayOf(day.date)])} ${time(item)}</td><td>${itemHtml(item, view, texts, language)}</td></tr>`,
          )
          .join('')}</tbody></table>`;
  return `<table class="grid"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>${restHtml}`;
}

const sameItem = (a: Item, b: Item): boolean =>
  a.kind === b.kind &&
  a.start === b.start &&
  a.end === b.end &&
  (a.kind === 'lesson' && b.kind === 'lesson'
    ? a.lesson.id === b.lesson.id
    : a.kind === 'exam' && b.kind === 'exam'
      ? a.exam.id === b.exam.id
      : true);

/** A day of the whole school: a row for each class, lesson numbers across (a list on the clock axis). */
function schoolDay(
  view: TimetableView,
  day: ViewDay,
  texts: ViewExportTexts,
  language: Language,
): string {
  const items = itemsOf(view, day.date);
  const ofClass = (classId: string) =>
    items.filter((item) =>
      item.kind === 'lesson'
        ? item.lesson.classIds.includes(classId)
        : item.kind === 'exam'
          ? item.exam.rooms.some((room) => room.classIds.includes(classId))
          : false,
    );
  if (day.axis === 'clock' || day.slots.length === 0) {
    const rows = view.classes
      .map(
        (one) =>
          `<tr><th>${escapeHtml(one.name)}</th><td>${ofClass(one.id)
            .map(
              (item) =>
                `<div class="time">${time(item)}</div>${itemHtml(item, view, texts, language)}`,
            )
            .join('')}</td></tr>`,
      )
      .join('');
    return `<section>${dayHeading(day, texts)}<table class="grid"><tbody>${rows}</tbody></table></section>`;
  }
  const head = day.slots
    .map((slot) => `<th>${String(slot.lessonNumber)}<div class="slot">${time(slot)}</div></th>`)
    .join('');
  const rows = view.classes
    .map((one) => {
      const own = ofClass(one.id);
      return `<tr><th>${escapeHtml(one.name)}</th>${day.slots
        .map(
          (slot) =>
            `<td>${inSlot(own, slot)
              .map((item) => itemHtml(item, view, texts, language))
              .join('')}</td>`,
        )
        .join('')}</tr>`;
    })
    .join('');
  return `<section>${dayHeading(day, texts)}<table class="grid"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></section>`;
}

/**
 * The HTML the server prints (decision 12; `docs/design-system.md`,
 * Printouts and PDFs): A4, landscape for a week and the school; Golos Text
 * with the Uzbek mark face, navy text, grey busy blocks; the letterhead strip
 * on every page as a fixed element; "As of" and the page number in the
 * bottom margin boxes of every page, which use the document's fonts
 * (correction 3).
 */
export function viewHtml(
  view: TimetableView,
  texts: ViewExportTexts,
  language: Language,
  stamp: FileStamp,
): string {
  const landscape = view.span === 'week' || view.kind === 'branch';
  const body =
    view.kind === 'branch'
      ? view.days.map((day) => schoolDay(view, day, texts, language)).join('')
      : view.span === 'day' || view.days.some((day) => day.axis === 'clock')
        ? view.days.map((day) => dayList(view, day, texts, language)).join('')
        : weekGrid(view, texts, language);
  const asOf = fillText(texts.asOf, { moment: stamp.asOf });
  const page = texts.page.split('{{page}}');
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(titleOf(view, texts))}</title>
<style>
${pdfFontFaces()}
@page {
  size: A4 ${landscape ? 'landscape' : 'portrait'};
  margin: 28mm 10mm 14mm;
  @bottom-left { content: ${cssString(asOf)}; font-family: '${PDF_FONT_FAMILY}', '${UZBEK_MARK_FAMILY}'; font-size: 8pt; color: #06113C; }
  @bottom-right { content: ${cssString(page[0] ?? '')} counter(page) ${cssString(page[1] ?? '')}; font-family: '${PDF_FONT_FAMILY}', '${UZBEK_MARK_FAMILY}'; font-size: 8pt; color: #06113C; }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: #FFFFFF; color: #06113C; font-family: '${PDF_FONT_FAMILY}', '${UZBEK_MARK_FAMILY}'; font-size: 8.5pt; font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.letterhead { position: fixed; top: -22mm; left: 0; right: 0; }
.letterhead .tab { display: inline-flex; align-items: center; height: 14mm; padding: 0 6mm; background: #06113C; border-top-right-radius: 4mm; }
.letterhead .tab svg { height: 10mm; width: auto; display: block; }
.letterhead .band { height: 2mm; background: #FF8A32; }
h1 { font-size: 13pt; margin: 0 0 1mm; }
.stamp { margin: 0 0 3mm; }
h2 { font-size: 9.5pt; margin: 0; }
.day p { margin: 0; font-weight: 400; }
section { break-inside: avoid-page; margin-bottom: 4mm; }
table { border-collapse: collapse; width: 100%; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { border: 0.3mm solid #CDD1DD; padding: 1.2mm; vertical-align: top; text-align: left; }
th { font-weight: 600; }
.num { width: 8mm; text-align: center; }
.time, .slot { white-space: nowrap; color: #4A5270; }
.item + .item { margin-top: 1mm; padding-top: 1mm; border-top: 0.2mm dashed #CDD1DD; }
.cancelled b { text-decoration: line-through; }
.busy, tr.busy td { background: #F6F6F6; color: #4A5270; }
.quiet { color: #4A5270; }
</style>
</head>
<body>
<div class="letterhead"><div class="tab">${letterheadLogo()}</div><div class="band"></div></div>
<h1>${escapeHtml(titleOf(view, texts))}</h1>
<p class="stamp">${escapeHtml(asOf)}</p>
${body}
</body>
</html>`;
}
