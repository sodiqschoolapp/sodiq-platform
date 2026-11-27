import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

// Task 11.27 (0191; `09`, Codes: "A code is free text of at most 20 characters (spaces at either
// end are dropped)"; plan decision 4: no code is null). The length checks of the four columns.
describe('the checks of the code columns (task 11.27)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.destroy();
  });

  const CHECKS = [
    ['lesson_plan_items', 'topic_code', 'lesson_plan_items_topic_code_check'],
    ['lesson_plan_works', 'work_code', 'lesson_plan_works_work_code_check'],
    ['lesson_plan_master_items', 'topic_code', 'lesson_plan_master_items_topic_code_check'],
    ['lesson_plan_master_works', 'work_code', 'lesson_plan_master_works_work_code_check'],
  ] as const;

  it('takes null and 1 to 20 characters with no space at either end, on each column', async () => {
    for (const [table, column, check] of CHECKS) {
      const definition = await sql<{ definition: string }>`
        select pg_get_constraintdef(c.oid) as definition
        from pg_constraint c
        where c.conname = ${check} and c.conrelid = ${table}::regclass and c.convalidated
      `.execute(database.migrator);
      expect(definition.rows, check).toHaveLength(1);
      // The check itself, on the values a row could hold.
      const passes = async (value: string | null) =>
        (
          await sql<{ ok: boolean }>`
            select ${sql.raw(`(${definition.rows[0]?.definition.replace(/^CHECK /, '') ?? 'false'})`)}
              is not false as ok
            from (select ${value}::text as ${sql.ref(column)}) as row
          `.execute(database.migrator)
        ).rows[0]?.ok;
      expect(await passes(null), `${check} null`).toBe(true);
      expect(await passes('A'.repeat(20)), `${check} 20`).toBe(true);
      expect(await passes('Ж'.repeat(20)), `${check} 20 Cyrillic`).toBe(true);
      expect(await passes('A'.repeat(21)), `${check} 21`).toBe(false);
      expect(await passes(' A1'), `${check} leading space`).toBe(false);
      expect(await passes('A1\t'), `${check} trailing tab`).toBe(false);
      expect(await passes(''), `${check} empty`).toBe(false);
    }
  });

  it('starts every subject with its codes off', async () => {
    const column = await sql<{ column_default: string; is_nullable: string }>`
      select column_default, is_nullable from information_schema.columns
      where table_name = 'subjects' and column_name = 'codes_on'
    `.execute(database.migrator);
    expect(column.rows).toEqual([{ column_default: 'false', is_nullable: 'NO' }]);
  });
});
