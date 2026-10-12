import { Inject, Injectable } from '@nestjs/common';
import {
  LOGIN_FORMAT,
  RESET_LINK_INTERVAL_MS,
  RESET_TOKEN_FORMAT,
  type Clock,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { Audit } from '../audit/audit.service.js';
import { hashPassword } from './password-hash.js';
import { passwordResetMailJob } from './password-reset-mail.job.js';
import { closeOpenResetLinks, resetTokenHash } from './reset-links.js';
import { Sessions } from './sessions.service.js';
import { SignInThrottle } from './sign-in-throttle.service.js';

const invalid = () => new ApiException('reset_link_invalid', 400);
const expired = () => new ApiException('reset_link_expired', 400);

/** Whether a link may be made for the account now (db/migrations/0031): a yes or no only. */
export async function resetAllowed(transaction: Transaction, accountId: string): Promise<boolean> {
  const at = await transactionMoment(transaction);
  const found = await sql<{ allowed: boolean }>`
    select password_reset_allowed(${accountId}::uuid, ${at}::timestamptz) as allowed
  `.execute(transaction);
  return found.rows[0]?.allowed === true;
}

/**
 * Password reset by email (docs/spec/02-roles-and-access.md, Accounts and
 * sign-in: build order; task 2.3c-2, pull request #66). Both routes are
 * public: nobody is signed in.
 *
 * The request answers the same for every login (decision 8) and makes a link
 * row and the mail job in one transaction (CLAUDE.md, Jobs in the same
 * transaction); the job makes the token (`PasswordResetMail`). The confirm
 * sets the typed password once per link, ends every session and every trusted
 * device, and forgets the failed sign-ins (decision 12); the next sign-in asks
 * for the second step as before.
 */
@Injectable()
export class EmailPasswordResets {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly jobs: Jobs,
    private readonly throttle: SignInThrottle,
    private readonly sessions: Sessions,
  ) {}

  /**
   * Makes a link when the login names an account that may get one and the
   * newest link of that account was asked for at least 5 minutes ago
   * (decision 10). Nothing in the answer tells which; only the allowed path
   * writes (decision 8, an accepted risk as the sign-in of 0.6b).
   */
  async request(login: string, requestId: string): Promise<void> {
    if (!LOGIN_FORMAT.test(login)) {
      return;
    }
    await this.transactions.run([], async (transaction) => {
      // The account row first, in a statement of its own: two requests at the
      // same moment meet here, and the second reads the first one's link.
      const account = await transaction
        .selectFrom('accounts')
        .select('id')
        .where('login', '=', login)
        .forUpdate()
        .executeTakeFirst();
      if (account === undefined) {
        return;
      }
      if (!(await resetAllowed(transaction, account.id))) {
        return;
      }
      const now = this.clock.now();
      const newest = await transaction
        .selectFrom('password_reset_links')
        .select('requested_at')
        .where('account_id', '=', account.id)
        .orderBy('requested_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (
        newest !== undefined &&
        now.getTime() - newest.requested_at.getTime() < RESET_LINK_INTERVAL_MS
      ) {
        return;
      }
      await closeOpenResetLinks(transaction, account.id, now);
      const link = await transaction
        .insertInto('password_reset_links')
        .values({ account_id: account.id, requested_at: now })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.jobs.enqueue(transaction, passwordResetMailJob, {
        branchIds: [],
        data: { linkId: link.id },
      });
      await this.audit.record(transaction, {
        branchId: null,
        // Nobody is signed in: who asked is not known.
        actorId: null,
        action: 'auth.password_reset_requested',
        record: { type: 'account', id: account.id },
        requestId,
      });
    });
  }

  /**
   * Sets the new password with a link. The token is checked before anything
   * is hashed, without a lock, so an unsigned caller cannot make the server
   * compute Argon2id (must-fix 3 of the plan review); the hash is made outside
   * any transaction; then the link and the account are locked, in this order
   * and in statements of their own, and every condition is read again
   * (must-fix 1): an administrator's reset, a lock or another confirm at the
   * same moment either waits for this one or makes it fail.
   */
  async confirm(token: string, newPassword: string, requestId: string): Promise<void> {
    if (!RESET_TOKEN_FORMAT.test(token)) {
      throw invalid();
    }
    const hash = resetTokenHash(token);
    const first = await this.transactions.run([], (transaction) =>
      transaction
        .selectFrom('password_reset_links')
        .select(['valid_until', 'used_at', 'closed_at'])
        .where('token_hash', '=', hash)
        .executeTakeFirst(),
    );
    this.checkLink(first);
    const passwordHash = await hashPassword(newPassword);

    await this.transactions.run([], async (transaction) => {
      const link = await transaction
        .selectFrom('password_reset_links')
        .select([
          'id',
          'account_id',
          'requested_at',
          'sent_at',
          'valid_until',
          'used_at',
          'closed_at',
        ])
        .where('token_hash', '=', hash)
        .forUpdate()
        .executeTakeFirst();
      this.checkLink(link);
      if (link === undefined) {
        throw invalid();
      }
      const account = await transaction
        .selectFrom('accounts')
        .select(['login', 'locked_at'])
        .where('id', '=', link.account_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const newer = await transaction
        .selectFrom('password_reset_links')
        .select('id')
        .where('account_id', '=', link.account_id)
        .where('requested_at', '>', link.requested_at)
        .executeTakeFirst();
      if (
        newer !== undefined ||
        account.locked_at !== null ||
        !(await resetAllowed(transaction, link.account_id))
      ) {
        throw invalid();
      }
      const now = this.clock.now();
      await transaction
        .updateTable('accounts')
        .set({
          password_hash: passwordHash,
          must_change_password: false,
          password_expires_at: null,
          password_changed_at: now,
          password_reset_by: null,
          password_reset_at: null,
        })
        .where('id', '=', link.account_id)
        .execute();
      await transaction
        .updateTable('password_reset_links')
        .set({ used_at: now })
        .where('id', '=', link.id)
        .execute();
      await closeOpenResetLinks(transaction, link.account_id, now);
      await this.throttle.forget(transaction, account.login);
      await this.sessions.writeEndsByTime(transaction, link.account_id);
      const ended = await transaction
        .updateTable('sessions')
        .set({ ended_at: now, end_reason: 'password_reset' })
        .where('account_id', '=', link.account_id)
        .where('ended_at', 'is', null)
        .returning('id')
        .execute();
      const emailChange = await sql<{ actor_id: string | null; occurred_at: Date }>`
        select actor_id, occurred_at from last_email_change(${link.account_id}::uuid)
      `.execute(transaction);
      const change = emailChange.rows[0];
      await this.audit.record(transaction, {
        branchId: null,
        actorId: link.account_id,
        action: 'auth.password_reset_by_email',
        record: { type: 'account', id: link.account_id },
        details: {
          endedSessions: ended.length,
          // Decision 6 and correction 1 of #66: who changed the email last, and
          // when, for the report of entries after a reset (6.1).
          lastEmailChange:
            change === undefined
              ? null
              : { by: change.actor_id, at: change.occurred_at.toISOString() },
        },
        requestId,
      });
    });
  }

  /** Unknown, used or closed: invalid; past its hour: expired. */
  private checkLink(
    link: { valid_until: Date | null; used_at: Date | null; closed_at: Date | null } | undefined,
  ): void {
    if (
      link === undefined ||
      link.valid_until === null ||
      link.used_at !== null ||
      link.closed_at !== null
    ) {
      throw invalid();
    }
    if (link.valid_until.getTime() <= this.clock.now().getTime()) {
      throw expired();
    }
  }
}
