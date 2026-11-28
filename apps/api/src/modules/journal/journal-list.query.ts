import { classDisplayName } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { ownerFactsOf, ownerOn } from '../timetable/journal-owners.js';
import { personNames, type JournalRow } from './journal-grid.query.js';

/** A teacher of a journal as the Journals page lists it. */
export interface JournalTeacher {
  readonly id: string;
  readonly name: string;
}

const unitKey = (one: {
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
}) => `${one.classId ?? ''}|${one.groupId ?? ''}|${one.subjectId}`;

/**
 * The teachers of each journal in a year (owner, 28 November 2026: the Journals page filtered
 * by a teacher, reached from the counts per teacher and from a journal's header). A person is
 * a teacher of the journal when a dated lesson of it in the year, not cancelled (held or
 * coming), counts for them by the rule of the counts per teacher (`lesson-counted.ts`, task
 * 8.7, decision 13): the substitute while a substitution is in force (its live row, and the
 * lesson's teacher is its substitute), otherwise the journal's owner on the lesson's date
 * (`ownerOn`: the teacher of the published row, the acting teacher under a vacancy, nobody
 * under a vacancy without one). A vacancy is never listed: it is not a person.
 *
 * One read of the lessons for every journal named, grouped by unit: the substitutes in force
 * and the dates of the other lessons, so the owner is found once per date, never per lesson.
 * By journal id, sorted by name (as the counts per teacher sort them), then by id.
 */
export async function journalTeachers(
  transaction: Transaction,
  branchId: string,
  journals: readonly JournalRow[],
  year: { readonly startDate: string; readonly endDate: string },
): Promise<Map<string, JournalTeacher[]>> {
  const found = new Map<string, JournalTeacher[]>();
  if (journals.length === 0) return found;
  const subjectIds = [...new Set(journals.map((one) => one.subjectId))];
  const { rows } = await sql<{
    class_id: string | null;
    group_id: string | null;
    subject_id: string;
    substitutes: string[] | null;
    dates: string[] | null;
  }>`
    select l.class_id, l.group_id, l.subject_id,
      array_agg(distinct s.substitute_id::text) filter (where s.id is not null) as substitutes,
      array_agg(distinct l.lesson_date::text) filter (where s.id is null) as dates
    from lessons l
    left join substitution_lessons sl on sl.lesson_id = l.id and sl.ended_at is null
    left join substitutions s on s.id = sl.substitution_id and s.substitute_id = l.teacher_id
    where l.branch_id = ${branchId}::uuid
      and l.subject_id = any(${subjectIds}::uuid[])
      and l.lesson_date between ${year.startDate}::date and ${year.endDate}::date
      and l.cancel_cause is null
    group by l.class_id, l.group_id, l.subject_id
  `.execute(transaction);
  const facts = await ownerFactsOf(
    transaction,
    branchId,
    journals.map((one) => ({
      id: one.id,
      academic_year_id: one.academicYearId,
      class_id: one.classId,
      group_id: one.groupId,
      subject_id: one.subjectId,
    })),
  );
  const journalOf = new Map(journals.map((one) => [unitKey(one), one.id]));
  const idsOf = new Map<string, Set<string>>();
  for (const row of rows) {
    const journalId = journalOf.get(
      unitKey({ classId: row.class_id, groupId: row.group_id, subjectId: row.subject_id }),
    );
    if (journalId === undefined) continue;
    const ids = new Set(row.substitutes ?? []);
    const runs = facts.runs.get(journalId) ?? [];
    const periods = facts.periods.get(journalId) ?? [];
    for (const date of row.dates ?? []) {
      const owner = ownerOn(runs, periods, facts.out, date);
      if (owner !== null && owner.kind !== 'none') ids.add(owner.staffId);
    }
    idsOf.set(journalId, ids);
  }
  const names = await personNames(transaction, [
    ...new Set([...idsOf.values()].flatMap((ids) => [...ids])),
  ]);
  for (const [journalId, ids] of idsOf) {
    found.set(
      journalId,
      [...ids]
        .flatMap((id) => {
          const name = names.get(id);
          return name === undefined ? [] : [{ id, name }];
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id)),
    );
  }
  return found;
}

/**
 * The classes each journal's students are drawn from (owner, 28 November 2026: the Class filter
 * of the Journals page): a class journal's own class, a group journal's classes
 * (`group_classes`), each named as the list names a class ("7 Oxford"), in grade and name order.
 */
export async function unitClasses(
  transaction: Transaction,
  journals: readonly JournalRow[],
): Promise<Map<string, { id: string; name: string }[]>> {
  const ids = [...new Set(journals.flatMap((one) => one.groupClassIds))];
  const rows =
    ids.length === 0
      ? []
      : await transaction
          .selectFrom('classes')
          .select(['id', 'grade', 'name'])
          .where('id', 'in', ids)
          .execute();
  const named = new Map(rows.map((row) => [row.id, row]));
  return new Map(
    journals.map((journal) => [
      journal.id,
      journal.classId !== null
        ? [{ id: journal.classId, name: journal.unitName }]
        : journal.groupClassIds
            .flatMap((id) => {
              const row = named.get(id);
              return row === undefined ? [] : [row];
            })
            .sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name, 'en'))
            .map((row) => ({ id: row.id, name: classDisplayName(row.grade, row.name) })),
    ]),
  );
}
