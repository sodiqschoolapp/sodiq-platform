/**
 * The attendance figures of the home pages (task 9.4b; docs/spec/edge-cases/journal.md,
 * Attendance figures; docs/spec/08-results-rating-analytics.md, Home pages by role).
 *
 * - "Daily attendance percent of a class. Cells marked present or late, divided by all marked
 *   cells of non-exempt students that day, over class and group lessons. Unmarked cells are left
 *   out of both and shown as a separate count." A cell's `exempt` is the journal's own reading of
 *   the exemption (review correction 1): a lesson left "as attended" under an exemption is passed
 *   as not exempt. Cancelled lessons are never passed. A week or a branch is the same ratio over
 *   more cells (plan decision 3), never a mean of percents.
 * - "'Absent now' on the Tutor's page. Students whose latest marked lesson today is 0 and who are
 *   not exempt now." Late (2) and skipped (3) are not "absent now" (plan decision 8).
 */
import { Fraction } from './fraction.js';
import { CalcInputError } from './input.js';

/** One attendance cell: the stored mark (0 to 3, `null` unmarked) and whether the student is exempt. */
export interface AttendanceCell {
  readonly mark: 0 | 1 | 2 | 3 | null;
  readonly exempt: boolean;
}

export interface DailyAttendance {
  /** Cells of non-exempt students marked present or late. */
  readonly attended: number;
  /** Cells of non-exempt students with a mark. */
  readonly marked: number;
  /** Cells of non-exempt students with no mark, left out of both. */
  readonly unmarked: number;
  /** Cells of exempt students, left out of all three. */
  readonly exempt: number;
  /** `attended / marked` as a percent, exact; `null` with nothing marked. */
  readonly percent: Fraction | null;
}

const checkedMark = (mark: AttendanceCell['mark']): AttendanceCell['mark'] => {
  if (mark === null || mark === 0 || mark === 1 || mark === 2 || mark === 3) return mark;
  throw new CalcInputError('unknown_mark', `Unknown stored attendance mark ${String(mark)}.`);
};

export function dailyAttendance(cells: readonly AttendanceCell[]): DailyAttendance {
  let attended = 0;
  let marked = 0;
  let unmarked = 0;
  let exempt = 0;
  for (const cell of cells) {
    const mark = checkedMark(cell.mark);
    if (cell.exempt) exempt += 1;
    else if (mark === null) unmarked += 1;
    else {
      marked += 1;
      if (mark === 1 || mark === 2) attended += 1;
    }
  }
  return {
    attended,
    marked,
    unmarked,
    exempt,
    percent: marked === 0 ? null : Fraction.of(BigInt(attended) * 100n, BigInt(marked)),
  };
}

/** Whether a student is absent now: `lessons` are the student's held lessons of today in start order. */
export function absentNow(input: {
  readonly lessons: readonly Pick<AttendanceCell, 'mark'>[];
  readonly exemptNow: boolean;
}): boolean {
  if (input.exemptNow) return false;
  for (let index = input.lessons.length - 1; index >= 0; index -= 1) {
    const mark = checkedMark(input.lessons[index]?.mark ?? null);
    if (mark !== null) return mark === 0;
  }
  return false;
}
