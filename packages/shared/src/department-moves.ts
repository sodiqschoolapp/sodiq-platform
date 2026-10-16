/**
 * What a record shows of its department on a day (task 3.6b-3, owner's
 * answer of 15 October 2026, L195): the department in force, and the move
 * planned after that day, if any.
 */
export interface DepartmentShown {
  departmentId: string | null;
  move: { departmentId: string | null; startsOn: string } | null;
}

/**
 * What an edit asks of a record's department (task 3.6b-3, decisions 4 and
 * 6), the one rule of the server and of the forms:
 * - `none`: the department asked is the planned one, sent with no start date
 *   or the planned one; or, with no plan, the department in force;
 * - `move`: another department, or the planned one with another start date
 *   (a change of the plan); it needs a start date;
 * - `cancel`: the department in force while a move is planned; it has no
 *   start date.
 */
export type DepartmentChangeKind = 'none' | 'move' | 'cancel';

export function departmentChangeKind(
  shown: DepartmentShown,
  asked: string | null,
  startsOn: string | null,
): DepartmentChangeKind {
  if (shown.move === null) {
    return asked === shown.departmentId ? 'none' : 'move';
  }
  if (asked === shown.move.departmentId) {
    return startsOn === null || startsOn === shown.move.startsOn ? 'none' : 'move';
  }
  return asked === shown.departmentId ? 'cancel' : 'move';
}
