import { schoolDateOf } from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';

/** The classes and groups a teacher teaches in one branch, in small letters. */
export interface Taught {
  classIds: string[];
  groupIds: string[];
}

/**
 * The classes and groups that the teaching load in force gives the staff
 * record of an account in the branch of the transaction (task 3.6a, owner's
 * answer L48 on issue #42: "the members of their classes and groups in the
 * teaching load in force"; decision 4 of pull request #118, Look first).
 *
 * For each academic year of the branch that is not closed, the published
 * version in force on the year's day (today in the branch's time zone, or the
 * year's first day when that is later): the latest start on or before it,
 * ties by number, as `readGroupTeachers` reads it for every reader. A draft
 * never counts; until a version is published (task 5.5) a teacher teaches
 * nobody. The staff record is read through the branch filter: a load row's
 * teacher is linked to the row's branch (`load_teacher_branch`, migration
 * 0055), so the teacher of a row is always visible here.
 */
export async function taughtAt(
  transaction: Transaction,
  accountId: string,
  branchId: string,
): Promise<Taught> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const today = schoolDateOf(await transactionMoment(transaction), branch.time_zone);
  const rows = await sql<{ class_id: string | null; group_id: string | null }>`
    with in_force as (
      select distinct on (v.academic_year_id) v.id
      from timetable_versions v
      join academic_years y on y.id = v.academic_year_id
      cross join lateral (select greatest(${today}::date, y.start_date) as day) d
      where v.branch_id = ${branchId}
        and y.status <> 'closed'
        and v.status = 'published'
        and v.starts_on <= d.day
      order by v.academic_year_id, v.starts_on desc, v.number desc
    )
    select distinct r.class_id, r.group_id
    from teaching_load_rows r
    join staff s on s.id = r.teacher_id
    where r.branch_id = ${branchId}
      and r.version_id in (select id from in_force)
      and s.account_id = ${accountId}
    order by r.class_id, r.group_id
  `.execute(transaction);
  return {
    classIds: rows.rows.flatMap((row) =>
      row.class_id === null ? [] : [row.class_id.toLowerCase()],
    ),
    groupIds: rows.rows.flatMap((row) =>
      row.group_id === null ? [] : [row.group_id.toLowerCase()],
    ),
  };
}
