import type { Transaction } from '../../database/transactions.js';

/**
 * The start quarter of a branch that goes live mid-year (task 9.1, decision 8;
 * `edge/academic-year`, "The school goes live in the middle of the year"): the
 * quarter that contains the branch's start date (`branches.go_live_date`) is
 * "calculated from the lessons from the start date on. Its result is labelled
 * 'from' with the date, on screen, in prints and in exports"; "Quarters that
 * ended before the start date are marked 'not in the system' and left out of
 * the year result". No dated lessons exist before the start date, so the
 * lessons are already counted from it (4.3 decision 7); only the label and the
 * state come from here. Every reader of the label (the grid, its files, the
 * result at leaving, the student results) goes through here.
 */

export interface QuarterDates {
  readonly startDate: string;
  readonly endDate: string;
}

/** The branch's start date, or `null` when none is set. */
export async function goLiveOf(transaction: Transaction, branchId: string): Promise<string | null> {
  const row = await transaction
    .selectFrom('branches')
    .select('go_live_date')
    .where('id', '=', branchId)
    .executeTakeFirst();
  return row?.go_live_date ?? null;
}

/**
 * `countsFrom` of `studentQuarterOutcome`: the start date when it falls inside
 * the quarter after its first day (a start on the first day counts the whole
 * quarter, and no label is needed), else `null`.
 */
export const countsFromOf = (goLive: string | null, quarter: QuarterDates): string | null =>
  goLive !== null && goLive > quarter.startDate && goLive <= quarter.endDate ? goLive : null;

/** A quarter that ended before the start date: "not in the system". */
export const notInSystem = (goLive: string | null, quarter: QuarterDates): boolean =>
  goLive !== null && quarter.endDate < goLive;
