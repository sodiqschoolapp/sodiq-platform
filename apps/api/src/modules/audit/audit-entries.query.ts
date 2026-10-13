import type { AuditCursor } from '@sodiq/shared';
import { sql, type Expression, type ExpressionBuilder, type SqlBool } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { DB, Json } from '../../database/types.generated.js';

/** One stored entry of either log, as the Audit log page reads it. */
export interface StoredEntry {
  id: string;
  occurred_at: Date;
  /** `null` for the school-wide log. */
  branch_id: string | null;
  actor_id: string | null;
  person_id: string | null;
  assignment_id: string | null;
  action: string;
  record_type: string | null;
  record_id: string | null;
  old_value: Json | null;
  new_value: Json | null;
  details: Json | null;
  reason: string | null;
}

/**
 * What one read of the log takes (task 2.6a, pull request #75):
 *
 * - `branchLog`: `none`, or `filtered`, the rows of `audit_log` the row filter
 *   of the transaction shows (the branch of the request, or every branch for
 *   the Super Admin's scope `all`);
 * - `schoolLog`: `none`, `all` (the Super Admin), or `branch`: the entries a
 *   branch reads of the school-wide log (decision 3 with correction 1): those
 *   written from the branch (`details.branchId`), and those about a relative
 *   made while a link of the relative to a student of the branch was live;
 * - the search (decision 5): a person, a record, a date range in the time zone
 *   of the branch of the request, a list of actions, an entry id, a cursor.
 */
export interface EntriesSearch {
  branchLog: 'none' | 'filtered';
  schoolLog: 'none' | 'all' | 'branch';
  /** The branch of the request: the school-wide part of `branch`, and the time zone. */
  branchId: string;
  timeZone: string;
  person?: { kind: 'staff' | 'student' | 'relative'; id: string; accountId: string | null };
  record?: { type: string; id: string };
  /** School dates, inclusive. */
  from?: string;
  to?: string;
  actions?: readonly string[];
  id?: string;
  before?: AuditCursor;
  limit: number;
}

type LogTable = 'audit_log' | 'audit_log_school';

/** The search conditions both logs share, on the columns of `table`. */
function searchOf<Table extends LogTable>(search: EntriesSearch) {
  return (builder: ExpressionBuilder<DB, Table>): Expression<SqlBool> => {
    const eb = builder as unknown as ExpressionBuilder<DB, LogTable>;
    const conditions: Expression<SqlBool>[] = [];
    if (search.person !== undefined) {
      const { kind, id, accountId } = search.person;
      const either: Expression<SqlBool>[] = [
        eb('person_id', '=', id),
        eb.and([eb('record_type', '=', kind), eb('record_id', '=', id)]),
      ];
      if (accountId !== null) {
        either.push(eb('actor_id', '=', accountId));
      }
      conditions.push(eb.or(either));
    }
    if (search.record !== undefined) {
      conditions.push(
        eb.and([
          eb('record_type', '=', search.record.type),
          eb('record_id', '=', search.record.id),
        ]),
      );
    }
    if (search.from !== undefined) {
      conditions.push(
        sql<SqlBool>`occurred_at >= (${search.from}::date::timestamp at time zone ${search.timeZone})`,
      );
    }
    if (search.to !== undefined) {
      conditions.push(
        sql<SqlBool>`occurred_at < ((${search.to}::date + 1)::timestamp at time zone ${search.timeZone})`,
      );
    }
    if (search.actions !== undefined) {
      conditions.push(
        search.actions.length === 0 ? sql<SqlBool>`false` : eb('action', 'in', [...search.actions]),
      );
    }
    if (search.id !== undefined) {
      conditions.push(eb('id', '=', search.id));
    }
    if (search.before !== undefined) {
      conditions.push(
        sql<SqlBool>`(occurred_at, id) < (${search.before.at}::timestamptz, ${search.before.id}::uuid)`,
      );
    }
    return eb.and(conditions);
  };
}

const COLUMNS = [
  'id',
  'occurred_at',
  'actor_id',
  'person_id',
  'assignment_id',
  'action',
  'record_type',
  'record_id',
  'old_value',
  'new_value',
  'details',
  'reason',
] as const;

/**
 * One page of entries, newest first, ordered by moment and id (decision 8),
 * from the parts of the logs the search names. Runs in the caller's
 * transaction, whose row filter limits `audit_log`.
 */
export async function readEntries(
  transaction: Transaction,
  search: EntriesSearch,
): Promise<StoredEntry[]> {
  // `branch_id` typed alike in both parts, so that they make one union.
  const branchPart = transaction
    .selectFrom('audit_log')
    .select([...COLUMNS, sql<string | null>`branch_id`.as('branch_id')])
    .where(searchOf<'audit_log'>(search));
  let schoolPart = transaction
    .selectFrom('audit_log_school')
    .select([...COLUMNS, sql<string | null>`null::uuid`.as('branch_id')])
    .where(searchOf<'audit_log_school'>(search));
  if (search.schoolLog === 'branch') {
    // The links read here are those of the row filter: the branch of the
    // request only.
    schoolPart = schoolPart.where((eb) =>
      eb.or([
        sql<SqlBool>`audit_log_school.details ->> 'branchId' = ${search.branchId}`,
        eb.and([
          eb('audit_log_school.record_type', '=', 'relative'),
          eb.exists(
            eb
              .selectFrom('student_relatives as l')
              .select(sql`1`.as('one'))
              .whereRef('l.relative_id', '=', 'audit_log_school.record_id')
              .where('l.branch_id', '=', search.branchId)
              .whereRef('l.linked_at', '<=', 'audit_log_school.occurred_at')
              .where((inner) =>
                inner.or([
                  inner('l.unlinked_at', 'is', null),
                  inner('l.unlinked_at', '>', inner.ref('audit_log_school.occurred_at')),
                ]),
              ),
          ),
        ]),
      ]),
    );
  }
  const source =
    search.branchLog === 'none'
      ? search.schoolLog === 'none'
        ? undefined
        : schoolPart
      : search.schoolLog === 'none'
        ? branchPart
        : branchPart.unionAll(schoolPart);
  if (source === undefined) {
    return [];
  }
  return transaction
    .selectFrom(source.as('e'))
    .selectAll()
    .orderBy('e.occurred_at', 'desc')
    .orderBy('e.id', 'desc')
    .limit(search.limit)
    .execute();
}
