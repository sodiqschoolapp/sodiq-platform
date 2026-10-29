import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * The students expected in each lesson named (task 6.1a; edge/00-definitions,
 * Expected student: "A student who is a member of the class or group on the
 * lesson's date and is not exempt for that lesson"): the one place the journal
 * asks, read from `lesson_expected_students` (0108), on which the database's
 * check of closed cells rests too. The exemption joins with 8.5. Task 10.1b: with `studentIds`,
 * `lesson_expected_students_among` (0147) works out those students only.
 */
export async function expectedStudents(
  transaction: Transaction,
  lessonIds: readonly string[],
  /** Task 10.1b: of these students only (one student's results page). */
  studentIds?: readonly string[],
): Promise<Map<string, string[]>> {
  const expected = new Map<string, string[]>(lessonIds.map((id) => [id, []]));
  if (lessonIds.length === 0) return expected;
  const found = await sql<{ lesson_id: string; student_id: string }>`
    select l.id as lesson_id, s.student_id
    from unnest(${[...lessonIds]}::uuid[]) as l(id)
    cross join lateral lesson_expected_students_among(
      l.id, ${studentIds === undefined ? null : [...studentIds]}::uuid[]
    ) as s(student_id)
    order by l.id, s.student_id
  `.execute(transaction);
  for (const row of found.rows) {
    expected.get(row.lesson_id)?.push(row.student_id);
  }
  return expected;
}
