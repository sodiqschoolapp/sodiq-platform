import { Injectable } from '@nestjs/common';
import type {
  AccessActions,
  AccountAccess as AccountAccessAnswer,
  ErrorCode,
  FirstPasswordSlip,
  NeverUsedList,
  Role,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import {
  keepingASuperAdmin,
  LastSuperAdminError,
  lockSuperAdmins,
} from '../access/super-admins.js';
import {
  AccountAlreadyLockedError,
  AccountLocks,
  AccountNotLockedError,
  OwnAccountLockError,
} from '../auth/account-locks.service.js';
import { OwnPasswordResetError, PasswordResets } from '../auth/password-resets.service.js';
import { OwnSecondStepResetError, SecondStepOffError, TwoStep } from '../auth/two-step.service.js';
import { actorsOf } from './actors.js';
import {
  branchOf,
  findPerson,
  leftForGood,
  neverUsedAccounts,
  readingBranches,
  type Person,
} from './staff-account-records.js';

/**
 * The roles of an account the Academic Vice Principal may lock and reset
 * (edge cases, Who can act: "He may reset passwords and lock accounts only for
 * Teachers, Tutors, Head Teachers and the Head Tutor of his branch").
 */
const VICE_REACHES: readonly Role[] = ['teacher', 'tutor', 'head_teacher', 'head_tutor'];

const NOTHING: AccessActions = {
  lock: false,
  unlock: false,
  resetPassword: false,
  resetSecondStep: false,
};

const refused = (code: ErrorCode): ApiException => new ApiException(code, 409);

const denied = (): ApiException => new ApiException('permission_denied', 403);

/** The current Super Admin assignment of the account (`.claude/rules/api.md`: from every assignment). */
const superAdminOf = (access: Access): string | undefined =>
  access.assignments.find((assignment) => assignment.role === 'super_admin')?.id;

/** A current Academic Vice Principal assignment of the account in the branch of the request. */
const viceOf = (access: Access, branchId: string): string | undefined =>
  access.assignments.find(
    (assignment) =>
      assignment.role === 'academic_vice_principal' && assignment.branchId === branchId,
  )?.id;

/** The account of a record, locked for the change, and who acts on it. */
interface Target {
  person: Person;
  accountId: string;
  /** The assignment that allows the change; the audit entries name it. */
  acting: string;
  branchId: string;
}

/**
 * The sign-in access of a staff record's account (task 2.3c-1, pull request
 * #65): lock and unlock with a reason, the password reset by an administrator
 * and the second-step reset by a Super Admin, and the report of accounts never
 * used. Edge cases, Who can act and Accounts and sign-in. The services of 0.6
 * do the work; this decides who may do it to whom.
 *
 * Every route finds the record linked to the branch of the request (404
 * otherwise). Lock order of every change: the Super Admin count, the staff
 * row, the account row (the row `Sessions.signIn` takes), then the target's
 * roles are read and the service runs. The own check comes before the role
 * check (decision 11). The transaction reads the branches `StaffAccounts`
 * reads, so "Locked by" and "Reset by" name the same actors as the account
 * section.
 */
@Injectable()
export class AccountAccess {
  constructor(
    private readonly transactions: Transactions,
    private readonly locks: AccountLocks,
    private readonly resets: PasswordResets,
    private readonly twoStep: TwoStep,
  ) {}

  /** The section "Sign-in access" of a record of the branch of the request. */
  async read(access: Access, id: string): Promise<AccountAccessAnswer> {
    const branchId = branchOf(access);
    return this.transactions.run(
      await readingBranches(this.transactions, access),
      async (transaction) => {
        const person = await findPerson(transaction, id, branchId, false);
        return this.stateOf(transaction, access, person, branchId);
      },
    );
  }

  /**
   * "Lock now" (Staff over time): ends every session at once, with a reason.
   * Refused when it would leave no active Super Admin (Accounts and sign-in;
   * decision 5), under the lock of the count.
   */
  async lock(
    access: Access,
    id: string,
    reason: string,
    requestId: string,
  ): Promise<AccountAccessAnswer> {
    return this.change(access, id, false, async (transaction, target) => {
      await keepingASuperAdmin(transaction, await transactionMoment(transaction), () =>
        this.locks.lock(transaction, {
          accountId: target.accountId,
          lockedBy: access.accountId,
          reason,
          requestId,
          actingAssignmentId: target.acting,
          personId: target.person.id,
          branchId: target.branchId,
        }),
      );
      return this.stateOf(transaction, access, target.person, target.branchId);
    });
  }

  /**
   * The unlock. An Academic Vice Principal does not undo a lock made by a
   * Super Admin (403, nothing written): the spec gives the Academic Vice
   * Principal "lock accounts", not the override of the Super Admin's lock
   * (decided with the review of #65). The Super Admin undoes any lock.
   */
  async unlock(access: Access, id: string, requestId: string): Promise<AccountAccessAnswer> {
    return this.change(access, id, false, async (transaction, target) => {
      if (
        target.acting !== superAdminOf(access) &&
        (await this.lockedBySuperAdmin(transaction, target.accountId))
      ) {
        throw denied();
      }
      await this.locks.unlock(transaction, {
        accountId: target.accountId,
        unlockedBy: access.accountId,
        requestId,
        actingAssignmentId: target.acting,
        personId: target.person.id,
        branchId: target.branchId,
      });
      return this.stateOf(transaction, access, target.person, target.branchId);
    });
  }

  /**
   * A one-time password valid for 24 hours (Accounts and sign-in); all
   * sessions end. Not for a person who has left for good (decision 7): a
   * re-hire gives its own password.
   */
  async resetPassword(access: Access, id: string, requestId: string): Promise<FirstPasswordSlip> {
    return this.change(access, id, false, async (transaction, target) => {
      await this.refuseLeft(transaction, target.person.id);
      return this.passwordSlip(transaction, access, target, requestId);
    });
  }

  /**
   * The second step of another account, by a Super Admin only (Accounts and
   * sign-in: "A Super Admin resets an Academic Vice Principal's second step;
   * another Super Admin resets a Super Admin's"), always with a password reset
   * in the same transaction (0.6d; decision 6). A confirmed second step must
   * be in force, checked under the lock of its row (`second_step_off`).
   */
  async resetSecondStep(access: Access, id: string, requestId: string): Promise<FirstPasswordSlip> {
    return this.change(access, id, true, async (transaction, target) => {
      await this.refuseLeft(transaction, target.person.id);
      await this.twoStep.resetByAdministrator(transaction, {
        accountId: target.accountId,
        resetBy: access.accountId,
        requestId,
        requireOn: true,
        actingAssignmentId: target.acting,
        personId: target.person.id,
        branchId: target.branchId,
      });
      return this.passwordSlip(transaction, access, target, requestId);
    });
  }

  /**
   * The accounts of the records linked to the branch of the request with no
   * session since the start of their person's current employment period
   * (decision 10, correction 2); not a person who has left for good. Whether
   * the first or one-time password has run out is compared with the moment of
   * the transaction.
   */
  neverUsed(access: Access): Promise<NeverUsedList> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const now = await transactionMoment(transaction);
      const rows = await transaction
        .selectFrom('staff')
        .innerJoin('staff_branches', 'staff_branches.staff_id', 'staff.id')
        .innerJoin('accounts', 'accounts.id', 'staff.account_id')
        .select([
          'staff.id',
          'staff.staff_id',
          'staff.first_name',
          'staff.last_name',
          'accounts.id as account_id',
          'accounts.login',
          'accounts.created_at',
          'accounts.password_expires_at',
          'accounts.locked_at',
          sql<boolean>`staff_out_for_good(staff.id, ${now})`.as('out'),
        ])
        .where('staff_branches.branch_id', '=', branchId)
        .where('staff.kind', '=', 'person')
        .orderBy('staff.last_name')
        .orderBy('staff.first_name')
        .orderBy('staff.id')
        .execute();
      const kept = rows.filter((row) => !row.out);
      const never = await neverUsedAccounts(
        transaction,
        kept.map((row) => ({ staffId: row.id, accountId: row.account_id })),
      );
      return {
        accounts: kept
          .filter((row) => never.has(row.account_id))
          .map((row) => ({
            staffId: row.id,
            staffNumber: row.staff_id ?? '',
            firstName: row.first_name ?? '',
            lastName: row.last_name ?? '',
            login: row.login,
            createdAt: row.created_at.toISOString(),
            passwordValidUntil: row.password_expires_at?.toISOString() ?? null,
            expired: row.password_expires_at !== null && row.password_expires_at <= now,
            locked: row.locked_at !== null,
          })),
      };
    });
  }

  /**
   * Runs a change on the account of a record: the locks in their order, the
   * refusals in theirs (404, `account_missing`, `own_account`, then who may
   * act), and maps the errors of the services to coded refusals.
   */
  private async change<T>(
    access: Access,
    id: string,
    superAdminOnly: boolean,
    work: (transaction: Transaction, target: Target) => Promise<T>,
  ): Promise<T> {
    const branchId = branchOf(access);
    return this.refusing(async () =>
      this.transactions.run(
        await readingBranches(this.transactions, access),
        async (transaction) => {
          await lockSuperAdmins(transaction);
          const person = await findPerson(transaction, id, branchId, true);
          if (person.accountId === null) {
            throw refused('account_missing');
          }
          if (person.accountId === access.accountId) {
            throw refused('own_account');
          }
          await transaction
            .selectFrom('accounts')
            .select('id')
            .where('id', '=', person.accountId)
            .forUpdate()
            .executeTakeFirstOrThrow();
          const acting = superAdminOnly
            ? (superAdminOf(access) ?? null)
            : await this.actingAssignment(transaction, access, person.accountId, branchId);
          if (acting === null) {
            throw denied();
          }
          return work(transaction, { person, accountId: person.accountId, acting, branchId });
        },
      ),
    );
  }

  /**
   * The assignment that allows the caller to lock, unlock or reset the
   * password of an account (decisions 3 and 4 of #65), or `null`: a Super
   * Admin assignment for every account; otherwise an Academic Vice Principal
   * assignment of the branch of the request when every role of the account
   * that has not ended (current or planned) is Teacher, Tutor, Head Teacher or
   * Head Tutor and at least one of them is in that branch.
   *
   * An exception to `.claude/rules/database.md` (a read of `assignments` keeps
   * to `access.branchIds`), recorded in `docs/decisions.md` (task 2.3c-1,
   * decision 3, correction 4 of the review of #65): the check reads the
   * target's roles in every branch, because one account serves every branch
   * and a lock or a reset acts on all of them; a role outside the four, in any
   * branch, stays with the Super Admin. Only the yes or no leaves the server
   * (403, or `can` false), never another branch's role, branch or assignment.
   */
  private async actingAssignment(
    transaction: Transaction,
    access: Access,
    accountId: string,
    branchId: string,
  ): Promise<string | null> {
    const superAdmin = superAdminOf(access);
    if (superAdmin !== undefined) {
      return superAdmin;
    }
    const vice = viceOf(access, branchId);
    if (vice === undefined) {
      return null;
    }
    const now = await transactionMoment(transaction);
    const roles = await transaction
      .selectFrom('assignments')
      .select(['role', 'branch_id'])
      .where('account_id', '=', accountId)
      // Not ended, and not taken back before it began.
      .where((builder) =>
        builder.or([
          builder('valid_until', 'is', null),
          builder.and([
            builder('valid_until', '>', now),
            builder('valid_until', '>', builder.ref('valid_from')),
          ]),
        ]),
      )
      .execute();
    const reached =
      roles.length > 0 &&
      roles.every((held) => VICE_REACHES.includes(held.role as Role)) &&
      roles.some((held) => held.branch_id === branchId);
    return reached ? vice : null;
  }

  /**
   * Whether the lock in force on the account was made by an account that
   * holds a Super Admin role now. The Super Admin role has no branch, so the
   * read of `assignments` keeps to the rows with no branch
   * (`.claude/rules/database.md`).
   */
  private async lockedBySuperAdmin(transaction: Transaction, accountId: string): Promise<boolean> {
    const account = await transaction
      .selectFrom('accounts')
      .select('locked_by')
      .where('id', '=', accountId)
      .executeTakeFirstOrThrow();
    if (account.locked_by === null) {
      return false;
    }
    const now = await transactionMoment(transaction);
    const held = await transaction
      .selectFrom('assignments')
      .select('id')
      .where('account_id', '=', account.locked_by)
      .where('role', '=', 'super_admin')
      .where('branch_id', 'is', null)
      .where('valid_from', '<=', now)
      .where((builder) =>
        builder.or([builder('valid_until', 'is', null), builder('valid_until', '>', now)]),
      )
      .executeTakeFirst();
    return held !== undefined;
  }

  /** The password reset of the target, as a slip: the one-time password is stored nowhere. */
  private async passwordSlip(
    transaction: Transaction,
    access: Access,
    target: Target,
    requestId: string,
  ): Promise<FirstPasswordSlip> {
    const reset = await this.resets.byAdministrator(transaction, {
      accountId: target.accountId,
      resetBy: access.accountId,
      requestId,
      actingAssignmentId: target.acting,
      personId: target.person.id,
      branchId: target.branchId,
    });
    const account = await transaction
      .selectFrom('accounts')
      .select('login')
      .where('id', '=', target.accountId)
      .executeTakeFirstOrThrow();
    return {
      firstName: target.person.firstName,
      lastName: target.person.lastName,
      login: account.login,
      password: reset.oneTimePassword,
      validUntil: reset.validUntil.toISOString(),
    };
  }

  private async refuseLeft(transaction: Transaction, staffId: string): Promise<void> {
    if (await leftForGood(transaction, staffId)) {
      throw refused('staff_left');
    }
  }

  /** The section as the reader sees it now, with what the reader may do. */
  private async stateOf(
    transaction: Transaction,
    access: Access,
    person: Person,
    branchId: string,
  ): Promise<AccountAccessAnswer> {
    if (person.accountId === null) {
      return { account: null, can: NOTHING };
    }
    const accountId = person.accountId;
    const account = await transaction
      .selectFrom('accounts')
      .select([
        'login',
        'locked_at',
        'locked_by',
        'lock_reason',
        'password_reset_at',
        'password_reset_by',
        'password_expires_at',
      ])
      .where('id', '=', accountId)
      .executeTakeFirstOrThrow();
    const secondStep = await transaction
      .selectFrom('account_second_steps')
      .select('confirmed_at')
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    const secondStepOn = secondStep !== undefined && secondStep.confirmed_at !== null;
    const neverUsed = (
      await neverUsedAccounts(transaction, [{ staffId: person.id, accountId }])
    ).has(accountId);
    const actors = await actorsOf(transaction, [account.locked_by, account.password_reset_by]);
    const own = accountId === access.accountId;
    const acting = own
      ? null
      : await this.actingAssignment(transaction, access, accountId, branchId);
    const left = await leftForGood(transaction, person.id);
    const locked = account.locked_at !== null;
    return {
      account: {
        login: account.login,
        locked:
          account.locked_at === null
            ? null
            : {
                at: account.locked_at.toISOString(),
                by: account.locked_by === null ? null : (actors.get(account.locked_by) ?? null),
                reason: account.lock_reason ?? '',
              },
        passwordReset:
          account.password_reset_at === null || account.password_expires_at === null
            ? null
            : {
                at: account.password_reset_at.toISOString(),
                by:
                  account.password_reset_by === null
                    ? null
                    : (actors.get(account.password_reset_by) ?? null),
                validUntil: account.password_expires_at.toISOString(),
              },
        neverUsed,
        secondStepOn,
      },
      can: {
        lock: acting !== null && !locked,
        unlock:
          acting !== null &&
          locked &&
          (acting === superAdminOf(access) ||
            !(await this.lockedBySuperAdmin(transaction, accountId))),
        resetPassword: acting !== null && !left,
        resetSecondStep: !own && superAdminOf(access) !== undefined && secondStepOn && !left,
      },
    };
  }

  /** The errors of the services of 0.6 and the last Super Admin rule as coded refusals. */
  private async refusing<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof OwnAccountLockError ||
        error instanceof OwnPasswordResetError ||
        error instanceof OwnSecondStepResetError
      ) {
        throw refused('own_account');
      }
      if (error instanceof AccountAlreadyLockedError) {
        throw refused('account_already_locked');
      }
      if (error instanceof AccountNotLockedError) {
        throw refused('account_not_locked');
      }
      if (error instanceof SecondStepOffError) {
        throw refused('second_step_off');
      }
      if (error instanceof LastSuperAdminError) {
        throw refused('last_super_admin');
      }
      throw error;
    }
  }
}
