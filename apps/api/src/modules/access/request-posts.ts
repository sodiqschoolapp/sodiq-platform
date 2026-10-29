import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { Post, Posts } from './request-routing.js';

/**
 * The posts in force at `now` that decide plan requests of one subject in one
 * branch (task 7.2, routing; `edge/people-roles-accounts`, row 16: "addressed
 * to the post, not the person, and shown to whoever holds it now"). Read from
 * `assignments`, which has no row policy: only rows of the branch and rows
 * with no branch are read (`database.md`). The Senior Head Teacher holds no
 * post in the hidden Monitoring branch (task 10.2b, `reachingBranch`).
 */
export async function postHolders(
  transaction: Transaction,
  branchId: string,
  subjectId: string,
  now: Date,
): Promise<{ accountId: string; post: Post }[]> {
  const { rows } = await sql<{ account_id: string; role: Post }>`
    select distinct a.account_id, a.role
    from assignments a
    left join assignment_subjects s
      on s.assignment_id = a.id
      and s.subject_id = ${subjectId}
      and s.valid_from <= ${now} and (s.valid_until is null or s.valid_until > ${now})
    where a.valid_from <= ${now} and (a.valid_until is null or a.valid_until > ${now})
      and (
        (a.role = 'super_admin' and a.branch_id is null)
        or (a.role = 'academic_vice_principal' and a.branch_id = ${branchId})
        or (a.role = 'senior_head_teacher' and a.branch_id is null and s.subject_id is not null
          and not exists (
            select 1 from branches b where b.id = ${branchId} and b.purpose = 'monitoring'
          ))
        or (a.role = 'head_teacher' and a.branch_id = ${branchId} and s.subject_id is not null)
      )
    order by a.account_id, a.role
  `.execute(transaction);
  return rows.map((row) => ({ accountId: row.account_id, post: row.role }));
}

/** The posts one account holds among the holders. */
export function postsOf(
  holders: readonly { accountId: string; post: Post }[],
  accountId: string | null,
): Posts {
  const own = holders.filter((holder) => holder.accountId === accountId).map((one) => one.post);
  return {
    superAdmin: own.includes('super_admin'),
    academicVicePrincipal: own.includes('academic_vice_principal'),
    seniorHeadTeacher: own.includes('senior_head_teacher'),
    headTeacher: own.includes('head_teacher'),
  };
}

/** The account of a staff record, if it has one. */
export async function accountOfStaff(
  transaction: Transaction,
  staffId: string | null,
): Promise<string | null> {
  if (staffId === null) return null;
  const found = await transaction
    .selectFrom('staff')
    .select('account_id')
    .where('id', '=', staffId)
    .executeTakeFirst();
  return found?.account_id ?? null;
}
