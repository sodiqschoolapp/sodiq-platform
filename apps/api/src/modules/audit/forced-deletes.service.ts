import { Injectable } from '@nestjs/common';
import {
  forcedDeleteListSchema,
  forcedDeleteSchema,
  listName,
  type ErrorCode,
  type ForcedDelete,
  type ForcedDeleteList,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { ApiException } from '../../http/api-exception.js';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { Json } from '../../database/types.generated.js';
import type { Access } from '../access/permission.guard.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';

/**
 * The store of forced deletes (task 5.8b, pull request #195; `forced_deletes`,
 * 0105): the list of the branch and the restore within 30 days, one mechanism
 * for every kind of record (decision 10; 5.8c adds buildings, floors and
 * rooms). Each kind registers what it knows: how its rows are shown, its
 * year, and its restore, which runs under the store's locks and checks.
 */

/** A row of the store as a kind reads it. */
export interface StoreRow {
  readonly id: string;
  readonly branchId: string;
  readonly recordType: string;
  readonly recordId: string;
  readonly rows: Json;
}

/** What a kind of record gives the store. */
export interface StoreKind {
  /** The records of `rows` as the list shows them, by store id. */
  readonly describe: (
    transaction: Transaction,
    rows: readonly StoreRow[],
  ) => Promise<ReadonlyMap<string, ForcedDelete['lesson']>>;
  /** The academic year whose locks the restore takes. */
  readonly yearOf: (row: StoreRow) => string;
  /**
   * Puts the record back, its locks taken, the checks of the store passed:
   * writes `restored_by` first, then the rows, then its audit entry.
   */
  readonly restore: (
    transaction: Transaction,
    access: Access,
    row: StoreRow,
    requestId: string,
  ) => Promise<void>;
  /** The constraints the restore meets, by name, with the refusal each gives. */
  readonly refusals: Readonly<Record<string, ErrorCode>>;
  /** The refusal of a deadlock or a serialisation failure (40P01, 40001); without it they stay a 500. */
  readonly busy?: ErrorCode;
  /** Takes the locks of the record's year and checks it is open, before the store row. */
  readonly lock?: (transaction: Transaction, branchId: string, row: StoreRow) => Promise<void>;
}

@Injectable()
export class ForcedDeleteStore {
  private readonly kinds = new Map<string, StoreKind>();

  constructor(
    private readonly transactions: Transactions,
    private readonly requestKeys: RequestKeys,
  ) {}

  /** Registers a kind of record (at the start of its module). */
  register(recordType: string, kind: StoreKind): void {
    this.kinds.set(recordType, kind);
  }

  private kindOf(recordType: string): StoreKind {
    const kind = this.kinds.get(recordType);
    if (kind === undefined) throw new Error(`No restore for ${recordType}.`);
    return kind;
  }

  /** The store of the branch, newest first, `restorable` against the clock of the request. */
  list(access: Access): Promise<ForcedDeleteList> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await transaction
        .selectFrom('forced_deletes')
        .select('id')
        .where('branch_id', '=', branchId)
        .orderBy('deleted_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
      return forcedDeleteListSchema.parse({
        entries: await this.answersOf(
          transaction,
          branchId,
          found.map((one) => one.id),
        ),
      });
    });
  }

  /** One record of the store as the routes answer it. */
  async answerOf(transaction: Transaction, branchId: string, id: string): Promise<ForcedDelete> {
    const [answer] = await this.answersOf(transaction, branchId, [id]);
    if (answer === undefined) throw notFound();
    return answer;
  }

  private async answersOf(
    transaction: Transaction,
    branchId: string,
    ids: readonly string[],
  ): Promise<ForcedDelete[]> {
    if (ids.length === 0) return [];
    const rows = await transaction
      .selectFrom('forced_deletes')
      .selectAll()
      .where('branch_id', '=', branchId)
      .where('id', 'in', ids)
      .execute();
    const moment = await transactionMoment(transaction);
    const accounts = [
      ...new Set(
        rows.flatMap((one) => [
          one.deleted_by,
          ...(one.restored_by === null ? [] : [one.restored_by]),
        ]),
      ),
    ];
    const names = new Map<string, string>();
    if (accounts.length > 0) {
      const found = await sql<{ id: string; first_name: string | null; last_name: string | null }>`
        select id, first_name, last_name from audit_names(${accounts}::uuid[])
      `.execute(transaction);
      for (const one of found.rows) {
        names.set(
          one.id,
          listName({ firstName: one.first_name ?? '', lastName: one.last_name ?? '' }),
        );
      }
    }
    const described = new Map<string, ForcedDelete['lesson']>();
    const byType = new Map<string, StoreRow[]>();
    for (const one of rows) {
      const list = byType.get(one.record_type) ?? [];
      list.push(storeRowOf(one));
      byType.set(one.record_type, list);
    }
    for (const [recordType, list] of byType) {
      for (const [id, lesson] of await this.kindOf(recordType).describe(transaction, list)) {
        described.set(id, lesson);
      }
    }
    const byId = new Map(rows.map((one) => [one.id, one]));
    return ids.flatMap((id) => {
      const one = byId.get(id);
      const lesson = described.get(id);
      if (one === undefined || lesson === undefined) return [];
      return [
        forcedDeleteSchema.parse({
          id: one.id,
          recordType: one.record_type,
          lesson,
          reason: one.reason,
          deletedBy: { id: one.deleted_by, name: names.get(one.deleted_by) ?? '' },
          deletedAt: one.deleted_at.toISOString(),
          restoreUntil: one.restore_until.toISOString(),
          restoredAt: one.restored_at?.toISOString() ?? null,
          restoredBy:
            one.restored_by === null
              ? null
              : { id: one.restored_by, name: names.get(one.restored_by) ?? '' },
          restorable: one.restored_at === null && moment.getTime() < one.restore_until.getTime(),
        }),
      ];
    });
  }

  /** The restore of a record of the store, safe to repeat with its key (decisions 7 to 9). */
  restore(access: Access, id: string, key: string, requestId: string): Promise<ForcedDelete> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      // The record of the branch first, so an unknown or foreign id never waits on a lock.
      const found = await transaction
        .selectFrom('forced_deletes')
        .select(['id', 'branch_id', 'record_type', 'record_id', 'rows'])
        .where('id', '=', id)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (found === undefined) {
        throw notFound();
      }
      const kind = this.kindOf(found.record_type);
      return busyAs(kind.busy, () =>
        refusingConstraints(async () => {
          const once = await this.requestKeys.runOnce(
            transaction,
            {
              key,
              scope: 'forced_deletes.restore',
              accountId: access.accountId,
              input: { forcedDeleteId: id },
            },
            async () => {
              await kind.lock?.(transaction, branchId, storeRowOf(found));
              // The store row read again after the locks.
              const row = await transaction
                .selectFrom('forced_deletes')
                .select([
                  'id',
                  'branch_id',
                  'record_type',
                  'record_id',
                  'rows',
                  'restored_at',
                  'restore_until',
                ])
                .where('id', '=', id)
                .forUpdate()
                .executeTakeFirstOrThrow();
              if (row.restored_at !== null) {
                throw refusal('forced_delete_restored');
              }
              const moment = await transactionMoment(transaction);
              if (moment.getTime() >= row.restore_until.getTime()) {
                throw refusal('forced_delete_expired');
              }
              await kind.restore(transaction, access, storeRowOf(row), requestId);
              return await this.answerOf(transaction, branchId, id);
            },
          );
          return forcedDeleteSchema.parse(once.result);
        }, kind.refusals),
      );
    });
  }
}

function storeRowOf(row: {
  id: string;
  branch_id: string;
  record_type: string;
  record_id: string;
  rows: Json;
}): StoreRow {
  return {
    id: row.id,
    branchId: row.branch_id,
    recordType: row.record_type,
    recordId: row.record_id,
    rows: row.rows,
  };
}

const BUSY_CODES = new Set(['40P01', '40001']);

/** Runs the work and answers a deadlock or a serialisation failure with the kind's refusal. */
async function busyAs<T>(busy: ErrorCode | undefined, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (busy !== undefined && BUSY_CODES.has(String((error as { code?: unknown }).code))) {
      throw new ApiException(busy, 409);
    }
    throw error;
  }
}

function refusal(code: ErrorCode): ApiException {
  return new ApiException(code, 409);
}
