import { apiErrorSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { expect } from 'vitest';
import type { Database } from '../database/database.js';

/** An id no record has (task 10.3b): the same one `day-templates-kit.ts` sends. */
export const UNKNOWN_ID = '0199a000-0000-7000-8000-000000000099';

/**
 * Every row of each table, in every branch: the connection given reads past the
 * row filter (the `migrator` of a `TestDatabase`). Rows are sorted by their
 * text, so two reads of unchanged tables are equal whatever order the database
 * gives (`.claude/rules/api.md`, task 1.5: "every row of the tables the route
 * writes, in both branches").
 */
export async function rowsOfTables(
  database: Database,
  tables: readonly string[],
): Promise<Record<string, string[]>> {
  const rows: Record<string, string[]> = {};
  for (const table of tables) {
    const result = await sql<{ row: string }>`
      select to_jsonb(t)::text as row from ${sql.table(table)} as t
    `.execute(database);
    rows[table] = result.rows.map((row) => row.row).sort();
  }
  return rows;
}

/** The answer is 404 in the one error shape (`not_found`, or a route's own code for a record not found). */
export function expectNotFound(response: Response): void {
  expect(response.status, JSON.stringify(response.body)).toBe(404);
  expect(apiErrorSchema.safeParse(response.body).success).toBe(true);
}

export interface RefusalById {
  /** The connection that reads past the row filter (the `migrator` of a `TestDatabase`). */
  database: Database;
  /**
   * The tables the route writes, also through shared functions (`.claude/rules/api.md`,
   * task 3.6c-2); `audit_log` is always compared. Empty for a route that writes nothing.
   */
  tables: readonly string[];
  /** The ids to send: another branch's (another account's) record, and `UNKNOWN_ID`. */
  ids: readonly string[];
  /** Sends the request with one of `ids` in the place under test, everything else valid. */
  send: (id: string) => Promise<Response>;
}

/**
 * Sends each id and expects 404 every time, with every row of the tables the
 * route writes and the audit log as they were (`.claude/rules/api.md`, tasks
 * 1.3 and 1.5).
 */
export async function expectRefusedById(refusal: RefusalById): Promise<void> {
  const tables = [...refusal.tables, 'audit_log'];
  const before = await rowsOfTables(refusal.database, tables);
  for (const id of refusal.ids) {
    expectNotFound(await refusal.send(id));
  }
  expect(await rowsOfTables(refusal.database, tables)).toEqual(before);
}
