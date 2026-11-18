import { DIGEST_TEXTS, type DigestTexts, type Language } from '@sodiq/shared';
import type { SubjectNames } from './digest-read.js';

/**
 * Task 11.5 (pull request #299): the text of a digest from the templates of the three languages
 * (`10`, Language), in the parent's language. A child is named by first name and class only;
 * nothing else of a person is in it (`10`, Privacy). Pure: the send passes what it read.
 */

/** Telegram's limit for the text of one message (Bot API, `sendMessage`). */
export const TELEGRAM_TEXT_LIMIT = 4096;

export type ListedState = 'new' | 'corrected' | 'removed';

/** The attendance summary of a child's period: counts only (plan decision 4). */
export interface AttendanceSummary {
  /** Held lessons of the period, exempt left out, marked. */
  readonly marked: number;
  /** Of them, present or late. */
  readonly attended: number;
  /** Of them, late. */
  readonly late: number;
  /** Held lessons of the period, exempt left out, not marked yet. */
  readonly unmarked: number;
}

export interface ListedMark {
  readonly date: string | null;
  readonly subject: SubjectNames | null;
  /** `null` for "removed". */
  readonly mark: number | null;
  readonly state: ListedState;
}

export interface ListedScore {
  readonly date: string | null;
  readonly subject: SubjectNames | null;
  /** "Classwork 1", a title, or the rating exam. */
  readonly work:
    | {
        readonly kind: 'classwork' | 'homework';
        readonly position: number;
        readonly title: string | null;
      }
    | { readonly kind: 'rating' };
  readonly score: number | null;
  readonly total: number | null;
  readonly state: ListedState;
}

export interface ListedComment {
  readonly date: string | null;
  readonly subject: SubjectNames | null;
  readonly body: string | null;
  readonly state: ListedState;
}

