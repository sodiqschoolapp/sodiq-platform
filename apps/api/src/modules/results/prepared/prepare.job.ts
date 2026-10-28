import { Injectable } from '@nestjs/common';
import { schoolDateOf } from '@sodiq/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import { Transactions, transactionMoment } from '../../../database/transactions.js';
import { defineJob } from '../../../jobs/job-definition.js';
import type { BranchMoment } from '../branch-moment.js';
import {
  behindUnits,
  preparedKeys,
  pruneChanges,
  schoolInputsOf,
  snapshotOf,
  unitKeyOf,
  writeUnit,
  type UnitKey,
} from './prepared.query.js';
import { startedQuarters, unitsOf, unitValue } from './units.js';

/**
 * Every minute (task 9.3b-1, plan decision 2): prepares the units that are behind in each branch.
 * Sent by pg-boss's cron to the worker with no branch; decides from the stored change rows, the
 * preparations and the clock, never from being sent, so a late or repeated run does the same.
 */
export const prepareTotalsJob = defineJob({
  name: 'results.prepare_totals',
  data: z.strictObject({}),
  transaction: 'none',
  cron: '* * * * *',
  // A minute that is missed is not made up: the next one finds the same units behind.
  options: { retryLimit: 0, expireInSeconds: 30 * 60 },
});

@Injectable()
export class PreparedTotals {
  constructor(private readonly transactions: Transactions) {}

  /** Every branch in turn. */
  async run(): Promise<void> {
    const branches = await this.transactions.run([], (transaction) =>
      transaction.selectFrom('branches').select(['id', 'time_zone']).orderBy('id').execute(),
    );
    for (const branch of branches) await this.prepareBranch(branch.id, branch.time_zone);
  }

  /**
   * The units of one branch that are behind or have no preparation, each prepared in a
   * transaction of its own; then the change rows every preparation saw are removed. Answers the
   * number of units prepared.
   */
  async prepareBranch(branchId: string, timeZone: string): Promise<number> {
    const listing = await this.transactions.run([branchId], async (transaction) => {
      // Before anything is listed: a change visible here is seen by every preparation below.
      const seen = await snapshotOf(transaction);
      const moment = await momentOf(transaction, branchId, timeZone);
      const inputs = await schoolInputsOf(transaction);
      const have = await preparedKeys(transaction, branchId);
      const todo = new Map<string, UnitKey>();
      for (const unit of await unitsOf(moment)) {
        if (!have.has(unitKeyOf(unit))) todo.set(unitKeyOf(unit), unit);
      }
      for (const unit of await behindUnits(transaction, branchId, moment.now, inputs)) {
        todo.set(unitKeyOf(unit), unit);
      }
      return { seen, todo: [...todo.values()] };
    });
    for (const unit of listing.todo) {
      await this.transactions.run([branchId], (transaction) =>
        prepareUnit(transaction, branchId, timeZone, unit),
      );
    }
    await this.transactions.run([branchId], (transaction) =>
      pruneChanges(transaction, branchId, listing.seen),
    );
    return listing.todo.length;
  }
}

async function momentOf(
  transaction: BranchMoment['transaction'],
  branchId: string,
  timeZone: string,
): Promise<BranchMoment> {
  const now = await transactionMoment(transaction);
  return { transaction, branchId, timeZone, now, today: schoolDateOf(now, timeZone) };
}

/** One unit, in its own transaction: the snapshot first (review correction 2), then the reads. */
export async function prepareUnit(
  transaction: BranchMoment['transaction'],
  branchId: string,
  timeZone: string,
  unit: UnitKey,
): Promise<void> {
  const seen = await snapshotOf(transaction);
  const inputs = await schoolInputsOf(transaction);
  const moment = await momentOf(transaction, branchId, timeZone);
  const quarter = (await startedQuarters(moment)).find((one) => one.id === unit.quarterId);
  if (quarter === undefined) {
    // Undated or not begun any more: the unit is no longer prepared.
    await sql`
      delete from report_prepared
      where branch_id = ${branchId} and kind = ${unit.kind}
        and quarter_id = ${unit.quarterId} and unit_id = ${unit.unitId}
    `.execute(transaction);
    if (unit.kind === 'statuses') {
      await sql`
        delete from report_prepared_lessons
        where branch_id = ${branchId} and quarter_id = ${unit.quarterId}
          and journal_id = ${unit.unitId}
      `.execute(transaction);
    }
    return;
  }
  const value = await unitValue(moment, quarter, unit);
  await writeUnit(transaction, {
    branchId,
    unit,
    journalIds: value.journalIds,
    seen,
    schoolInputs: inputs,
    preparedAt: moment.now,
    nextChangeAt: value.nextChangeAt,
    value: value.value,
    ...(value.lessons === undefined ? {} : { lessons: value.lessons }),
  });
}
