import type { StudentResults } from '@sodiq/shared';
import type { Database } from '../../database/database.js';
import type { DemoSchool } from './school.js';

/**
 * Every quarter result of every student of the demo school, as
 * `branch | uid | subject | quarter | attendance classwork homework | outcome`, sorted (task
 * 11.24). Read through the student results route (`GET /api/results/students/:id`), which
 * calculates from the journal's rows with `packages/calc` on each read, never from prepared
 * totals (`.claude/rules/database.md`, the last rule), as the demo's Super Admin in the session
 * of the test.
 */
export async function studentResultLines(
  migrator: Database,
  school: DemoSchool,
): Promise<string[]> {
  const admin = school.superAdmin;
  const subjects = new Map(
    (await migrator.selectFrom('subjects').select(['id', 'name_en']).execute()).map((row) => [
      row.id,
      row.name_en,
    ]),
  );
  const branches = await migrator
    .selectFrom('branches')
    .select(['id', 'name'])
    .orderBy('name')
    .execute();
  const lines: string[] = [];
  for (const branch of branches) {
    const students = await migrator
      .selectFrom('students')
      .select(['id', 'uid'])
      .where('branch_id', '=', branch.id)
      .orderBy('uid')
      .execute();
    for (const student of students) {
      const results = await admin.caller
        .in(branch.id)
        .get<StudentResults>(`/api/results/students/${student.id}`);
      const numbers = new Map(results.quarters.map((one) => [one.id, one.number]));
      for (const subject of results.subjects) {
        for (const quarter of subject.quarters) {
          lines.push(
            [
              branch.name,
              student.uid ?? student.id,
              subjects.get(subject.subject.id) ?? subject.subject.id,
              `Q${String(numbers.get(quarter.quarterId) ?? '?')}`,
              `${String(quarter.attendance)} ${String(quarter.classwork)} ${String(quarter.homework)}`,
              JSON.stringify(quarter.outcome),
            ].join(' | '),
          );
        }
      }
    }
  }
  return lines.sort();
}