export interface ChildPart {
  readonly firstName: string;
  readonly className: string | null;
  readonly summary: AttendanceSummary;
  readonly marks: readonly ListedMark[];
  readonly scores: readonly ListedScore[];
  readonly comments: readonly ListedComment[];
}
/** Telegram HTML (`parse_mode: HTML`): only `<`, `>` and `&` need escaping. */
export function escapeHtml(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

const bold = (value: string): string => `<b>${escapeHtml(value)}</b>`;

/**
 * One sign before each section heading, the same in every language (owner, 18 November 2026: "a
 * couple of emoji if necessary"). Nothing else in the message carries one.
 */
export const SECTION_SIGNS = { attendance: '📅', grades: '📝', comments: '💬' } as const;

const heading = (sign: string, value: string): string => `${sign} ${bold(value)}`;
const italic = (value: string): string => `<i>${escapeHtml(value)}</i>`;

const parseDate = (date: string): { day: number; month: number } => {
  const [, month, day] = date.split('-');
  return { day: Number(day), month: Number(month) - 1 };
};

const shortDate = (texts: DigestTexts, date: string | null): string | null => {
  if (date === null) return null;
  const { day, month } = parseDate(date);
  return texts.shortDate(day, month);
};

const subjectText = (names: SubjectNames | null, language: Language): string | null =>
  names === null ? null : names[language];

const head = (...parts: (string | null)[]): string =>
  parts.filter((one): one is string => one !== null && one !== '').join(', ');

/** The attendance summary: one plain sentence under the "Attendance" heading. */
export function summaryLine(texts: DigestTexts, summary: AttendanceSummary): string {
  const held = summary.marked + summary.unmarked;
  if (held === 0) return texts.noLessons;
  if (summary.marked === 0) return texts.notYetEntered(held);
  if (summary.attended === summary.marked) {
    return summary.late === 0
      ? texts.attendedAllOnTime(summary.marked)
      : texts.attendedAllLate(summary.marked, summary.late);
  }
  return texts.attendedSome(summary.attended, summary.marked);
}

/** A value with its state, already HTML. */
const withState = (texts: DigestTexts, html: string, state: ListedState): string =>
  state === 'removed'
    ? escapeHtml(texts.removed)
    : state === 'corrected'
      ? `${html} (${escapeHtml(texts.corrected)})`
      : html;

const markText = (texts: DigestTexts, mark: number | null): string =>
  mark === 0 ? texts.absent : mark === 3 ? texts.skipped : mark === 2 ? texts.late : texts.present;

/** A comment on one line: a teacher's line breaks and runs of spaces become one space. */
const oneLine = (body: string): string => body.replace(/\s+/gu, ' ').trim();

/** A list line: `• <date>, <subject>[, <work>] — <value>`. The date comes first, as it is sorted. */
const item = (where: string, value: string): string => `• ${escapeHtml(where)} — ${value}`;

/**
 * The part of one child, as Telegram HTML: the name and class in bold, then the attendance
 * summary with each absence and late arrival, the grades, and the comments, each section under
 * a bold heading and parted by a blank line. Every line holds whole tags, so a split at a line
 * end never cuts one.
 */
export function childText(language: Language, part: ChildPart): string {
  const texts = DIGEST_TEXTS[language];
  const name =
    part.className === null || part.className === ''
      ? bold(part.firstName)
      : `${bold(part.firstName)} · ${escapeHtml(part.className)}`;
  const sections: string[] = [name];

  const attendance = [
    heading(SECTION_SIGNS.attendance, texts.attendanceHeading),
    escapeHtml(summaryLine(texts, part.summary)),
  ];
  for (const one of part.marks) {
    const where = head(shortDate(texts, one.date), subjectText(one.subject, language));
    attendance.push(
      item(where, withState(texts, escapeHtml(markText(texts, one.mark)), one.state)),
    );
  }
  sections.push(attendance.join('\n'));

  if (part.scores.length > 0) {
    const grades = [heading(SECTION_SIGNS.grades, texts.gradesHeading)];
    for (const one of part.scores) {
      const work =
        one.work.kind === 'rating'
          ? texts.ratingExam
          : (one.work.title ??
            (one.work.kind === 'homework'
              ? texts.homework(one.work.position)
              : texts.classwork(one.work.position)));
      const where = head(shortDate(texts, one.date), subjectText(one.subject, language), work);
      const value = bold(`${String(one.score ?? '')}/${String(one.total ?? '')}`);
      grades.push(item(where, withState(texts, value, one.state)));
    }
    sections.push(grades.join('\n'));
  }

  if (part.comments.length > 0) {
    // The comments of one lesson (the same date and subject) under one line: the list is sorted
    // by date, then subject, so they come together.
    const comments = [heading(SECTION_SIGNS.comments, texts.commentsHeading)];
    let previous: string | null = null;
    for (const one of part.comments) {
      const where = head(shortDate(texts, one.date), subjectText(one.subject, language));
      if (where !== previous) {
        comments.push(`• ${escapeHtml(where)}`);
        previous = where;
      }
      const body =
        one.state === 'removed'
          ? escapeHtml(texts.commentRemoved)
          : withState(texts, italic(oneLine(one.body ?? '')), one.state);
      comments.push(`— ${body}`);
    }
    sections.push(comments.join('\n'));
  }
  return sections.join('\n\n');
}

/** The line between two children's parts of one message. */
export const CHILD_RULE = '──────────';

/**
 * The whole digest, as Telegram HTML: the digest and its date in bold, what it covers, then each
 * child's part; with more than one child a thin rule parts them. `first`: no digest before this
 * one, so it covers what was saved since the chat was linked (`10`, What it holds).
 */
export function digestText(
  language: Language,
  date: string,
  parts: readonly ChildPart[],
  first = false,
): string {
  const texts = DIGEST_TEXTS[language];
  const { day, month } = parseDate(date);
  const top = `${bold(texts.title(texts.longDate(day, month)))}\n${escapeHtml(texts.covers(first))}`;
  return [
    top,
    ...parts.map((part, index) =>
      index === 0 ? childText(language, part) : `${CHILD_RULE}\n${childText(language, part)}`,
    ),
  ].join('\n\n');
}

/**
 * The cut of a line longer than the limit: its tags dropped (a cut inside `<i>…</i>` would leave
 * one open), and never inside an entity such as `&amp;`. Only a comment many times its own length
 * could reach it.
 */
function cutLine(line: string, limit: number): string[] {
  const plain = line.replace(/<[^>]*>/gu, '');
  const pieces: string[] = [];
  let start = 0;
  while (start < plain.length) {
    let end = Math.min(start + limit, plain.length);
    const amp = plain.lastIndexOf('&', end - 1);
    if (
      end < plain.length &&
      amp > start &&
      amp > end - 6 &&
      !plain.slice(amp, end).includes(';')
    ) {
      end = amp;
    }
    pieces.push(plain.slice(start, end));
    start = end;
  }
  return pieces;
}

/**
 * The text cut into messages of at most `limit` characters (plan decision 13): between
 * children's parts and sections first, then at line ends, and only a line longer than the limit is
 * cut inside. Each line holds whole tags, so every message is valid HTML.
 */
export function splitText(text: string, limit: number = TELEGRAM_TEXT_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const messages: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current !== '') messages.push(current);
    current = '';
  };
  // A message never opens with the rule between children.
  const open = (piece: string): string =>
    piece === CHILD_RULE
      ? ''
      : piece.startsWith(`${CHILD_RULE}\n`)
        ? piece.slice(CHILD_RULE.length + 1)
        : piece;
  const add = (piece: string, joiner: string): void => {
    if (current === '') {
      current = open(piece);
    } else if (current.length + joiner.length + piece.length <= limit) {
      current = `${current}${joiner}${piece}`;
    } else {
      flush();
      current = open(piece);
    }
  };
  for (const block of text.split('\n\n')) {
    if (block.length <= limit) {
      add(block, '\n\n');
      continue;
    }
    flush();
    for (const line of block.split('\n')) {
      if (line.length <= limit) {
        add(line, '\n');
        continue;
      }
      flush();
      messages.push(...cutLine(line, limit));
    }
    flush();
  }
  flush();
  return messages;
}
