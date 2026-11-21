import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * The names of the integration keys that audit entries name (task 10.10). `integration_keys`
 * is school-wide (0175): a key's name is not personal data, and every reader of an entry sees
 * the key it was made through ("via English platform").
 */
export async function integrationKeyNames(
  transaction: Transaction,
  keyIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(keyIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await transaction
    .selectFrom('integration_keys')
    .select(['id', 'name'])
    .where('id', 'in', ids)
    .execute();
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** `{ name }` of the key of an entry or a history line, or `null` when it was not made through one. */
export function viaKeyOf(
  names: ReadonlyMap<string, string>,
  keyId: string | null,
): { name: string } | null {
  if (keyId === null) {
    return null;
  }
  // A key is never deleted (0176): its name is always found; the id stands in otherwise.
  return { name: names.get(keyId) ?? keyId };
}

/**
 * For a history table written in the transaction of its audit entry (`written_xact`, as
 * `lesson_history_unaudited` reads it): the key that entry names, as a column `via_key_id`
 * of the select. The cell, rating and comment histories show "via <key name>" from it, so
 * the history tables need no column of their own (decision 12 of pull request #369).
 */
export function viaKeyIdColumn(
  table:
    | 'journal_cell_history'
    | 'journal_rating_history'
    | 'journal_comment_history'
    | 'journal_work_history',
) {
  const line = sql.table(table);
  return sql<string | null>`(
    select a.integration_key_id from audit_log a
    where a.branch_id = ${line}.branch_id
      and a.written_xact = ${line}.written_xact
      and a.integration_key_id is not null
    limit 1
  )`.as('via_key_id');
}
