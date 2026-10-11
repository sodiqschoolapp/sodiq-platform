import { Inject, Injectable } from '@nestjs/common';
import {
  academicYearName,
  academicYearStatusSchema,
  periodOn,
  schoolDateOf,
  type AcademicYear,
  type AcademicYearList,
  type AcademicYearRecord,
  type Clock,
  type CurrentPeriod,
  type ErrorCode,
  type ErrorDetail,
  type Quarter,
  type QuartersRecord,
} from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { Audit } from '../audit/audit.service.js';
import type { Access } from '../access/permission.guard.js';
import { loadEntries } from './calendar-state.js';
import { notFound, refusingConstraints } from './setup-refusals.js';

interface YearRow {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
}

const YEAR_COLUMNS = ['id', 'start_date', 'end_date', 'status'] as const;

/** A refusal of 409 that names the fields to show it beside. */
function refused(code: ErrorCode, paths: readonly string[] = []): ApiException {
  const details: ErrorDetail[] = paths.map((path) => ({ path, code, message: code }));
  return new ApiException(code, 409, undefined, details.length === 0 ? undefined : details);
}

/** Whether two closed ranges of dates share a day. */
const overlaps = (
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
): boolean => a.startDate <= b.endDate && b.startDate <= a.endDate;

const inside = (date: string, range: { startDate: string; endDate: string }): boolean =>
  range.startDate <= date && date <= range.endDate;

/**
 * Academic years and their quarters (docs/spec/03-school-setup.md, Academic
 * year and Quarters; task 1.3), and the year and quarter of the top bar.
 *
 * The database guards every rule (db/migrations/0016); the service checks the
 * same rules first, so that a refusal names the field, and maps what the
 * database refuses at the commit (`refusingConstraints`).
 *
 * Lock order, the same everywhere: a write of a year (create, edit, "Start
 * year") takes the branch row `for update`, then the year row `for update`;
 * the go-live save (`Branches.setGoLive`) takes the branch row `for update`
 * and reads the years without a lock; a save of the quarters takes the year
 * row `for update`. So every change of the years of a branch waits for the
 * one before it, a go-live save and a year edit read what the other committed,
 * and a quarter save and a year edit never pass on old dates.
 */
@Injectable()
export class AcademicYears {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Every year of the branch of the transaction, newest first, each with its quarters in number order. */
  private async yearsIn(transaction: Transaction): Promise<AcademicYear[]> {
    const years = await transaction
      .selectFrom('academic_years')
      .select(YEAR_COLUMNS)
      .orderBy('start_date', 'desc')
      .orderBy('id')
      .execute();
    if (years.length === 0) {
      return [];
    }
    const quarters = await transaction
      .selectFrom('quarters')
      .select(['academic_year_id', 'number', 'start_date', 'end_date'])
      .where(
        'academic_year_id',
        'in',
        years.map((year) => year.id),
      )
      .orderBy('academic_year_id')
      .orderBy('number')
      .execute();
    return years.map((year) =>
      toYear(
        year,
        quarters.filter((quarter) => quarter.academic_year_id === year.id),
      ),
    );
  }

  /** One year of the branch of the transaction, taken for update; 404 for another branch's or an unknown id. */
  private async lockedYear(transaction: Transaction, id: string): Promise<AcademicYear> {
    const row = await transaction
      .selectFrom('academic_years')
      .select(YEAR_COLUMNS)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    const quarters = await transaction
      .selectFrom('quarters')
      .select(['academic_year_id', 'number', 'start_date', 'end_date'])
      .where('academic_year_id', '=', id)
      .orderBy('number')
      .execute();
    return toYear(row, quarters);
  }

  /** The branch row, taken for update; its go-live date. See the lock order above. */
  private async lockBranch(transaction: Transaction, branchId: string): Promise<string | null> {
    const branch = await transaction
      .selectFrom('branches')
      .select('go_live_date')
      .where('id', '=', branchId)
      .forUpdate()
      .executeTakeFirst();
    if (branch === undefined) {
      throw notFound();
    }
    return branch.go_live_date;
  }

  private readYear(transaction: Transaction, id: string): Promise<AcademicYear> {
    return this.yearsIn(transaction).then((years) => {
      const year = years.find((one) => one.id === id);
      if (year === undefined) {
        throw notFound();
      }
      return year;
    });
  }

  /** The years of the branch of the request, newest first. */
  list(access: Access): Promise<AcademicYearList> {
    return this.transactions.run(access.branchIds, async (transaction) => ({
      years: await this.yearsIn(transaction),
    }));
  }

