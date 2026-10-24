import {
  ABOUT_TO_LOCK_HOURS,
  RATING_REMINDER_DAYS,
  type Reminder,
  type StatusLesson,
} from '@sodiq/shared';
import { addDays } from '@sodiq/timetable-rules';
import type { Transaction } from '../../database/transactions.js';
import { exemptOnDate } from './exemption-read.js';
import { switchesOn, unitMemberships, type JournalRow } from './journal-grid.query.js';
import type { LessonStatusRow } from './lesson-status.query.js';
import { entriesOf, ratingDateOf, ratingRowOf } from './rating.js';

/**
 * The reminders (task 8.7, pull request #225; `07`, Reminders: "lessons with
 * no attendance, planned works whose numbers are missing, lessons with no
 * topic (graded subjects only), rating exam scores missing in the last two
 * weeks of a quarter, and lessons about to lock"), worked out on read from
 * the status facts (`lesson-status.query.ts`) and the injected clock. Nothing
 * is sent and nothing is stored: a timed job only sends notices (9.2c).
 */

const HOUR = 60 * 60 * 1000;

/** A lesson as a reminder names it, before its status; the answer's schema checks the rest. */
export type ReminderLesson = Pick<StatusLesson, 'id' | 'date' | 'start'>;

/** A reminder of a lesson, with the lesson as given. */
export interface LessonReminder<L extends ReminderLesson> {
  readonly kind: Exclude<Reminder['kind'], 'rating_missing'>;
  readonly lesson: L & { readonly status: StatusLesson['status'] };
  readonly count: number;
  readonly locksAt: string | null;
}

/** The reminders of held lessons, in date and time order. */
export function lessonReminders<L extends ReminderLesson>(
  lessons: readonly { readonly lesson: L; readonly row: LessonStatusRow }[],
  now: Date,
): LessonReminder<L>[] {
  const found: LessonReminder<L>[] = [];
  const sorted = [...lessons].sort(
    (a, b) =>
      a.lesson.date.localeCompare(b.lesson.date) ||
      a.lesson.start - b.lesson.start ||
      a.lesson.id.localeCompare(b.lesson.id),
  );
  for (const { lesson, row } of sorted) {
    const answer = row.answer;
    if (answer === null) continue;
    const shown = { ...lesson, status: answer.status };
    if (answer.unmarked > 0) {
      found.push({ kind: 'no_attendance', lesson: shown, count: answer.unmarked, locksAt: null });
    }
    if (answer.worksMissing > 0) {
      found.push({
        kind: 'numbers_missing',
        lesson: shown,
        count: answer.worksMissing,
        locksAt: null,
      });
    }
    if (row.noTopic) found.push({ kind: 'no_topic', lesson: shown, count: 1, locksAt: null });
    // Decision 9: an incomplete lesson whose lock moment comes within 48 hours.
    if (
      answer.status !== 'complete' &&
      answer.status !== 'locked_incomplete' &&
      row.locksAt !== null &&
      row.locksAt.getTime() - now.getTime() <= ABOUT_TO_LOCK_HOURS * HOUR
    ) {
      found.push({
        kind: 'about_to_lock',
        lesson: shown,
        count: 1,
        locksAt: row.locksAt.toISOString(),
      });
    }
  }
  return found;
}

/**
 * "Rating exam scores missing in the last two weeks of a quarter" (decision
 * 10): in a journal whose subject has the rating exam in the quarter of
 * today, from 14 days before its last day to that day, the members on today
 * with no score, "did not sit" or "exempt", and not "pending" (exempt on the
 * exam day, the Academic Vice Principal's to decide). `studentIds` narrows to
 * the students a reader sees; `null` for every one.
 */
/** A rating reminder, with the journal as given. */
export interface RatingReminder<J> {
  readonly kind: 'rating_missing';
  readonly journal: J;
  readonly quarterId: string;
  readonly lastDay: string;
  readonly count: number;
}

export async function ratingReminder<J>(
  transaction: Transaction,
  journal: JournalRow,
  today: string,
  describe: (journal: JournalRow) => J,
  studentIds: readonly string[] | null = null,
): Promise<RatingReminder<J> | null> {
  const quarter = switchesOn(journal, today);
  if (quarter?.ratingExam !== true || quarter.endDate === null) return null;
  if (today < addDays(quarter.endDate, -(RATING_REMINDER_DAYS - 1))) return null;
  const row = await ratingRowOf(transaction, journal.id, quarter.id);
  if (row?.notHeld === true) return null;
  const members = [
    ...new Set(
      (await unitMemberships(transaction, journal, today, today))
        .filter((one) => one.validFrom <= today && today < one.validUntil)
        .map((one) => one.studentId),
    ),
  ].filter((id) => studentIds === null || studentIds.includes(id));
  if (members.length === 0) return null;
  const entered = new Set(
    row === null
      ? []
      : (await entriesOf(transaction, row.id, members)).flatMap((one) =>
          one.entry === null ? [] : [one.studentId],
        ),
  );
  const { date } = await ratingDateOf(transaction, journal.id, quarter.id);
  const pending =
    date === null
      ? new Set<string>()
      : await exemptOnDate(transaction, members, journal.subjectId, date);
  const missing = members.filter((id) => !entered.has(id) && !pending.has(id)).length;
  if (missing === 0) return null;
  return {
    kind: 'rating_missing',
    journal: describe(journal),
    quarterId: quarter.id,
    lastDay: quarter.endDate,
    count: missing,
  };
}
