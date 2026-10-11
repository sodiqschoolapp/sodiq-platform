import type { ErrorCode, SchoolDate, StaffStatus, StaffStatusChange } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/** A status row as it is stored: in force over `[validFrom, validUntil)`. */
export interface StoredStatusRow {
  readonly id: string;
  readonly status: StaffStatus;
  readonly validFrom: SchoolDate;
  readonly validUntil: SchoolDate | null;
}

/** What a status change does to the rows of a record; no row grows, none is deleted. */
export interface StatusPlan {
  /** Rows whose end moves earlier: a row in force cut at the date, or a planned one taken back. */
  readonly cuts: readonly { readonly id: string; readonly validUntil: SchoolDate }[];
  /** New rows, in order. */
  readonly writes: readonly {
    readonly status: StaffStatus;
    readonly validFrom: SchoolDate;
    readonly validUntil: SchoolDate | null;
  }[];
  /** The rows taken back (their range made empty), for the roles a `left` among them ended. */
  readonly withdrawn: readonly StoredStatusRow[];
}

/** A row taken back before it took effect: an empty range, kept as history. */
const isWithdrawn = (row: StoredStatusRow): boolean => row.validUntil === row.validFrom;

/**
 * A status from a date (`edge/people-roles-accounts`, Staff over time: "Each
 * status change has a date, which can be in the future"; task 2.2a,
 * decision 4 and correction 6 of the review of pull request #53):
 *
 * - the date is today or later, and not before the first row (the admission);
 * - every change planned after today, apart from the first row, is taken back
 *   (its end set to its start), so the new change replaces it, whether it is
 *   dated before or after it;
 * - the row in force on the date is cut at it (taken back when it starts on
 *   the date); when it already ended earlier, at a planned change taken back,
 *   a row of its status fills the time up to the date;
 * - the new status runs from the date with no end. The same status as the
 *   row in force only takes the planned changes back, and with nothing to
 *   take back it is `status_unchanged`.
 */
export function planStatusChange(
  rows: readonly StoredStatusRow[],
  change: StaffStatusChange,
  today: SchoolDate,
): StatusPlan | { refusal: ErrorCode } {
  if (change.from < today) {
    return { refusal: 'status_from_past' };
  }
  const live = rows.filter((row) => !isWithdrawn(row));
  const first = live[0];
  if (first === undefined || change.from < first.validFrom) {
    return { refusal: 'status_before_admission' };
  }
  const planned = live.filter((row) => row !== first && row.validFrom > today);
  const kept = live.filter((row) => !planned.includes(row));
  const base = kept.filter((row) => row.validFrom <= change.from).at(-1);
  if (base === undefined) {
    return { refusal: 'status_before_admission' };
  }
  const cuts: { id: string; validUntil: SchoolDate }[] = planned.map((row) => ({
    id: row.id,
    validUntil: row.validFrom,
  }));
  const withdrawn: StoredStatusRow[] = [...planned];
  const writes: { status: StaffStatus; validFrom: SchoolDate; validUntil: SchoolDate | null }[] =
    [];
  if (base.status === change.status) {
    if (planned.length === 0 && base.validUntil === null) {
      return { refusal: 'status_unchanged' };
    }
    if (base.validUntil !== null) {
      writes.push({ status: base.status, validFrom: base.validUntil, validUntil: null });
    }
    return { cuts, writes, withdrawn };
  }
  if (base.validFrom === change.from) {
    cuts.push({ id: base.id, validUntil: base.validFrom });
    withdrawn.push(base);
  } else if (base.validUntil === null || base.validUntil > change.from) {
    cuts.push({ id: base.id, validUntil: change.from });
  } else if (base.validUntil < change.from) {
    writes.push({ status: base.status, validFrom: base.validUntil, validUntil: change.from });
  }
  writes.push({ status: change.status, validFrom: change.from, validUntil: null });
  return { cuts, writes, withdrawn };
}

/** 00:00 of a school date in a time zone: the moment the roles end on the date of a `left` row. */
export async function startOfDate(
  transaction: Transaction,
  date: SchoolDate,
  timeZone: string,
): Promise<Date> {
  const found = await sql<{ moment: Date }>`
    select (${date}::date::timestamp at time zone ${timeZone}) as moment
  `.execute(transaction);
  const moment = found.rows[0]?.moment;
  if (moment === undefined) {
    throw new Error('No moment for the date.');
  }
  return moment;
}

/** The end a `left` row gives an assignment: its date's start, or the assignment's own start when that is later (correction 4). */
export const roleEndFor = (assignmentStart: Date, dateStart: Date): Date =>
  assignmentStart > dateStart ? assignmentStart : dateStart;
