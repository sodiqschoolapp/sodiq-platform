import type { PlanFlag, PlanWindowState } from '@sodiq/shared';

/**
 * The plan window and the open periods of approved requests (task 7.2, pull
 * request #215; `09`, The plan window: "Inside the window teachers create and
 * edit their plans freely." "When the window ends, every plan is locked.";
 * Editing after the window: "Nothing opens without an approved request";
 * `edge/lesson-plans`, The window and requests). Pure: the moments come from
 * the stored rows and the transaction's moment, nothing reads a clock.
 */

/** The window of a quarter as stored, with the extension in force for the owner. */
export interface StoredWindow {
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** The end of the quarter's last day: a window never runs past it (`edge`). */
  readonly quarterEndsAt: Date;
  /** The latest extension of the owner, if any. */
  readonly extensionEndsAt: Date | null;
}

/** Where the window stands for one owner at a moment, and the end in force for them. */
export function windowStateOf(
  window: StoredWindow | null,
  now: Date,
): { state: PlanWindowState; endsAt: Date | null } {
  if (window === null) return { state: 'not_opened', endsAt: null };
  const own =
    window.extensionEndsAt !== null && window.extensionEndsAt > window.endsAt
      ? window.extensionEndsAt
      : window.endsAt;
  const endsAt = own > window.quarterEndsAt ? window.quarterEndsAt : own;
  if (now < window.startsAt) return { state: 'before', endsAt };
  if (now <= endsAt) return { state: 'open', endsAt };
  return { state: 'ended', endsAt };
}

/** An approved request whose period has not ended (`edge`: "If two approved periods overlap, the later end date applies"). */
export interface OpenPeriod {
  readonly requestId: string;
  readonly kind: 'text' | 'replan' | 'extension';
  /** The Re-plan part: from this date on. */
  readonly fromDate: string | null;
  /** The lessons of the Text part the approver left ticked. */
  readonly lessonIds: readonly string[];
  readonly approvedBy: string;
}

/** A period is open while its end is ahead and nobody ended it. */
export function periodOpen(
  period: { openUntil: Date | null; finishedAt: Date | null; status: string },
  now: Date,
): boolean {
  return (
    period.status === 'approved' &&
    period.openUntil !== null &&
    now <= period.openUntil &&
    period.finishedAt === null
  );
}

/** What a write does to one journal's row (the operations of a plan). */
export type GateOp =
  /** A save of the item's text or works, or its files: Text or Re-plan. */
  | 'wording'
  /** A new item on an empty row: the wording of that lesson (review decision 12). */
  | 'create'
  /** "Clear", the queue edit, a copy: Re-plan only (`edge`: "moves nothing" is Text). */
  | 'move';

/** One row of one journal a write touches; `null` lesson for an item past the last row ("not covered"). */
export interface GateRow {
  readonly lessonId: string | null;
  readonly date: string | null;
  /** The lesson's start has passed (the fixed part, 7.1b decision 3). */
  readonly started: boolean;
}

/**
 * Whether an open period covers a write of one row (`edge`, "A request for
 * two lessons turns into merging topics": "'Text' changes the wording of the
 * listed lessons and moves nothing. 'Re-plan' runs from a chosen lesson not
 * yet held to the end of the quarter and allows insert, delete, merge and
 * reorder ... Lessons already held take only Text."). An extension covers
 * what the window covers.
 */
export function periodCovers(period: OpenPeriod, row: GateRow, op: GateOp): boolean {
  if (period.kind === 'extension') return true;
  const text = op !== 'move' && row.lessonId !== null && period.lessonIds.includes(row.lessonId);
  if (text) return true;
  if (period.fromDate === null || row.started) return false;
  // An item past the last row has no date: it is in the queue after every row.
  return row.date === null || row.date >= period.fromDate;
}

/**
 * The end of a period of `days` school days from the approval day (review
 * decision 7): the approval day counts when it is a school day; the end is
 * the last counted day. Gives the date; the caller takes its end in branch
 * time. A year with fewer school days left ends at the last one found.
 */
export function periodLastDay(
  approvalDay: string,
  days: number,
  isSchoolDay: (date: string) => boolean,
  nextDay: (date: string) => string,
  lastDay: string,
): string {
  let counted = 0;
  let last = approvalDay;
  for (let date = approvalDay; date <= lastDay; date = nextDay(date)) {
    if (isSchoolDay(date)) {
      counted += 1;
      last = date;
      if (counted >= days) return date;
    }
  }
  return last;
}

/** School days from `from` (excluded) up to `today` (included): how long a request has waited. */
export function schoolDaysBetween(
  from: string,
  today: string,
  isSchoolDay: (date: string) => boolean,
  nextDay: (date: string) => string,
): number {
  let count = 0;
  for (let date = nextDay(from); date <= today; date = nextDay(date)) {
    if (isSchoolDay(date)) count += 1;
  }
  return count;
}

/** `edge`: "one unanswered for 2 school days is highlighted". */
export const PLAN_REQUEST_LATE_DAYS = 2;

/**
 * The flag of a plan (task 7.2): `edge/timetable`, "the plan window lists it
 * as 'vacancy', not as overdue against anyone"; `edge/lesson-plans`: "Such
 * plans show 'window not opened', not 'overdue'"; "The plan counts as overdue
 * only after that approved period ends" (a new owner's or a new journal's
 * request, `ownerPeriod`).
 */
export function planFlagOf(input: {
  readonly rows: number;
  readonly complete: boolean;
  /** Under a vacancy with nobody acting on the reference date (`ownerOn` gives `none`). */
  readonly vacancy: boolean;
  readonly window: PlanWindowState;
  readonly ownerPeriod: boolean;
}): PlanFlag | null {
  if (input.rows === 0) return null;
  if (input.vacancy) return 'vacancy';
  if (input.complete) return null;
  if (input.window === 'not_opened') return 'window_not_opened';
  if (input.window === 'ended' && !input.ownerPeriod) return 'overdue';
  return null;
}
