import { Injectable } from '@nestjs/common';
import { isAppointment, MAX_SUPER_ADMINS, SCHOOL_WIDE_ROLES, type Role } from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { Audit } from '../audit/audit.service.js';
import { followTutorEnds, trackingTutorEnds } from '../classes/class-tutor-rows.js';
import { auditOf, followChanged } from '../timetable/tutor-lessons.js';
import { UnknownAccountError } from '../auth/password-resets.service.js';
import { insertAppointmentSubjects } from './appointment-subjects.js';
import { notEnded } from './current-assignments.js';
import { lockSuperAdmins } from './super-admins.js';

const EXCLUSION_VIOLATION = '23P01';

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

/**
 * A subject of the appointment has another Head Teacher in the branch, or
 * another Senior Head Teacher, at some moment of it (`02`, One per subject
 * per branch; db/migrations/0028). `subjectIds` names them when they are
 * known.
 */
export class HeadTeacherTakenError extends Error {
  constructor(readonly subjectIds: readonly string[] = []) {
    super('A subject of the appointment has another holder at that time.');
  }
}

/** A subject of the appointment does not exist or is archived (task 2.3b-1, decision 12). */
export class SubjectUnknownError extends Error {
  constructor() {
    super('A subject of the appointment does not exist or is archived.');
  }
}

/** The exclusion constraints of one holder per subject (db/migrations/0028). */
export const HOLDER_CONSTRAINTS: readonly string[] = [
  'assignment_subjects_one_head_teacher',
  'assignment_subjects_one_senior',
];

/** Whether an error is a refusal of one holder per subject. */
export const isHolderClash = (error: unknown): boolean => {
  const failure = error as { code?: unknown; constraint?: unknown };
  return (
    failure.code === EXCLUSION_VIOLATION &&
    typeof failure.constraint === 'string' &&
    HOLDER_CONSTRAINTS.includes(failure.constraint)
  );
};

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
  /** For the audit entry: the assignment that allowed the administrator to act (task 2.3a). */
  actingAssignmentId?: string;
  /** For the audit entry: the staff record of the person (task 2.3a). */
  personId?: string;
  /** The subjects of a Head Teacher or Senior Head Teacher appointment, and only of those (task 2.3b-1). */
  subjectIds?: readonly string[];
}

export interface AssignmentEnd {
  assignmentId: string;
  /** The account of the administrator who ends it. */
  endedBy: string;
  /**
   * The moment it ends; now when left out. A moment ahead ends it then, and
   * may be moved while it is still ahead (0.7a; task 2.3a).
   */
  at?: Date;
  requestId?: string;
  /** For the audit entry: the assignment that allowed the administrator to act (task 2.3a). */
  actingAssignmentId?: string;
  /** For the audit entry: the staff record of the person (task 2.3a). */
  personId?: string;
}

/**
 * Edge cases, "Who can act": rights are assignments: person, role, branch,
 * with dates. An assignment is given and ended, never changed or removed, so
 * history shows who held which role when.
 *
 * The routes of the account section call it (task 2.3a, `StaffAccounts`),
 * and the first-account command.
 */
