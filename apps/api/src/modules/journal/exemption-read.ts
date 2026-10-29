import type { ExemptionCategory, ExemptionKind } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * What the journal reads of exemptions (task 8.5, pull request #223): the
 * mark an exempt cell shows (`lesson_student_exemption`, 0123: an exemption
 * or a kept block) and the exemptions of the students shown. Marks 4 and 5
 * are never stored (task 6.1a, decision 4).
 */

/** The members of each lesson exempt there, with the kind shown: 5 `full`, 4 `temporary`. */
export async function exemptionMarksOf(
  transaction: Transaction,
  lessonIds: readonly string[],
  /** Task 10.1b: of these students only (one student's results page). */
  studentIds?: readonly string[],
): Promise<Map<string, Map<string, ExemptionKind>>> {
  const answer = new Map<string, Map<string, ExemptionKind>>();
  if (lessonIds.length === 0) return answer;
  const found = await sql<{ lesson_id: string; student_id: string; kind: ExemptionKind }>`
    with members as materialized (
      select * from (
        select l.id as lesson_id, m.student_id
        from unnest(${[...lessonIds]}::uuid[]) as x(id)
        join lessons l on l.id = x.id
        join class_memberships m on m.class_id = l.class_id
          and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
        union
        select l.id, m.student_id
        from unnest(${[...lessonIds]}::uuid[]) as x(id)
        join lessons l on l.id = x.id
        join group_memberships m on m.group_id = l.group_id
          and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
      ) all_members
      where ${studentIds === undefined}::boolean
        or all_members.student_id = any(${[...(studentIds ?? [])]}::uuid[])
    ),
    -- Only a member with a live span, or of a lesson a kept block may touch, can be
    -- exempt (0124): the others are not asked one by one. Materialized, so the filter runs
    -- before the function (the planner orders the conditions of one level by cost).
    kept as materialized (
      select x.id as lesson_id, lesson_kept_out_possible(x.id) as possible
      from unnest(${[...lessonIds]}::uuid[]) as x(id)
    ),
    spanned as materialized (
      select distinct s.student_id from exemption_spans s
      where s.live and s.student_id in (select student_id from members)
    ),
    asked as materialized (
      select m.lesson_id, m.student_id
      from members m
      join kept k on k.lesson_id = m.lesson_id
      where k.possible or m.student_id in (select student_id from spanned)
    )
    select lesson_id, student_id, kind
    from (
      select a.lesson_id, a.student_id, lesson_student_exemption(a.lesson_id, a.student_id) as kind
      from asked a
    ) k
    where kind is not null
  `.execute(transaction);
  for (const row of found.rows) {
    const of = answer.get(row.lesson_id) ?? new Map<string, ExemptionKind>();
    of.set(row.student_id, row.kind);
    answer.set(row.lesson_id, of);
  }
  return answer;
}

export interface StudentExemption {
  readonly studentId: string;
  readonly kind: ExemptionKind;
  readonly startDate: string;
  readonly endDate: string;
  readonly slots: { start: string; end: string } | null;
  readonly category: ExemptionCategory;
  readonly subjectIds: readonly string[] | null;
}

/** The live exemptions of the students touching the dates, of the transaction's branches. */
export async function studentExemptionsOf(
  transaction: Transaction,
  studentIds: readonly string[],
  from: string,
  until: string,
): Promise<StudentExemption[]> {
  if (studentIds.length === 0) return [];
  const found = await sql<{
    student_id: string;
    kind: ExemptionKind;
    start_date: string;
    end_date: string;
    start_time: string | null;
    end_time: string | null;
    category: ExemptionCategory;
    subject_ids: string[] | null;
  }>`
    select e.student_id, e.kind, e.start_date::text as start_date, e.end_date::text as end_date,
      to_char(e.start_time, 'HH24:MI') as start_time, to_char(e.end_time, 'HH24:MI') as end_time,
      e.category,
      case when e.all_subjects then null else (
        select array_agg(x.subject_id order by x.subject_id) from exemption_subjects x
        where x.exemption_id = e.id
      ) end as subject_ids
    from exemptions e
    where e.student_id = any(${[...studentIds]}::uuid[])
      and e.voided_at is null
      and e.start_date <= ${until}::date and e.end_date >= ${from}::date
    order by e.start_date, e.id
  `.execute(transaction);
  return found.rows.map((row) => ({
    studentId: row.student_id,
    kind: row.kind,
    startDate: row.start_date,
    endDate: row.end_date,
    slots:
      row.start_time === null || row.end_time === null
        ? null
        : { start: row.start_time, end: row.end_time },
    category: row.category,
    subjectIds: row.subject_ids,
  }));
}

/** The students exempt for a subject on a date (a rating exam's: "exempt on exam day, pending"). */
export async function exemptOnDate(
  transaction: Transaction,
  studentIds: readonly string[] | null,
  subjectId: string,
  date: string,
): Promise<Set<string>> {
  const found = await sql<{ student_id: string }>`
    select distinct s.student_id
    from exemption_spans s
    where s.live
      and (${studentIds === null}::boolean or s.student_id = any(${[...(studentIds ?? [])]}::uuid[]))
      and s.subject_key in ('00000000-0000-0000-0000-000000000000'::uuid, ${subjectId}::uuid)
      and s.span && tsrange(${date}::date::timestamp, (${date}::date + 1)::timestamp, '[)')
  `.execute(transaction);
  return new Set(found.rows.map((row) => row.student_id));
}
