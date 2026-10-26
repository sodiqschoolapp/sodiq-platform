import { Injectable } from '@nestjs/common';
import {
  branchSummarySchema,
  schoolDateOf,
  type BranchSummary,
  type BranchSummaryQuery,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { Access } from '../access/permission.guard.js';
import { branchOf } from '../classes/classes.service.js';
import { branchAttendanceOn } from '../journal/attendance-today.service.js';
import { statusOfStudentOn } from '../people/students.service.js';
import { closingOf } from '../setup/closed-quarters.js';
import { notFound } from '../setup/setup-refusals.js';
import type { QuarterRef } from './grade-changes.js';
import { gradeFiguresOf } from './rating.service.js';

/**
 * The branch summary of the Principal's and the Super Admin's home (task 9.4b; `08`, Home pages by
 * role: "Branch summary: students, staff, attendance today, results by grade"). Counts and means
 * only, worked out on read with the injected clock (plan decision 12):
 *
 * - students: active today (`statusOfStudentOn`) whose start date has come (decision 10);
 * - staff: the staff records of the branch that are not vacancies and not out for good at the
 *   clock's moment, read through `staff_out_for_good` (0024), never the person's employment rows
 *   through the row filter (decision 10);
 * - attendance today: one ratio over the cells of every class (`dailyAttendance`, decision 3);
 * - results by grade: `gradeFiguresOf` of the rating (decision 5), for the quarter asked, else the
 *   quarter containing today, else the last started one; a closed quarter's stored records.
 */
@Injectable()
export class BranchSummaryService {
  constructor(private readonly transactions: Transactions) {}

  read(access: Access, query: BranchSummaryQuery): Promise<BranchSummary> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const branch = await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow();
      const now = await transactionMoment(transaction);
      const today = schoolDateOf(now, branch.time_zone);
      const quarter = await quarterOf(transaction, branchId, today, query.quarterId);

      const students = await transaction
        .selectFrom('students')
        .select(['students.id', statusOfStudentOn(sql.ref('students.id'), today).as('status')])
        .where('students.branch_id', '=', branchId)
        .where('students.starts_on', '<=', today)
        .execute();
      const staff = await transaction
        .selectFrom('staff')
        .innerJoin('staff_branches', 'staff_branches.staff_id', 'staff.id')
        .select('staff.id')
        .distinct()
        .where('staff_branches.branch_id', '=', branchId)
        .where('staff.kind', '<>', 'vacancy')
        .where(sql<boolean>`not staff_out_for_good(staff.id, ${now})`)
        .execute();

      return branchSummarySchema.parse({
        date: today,
        students: students.filter((row) => row.status === 'active').length,
        staff: staff.length,
        attendanceToday: await branchAttendanceOn(transaction, branchId, today, now),
        quarter:
          quarter === null
            ? null
            : { id: quarter.id, number: quarter.number, closed: quarter.closed },
        grades:
          quarter === null
            ? []
            : await gradeFiguresOf(
                transaction,
                access,
                { branchId, timeZone: branch.time_zone, now, today },
                quarter,
              ),
      });
    });
  }
}

/** The quarter asked (404 when unknown, undated or of another branch), else the default one. */
async function quarterOf(
  transaction: Transaction,
  branchId: string,
  today: string,
  quarterId: string | undefined,
): Promise<(QuarterRef & { closed: boolean }) | null> {
  let query = transaction
    .selectFrom('quarters')
    .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
    .select([
      'quarters.id',
      'quarters.number',
      'quarters.academic_year_id',
      sql<string | null>`quarters.start_date::text`.as('start_date'),
      sql<string | null>`quarters.end_date::text`.as('end_date'),
    ])
    .where('academic_years.branch_id', '=', branchId);
  query =
    quarterId === undefined
      ? query
          .where('quarters.start_date', '<=', today)
          .orderBy('quarters.start_date', 'desc')
          .limit(1)
      : query.where('quarters.id', '=', quarterId);
  const row = await query.executeTakeFirst();
  if (row === undefined || row.start_date === null || row.end_date === null) {
    if (quarterId !== undefined) throw notFound();
    return null;
  }
  return {
    id: row.id,
    number: row.number,
    academicYearId: row.academic_year_id,
    startDate: row.start_date,
    endDate: row.end_date,
    closed: (await closingOf(transaction, row.id)) !== undefined,
  };
}
