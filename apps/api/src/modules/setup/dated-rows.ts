import { isInForceOn } from '@sodiq/timetable-rules';

/** A dated row as it is stored: in force over `[validFrom, validUntil)`. */
export interface StoredDatedRow {
  readonly id: string;
  readonly validFrom: string;
  readonly validUntil: string | null;
}

/** A row withdrawn before it took effect: an empty range, kept as history. */
export const isWithdrawn = (row: { validFrom: string; validUntil: string | null }): boolean =>
  row.validUntil === row.validFrom;

/** What a change from a date does to the rows of one key. */
export interface Schedule {
  /**
   * The row in force on the date, ended at it: `validUntil` becomes the date.
   * A row that starts on the date is thereby withdrawn (an empty range).
   */
  readonly cut: { readonly id: string; readonly validUntil: string } | null;
  /** The range of the new row: from the date up to the next planned change, or open. */
  readonly validFrom: string;
  readonly validUntil: string | null;
}

/**
 * A change from `from` for the rows of one key (a slot type's lengths, a
 * template's versions, a setting's level, weekday and grades): the row in
 * force on the date is cut at it, and the new row runs up to where that row
 * ran, or, when none was in force, up to the next later row. So a change
 * already planned after the date stays, and a planned end stays too
 * (decision 1 of pull request #46; the rows of a key never overlap).
 */
export function scheduleFrom(rows: readonly StoredDatedRow[], from: string): Schedule {
  const live = rows.filter((row) => !isWithdrawn(row));
  const inForce = live.find((row) => isInForceOn(row, from));
  if (inForce !== undefined) {
    return {
      cut: { id: inForce.id, validUntil: from },
      validFrom: from,
      validUntil: inForce.validUntil,
    };
  }
  const next = live
    .map((row) => row.validFrom)
    .filter((start) => start > from)
    .sort()[0];
  return { cut: null, validFrom: from, validUntil: next ?? null };
}

/**
 * The end of a row from a date (`POST …/end`): a row in force on the date is
 * cut at it; a planned row that starts on or after it is withdrawn
 * (`validUntil = validFrom`, the review's correction 2); `null` when the row
 * already ends on or before the date, or was withdrawn (`already_ended`).
 */
export function endFrom(row: StoredDatedRow, from: string): string | null {
  if (isWithdrawn(row) || (row.validUntil !== null && row.validUntil <= from)) {
    return null;
  }
  return row.validFrom >= from ? row.validFrom : from;
}
