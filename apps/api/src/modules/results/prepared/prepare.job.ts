import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import { schoolDateOf } from '@sodiq/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import { Transactions, transactionMoment } from '../../../database/transactions.js';
import { defineJob } from '../../../jobs/job-definition.js';
import type { BranchMoment } from '../branch-moment.js';
import {
  behindUnits,
  isFresh,
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

/**
 * How long one run works before it leaves the rest to the next minute: the job shares the
 * database with the school's requests, and at the school's size a first preparation takes
 * minutes (CI of pull request #258: the browser tests slowed while it ran unbounded). Elapsed
 * work is measured with the process's monotonic timer, never the clock of the business rules.
 */
export const RUN_BUDGET_MS = 20_000;

@Injectable()
export class PreparedTotals implements BeforeApplicationShutdown {
  /** Set when the process stops: a run ends after the unit it is on, so the stop never waits on it. */
  private stopping = false;

  /** The branch the next run starts with, so a run that runs out of time never starves the last ones. */
  private next = 0;

  constructor(private readonly transactions: Transactions) {}

  beforeApplicationShutdown(): void {
    this.stopping = true;
  }

  /** Every branch in turn, within the budget of one run. */
  async run(budgetMs = RUN_BUDGET_MS): Promise<void> {
    const deadline = performance.now() + budgetMs;
    const branches = await this.transactions.run([], (transaction) =>
      transaction.selectFrom('branches').select(['id', 'time_zone']).orderBy('id').execute(),
    );
    for (let step = 0; step < branches.length; step += 1) {
      const index = (this.next + step) % branches.length;
      const branch = branches[index];
      if (branch === undefined) continue;
      const done = await this.prepareSome(branch.id, branch.time_zone, deadline);
      if (!done.finished) {
        this.next = index;
        return;
      }
    }
  }

  /**
   * The units of one branch that are behind or have no preparation, each prepared in a
   * transaction of its own; then the change rows every preparation saw are removed. Answers the
   * number of units prepared.
   */
  async prepareBranch(branchId: string, timeZone: string): Promise<number> {
    return (await this.prepareSome(branchId, timeZone, Number.POSITIVE_INFINITY)).prepared;
  }

  /** As `prepareBranch`, stopping when the process stops or the run's time is up. */
  private async prepareSome(
    branchId: string,
    timeZone: string,
    deadline: number,
  ): Promise<{ prepared: number; finished: boolean }> {
    if (this.stopping || performance.now() > deadline) return { prepared: 0, finished: false };
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
    let prepared = 0;
    for (const unit of listing.todo) {
      // The rest waits for the next run; the change rows stay, so nothing is lost.
      if (this.stopping || performance.now() > deadline) return { prepared, finished: false };
      const done = await this.transactions.run([branchId], (transaction) =>
        prepareUnit(transaction, branchId, timeZone, unit),
      );
      if (done) prepared += 1;
    }
    await this.transactions.run([branchId], (transaction) =>
      pruneChanges(transaction, branchId, listing.seen),
    );
    return { prepared, finished: true };
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

/**
 * One unit, in its own transaction. Two runs of the job may overlap (a run at full size outlasts
 * the minute): the unit's lock makes the second wait, and it prepares only if the unit is still
 * behind once the first has committed, so a preparation never replaces one that saw more
 * (code review, must-fix 1). The snapshot is taken after the lock and before any read (review
 * correction 2); `afterSnapshot` lets a test commit a change between the two.
 */
export async function prepareUnit(
  transaction: BranchMoment['transaction'],
  branchId: string,
  timeZone: string,
  unit: UnitKey,
  options: { readonly afterSnapshot?: () => Promise<void> } = {},
): Promise<boolean> {
  await sql`
    select pg_advisory_xact_lock(hashtextextended(${`report:${branchId}:${unitKeyOf(unit)}`}, 0))
  `.execute(transaction);
  const seen = await snapshotOf(transaction);
  await options.afterSnapshot?.();
  const inputs = await schoolInputsOf(transaction);
  const moment = await momentOf(transaction, branchId, timeZone);
  if (await isFresh(transaction, { branchId, unit, now: moment.now, schoolInputs: inputs })) {
    return false;
  }
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
    return true;
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
  return true;
}
