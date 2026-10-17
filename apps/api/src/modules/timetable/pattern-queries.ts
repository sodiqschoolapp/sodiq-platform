import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * A swap of two blocks (task 5.4a): the clash constraints of the weekly pattern
 * (db/migrations/0058, deferrable initially immediate, "deferrable for a
 * swap") are checked at the commit, so the two blocks may pass through each
 * other's slot inside the transaction; a clash left at the commit is still
 * refused.
 */
export async function deferPatternClashes(transaction: Transaction): Promise<void> {
  await sql`set constraints pattern_entries_teacher_excl, pattern_entries_room_excl, pattern_block_classes_excl deferred`.execute(
    transaction,
  );
}
