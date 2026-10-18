import { schoolDateOf, type SchoolDate } from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';

/** The classes and groups a teacher teaches in one branch, in small letters. */
export interface Taught {
  classIds: string[];
  groupIds: string[];
}

/** One load row of the published load in force: its year, class or group and subject. */
export interface TaughtRow {
  academic_year_id: string;
  class_id: string | null;
  group_id: string | null;
  subject_id: string;
}

/** Whose rows: the staff record of an account (the guard) or a staff record (the record page). */
export type TaughtBy = { readonly accountId: string } | { readonly staffId: string };

/** Today in the time zone of the branch, from the moment of the transaction. */
export async function branchToday(transaction: Transaction, branchId: string): Promise<SchoolDate> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  return schoolDateOf(await transactionMoment(transaction), branch.time_zone);
}

/**
 * The load rows of a staff record in the published version in force of each
 * academic year of the branch that is not closed, on the year's day (today in
 * the branch's time zone, or the year's first day when that is later): the
 * latest start on or before it, ties by number, as `readGroupTeachers` reads
 * it for every reader (task 3.6a, decision 4 of pull request #118). A draft
 * never counts. One query for `taughtAt` and for "Classes taught" on the
 * staff record (task 5.5c-2b, decision 7), so the two never disagree.
 */
export async function taughtRows(
  transaction: Transaction,
  branchId: string,
  today: SchoolDate,
  by: TaughtBy,
): Promise<TaughtRow[]> {
  const whose = 'accountId' in by ? sql`s.account_id = ${by.accountId}` : sql`s.id = ${by.staffId}`;
  const rows = await sql<TaughtRow>`
    with in_force as (
      select distinct on (v.academic_year_id) v.id, v.academic_year_id
      from timetable_versions v
      join academic_years y on y.id = v.academic_year_id
      cross join lateral (select greatest(${today}::date, y.start_date) as day) d
      where v.branch_id = ${branchId}
        and y.status <> 'closed'
        and v.status = 'published'
        and v.starts_on <= d.day
      order by v.academic_year_id, v.starts_on desc, v.number desc
    )
    select distinct f.academic_year_id, r.class_id, r.group_id, r.subject_id
    from teaching_load_rows r
    join in_force f on f.id = r.version_id
    join staff s on s.id = r.teacher_id
    where r.branch_id = ${branchId}
      and ${whose}
    order by f.academic_year_id, r.class_id, r.group_id, r.subject_id
  `.execute(transaction);
  return rows.rows;
}

/**
 * The classes and groups that the teaching load in force gives the staff
 * record of an account in the branch of the transaction (task 3.6a, owner's
 * answer L48 on issue #42: "the members of their classes and groups in the
 * teaching load in force"; decision 4 of pull request #118, Look first), read
 * by `taughtRows`. The staff record is read through the branch filter: a load
 * row's teacher is linked to the row's branch (`load_teacher_branch`,
 * migration 0055), so the teacher of a row is always visible here.
 */
export async function taughtAt(
  transaction: Transaction,
  accountId: string,
  branchId: string,
): Promise<Taught> {
  const today = await branchToday(transaction, branchId);
  const rows = await taughtRows(transaction, branchId, today, { accountId });
  const lower = (ids: readonly (string | null)[]) =>
    [...new Set(ids.flatMap((id) => (id === null ? [] : [id.toLowerCase()])))].sort();
  return {
    classIds: lower(rows.map((row) => row.class_id)),
    groupIds: lower(rows.map((row) => row.group_id)),
  };
}
