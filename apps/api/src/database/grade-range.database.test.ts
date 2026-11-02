import { FIRST_GRADE, LAST_GRADE } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';

// Task 9.4d (db/migrations/0151): grades run from 0 to 11 in every check of the
// database (05, Class: "Grade (0–11)"; the spec change of 1 November 2026,
// item 3), and -1 and 12 stay refused. Some of these checks sit behind a
// trigger that refuses a wrong grade first (a master plan's grade must be one
// its subject teaches, and a subject's grades are themselves checked), so the
// test evaluates each check's own expression on -1, 0, 11 and 12, read from
// the catalog: the expression, not a fixture, is what is proved. The tables'
// own tests save a grade 0 row through the reachable paths.
describe('the grade range of the database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.destroy();
  });

  /** Each grade check: its table, its name and the columns of grades it reads. */
  const CHECKS = [
    { table: 'classes', name: 'classes_grade_check', columns: ['grade'] },
    { table: 'students', name: 'students_grade_check', columns: ['grade'] },
    {
      table: 'day_template_assignments',
      name: 'day_template_assignments_grade_from_check',
      columns: ['grade_from'],
    },
    {
      table: 'day_template_assignments',
      name: 'day_template_assignments_grade_to_check',
      columns: ['grade_to'],
    },
    {
      table: 'calendar_entries',
      name: 'calendar_entries_grades_check',
      columns: ['grade_from', 'grade_to'],
    },
    {
      table: 'timetable_version_days',
      name: 'timetable_version_days_grade_check',
      columns: ['grade'],
    },
    {
      table: 'lesson_plan_masters',
      name: 'lesson_plan_masters_grade_check',
      columns: ['grade'],
    },
  ] as const;

  /** The expression of a check, as PostgreSQL keeps it (`CHECK (...)` without the word). */
  const expressionOf = async (name: string): Promise<string> => {
    const row = await sql<{ definition: string }>`
      select pg_get_constraintdef(oid) as definition from pg_constraint where conname = ${name}
    `.execute(database.migrator);
    const definition = row.rows[0]?.definition;
    if (definition === undefined) throw new Error(`No constraint ${name}.`);
    return definition.replace(/^CHECK /, '');
  };

  /** Whether the check holds when every grade column it reads is the grade given. */
  const holds = async (name: string, columns: readonly string[], grade: number) => {
    const expression = await expressionOf(name);
    const values = columns.map((column) => `${String(grade)}::smallint as ${column}`).join(', ');
    const row = await sql<{ holds: boolean | null }>`
      select (${sql.raw(expression)}) as holds from (select ${sql.raw(values)}) as typed
    `.execute(database.migrator);
    // A check passes on true or null (PostgreSQL): null counts as held.
    return row.rows[0]?.holds !== false;
  };

  it('is 0 to 11 in the shared constants', () => {
    expect([FIRST_GRADE, LAST_GRADE]).toEqual([0, 11]);
  });

  for (const check of CHECKS) {
    it(`takes 0 and 11 and refuses -1 and 12 in ${check.name}`, async () => {
      expect(await holds(check.name, check.columns, FIRST_GRADE - 1)).toBe(false);
      expect(await holds(check.name, check.columns, 0)).toBe(true);
      expect(await holds(check.name, check.columns, 11)).toBe(true);
      expect(await holds(check.name, check.columns, LAST_GRADE + 1)).toBe(false);
    });
  }

  it('reads the grades of a subject and of a teacher as 0 to 11, each once, upwards', async () => {
    const valid = async (grades: string) =>
      (
        await sql<{ valid: boolean }>`
          select subject_grades_valid(${grades}::smallint[]) as valid
        `.execute(database.migrator)
      ).rows[0]?.valid;
    expect(await valid('{0}')).toBe(true);
    expect(await valid('{0,1,2,3,4}')).toBe(true);
    expect(await valid('{0,11}')).toBe(true);
    expect(await valid('{-1,0}')).toBe(false);
    expect(await valid('{0,12}')).toBe(false);
    expect(await valid('{1,0}')).toBe(false);
    expect(await valid('{0,0}')).toBe(false);
    expect(await valid('{}')).toBe(false);
    // Both checks of grades taught call it (0020, 0024).
    for (const name of ['subjects_grades_check', 'staff_subjects_grades_check']) {
      expect(await expressionOf(name)).toContain('subject_grades_valid(grades)');
    }
  });

  it('holds a whole-branch calendar entry as grades 0 to 11 against another of its kind', async () => {
    const expression = (
      await sql<{ definition: string }>`
        select pg_get_constraintdef(oid) as definition from pg_constraint
        where conname = 'calendar_entries_no_overlap'
      `.execute(database.migrator)
    ).rows[0]?.definition;
    expect(expression).toContain('COALESCE((grade_from)::integer, 0)');
    expect(expression).toContain('COALESCE((grade_to)::integer, 11)');
  });
});