@Injectable()
export class Assignments {
  constructor(private readonly audit: Audit) {}

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
    const subjectIds = [
      ...new Set((assignment.subjectIds ?? []).map((id) => id.toLowerCase())),
    ].sort();
    if (isAppointment(assignment.role) !== subjectIds.length > 0) {
      // The shared schema refuses it first; the database refuses it at commit.
      throw new Error(
        'A Head Teacher and a Senior Head Teacher are given with subjects; no other role is.',
      );
    }
    if (subjectIds.length > 0) {
      await this.refuseUnknownSubjects(transaction, subjectIds);
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
    // The moment the end trigger compares with (code round 1 of #62, finding 5).
    const now = await transactionMoment(transaction);
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
      if (subjectIds.length > 0) {
        await insertAppointmentSubjects(transaction, inserted.id, subjectIds);
      }
    } catch (error) {
      // The exclusion constraints are the guard, also for two at the same moment.
      if (isHolderClash(error)) {
        await sql`rollback to savepoint assignment_given`.execute(transaction);
        throw new HeadTeacherTakenError(
          await this.takenSubjects(transaction, assignment, subjectIds, validFrom),
        );
      }
      if ((error as { code?: unknown }).code === EXCLUSION_VIOLATION) {
        await sql`rollback to savepoint assignment_given`.execute(transaction);
        throw new AssignmentOverlapError();
      }
      if ((error as { constraint?: unknown }).constraint === 'assignment_subjects_archived') {
        await sql`rollback to savepoint assignment_given`.execute(transaction);
        throw new SubjectUnknownError();
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
        ...(subjectIds.length === 0 ? {} : { subjectIds }),
      },
      ...(assignment.details === undefined ? {} : { details: assignment.details }),
      ...(assignment.requestId === undefined ? {} : { requestId: assignment.requestId }),
      ...(assignment.actingAssignmentId === undefined
        ? {}
        : { assignmentId: assignment.actingAssignmentId }),
      ...(assignment.personId === undefined ? {} : { personId: assignment.personId }),
    });
    return inserted;
  }

  /**
   * Ends an assignment now, or at `at`, in the caller's transaction, with its
   * audit entry: from that moment it gives no right, at the next request of
   * the person. An assignment that begins after that moment ends at its start
   * and is never in force. An end still ahead is moved (0.7a); one that has
   * passed is final (`assignments_end_guard`, db/migrations/0027). For a role
   * with a branch the transaction must work for that branch.
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
    const now = await transactionMoment(transaction);
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
    const at = ending.at !== undefined && ending.at > now ? ending.at : now;
    const validUntil = assignment.valid_from > at ? assignment.valid_from : at;
    let tutorRows: Awaited<ReturnType<typeof trackingTutorEnds>>;
    try {
      // The class rows of a Tutor role follow its end (db/migrations/0042) and
      // are named in the entry (task 3.1a, decision 20).
      tutorRows = await trackingTutorEnds(transaction, ending.assignmentId, async () => {
        await transaction
          .updateTable('assignments')
          .set({ valid_until: validUntil, ended_by: ending.endedBy })
          .where('id', '=', ending.assignmentId)
          .execute();
      });
    } catch (error) {
      // An end moved later over a holder of a subject appointed meanwhile
      // (decision 10 of #63); the transaction cannot go on.
      if (isHolderClash(error)) {
        throw new HeadTeacherTakenError();
      }
      throw error;
    }
    // Task 3.6c-2: the Tutor lessons of those classes follow.
    const follow = await followTutorEnds(transaction, tutorRows);
    await this.audit.record(transaction, {
      branchId: assignment.branch_id,
      actorId: ending.endedBy,
      action: 'assignment.ended',
      record: { type: 'assignment', id: ending.assignmentId },
      oldValue: { validUntil: assignment.valid_until?.toISOString() ?? null },
      newValue: { validUntil: validUntil.toISOString() },
      details: {
        accountId: assignment.account_id,
        role: assignment.role,
        ...(tutorRows.length === 0 ? {} : { tutorRows }),
        ...(followChanged(follow) ? { tutorLessons: auditOf(follow) } : {}),
      },
      ...(ending.requestId === undefined ? {} : { requestId: ending.requestId }),
      ...(ending.actingAssignmentId === undefined
        ? {}
        : { assignmentId: ending.actingAssignmentId }),
      ...(ending.personId === undefined ? {} : { personId: ending.personId }),
    });
  }

  /**
   * Every subject exists and is not archived, read `for share` so that an
   * archive at the same moment waits (decision 12 of #63); the trigger
   * `assignment_subjects_fill` refuses the same.
   */
  private async refuseUnknownSubjects(
    transaction: Transaction,
    subjectIds: readonly string[],
  ): Promise<void> {
    const found = await transaction
      .selectFrom('subjects')
      .select(['id', 'archived_at'])
      .where('id', 'in', [...subjectIds])
      .orderBy('id')
      .forShare()
      .execute();
    if (
      found.length !== subjectIds.length ||
      found.some((subject) => subject.archived_at !== null)
    ) {
      throw new SubjectUnknownError();
    }
  }

  /**
   * The subjects of a refused appointment that another holder has at some
   * moment of it. Read after the exclusion constraint refused it, when the
   * other holder's rows are committed.
   */
  private async takenSubjects(
    transaction: Transaction,
    assignment: NewAssignment,
    subjectIds: readonly string[],
    validFrom: Date,
  ): Promise<string[]> {
    const found = await transaction
      .selectFrom('assignment_subjects')
      .select('subject_id')
      .distinct()
      .where('subject_id', 'in', [...subjectIds])
      .where('role', '=', assignment.role)
      .$if(assignment.branchId !== null, (query) =>
        query.where('branch_id', '=', assignment.branchId ?? ''),
      )
      .where((builder) =>
        builder.or([builder('valid_until', 'is', null), builder('valid_until', '>', validFrom)]),
      )
      .whereRef('valid_until', 'is distinct from', 'valid_from')
      .orderBy('subject_id')
      .execute();
    return found.map((row) => row.subject_id);
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
    await lockSuperAdmins(transaction);
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
