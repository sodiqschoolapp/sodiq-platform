import { ownClassRoleFor, type OwnClassRole } from '@sodiq/shared';

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

/** The role that holds a class of the grade as its own (the Tutor or the Class teacher). */
export const ownRoleOf = (grade: number): OwnClassRole => ownClassRoleFor(grade);
