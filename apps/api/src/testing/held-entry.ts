import type { Transaction } from '../database/transactions.js';

/**
 * The action of the held side's entry. A test that compares the audit log
 * before and after a route, with the held side still open at the first read,
 * leaves these out: they are the held side's write, as its lesson is, and not
 * the route's.
 */
export const HELD_ENTRY_ACTION = 'test.held_side';

/**
 * The audit entry the held side of a same-moment test writes, as the route it
 * stands for writes one in its transaction (`.claude/rules/api.md`: the held
 * side writes what its route writes). Since task 5.8b a change of a dated
 * lesson's teacher, room, time or cancel needs an entry of its transaction in
 * the lesson's branch (`lesson_history_unaudited`, 0105).
 */
export async function heldEntry(transaction: Transaction, branchId: string): Promise<void> {
  await transaction
    .insertInto('audit_log')
    .values({ occurred_at: new Date(0), branch_id: branchId, action: HELD_ENTRY_ACTION })
    .execute();
}
