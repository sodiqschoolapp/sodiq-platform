import { DEFAULT_TIME_ZONE, schoolDateOf } from '@sodiq/shared';
import { sql } from 'kysely';
import {
  transactionMoment,
  type Transaction,
  type Transactions,
} from '../../database/transactions.js';
import type { Access } from '../access/permission.guard.js';
import { notFound } from '../setup/setup-refusals.js';
import { startOfDate } from './staff-status.js';

/**
 * What the account routes of a staff record share (task 2.3a; task 2.3c-1
 * moved them here so that `StaffAccounts` and `AccountAccess` use one copy).
 */

/**
 * The branch of the request. Every route of a record is declared without
 * `branch: 'none'`, so the guard has always named a branch: a fault of the
 * code, never a request, reaches the throw.
 */
export function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('An account route works for the branch of the request.');
  }
  return access.branchId;
}

/**
 * The branches of the transaction of an account route: every branch for a
 * Super Admin, whose record and roles may be in any of them (finding 3 of the
 * plan review of #62), else the branch of the request.
 */
export async function readingBranches(
  transactions: Transactions,
  access: Access,
): Promise<readonly string[]> {
  if (!access.assignments.some((assignment) => assignment.role === 'super_admin')) {
    return access.branchIds;
  }
  return transactions.run([], async (transaction) =>
    (await transaction.selectFrom('branches').select('id').orderBy('id').execute()).map(
      (row) => row.id,
    ),
  );
}

/** The record of a person, as the account routes read it. */
export interface Person {
  id: string;
  accountId: string | null;
  firstName: string;
  lastName: string;
  fatherName: string | null;
}

/**
 * The record of a person linked to the branch of the request, locked for a
 * change; 404 for another branch's record, an unknown id and a vacancy
 * ("no account", `04`, Vacancy).
 */
export async function findPerson(
  transaction: Transaction,
  id: string,
  branchId: string,
  lock: boolean,
): Promise<Person> {
  const linked = await transaction
    .selectFrom('staff_branches')
    .select('staff_id')
    .where('staff_id', '=', id)
    .where('branch_id', '=', branchId)
    .executeTakeFirst();
  if (linked === undefined) {
    throw notFound();
  }
  let query = transaction
    .selectFrom('staff')
    .select(['id', 'account_id', 'first_name', 'last_name', 'father_name'])
    .where('id', '=', id)
    .where('kind', '=', 'person');
  if (lock) {
    query = query.forUpdate();
  }
  const row = await query.executeTakeFirst();
  if (row === undefined || row.first_name === null || row.last_name === null) {
    throw notFound();
  }
  return {
    id: row.id,
    accountId: row.account_id,
    firstName: row.first_name,
    lastName: row.last_name,
    fatherName: row.father_name,
  };
}

/** Whether the person has left for good at the moment of the transaction (`staff_out_for_good`). */
export async function leftForGood(transaction: Transaction, id: string): Promise<boolean> {
  const found = await sql<{ out: boolean }>`
    select staff_out_for_good(${id}::uuid, ${await transactionMoment(transaction)}) as out
  `.execute(transaction);
  return found.rows[0]?.out === true;
}

/**
 * The moment the current employment period of each person began (correction
 * 2 of the review of pull request #65; edge cases, Staff over time:
 * "Re-hiring restores the same record ... with a new employment period"):
 * 00:00, in the time zone of the person's main branch, of the `valid_from` of
 * the first `active` or `inactive` row after the latest `left` that has
 * begun; of the first row when there was no such `left`. A row taken back
 * before it began (`valid_until = valid_from`) was never in force and is not
 * read. Status dates are school dates of the main branch.
 */
export async function periodStarts(
  transaction: Transaction,
  staffIds: readonly string[],
): Promise<Map<string, Date>> {
  const starts = new Map<string, Date>();
  if (staffIds.length === 0) {
    return starts;
  }
  const rows = await transaction
    .selectFrom('staff_statuses')
    .leftJoin('staff_branches', (join) =>
      join
        .onRef('staff_branches.staff_id', '=', 'staff_statuses.staff_id')
        .on('staff_branches.is_main', '=', true),
    )
    .leftJoin('branches', 'branches.id', 'staff_branches.branch_id')
    .select([
      'staff_statuses.staff_id',
      'staff_statuses.status',
      'staff_statuses.valid_from',
      'branches.time_zone',
    ])
    .where('staff_statuses.staff_id', 'in', [...staffIds])
    .where((builder) =>
      builder.or([
        builder('staff_statuses.valid_until', 'is', null),
        builder('staff_statuses.valid_until', '<>', builder.ref('staff_statuses.valid_from')),
      ]),
    )
    .orderBy('staff_statuses.staff_id')
    .orderBy('staff_statuses.valid_from')
    .execute();
  const now = await transactionMoment(transaction);
  const byPerson = new Map<string, typeof rows>();
  for (const row of rows) {
    byPerson.set(row.staff_id, [...(byPerson.get(row.staff_id) ?? []), row]);
  }
  for (const [staffId, statuses] of byPerson) {
    const zone = statuses[0]?.time_zone ?? DEFAULT_TIME_ZONE;
    const today = schoolDateOf(now, zone);
    const lefts = statuses.filter((row) => row.status === 'left' && row.valid_from <= today);
    const latestLeft = lefts[lefts.length - 1];
    const start =
      latestLeft === undefined
        ? statuses[0]
        : statuses.find((row) => row.status !== 'left' && row.valid_from > latestLeft.valid_from);
    // After a `left` with no return yet the period has not begun: its start
    // is the `left` itself, and no session after it is a use of the period.
    const date = start?.valid_from ?? latestLeft?.valid_from;
    if (date !== undefined) {
      starts.set(staffId, await startOfDate(transaction, date, zone));
    }
  }
  return starts;
}

/**
 * The accounts with no session opened since the start of the current
 * employment period of their person (task 2.3c-1, decision 10 with
 * correction 2): a session before a re-hire is not a use of the account,
 * which got a new first password then. Keyed by account id.
 */
export async function neverUsedAccounts(
  transaction: Transaction,
  people: readonly { staffId: string; accountId: string }[],
): Promise<Set<string>> {
  const never = new Set<string>();
  if (people.length === 0) {
    return never;
  }
  const starts = await periodStarts(
    transaction,
    people.map((person) => person.staffId),
  );
  const latest = await transaction
    .selectFrom('sessions')
    .select(['account_id', (select) => select.fn.max('created_at').as('latest')])
    .where(
      'account_id',
      'in',
      people.map((person) => person.accountId),
    )
    .groupBy('account_id')
    .execute();
  const latestOf = new Map(latest.map((row) => [row.account_id, row.latest]));
  for (const person of people) {
    const last = latestOf.get(person.accountId);
    const start = starts.get(person.staffId);
    if (last === undefined || (start !== undefined && new Date(last) < start)) {
      never.add(person.accountId);
    }
  }
  return never;
}
