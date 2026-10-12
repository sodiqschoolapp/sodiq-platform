import type { ErrorCode, SchoolDate, StatusCause, StudentStatus } from '@sodiq/shared';

/** A status row of a student as it is stored: in force over `[validFrom, validUntil)`. */
export interface StoredStudentStatus {
  readonly id: string;
  readonly status: StudentStatus;
  readonly validFrom: SchoolDate;
  readonly validUntil: SchoolDate | null;
  readonly cause: StatusCause;
}

/** A new status row. */
export interface StudentStatusWrite {
  readonly status: StudentStatus;
  readonly validFrom: SchoolDate;
  readonly validUntil: SchoolDate | null;
  readonly cause: StatusCause;
  readonly reason: string | null;
}

/**
 * What a change does to the status rows of a student: rows only shrink (a
 * row taken back gets an empty range and stays as history) and new rows are
 * added; no row grows and none is deleted (db/migrations/0032, the shrink
 * trigger).
 */
export interface StudentStatusPlan {
  readonly cuts: readonly { readonly id: string; readonly validUntil: SchoolDate }[];
  readonly writes: readonly StudentStatusWrite[];
}

export type StudentStatusOutcome = StudentStatusPlan | { readonly refusal: ErrorCode };

/** The day after a school date. Calendar arithmetic only; no clock is read. */
export function dayAfter(date: SchoolDate): SchoolDate {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('Not a school date.');
  }
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** A row taken back before it took effect: an empty range. */
const isWithdrawn = (row: StoredStudentStatus): boolean => row.validUntil === row.validFrom;

/** The rows that count, in order. */
const liveRows = (rows: readonly StoredStudentStatus[]): StoredStudentStatus[] =>
  rows
    .filter((row) => !isWithdrawn(row))
    .sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0));

/** A leaving written and not yet in force: its inactive row starts after today. */
const isScheduledLeaving = (row: StoredStudentStatus | undefined, today: SchoolDate): boolean =>
  row !== undefined &&
  row.status === 'inactive' &&
  row.cause === 'leaving' &&
  row.validFrom > today;

/**
 * Leaving the school (`04`, Movements; edge/students-classes-groups; task
 * 2.4b-1, decision 5):
 *
 * - the last day is the last day as a student: the inactive row starts the
 *   day after it;
 * - the student is active on the last day: the rows from the last day on are
 *   the active time the student is in now (a leaving already in force or a
 *   graduation refuses, `student_not_active`);
 * - a leaving scheduled after today is replaced by the new one (edge: "It can
 *   be changed or cancelled until the date"): it is taken back first, and the
 *   time up to the new date filled with an active row when the new date is
 *   later;
 * - the last day is not before the start of that active time, except the day
 *   before it when it is the student's first time (a student who never
 *   started: that row is taken back);
 * - a past last day is allowed (edge: "A student stopped coming on 1 October;
 *   leaving is recorded on 15 October"); a closed year is refused by the
 *   database (0033).
 */
export function planLeaving(
  rows: readonly StoredStudentStatus[],
  lastDay: SchoolDate,
  reason: string,
  today: SchoolDate,
): StudentStatusOutcome {
  const live = liveRows(rows);
  const cuts: { id: string; validUntil: SchoolDate }[] = [];
  const writes: StudentStatusWrite[] = [];
  const last = live.at(-1);
  if (isScheduledLeaving(last, today) && last !== undefined) {
    cuts.push({ id: last.id, validUntil: last.validFrom });
    live.pop();
  }
  // The active time the student is in: the active rows at the end, back to back.
  const run: StoredStudentStatus[] = [];
  for (let index = live.length - 1; index >= 0; index -= 1) {
    const row = live[index];
    if (row === undefined || row.status !== 'active') {
      break;
    }
    const next = run[0];
    if (next !== undefined && row.validUntil !== next.validFrom) {
      break;
    }
    run.unshift(row);
  }
  const first = run[0];
  const end = run.at(-1);
  if (first === undefined || end === undefined) {
    return { refusal: 'student_not_active' };
  }
  // Only a replaced scheduled leaving leaves the active time closed.
  if (end.validUntil !== null && cuts.length === 0) {
    return { refusal: 'student_not_active' };
  }
  const leaves = dayAfter(lastDay);
  const neverStarted = first === live[0] && first.cause === 'start';
  if (leaves < first.validFrom || (leaves === first.validFrom && !neverStarted)) {
    return { refusal: 'leaving_before_start' };
  }
  for (const row of run) {
    if (row.validFrom >= leaves) {
      cuts.push({ id: row.id, validUntil: row.validFrom });
    } else if (row.validUntil === null || row.validUntil > leaves) {
      cuts.push({ id: row.id, validUntil: leaves });
    }
  }
  if (end.validUntil !== null && end.validUntil < leaves) {
    // The scheduled leaving taken back ended the active time earlier: fill it.
    writes.push({
      status: 'active',
      validFrom: end.validUntil,
      validUntil: leaves,
      cause: 'cancel',
      reason: null,
    });
  }
  writes.push({
    status: 'inactive',
    validFrom: leaves,
    validUntil: null,
    cause: 'leaving',
    reason,
  });
  return { cuts, writes };
}

