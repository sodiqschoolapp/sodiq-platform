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

const dateText = (texts: DigestTexts, date: string | null): string | null => {
  if (date === null) return null;
  const [, month, day] = date.split('-');
  return `${String(Number(day))} ${texts.months[Number(month) - 1] ?? ''}`;
};

const subjectText = (names: SubjectNames | null, language: Language): string | null =>
  names === null ? null : names[language];

const head = (...parts: (string | null)[]): string =>
  parts.filter((one): one is string => one !== null && one !== '').join(', ');

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

const stateText = (texts: DigestTexts, value: string, state: ListedState): string =>
  state === 'removed'
    ? texts.removed
    : state === 'corrected'
      ? `${value} (${texts.corrected})`
      : value;

const markText = (texts: DigestTexts, mark: number | null): string =>
  mark === 0 ? texts.absent : mark === 3 ? texts.skipped : mark === 2 ? texts.late : texts.present;

/** The part of one child: its name line, the summary, then each list that is not empty. */
export function childText(language: Language, part: ChildPart): string {
  const texts = DIGEST_TEXTS[language];
  const lines: string[] = [head(part.firstName, part.className), summaryLine(texts, part.summary)];
  if (part.marks.length > 0) {
    lines.push(texts.absencesHeading);
    for (const one of part.marks) {
      const where = head(subjectText(one.subject, language), dateText(texts, one.date));
      lines.push(`• ${where}: ${stateText(texts, markText(texts, one.mark), one.state)}`);
    }
  }
  if (part.scores.length > 0) {
    lines.push(texts.gradesHeading);
    for (const one of part.scores) {
      const work =
        one.work.kind === 'rating'
          ? texts.ratingExam
          : (one.work.title ??
            (one.work.kind === 'homework'
              ? texts.homework(one.work.position)
              : texts.classwork(one.work.position)));
      const where = head(subjectText(one.subject, language), work, dateText(texts, one.date));
      const value = `${String(one.score ?? '')}/${String(one.total ?? '')}`;
      lines.push(`• ${where}: ${stateText(texts, value, one.state)}`);
    }
  }
  if (part.comments.length > 0) {
    lines.push(texts.commentsHeading);
    for (const one of part.comments) {
      const where = head(subjectText(one.subject, language), dateText(texts, one.date));
      lines.push(`• ${where}: ${stateText(texts, `«${one.body ?? ''}»`, one.state)}`);
    }
  }
  return lines.join('\n');
}

/** The whole digest: the title, then each child's part, a blank line between. */
export function digestText(language: Language, date: string, parts: readonly ChildPart[]): string {
  const texts = DIGEST_TEXTS[language];
  return [
    texts.title(dateText(texts, date) ?? date),
    ...parts.map((part) => childText(language, part)),
  ].join('\n\n');
}

/**
 * The text cut into messages of at most `limit` characters (plan decision 13): between
 * children's parts first, then at line ends, and only a line longer than the limit is cut inside.
 */
export function splitText(text: string, limit: number = TELEGRAM_TEXT_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const messages: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current !== '') messages.push(current);
    current = '';
  };
  const add = (piece: string, joiner: string): void => {
    if (current === '') {
      current = piece;
    } else if (current.length + joiner.length + piece.length <= limit) {
      current = `${current}${joiner}${piece}`;
    } else {
      flush();
      current = piece;
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
      for (let start = 0; start < line.length; start += limit) {
        messages.push(line.slice(start, start + limit));
      }
    }
    flush();
  }
  flush();
  return messages;
}
