import type { AccountNamed, CellLine, CommentLine, RatingLine, WorkLine } from '@sodiq/shared';
import { nameOf } from '@/features/setup/setup-api';
import type { TFunction } from 'i18next';

/**
 * The words of a journal cell or history line in the reports over the cells
 * (task 6.1c, pull request #209): what the cell is, its values and how they
 * came. Marks are the attendance marks of `07`, Entering data.
 */

const MARKS = ['absent', 'present', 'late', 'skipped'] as const;

type Cell = Pick<CellLine, 'attendance' | 'workKind'>;

/** Attendance, Classwork, Homework, or a work a forced delete removed. */
export function cellKindText(t: TFunction, cell: Cell): string {
  if (cell.attendance) return t('journal.attendance');
  if (cell.workKind === null) return t('journal.removedWork');
  return t(`journal.${cell.workKind}`);
}

/** A mark in words with its number, a work's number as typed, or "empty". */
export function cellValueText(t: TFunction, cell: Cell, value: number | null): string {
  if (value === null) return t('journal.cleared');
  if (!cell.attendance) return String(value);
  const mark = MARKS[value];
  return mark === undefined ? String(value) : `${String(value)} (${t(`journal.marks.${mark}`)})`;
}

/** "before → after". */
export const cellChangeText = (t: TFunction, line: CellLine): string =>
  `${cellValueText(t, line, line.before)} → ${cellValueText(t, line, line.after)}`;

/** The lesson of a line: date words given by the caller, subject in the page's language, class. */
export function cellLessonText(
  t: TFunction,
  language: string,
  lesson: CellLine['lesson'],
  dateText: (date: string) => string,
): string {
  if (lesson === null) return t('journal.lessonGone');
  const subject =
    language === 'ru'
      ? lesson.subject.ru
      : language === 'en'
        ? lesson.subject.en
        : lesson.subject.uz;
  return [
    dateText(lesson.date),
    subject,
    lesson.taughtTo,
    lesson.cancelled ? t('journal.cancelled') : null,
  ]
    .filter((part) => part !== null && part !== '')
    .join(' · ');
}

/** A person named by an account: the name when readable, else the login. */
export const accountText = (named: AccountNamed, empty: string): string =>
  named.name ?? named.login ?? empty;

/**
 * A line of a work's history (task 8.1): "Total of Classwork: 30 → 20", or
 * '"Not held" of Homework: no → yes'.
 */
export function workLineText(
  t: TFunction,
  line: Pick<
    WorkLine,
    'workKind' | 'totalBefore' | 'totalAfter' | 'notHeldBefore' | 'notHeldAfter'
  >,
): string {
  const work = t(
    line.workKind === 'classwork' ? 'journal.grid.parts.classwork' : 'journal.grid.parts.homework',
  );
  if (line.totalBefore !== line.totalAfter) {
    return `${t('journal.works.historyTotal', { work })}: ${String(line.totalBefore ?? '—')} → ${String(line.totalAfter ?? '—')}`;
  }
  const yesNo = (value: boolean | null) =>
    value === null ? '—' : value ? t('journal.works.yes') : t('journal.works.no');
  return `${t('journal.works.historyNotHeld', { work })}: ${yesNo(line.notHeldBefore)} → ${yesNo(line.notHeldAfter)}`;
}

/** A line of a rating entry (task 8.2): the journal, the quarter, the entry before and after, the reason. */
export function ratingLineText(
  t: TFunction,
  language: string,
  line: Pick<RatingLine, 'journal' | 'before' | 'after' | 'reason'>,
): string {
  const entry = (value: RatingLine['before']) =>
    value === null
      ? '—'
      : value.kind === 'score'
        ? String(value.score)
        : t(`journal.rating.kinds.${value.kind}`);
  const text = t('people.report.ratingLine', {
    subject: nameOf(line.journal.subject, language),
    unit: line.journal.taughtTo,
    quarter: line.journal.quarter,
    before: entry(line.before),
    after: entry(line.after),
  });
  return line.reason === null ? text : `${text} · ${line.reason}`;
}

/** A line of a comment (task 8.2): what it is on, and its text after the change. */
export function commentLineText(
  t: TFunction,
  line: Pick<CommentLine, 'target' | 'bodyAfter' | 'visibility'>,
): string {
  return t('people.report.commentLine', {
    target: t(`journal.comments.targets.${line.target}`),
    body: line.bodyAfter ?? t('journal.comments.cleared'),
    visibility:
      line.visibility === null ? '—' : t(`journal.comments.visibilities.${line.visibility}`),
  });
}
