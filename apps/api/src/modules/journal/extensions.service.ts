import { Inject, Injectable } from '@nestjs/common';
import { type EditExtension, type EditExtensionCreate, type EditExtensions } from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { refusingConstraints } from '../setup/setup-refusals.js';
import { namedAccounts } from './cell-lines.query.js';

/**
 * The branch-wide extension of the edit period (task 8.4, pull request #222,
 * decision 13; `edge/system-behaviour`, "The data centre ... is down": "The
 * Academic Vice Principal extends the edit period for a date range for the
 * whole branch in one logged action"). A range of the branch's open academic
 * year ending today or earlier, 1 to 7 days from today; never changed or
 * removed. The lock of each lesson in the range is the later of its own and
 * the extension's (`journal_lock_moment`, 0122).
 */
@Injectable()
export class ExtensionsService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  list(access: Access): Promise<EditExtensions> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => ({
      extensions: await this.rowsOf(transaction, branchId, null),
    }));
  }

  create(access: Access, input: EditExtensionCreate, requestId: string): Promise<EditExtension> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const year = await transaction
            .selectFrom('academic_years')
            .select([
              sql<string>`start_date::text`.as('start_date'),
              sql<string>`end_date::text`.as('end_date'),
            ])
            .where('branch_id', '=', branchId)
            .where('status', '=', 'current')
            .executeTakeFirst();
          if (
            year === undefined ||
            input.fromDate < year.start_date ||
            input.toDate > year.end_date
          ) {
            throw new ApiException('journal_extension_dates', 409);
          }
          // A day after today is refused by journal_edit_extensions_write (0122), mapped below.
          const row = await transaction
            .insertInto('journal_edit_extensions')
            .values({
              branch_id: branchId,
              from_date: input.fromDate,
              to_date: input.toDate,
              days: input.days,
              // Both overwritten by journal_edit_extensions_write.
              open_until: new Date(0),
              created_at: new Date(0),
              reason: input.reason,
              created_by: access.accountId,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          const lessons = await transaction
            .selectFrom('lessons')
            .select(sql<number>`count(*)::int`.as('count'))
            .where('branch_id', '=', branchId)
            .where('lesson_date', '>=', input.fromDate)
            .where('lesson_date', '<=', input.toDate)
            .executeTakeFirstOrThrow();
          const [saved] = await this.rowsOf(transaction, branchId, row.id);
          if (saved === undefined) throw new Error('The extension was just written.');
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'journal.edit_extension',
            record: { type: 'journal_edit_extension', id: row.id },
            newValue: {
              fromDate: input.fromDate,
              toDate: input.toDate,
              days: input.days,
              openUntil: saved.openUntil,
            },
            reason: input.reason,
            details: { lessons: lessons.count },
            requestId,
          });
          return saved;
        }),
      { journal_extension_future: 'journal_extension_future' },
    );
  }

  private async rowsOf(
    transaction: Transaction,
    branchId: string,
    id: string | null,
  ): Promise<EditExtension[]> {
    let query = transaction
      .selectFrom('journal_edit_extensions')
      .select([
        'id',
        sql<string>`from_date::text`.as('from_date'),
        sql<string>`to_date::text`.as('to_date'),
        'days',
        'open_until',
        'reason',
        'created_by',
        'created_at',
      ])
      .where('branch_id', '=', branchId);
    if (id !== null) query = query.where('id', '=', id);
    const rows = await query.orderBy('created_at', 'desc').orderBy('id').limit(200).execute();
    const names = await namedAccounts(
      transaction,
      rows.map((row) => row.created_by),
    );
    return rows.map((row) => {
      const named = names.get(row.created_by);
      return {
        id: row.id,
        fromDate: row.from_date,
        toDate: row.to_date,
        days: row.days,
        openUntil: new Date(row.open_until).toISOString(),
        reason: row.reason,
        createdBy: named?.name ?? named?.login ?? null,
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }
}
