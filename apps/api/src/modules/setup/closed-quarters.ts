import type { ErrorCode } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';

/**
 * The closed state of a quarter (task 9.2b, pull request #230; db/migrations/0133). A quarter is
 * closed while it has a closing row with no `reopened_at`. A writer of a row that feeds the
 * quarter's results takes the quarter `for key share` here, in a statement of its own before its
 * first row lock (`.claude/rules/database.md`; review correction 3), so that a close held open
 * makes it wait and a close that committed refuses it; the guards of 0133 take the same lock
 * again as the database's guarantee and find it held.
 */

/** The closing row of a quarter that refuses a write, mapped to the code of the route. */
function refusing(code: ErrorCode) {
  return (error: unknown): never => {
    const failure = error as { code?: unknown; constraint?: unknown };
    if (failure.code === '23514' && failure.constraint === 'quarters_closed') {
      throw new ApiException(code, 409);
    }
    throw error;
  };
}

/**
 * Locks the dated quarters of the branch that meet the days `from` to `until` (both included;
 * `until` null: no end) and refuses with `code` when one is closed.
 */
export async function lockOpenQuarters(
  transaction: Transaction,
  branchId: string,
  from: string,
  until: string | null,
  code: ErrorCode = 'quarter_closed',
): Promise<void> {
  await sql`select quarter_days_open_guard(${branchId}::uuid, ${from}::date, ${until}::date)`
    .execute(transaction)
    .catch(refusing(code));
}

/** Locks one quarter and refuses with `code` when it is closed. */
export async function lockOpenQuarter(
  transaction: Transaction,
  quarterId: string,
  code: ErrorCode = 'quarter_closed',
): Promise<void> {
  await sql`select quarter_open_guard(${quarterId}::uuid)`
    .execute(transaction)
    .catch(refusing(code));
}

/** Maps a refusal of the guards of 0133 met by a write to the code of the route. */
export async function refusingClosedQuarter<T>(
  work: () => Promise<T>,
  code: ErrorCode = 'quarter_closed',
): Promise<T> {
  return work().catch(refusing(code));
}

/** The close in force of a quarter, or `undefined` while it is open. A reader: no lock. */
export async function closingOf(
  transaction: Transaction,
  quarterId: string,
): Promise<
  | {
      id: string;
      version: number;
      closed_at: Date;
      closed_by: string;
      lock_now: boolean;
      start_quarter: string | null;
      warnings: unknown;
    }
  | undefined
> {
  return transaction
    .selectFrom('quarter_closings')
    .select(['id', 'version', 'closed_at', 'closed_by', 'lock_now', 'start_quarter', 'warnings'])
    .where('quarter_id', '=', quarterId)
    .where('reopened_at', 'is', null)
    .executeTakeFirst();
}

/** The ids of the closed quarters among those given. */
export async function closedQuarters(
  transaction: Transaction,
  quarterIds: readonly string[],
): Promise<Set<string>> {
  if (quarterIds.length === 0) return new Set();
  const rows = await transaction
    .selectFrom('quarter_closings')
    .select('quarter_id')
    .where('quarter_id', 'in', quarterIds)
    .where('reopened_at', 'is', null)
    .execute();
  return new Set(rows.map((row) => row.quarter_id));
}

/**
 * The close in force of a journal's quarter as its files state it, with the names stored with it
 * (task 9.2b, From 8.9; `edge/academic-year`: "Closed quarters and years keep the names as they
 * were, and prints of closed periods use those"); `null` while the quarter is open.
 */
export async function journalFinalOf(
  transaction: Transaction,
  quarterId: string,
  journalId: string,
): Promise<{
  closedAt: Date;
  version: number;
  names: {
    unit: string;
    subject: { uz: string; ru: string; en: string };
    teacher: string | null;
  } | null;
} | null> {
  const closing = await closingOf(transaction, quarterId);
  if (closing === undefined) return null;
  const stored = await transaction
    .selectFrom('quarter_closing_journals')
    .select(['unit_name', 'subject_names', 'teacher_name'])
    .where('closing_id', '=', closing.id)
    .where('journal_id', '=', journalId)
    .executeTakeFirst();
  const subject = stored?.subject_names as { uz?: unknown; ru?: unknown; en?: unknown } | undefined;
  return {
    closedAt: closing.closed_at,
    version: closing.version,
    names:
      stored === undefined ||
      typeof subject?.uz !== 'string' ||
      typeof subject.ru !== 'string' ||
      typeof subject.en !== 'string'
        ? null
        : {
            unit: stored.unit_name,
            subject: { uz: subject.uz, ru: subject.ru, en: subject.en },
            teacher: stored.teacher_name,
          },
  };
}