  /**
   * A new year, always planned, with four undated quarters (owner's answer 4).
   * Refused when it overlaps another year of the branch (answer 6) or starts
   * before a year that has already started (decision 13).
   */
  create(
    access: Access,
    branchId: string,
    record: AcademicYearRecord,
    requestId: string,
  ): Promise<AcademicYear> {
    return refusingConstraints(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        await this.lockBranch(transaction, branchId);
        const others = await this.yearsIn(transaction);
        refuseOrder(record, 'planned', others);
        const year = await transaction
          .insertInto('academic_years')
          .values({ branch_id: branchId, start_date: record.startDate, end_date: record.endDate })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('quarters')
          .values(
            [1, 2, 3, 4].map((number) => ({
              branch_id: branchId,
              academic_year_id: year.id,
              number,
            })),
          )
          .execute();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'academic_year.create',
          record: { type: 'academic_year', id: year.id },
          newValue: { startDate: record.startDate, endDate: record.endDate },
          requestId,
        });
        return this.readYear(transaction, year.id);
      }),
    );
  }

  /**
   * New dates of a planned or current year. Refused for a closed year, for
   * dates that overlap another year or break the order of the years, that
   * leave a dated quarter outside, or that leave the branch's go-live date
   * outside every planned or current year (answer 7). Nothing changes and no
   * entry is written when the dates are the same.
   */
  edit(
    access: Access,
    branchId: string,
    id: string,
    record: AcademicYearRecord,
    requestId: string,
  ): Promise<AcademicYear> {
    return refusingConstraints(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const goLiveDate = await this.lockBranch(transaction, branchId);
        const before = await this.lockedYear(transaction, id);
        if (before.status === 'closed') {
          throw refused('year_closed');
        }
        if (before.startDate === record.startDate && before.endDate === record.endDate) {
          return before;
        }
        const others = (await this.yearsIn(transaction)).filter((year) => year.id !== id);
        refuseOrder(record, before.status, others);
        const outside = before.quarters.filter(
          (quarter) =>
            quarter.startDate !== null &&
            quarter.endDate !== null &&
            !(record.startDate <= quarter.startDate && quarter.endDate <= record.endDate),
        );
        if (outside.length > 0) {
          throw refused('outside_year', [
            ...(outside.some((quarter) => (quarter.startDate ?? '') < record.startDate)
              ? ['startDate']
              : []),
            ...(outside.some((quarter) => (quarter.endDate ?? '') > record.endDate)
              ? ['endDate']
              : []),
          ]);
        }
        if (goLiveDate !== null && inside(goLiveDate, before) && !inside(goLiveDate, record)) {
          throw refused('go_live_outside_year', [
            goLiveDate < record.startDate ? 'startDate' : 'endDate',
          ]);
        }
        // Task 1.4, decision 5: an active calendar entry stays inside its year.
        const leftOut = (await loadEntries(transaction)).filter(
          (entry) =>
            entry.archivedAt === null &&
            inside(entry.firstDate, before) &&
            inside(entry.lastDate, before) &&
            !(inside(entry.firstDate, record) && inside(entry.lastDate, record)),
        );
        if (leftOut.length > 0) {
          throw refused('calendar_outside_year', [
            ...(leftOut.some((entry) => entry.firstDate < record.startDate) ? ['startDate'] : []),
            ...(leftOut.some((entry) => entry.lastDate > record.endDate) ? ['endDate'] : []),
          ]);
        }
        await transaction
          .updateTable('academic_years')
          .set({ start_date: record.startDate, end_date: record.endDate })
          .where('id', '=', id)
          .execute();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'academic_year.edit',
          record: { type: 'academic_year', id },
          oldValue: { startDate: before.startDate, endDate: before.endDate },
          newValue: { startDate: record.startDate, endDate: record.endDate },
          requestId,
        });
        return this.readYear(transaction, id);
      }),
    );
  }

  /**
   * "Start year" (`edge/academic-year`, "In August…"; owner's answer 6): a
   * planned year becomes current when the branch has no current year and every
   * earlier year is closed. A year that is current already is answered as it
   * is, with no entry.
   */
  start(access: Access, branchId: string, id: string, requestId: string): Promise<AcademicYear> {
    return refusingConstraints(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        await this.lockBranch(transaction, branchId);
        const year = await this.lockedYear(transaction, id);
        if (year.status === 'current') {
          return year;
        }
        if (year.status === 'closed') {
          throw refused('year_closed');
        }
        const others = (await this.yearsIn(transaction)).filter((one) => one.id !== id);
        if (others.some((one) => one.status === 'current')) {
          throw refused('current_year_exists');
        }
        refuseOrder(year, 'current', others);
        await transaction
          .updateTable('academic_years')
          .set({ status: 'current' })
          .where('id', '=', id)
          .execute();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'academic_year.start',
          record: { type: 'academic_year', id },
          oldValue: { status: 'planned' },
          newValue: { status: 'current' },
          requestId,
        });
        return this.readYear(transaction, id);
      }),
    );
  }

  /**
   * The four quarters' dates in one save (`03`, Quarters, owner: Academic Vice
   * Principal). The order rules are the schema's; here every dated quarter
   * must lie inside the year (answer 5), and a closed year changes nothing.
   * The audit entry carries the quarters that changed, old and new, in number
   * order; nothing is written when nothing changed.
   */
  saveQuarters(
    access: Access,
    branchId: string,
    id: string,
    record: QuartersRecord,
    requestId: string,
  ): Promise<AcademicYear> {
    return refusingConstraints(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const year = await this.lockedYear(transaction, id);
        if (year.status === 'closed') {
          throw refused('year_closed');
        }
        const outside = record.quarters.flatMap((quarter, index) => [
          ...(quarter.startDate !== null && !inside(quarter.startDate, year)
            ? [`quarters.${String(index)}.startDate`]
            : []),
          ...(quarter.endDate !== null && !inside(quarter.endDate, year)
            ? [`quarters.${String(index)}.endDate`]
            : []),
        ]);
        if (outside.length > 0) {
          throw refused('outside_year', outside);
        }
        const changed = year.quarters.flatMap((before) => {
          const after = record.quarters[before.number - 1];
          return after !== undefined &&
            (after.startDate !== before.startDate || after.endDate !== before.endDate)
            ? [{ before, after: { number: before.number, ...after } }]
            : [];
        });
        if (changed.length === 0) {
          return year;
        }
        for (const { after } of changed) {
          await transaction
            .updateTable('quarters')
            .set({ start_date: after.startDate, end_date: after.endDate })
            .where('academic_year_id', '=', id)
            .where('number', '=', after.number)
            .execute();
        }
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'quarters.edit',
          record: { type: 'academic_year', id },
          oldValue: { quarters: changed.map(({ before }) => before) },
          newValue: { quarters: changed.map(({ after }) => after) },
          requestId,
        });
        return this.readYear(transaction, id);
      }),
    );
  }

  /**
   * The year and quarter of the top bar (`03`; `12`, Context), from the
   * server's clock in the branch's time zone (`edge/00-definitions`, Branch
   * time; owner's answer 8).
   */
  currentPeriod(access: Access, branchId: string): Promise<CurrentPeriod> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const branch = await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', branchId)
        .executeTakeFirst();
      if (branch === undefined) {
        throw notFound();
      }
      const today = schoolDateOf(this.clock.now(), branch.time_zone);
      return periodOn(today, await this.yearsIn(transaction));
    });
  }
}

