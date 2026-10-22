import type { JournalShape, Role } from '@sodiq/shared';
import type { CurrentAssignment } from '../access/current-assignments.js';
import type { Access } from '../access/permission.guard.js';

/**
 * Who reads what of a journal (task 6.2, pull request #210; `07`, Who can do
 * what; decisions 2, 3 and 20 with review corrections 1 and 4). The guard
 * lets the nine roles of the area `journal` in; this decides, for every
 * request, from every assignment that permits the route in the branch:
 *
 * | Role | Journals | Shape |
 * | --- | --- | --- |
 * | Super Admin, Principal, Academic Vice Principal | every journal of the branch | whole |
 * | Vice Principal for Spiritual and Moral Education, Head Tutor | every journal of the branch | attendance |
 * | Head Teacher, Senior Head Teacher | the journals of own subjects | whole |
 * | Tutor | own classes (rows in force now), groups that draw from them | whole for a class; own rows for a group |
 * | Teacher | the owner on the quarter's reference date | whole |
 * | Teacher | lessons owned on their dates or taught | lessons |
 *
 * The widest reading of the assignments decides (decision 20): whole, then
 * the Tutor's own rows, then attendance, then lessons.
 */

const WHOLE_ROLES: readonly Role[] = ['super_admin', 'principal', 'academic_vice_principal'];

const ATTENDANCE_ROLES: readonly Role[] = ['spiritual_vice_principal', 'head_tutor'];

const SUBJECT_ROLES: readonly Role[] = ['head_teacher', 'senior_head_teacher'];

/** A journal as its scope reads it. */
export interface JournalScopeKey {
  readonly subjectId: string;
  /** The class of a class journal. */
  readonly classId: string | null;
  /** The classes a group journal's group draws from; empty for a class journal. */
  readonly groupClassIds: readonly string[];
}

/**
 * What one request reads without asking about the teacher: `whole`,
 * `attendance`, `tutor` (a group: own classes' rows), or `null` when only a
 * teacher's own reading could let it in.
 */
export type RoleReading =
  | { readonly kind: 'whole' }
  | { readonly kind: 'tutor'; readonly classIds: ReadonlySet<string> }
  | { readonly kind: 'attendance' };

const lower = (id: string) => id.toLowerCase();

/** The reading one assignment gives a journal, or `null`. */
function readingOf(assignment: CurrentAssignment, key: JournalScopeKey): RoleReading | null {
  if (WHOLE_ROLES.includes(assignment.role)) return { kind: 'whole' };
  if (ATTENDANCE_ROLES.includes(assignment.role)) return { kind: 'attendance' };
  if (SUBJECT_ROLES.includes(assignment.role)) {
    return assignment.subjectIds.includes(lower(key.subjectId)) ? { kind: 'whole' } : null;
  }
  if (assignment.role === 'tutor') {
    if (key.classId !== null) {
      return assignment.classIds.includes(lower(key.classId)) ? { kind: 'whole' } : null;
    }
    const own = key.groupClassIds.map(lower).filter((id) => assignment.classIds.includes(id));
    return own.length === 0 ? null : { kind: 'tutor', classIds: new Set(own) };
  }
  return null;
}

const RANK: Readonly<Record<RoleReading['kind'], number>> = { whole: 3, tutor: 2, attendance: 1 };

/** The widest reading the permitting assignments give the journal (decision 20), or `null`. */
export function roleReadingOf(access: Access, key: JournalScopeKey): RoleReading | null {
  let best: RoleReading | null = null;
  for (const assignment of access.permitting) {
    const found = readingOf(assignment, key);
    if (found === null) continue;
    if (best === null || RANK[found.kind] > RANK[best.kind]) {
      best = found;
    } else if (best.kind === 'tutor' && found.kind === 'tutor') {
      best = { kind: 'tutor', classIds: new Set([...best.classIds, ...found.classIds]) };
    }
  }
  return best;
}

/** Whether a permitting assignment is a Teacher's, whose own journals and lessons the route reads. */
export const teaches = (access: Access): boolean =>
  access.permitting.some((assignment) => assignment.role === 'teacher');

/** The shape a reading sends (`JournalShape`). */
export function shapeOf(reading: RoleReading | { readonly kind: 'lessons' }): JournalShape {
  if (reading.kind === 'attendance') return 'attendance';
  if (reading.kind === 'lessons') return 'lessons';
  return 'whole';
}
