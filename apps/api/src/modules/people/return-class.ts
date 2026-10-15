import type { ErrorCode, ErrorDetail, SchoolDate } from '@sodiq/shared';
import { ApiException } from '../../http/api-exception.js';
import {
  holdsDays,
  writtenByCancelledMove,
  type StoredMembership,
} from '../classes/membership-plan.js';

/**
 * "The class left" by a returning student (task 3.3b, plan, step 5): the
 * latest class row of the student that holds days, was not written by a
 * cancelled move, and ends on or before the first inactive day of the leaving
 * being ended. `undefined` when there is none (decision 2: no confirmation
 * of the language is asked then).
 */
export function classLeft(
  memberships: readonly StoredMembership[],
  leavingFrom: SchoolDate,
  cancelledMoves: ReadonlySet<string>,
): StoredMembership | undefined {
  return memberships
    .filter(
      (row) =>
        holdsDays(row) &&
        !writtenByCancelledMove(row, cancelledMoves) &&
        row.validUntil <= leavingFrom,
    )
    .sort((a, b) =>
      a.validUntil !== b.validUntil
        ? a.validUntil < b.validUntil
          ? 1
          : -1
        : a.validFrom < b.validFrom
          ? 1
          : a.validFrom > b.validFrom
            ? -1
            : 0,
    )[0];
}

/**
 * The group of each subject that the leaving being ended cut (decision 5
 * with correction 1): the group rows with days that the leaving ended, the
 * latest of each subject. A return into the class left offers it first;
 * whether it still draws from the class, is in service and has a seat is
 * decided where every group is chosen (`planClassGroups`).
 */
export function groupsLeavingCut(
  rows: readonly {
    groupId: string;
    subjectId: string;
    validFrom: SchoolDate;
    validUntil: SchoolDate;
    endedBy: string | null;
    leavingId: string | null;
  }[],
  leavingId: string,
): Map<string, string> {
  const latest = new Map<string, { groupId: string; until: SchoolDate }>();
  for (const row of rows) {
    if (row.endedBy !== 'leaving' || row.leavingId !== leavingId || !holdsDays(row)) {
      continue;
    }
    const known = latest.get(row.subjectId);
    if (known === undefined || row.validUntil > known.until) {
      latest.set(row.subjectId, { groupId: row.groupId, until: row.validUntil });
    }
  }
  return new Map([...latest].map(([subjectId, { groupId }]) => [subjectId, groupId]));
}

/**
 * Where a refusal of the class rules answers on the return and the restore
 * (task 3.3b, decision 11): on the class field or on the date field. A date
 * outside the class's year is `return_outside_year` there (decision 10).
 */
const CLASS_FIELD_PATHS: Partial<Record<ErrorCode, 'classId' | 'from'>> = {
  class_full: 'classId',
  class_grade_differs: 'classId',
  class_archived: 'classId',
  class_year_closed: 'classId',
  class_group_no_seat: 'classId',
  student_has_class: 'classId',
  student_grade_class: 'classId',
  return_language_differs: 'classId',
  student_not_active_on: 'from',
  membership_before_start: 'from',
  return_outside_year: 'from',
};

/** Runs work; a refusal of the class rules gets the path of its field. */
export async function atClassFields<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof ApiException)) {
      throw error;
    }
    const code: ErrorCode =
      error.code === 'membership_outside_year' ? 'return_outside_year' : error.code;
    const path = CLASS_FIELD_PATHS[code];
    if (path === undefined) {
      throw error;
    }
    const details: ErrorDetail[] = (
      error.details ?? [{ path, code, message: `The class is refused: ${code}.` }]
    ).map((detail) => ({
      ...detail,
      path,
      code: detail.code === 'membership_outside_year' ? 'return_outside_year' : detail.code,
    }));
    throw new ApiException(code, error.getStatus(), error.retryAfterSeconds, details);
  }
}
