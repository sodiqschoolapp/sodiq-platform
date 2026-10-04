import { Inject, Injectable } from '@nestjs/common';
import { MAX_SUPER_ADMINS, SCHOOL_WIDE_ROLES, type Clock, type Role } from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import type { Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { Audit } from '../audit/audit.service.js';
import { UnknownAccountError } from '../auth/password-resets.service.js';
import { notEnded } from './current-assignments.js';

/** A role that needs a branch was given without one, or the other way round, or the branch does not exist. */
export class AssignmentBranchError extends Error {
  constructor() {
    super(
      'The Super Admin and the Senior Head Teacher have no branch; every other role needs a branch that exists.',
    );
  }
}

/** The account holds this role in this branch already at some moment of the new assignment. */
export class AssignmentOverlapError extends Error {
  constructor() {
    super('The account already holds this role in this branch at that time.');
  }
}

/** docs/spec/02-roles-and-access.md, Super Admin: "At most 3 accounts." */
export class TooManySuperAdminsError extends Error {
  constructor() {
    super(`At most ${String(MAX_SUPER_ADMINS)} accounts can be Super Admin.`);
  }
}

export class UnknownAssignmentError extends Error {
  constructor() {
    super('The assignment does not exist.');
  }
}

export class AssignmentAlreadyEndedError extends Error {
  constructor() {
    super('The assignment has already ended.');
  }
}

/** Edge cases, "Accounts and sign-in": nobody can remove their own Super Admin role. */
export class OwnSuperAdminRemovalError extends Error {
  constructor() {
    super('Nobody can remove their own Super Admin role.');
  }
}

export interface NewAssignment {
  accountId: string;
  role: Role;
  /** `null` for the Super Admin and the Senior Head Teacher; a branch for every other role. */
  branchId: string | null;
  /** The moment the assignment begins; now when left out. */
  validFrom?: Date;
  /** The account of the administrator who gives it; `null` for the server command. */
  givenBy: string | null;
  /** For the audit entry, for example which command acted. */
  details?: JsonValue;
  requestId?: string;
}

export interface AssignmentEnd {
  assignmentId: string;
  /** The account of the administrator who ends it. */
  endedBy: string;
  requestId?: string;
}

const EXCLUSION_VIOLATION = '23P01';

/** Any fixed number: two Super Admin assignments given at the same moment wait for each other. */
const SUPER_ADMIN_COUNT_LOCK = 60_701;

/**
 * Edge cases, "Who can act": rights are assignments: person, role, branch,
 * with dates. An assignment is given and ended, never changed or removed, so
 * history shows who held which role when.
 *
 * Until the screens of task 2.3 this service has no route: who may give which
 * role to whom, and the refusal to remove the last active Super Admin, come
 * there. The first-account command and tests call it.
 */
@Injectable()
export class Assignments {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: Audit,
  ) {}

  /**
   * Gives an account a role, from now or from `validFrom`, in the caller's
   * transaction, with its audit entry. For a role with a branch the transaction
   * must work for that branch (`Transactions.run([branchId], ...)`): the entry
   * belongs to the branch's log.
   *
   * Throws `AssignmentBranchError`, `UnknownAccountError`,
   * `TooManySuperAdminsError` and `AssignmentOverlapError`. After each of them
   * nothing is written and the caller's transaction can go on.
   */
  async give(transaction: Transaction, assignment: NewAssignment): Promise<{ id: string }> {
    const schoolWide = SCHOOL_WIDE_ROLES.includes(assignment.role);
    if (schoolWide !== (assignment.branchId === null)) {
      throw new AssignmentBranchError();
    }
    const account = await transaction
      .selectFrom('accounts')
      .select('id')
      .where('id', '=', assignment.accountId)
      .executeTakeFirst();
    if (account === undefined) {
      throw new UnknownAccountError();
    }
    if (assignment.branchId !== null) {
      const branch = await transaction
        .selectFrom('branches')
        .select('id')
        .where('id', '=', assignment.branchId)
        .executeTakeFirst();
      if (branch === undefined) {
        throw new AssignmentBranchError();
      }
    }
    const now = this.clock.now();
    const validFrom = assignment.validFrom ?? now;
    if (assignment.role === 'super_admin') {
      await this.refuseFourthSuperAdmin(transaction, assignment.accountId, now);
    }
    let inserted: { id: string };
    // The refused insert is undone alone, so the caller's transaction stays usable.
    await sql`savepoint assignment_given`.execute(transaction);
    try {
      inserted = await transaction
        .insertInto('assignments')
        .values({
          account_id: assignment.accountId,
          role: assignment.role,
          branch_id: assignment.branchId,
          valid_from: validFrom,
          created_at: now,
          given_by: assignment.givenBy,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    } catch (error) {
      // The exclusion constraint is the guard, also for two at the same moment.
      if ((error as { code?: unknown }).code === EXCLUSION_VIOLATION) {
        await sql`rollback to savepoint assignment_given`.execute(transaction);
        throw new AssignmentOverlapError();
      }
      throw error;
    }
    await sql`release savepoint assignment_given`.execute(transaction);
    await this.audit.record(transaction, {
      branchId: assignment.branchId,
      actorId: assignment.givenBy,
      action: 'assignment.given',
      record: { type: 'assignment', id: inserted.id },
      newValue: {
        accountId: assignment.accountId,
        role: assignment.role,
        branchId: assignment.branchId,
        validFrom: validFrom.toISOString(),
      },
      ...(assignment.details === undefined ? {} : { details: assignment.details }),
      ...(assignment.requestId === undefined ? {} : { requestId: assignment.requestId }),
    });
    return inserted;
  }

  /**
   * Ends an assignment now, in the caller's transaction, with its audit entry:
   * from this moment it gives no right, at the next request of the person. An
   * assignment that has not begun yet ends at its start and is never in force.
   * For a role with a branch the transaction must work for that branch.
   *
   * Throws `UnknownAssignmentError`, `AssignmentAlreadyEndedError` and
   * `OwnSuperAdminRemovalError`.
   */
  async end(transaction: Transaction, ending: AssignmentEnd): Promise<void> {
    const assignment = await transaction
      .selectFrom('assignments')
      .select(['account_id', 'role', 'branch_id', 'valid_from', 'valid_until'])
      .where('id', '=', ending.assignmentId)
      .forUpdate()
      .executeTakeFirst();
    if (assignment === undefined) {
      throw new UnknownAssignmentError();
    }
    const now = this.clock.now();
    // Ended: its end has come, or it was taken back before it began (its end
    // is its start, which can still be ahead).
    if (
      assignment.valid_until !== null &&
      (assignment.valid_until <= now || assignment.valid_until <= assignment.valid_from)
    ) {
      throw new AssignmentAlreadyEndedError();
    }
    if (assignment.role === 'super_admin' && assignment.account_id === ending.endedBy) {
      throw new OwnSuperAdminRemovalError();
    }
    const validUntil = assignment.valid_from > now ? assignment.valid_from : now;
    await transaction
      .updateTable('assignments')
      .set({ valid_until: validUntil, ended_by: ending.endedBy })
      .where('id', '=', ending.assignmentId)
      .execute();
    await this.audit.record(transaction, {
      branchId: assignment.branch_id,
      actorId: ending.endedBy,
      action: 'assignment.ended',
      record: { type: 'assignment', id: ending.assignmentId },
      oldValue: { validUntil: assignment.valid_until?.toISOString() ?? null },
      newValue: { validUntil: validUntil.toISOString() },
      details: { accountId: assignment.account_id, role: assignment.role },
      ...(ending.requestId === undefined ? {} : { requestId: ending.requestId }),
    });
  }

  /**
   * "At most 3 accounts": counts the other accounts whose Super Admin
   * assignment has not ended, those that begin later included; one that was
   * taken back before it began has ended. Under a lock, so that of two given
   * at the same moment the second one sees the first.
   */
  private async refuseFourthSuperAdmin(
    transaction: Transaction,
    accountId: string,
    now: Date,
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock(${SUPER_ADMIN_COUNT_LOCK})`.execute(transaction);
    const others = await transaction
      .selectFrom('assignments')
      .select('account_id')
      .distinct()
      .where('role', '=', 'super_admin')
      .where('account_id', '<>', accountId)
      .where(notEnded(now))
      .execute();
    if (others.length >= MAX_SUPER_ADMINS) {
      throw new TooManySuperAdminsError();
    }
  }
}