/**
 * The cancel of a scheduled leaving (edge: "It can be changed or cancelled
 * until the date"): the inactive row is taken back and the active time
 * written again from its first day.
 */
export function planCancelLeaving(
  rows: readonly StoredStudentStatus[],
  today: SchoolDate,
): StudentStatusOutcome {
  const last = liveRows(rows).at(-1);
  if (last === undefined || last.status !== 'inactive' || last.cause !== 'leaving') {
    return { refusal: 'leaving_not_planned' };
  }
  if (last.validFrom <= today) {
    return { refusal: 'leaving_in_force' };
  }
  return {
    cuts: [{ id: last.id, validUntil: last.validFrom }],
    writes: [
      {
        status: 'active',
        validFrom: last.validFrom,
        validUntil: null,
        cause: 'cancel',
        reason: null,
      },
    ],
  };
}

/**
 * "Undo leaving" with a reason (edge: "A leaving entered by mistake has its
 * own \"undo leaving\" action with a reason"; decision 8): the inactive row of
 * a leaving in force, still the last row, is taken back and an active row
 * written from its first day, so the gap closes.
 */
export function planUndoLeaving(
  rows: readonly StoredStudentStatus[],
  reason: string,
  today: SchoolDate,
): StudentStatusOutcome {
  const last = liveRows(rows).at(-1);
  if (
    last === undefined ||
    last.status !== 'inactive' ||
    last.validUntil !== null ||
    last.validFrom > today
  ) {
    return { refusal: 'student_not_inactive' };
  }
  if (last.cause !== 'leaving') {
    return { refusal: 'undo_not_leaving' };
  }
  return {
    cuts: [{ id: last.id, validUntil: last.validFrom }],
    writes: [
      { status: 'active', validFrom: last.validFrom, validUntil: null, cause: 'undo', reason },
    ],
  };
}

/**
 * Coming back from the Inactive list (`04`, Movements): active again from the
 * return date, which is after the first inactive day (that would be an undo)
 * and not after today (decision 5).
 */
export function planReturn(
  rows: readonly StoredStudentStatus[],
  from: SchoolDate,
  reason: string | null,
  today: SchoolDate,
): StudentStatusOutcome {
  const last = liveRows(rows).at(-1);
  if (
    last === undefined ||
    last.status !== 'inactive' ||
    last.validUntil !== null ||
    last.validFrom > today
  ) {
    return { refusal: 'student_not_inactive' };
  }
  if (from > today) {
    return { refusal: 'status_date_future' };
  }
  if (from <= last.validFrom) {
    return { refusal: 'return_too_early' };
  }
  return {
    cuts: [{ id: last.id, validUntil: from }],
    writes: [{ status: 'active', validFrom: from, validUntil: null, cause: 'return', reason }],
  };
}

/**
 * The Super Admin's restore of a graduated student (edge: "A student is
 * graduated by mistake. The Super Admin restores the student to active ...
 * and a reason"): active from a date on or after the first day of the
 * graduation, not after today; on that first day the graduation is taken
 * back.
 */
export function planRestore(
  rows: readonly StoredStudentStatus[],
  from: SchoolDate,
  reason: string,
  today: SchoolDate,
): StudentStatusOutcome {
  const last = liveRows(rows).at(-1);
  if (
    last === undefined ||
    last.status !== 'graduated' ||
    last.validUntil !== null ||
    last.validFrom > today
  ) {
    return { refusal: 'student_not_graduated' };
  }
  if (from > today) {
    return { refusal: 'status_date_future' };
  }
  if (from < last.validFrom) {
    return { refusal: 'restore_before_graduation' };
  }
  return {
    cuts: [{ id: last.id, validUntil: from }],
    writes: [{ status: 'active', validFrom: from, validUntil: null, cause: 'restore', reason }],
  };
}

/**
 * Whether the student holds data that the delete of a student created twice
 * refuses (edge: "may delete a student only if there is no attendance,
 * number, exemption, result, scholarship, stipend entry or comment"; decision
 * 14): a scholarship, a live row that is not active, a second contract. The
 * same conditions as `students_delete_guard` (0033).
 */
export function holdsData(
  rows: readonly StoredStudentStatus[],
  scholarshipType: string,
  contracts: number,
): boolean {
  return (
    scholarshipType !== 'none' ||
    contracts > 1 ||
    liveRows(rows).some((row) => row.status !== 'active')
  );
}

/**
 * The next change of status after the status shown (the row in force today,
 * else the first one after today), when it begins after today (finding 9 of
 * the spec review of the plan). An adjacent row of the same status (the fill
 * of a cancel or an undo) is no change.
 */
export function plannedAfter(
  rows: readonly StoredStudentStatus[],
  today: SchoolDate,
): { status: StudentStatus; from: SchoolDate } | null {
  const live = liveRows(rows);
  const shown = live.findIndex((row) => row.validUntil === null || row.validUntil > today);
  const status = live[shown]?.status;
  const next = shown === -1 ? undefined : live.slice(shown + 1).find((row) => row.status !== status);
  return next !== undefined && next.validFrom > today
    ? { status: next.status, from: next.validFrom }
    : null;
}
