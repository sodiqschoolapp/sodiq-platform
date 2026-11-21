import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * The ids of a request that name a lesson, a journal or a record of one (task 10.10, decision
 * 6 of pull request #369, Look first): the path parameters, the comment target of the body
 * (`on`) and the query, under the names the routes open to keys use.
 */
export interface NamedRecords {
  lessons: string[];
  journals: string[];
  planItems: string[];
  planFiles: string[];
  unlocks: string[];
  planRequests: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ids(...values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string' && UUID.test(value));
}

function field(source: unknown, name: string): unknown {
  return source !== null && typeof source === 'object'
    ? (source as Record<string, unknown>)[name]
    : undefined;
}

/**
 * What a request names, read from the request as it arrived. A plan item is `itemId` on
 * `/api/plans/items/…` only; on `/plans/journals/:journalId/…` its journal is named already.
 */
export function namedRecords(request: {
  path: string;
  params: unknown;
  query: unknown;
  body: unknown;
}): NamedRecords {
  const { params, query, body } = request;
  const on = field(body, 'on');
  return {
    lessons: ids(
      field(params, 'lessonId'),
      field(on, 'lessonId'),
      field(query, 'lessonId'),
      field(body, 'lessonId'),
    ),
    journals: ids(
      field(params, 'journalId'),
      field(on, 'journalId'),
      field(query, 'journalId'),
      field(body, 'journalId'),
    ),
    planItems: request.path.startsWith('/api/plans/items/') ? ids(field(params, 'itemId')) : [],
    planFiles: request.path.startsWith('/api/plans/files/') ? ids(field(params, 'fileId')) : [],
    unlocks: ids(field(params, 'unlockId')),
    planRequests: request.path.startsWith('/api/plans/requests/')
      ? ids(field(params, 'requestId'))
      : [],
  };
}

/**
 * Whether one of the records is Tutor work: a lesson, journal or plan of a subject of the
 * Tutors department (`departments.tutors`, the Ma'naviyat soati and the Homework slot, as
 * `tutor-lessons.ts` decides them). `edge/people-roles-accounts`: "Through the key only the
 * Teacher, Head Teacher and Senior Head Teacher assignments count. Tutor work is done in this
 * platform." Read through the branch filter of the request: another branch's id is not seen
 * here and the route answers it as it always does.
 */
export async function namesTutorWork(
  transaction: Transaction,
  named: NamedRecords,
): Promise<boolean> {
  const none = Object.values(named).every((list: string[]) => list.length === 0);
  if (none) {
    return false;
  }
  const array = (list: string[]) => sql`${list}::uuid[]`;
  const found = await sql<{ tutor: boolean }>`
    select exists (
      select 1
      from subjects s
      join departments d on d.id = s.department_id
      where d.tutors and s.id in (
        select l.subject_id from lessons l where l.id = any(${array(named.lessons)})
        union all
        select j.subject_id from journals j where j.id = any(${array(named.journals)})
        union all
        select p.subject_id from lesson_plan_items i
          join lesson_plans p on p.id = i.plan_id
          where i.id = any(${array(named.planItems)})
        union all
        select p.subject_id from lesson_plan_files f
          join lesson_plan_items i on i.id = f.item_id
          join lesson_plans p on p.id = i.plan_id
          where f.id = any(${array(named.planFiles)})
        union all
        select coalesce(l.subject_id, j.subject_id) from journal_unlocks u
          left join lessons l on l.id = u.lesson_id
          left join journals j on j.id = u.journal_id
          where u.id = any(${array(named.unlocks)})
        union all
        select j.subject_id from lesson_plan_requests r
          join journals j on j.id = r.journal_id
          where r.id = any(${array(named.planRequests)})
      )
    ) as tutor
  `.execute(transaction);
  return found.rows[0]?.tutor === true;
}

/**
 * The subjects of the Tutors department, for a list read through a key that leaves Tutor work
 * out (the Journals page of a Teacher who is also a Tutor).
 */
export async function tutorSubjectIds(transaction: Transaction): Promise<Set<string>> {
  const rows = await transaction
    .selectFrom('subjects')
    .innerJoin('departments', 'departments.id', 'subjects.department_id')
    .select('subjects.id')
    .where('departments.tutors', '=', true)
    .execute();
  return new Set(rows.map((row) => row.id));
}
