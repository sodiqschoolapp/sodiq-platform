import { PERMISSIONS, schoolDateOf, type Role, type SchoolDate } from '@sodiq/shared';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import type { CurrentAssignment } from './current-assignments.js';
import { permitting } from './permission-check.js';
import type { Access } from './permission.guard.js';
import { BRANCH_WIDE_ROLES } from './subject-scope.js';

/**
 * The roles whose limit is not a class (task 3.1c, decision 11 of pull
 * request #90): the branch-wide roles, and the Head Teacher and the Senior
 * Head Teacher, who read the "Full student list across classes and groups"
 * (`02`) and every class of the branch. They fit every class; the permission
 * table still decides each area. `class-scope.test.ts` pins the list.
 */
export const CLASS_WIDE_ROLES: readonly Role[] = [
  ...BRANCH_WIDE_ROLES,
  'head_teacher',
  'senior_head_teacher',
];

/**
 * The areas whose routes decide the class scope (task 3.1c): the permission
 * guard reads the classes of Tutor assignments only for a route of one of
 * them, so every other request of a Tutor costs no read. A route of another
 * area sees `classIds` empty, and a Tutor fits no class there; a task that
 * adds class scope to an area adds the area here (`class-scope.test.ts` pins
 * the list).
 */
export const CLASS_SCOPED_AREAS: readonly string[] = ['classes', 'students', 'student_contact'];

/**
 * Whether an assignment's scope fits one of the classes. A Tutor fits the
 * classes of its rows in force (`classIds`, filled by the permission guard);
 * a Teacher (own lessons, the journal) and the roles of Releases 2 and 3 fit
 * none.
 */
function fits(assignment: CurrentAssignment, classIds: readonly string[]): boolean {
  if (CLASS_WIDE_ROLES.includes(assignment.role)) {
    return true;
  }
  return (
    assignment.role === 'tutor' &&
    classIds.some((classId) => assignment.classIds.includes(classId.toLowerCase()))
  );
}

/**
 * The assignment that allows the route for a class, or for a student of the
 * given classes, or none: the first of `assignments` (the permitting ones of
 * the route, or every one that reads a group) whose scope fits. `02`, Tutor:
 * "Own class or classes ... the profiles of own class". The route refuses
 * with 403 when none fits and checks it on every request.
 *
 * `classIds` of a Tutor assignment is a read made by the permission guard at
 * the moment of its own transaction (decision 15 of pull request #90). The
 * routes of task 3.1c only read. A route that writes on the strength of the
 * class scope (an absence reason, the Tutor's own lessons) reads the Tutor row
 * again in its own transaction before the write (correction 2 of the review
 * of #90; `edge/students-classes-groups`: "the earlier one loses access on
 * the end date").
 *
 * The scope holds no class of a closed year (decision 14): the results and
 * journal tasks decide for their own routes whether a Tutor reads the closed
 * year of a class they held; nothing here decided that.
 */
export function inClassScope(
  assignments: readonly CurrentAssignment[],
  classIds: readonly string[],
): CurrentAssignment | undefined {
  return assignments.find((assignment) => fits(assignment, classIds));
}

/**
 * The classes a list may show: `all` when one of `assignments` is class-wide,
 * else the classes of its Tutor assignments (empty for none).
 */
export function classesInScope(
  assignments: readonly CurrentAssignment[],
): 'all' | ReadonlySet<string> {
  if (assignments.some((assignment) => CLASS_WIDE_ROLES.includes(assignment.role))) {
    return 'all';
  }
  return new Set(
    assignments
      .filter((assignment) => assignment.role === 'tutor')
      .flatMap((assignment) => assignment.classIds),
  );
}

/**
 * The classes of each Tutor assignment whose Tutor or acting Tutor row is in
 * force at the moment of the transaction (`edge/students-classes-groups`,
 * "The Tutor of a class changes in January": "the earlier one loses access on
 * the end date. An acting Tutor can be set for a period"), of a class whose
 * year is not closed (decision 14). A withdrawn row (an empty range) is never
 * in force. Read through the branch filter of the transaction: a Tutor row is
 * of the branch of its assignment. The moment is the transaction's, which the
 * triggers of `class_tutors` compare too (correction 1 of the review of #90).
 */
export async function tutorClassesAt(
  transaction: Transaction,
  assignmentIds: readonly string[],
): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  if (assignmentIds.length === 0) {
    return found;
  }
  const now = await transactionMoment(transaction);
  const rows = await transaction
    .selectFrom('class_tutors')
    .innerJoin('classes', 'classes.id', 'class_tutors.class_id')
    .innerJoin('academic_years', 'academic_years.id', 'classes.academic_year_id')
    .select(['class_tutors.assignment_id', 'class_tutors.class_id'])
    .where('class_tutors.assignment_id', 'in', assignmentIds)
    .where('class_tutors.kind', 'in', ['tutor', 'acting'])
    .where('class_tutors.valid_from', '<=', now)
    .where((builder) =>
      builder.or([
        builder('class_tutors.valid_until', 'is', null),
        builder('class_tutors.valid_until', '>', now),
      ]),
    )
    .where('classes.archived_at', 'is', null)
    .where('academic_years.status', '!=', 'closed')
    .orderBy('class_tutors.class_id')
    .execute();
  for (const row of rows) {
    const own = found.get(row.assignment_id) ?? [];
    own.push(row.class_id.toLowerCase());
    found.set(row.assignment_id, own);
  }
  return found;
}

/**
 * The classes of each student that make them "of" a class (decision 7 of
 * pull request #90): a class row in force on `today` or planned after it, not
 * ended and not withdrawn. A former member is of the class no more. `null`
 * reads every student of the branch of the transaction in one statement.
 */
export async function studentClasses(
  transaction: Transaction,
  today: SchoolDate,
  studentId: string | null,
): Promise<Map<string, string[]>> {
  let query = transaction
    .selectFrom('class_memberships')
    .select(['student_id', 'class_id'])
    .whereRef('valid_from', '<', 'valid_until')
    .where('valid_until', '>', today);
  if (studentId !== null) {
    query = query.where('student_id', '=', studentId);
  }
  const found = new Map<string, string[]>();
  for (const row of await query.orderBy('student_id').orderBy('class_id').execute()) {
    const own = found.get(row.student_id) ?? [];
    own.push(row.class_id.toLowerCase());
    found.set(row.student_id, own);
  }
  return found;
}

/**
 * The assignment that lets the account read a group of a student's fields
 * (`students` for the record, `student_contact` for Contact, and so on) in
 * the branch of the request, for a student of the given classes: one that
 * the table gives `view` of the area there and whose scope fits (task 3.1c,
 * decisions 2 and 8 of pull request #90). Decided from every current
 * assignment (`.claude/rules/api.md`): a Tutor who is also Head Teacher reads
 * the profile of every student and the Contact group of own classes only.
 * With no class given, only a class-wide reader fits.
 */
export function studentReaderOf(
  access: Access,
  area: string,
  classIds: readonly string[],
): CurrentAssignment | undefined {
  return inClassScope(
    permitting(
      { area, action: 'view', branch: 'request' },
      access.assignments,
      access.branchId,
      PERMISSIONS,
    ),
    classIds,
  );
}

/** The classes of one student of the branch of the transaction, today in the branch's time zone. */
export async function classesOfStudent(
  transaction: Transaction,
  branchId: string,
  studentId: string,
): Promise<string[]> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const today = schoolDateOf(await transactionMoment(transaction), branch.time_zone);
  return (await studentClasses(transaction, today, studentId)).get(studentId) ?? [];
}
