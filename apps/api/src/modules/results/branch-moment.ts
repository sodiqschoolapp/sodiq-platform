import type { Transaction } from '../../database/transactions.js';

/**
 * A transaction of one branch at a moment: what the figures of a quarter are read with, by a
 * route or by the preparation of the report totals (task 9.3b-1), which has no request.
 */
export interface BranchMoment {
  readonly transaction: Transaction;
  readonly branchId: string;
  readonly timeZone: string;
  readonly now: Date;
  /** The school date of `now` in the branch. */
  readonly today: string;
}
