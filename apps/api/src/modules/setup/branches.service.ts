import { Injectable } from '@nestjs/common';
import type { Branch, BranchRecord, Weekday } from '@sodiq/shared';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { Audit } from '../audit/audit.service.js';
import type { Access } from '../access/permission.guard.js';
import { changesOf, notFound, refusingDuplicates } from './setup-refusals.js';

interface BranchRow {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  working_weekdays: number[];
  time_zone: string;
}

const COLUMNS = [
  'id',
  'name',
  'address',
  'phone',
  'email',
  'working_weekdays',
  'time_zone',
] as const;

/** The weekdays as stored, each once, Monday first. The check of the table keeps them 1 to 7. */
function weekdaysOf(stored: readonly number[]): Weekday[] {
  return [...new Set(stored)].sort((a, b) => a - b) as Weekday[];
}

export function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    workingWeekdays: weekdaysOf(row.working_weekdays),
    timeZone: row.time_zone,
  };
}

/** The fields a person types, as the audit entry records them. */
const fieldsOf = (branch: Branch): BranchRecord => ({
  name: branch.name,
  address: branch.address,
  phone: branch.phone,
  email: branch.email,
  workingWeekdays: branch.workingWeekdays,
});

/**
 * The record of a branch (docs/spec/03-school-setup.md, Branch: "Name,
 * address, working weekdays, contacts. Every record belongs to one branch."
 * Owner: Super Admin). The table has no row filter (0002): a branch is read
 * by the id of the request, which the guard checked. The time zone is not
 * typed in this task (decided by the owner, pull request #37, answer 3).
 */
@Injectable()
export class Branches {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  private async readIn(transaction: Transaction, branchId: string): Promise<Branch> {
    const row = await transaction
      .selectFrom('branches')
      .select(COLUMNS)
      .where('id', '=', branchId)
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return toBranch(row);
  }

  /**
   * A new branch, by the Super Admin (`02`: "Only this role creates
   * branches"). School-wide work: the branch does not exist when the
   * transaction begins, so its audit entry is an event of the whole school
   * (`audit_log_school`) that names the branch as its record.
   */
  create(access: Access, record: BranchRecord, requestId: string): Promise<Branch> {
    return refusingDuplicates(() =>
      this.transactions.run([], async (transaction) => {
        const row = await transaction
          .insertInto('branches')
          .values({
            name: record.name,
            address: record.address,
            phone: record.phone,
            email: record.email,
            working_weekdays: [...record.workingWeekdays],
          })
          .returning(COLUMNS)
          .executeTakeFirstOrThrow();
        const branch = toBranch(row);
        await this.audit.record(transaction, {
          branchId: null,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'branch.create',
          record: { type: 'branch', id: branch.id },
          newValue: fieldsOf(branch),
          requestId,
        });
        return branch;
      }),
    );
  }

  /** The branch of the request. */
  read(access: Access, branchId: string): Promise<Branch> {
    return this.transactions.run(access.branchIds, (transaction) =>
      this.readIn(transaction, branchId),
    );
  }

  /**
   * Edits the record of the branch of the request. The audit entry carries
   * the fields that changed, old and new; nothing is written when nothing
   * changed.
   */
  edit(access: Access, branchId: string, record: BranchRecord, requestId: string): Promise<Branch> {
    return refusingDuplicates(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const row = await transaction
          .selectFrom('branches')
          .select(COLUMNS)
          .where('id', '=', branchId)
          .forUpdate()
          .executeTakeFirst();
        if (row === undefined) {
          throw notFound();
        }
        const before = toBranch(row);
        const changes = changesOf(fieldsOf(before), record);
        if (changes === null) {
          return before;
        }
        const updated = await transaction
          .updateTable('branches')
          .set({
            name: record.name,
            address: record.address,
            phone: record.phone,
            email: record.email,
            working_weekdays: [...record.workingWeekdays],
          })
          .where('id', '=', branchId)
          .returning(COLUMNS)
          .executeTakeFirstOrThrow();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'branch.edit',
          record: { type: 'branch', id: branchId },
          oldValue: changes.oldValue,
          newValue: changes.newValue,
          requestId,
        });
        return toBranch(updated);
      }),
    );
  }
}
