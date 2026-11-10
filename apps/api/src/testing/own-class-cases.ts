import { ownClassRoleFor, type OwnClassRole } from '@sodiq/shared';
import type { Database } from '../database/database.js';

/**
 * Task 9.4e (`edge/00-definitions`, Tutor of a class: "Every rule that names
 * the Tutor of a class … applies in the same way to the Class teacher of a
 * class of grades 0–4"): a scope test of a Tutor runs once as the Tutor of a
 * class of grade 7 and once as the Class teacher of a class of grade 1, with
 * `it.each(OWN_CLASS_CASES)('… the %s of …', async (_who, grade) => …)`.
 */
export const OWN_CLASS_CASES: readonly (readonly [string, number])[] = [
  ['Tutor', 7],
  ['Class teacher', 1],
];

/**
 * The same two cases for a scene with the rating exam: the Class teacher's class is of grade 2, as
 * a journal of grades 0 and 1 has no rating exam (`05`, Grades 0 and 1; the owner's spec change of
 * 10 November 2026).
 */
export const RATING_OWN_CLASS_CASES: readonly (readonly [string, number])[] = [
  ['Tutor', 7],
  ['Class teacher', 2],
];

/** The role that holds a class of the grade as its own (the Tutor or the Class teacher). */
export const ownRoleOf = (grade: number): OwnClassRole => ownClassRoleFor(grade);

/** The grade of a class, for a student written into it. */
export async function gradeOf(migrator: Database, classId: string): Promise<number> {
  const found = await migrator
    .selectFrom('classes')
    .select('grade')
    .where('id', '=', classId)
    .executeTakeFirstOrThrow();
  return found.grade;
}

/**
 * Ends every Super Admin role but the kit's own: a test run once per own-class role gives a
 * Super Admin each time, and at most 3 accounts hold the role (`MAX_SUPER_ADMINS`).
 */
export async function endTestSuperAdmins(migrator: Database, keep: string): Promise<void> {
  await migrator
    .updateTable('assignments')
    .set((builder) => ({ valid_until: builder.ref('valid_from') }))
    .where('role', '=', 'super_admin')
    .where('id', '!=', keep)
    .execute();
}
