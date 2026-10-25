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
 *
 * Task 9.2c (db/migrations/0135): a quarter has versions of its final results, the branch close
 * (`cause = 'close'`), a journal's re-close and an applied recalculation. The quarter is closed
 * while its branch close is in force, or while a whole-branch reopening is unfinished and its end
 * has passed (`quarter_is_closed`, plan decision 3); a journal with an unfinished reopening whose
 * end has not passed takes its own rows (`quarter_journal_open`). A student's stored result is the
 * record of the highest version in force that holds one (`recordsInForce`); a journal with an
 * unfinished reopening is read live.
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

/**
 * Locks one quarter and refuses with `code` when it is closed for the journal's own rows (task
 * 9.2c): open, or the journal reopened and its end not passed.
 */
export async function lockOpenJournalQuarter(
  transaction: Transaction,
  quarterId: string,
  journalId: string,
  code: ErrorCode = 'quarter_closed',
): Promise<void> {
  await sql`select quarter_journal_open_guard(${quarterId}::uuid, ${journalId}::uuid)`
    .execute(transaction)
    .catch(refusing(code));
}

/**
 * Whether the quarter is closed for writes at the transaction's moment, as `quarter_is_closed`
 * answers it (task 9.2c; `.claude/rules/database.md`: the code and the database compare the same
 * moment). A reader: no lock.
 */
export async function quarterClosedNow(
  transaction: Transaction,
  quarterId: string,
): Promise<boolean> {
  const { rows } = await sql<{ closed: boolean }>`
    select quarter_is_closed(${quarterId}::uuid) as closed
  `.execute(transaction);
  return rows[0]?.closed === true;
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
    .where('cause', '=', 'close')
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
    .where('cause', '=', 'close')
    .execute();
  return new Set(rows.map((row) => row.quarter_id));
}

/** A reopening of a quarter as the readers need it (task 9.2c). */
export interface Reopening {
  id: string;
  journal_id: string | null;
  reason: string;
  days: number;
  reopened_at: Date;
  open_until: Date;
  reopened_by: string;
  ended_by_closing_id: string | null;
}

/** Every reopening of a quarter, oldest first. A reader. */
export async function reopeningsOf(
  transaction: Transaction,
  quarterId: string,
): Promise<Reopening[]> {
  return transaction
    .selectFrom('quarter_reopenings')
    .select([
      'id',
      'journal_id',
      'reason',
      'days',
      'reopened_at',
      'open_until',
      'reopened_by',
      'ended_by_closing_id',
    ])
    .where('quarter_id', '=', quarterId)
    .orderBy('reopened_at')
    .orderBy('id')
    .execute();
}

/** The journals of a quarter with an unfinished reopening (read live, task 9.2c). */
export async function reopenedJournals(
  transaction: Transaction,
  quarterIds: readonly string[],
): Promise<Set<string>> {
  if (quarterIds.length === 0) return new Set();
  const rows = await transaction
    .selectFrom('quarter_reopenings')
    .select(['quarter_id', 'journal_id'])
    .where('quarter_id', 'in', [...quarterIds])
    .where('journal_id', 'is not', null)
    .where('ended_by_closing_id', 'is', null)
    .execute();
  return new Set(
    rows.flatMap((row) => (row.journal_id === null ? [] : [`${row.quarter_id}|${row.journal_id}`])),
  );
}

/** A stored final record in force (task 9.2c). */
export interface RecordInForce {
  readonly closingId: string;
  readonly version: number;
  readonly closedAt: Date;
  readonly subjectId: string;
  readonly studentId: string;
  readonly journalId: string;
  readonly kind: string;
  readonly record: unknown;
}

/**
 * The records in force of a quarter, by `<subject>|<student>`: for each, the record of the highest
 * version among the versions in force that hold one (task 9.2c, plan decision 14). Empty while
 * the quarter has no branch close in force. A reader.
 */
export async function recordsInForce(
  transaction: Transaction,
  quarterId: string,
  filter: { subjectId?: string; studentId?: string } = {},
): Promise<Map<string, RecordInForce>> {
  let query = transaction
    .selectFrom('quarter_final_results as r')
    .innerJoin('quarter_closings as c', 'c.id', 'r.closing_id')
    .select([
      'r.closing_id',
      'c.version',
      'c.closed_at',
      'r.subject_id',
      'r.student_id',
      'r.journal_id',
      'r.kind',
      'r.record',
    ])
    .where('r.quarter_id', '=', quarterId)
    .where('c.reopened_at', 'is', null);
  if (filter.subjectId !== undefined) query = query.where('r.subject_id', '=', filter.subjectId);
  if (filter.studentId !== undefined) query = query.where('r.student_id', '=', filter.studentId);
  const rows = await query.orderBy('c.version').execute();
  const found = new Map<string, RecordInForce>();
  for (const row of rows) {
    // Ascending versions: a later one replaces an earlier one.
    found.set(`${row.subject_id}|${row.student_id}`, {
      closingId: row.closing_id,
      version: row.version,
      closedAt: row.closed_at,
      subjectId: row.subject_id,
      studentId: row.student_id,
      journalId: row.journal_id,
      kind: row.kind,
      record: row.record as unknown,
    });
  }
  return found;
}

/**
 * The version in force of a journal's quarter as its files state it, with the names stored with it
 * (task 9.2b, From 8.9; `edge/academic-year`: "Closed quarters and years keep the names as they
 * were, and prints of closed periods use those"); `null` while the quarter is open or the journal
 * has an unfinished reopening (task 9.2c). The version is the highest version in force that holds
 * the journal's records or is its re-close; the names are those of the latest version in force
 * that stored them.
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
  if ((await reopenedJournals(transaction, [quarterId])).has(`${quarterId}|${journalId}`)) {
    return null;
  }
  const versions = await transaction
    .selectFrom('quarter_closings as c')
    .select(['c.id', 'c.version', 'c.closed_at'])
    .where('c.quarter_id', '=', quarterId)
    .where('c.reopened_at', 'is', null)
    .where((where) =>
      where.or([
        where('c.cause', '=', 'close'),
        where('c.journal_id', '=', journalId),
        where.exists(
          where
            .selectFrom('quarter_final_results as r')
            .select('r.id')
            .whereRef('r.closing_id', '=', 'c.id')
            .where('r.journal_id', '=', journalId),
        ),
      ]),
    )
    .orderBy('c.version', 'desc')
    .execute();
  const latest = versions[0];
  if (latest === undefined) return null;
  const stored = await transaction
    .selectFrom('quarter_closing_journals as j')
    .innerJoin('quarter_closings as c', 'c.id', 'j.closing_id')
    .select(['j.unit_name', 'j.subject_names', 'j.teacher_name'])
    .where('j.journal_id', '=', journalId)
    .where('c.quarter_id', '=', quarterId)
    .where('c.reopened_at', 'is', null)
    .orderBy('c.version', 'desc')
    .executeTakeFirst();
  const subject = stored?.subject_names as { uz?: unknown; ru?: unknown; en?: unknown } | undefined;
  return {
    closedAt: latest.closed_at,
    version: latest.version,
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
