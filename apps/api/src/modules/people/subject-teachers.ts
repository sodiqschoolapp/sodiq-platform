import type { ErrorDetail } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';

/**
 * The people a change of a subject's department or grades would leave outside
 * it (`04`: "a teacher's subjects come from one department"; task 2.2a,
 * decision 13 and correction 7 of the review of pull request #53): those
 * linked to the branch of the transaction are named by id (an open vacancy
 * among them as such, task 2.2b); those of other
 * branches are a count from `staff_subject_in_use`, never their data. Only
 * people who have not left count, and a person who has left with a re-hire
 * planned counts (`staff_out_for_good`, findings 2 and 3 of code round 1). The subject row is locked by the caller,
 * and a staff save reads it FOR SHARE, so neither change slips past the other.
 */
export async function teachersOutside(
  transaction: Transaction,
  change: { subjectId: string; grades: readonly number[]; departmentId: string },
  at: Date,
): Promise<{ inBranch: { id: string; vacancy: boolean }[]; elsewhere: number }> {
  const grades = sql`${[...change.grades]}::smallint[]`;
  const found = await sql<{ staff_id: string; kind: string }>`
    select distinct ss.staff_id, s.kind
    from staff_subjects ss
    join staff s on s.id = ss.staff_id
    left join staff_divisions sd on sd.staff_id = ss.staff_id
      and sd.division_id = (select d.id from divisions d where d.built_in)
    where ss.subject_id = ${change.subjectId}
      and not staff_out_for_good(ss.staff_id, ${at})
      and (not (ss.grades <@ ${grades}) or sd.department_id is distinct from ${change.departmentId}::uuid)
    order by ss.staff_id
  `.execute(transaction);
  const elsewhere = await sql<{ people: number }>`
    select staff_subject_in_use(${change.subjectId}::uuid, ${grades}, ${change.departmentId}::uuid, ${at}) as people
  `.execute(transaction);
  return {
    inBranch: found.rows.map((row) => ({ id: row.staff_id, vacancy: row.kind === 'vacancy' })),
    elsewhere: elsewhere.rows[0]?.people ?? 0,
  };
}

/**
 * `subject_has_teachers` with the people of the branch as `staff.<id>` and the
 * count of other branches as `elsewhere`, when anybody would be left outside.
 */
export async function refuseTeachersOutside(
  transaction: Transaction,
  change: { subjectId: string; grades: readonly number[]; departmentId: string },
  at: Date,
): Promise<void> {
  const outside = await teachersOutside(transaction, change, at);
  if (outside.inBranch.length === 0 && outside.elsewhere === 0) {
    return;
  }
  // An open vacancy of the branch is named as `vacancy.<id>` (task 2.2b, pull
  // request #57, correction 4).
  const details: ErrorDetail[] = outside.inBranch.map((one) =>
    one.vacancy
      ? {
          path: `vacancy.${one.id}`,
          code: 'teaches',
          message: 'An open vacancy of this branch has the subject with these grades.',
        }
      : {
          path: `staff.${one.id}`,
          code: 'teaches',
          message: 'A staff member of this branch has the subject with these grades.',
        },
  );
  if (outside.elsewhere > 0) {
    details.push({
      path: 'elsewhere',
      code: String(outside.elsewhere),
      message: 'The number of staff members of other branches who have it.',
    });
  }
  throw new ApiException('subject_has_teachers', 409, undefined, details);
}
