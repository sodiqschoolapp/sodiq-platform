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

/** A child's part in blocks: the name line, then each section as its lines (heading first). */
export interface ChildBlocks {
  readonly name: string;
  readonly sections: readonly (readonly string[])[];
}

/**
 * The part of one child, as Telegram HTML: the name and class in bold, then the attendance
 * summary with each absence and late arrival, the grades, and the comments, each section under
 * a bold heading. Every line holds whole tags, so a split at a line end never cuts one.
 */
export function childBlocks(language: Language, part: ChildPart): ChildBlocks {
  const texts = DIGEST_TEXTS[language];
  const name =
    part.className === null || part.className === ''
      ? bold(part.firstName)
      : `${bold(part.firstName)} · ${escapeHtml(part.className)}`;
  const sections: string[][] = [];

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
  sections.push(attendance);

  if (part.scores.length > 0) {
    const grades = [heading(SECTION_SIGNS.grades, texts.gradesHeading)];
    for (const one of part.scores) {
      const work =
        one.work.kind === 'rating'
          ? texts.ratingExam
          : one.work.title === null
            ? one.work.kind === 'homework'
              ? texts.homework(one.work.position)
              : texts.classwork(one.work.position)
            : texts.kindTitle(one.work.kind, one.work.title);
      const where = head(shortDate(texts, one.date), subjectText(one.subject, language), work);
      const value = bold(`${String(one.score ?? '')}/${String(one.total ?? '')}`);
      grades.push(item(where, withState(texts, value, one.state)));
    }
    sections.push(grades);
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
    sections.push(comments);
  }
  return { name, sections };
}

const blocksText = (blocks: ChildBlocks): string =>
  [blocks.name, ...blocks.sections.map((lines) => lines.join('\n'))].join('\n\n');

/** The part of one child as one text: the name, then the sections parted by a blank line. */
export function childText(language: Language, part: ChildPart): string {
  return blocksText(childBlocks(language, part));
}

/** The line between two children's parts of one message. */
export const CHILD_RULE = '──────────';

/** The first two lines: the digest and its date in bold, then what it covers. */
function topText(language: Language, date: string, first: boolean): string {
  const texts = DIGEST_TEXTS[language];
  const { day, month } = parseDate(date);
  return `${bold(texts.title(texts.longDate(day, month)))}\n${escapeHtml(texts.covers(first))}`;
}

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
  return [
    topText(language, date, first),
    ...parts.map((part, index) =>
      index === 0 ? childText(language, part) : `${CHILD_RULE}\n${childText(language, part)}`,
    ),
  ].join('\n\n');
}

/** The digest as the messages to send, each at most `limit` characters (`splitDigest`). */
export function digestMessages(
  language: Language,
  date: string,
  parts: readonly ChildPart[],
  first = false,
  limit: number = TELEGRAM_TEXT_LIMIT,
): string[] {
  return splitDigest(
    topText(language, date, first),
    parts.map((part) => childBlocks(language, part)),
    limit,
  );
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
 * The digest cut into messages of at most `limit` characters (decision 13 of task 11.5: "between
 * children first, then at line ends"):
 *
 * 1. whole children's parts, as many as fit in a message, the rule above every one that does not
 *    open a message;
 * 2. a part that does not fit in one message is cut between its sections, then at line ends, and
 *    every message of it opens with the child's name, so no section is ever read without the name
 *    of its child (`10`, Privacy; review of pull request #355). A section cut at a line end repeats
 *    its heading under the name;
 * 3. only a line longer than what is left is cut inside (`cutLine`).
 *
 * Each line holds whole tags, so every message is valid HTML.
 */
export function splitDigest(
  top: string,
  children: readonly ChildBlocks[],
  limit: number = TELEGRAM_TEXT_LIMIT,
): string[] {
  const messages: string[] = [];
  let current = top;
  const push = (): void => {
    if (current !== '') messages.push(current);
    current = '';
  };
  const fits = (joiner: string, piece: string): boolean =>
    current.length + joiner.length + piece.length <= limit;

  children.forEach((child, index) => {
    const whole = blocksText(child);
    // 1. The whole part beside what is before it, or opening a message of its own.
    const ruled = index === 0 ? whole : `${CHILD_RULE}\n${whole}`;
    if (current !== '' && fits('\n\n', ruled)) {
      current = `${current}\n\n${ruled}`;
      return;
    }
    push();
    if (whole.length <= limit) {
      current = whole;
      return;
    }
    // 2. The part cut: each of its messages opens with the name.
    current = child.name;
    for (const lines of child.sections) {
      if (current === '') current = child.name;
      const block = lines.join('\n');
      if (fits('\n\n', block)) {
        current = `${current}\n\n${block}`;
        continue;
      }
      if (current !== child.name && child.name.length + 2 + block.length <= limit) {
        push();
        current = `${child.name}\n\n${block}`;
        continue;
      }
      // The section cut at line ends; a later message repeats the name and the heading.
      const heading = lines[0] ?? '';
      const reopen = `${child.name}\n\n${heading}`;
      // A message never closes on the name alone, nor on a heading with no line under it: that
      // heading moves to the next message, which opens with the name and the heading.
      const restart = (at: number): void => {
        const dangling = at === 1 && current.endsWith(`\n\n${heading}`);
        const kept = dangling ? current.slice(0, -(heading.length + 2)) : current;
        if (kept !== '' && kept !== child.name) messages.push(kept);
        current = '';
      };
      lines.forEach((line, at) => {
        const joiner = at === 0 ? '\n\n' : '\n';
        if (current !== '' && fits(joiner, line)) {
          current = `${current}${joiner}${line}`;
          return;
        }
        restart(at);
        const prefix = at === 0 ? child.name : reopen;
        if (prefix.length + joiner.length + line.length <= limit) {
          current = `${prefix}${joiner}${line}`;
          return;
        }
        // 3. A line longer than what is left.
        for (const piece of cutLine(line, Math.max(1, limit - prefix.length - joiner.length))) {
          messages.push(`${prefix}${joiner}${piece}`);
        }
      });
    }
  });
  push();
  return messages;
}
