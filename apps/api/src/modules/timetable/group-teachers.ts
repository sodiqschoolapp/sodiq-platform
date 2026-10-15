import { listName, schoolDateOf, type SchoolGroup } from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';

/** The teacher of a group as its card shows it. */
export type GroupTeacher = NonNullable<SchoolGroup['teacher']>;

/**
 * Task 3.4b, decision 9 with correction 1: the teacher or vacancy of each
 * group's load row (05, Group: "teacher (or a vacancy)"; 3.2a decision 15). The
 * day is today in the branch's time zone, or the first day of the group's year
 * when that is later. The row of the published version of the group's year in
 * force on that day (the latest start on or before it, ties by number), for
 * every reader; while that year has none, and only when `drafts` (a reader of
 * the area `timetable`), the row of its draft with the latest start on or
 * before the day (ties by number), else of its earliest later draft, marked
 * `draft`. No version, or no row of the group in it: no teacher.
 */
export async function readGroupTeachers(
  transaction: Transaction,
  branchId: string,
  groups: readonly { id: string; academicYearId: string }[],
  drafts: boolean,
): Promise<Map<string, GroupTeacher>> {
  const found = new Map<string, GroupTeacher>();
  if (groups.length === 0) {
    return found;
  }
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const today = schoolDateOf(await transactionMoment(transaction), branch.time_zone);
  const yearIds = [...new Set(groups.map((group) => group.academicYearId))].sort();
  const running = await sql<{ year_id: string; version_id: string; draft: boolean }>`
    select distinct on (v.academic_year_id)
      v.academic_year_id as year_id, v.id as version_id, v.status = 'draft' as draft
    from timetable_versions v
    join academic_years y on y.id = v.academic_year_id
    cross join lateral (select greatest(${today}::date, y.start_date) as day) d
    where v.branch_id = ${branchId}
      and v.academic_year_id in (${sql.join(yearIds)})
      and (
        (v.status = 'published' and v.starts_on <= d.day)
        or (v.status = 'draft' and ${drafts} and not exists (
          select 1 from timetable_versions p
          where p.academic_year_id = v.academic_year_id
            and p.status = 'published'
            and p.starts_on <= d.day
        ))
      )
    order by v.academic_year_id,
      (v.status = 'published') desc,
      (v.starts_on <= d.day) desc,
      case when v.starts_on <= d.day then v.starts_on end desc,
      case when v.starts_on > d.day then v.starts_on end asc,
      v.number desc
  `.execute(transaction);
  const versions = running.rows;
  if (versions.length === 0) {
    return found;
  }
  const rows = await transaction
    .selectFrom('teaching_load_rows')
    .innerJoin('staff', 'staff.id', 'teaching_load_rows.teacher_id')
    .select([
      'teaching_load_rows.version_id',
      'teaching_load_rows.group_id',
      'staff.id',
      'staff.kind',
      'staff.first_name',
      'staff.last_name',
      'staff.vacancy_name',
    ])
    .where(
      'teaching_load_rows.version_id',
      'in',
      versions.map((one) => one.version_id),
    )
    .where(
      'teaching_load_rows.group_id',
      'in',
      groups.map((group) => group.id),
    )
    .execute();
  for (const row of rows) {
    if (row.group_id === null) continue;
    const version = versions.find((one) => one.version_id === row.version_id);
    found.set(row.group_id, {
      id: row.id,
      kind: row.kind === 'vacancy' ? 'vacancy' : 'person',
      name:
        row.kind === 'vacancy'
          ? row.vacancy_name
          : listName({ firstName: row.first_name ?? '', lastName: row.last_name ?? '' }),
      draft: version?.draft ?? false,
    });
  }
  return found;
}