function toYear(
  row: YearRow,
  quarters: readonly { number: number; start_date: string | null; end_date: string | null }[],
): AcademicYear {
  return {
    id: row.id,
    name: academicYearName(row.start_date, row.end_date),
    startDate: row.start_date,
    endDate: row.end_date,
    status: academicYearStatusSchema.parse(row.status),
    quarters: quarters.map((quarter): Quarter => ({
      number: quarter.number,
      startDate: quarter.start_date,
      endDate: quarter.end_date,
    })),
  };
}

/**
 * The order of the years of a branch, as the trigger `academic_years_guard`
 * keeps it: no overlap (answer 6); a planned year starts after every current
 * or closed year, and a current one after every closed year (decision 13); a
 * current year has no earlier year that is not closed ("Start year … only
 * after 'Close the year' was carried out for the previous year").
 */
function refuseOrder(
  year: { startDate: string; endDate: string },
  status: AcademicYear['status'],
  others: readonly AcademicYear[],
): void {
  if (others.some((other) => overlaps(year, other))) {
    throw refused('dates_overlap', ['startDate', 'endDate']);
  }
  const later = others.filter((other) => other.startDate > year.startDate);
  if (
    later.some(
      (other) => other.status === 'closed' || (other.status === 'current' && status === 'planned'),
    )
  ) {
    throw refused('year_out_of_order', ['startDate']);
  }
  if (
    status === 'current' &&
    others.some((other) => other.startDate < year.startDate && other.status !== 'closed')
  ) {
    throw refused('earlier_year_not_closed');
  }
}
