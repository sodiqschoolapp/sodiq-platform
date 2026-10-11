import { Injectable } from '@nestjs/common';
import type { TravelTimeList, TravelTimeRecord } from '@sodiq/shared';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { Audit } from '../audit/audit.service.js';
import type { Access } from '../access/permission.guard.js';
import { notFound } from './setup-refusals.js';

/** The two ids of a pair as stored: the lower first (db/migrations/0019, `travel_times_order_check`). */
const pairOf = (a: string, b: string): { low: string; high: string } =>
  a < b ? { low: a, high: b } : { low: b, high: a };

/**
 * Travel time between two branches (`06`, Teachers who work in several
 * branches: "The Super Admin sets the travel time between each pair of
 * branches"; answer 21; decision 4 of pull request #49). One row per
 * unordered pair in a school-wide table; a pair without a row is not set.
 * A reader gets the pairs of the branch of the request only. A change is
 * audited in `audit_log_school`: a pair belongs to two branches equally
 * (correction 1 of the review).
 */
@Injectable()
export class TravelTimes {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  private async listIn(transaction: Transaction, branchId: string): Promise<TravelTimeList> {
    const branches = await transaction
      .selectFrom('branches')
      .select(['id', 'name'])
      .where('id', '<>', branchId)
      .orderBy('name')
      .orderBy('id')
      .execute();
    const rows = await transaction
      .selectFrom('travel_times')
      .select(['branch_low', 'branch_high', 'minutes'])
      .where((where) =>
        where.or([where('branch_low', '=', branchId), where('branch_high', '=', branchId)]),
      )
      .execute();
    const minutesTo = new Map(
      rows.map((row) => [
        row.branch_low === branchId ? row.branch_high : row.branch_low,
        row.minutes,
      ]),
    );
    return {
      pairs: branches.map((branch) => ({
        branchId: branch.id,
        branchName: branch.name,
        minutes: minutesTo.get(branch.id) ?? null,
      })),
    };
  }

  list(access: Access, branchId: string): Promise<TravelTimeList> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const branch = await transaction
        .selectFrom('branches')
        .select('id')
        .where('id', '=', branchId)
        .executeTakeFirst();
      if (branch === undefined) {
        throw notFound();
      }
      return this.listIn(transaction, branchId);
    });
  }

  /**
   * Sets the minutes between the branch of the request and another branch.
   * The two branch rows are taken `for update` in id order, so two saves of
   * one pair never race past each other; a save that changes nothing writes
   * nothing.
   */
  set(
    access: Access,
    branchId: string,
    record: TravelTimeRecord,
    requestId: string,
  ): Promise<TravelTimeList> {
    if (record.otherBranchId.toLowerCase() === branchId.toLowerCase()) {
      return Promise.reject(
        new ApiException('travel_time_same_branch', 409, undefined, [
          {
            path: 'otherBranchId',
            code: 'travel_time_same_branch',
            message: 'The other branch is the branch itself.',
          },
        ]),
      );
    }
    const { low, high } = pairOf(branchId.toLowerCase(), record.otherBranchId.toLowerCase());
    return this.transactions.run(access.branchIds, async (transaction) => {
      const locked = await transaction
        .selectFrom('branches')
        .select('id')
        .where('id', 'in', [low, high])
        .orderBy('id')
        .forUpdate()
        .execute();
      if (locked.length !== 2) {
        throw notFound();
      }
      const stored = await transaction
        .selectFrom('travel_times')
        .select('minutes')
        .where('branch_low', '=', low)
        .where('branch_high', '=', high)
        .executeTakeFirst();
      const before = stored?.minutes ?? null;
      if (before === record.minutes) {
        return this.listIn(transaction, branchId);
      }
      if (stored === undefined) {
        await transaction
          .insertInto('travel_times')
          .values({ branch_low: low, branch_high: high, minutes: record.minutes })
          .execute();
      } else {
        await transaction
          .updateTable('travel_times')
          .set({ minutes: record.minutes })
          .where('branch_low', '=', low)
          .where('branch_high', '=', high)
          .execute();
      }
      await this.audit.record(transaction, {
        branchId: null,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'travel_time.set',
        record: { type: 'travel_time', id: low },
        oldValue: { branchIds: [low, high], minutes: before },
        newValue: { branchIds: [low, high], minutes: record.minutes },
        requestId,
      });
      return this.listIn(transaction, branchId);
    });
  }
}
