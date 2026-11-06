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
  PREPARED_SHAPE,
  pruneChanges,
  pruneSchoolChanges,
  snapshotOf,
  unitKeyOf,
  writeUnit,
  type UnitKey,
} from './prepared.query.js';
import { shareOutcomesIn } from '../quarter-outcomes.js';
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
 * Task 10.1c (code review round 1, finding 2): 40 s of each minute, from 20: under steady saves
 * at three times the size the units behind outgrew 20 s a minute; the browser tests' server no
 * longer schedules the job (`JOBS_UNSCHEDULED`, 30 October 2026).
 */
export const RUN_BUDGET_MS = 40_000;

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

  /**
   * Every branch in turn, within the budget of one run. The hidden Monitoring branch has no
   * prepared totals: it is in no school report (task 10.2b), and its reads calculate from source.
   */
  async run(budgetMs = RUN_BUDGET_MS): Promise<void> {
    const deadline = performance.now() + budgetMs;
    // Before any branch is listed: a school change visible here is seen by every preparation
    // below (task 10.1b, review correction 2).
    const { branches, seen } = await this.transactions.run([], async (transaction) => ({
      seen: await snapshotOf(transaction),
      branches: await transaction
        .selectFrom('branches')
        .select(['id', 'time_zone'])
        .where('purpose', 'is', null)
        .orderBy('id')
        .execute(),
    }));
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
    // Every branch prepared in this run: the school change rows every unit has seen go. The
    // transaction sees every branch, the hidden one included, whose units are never prepared.
    const every = await this.transactions.run([], (transaction) =>
      transaction.selectFrom('branches').select('id').orderBy('id').execute(),
    );
    await this.transactions.run(
      every.map((one) => one.id),
      (transaction) => pruneSchoolChanges(transaction, seen),
    );
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
      const inputs = PREPARED_SHAPE;
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
    for (const group of groupsOf(listing.todo)) {
      // The rest waits for the next run; the change rows stay, so nothing is lost.
      if (this.stopping || performance.now() > deadline) return { prepared, finished: false };
      prepared += await this.transactions.run([branchId], (transaction) =>
        prepareUnits(transaction, branchId, timeZone, group),
      );
    }
    await this.transactions.run([branchId], (transaction) =>
      pruneChanges(transaction, branchId, listing.seen),
    );
    return { prepared, finished: true };
  }
}

/** The kinds of a subject's units, prepared together (`prepareUnits`). */
const SUBJECT_KINDS: readonly UnitKey['kind'][] = ['outcomes', 'figures', 'closing'];

/**
 * The units in their order (behind the longest first), the `outcomes`, `figures` and
 * `closing` of one quarter and subject in one group at the place of the first of them.
 */
export function groupsOf(units: readonly UnitKey[]): UnitKey[][] {
  const groups: UnitKey[][] = [];
  const bySubject = new Map<string, UnitKey[]>();
  for (const unit of units) {
    if (!SUBJECT_KINDS.includes(unit.kind)) {
      groups.push([unit]);
      continue;
    }
    const key = `${unit.quarterId}|${unit.unitId}`;
    const group = bySubject.get(key);
    if (group === undefined) {
      const created = [unit];
      bySubject.set(key, created);
      groups.push(created);
    } else {
      group.push(unit);
    }
  }
  return groups;
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
  return (await prepareUnits(transaction, branchId, timeZone, [unit], options)) > 0;
}

/**
 * Task 10.1c (code review round 1, finding 2): several units in one transaction, one snapshot
 * for all of them, each locked (in one order, so two runs never wait on each other in a ring) and
 * checked fresh as `prepareUnit` does. The job prepares a subject's `outcomes`, `figures` and
 * `closing` of a quarter together, so the outcomes they all read are worked out once
 * (`shareOutcomesIn`): at three times the size a subject's units took 0.3 to 8 s each, more
 * than the job's minute could keep up with under steady saves. Answers the number of units
 * prepared or removed.
 */
export async function prepareUnits(
  transaction: BranchMoment['transaction'],
  branchId: string,
  timeZone: string,
  units: readonly UnitKey[],
  options: { readonly afterSnapshot?: () => Promise<void> } = {},
): Promise<number> {
  const ordered = [...units].sort((a, b) => unitKeyOf(a).localeCompare(unitKeyOf(b)));
  for (const unit of ordered) {
    await sql`
      select pg_advisory_xact_lock(hashtextextended(${`report:${branchId}:${unitKeyOf(unit)}`}, 0))
    `.execute(transaction);
  }
  const seen = await snapshotOf(transaction);
  await options.afterSnapshot?.();
  const inputs = PREPARED_SHAPE;
  const moment = await momentOf(transaction, branchId, timeZone);
  shareOutcomesIn(transaction);
  const started = await startedQuarters(moment);
  let prepared = 0;
  for (const unit of ordered) {
    if (await isFresh(transaction, { branchId, unit, now: moment.now, schoolInputs: inputs })) {
      continue;
    }
    prepared += 1;
    const quarter = started.find((one) => one.id === unit.quarterId);
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
      continue;
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
  return prepared;
}
