import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { rolesOf } from '../access/current-assignments.js';
import { Audit } from '../audit/audit.service.js';
import { FIRST_PASSWORD_LENGTH, randomFirstPassword } from './accounts.service.js';
import { UnknownAccountError } from './password-resets.service.js';
import { SecondStepRule } from './second-step-rule.js';
import { SecondStepSecrets } from './second-step-secrets.js';
import { Sessions, type ActiveSession } from './sessions.service.js';
import { delayAfterMs, FORGET_AFTER_MS } from './sign-in-throttle.service.js';
import {
  base32,
  looksLikeTotpCode,
  matchingTotpStep,
  otpauthAddress,
  TOTP_SECRET_BYTES,
} from './totp.js';

/** Edge cases, "Accounts and sign-in": ten single-use recovery codes shown at set-up. */
export const RECOVERY_CODES = 10;

/** A recovery code has the length and the alphabet of a first password, shown in groups of four. */
const RECOVERY_CODE_LENGTH = FIRST_PASSWORD_LENGTH;
const RECOVERY_CODE = new RegExp(`^[a-zA-Z0-9]{${String(RECOVERY_CODE_LENGTH)}}$`);

function recoveryCodeHash(code: string): Buffer {
  return createHash('sha256').update(code).digest();
}

/** As a person reads it: `abcd-efgh-jkmn-pqrs`. */
function inGroups(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

/** What was typed, without the spaces and hyphens that only help the eye. */
function typedCode(text: string): string {
  return text.replace(/[\s-]/g, '');
}

/**
 * A Super Admin's own second step is reset by another Super Admin (edge cases,
 * "Accounts and sign-in"); nobody resets their own.
 */
export class OwnSecondStepResetError extends Error {
  constructor() {
    super('An administrator cannot reset their own second step.');
  }
}

export interface SecondStepReset {
  /** The account whose second step is reset. */
  accountId: string;
  /** The account of the administrator who resets it. */
  resetBy: string;
  requestId?: string;
}

/** What the authenticator app needs. Shown once and stored only encrypted. */
export interface StartedSetUp {
  secret: string;
  address: string;
}

/** A set-up that was confirmed: the recovery codes, shown once. */
export interface ConfirmedSetUp {
  recoveryCodes: string[];
  /** The moment the session ends if its device is trusted now, otherwise `null`. */
  trustedUntil: Date | null;
}

export interface SecondStepOverviewOf {
  on: boolean;
  required: boolean;
  recoveryCodesLeft: number;
}

/** The row of a second step, held for the length of one check. */
interface SecondStepRow {
  secret: string;
  confirmed_at: Date | null;
  last_used_step: number | null;
  failures: number;
  last_failure_at: Date | null;
  blocked_until: Date | null;
}

/** How a code turned out. Decided inside the transaction, answered after it. */
type Checked =
  | { outcome: 'right'; with: 'code' | 'recovery_code' }
  | { outcome: 'wrong' }
  | { outcome: 'wait'; seconds: number }
  | { outcome: 'unreadable' }
  | { outcome: 'not_on' };

/**
 * The second step of sign-in (edge cases, "Accounts and sign-in"): a code from
 * an authenticator app, with ten single-use recovery codes shown at set-up.
 *
 * Wrong codes are counted per account, with the lengths of the password limit
 * (five answered as wrong, then a wait of 30 seconds that doubles up to 15
 * minutes; forgotten 24 hours after the last one or at a right code). It is a
 * count of its own: the password count starts again at every right password,
 * so somebody who has the password could otherwise guess codes without end.
 * The row of the account is locked for each check, so attempts at the same
 * moment stand in a line and a recovery code cannot be used twice.
 */
@Injectable()
export class TwoStep {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly rule: SecondStepRule,
    private readonly secrets: SecondStepSecrets,
    private readonly sessions: Sessions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The second step of the own account, for the profile. */
  overview(session: ActiveSession): Promise<SecondStepOverviewOf> {
    return this.transactions.run([], async (transaction) => {
      const secondStep = await transaction
        .selectFrom('account_second_steps')
        .select('confirmed_at')
        .where('account_id', '=', session.accountId)
        .executeTakeFirst();
      const on = secondStep !== undefined && secondStep.confirmed_at !== null;
      const left = on
        ? await transaction
            .selectFrom('second_step_recovery_codes')
            .select((builder) => builder.fn.countAll<string>().as('codes'))
            .where('account_id', '=', session.accountId)
            .where('used_at', 'is', null)
            .executeTakeFirstOrThrow()
        : { codes: '0' };
      return {
        on,
        required: this.rule.required(rolesOf(session.assignments)),
        recoveryCodesLeft: Number(left.codes),
      };
    });
  }

  /**
   * Starts a set-up: a new random secret, stored encrypted and answered once.
   * Nothing is in force until `confirm`. A set-up that was started before and
   * never confirmed is replaced.
   */
  begin(session: ActiveSession, requestId?: string): Promise<StartedSetUp> {
    return this.transactions.run([], async (transaction) => {
      const existing = await this.lockedRow(transaction, session.accountId);
      if (existing !== undefined && existing.confirmed_at !== null) {
        throw new ApiException('second_step_already_on', 409);
      }
      const secret = randomBytes(TOTP_SECRET_BYTES);
      const fresh = {
        secret: this.secrets.seal(session.accountId, secret),
        created_at: this.clock.now(),
        confirmed_at: null,
        last_used_step: null,
        failures: 0,
        last_failure_at: null,
        blocked_until: null,
      };
      // Never over a second step in force: when no row was there to lock above,
      // another session of the account may have set one up and confirmed it in
      // between (found by the review).
      const written = await transaction
        .insertInto('account_second_steps')
        .values({ account_id: session.accountId, ...fresh })
        .onConflict((conflict) =>
          conflict
            .column('account_id')
            .doUpdateSet(fresh)
            .where('account_second_steps.confirmed_at', 'is', null),
        )
        .returning('account_id')
        .executeTakeFirst();
      if (written === undefined) {
        throw new ApiException('second_step_already_on', 409);
      }
      await this.audit.record(transaction, {
        branchId: null,
        actorId: session.accountId,
        action: 'account.second_step_started',
        record: { type: 'account', id: session.accountId },
        ...(requestId === undefined ? {} : { requestId }),
      });
      return { secret: base32(secret), address: otpauthAddress(session.login, secret) };
    });
  }

  /**
   * The first right code puts the second step in force, marks this session as
   * having passed it, and answers the ten recovery codes, once. A wrong code
   * here is not counted: whoever may confirm was just shown the secret. With
   * "Trust this device" the trust of the session begins here; `trustedUntil`
   * is the moment a trusted session ends, or `null`.
   */
  async confirm(session: ActiveSession, code: string, requestId?: string): Promise<ConfirmedSetUp> {
    const confirmed = await this.transactions.run([], async (transaction) => {
      const row = await this.lockedRow(transaction, session.accountId);
      if (row === undefined) {
        return 'not_on' as const;
      }
      if (row.confirmed_at !== null) {
        return 'already_on' as const;
      }
      const secret = this.secrets.open(session.accountId, row.secret);
      if (secret === undefined) {
        // A started set-up that cannot be read is no set-up: the person starts again.
        await this.removeUnreadable(transaction, session, requestId);
        return 'not_on' as const;
      }
      const now = this.clock.now();
      const step = matchingTotpStep(secret, typedCode(code), now);
      if (step === undefined) {
        return 'wrong' as const;
      }
      await transaction
        .updateTable('account_second_steps')
        .set({ confirmed_at: now, last_used_step: step })
        .where('account_id', '=', session.accountId)
        .execute();
      const recoveryCodes = Array.from({ length: RECOVERY_CODES }, () => randomFirstPassword());
      await transaction
        .deleteFrom('second_step_recovery_codes')
        .where('account_id', '=', session.accountId)
        .execute();
      await transaction
        .insertInto('second_step_recovery_codes')
        .values(
          recoveryCodes.map((recoveryCode) => ({
            account_id: session.accountId,
            code_hash: recoveryCodeHash(recoveryCode).toString('hex'),
          })),
        )
        .execute();
      const trustedUntil = await this.markPassed(transaction, session, now, requestId);
      await this.audit.record(transaction, {
        branchId: null,
        actorId: session.accountId,
        action: 'account.second_step_on',
        record: { type: 'account', id: session.accountId },
        ...(requestId === undefined ? {} : { requestId }),
      });
      return { recoveryCodes: recoveryCodes.map(inGroups), trustedUntil };
    });
    switch (confirmed) {
      case 'not_on':
        throw new ApiException('second_step_not_on', 409);
      case 'already_on':
        throw new ApiException('second_step_already_on', 409);
      case 'wrong':
        throw new ApiException('second_step_code_wrong', 403);
      default:
        return confirmed;
    }
  }

  /**
   * The second step of a sign-in: a code from the app or a recovery code opens
   * the session that the password started. With "Trust this device" the trust
   * of the session begins here; the answer is the moment a trusted session
   * ends, or `null`.
   */
  async pass(session: ActiveSession, code: string, requestId?: string): Promise<Date | null> {
    const { checked, trustedUntil } = await this.transactions.run([], async (transaction) => {
      const result = await this.check(transaction, session, code, requestId);
      let until: Date | null = null;
      if (result.outcome === 'right') {
        until = await this.markPassed(transaction, session, this.clock.now(), requestId);
        await this.audit.record(transaction, {
          branchId: null,
          actorId: session.accountId,
          action: 'auth.second_step_passed',
          record: { type: 'session', id: session.sessionId },
          details: { with: result.with },
          ...(requestId === undefined ? {} : { requestId }),
        });
      }
      return { checked: result, trustedUntil: until };
    });
    this.refuseUnlessRight(checked);
    return trustedUntil;
  }

  /**
   * Turns the second step off, with a right code, where it is optional
   * (docs/spec/02-roles-and-access.md, Rules: "optional for others").
   */
  async turnOff(session: ActiveSession, code: string, requestId?: string): Promise<void> {
    // By the roles of this request: the guard read them a moment ago.
    if (this.rule.required(rolesOf(session.assignments))) {
      throw new ApiException('second_step_cannot_turn_off', 403);
    }
    const checked = await this.transactions.run([], async (transaction) => {
      const result = await this.check(transaction, session, code, requestId);
      if (result.outcome === 'right') {
        await this.remove(transaction, session.accountId);
        await this.audit.record(transaction, {
          branchId: null,
          actorId: session.accountId,
          action: 'account.second_step_off',
          record: { type: 'account', id: session.accountId },
          ...(requestId === undefined ? {} : { requestId }),
        });
      }
      return result;
    });
    this.refuseUnlessRight(checked);
  }

  /**
   * Edge cases, "Accounts and sign-in": a Super Admin resets an Academic Vice
   * Principal's second step; another Super Admin resets a Super Admin's. The
   * second step and its recovery codes are removed; where it is required, the
   * person sets it up again before anything else.
   *
   * Until the screens of task 2.3 this has no route: who may reset whom is
   * checked there. Only tests call it.
   */
  async resetByAdministrator(transaction: Transaction, reset: SecondStepReset): Promise<void> {
    if (reset.resetBy === reset.accountId) {
      throw new OwnSecondStepResetError();
    }
    const account = await transaction
      .selectFrom('accounts')
      .select('id')
      .where('id', '=', reset.accountId)
      .executeTakeFirst();
    if (account === undefined) {
      throw new UnknownAccountError();
    }
    const row = await this.lockedRow(transaction, reset.accountId);
    await this.remove(transaction, reset.accountId);
    await this.audit.record(transaction, {
      branchId: null,
      actorId: reset.resetBy,
      action: 'account.second_step_reset',
      record: { type: 'account', id: reset.accountId },
      details: { wasOn: row !== undefined && row.confirmed_at !== null },
      ...(reset.requestId === undefined ? {} : { requestId: reset.requestId }),
    });
  }

  private refuseUnlessRight(checked: Checked): void {
    switch (checked.outcome) {
      case 'right':
        return;
      case 'wait':
        throw new ApiException('too_many_attempts', 429, checked.seconds);
      case 'wrong':
        throw new ApiException('second_step_code_wrong', 403);
      case 'unreadable':
        throw new ApiException('second_step_set_up_required', 403);
      case 'not_on':
        throw new ApiException('second_step_not_on', 409);
    }
  }

  /**
   * Looks at a code for the second step that is in force, under the lock of
   * its row. Whatever it finds is written in this transaction, which the
   * caller commits before it answers: a wrong code is counted and logged
   * although the request is refused.
   */
  private async check(
    transaction: Transaction,
    session: ActiveSession,
    code: string,
    requestId?: string,
  ): Promise<Checked> {
    const row = await this.lockedRow(transaction, session.accountId);
    if (row === undefined || row.confirmed_at === null) {
      return { outcome: 'not_on' };
    }
    const now = this.clock.now();
    if (row.blocked_until !== null && row.blocked_until > now) {
      // Not counted and not looked at, as with passwords.
      return {
        outcome: 'wait',
        seconds: Math.ceil((row.blocked_until.getTime() - now.getTime()) / 1000),
      };
    }
    const typed = typedCode(code);
    const right = looksLikeTotpCode(typed)
      ? await this.checkAppCode(transaction, session, row, typed, now, requestId)
      : await this.checkRecoveryCode(transaction, session, typed, now, requestId);
    if (right === 'unreadable') {
      return { outcome: 'unreadable' };
    }
    if (right !== undefined) {
      await transaction
        .updateTable('account_second_steps')
        .set({ failures: 0, last_failure_at: null, blocked_until: null })
        .where('account_id', '=', session.accountId)
        .execute();
      return { outcome: 'right', with: right };
    }
    const forgotten =
      row.last_failure_at === null ||
      row.last_failure_at.getTime() + FORGET_AFTER_MS <= now.getTime();
    const failures = (forgotten ? 0 : row.failures) + 1;
    const delay = delayAfterMs(failures);
    await transaction
      .updateTable('account_second_steps')
      .set({
        failures,
        last_failure_at: now,
        blocked_until: delay === 0 ? null : new Date(now.getTime() + delay),
      })
      .where('account_id', '=', session.accountId)
      .execute();
    await this.audit.record(transaction, {
      branchId: null,
      actorId: session.accountId,
      action: 'auth.second_step_failed',
      record: { type: 'session', id: session.sessionId },
      ...(requestId === undefined ? {} : { requestId }),
    });
    return { outcome: 'wrong' };
  }

  /** Six digits from the app: right when it is the code of a step that was not used yet. */
  private async checkAppCode(
    transaction: Transaction,
    session: ActiveSession,
    row: SecondStepRow,
    typed: string,
    now: Date,
    requestId?: string,
  ): Promise<'code' | 'unreadable' | undefined> {
    const secret = this.secrets.open(session.accountId, row.secret);
    if (secret === undefined) {
      // Decided by the owner: a secret that cannot be decrypted is never a
      // fault of the server. The second step is gone and must be set up again.
      await this.removeUnreadable(transaction, session, requestId);
      return 'unreadable';
    }
    const step = matchingTotpStep(secret, typed, now);
    // A code is accepted once, and no code of an earlier step after it.
    if (step === undefined || (row.last_used_step !== null && step <= row.last_used_step)) {
      return undefined;
    }
    await transaction
      .updateTable('account_second_steps')
      .set({ last_used_step: step })
      .where('account_id', '=', session.accountId)
      .execute();
    return 'code';
  }

  /** A recovery code: right once. Every unused code is compared, each in constant time. */
  private async checkRecoveryCode(
    transaction: Transaction,
    session: ActiveSession,
    typed: string,
    now: Date,
    requestId?: string,
  ): Promise<'recovery_code' | undefined> {
    if (!RECOVERY_CODE.test(typed)) {
      return undefined;
    }
    const hash = recoveryCodeHash(typed);
    const unused = await transaction
      .selectFrom('second_step_recovery_codes')
      .select('code_hash')
      .where('account_id', '=', session.accountId)
      .where('used_at', 'is', null)
      .execute();
    let found: string | undefined;
    for (const candidate of unused) {
      if (timingSafeEqual(Buffer.from(candidate.code_hash, 'hex'), hash)) {
        found = candidate.code_hash;
      }
    }
    if (found === undefined) {
      return undefined;
    }
    await transaction
      .updateTable('second_step_recovery_codes')
      .set({ used_at: now })
      .where('account_id', '=', session.accountId)
      .where('code_hash', '=', found)
      .execute();
    await this.audit.record(transaction, {
      branchId: null,
      actorId: session.accountId,
      action: 'auth.recovery_code_used',
      record: { type: 'account', id: session.accountId },
      details: { left: unused.length - 1 },
      ...(requestId === undefined ? {} : { requestId }),
    });
    return 'recovery_code';
  }

  /** The row of the account's second step, locked until the transaction ends. */
  private lockedRow(
    transaction: Transaction,
    accountId: string,
  ): Promise<SecondStepRow | undefined> {
    return transaction
      .selectFrom('account_second_steps')
      .select([
        'secret',
        'confirmed_at',
        'last_used_step',
        'failures',
        'last_failure_at',
        'blocked_until',
      ])
      .where('account_id', '=', accountId)
      .forUpdate()
      .executeTakeFirst();
  }

  /** Removes a second step whose secret cannot be decrypted, and says so in the log. */
  private async removeUnreadable(
    transaction: Transaction,
    session: ActiveSession,
    requestId?: string,
  ): Promise<void> {
    await this.remove(transaction, session.accountId);
    await this.audit.record(transaction, {
      branchId: null,
      actorId: session.accountId,
      action: 'account.second_step_unreadable',
      record: { type: 'account', id: session.accountId },
      ...(requestId === undefined ? {} : { requestId }),
    });
  }

  /**
   * Removes the second step of an account with its recovery codes. No session
   * of the account has passed anything afterwards: a later second step is owed
   * by each of them, whatever the clock says (found by the review).
   */
  private async remove(transaction: Transaction, accountId: string): Promise<void> {
    // The open sessions in the order `Sessions.writeEndsByTime` locks them, so
    // that this and whatever ends all sessions of the account cannot wait for
    // each other in a circle (found by the review).
    await transaction
      .selectFrom('sessions')
      .select('id')
      .where('account_id', '=', accountId)
      .where('ended_at', 'is', null)
      .orderBy('id')
      .forUpdate()
      .execute();
    await transaction
      .updateTable('sessions')
      .set({ second_step_passed_at: null })
      .where('account_id', '=', accountId)
      .where('second_step_passed_at', 'is not', null)
      .execute();
    await transaction
      .deleteFrom('second_step_recovery_codes')
      .where('account_id', '=', accountId)
      .execute();
    await transaction
      .deleteFrom('account_second_steps')
      .where('account_id', '=', accountId)
      .execute();
  }

  /**
   * The session owes the second step no more. The trust its sign-in asked for
   * begins with this and never before it; answers the moment a trusted session
   * ends, or `null`.
   */
  private async markPassed(
    transaction: Transaction,
    session: ActiveSession,
    now: Date,
    requestId?: string,
  ): Promise<Date | null> {
    await transaction
      .updateTable('sessions')
      .set({ second_step_passed_at: now })
      .where('id', '=', session.sessionId)
      .where('ended_at', 'is', null)
      .execute();
    return this.sessions.beginTrust(transaction, session, requestId);
  }
}
