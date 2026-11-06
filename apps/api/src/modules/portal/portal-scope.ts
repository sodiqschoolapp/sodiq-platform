import { classDisplayName, schoolDateOf, viewDates, type PortalChild } from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { notFound } from '../setup/setup-refusals.js';

/**
 * The child scope of the parent portal (task 11.2, pull request #294; `10`, What parents see):
 * the one check every portal route makes, and every message to families will make later. A
 * child is in scope while the relative of the account has an open link to it with portal
 * access on and the student is active (`portal_children`, 0159). Read from the database on
 * every request, never kept (decision 5); every refusal is the same 404 (decision 4).
 */

/** A child in scope, with its present branch (never sent to the browser). */
export interface ScopedChild extends PortalChild {
  readonly branchId: string;
}

/** The part of a span of dates a child spends in one branch, half-open `[from, until)`. */
export interface ChildSpan {
  readonly branchId: string;
  readonly from: string;
  readonly until: string;
}

/** The children of a Parent account at the moment of the transaction, by last and first name. */
export async function portalChildrenOf(
  transaction: Transaction,
  accountId: string,
): Promise<ScopedChild[]> {
  const at = await transactionMoment(transaction);
  const found = await sql<{
    student_id: string;
    branch_id: string;
    first_name: string;
    last_name: string;
    class_grade: number | null;
    class_name: string | null;
  }>`
    select student_id, branch_id, first_name, last_name, class_grade, class_name
    from portal_children(${accountId}::uuid, ${at})
  `.execute(transaction);
  return found.rows
    .map((row) => ({
      id: row.student_id,
      branchId: row.branch_id,
      firstName: row.first_name,
      lastName: row.last_name,
      className:
        row.class_grade === null || row.class_name === null
          ? null
          : classDisplayName(row.class_grade, row.class_name),
    }))
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName) ||
        a.id.localeCompare(b.id),
    );
}

/** What a portal page of one child reads: the child, its today and week, and its branches. */
export interface ChildWeekScope {
  readonly child: ScopedChild;
  readonly today: string;
  /** Monday to Sunday of the week asked for. */
  readonly dates: readonly string[];
  readonly spans: readonly ChildSpan[];
}

/** The branches of a child's class memberships from `from` to `to`, both included. */
export async function childSpans(
  transaction: Transaction,
  accountId: string,
  studentId: string,
  from: string,
  to: string,
): Promise<ChildSpan[]> {
  const at = await transactionMoment(transaction);
  const found = await sql<{ branch_id: string; valid_from: string; valid_until: string }>`
    select branch_id, valid_from::text as valid_from, valid_until::text as valid_until
    from portal_child_branches(${accountId}::uuid, ${studentId}::uuid, ${from}::date, ${to}::date, ${at})
  `.execute(transaction);
  return found.rows.map((row) => ({
    branchId: row.branch_id,
    from: row.valid_from,
    until: row.valid_until,
  }));
}

/**
 * The child asked for, when it is in the account's scope; 404 otherwise, whatever the reason
 * (another family's child, a link off or ended, a student who left, an unknown id). Run in a
 * transaction without a branch: a parent's session names none (decision 3).
 */
export async function portalChild(
  transaction: Transaction,
  accountId: string,
  studentId: string,
): Promise<ScopedChild> {
  const child = (await portalChildrenOf(transaction, accountId)).find(
    (one) => one.id === studentId.toLowerCase(),
  );
  if (child === undefined) throw notFound();
  return child;
}

/** The child and the week of a date (today in the child's branch when none is given). */
export async function childWeekScope(
  transaction: Transaction,
  accountId: string,
  studentId: string,
  date: string | undefined,
): Promise<ChildWeekScope> {
  const child = await portalChild(transaction, accountId, studentId);
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', child.branchId)
    .executeTakeFirstOrThrow();
  const today = schoolDateOf(await transactionMoment(transaction), branch.time_zone);
  const dates = viewDates(date ?? today, 'week');
  const first = dates[0] ?? today;
  const last = dates[dates.length - 1] ?? today;
  const spans = await childSpans(transaction, accountId, child.id, first, last);
  return { child, today, dates, spans };
}

/** Whether a date lies in a span. */
export const inSpan = (span: ChildSpan, date: string): boolean =>
  span.from <= date && date < span.until;
