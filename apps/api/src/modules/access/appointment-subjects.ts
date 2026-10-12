import type { AppointedSubject } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * Writes the subjects of an appointment given in this transaction
 * (db/migrations/0028). The application names the assignment and the subject
 * only; the trigger `assignment_subjects_fill` copies the role, branch and
 * dates of the assignment and refuses a role without subjects, an assignment
 * of an earlier transaction and an archived subject. Plain SQL because the
 * generated types ask for the columns the trigger fills.
 */
export async function insertAppointmentSubjects(
  transaction: Transaction,
  assignmentId: string,
  subjectIds: readonly string[],
): Promise<void> {
  for (const subjectId of [...subjectIds].map((id) => id.toLowerCase()).sort()) {
    await sql`
      insert into assignment_subjects (assignment_id, subject_id)
      values (${assignmentId}::uuid, ${subjectId}::uuid)
    `.execute(transaction);
  }
}

/**
 * The subjects of the given assignments, with their names in the three
 * languages, by assignment id. `subjects` is a school-wide table; the
 * assignments are those the caller may read.
 */
export async function appointedSubjects(
  transaction: Transaction,
  assignmentIds: readonly string[],
): Promise<Map<string, AppointedSubject[]>> {
  const found = new Map<string, AppointedSubject[]>();
  if (assignmentIds.length === 0) {
    return found;
  }
  const rows = await transaction
    .selectFrom('assignment_subjects')
    .innerJoin('subjects', 'subjects.id', 'assignment_subjects.subject_id')
    .select([
      'assignment_subjects.assignment_id',
      'subjects.id',
      'subjects.name_uz',
      'subjects.name_ru',
      'subjects.name_en',
      'subjects.archived_at',
    ])
    .where('assignment_subjects.assignment_id', 'in', [...assignmentIds])
    .orderBy('subjects.name_en')
    .orderBy('subjects.id')
    .execute();
  for (const row of rows) {
    const list = found.get(row.assignment_id) ?? [];
    list.push({
      id: row.id,
      names: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
      archived: row.archived_at !== null,
    });
    found.set(row.assignment_id, list);
  }
  return found;
}
