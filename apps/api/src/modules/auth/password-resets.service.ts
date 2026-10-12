import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import type { Transaction } from '../../database/transactions.js';
import { Audit } from '../audit/audit.service.js';
import { FIRST_PASSWORD_VALID_MS, randomFirstPassword } from './accounts.service.js';
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

/**
 * What an audit entry of a change by an administrator names besides the actor
 * (task 2.3c-1, decision 8): the assignment that allowed it, the person and the
 * branch of the request. Left out, the entry goes to the school's log with no
 * assignment, as in 0.6.
 */
export interface AuditNames {
  actingAssignmentId?: string;
  personId?: string;
  branchId?: string;
}

/** The fields of an audit entry from `AuditNames`. */
export function auditOf(names: AuditNames): {
  branchId: string | null;
  assignmentId?: string;
  personId?: string;
} {
  return {
    branchId: names.branchId ?? null,
    ...(names.actingAssignmentId === undefined ? {} : { assignmentId: names.actingAssignmentId }),
    ...(names.personId === undefined ? {} : { personId: names.personId }),
  };
}

export interface PasswordReset extends AuditNames {
  /** The account whose password is reset. */
  accountId: string;
  /** The account of the administrator who resets it. */
  resetBy: string;
  requestId?: string;
}

export interface RehirePassword {
  /** The account of the person hired again. */
  accountId: string;
  /** The account of the Super Admin who changed the status. */
  by: string;
  /** 00:00 of the re-hire date: the password is valid for 7 days from it, or from now when that is later. */
  validFrom: Date;
  /** For the audit entry. */
  actingAssignmentId: string;
  personId: string;
  requestId: string;
}

export interface FirstPassword {
  /** Shown once to the administrator and stored nowhere. */
  password: string;
  validUntil: Date;
}

export interface ResetPassword {
  /** Shown once to the administrator and stored nowhere. */
  oneTimePassword: string;
  /** The one-time password works until this moment (24 hours). */
  validUntil: Date;
}

/**
 * Password reset by an administrator (edge cases, "Accounts and sign-in"). The
 * person gets a one-time password that is valid for 24 hours and must be
 * changed before anything else; all sessions end; the log says "reset by X for
 * Y"; the session answer names X until the password is changed. The count of
 * failed sign-ins of the login starts again, so the person need not wait.
 *
 * The reset by an administrator has its route since task 2.3c-1
 * (`AccountAccess`, which decides who may reset whom); the re-hire of task
 * 2.3a calls `forRehire`.
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
    const validUntil = new Date(now.getTime() + RESET_PASSWORD_VALID_MS);

    const changed = await transaction
      .updateTable('accounts')
      .set({
        password_hash: passwordHash,
        // Together, as the check constraint of `accounts` demands.
        must_change_password: true,
        password_expires_at: validUntil,
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
      actorId: reset.resetBy,
      ...auditOf(reset),
      action: 'account.password_reset',
      record: { type: 'account', id: reset.accountId },
      details: { endedSessions: ended.length },
      ...(reset.requestId === undefined ? {} : { requestId: reset.requestId }),
    });
    return { oneTimePassword, validUntil };
  }

  /**
   * A re-hire "restores the same record, staff ID and login with a new
   * employment period and a forced password change" (edge cases, Staff over
   * time; task 2.3a, decision 7): a new first password, valid for 7 days from
   * the later of now and the re-hire date, changed at the first sign-in. Open
   * sessions end and the failed sign-ins of the login are forgotten. The audit
   * entry holds no password (correction 4 of the review of pull request #62).
   */
  async forRehire(transaction: Transaction, rehire: RehirePassword): Promise<FirstPassword> {
    const password = randomFirstPassword();
    const passwordHash = await hashPassword(password);
    const now = this.clock.now();
    const start = rehire.validFrom > now ? rehire.validFrom : now;
    const validUntil = new Date(start.getTime() + FIRST_PASSWORD_VALID_MS);
    const changed = await transaction
      .updateTable('accounts')
      .set({
        password_hash: passwordHash,
        must_change_password: true,
        password_expires_at: validUntil,
        password_reset_by: null,
        password_reset_at: null,
      })
      .where('id', '=', rehire.accountId)
      .returning('login')
      .executeTakeFirst();
    if (changed === undefined) {
      throw new UnknownAccountError();
    }
    await this.throttle.forget(transaction, changed.login);
    await this.sessions.writeEndsByTime(transaction, rehire.accountId);
    const ended = await transaction
      .updateTable('sessions')
      .set({ ended_at: now, end_reason: 'password_reset' })
      .where('account_id', '=', rehire.accountId)
      .where('ended_at', 'is', null)
      .returning('id')
      .execute();
    await this.audit.record(transaction, {
      branchId: null,
      actorId: rehire.by,
      assignmentId: rehire.actingAssignmentId,
      personId: rehire.personId,
      action: 'account.rehire_password',
      record: { type: 'account', id: rehire.accountId },
      newValue: { passwordValidUntil: validUntil.toISOString() },
      details: { endedSessions: ended.length },
      requestId: rehire.requestId,
    });
    return { password, validUntil };
  }
}
