import { Injectable } from '@nestjs/common';
import {
  DEFAULT_DIGEST_FREQUENCY,
  DIGEST_LOG_PAGE,
  digestFrequencySchema,
  digestLogSchema,
  digestStatusSchema,
  type DigestFrequencyAnswer,
  type DigestFrequencyChange,
  type DigestLog,
  type DigestLogQuery,
  type DigestSettings,
  type DigestSettingsChange,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, Transactions } from '../../../database/transactions.js';
import { ApiException } from '../../../http/api-exception.js';
import type { Access } from '../../access/permission.guard.js';
import { Audit } from '../../audit/audit.service.js';
import type { ActiveSession } from '../../auth/sessions.service.js';
import { digestSettingsOf } from './digest.service.js';

/**
 * Task 11.5 (pull request #299): the Super Admin's settings and send log of the parents' digest,
 * and the parent's own frequency. School-wide work: every transaction names no branch.
 */
@Injectable()
export class DigestAdmin {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  settings(): Promise<DigestSettings> {
    return this.transactions.run([], (transaction) => digestSettingsOf(transaction));
  }

  /** `10`: "The Super Admin sets the time of day ... the quiet hours"; audited (plan decision 12). */
  change(access: Access, change: DigestSettingsChange, requestId: string): Promise<DigestSettings> {
    return this.transactions.run([], async (transaction) => {
      await transaction.selectFrom('digest_settings').select('id').forUpdate().execute();
      const old = await digestSettingsOf(transaction);
      if (
        old.sendAt === change.sendAt &&
        old.quietFrom === change.quietFrom &&
        old.quietUntil === change.quietUntil
      ) {
        return old;
      }
      await transaction
        .updateTable('digest_settings')
        .set({
          send_at: change.sendAt,
          quiet_from: change.quietFrom,
          quiet_until: change.quietUntil,
        })
        .execute();
      await this.audit.record(transaction, {
        branchId: null,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'school_settings.digest',
        oldValue: old,
        newValue: { ...change },
        requestId,
      });
      return digestSettingsOf(transaction);
    });
  }

  /** The send log (`10`, Sending: "to whom, for which children, when, delivered or not"). */
  async log(query: DigestLogQuery): Promise<DigestLog> {
    const page = query.page ?? 1;
    // The Super Admin reads every branch (`digest_log` is theirs alone): the relative's name is
    // read through its membership filter, which needs a link of a branch of the transaction
    // (permission review of the code, should-fix 3).
    const branchIds = (
      await this.transactions.run([], (transaction) =>
        transaction.selectFrom('branches').select('id').orderBy('id').execute(),
      )
    ).map((row) => row.id);
    return this.transactions.run(branchIds, async (transaction) => {
      const where = sql`
        (${query.from ?? null}::date is null or d.digest_date >= ${query.from ?? null}::date)
        and (${query.to ?? null}::date is null or d.digest_date <= ${query.to ?? null}::date)
        and (${query.status ?? null}::text is null or d.status = ${query.status ?? null}::text)
      `;
      const total = await sql<{ count: string }>`
        select count(*)::text as count from digests d where ${where}
      `.execute(transaction);
      const rows = await sql<{
        id: string;
        digest_date: string;
        full_name: string | null;
        login: string;
        status: string;
        attempts: number;
        due_at: Date;
        sent_at: Date | null;
      }>`
        select d.id, d.digest_date::text as digest_date, r.full_name, a.login, d.status,
          d.attempts, d.due_at, d.sent_at
        from digests d
        join accounts a on a.id = d.account_id
        left join relative_accounts ra on ra.account_id = d.account_id
        left join relatives r on r.id = ra.relative_id
        where ${where}
        order by d.digest_date desc, d.due_at desc, d.id
        limit ${DIGEST_LOG_PAGE} offset ${(page - 1) * DIGEST_LOG_PAGE}
      `.execute(transaction);
      const ids = rows.rows.map((row) => row.id);
      const parts =
        ids.length === 0
          ? []
          : await transaction
              .selectFrom('digest_parts')
              .select(['digest_id', 'first_name', 'class_name'])
              .where('digest_id', 'in', ids)
              .orderBy('first_name')
              .orderBy('id')
              .execute();
      return digestLogSchema.parse({
        rows: rows.rows.map((row) => ({
          id: row.id,
          digestDate: row.digest_date,
          parentName: row.full_name ?? '',
          login: row.login,
          children: parts
            .filter((part) => part.digest_id === row.id)
            .map((part) => ({ firstName: part.first_name, className: part.class_name })),
          status: digestStatusSchema.parse(row.status),
          attempts: row.attempts,
          dueAt: row.due_at.toISOString(),
          sentAt: row.sent_at?.toISOString() ?? null,
        })),
        total: Number(total.rows[0]?.count ?? '0'),
        page,
        pageSize: DIGEST_LOG_PAGE,
      });
    });
  }

  /** A Parent account only: a staff account has no digest (403). */
  private refuseStaff(session: ActiveSession): void {
    if (session.kind !== 'parent') throw new ApiException('permission_denied', 403);
  }

  frequency(session: ActiveSession): Promise<DigestFrequencyAnswer> {
    this.refuseStaff(session);
    return this.transactions.run([], async (transaction) => {
      const row = await transaction
        .selectFrom('digest_frequencies')
        .select('frequency')
        .where('account_id', '=', session.accountId)
        .executeTakeFirst();
      return row === undefined
        ? { frequency: DEFAULT_DIGEST_FREQUENCY, chosen: false }
        : { frequency: digestFrequencySchema.parse(row.frequency), chosen: true };
    });
  }

  /** `10`: "In the portal a parent changes only their own password, language and digest frequency." */
  setFrequency(
    session: ActiveSession,
    change: DigestFrequencyChange,
    requestId: string,
  ): Promise<DigestFrequencyAnswer> {
    this.refuseStaff(session);
    return this.transactions.run([], async (transaction) => {
      await transaction
        .selectFrom('accounts')
        .select('id')
        .where('id', '=', session.accountId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const old = await transaction
        .selectFrom('digest_frequencies')
        .select('frequency')
        .where('account_id', '=', session.accountId)
        .executeTakeFirst();
      if (old?.frequency === change.frequency) {
        return { frequency: change.frequency, chosen: true };
      }
      const now = await transactionMoment(transaction);
      await transaction
        .insertInto('digest_frequencies')
        .values({ account_id: session.accountId, frequency: change.frequency, chosen_at: now })
        .onConflict((conflict) =>
          conflict
            .column('account_id')
            .doUpdateSet({ frequency: change.frequency, chosen_at: now }),
        )
        .execute();
      await this.audit.record(transaction, {
        branchId: null,
        actorId: session.accountId,
        action: 'parent_account.digest_frequency',
        record: { type: 'account', id: session.accountId },
        oldValue: { frequency: old?.frequency ?? DEFAULT_DIGEST_FREQUENCY },
        newValue: { frequency: change.frequency },
        requestId,
      });
      return { frequency: change.frequency, chosen: true };
    });
  }
}
