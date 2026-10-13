import { Injectable } from '@nestjs/common';
import {
  AUDIT_PAGE_SIZE,
  auditCursorOf,
  signInEventSchema,
  type AuditCursor,
  type SignInEvent,
  type SignInHistory,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions } from '../../database/transactions.js';

/**
 * The own sign-in history (edge/people-roles-accounts: "every user sees their
 * own sign-in history"; task 2.6a, decisions 10 and 11 of pull request #75).
 * Read through `own_sign_in_history` (db/migrations/0039) for the account of
 * the session only: an administrator's lock or reset of the account sits in
 * the log of the administrator's branch. The administrator is named, as in
 * "your password was reset by X"; no value, detail or reason is answered.
 */
@Injectable()
export class SignInHistoryReader {
  constructor(private readonly transactions: Transactions) {}

  async read(accountId: string, before: AuditCursor | undefined): Promise<SignInHistory> {
    return this.transactions.run([], async (transaction) => {
      const found = await sql<{
        id: string;
        occurred_at: Date;
        action: string;
        actor_id: string | null;
        user_agent: string | null;
      }>`
        select id, occurred_at, action, actor_id, user_agent
        from own_sign_in_history(
          ${accountId}::uuid,
          ${before?.at ?? null}::timestamptz,
          ${before?.id ?? null}::uuid,
          ${AUDIT_PAGE_SIZE + 1}
        )
      `.execute(transaction);
      const others = [
        ...new Set(
          found.rows
            .map((row) => row.actor_id)
            .filter((id): id is string => id !== null && id !== accountId),
        ),
      ];
      const names = new Map<string, string>();
      if (others.length > 0) {
        const named = await sql<{
          id: string;
          first_name: string | null;
          last_name: string | null;
        }>`
          select id, first_name, last_name from audit_names(${others}::uuid[])
        `.execute(transaction);
        for (const row of named.rows) {
          names.set(row.id, [row.last_name, row.first_name].filter(Boolean).join(' '));
        }
      }
      const events: SignInEvent[] = found.rows.slice(0, AUDIT_PAGE_SIZE).map((row) =>
        signInEventSchema.parse({
          id: row.id,
          occurredAt: row.occurred_at.toISOString(),
          action: row.action,
          by:
            row.actor_id === null || row.actor_id === accountId
              ? null
              : (names.get(row.actor_id) ?? null),
          browser: row.user_agent,
        }),
      );
      const last = events.at(-1);
      return {
        events,
        next:
          found.rows.length > AUDIT_PAGE_SIZE && last !== undefined ? auditCursorOf(last) : null,
      };
    });
  }
}
