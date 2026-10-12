import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  languageSchema,
  type Clock,
  type Language,
  type PersonName,
  type SecondStepState,
  type SessionResponse,
} from '@sodiq/shared';
import { sql, type RawBuilder } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import {
  branchChoices,
  currentAssignments,
  rolesOf,
  type CurrentAssignment,
} from '../access/current-assignments.js';
import { Audit } from '../audit/audit.service.js';
import { staffAccountBlocked } from '../people/staff-account.js';
import { idleLimitMs } from './idle-limit.js';
import { isLogin } from './login.js';
import { hashPassword, verifyPassword } from './password-hash.js';
import { SecondStepRule } from './second-step-rule.js';
import { answerOf, owesAStep } from './session-answer.js';
import {
  endByTime,
  isTrusted,
  latestEndOf,
  SESSION_MAX_LIFE_MS,
  type EndByTime,
  type SessionMoments,
} from './session-life.js';
import { deviceTokenHash, SignInThrottle } from './sign-in-throttle.service.js';

/**
 * The token in the session cookie is this many random bytes from
 * `crypto.randomBytes`, written as base64url (43 characters). It is the only
 * secret of a session; 32 bytes cannot be guessed.
 */
export const SESSION_TOKEN_BYTES = 32;

/** What the database keeps of a token: its SHA-256, so a reader of the table cannot use a session. */
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function randomToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/**
 * A first and last name answered by one of the name functions of
 * db/migrations/0027 (`own_person_name`, `reset_by_person_name`), each of
 * which answers a name only (task 2.3a, decision 9).
 */
async function personName(
  transaction: Transaction,
  call: RawBuilder<unknown>,
): Promise<PersonName | null> {
  const found = await sql<{ first_name: string | null; last_name: string | null }>`
    select first_name, last_name from ${call}
  `.execute(transaction);
  const row = found.rows[0];
  return row?.first_name == null || row.last_name == null
    ? null
    : { firstName: row.first_name, lastName: row.last_name };
}

/** The session of a request, read from the database on that request. */
export interface ActiveSession {
  sessionId: string;
  accountId: string;
  login: string;
  /**
   * Where the session stands with the second step. `pending`: nothing but the
   * second step is allowed; `set_up_required`: nothing but its set-up.
   */
  secondStep: SecondStepState;
  /** A first or reset password is in use: nothing but the password change is allowed. */
  mustChangePassword: boolean;
  /**
   * The login of the administrator who reset the password, while the reset
   * password is in use; the answer shows their name (`Sessions.answerOf`).
   */
  passwordResetBy: string | null;
  /**
   * On a trusted device: the moment the session ends, 7 days after its
   * sign-in. `null` while the session is not trusted.
   */
  trustedUntil: Date | null;
  /** The language of the account (`12`, Language). */
  language: Language;
  /**
   * The assignments of the account that are in force at this request (role and
   * branch). Read again on every request: a role that was given or ended
   * counts at the next one.
   */
  assignments: CurrentAssignment[];
}

/** A refusal of the guard for a session that still owes a step of its sign-in. */
export type OwedStep =
  'second_step_required' | 'password_change_required' | 'second_step_set_up_required';

/**
 * What a session owes, in the order of `SessionGuard`: the second step comes
 * before the forced password change, and the set-up after it.
 */
export function owedStepOf(
  secondStep: SecondStepState,
  mustChangePassword: boolean,
): OwedStep | null {
  if (secondStep === 'pending') {
    return 'second_step_required';
  }
  if (mustChangePassword) {
    return 'password_change_required';
  }
  if (secondStep === 'set_up_required') {
    return 'second_step_set_up_required';
  }
  return null;
}

/** A session as `peek` reads it: in force now, and whether it still owes a step. */
export interface PeekedSession {
  sessionId: string;
  accountId: string;
  owedStep: OwedStep | null;
}

/** The stored language. The check constraint of `accounts` allows no other value. */
function languageOf(stored: string): Language {
  return languageSchema.parse(stored);
}

export interface SignedIn {
  /** For the cookie. It is stored nowhere on the server. */
  token: string;
  /** For the device cookie: the one the browser sent, or a new one. */
  deviceToken: string;
  session: ActiveSession;
}

/** What a request that checks a password says about where it comes from. */
export interface PasswordCheckOrigin {
  /** The token of the device cookie, if the browser sent one. */
  deviceToken: string | undefined;
  requestId?: string;
}

export interface SignInOrigin extends PasswordCheckOrigin {
  /** The browser as it names itself; a label for the session list. */
  userAgent: string | undefined;
  /** The "Trust this device" switch of the sign-in page. */
  trustDevice: boolean;
}

