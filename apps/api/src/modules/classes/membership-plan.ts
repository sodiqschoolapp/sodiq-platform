import type { ErrorCode, SchoolDate } from '@sodiq/shared';

/** A class row of a student as it is stored: in the class over `[validFrom, validUntil)`. */
export interface StoredMembership {
  readonly id: string;
  readonly classId: string;
  readonly validFrom: SchoolDate;
  readonly validUntil: SchoolDate;
  /** The row's own end (correction 1), which a leaving taken back gives back. */
  readonly ownUntil: SchoolDate;
  readonly endedBy: 'leaving' | 'withdrawn' | null;
  readonly leavingId: string | null;
}

/** A status row as the placement reads it (`student_statuses`). */
export interface PlacementStatus {
  readonly id: string;
  readonly status: string;
  readonly validFrom: SchoolDate;
  readonly validUntil: SchoolDate | null;
  readonly cause: string;
}

const later = (a: SchoolDate, b: SchoolDate): SchoolDate => (a > b ? a : b);

/** Not withdrawn: a row with days in it. */
export const holdsDays = (row: { validFrom: SchoolDate; validUntil: SchoolDate }): boolean =>
  row.validFrom < row.validUntil;

/**
 * The end of a placement from `from` (decision 6 and should-fix 9 of the
 * plan review): the row's own end, the day after the year's end, while the
 * student is active from `from` that long; else the first inactive day of a
 * scheduled leaving, which then names the row as one it cut. The active time
 * is the active rows back to back from the one in force on `from`; before the
 * start date, or not active on it, or ended by anything but a leaving, the
 * placement is refused.
 */
export function placementEnd(
  statuses: readonly PlacementStatus[],
  startsOn: SchoolDate,
  from: SchoolDate,
  ownUntil: SchoolDate,
): { until: SchoolDate; leavingId: string | null } | { refusal: ErrorCode } {
  if (from < startsOn) {
    return { refusal: 'membership_before_start' };
  }
  const live = statuses
    .filter((row) => row.validUntil === null || row.validFrom < row.validUntil)
    .sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0));
  const index = live.findIndex(
    (row) => row.validFrom <= from && (row.validUntil === null || from < row.validUntil),
  );
  const first = live[index];
  if (first === undefined || first.status !== 'active') {
    return { refusal: 'student_not_active_on' };
  }
  let end = first.validUntil;
  let next = index + 1;
  while (end !== null) {
    const row = live[next];
    if (row === undefined || row.status !== 'active' || row.validFrom !== end) {
      break;
    }
    end = row.validUntil;
    next += 1;
  }
  if (end === null || end >= ownUntil) {
    return { until: ownUntil, leavingId: null };
  }
  const after = live[next];
  if (
    after !== undefined &&
    after.validFrom === end &&
    after.status === 'inactive' &&
    after.cause === 'leaving'
  ) {
    return { until: end, leavingId: after.id };
  }
  return { refusal: 'student_not_active_on' };
}

/** A change of a leaving, as the class rows of the student follow it (decision 1). */
export interface MembershipChange {
  /** A leaving taken back (a cancel, an undo, the replace of a scheduled one): its row and first inactive day. */
  readonly takeBack: { readonly leavingId: string; readonly from: SchoolDate } | null;
  /** A leaving written: its first inactive day. Its row id is known once it is written. */
  readonly leave: { readonly from: SchoolDate } | null;
}

/** What the change does to the class rows: rows only shrink, new rows are added (decision 8). */
export interface MembershipPlan {
  /** Rows the new leaving ends at `validUntil` and names. */
  readonly cuts: readonly { readonly id: string; readonly validUntil: SchoolDate }[];
  /** Rows written back, each up to its own end, or cut by the new leaving. */
  readonly inserts: readonly {
    readonly classId: string;
    readonly validFrom: SchoolDate;
    readonly validUntil: SchoolDate;
    readonly ownUntil: SchoolDate;
    /** Cut by the new leaving: ends at `validUntil` before its own end, or written empty. */
    readonly cut: boolean;
  }[];
  /** The rows a taken-back leaving could not give back: their class is out of service. */
  readonly notRestored: readonly StoredMembership[];
}

/**
 * The class rows of a student through a change of a leaving (`04`,
 * Movements: "taken out of classes ... from that date"; decision 1 with
 * correction 1):
 *
 * - a leaving cuts every row with days after its first inactive day at that
 *   day (a planned row is withdrawn: an empty range), whatever ended it
 *   before, and names itself on it;
 * - a leaving taken back gives back, as new rows, the rows it cut, each from
 *   the later of its first inactive day and the row's own start (a withdrawn
 *   planned row comes back on its planned date) to the row's own end, or to
 *   the start of the next row given back when that comes first (a leaving,
 *   its cancel and an earlier leaving cut both the first row and the row the
 *   cancel wrote back);
 * - the replace of a scheduled leaving does both: by an earlier date the new
 *   leaving cuts the rows the old one cut, which keep their own end, and takes
 *   over the planned rows it withdrew; by a later date the rows come back up
 *   to the new date, cut by it;
 * - a row whose class is out of service (archived, or in a closed year) is
 *   not given back and is named (`.claude/rules/database.md`, a mirror brings
 *   back only rows whose own record is in service).
 */
export function planMemberships(
  rows: readonly StoredMembership[],
  change: MembershipChange,
  inService: (classId: string) => boolean,
): MembershipPlan {
  const cuts: { id: string; validUntil: SchoolDate }[] = [];
  const inserts: {
    classId: string;
    validFrom: SchoolDate;
    validUntil: SchoolDate;
    ownUntil: SchoolDate;
    cut: boolean;
  }[] = [];
  const notRestored: StoredMembership[] = [];
  const given: { row: StoredMembership; start: SchoolDate }[] = [];
  const { takeBack, leave } = change;
  for (const row of rows) {
    const cutByTakenBack =
      takeBack !== null && row.endedBy === 'leaving' && row.leavingId === takeBack.leavingId;
    if (leave !== null) {
      if (holdsDays(row) && row.validUntil > leave.from) {
        cuts.push({ id: row.id, validUntil: later(row.validFrom, leave.from) });
        continue;
      }
      if (!holdsDays(row) && cutByTakenBack && row.validFrom >= leave.from) {
        // Still withdrawn, now by the new leaving: a later cancel brings it back.
        cuts.push({ id: row.id, validUntil: row.validUntil });
        continue;
      }
    }
    if (cutByTakenBack && takeBack !== null) {
      given.push({ row, start: later(takeBack.from, row.validFrom) });
    }
  }
  // The rows the leaving cut never overlapped before it: each comes back up
  // to its own end, but not past the start of the next one that comes back
  // (a row a cancel wrote back continues one the leaving cut first).
  given.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  given.forEach(({ row, start }, index) => {
    const next = given[index + 1];
    const end = next !== undefined && next.start < row.ownUntil ? next.start : row.ownUntil;
    if (start >= end) {
      return;
    }
    if (!inService(row.classId)) {
      notRestored.push(row);
      return;
    }
    if (leave !== null && leave.from < end) {
      inserts.push({
        classId: row.classId,
        validFrom: start,
        validUntil: later(start, leave.from),
        ownUntil: end,
        cut: true,
      });
    } else {
      inserts.push({
        classId: row.classId,
        validFrom: start,
        validUntil: end,
        ownUntil: end,
        cut: false,
      });
    }
  });
  return { cuts, inserts, notRestored };
}
