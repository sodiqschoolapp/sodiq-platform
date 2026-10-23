import type { Role } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';
import type { Access } from '../access/permission.guard.js';
import { ownStaffOf } from '../journal/attendance-entry.js';
import type { JournalRow } from '../journal/journal-grid.query.js';
import { ownerFactsOf, ownerOn } from '../timetable/journal-owners.js';

/**
 * Who reads and who writes a plan (task 7.1a, pull request #212, decision 2;
 * `edge/lesson-plans`, "Who may read a plan?": "The owner; teachers with the
 * same subject and grade in their profile; the subject's Head Teacher and
 * Senior Head Teacher; the Academic Vice Principal, Principal and Super
 * Admin ... Only the owner edits."). Decided for every request from every
 * assignment that permits the route, as `journal-scope.ts` does.
 *
 * | Role | Plans read |
 * | --- | --- |
 * | Super Admin, Principal, Academic Vice Principal | every plan of the branch |
 * | Head Teacher, Senior Head Teacher | the plans of own subjects |
 * | Teacher | own (the owner on the quarter's reference date); the subject with a grade of the unit in the profile |
 *
 * Only a Teacher assignment writes, and only the owner.
 */

const WHOLE_ROLES: readonly Role[] = ['super_admin', 'principal', 'academic_vice_principal'];

const SUBJECT_ROLES: readonly Role[] = ['head_teacher', 'senior_head_teacher'];

const lower = (id: string) => id.toLowerCase();

/** What one request may do with one plan. */
export interface PlanReach {
  readonly read: boolean;
  /** The reader owns the plan on the reference date and writes with a Teacher assignment. */
  readonly edit: boolean;
  /** The Teacher assignment that writes, named in the audit entry. */
  readonly assignmentId: string | null;
}

/** The owner of a journal on a day, as a staff id; `null` under a vacancy with nobody acting. */
export async function ownerIdOn(
  transaction: Transaction,
  branchId: string,
  journal: JournalRow,
  day: string,
): Promise<string | null> {
  const facts = await ownerFactsOf(transaction, branchId, [
    {
      id: journal.id,
      academic_year_id: journal.academicYearId,
      class_id: journal.classId,
      group_id: journal.groupId,
      subject_id: journal.subjectId,
    },
  ]);
  const owner = ownerOn(
    facts.runs.get(journal.id) ?? [],
    facts.periods.get(journal.id) ?? [],
    facts.out,
    day,
  );
  return owner === null || owner.kind === 'none' ? null : owner.staffId;
}

/** The reader as the scope reads it, loaded once per request. */
export interface PlanReader {
  readonly access: Access;
  /** The Teacher assignment that permits the route, if any. */
  readonly teacherAssignmentId: string | null;
  /** The reader's staff record in the branch, if a Teacher. */
  readonly staffId: string | null;
  /** The grades of each subject in the reader's profile (`staff_subjects`), if a Teacher. */
  readonly profile: ReadonlyMap<string, readonly number[]>;
}

export async function planReaderOf(transaction: Transaction, access: Access): Promise<PlanReader> {
  const teacher = access.permitting.find((assignment) => assignment.role === 'teacher');
  const staffId = teacher === undefined ? null : await ownStaffOf(transaction, access.accountId);
  const profile = new Map<string, readonly number[]>();
  if (staffId !== null) {
    const rows = await transaction
      .selectFrom('staff_subjects')
      .select(['subject_id', 'grades'])
      .where('staff_id', '=', staffId)
      .execute();
    for (const row of rows) profile.set(lower(row.subject_id), row.grades);
  }
  return { access, teacherAssignmentId: teacher?.id ?? null, staffId, profile };
}

/**
 * What the request may do with the plan of a journal whose owner on the
 * reference date is `ownerId`. A group of two grades counts with either
 * (`09`: "readable by teachers who have the subject and either grade in
 * their profile").
 */
export function planReachOf(
  reader: PlanReader,
  journal: JournalRow,
  ownerId: string | null,
): PlanReach {
  const byRole = reader.access.permitting.some(
    (assignment) =>
      WHOLE_ROLES.includes(assignment.role) ||
      (SUBJECT_ROLES.includes(assignment.role) &&
        assignment.subjectIds.includes(lower(journal.subjectId))),
  );
  if (reader.teacherAssignmentId === null || reader.staffId === null) {
    return { read: byRole, edit: false, assignmentId: null };
  }
  if (ownerId !== null && ownerId === reader.staffId) {
    return { read: true, edit: true, assignmentId: reader.teacherAssignmentId };
  }
  const grades = reader.profile.get(lower(journal.subjectId)) ?? [];
  return {
    read: byRole || journal.grades.some((grade) => grades.includes(grade)),
    edit: false,
    assignmentId: null,
  };
}

/**
 * Task 7.2 (permission review, should-fix 7): who reads the edit requests of a
 * plan: its owner, the whole-branch roles and the Head Teachers of its subject,
 * the readers who decide or oversee them (`02`, "Who approves"); a teacher who
 * reads the plan by the subject and grade of the profile does not.
 */
export function seesRequests(reader: PlanReader, journal: JournalRow, ownerId: string | null): boolean {
  if (reader.staffId !== null && ownerId !== null && reader.staffId === ownerId) return true;
  return reader.access.permitting.some(
    (assignment) =>
      WHOLE_ROLES.includes(assignment.role) ||
      (SUBJECT_ROLES.includes(assignment.role) &&
        assignment.subjectIds.includes(lower(journal.subjectId))),
  );
}
