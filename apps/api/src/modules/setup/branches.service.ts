import { Injectable } from '@nestjs/common';
import type { Branch, BranchRecord, GoLiveRecord, Weekday } from '@sodiq/shared';
import { ApiException } from '../../http/api-exception.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { Audit } from '../audit/audit.service.js';
import type { Access } from '../access/permission.guard.js';
import { isSchoolDay } from '@sodiq/timetable-rules';
import { loadCalendarSettings, losesGoLive } from './calendar-state.js';
import { changesOf, notFound, refusingDuplicates } from './setup-refusals.js';

interface BranchRow {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  working_weekdays: number[];
  time_zone: string;
  go_live_date: string | null;
}

const COLUMNS = [
  'id',
  'name',
  'address',
  'phone',
  'email',
  'working_weekdays',
  'time_zone',
  'go_live_date',
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
    goLiveDate: row.go_live_date,
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
        // Task 1.4, decision 7: a change of the working weekdays may not take
        // the school day away from the go-live date.
        if (
          row.go_live_date !== null &&
          losesGoLive(
            row.go_live_date,
            await loadCalendarSettings(transaction, row.working_weekdays),
            await loadCalendarSettings(transaction, record.workingWeekdays),
          )
        ) {
          throw new ApiException('go_live_not_school_day', 409, undefined, [
            {
              path: 'workingWeekdays',
              code: 'go_live_not_school_day',
              message: 'The go-live date would no longer be a school day.',
            },
          ]);
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

  /**
   * Sets or clears the go-live start date of the branch of the request
   * (`edge/academic-year`, "The school goes live in the middle of the year":
   * "The Super Admin sets a start date for each branch"; owner's answer 7). It
   * must lie inside a planned or current year of the branch. The branch row is
   * taken for update first and the years are read without a lock: a year edit
   * takes the branch row first too, so each reads what the other committed
   * (the lock order of `AcademicYears`). Nothing is written when the date is
   * the same.
   */
  setGoLive(
    access: Access,
    branchId: string,
    record: GoLiveRecord,
    requestId: string,
  ): Promise<Branch> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await transaction
        .selectFrom('branches')
        .select(COLUMNS)
        .where('id', '=', branchId)
        .forUpdate()
        .executeTakeFirst();
      if (row === undefined) {
        throw notFound();
      }
      if (row.go_live_date === record.goLiveDate) {
        return toBranch(row);
      }
      const date = record.goLiveDate;
      if (date !== null) {
        const year = await transaction
          .selectFrom('academic_years')
          .select('id')
          .where('status', 'in', ['planned', 'current'])
          .where('start_date', '<=', date)
          .where('end_date', '>=', date)
          .executeTakeFirst();
        if (year === undefined) {
          throw new ApiException('go_live_outside_year', 409, undefined, [
            {
              path: 'goLiveDate',
              code: 'go_live_outside_year',
              message: 'The go-live date must lie inside a planned or current academic year.',
            },
          ]);
        }
        // Task 1.4, decision 7 (`edge/academic-year`: "Go-live can be on any
        // school day"): some grade has lessons on it by the calendar.
        if (!isSchoolDay(date, await loadCalendarSettings(transaction, row.working_weekdays))) {
          throw new ApiException('go_live_not_school_day', 409, undefined, [
            {
              path: 'goLiveDate',
              code: 'go_live_not_school_day',
              message: 'The go-live date must be a school day.',
            },
          ]);
        }
      }
      const updated = await transaction
        .updateTable('branches')
        .set({ go_live_date: date })
        .where('id', '=', branchId)
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'branch.go_live',
        record: { type: 'branch', id: branchId },
        oldValue: { goLiveDate: row.go_live_date },
        newValue: { goLiveDate: date },
        requestId,
      });
      return toBranch(updated);
    });
  }
}