/** One open session of an account, as the profile lists it. */
export interface ListedSession {
  id: string;
  startedAt: Date;
  lastUsedAt: Date;
  userAgent: string | null;
  current: boolean;
  /** 7 days after the sign-in, for the session of a trusted device; otherwise `null`. */
  trustedUntil: Date | null;
}

/** The session whose trust may begin, as the request found it. */
export interface TrustCandidate {
  sessionId: string;
  accountId: string;
  mustChangePassword: boolean;
}

/**
 * Sign-in, sign-out and the password change (docs/spec/13-technology.md,
 * Security: cookie sessions kept in the database, ended after a period without
 * use, or kept for 7 days on a trusted device; every session ends 7 days after
 * sign-in at the latest; sign-in attempts limited). Every one writes its audit
 * entry in the same transaction; none of them holds a password or a token.
 */
@Injectable()
export class Sessions {
  /** Hashed once: an unknown login then takes as long as a wrong password. */
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly throttle: SignInThrottle,
    private readonly secondSteps: SecondStepRule,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Opens a session. For an account with a second step it is the first of two
   * steps: the session exists, and reaches nothing but the second step until a
   * code is given (`TwoStep.pass`).
   * An unknown login and a wrong password are refused alike
   * (`sign_in_failed`), and both are counted: after five failures each further
   * attempt waits (`too_many_attempts`). A first password older than 7 days or
   * a reset password older than 24 hours is refused as `password_expired`, and
   * a locked account as `account_locked`, but only to somebody who typed the
   * password correctly.
   *
   * With "Trust this device" the session has no idle sign-out from the moment
   * it owes no step: here, when the account has no second step and needs none,
   * otherwise at the second step (`beginTrust`). A sign-in with a first or
   * reset password never becomes trusted.
   */
  async signIn(login: string, password: string, origin: SignInOrigin): Promise<SignedIn> {
    // Text that no login can be is an unknown login. It is not sent to the
    // database, which would refuse some of it (a zero byte) with a fault, and
    // it is not counted: no account can ever have it.
    const found = isLogin(login)
      ? await this.transactions.run([], async (transaction) => {
          const account = await transaction
            .selectFrom('accounts')
            .select([
              'id',
              'password_hash',
              'must_change_password',
              'password_expires_at',
              'password_reset_by',
              'locked_at',
              'language',
            ])
            .where('login', '=', login)
            .executeTakeFirst();
          const key = await this.throttle.keyOf(
            transaction,
            login,
            account?.id,
            origin.deviceToken,
          );
          return { account, key };
        })
      : undefined;
    if (found !== undefined) {
      await this.throttle.begin(found.key);
    }
    const account = found?.account;
    // Outside a transaction: the hash takes tens of milliseconds.
    const stored = account?.password_hash ?? (await this.unknownLoginHash());
    const matches = await verifyPassword(stored, password);
    if (found === undefined || account === undefined || !matches) {
      if (account !== undefined) {
        await this.recordFailedSignIn(account.id, origin.requestId);
      }
      throw new ApiException('sign_in_failed', 401);
    }
    await this.throttle.passed(found.key);
    if (account.locked_at !== null) {
      await this.recordLockedSignIn(account.id, origin.requestId);
      throw new ApiException('account_locked', 403);
    }
    const now = this.clock.now();
    // Task 2.2a: an inactive or left staff member is refused only after the
    // password matched, as a locked account is (correction 3 of the review of
    // pull request #53), and the attempt goes into the sign-in history.
    if (
      await this.transactions.run([], (transaction) =>
        staffAccountBlocked(transaction, account.id, now),
      )
    ) {
      await this.recordInactiveSignIn(account.id, origin.requestId);
      throw new ApiException('account_inactive', 403);
    }
    if (account.password_expires_at !== null && account.password_expires_at <= now) {
      throw new ApiException('password_expired', 401);
    }

    const token = randomToken();
    const deviceToken = origin.deviceToken ?? randomToken();
    const signedIn = await this.transactions.run([], async (transaction) => {
      // The row of the account is locked until the session is written: a lock
      // of the account at the same moment (`AccountLocks.lock` takes the same
      // row) comes either before this, and is seen here, or after it, and ends
      // the new session. The password may also have been changed since it was
      // checked above.
      const current = await transaction
        .selectFrom('accounts')
        .select(['password_hash', 'locked_at'])
        .where('id', '=', account.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (current.password_hash !== account.password_hash) {
        throw new ApiException('sign_in_failed', 401);
      }
      if (current.locked_at !== null) {
        return 'locked' as const;
      }
      const assignments = await currentAssignments(transaction, account.id, now);
      const secondStep = await this.secondSteps.stateOf(
        transaction,
        account.id,
        null,
        rolesOf(assignments),
      );
      const trusted =
        origin.trustDevice && secondStep === 'not_needed' && !account.must_change_password;
      const session = await transaction
        .insertInto('sessions')
        .values({
          account_id: account.id,
          token_hash: tokenHash(token),
          created_at: now,
          last_used_at: now,
          user_agent: origin.userAgent ?? null,
          trust_requested: origin.trustDevice,
          trusted_from: trusted ? now : null,
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow();
      // From now on failures from this browser have a count of their own.
      await transaction
        .insertInto('known_devices')
        .values({
          token_hash: deviceTokenHash(deviceToken),
          account_id: account.id,
          first_signed_in_at: now,
        })
        .onConflict((conflict) => conflict.columns(['token_hash', 'account_id']).doNothing())
        .execute();
      await this.audit.record(transaction, {
        branchId: null,
        actorId: account.id,
        action: 'auth.sign_in',
        record: { type: 'session', id: session.id },
        // "A sign-in with trust is recorded in the sign-in history."
        details: origin.trustDevice ? { secondStep, trustRequested: true } : { secondStep },
        ...(origin.requestId === undefined ? {} : { requestId: origin.requestId }),
      });
      if (trusted) {
        await this.recordTrustBegun(transaction, account.id, session, origin.requestId);
      }
      return {
        token,
        deviceToken,
        session: {
          sessionId: session.id,
          accountId: account.id,
          login,
          secondStep,
          mustChangePassword: account.must_change_password,
          passwordResetBy: await this.loginOf(transaction, account.password_reset_by),
          trustedUntil: trusted ? latestEndOf(session) : null,
          language: languageOf(account.language),
          assignments,
        },
      };
    });
    if (signedIn === 'locked') {
      // After the transaction: the refusal must not undo its own audit entry.
      await this.recordLockedSignIn(account.id, origin.requestId);
      throw new ApiException('account_locked', 403);
    }
    return signedIn;
  }

  /**
   * Begins the trust of a session whose sign-in asked for it, once the session
   * owes no step: called in the transaction that passes the second step or
   * confirms its set-up. Nothing begins while a first or reset password is in
   * use, nor after the trust of the session was ended. Answers the moment the
   * session ends if it is trusted now, otherwise `null`.
   */
  async beginTrust(
    transaction: Transaction,
    session: TrustCandidate,
    requestId?: string,
  ): Promise<Date | null> {
    if (!session.mustChangePassword) {
      const begun = await transaction
        .updateTable('sessions')
        .set({ trusted_from: this.clock.now() })
        .where('id', '=', session.sessionId)
        .where('trust_requested', '=', true)
        .where('trusted_from', 'is', null)
        .where('trust_ended_at', 'is', null)
        .where('ended_at', 'is', null)
        .returning(['id', 'created_at'])
        .executeTakeFirst();
      if (begun !== undefined) {
        await this.recordTrustBegun(transaction, session.accountId, begun, requestId);
      }
    }
    const found = await transaction
      .selectFrom('sessions')
      .select(['created_at', 'trusted_from', 'trust_ended_at'])
      .where('id', '=', session.sessionId)
      .executeTakeFirst();
    return found !== undefined && isTrusted(found) ? latestEndOf(found) : null;
  }

  /**
   * The session a token stands for, while it has not ended. Every call is a
   * use: it moves the moment of the last use. A session that was not used for
   * the idle limit is over, unless its device is trusted, and every session is
   * over 7 days after its sign-in, whatever its row says; the first request
   * after that writes the end down. A locked account has no session.
   *
   * The roles of the account are read once, in the transaction of the use, and
   * that one reading decides everything of this request: the idle limit of the
   * use, the end that is written down if the session is over, the second step
   * and the assignments of the answer. A session is therefore never used under
   * one limit and ended under another; a role that is given or ended while the
   * request runs counts from the next request.
   */
  async resolve(token: string): Promise<ActiveSession | undefined> {
    const now = this.clock.now();
    return this.transactions.run([], async (transaction) => {
      const owner = await transaction
        .selectFrom('sessions')
        .select('account_id')
        .where('token_hash', '=', tokenHash(token))
        .where('ended_at', 'is', null)
        .executeTakeFirst();
      if (owner === undefined) {
        return undefined;
      }
      const assignments = await currentAssignments(transaction, owner.account_id, now);
      const roles = rolesOf(assignments);
      const limit = idleLimitMs(roles);
      const use = () =>
        transaction
          .updateTable('sessions')
          // Never backwards: of two requests at the same moment the later clock stays.
          .set({ last_used_at: sql<Date>`greatest(last_used_at, ${now})` })
          .where('token_hash', '=', tokenHash(token))
          .where('ended_at', 'is', null)
          .where('created_at', '>', new Date(now.getTime() - SESSION_MAX_LIFE_MS))
          // The same rule as `endByTime`, in one statement with the use.
          .where((builder) =>
            builder.or([
              builder.and([
                builder('trusted_from', 'is not', null),
                builder('trust_ended_at', 'is', null),
              ]),
              builder('last_used_at', '>', new Date(now.getTime() - limit)),
            ]),
          )
          .returning([
            'id',
            'account_id',
            'second_step_passed_at',
            'created_at',
            'trusted_from',
            'trust_ended_at',
          ])
          .executeTakeFirst();
      let used = await use();
      if (used === undefined && (await this.endIfOver(transaction, token, now, limit))) {
        // Another request used the session in between: it is in force.
        used = await use();
      }
      if (used === undefined) {
        return undefined;
      }
      const account = await transaction
        .selectFrom('accounts')
        .select(['login', 'must_change_password', 'password_reset_by', 'locked_at', 'language'])
        .where('id', '=', used.account_id)
        .executeTakeFirstOrThrow();
      if (account.locked_at !== null) {
        // A lock ends every session; this holds also if one were still open.
        return undefined;
      }
      // An inactive or left staff member is refused on every request from the
      // date of the status, read from the stored rows (task 2.2a).
      if (await staffAccountBlocked(transaction, used.account_id, now)) {
        return undefined;
      }
      return {
        sessionId: used.id,
        accountId: used.account_id,
        login: account.login,
        secondStep: await this.secondSteps.stateOf(
          transaction,
          used.account_id,
          used.second_step_passed_at,
          roles,
        ),
        mustChangePassword: account.must_change_password,
        passwordResetBy: await this.loginOf(transaction, account.password_reset_by),
        trustedUntil: isTrusted(used) ? latestEndOf(used) : null,
        language: languageOf(account.language),
        assignments,
      };
    });
  }

  /**
   * The sessions as they stand now, without counting this as use: nothing is
   * written, `last_used_at` stays, and a session that is over is left for the
   * next request to end. For the live connection of task 0.9: a connection or
   * a reconnection of a tab is not use of the session, so an idle session
   * still ends on time (`13`, Security).
   *
   * A session is given back only when `resolve` would give it: open, not over
   * by time, its account not locked. `owedStep` says what the session still
   * owes of its sign-in, as the guard refuses it, or `null` for a complete one.
   */
  async peek(by: { token: string } | { sessionIds: readonly string[] }): Promise<PeekedSession[]> {
    const now = this.clock.now();
    return this.transactions.run([], async (transaction) => {
      let query = transaction
        .selectFrom('sessions')
        .innerJoin('accounts', 'accounts.id', 'sessions.account_id')
        .select([
          'sessions.id',
          'sessions.account_id',
          'sessions.second_step_passed_at',
          'sessions.created_at',
          'sessions.last_used_at',
          'sessions.trusted_from',
          'sessions.trust_ended_at',
          'accounts.must_change_password',
          'accounts.locked_at',
        ])
        .where('sessions.ended_at', 'is', null);
      if ('token' in by) {
        query = query.where('sessions.token_hash', '=', tokenHash(by.token));
      } else {
        if (by.sessionIds.length === 0) {
          return [];
        }
        query = query.where('sessions.id', 'in', [...by.sessionIds]);
      }
      const peeked: PeekedSession[] = [];
      for (const row of await query.execute()) {
        if (
          row.locked_at !== null ||
          (await staffAccountBlocked(transaction, row.account_id, now))
        ) {
          continue;
        }
        const assignments = await currentAssignments(transaction, row.account_id, now);
        const roles = rolesOf(assignments);
        if (endByTime(row, now, idleLimitMs(roles)) !== undefined) {
          continue;
        }
        const secondStep = await this.secondSteps.stateOf(
          transaction,
          row.account_id,
          row.second_step_passed_at,
          roles,
        );
        peeked.push({
          sessionId: row.id,
          accountId: row.account_id,
          owedStep: owedStepOf(secondStep, row.must_change_password),
        });
      }
      return peeked;
    });
  }

  /**
   * The answer of a route that says who is signed in. The branches to choose
   * from are read here, once per answer, and not with every request: they are
   * for the branch switcher only.
   */
  async answerOf(session: ActiveSession): Promise<SessionResponse> {
    return this.transactions.run([], async (transaction) => {
      // The own name only once no step is owed: before the second step the
      // password alone would read it (code round 1 of #62, finding 6). The
      // resetter is named while the change is owed, as the change page needs it.
      const owed = owesAStep(session);
      const names = {
        name: owed
          ? null
          : await personName(transaction, sql`own_person_name(${session.accountId}::uuid)`),
        resetBy:
          session.passwordResetBy === null
            ? null
            : await personName(transaction, sql`reset_by_person_name(${session.accountId}::uuid)`),
      };
      if (owed) {
        return answerOf(session, [], names);
      }
      return answerOf(session, await branchChoices(transaction, session.assignments), names);
    });
  }

  /** Ends this session; other sessions of the account stay. */
  async signOut(session: ActiveSession, requestId?: string): Promise<void> {
    await this.transactions.run([], async (transaction) => {
      const ended = await transaction
        .updateTable('sessions')
        .set({ ended_at: this.clock.now(), end_reason: 'sign_out' })
        .where('id', '=', session.sessionId)
        .where('ended_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (ended === undefined) {
        // Ended by another request in the meantime: nothing to do or to record.
        return;
      }
      await this.audit.record(transaction, {
        branchId: null,
        actorId: session.accountId,
        action: 'auth.sign_out',
        record: { type: 'session', id: session.sessionId },
        ...(requestId === undefined ? {} : { requestId }),
      });
    });
  }

  /**
   * Edge cases, "Accounts and sign-in": several sessions are allowed and the
   * profile lists them. Only sessions that are still in force, newest first.
   */
  async list(session: ActiveSession): Promise<ListedSession[]> {
    const now = this.clock.now();
    const found = await this.transactions.run([], (transaction) =>
      transaction
        .selectFrom('sessions')
        .select([
          'id',
          'created_at',
          'last_used_at',
          'user_agent',
          'trusted_from',
          'trust_ended_at',
        ])
        .where('account_id', '=', session.accountId)
        .where('ended_at', 'is', null)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute(),
    );
    const limit = idleLimitMs(rolesOf(session.assignments));
    return found
      .filter((row) => endByTime(row, now, limit) === undefined)
      .map((row) => ({
        id: row.id,
        startedAt: row.created_at,
        lastUsedAt: row.last_used_at,
        userAgent: row.user_agent,
        current: row.id === session.sessionId,
        trustedUntil: isTrusted(row) ? latestEndOf(row) : null,
      }));
  }

  /**
   * Edge cases, "Accounts and sign-in": the profile lists trusted devices. A
   * trusted device is a session in force whose trust is in force.
   */
  async trustedDevices(
    session: ActiveSession,
  ): Promise<(ListedSession & { trustedUntil: Date })[]> {
    const sessions = await this.list(session);
    return sessions.flatMap((row) =>
      row.trustedUntil === null ? [] : [{ ...row, trustedUntil: row.trustedUntil }],
    );
  }

  /**
   * "Each can be removed; removing one ends its session at once." Only a
   * trusted device of the own account: the id of anything else, also of a
   * session of another account, is answered as not found. Says whether the
   * removed device is the one that asked.
   */
  async removeTrustedDevice(
    session: ActiveSession,
    deviceId: string,
    requestId?: string,
  ): Promise<{ current: boolean }> {
    return this.transactions.run([], async (transaction) => {
      await this.writeEndsByTime(transaction, session.accountId);
      const ended = await transaction
        .updateTable('sessions')
        .set({ ended_at: this.clock.now(), end_reason: 'trusted_device_removed' })
        .where('id', '=', deviceId)
        .where('account_id', '=', session.accountId)
        .where('ended_at', 'is', null)
        .where('trusted_from', 'is not', null)
        .where('trust_ended_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (ended === undefined) {
        throw new ApiException('not_found', 404);
      }
      const current = ended.id === session.sessionId;
      await this.audit.record(transaction, {
        branchId: null,
        actorId: session.accountId,
        action: 'auth.trusted_device_removed',
        record: { type: 'session', id: ended.id },
        details: { current },
        ...(requestId === undefined ? {} : { requestId }),
      });
      return { current };
    });
  }

  /**
   * "Sign out everywhere" (edge cases, "Accounts and sign-in"): ends every
   * other session of the account and keeps the asking one (decided by the
   * owner, task 0.8d). The trust of the asking session ends with it, as at a
   * password change ("trust ends at once on 'sign out everywhere'"): from now
   * on it has the idle sign-out. Answers whether a trust that had begun ended,
   * for the cookie.
   */
  async signOutEverywhere(
    session: ActiveSession,
    requestId?: string,
  ): Promise<{ trustEnded: boolean }> {
    return this.transactions.run([], async (transaction) => {
      const now = this.clock.now();
      await this.writeEndsByTime(transaction, session.accountId);
      // The session may have ended since the guard read it: an account lock
      // or the removal of this device at the same moment. Then nothing is
      // ended or recorded in its name. The open sessions of the account are
      // locked by now, so this holds until the commit.
      const own = await transaction
        .selectFrom('sessions')
        .select('id')
        .where('id', '=', session.sessionId)
        .where('ended_at', 'is', null)
        .executeTakeFirst();
      if (own === undefined) {
        throw new ApiException('not_signed_in', 401);
      }
      const ended = await transaction
        .updateTable('sessions')
        .set({ ended_at: now, end_reason: 'sign_out_everywhere' })
        .where('account_id', '=', session.accountId)
        .where('id', '<>', session.sessionId)
        .where('ended_at', 'is', null)
        .returning('id')
        .execute();
      // Written at every call, also when no other session was open: the
      // person asked for it, and the log records it (owner's decision 6).
      await this.audit.record(transaction, {
        branchId: null,
        actorId: session.accountId,
        action: 'auth.sign_out_everywhere',
        record: { type: 'account', id: session.accountId },
        details: { endedSessions: ended.length },
        ...(requestId === undefined ? {} : { requestId }),
      });
      const trustEnded = await this.endTrust(
        transaction,
        session,
        now,
        'sign_out_everywhere',
        requestId,
      );
      return { trustEnded };
    });
  }

  /**
   * `12`, Language: each person chooses a language and the choice is
   * remembered, on the account (task 0.8d). The same language again changes
   * nothing and leaves no entry. The row is locked, so two changes at the same
   * moment record the right old value each; a lock of the account or an end
   * of the session since the guard read it (the same hole as at the password
   * change, 0.6d) is answered as not signed in, and nothing is written.
   */
  async setLanguage(session: ActiveSession, language: Language, requestId?: string): Promise<void> {
    await this.transactions.run([], async (transaction) => {
      const account = await transaction
        .selectFrom('accounts')
        .select(['language', 'locked_at'])
        .where('id', '=', session.accountId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const own = await transaction
        .selectFrom('sessions')
        .select('id')
        .where('id', '=', session.sessionId)
        .where('ended_at', 'is', null)
        .executeTakeFirst();
      if (account.locked_at !== null || own === undefined) {
        throw new ApiException('not_signed_in', 401);
      }
      if (account.language === language) {
        return;
      }
      await transaction
        .updateTable('accounts')
        .set({ language })
        .where('id', '=', session.accountId)
        .execute();
      await this.audit.record(transaction, {
        branchId: null,
        actorId: session.accountId,
        action: 'account.language_changed',
        record: { type: 'account', id: session.accountId },
        oldValue: { language: account.language },
        newValue: { language },
        ...(requestId === undefined ? {} : { requestId }),
      });
    });
  }

  /**
   * Edge cases, "Accounts and sign-in": staff change their own password with
   * the current one, also on a trusted device, and a password change ends all
   * other sessions. This session stays signed in and loses its trust ("trust
   * ends at once on a password change"): from now on it has the idle sign-out,
   * and if its trust had not begun yet, it never does. This also
   * lifts the forced change of a first or reset password. Such a password is
   * no longer valid here either once its time is over, in a session that was
   * opened in time. Wrong current passwords are counted like failed sign-ins.
   */
  async changePassword(
    session: ActiveSession,
    currentPassword: string,
    newPassword: string,
    origin: PasswordCheckOrigin,
  ): Promise<{ trustEnded: boolean }> {
    const { account, key } = await this.transactions.run([], async (transaction) => ({
      account: await transaction
        .selectFrom('accounts')
        .select(['password_hash', 'password_expires_at'])
        .where('id', '=', session.accountId)
        .executeTakeFirstOrThrow(),
      key: await this.throttle.keyOf(
        transaction,
        session.login,
        session.accountId,
        origin.deviceToken,
      ),
    }));
    await this.throttle.begin(key);
    if (!(await verifyPassword(account.password_hash, currentPassword))) {
      await this.recordFailedPasswordCheck(session, origin.requestId);
      throw new ApiException('current_password_wrong', 403);
    }
    await this.throttle.passed(key);
    if (account.password_expires_at !== null && account.password_expires_at <= this.clock.now()) {
      throw new ApiException('password_expired', 401);
    }
    if (newPassword === currentPassword) {
      throw new ApiException('password_unchanged', 400);
    }
    const newHash = await hashPassword(newPassword);

    return this.transactions.run([], async (transaction) => {
      const now = this.clock.now();
      const changed = await transaction
        .updateTable('accounts')
        .set({
          password_hash: newHash,
          must_change_password: false,
          password_expires_at: null,
          password_changed_at: now,
          password_reset_by: null,
          password_reset_at: null,
        })
        .where('id', '=', session.accountId)
        // Not if another request changed the password since it was checked above.
        .where('password_hash', '=', account.password_hash)
        .returning('id')
        .executeTakeFirst();
      if (changed === undefined) {
        throw new ApiException('current_password_wrong', 403);
      }
      await this.writeEndsByTime(transaction, session.accountId);
      // The session may have ended since the guard read it: an account lock,
      // "sign out everywhere" or the removal of this device at the same moment.
      // Then nothing is changed (found by the review). The open sessions of
      // the account are locked by now, so this holds until the commit.
      const own = await transaction
        .selectFrom('sessions')
        .select('id')
        .where('id', '=', session.sessionId)
        .where('ended_at', 'is', null)
        .executeTakeFirst();
      if (own === undefined) {
        throw new ApiException('not_signed_in', 401);
      }
      const ended = await transaction
        .updateTable('sessions')
        .set({ ended_at: now, end_reason: 'password_change' })
        .where('account_id', '=', session.accountId)
        .where('id', '<>', session.sessionId)
        .where('ended_at', 'is', null)
        .returning('id')
        .execute();
      await this.audit.record(transaction, {
        branchId: null,
        actorId: session.accountId,
        action: 'auth.password_change',
        record: { type: 'account', id: session.accountId },
        details: { endedSessions: ended.length },
        ...(origin.requestId === undefined ? {} : { requestId: origin.requestId }),
      });
      const trustEnded = await this.endTrust(
        transaction,
        session,
        now,
        'password_change',
        origin.requestId,
      );
      return { trustEnded };
    });
  }

  /**
   * Ends the trust of the asking session, which stays signed in: a password
   * change and "sign out everywhere" do this. A session that asked for trust
   * which had not begun yet never becomes trusted afterwards either. Answers
   * whether a trust that had begun was ended; only that has an end to record.
   */
  private async endTrust(
    transaction: Transaction,
    session: ActiveSession,
    now: Date,
    reason: 'password_change' | 'sign_out_everywhere',
    requestId?: string,
  ): Promise<boolean> {
    const untrusted = await transaction
      .updateTable('sessions')
      .set({ trust_ended_at: now })
      .where('id', '=', session.sessionId)
      .where('ended_at', 'is', null)
      .where('trust_requested', '=', true)
      .where('trust_ended_at', 'is', null)
      .returning('trusted_from')
      .executeTakeFirst();
    const trustEnded = untrusted !== undefined && untrusted.trusted_from !== null;
    if (trustEnded) {
      await this.audit.record(transaction, {
        branchId: null,
        actorId: session.accountId,
        action: 'auth.trust_ended',
        record: { type: 'session', id: session.sessionId },
        details: { reason },
        ...(requestId === undefined ? {} : { requestId }),
      });
    }
    return trustEnded;
  }

  /**
   * Writes down the end of every session of the account that is over by time
   * (not used for the idle limit, or 7 days old) and was not seen since, each
   * with the moment it was over and its own audit entry. Whatever ends "all
   * sessions" (sign out everywhere, a password change, a reset, an account
   * lock) calls this first, in its transaction, so that it ends and counts
   * only sessions that were still in force (found by the review). The open
   * sessions of the account stay locked, in one order, until that transaction
   * ends. The idle limit is that of the roles the account holds now, read in
   * the same transaction.
   */
  async writeEndsByTime(transaction: Transaction, accountId: string): Promise<void> {
    const now = this.clock.now();
    const limit = idleLimitMs(rolesOf(await currentAssignments(transaction, accountId, now)));
    const open = await transaction
      .selectFrom('sessions')
      .select(['id', 'created_at', 'last_used_at', 'trusted_from', 'trust_ended_at'])
      .where('account_id', '=', accountId)
      .where('ended_at', 'is', null)
      .orderBy('id')
      .forUpdate()
      .execute();
    for (const session of open) {
      const over = endByTime(session, now, limit);
      if (over !== undefined) {
        await this.writeEndByTime(transaction, accountId, session.id, over);
      }
    }
  }

  /**
   * Writes down the end of a session that is over by time. Answers `true`
   * when the session turned out to be in force after all.
   */
  private async endIfOver(
    transaction: Transaction,
    token: string,
    now: Date,
    limit: number,
  ): Promise<boolean> {
    const found = await transaction
      .selectFrom('sessions')
      .select(['id', 'account_id', 'created_at', 'last_used_at', 'trusted_from', 'trust_ended_at'])
      .where('token_hash', '=', tokenHash(token))
      .where('ended_at', 'is', null)
      .executeTakeFirst();
    if (found === undefined) {
      return false;
    }
    const over = endByTime(found, now, limit);
    // Used by another request since the update of the caller found it over: still in force.
    if (over === undefined) {
      return true;
    }
    await this.writeEndByTime(transaction, found.account_id, found.id, over, found);
    return false;
  }

  /**
   * `seen`: the moments the end was worked out from, when the row is not
   * locked: nothing is written if another request used the session since.
   */
  private async writeEndByTime(
    transaction: Transaction,
    accountId: string,
    sessionId: string,
    over: EndByTime,
    seen?: SessionMoments,
  ): Promise<void> {
    let update = transaction
      .updateTable('sessions')
      .set({ ended_at: over.at, end_reason: over.reason })
      .where('id', '=', sessionId)
      .where('ended_at', 'is', null);
    if (seen !== undefined) {
      update = update.where('last_used_at', '=', seen.last_used_at);
    }
    const ended = await update.returning('id').executeTakeFirst();
    if (ended === undefined) {
      return;
    }
    await this.audit.record(transaction, {
      branchId: null,
      actorId: accountId,
      action: over.reason === 'idle' ? 'auth.session_idle' : 'auth.session_expired',
      record: { type: 'session', id: sessionId },
      details: { endedAt: over.at.toISOString() },
    });
  }

  private async recordTrustBegun(
    transaction: Transaction,
    accountId: string,
    session: { id: string; created_at: Date },
    requestId?: string,
  ): Promise<void> {
    await this.audit.record(transaction, {
      branchId: null,
      actorId: accountId,
      action: 'auth.device_trusted',
      record: { type: 'session', id: session.id },
      details: { trustedUntil: latestEndOf(session).toISOString() },
      ...(requestId === undefined ? {} : { requestId }),
    });
  }

  /** The right password for a locked account: refused, and written down. */
  private async recordLockedSignIn(accountId: string, requestId?: string): Promise<void> {
    await this.transactions.run([], (transaction) =>
      this.audit.record(transaction, {
        branchId: null,
        // Nobody is signed in.
        actorId: null,
        action: 'auth.sign_in_locked',
        record: { type: 'account', id: accountId },
        ...(requestId === undefined ? {} : { requestId }),
      }),
    );
  }

  /** A right password of an inactive or left staff member: in the sign-in history, as a locked sign-in. */
  private async recordInactiveSignIn(accountId: string, requestId?: string): Promise<void> {
    await this.transactions.run([], (transaction) =>
      this.audit.record(transaction, {
        branchId: null,
        // Nobody is signed in.
        actorId: null,
        action: 'auth.sign_in_inactive',
        record: { type: 'account', id: accountId },
        ...(requestId === undefined ? {} : { requestId }),
      }),
    );
  }

  /**
   * A wrong current password at the password change: a password event like a
   * failed sign-in (edge cases, "Personal data and the audit log").
   */
  private async recordFailedPasswordCheck(
    session: ActiveSession,
    requestId?: string,
  ): Promise<void> {
    await this.transactions.run([], (transaction) =>
      this.audit.record(transaction, {
        branchId: null,
        actorId: session.accountId,
        action: 'auth.password_change_failed',
        record: { type: 'account', id: session.accountId },
        ...(requestId === undefined ? {} : { requestId }),
      }),
    );
  }

  /** A wrong password for a login that exists. An unknown login leaves no entry: there is nobody to name. */
  private async recordFailedSignIn(accountId: string, requestId?: string): Promise<void> {
    await this.transactions.run([], (transaction) =>
      this.audit.record(transaction, {
        branchId: null,
        // Nobody is signed in: who typed it is not known.
        actorId: null,
        action: 'auth.sign_in_failed',
        record: { type: 'account', id: accountId },
        ...(requestId === undefined ? {} : { requestId }),
      }),
    );
  }

  private async loginOf(
    transaction: Transaction,
    accountId: string | null,
  ): Promise<string | null> {
    if (accountId === null) {
      return null;
    }
    const account = await transaction
      .selectFrom('accounts')
      .select('login')
      .where('id', '=', accountId)
      .executeTakeFirstOrThrow();
    return account.login;
  }

  private unknownLoginHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomBytes(16).toString('hex')).catch((error: unknown) => {
      // Not kept: the next unknown login tries again.
      this.dummyHash = undefined;
      throw error;
    });
    return this.dummyHash;
  }
}
