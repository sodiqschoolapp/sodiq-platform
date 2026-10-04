import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import type { Transaction } from '../../database/transactions.js';
import { Audit } from '../audit/audit.service.js';
import { randomFirstPassword } from './accounts.service.js';
import { hashPassword } from './password-hash.js';
import { Sessions } from './sessions.service.js';
import { SignInThrottle } from './sign-in-throttle.service.js';

/** Edge cases, "Accounts and sign-in": a reset gives a one-time password valid for 24 hours. */
export const RESET_PASSWORD_VALID_MS = 24 * 60 * 60 * 1000;

/**
 * An administrator's own password is not reset by that administrator: it is
 * changed with the current one, or reset by somebody else (decided by the owner).
 */
export class OwnPasswordResetError extends Error {
  constructor() {
    super('An administrator cannot reset their own password.');
  }
}

export class UnknownAccountError extends Error {
  constructor() {
    super('The account to reset does not exist.');
  }
}

export interface PasswordReset {
  /** The account whose password is reset. */
  accountId: string;
  /** The account of the administrator who resets it. */
  resetBy: string;
  requestId?: string;
}

export interface ResetPassword {
  /** Shown once to the administrator and stored nowhere. */
  oneTimePassword: string;
}

/**
 * Password reset by an administrator (edge cases, "Accounts and sign-in"). The
 * person gets a one-time password that is valid for 24 hours and must be
 * changed before anything else; all sessions end; the log says "reset by X for
 * Y"; the session answer names X until the password is changed. The count of
 * failed sign-ins of the login starts again, so the person need not wait.
 *
 * Until the screens of task 2.3 this service has no route: who may reset whom
 * is a question of roles, which arrive with the permission guard of task 0.7.
 * Only tests call it.
 */
@Injectable()
export class PasswordResets {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: Audit,
    private readonly throttle: SignInThrottle,
    private readonly sessions: Sessions,
  ) {}

  async byAdministrator(transaction: Transaction, reset: PasswordReset): Promise<ResetPassword> {
    if (reset.resetBy === reset.accountId) {
      throw new OwnPasswordResetError();
    }
    const oneTimePassword = randomFirstPassword();
    const passwordHash = await hashPassword(oneTimePassword);
    const now = this.clock.now();

    const changed = await transaction
      .updateTable('accounts')
      .set({
        password_hash: passwordHash,
        // Together, as the check constraint of `accounts` demands.
        must_change_password: true,
        password_expires_at: new Date(now.getTime() + RESET_PASSWORD_VALID_MS),
        password_reset_by: reset.resetBy,
        password_reset_at: now,
      })
      .where('id', '=', reset.accountId)
      .returning('login')
      .executeTakeFirst();
    if (changed === undefined) {
      throw new UnknownAccountError();
    }
    await this.throttle.forget(transaction, changed.login);
    await this.sessions.writeEndsByTime(transaction, reset.accountId);
    const ended = await transaction
      .updateTable('sessions')
      .set({ ended_at: now, end_reason: 'password_reset' })
      .where('account_id', '=', reset.accountId)
      .where('ended_at', 'is', null)
      .returning('id')
      .execute();
    await this.audit.record(transaction, {
      branchId: null,
      actorId: reset.resetBy,
      action: 'account.password_reset',
      record: { type: 'account', id: reset.accountId },
      details: { endedSessions: ended.length },
      ...(reset.requestId === undefined ? {} : { requestId: reset.requestId }),
    });
    return { oneTimePassword };
  }
}
