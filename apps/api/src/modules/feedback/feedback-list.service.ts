import { Inject, Injectable } from '@nestjs/common';
import {
  FEEDBACK_HANDLED_LISTED,
  feedbackReportEntrySchema,
  roleSchema,
  type Clock,
  type FeedbackReportEntry,
  type FeedbackReportList,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';

/** A stored report with its mark, as the list reads it. */
interface StoredReport {
  id: string;
  account_id: string;
  roles: string[];
  page: string;
  text: string;
  app_version: number | null;
  created_at: Date;
  handled_at: Date | null;
  handled_by: string | null;
}

const COLUMNS = [
  'id',
  'account_id',
  'roles',
  'page',
  'text',
  'app_version',
  'created_at',
  'handled_at',
  'handled_by',
] as const;

/**
 * The Feedback reports page of the Super Admin (pull request #361; owner, 19 November 2026):
 * the reports of the whole school and their handled mark. `feedback_reports` is school-wide
 * (0011), so every read and write runs in a transaction of no branch; the names come through
 * `audit_names` (0039), the staff name of the account in any branch, which only the Super Admin
 * reads here (decision 4 of the plan).
 */
@Injectable()
export class FeedbackList {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Every new report and the newest `FEEDBACK_HANDLED_LISTED` handled ones, newest first. */
  list(access: Access): Promise<FeedbackReportList> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const fresh = await transaction
        .selectFrom('feedback_reports')
        .select(COLUMNS)
        .where('handled_at', 'is', null)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
      // One more than listed tells whether more exist.
      const handled = await transaction
        .selectFrom('feedback_reports')
        .select(COLUMNS)
        .where('handled_at', 'is not', null)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(FEEDBACK_HANDLED_LISTED + 1)
        .execute();
      const rows = [...fresh, ...handled.slice(0, FEEDBACK_HANDLED_LISTED)].sort(newestFirst);
      return {
        entries: await entriesOf(transaction, rows),
        handledTruncated: handled.length > FEEDBACK_HANDLED_LISTED,
      };
    });
  }

  /**
   * Marks a report handled (`true`) or new again (`false`), with an audit entry in the
   * school-wide log in the same transaction. A report already in that state is answered
   * unchanged, and no entry is written.
   */
  mark(
    access: Access,
    id: string,
    handled: boolean,
    requestId: string,
  ): Promise<FeedbackReportEntry> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      // The row is locked first, whatever its state, and its state read afterwards.
      const row = await transaction
        .selectFrom('feedback_reports')
        .select(COLUMNS)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (row === undefined) {
        throw new ApiException('not_found', 404);
      }
      if ((row.handled_at !== null) === handled) {
        const [same] = await entriesOf(transaction, [row]);
        return answerOf(same);
      }
      const changed = await transaction
        .updateTable('feedback_reports')
        .set(
          handled
            ? { handled_at: this.clock.now(), handled_by: access.accountId }
            : { handled_at: null, handled_by: null },
        )
        .where('id', '=', id)
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      // The mark only: never the report's text, which the sender wrote.
      await this.audit.record(transaction, {
        branchId: null,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: handled ? 'feedback.handled' : 'feedback.reopened',
        record: { type: 'feedback_report', id },
        oldValue: { handled: !handled },
        newValue: { handled },
        requestId,
      });
      const [entry] = await entriesOf(transaction, [changed]);
      return answerOf(entry);
    });
  }
}

const newestFirst = (one: StoredReport, other: StoredReport): number =>
  other.created_at.getTime() - one.created_at.getTime() || (other.id < one.id ? -1 : 1);

function answerOf(entry: FeedbackReportEntry | undefined): FeedbackReportEntry {
  if (entry === undefined) {
    // `entriesOf` answers one entry for each row it is given.
    throw new Error('A report without its entry.');
  }
  return entry;
}

/** The rows as the page shows them, the names of the senders and markers read once. */
async function entriesOf(
  transaction: Transaction,
  rows: readonly StoredReport[],
): Promise<FeedbackReportEntry[]> {
  const ids = [
    ...new Set(
      rows.flatMap((row) => [row.account_id, row.handled_by]).filter((one) => one !== null),
    ),
  ];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const found = await sql<{ id: string; first_name: string | null; last_name: string | null }>`
      select id, first_name, last_name from audit_names(${ids}::uuid[])
    `.execute(transaction);
    for (const one of found.rows) {
      names.set(one.id, [one.last_name, one.first_name].filter(Boolean).join(' '));
    }
  }
  const person = (id: string) => ({ id, name: names.get(id) ?? '' });
  return rows.map((row) =>
    feedbackReportEntrySchema.parse({
      id: row.id,
      sender: person(row.account_id),
      roles: row.roles.map((role) => roleSchema.parse(role)),
      page: row.page,
      text: row.text,
      appVersion: row.app_version,
      createdAt: row.created_at.toISOString(),
      handledAt: row.handled_at?.toISOString() ?? null,
      handledBy: row.handled_by === null ? null : person(row.handled_by),
    }),
  );
}
