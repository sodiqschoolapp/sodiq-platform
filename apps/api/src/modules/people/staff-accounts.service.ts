import { Injectable } from '@nestjs/common';
import {
  DEFAULT_TIME_ZONE,
  isAppointment,
  SCHOOL_WIDE_ROLES,
  schoolDateOf,
  type AccountRole,
  type ErrorCode,
  type FirstPasswordSlip,
  type LoginSuggestion,
  type RoleEnd,
  type RoleGive,
  type SchoolDate,
  type StaffAccount,
  type SubjectsChange,
  type BranchesWithoutVice,
  type SuperAdminSummary,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import {
  AssignmentAlreadyEndedError,
  AssignmentBranchError,
  AssignmentOverlapError,
  Assignments,
  HeadTeacherTakenError,
  OwnSuperAdminRemovalError,
  SubjectUnknownError,
  TooManySuperAdminsError,
  UnknownAssignmentError,
} from '../access/assignments.service.js';
import type { Access } from '../access/permission.guard.js';
import {
  activeSuperAdmins,
  keepingASuperAdmin,
  LastSuperAdminError,
  lockSuperAdmins,
} from '../access/super-admins.js';
import { Audit } from '../audit/audit.service.js';
import { Accounts, LoginTakenError } from '../auth/accounts.service.js';
import { appointedSubjects } from '../access/appointment-subjects.js';
import { actorsOf } from './actors.js';
import { notFound } from '../setup/setup-refusals.js';
import {
  branchOf,
  findPerson,
  leftForGood,
  neverUsedAccounts,
  periodStarts,
  readingBranches,
  type Person,
} from './staff-account-records.js';
import { startOfDate } from './staff-status.js';
import { Staff } from './staff.service.js';

/** The current Super Admin assignment of the account (`.claude/rules/api.md`: from every assignment). */
const superAdminOf = (access: Access): string | undefined =>
  access.assignments.find((assignment) => assignment.role === 'super_admin')?.id;

const refused = (code: ErrorCode): ApiException => new ApiException(code, 409);

/**
 * The account section of a staff record (task 2.3a, pull request #62): the
 * account made from the record, and the roles of that account. Edge cases,
 * Who can act: "The Super Admin creates staff accounts and gives all roles";
 * the Principal views (decision 4). A record is seen only in its branches
 * (2.2a, answer 2): every route finds it linked to the branch of the request,
 * or answers 404. The Super Admin works with every branch, so the audit entry
 * of a role in another branch of the person passes the row filter (finding 3
 * of the plan review). Lock order: the Super Admin count, then the record.
 */
@Injectable()
export class StaffAccounts {
  constructor(
    private readonly transactions: Transactions,
    private readonly accounts: Accounts,
    private readonly assignments: Assignments,
    private readonly staff: Staff,
    private readonly audit: Audit,
  ) {}

  /** The Super Admin assignment that allows a change; the route asks `create` or `edit`, which only the Super Admin has. */
  private actingAs(access: Access): string {
    const superAdmin = superAdminOf(access);
    if (superAdmin === undefined) {
      throw new ApiException('permission_denied', 403);
    }
    return superAdmin;
  }

  /** The section of the record of the branch of the request. */
  async read(access: Access, id: string): Promise<StaffAccount> {
    const branchId = branchOf(access);
    return this.transactions.run(
      await readingBranches(this.transactions, access),
      async (transaction) => {
        const person = await findPerson(transaction, id, branchId, false);
        return this.sectionOf(transaction, access, person, branchId);
      },
    );
  }

  /** The first free login of the owner's answer 14 for the person. */
  async suggest(access: Access, id: string): Promise<LoginSuggestion> {
    const branchId = branchOf(access);
    this.actingAs(access);
    return this.transactions.run(
      await readingBranches(this.transactions, access),
      async (transaction) => {
        const person = await findPerson(transaction, id, branchId, false);
        return { login: await this.accounts.suggest(transaction, person) };
      },
    );
  }

  /**
   * Creates the account of the person with the chosen login and links it to
   * the record once (\`staff.account_id\`, kept by \`staff_account_link_guard\`).
   * Answers the slip of the first password, which is stored nowhere.
   */
  async create(
    access: Access,
    id: string,
    login: string,
    requestId: string,
  ): Promise<FirstPasswordSlip> {
    const branchId = branchOf(access);
    const superAdmin = this.actingAs(access);
    return this.transactions.run(
      await readingBranches(this.transactions, access),
      async (transaction) => {
        const person = await findPerson(transaction, id, branchId, true);
        if (person.accountId !== null) {
          throw refused('account_exists');
        }
        await this.refuseLeft(transaction, id);
        let created;
        try {
          created = await this.accounts.create(transaction, {
            firstName: person.firstName,
            lastName: person.lastName,
            login,
            createdBy: access.accountId,
            actingAssignmentId: superAdmin,
            personId: id,
            requestId,
          });
        } catch (error) {
          if (error instanceof LoginTakenError) {
            throw new ApiException('login_taken', 409, undefined, [
              { path: 'login', code: 'taken', message: 'The login is given to another account.' },
            ]);
          }
          throw error;
        }
        await transaction
          .updateTable('staff')
          .set({ account_id: created.id })
          .where('id', '=', id)
          .execute();
        const account = await transaction
          .selectFrom('accounts')
          .select('password_expires_at')
          .where('id', '=', created.id)
          .executeTakeFirstOrThrow();
        if (account.password_expires_at === null) {
          throw new Error('A first password always has an end.');
        }
        return {
          firstName: person.firstName,
          lastName: person.lastName,
          login: created.login,
          password: created.firstPassword,
          validUntil: account.password_expires_at.toISOString(),
        };
      },
    );
  }

  /**
   * Links the record to the account of the session (task 2.7d; issue #39,
   * answer 37): the Super Admin whose account has no staff record, the first
   * one made by `auth:first-account`, gives it the record made the ordinary
   * way. Only the session's account is linked, never one named in the
   * request (decision 1). The link is written once (`staff_account_id_key`
   * and `staff_account_link_guard`, 0024). Lock order as `setStatus`: the
   * Super Admin count, then the record.
   */
  async linkOwn(access: Access, id: string, requestId: string): Promise<StaffAccount> {
    const branchId = branchOf(access);
    const superAdmin = this.actingAs(access);
    return this.refusing(async () =>
      this.transactions.run(
        await readingBranches(this.transactions, access),
        async (transaction) => {
          // The 404 before any lock or write (`.claude/rules/api.md`).
          await findPerson(transaction, id, branchId, false);
          await lockSuperAdmins(transaction);
          const person = await findPerson(transaction, id, branchId, true);
          const refusal = await this.ownLinkRefusal(transaction, access, person);
          if (refusal !== null) {
            throw refused(refusal);
          }
          const now = await transactionMoment(transaction);
          // The refusals above leave nothing this link could take out of the
          // count; kept as the guard every change of a Super Admin runs in.
          await keepingASuperAdmin(transaction, now, () =>
            transaction
              .updateTable('staff')
              .set({ account_id: access.accountId })
              .where('id', '=', id)
              .execute(),
          );
          const account = await transaction
            .selectFrom('accounts')
            .select('login')
            .where('id', '=', access.accountId)
            .executeTakeFirstOrThrow();
          // School-wide, as `account.create` (decision 7).
          await this.audit.record(transaction, {
            branchId: null,
            actorId: access.accountId,
            assignmentId: superAdmin,
            personId: id,
            action: 'account.linked',
            record: { type: 'account', id: access.accountId },
            newValue: { login: account.login, staffId: id },
            requestId,
          });
          return this.sectionOf(
            transaction,
            access,
            { ...person, accountId: access.accountId },
            branchId,
          );
        },
      ),
    );
  }

  /**
   * Why the record may not be linked to the account of the session, or
   * `null`: the one rule of the route and of `canLinkOwn` (correction 3 of
   * the review of #87). Not for a reader without a current Super Admin
   * assignment, a record with an account, an account with a record (read
   * through `own_staff_record`, which no branch hides), an inactive or left
   * status in force or planned (decision 3, correction 2), or an employment
   * that begins after today (decision 9).
   */
  private async ownLinkRefusal(
    transaction: Transaction,
    access: Access,
    person: Person,
  ): Promise<
    'permission_denied' | 'account_exists' | 'own_record_exists' | 'own_link_status' | null
  > {
    if (superAdminOf(access) === undefined) {
      return 'permission_denied';
    }
    if (person.accountId !== null) {
      return 'account_exists';
    }
    const own = await sql<{ staff_id: string }>`
      select staff_id from own_staff_record(${access.accountId}::uuid)
    `.execute(transaction);
    if (own.rows.length > 0) {
      return 'own_record_exists';
    }
    const now = await transactionMoment(transaction);
    // As `super_admin_active_count` (0027) reads them: a row not taken back
    // that is in force today or planned, today in the main branch's zone.
    const status = await transaction
      .selectFrom('staff_statuses')
      .innerJoin('staff_branches', (join) =>
        join
          .onRef('staff_branches.staff_id', '=', 'staff_statuses.staff_id')
          .on('staff_branches.is_main', '=', true),
      )
      .innerJoin('branches', 'branches.id', 'staff_branches.branch_id')
      .select(['staff_statuses.valid_until', 'branches.time_zone'])
      .where('staff_statuses.staff_id', '=', person.id)
      .where('staff_statuses.status', 'in', ['inactive', 'left'])
      // One taken back before it began was never in force.
      .where((builder) =>
        builder.or([
          builder('staff_statuses.valid_until', 'is', null),
          builder('staff_statuses.valid_until', '>', builder.ref('staff_statuses.valid_from')),
        ]),
      )
      .execute();
    const blocked = status.some(
      (row) => row.valid_until === null || row.valid_until > schoolDateOf(now, row.time_zone),
    );
    if (blocked) {
      return 'own_link_status';
    }
    const start = (await periodStarts(transaction, [person.id])).get(person.id);
    if (start !== undefined && start > now) {
      return 'own_link_status';
    }
    return null;
  }

  /**
   * Gives the account a role from a date, today or later (decision 10): 00:00
   * of that day in the time zone of the branch, of the school for the Super
   * Admin. A role with a branch is given in one of the person's branches.
   */
  async give(access: Access, id: string, give: RoleGive, requestId: string): Promise<StaffAccount> {
    const branchId = branchOf(access);
    const superAdmin = this.actingAs(access);
    return this.refusing(async () =>
      this.transactions.run(
        await readingBranches(this.transactions, access),
        async (transaction) => {
          await lockSuperAdmins(transaction);
          const person = await findPerson(transaction, id, branchId, true);
          if (person.accountId === null) {
            throw refused('no_account');
          }
          await this.giveTo(
            transaction,
            access,
            superAdmin,
            person,
            person.accountId,
            give,
            requestId,
          );
          return this.sectionOf(transaction, access, person, branchId);
        },
      ),
    );
  }

  /**
   * The give of a role to the account of a locked record. A Head Teacher or
   * Senior Head Teacher appointment given from today begins at the moment of
   * the give, so that it follows one ended today without overlapping it
   * (decision 5 of #63, Look first); every other role, and every later date,
   * begins at 00:00 of the day (decision 10 of #62).
   */
  private async giveTo(
    transaction: Transaction,
    access: Access,
    superAdmin: string,
    person: Person,
    accountId: string,
    give: RoleGive,
    requestId: string,
    /** The moment it begins when the caller knows it (a change of subjects); from the date otherwise. */
    startsAt?: Date,
  ): Promise<string> {
    await this.refuseLeft(transaction, person.id);
    if (SCHOOL_WIDE_ROLES.includes(give.role) !== (give.branchId === null)) {
      throw new ApiException('validation_failed', 400, undefined, [
        {
          path: 'branchId',
          code: 'branch',
          message:
            'The Super Admin and the Senior Head Teacher have no branch; every other role has one.',
        },
      ]);
    }
    if (give.branchId !== null) {
      const linked = await transaction
        .selectFrom('staff_branches')
        .select('branch_id')
        .where('staff_id', '=', person.id)
        .where('branch_id', '=', give.branchId.toLowerCase())
        .executeTakeFirst();
      if (linked === undefined) {
        throw refused('role_branch_not_person');
      }
    }
    const zone = await this.zoneOf(transaction, give.branchId);
    const now = await transactionMoment(transaction);
    const today = schoolDateOf(now, zone);
    if (give.from < today) {
      throw refused('role_from_past');
    }
    const leave = await this.leaveAfter(transaction, person.id, give.from);
    const validFrom =
      startsAt ??
      (isAppointment(give.role) && give.from === today
        ? now
        : await startOfDate(transaction, give.from, zone));
    const given = await this.namingTaken(give.subjectIds ?? [], () =>
      this.assignments.give(transaction, {
        accountId,
        role: give.role,
        branchId: give.branchId?.toLowerCase() ?? null,
        validFrom,
        givenBy: access.accountId,
        actingAssignmentId: superAdmin,
        personId: person.id,
        requestId,
        ...(give.subjectIds === undefined ? {} : { subjectIds: give.subjectIds }),
      }),
    );
    if (leave !== null) {
      // It ends at the planned `left` as the roles held when that row was
      // written did, and comes back with them when it is taken back.
      await this.staff.endRoles(transaction, access, superAdmin, {
        staffId: person.id,
        accountId,
        statusId: leave.id,
        dateStart: await startOfDate(transaction, leave.validFrom, leave.timeZone),
        requestId,
      });
    }
    return given.id;
  }

  /**
   * `head_teacher_taken` with the subjects another holder has, by their place
   * in the list sent (an error detail never repeats a value sent).
   */
  private async namingTaken<T>(sent: readonly string[], work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HeadTeacherTakenError) {
        const taken = new Set(error.subjectIds.map((subjectId) => subjectId.toLowerCase()));
        throw new ApiException(
          'head_teacher_taken',
          409,
          undefined,
          sent.flatMap((subjectId, index) =>
            taken.has(subjectId.toLowerCase())
              ? [
                  {
                    path: `subjectIds.${String(index)}`,
                    code: 'taken',
                    message: 'The subject has another holder at that time.',
                  },
                ]
              : [],
          ),
        );
      }
      throw error;
    }
  }

  /**
   * The subjects of a Head Teacher or Senior Head Teacher appointment from a
   * date (decision 6 of #63): in one transaction the appointment ends at that
   * moment (now for today) and a new one of the same role and branch with the
   * new subjects begins at the same moment. The end comes first, so a subject
   * that is kept passes from the old appointment to the new one without an
   * overlap (correction 2 of the review of #63). Under the lock of the
   * assignment, read again after the lock: of two changes at once the second
   * finds it ended (`assignment_ended`).
   */
  async changeSubjects(
    access: Access,
    id: string,
    assignmentId: string,
    change: SubjectsChange,
    requestId: string,
  ): Promise<StaffAccount> {
    const branchId = branchOf(access);
    const superAdmin = this.actingAs(access);
    return this.refusing(async () =>
      this.transactions.run(
        await readingBranches(this.transactions, access),
        async (transaction) => {
          await lockSuperAdmins(transaction);
          const person = await findPerson(transaction, id, branchId, true);
          if (person.accountId === null) {
            throw refused('no_account');
          }
          const assignment = await transaction
            .selectFrom('assignments')
            .select(['id', 'role', 'branch_id', 'valid_from', 'valid_until'])
            .where('id', '=', assignmentId)
            .where('account_id', '=', person.accountId)
            .forUpdate()
            .executeTakeFirst();
          if (assignment === undefined) {
            throw notFound();
          }
          if (!isAppointment(assignment.role as AccountRole['role'])) {
            throw refused('role_not_appointment');
          }
          const now = await transactionMoment(transaction);
          const zone = await this.zoneOf(transaction, assignment.branch_id);
          const today = schoolDateOf(now, zone);
          if (change.from < today) {
            throw refused('role_from_past');
          }
          const at =
            change.from === today ? now : await startOfDate(transaction, change.from, zone);
          if (
            assignment.valid_until !== null &&
            (assignment.valid_until <= now || assignment.valid_until <= assignment.valid_from)
          ) {
            throw refused('assignment_ended');
          }
          // An appointment that ends by then (a change made a moment before, or
          // an end typed earlier) is not changed from then: its end is not
          // moved later here.
          if (assignment.valid_until !== null && assignment.valid_until <= at) {
            throw refused('appointment_ends_by_then');
          }
          await this.assignments.end(transaction, {
            assignmentId,
            endedBy: access.accountId,
            at,
            actingAssignmentId: superAdmin,
            personId: id,
            requestId,
          });
          const next = await this.giveTo(
            transaction,
            access,
            superAdmin,
            person,
            person.accountId,
            {
              role: assignment.role as RoleGive['role'],
              branchId: assignment.branch_id,
              from: change.from,
              subjectIds: change.subjectIds,
            },
            requestId,
            // A planned appointment keeps its start: the change never begins
            // the role earlier than it was appointed (code review of #63).
            assignment.valid_from > at ? assignment.valid_from : at,
          );
          // A later end of the appointment (typed, or given by a planned
          // `left`) carries over to the one that follows it.
          const followed = await transaction
            .selectFrom('assignments')
            .select('valid_until')
            .where('id', '=', next)
            .executeTakeFirstOrThrow();
          if (assignment.valid_until !== null && followed.valid_until === null) {
            await this.assignments.end(transaction, {
              assignmentId: next,
              endedBy: access.accountId,
              at: assignment.valid_until,
              actingAssignmentId: superAdmin,
              personId: id,
              requestId,
            });
          }
          // One entry that ties the two together (plan of #63); the end and the
          // give keep their own entries, as every other end and give.
          await this.audit.record(transaction, {
            branchId: assignment.branch_id,
            actorId: access.accountId,
            assignmentId: superAdmin,
            personId: id,
            action: 'assignment.subjects_changed',
            record: { type: 'assignment', id: next },
            oldValue: {
              assignmentId,
              subjectIds: await this.subjectIdsOf(transaction, assignmentId),
            },
            newValue: {
              assignmentId: next,
              subjectIds: [...change.subjectIds].map((one) => one.toLowerCase()).sort(),
            },
            requestId,
          });
          return this.sectionOf(transaction, access, person, branchId);
        },
      ),
    );
  }

  private async subjectIdsOf(transaction: Transaction, assignmentId: string): Promise<string[]> {
    const rows = await transaction
      .selectFrom('assignment_subjects')
      .select('subject_id')
      .where('assignment_id', '=', assignmentId)
      .orderBy('subject_id')
      .execute();
    return rows.map((row) => row.subject_id);
  }

  /**
   * Ends a role of the account from a date: today ends it now, a later date
   * at 00:00 of that day (decision 13). Refused when it would leave no active
   * Super Admin (decision 5), under the lock of the count.
   */
  async end(
    access: Access,
    id: string,
    assignmentId: string,
    end: RoleEnd,
    requestId: string,
  ): Promise<StaffAccount> {
    const branchId = branchOf(access);
    const superAdmin = this.actingAs(access);
    return this.refusing(async () =>
      this.transactions.run(
        await readingBranches(this.transactions, access),
        async (transaction) => {
          await lockSuperAdmins(transaction);
          const person = await findPerson(transaction, id, branchId, true);
          if (person.accountId === null) {
            throw refused('no_account');
          }
          const assignment = await transaction
            .selectFrom('assignments')
            .select(['id', 'branch_id', 'valid_until'])
            .where('id', '=', assignmentId)
            .where('account_id', '=', person.accountId)
            .executeTakeFirst();
          if (assignment === undefined) {
            throw notFound();
          }
          // The moment `assignments_end_guard` compares with (code round 1, finding 5).
          const now = await transactionMoment(transaction);
          const zone = await this.zoneOf(transaction, assignment.branch_id);
          const today = schoolDateOf(now, zone);
          if (end.from < today) {
            throw refused('role_from_past');
          }
          const at = end.from === today ? now : await startOfDate(transaction, end.from, zone);
          if (
            assignment.valid_until !== null &&
            at > assignment.valid_until &&
            (await this.endedByLeave(transaction, assignmentId))
          ) {
            // An end a `left` gave is not moved past it (finding 1).
            throw refused('staff_left');
          }
          await keepingASuperAdmin(transaction, now, () =>
            this.assignments.end(transaction, {
              assignmentId,
              endedBy: access.accountId,
              at,
              actingAssignmentId: superAdmin,
              personId: id,
              requestId,
            }),
          );
          return this.sectionOf(transaction, access, person, branchId);
        },
      ),
    );
  }

  /** The number of active Super Admins, for the banner while fewer than two exist. */
  superAdmins(): Promise<SuperAdminSummary> {
    return this.transactions.run([], async (transaction) => ({
      active: await activeSuperAdmins(transaction, await transactionMoment(transaction)),
    }));
  }

  /**
   * The branches, id and name only, where no Academic Vice Principal is active
   * at the moment of the transaction (`branches_without_vice_principal`, 0029):
   * compared on each request, never a stored flag.
   */
  branchesWithoutVice(): Promise<BranchesWithoutVice> {
    return this.transactions.run([], async (transaction) => {
      const at = await transactionMoment(transaction);
      const found = await sql<{ id: string; name: string }>`
        select id, name from branches_without_vice_principal(${at}::timestamptz)
      `.execute(transaction);
      return { branches: found.rows.map((row) => ({ id: row.id, name: row.name })) };
    });
  }

  /** The errors of `Assignments` and the last Super Admin rule as coded refusals. */
  private async refusing<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AssignmentOverlapError) {
        throw refused('role_overlap');
      }
      if (error instanceof TooManySuperAdminsError) {
        throw refused('too_many_super_admins');
      }
      if (error instanceof OwnSuperAdminRemovalError) {
        throw refused('own_super_admin_role');
      }
      if (error instanceof AssignmentAlreadyEndedError) {
        throw refused('assignment_ended');
      }
      if (error instanceof LastSuperAdminError) {
        throw refused('last_super_admin');
      }
      if (error instanceof UnknownAssignmentError) {
        throw notFound();
      }
      if (error instanceof AssignmentBranchError) {
        throw refused('role_branch_not_person');
      }
      if (error instanceof HeadTeacherTakenError) {
        throw refused('head_teacher_taken');
      }
      if (error instanceof SubjectUnknownError) {
        throw refused('subject_unknown');
      }
      throw error;
    }
  }

  /** No account and no role for a person who has left for good (decision 12). */
  private async refuseLeft(transaction: Transaction, id: string): Promise<void> {
    if (await leftForGood(transaction, id)) {
      throw refused('staff_left');
    }
  }

  /**
   * "Left: all roles ended" for a role from `from` (code round 1 of #62,
   * finding 1): a role that would begin while a `left` row is in force, with
   * or without a return planned, is refused; a `left` planned after its
   * start is answered, at which the role ends (decision 12). By the status
   * rules at most one change is planned after today, so the first such
   * `left` is the only one. Status dates are school dates of the main branch.
   */
  private async leaveAfter(
    transaction: Transaction,
    id: string,
    from: SchoolDate,
  ): Promise<{ id: string; validFrom: SchoolDate; timeZone: string } | null> {
    const lefts = await transaction
      .selectFrom('staff_statuses')
      .innerJoin('staff_branches', (join) =>
        join
          .onRef('staff_branches.staff_id', '=', 'staff_statuses.staff_id')
          .on('staff_branches.is_main', '=', true),
      )
      .innerJoin('branches', 'branches.id', 'staff_branches.branch_id')
      .select(['staff_statuses.id', 'staff_statuses.valid_from', 'branches.time_zone'])
      .where('staff_statuses.staff_id', '=', id)
      .where('staff_statuses.status', '=', 'left')
      // Not taken back, and not over before the role begins.
      .where((builder) =>
        builder.or([
          builder('staff_statuses.valid_until', 'is', null),
          builder.and([
            builder('staff_statuses.valid_until', '>', builder.ref('staff_statuses.valid_from')),
            builder('staff_statuses.valid_until', '>', from),
          ]),
        ]),
      )
      .orderBy('staff_statuses.valid_from')
      .execute();
    if (lefts.some((left) => left.valid_from <= from)) {
      throw refused('staff_left');
    }
    const first = lefts[0];
    return first === undefined
      ? null
      : { id: first.id, validFrom: first.valid_from, timeZone: first.time_zone };
  }

  /** Whether the end of the assignment was given by a `left` row that is not taken back. */
  private async endedByLeave(transaction: Transaction, assignmentId: string): Promise<boolean> {
    const found = await transaction
      .selectFrom('staff_status_role_ends')
      .innerJoin('staff_statuses', 'staff_statuses.id', 'staff_status_role_ends.status_id')
      .select('staff_statuses.id')
      .where('staff_status_role_ends.assignment_id', '=', assignmentId)
      .where((builder) =>
        builder.or([
          builder('staff_statuses.valid_until', 'is', null),
          builder('staff_statuses.valid_until', '>', builder.ref('staff_statuses.valid_from')),
        ]),
      )
      .executeTakeFirst();
    return found !== undefined;
  }

  /** The time zone of a branch; of the school for the two roles without one (0.7a). */
  private async zoneOf(transaction: Transaction, branchId: string | null): Promise<string> {
    if (branchId === null) {
      return DEFAULT_TIME_ZONE;
    }
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId.toLowerCase())
      .executeTakeFirst();
    return branch?.time_zone ?? DEFAULT_TIME_ZONE;
  }

  private async sectionOf(
    transaction: Transaction,
    access: Access,
    person: Person,
    branchId: string,
  ): Promise<StaffAccount> {
    const now = await transactionMoment(transaction);
    const today = schoolDateOf(now, await this.zoneOf(transaction, branchId));
    const left = await leftForGood(transaction, person.id);
    const canEdit = superAdminOf(access) !== undefined;
    if (person.accountId === null) {
      const canLinkOwn = (await this.ownLinkRefusal(transaction, access, person)) === null;
      return { account: null, canEdit, canLinkOwn, left, today };
    }
    const account = await transaction
      .selectFrom('accounts')
      .select(['login', 'created_at', 'locked_at'])
      .where('id', '=', person.accountId)
      .executeTakeFirstOrThrow();
    // Since the start of the current employment period (task 2.3c-1,
    // correction 2 of the review of #65), as the section "Sign-in access" and
    // the report of accounts never used say it.
    const neverUsed = (
      await neverUsedAccounts(transaction, [{ staffId: person.id, accountId: person.accountId }])
    ).has(person.accountId);
    const rows = await transaction
      .selectFrom('assignments')
      .leftJoin('branches', 'branches.id', 'assignments.branch_id')
      .select([
        'assignments.id',
        'assignments.role',
        'assignments.branch_id',
        'assignments.valid_from',
        'assignments.valid_until',
        'assignments.given_by',
        'assignments.ended_by',
        'branches.name as branch_name',
        'branches.time_zone',
      ])
      .where('assignments.account_id', '=', person.accountId)
      // `assignments` has no row policy: a reader other than the Super Admin
      // sees the roles of the branches of the request and the two without a
      // branch, never another branch's (code round 1 of #62, finding 2).
      .$if(!canEdit, (query) =>
        query.where((builder) =>
          builder.or([
            builder('assignments.branch_id', 'is', null),
            ...(access.branchIds.length === 0
              ? []
              : [builder('assignments.branch_id', 'in', [...access.branchIds])]),
          ]),
        ),
      )
      // One taken back before it began was never in force: it is not shown.
      .where((builder) =>
        builder.or([
          builder('assignments.valid_until', 'is', null),
          builder('assignments.valid_until', '>', builder.ref('assignments.valid_from')),
        ]),
      )
      .orderBy('assignments.valid_from')
      .orderBy('assignments.id')
      .execute();
    const actors = await actorsOf(
      transaction,
      rows.flatMap((row) => [row.given_by, row.ended_by]),
    );
    const subjects = await appointedSubjects(
      transaction,
      rows.map((row) => row.id),
    );
    const roles: AccountRole[] = rows.map((row) => {
      const zone = row.time_zone ?? DEFAULT_TIME_ZONE;
      const until: SchoolDate | null =
        row.valid_until === null ? null : schoolDateOf(row.valid_until, zone);
      return {
        id: row.id,
        role: row.role as AccountRole['role'],
        branchId: row.branch_id,
        branchName: row.branch_name,
        from: schoolDateOf(row.valid_from, zone),
        until,
        state:
          row.valid_from > now
            ? 'planned'
            : row.valid_until !== null && row.valid_until <= now
              ? 'ended'
              : 'current',
        givenBy: row.given_by === null ? null : (actors.get(row.given_by) ?? null),
        endedBy: row.ended_by === null ? null : (actors.get(row.ended_by) ?? null),
        subjects: subjects.get(row.id) ?? [],
      };
    });
    return {
      account: {
        login: account.login,
        createdAt: account.created_at.toISOString(),
        neverUsed,
        locked: account.locked_at !== null,
        roles,
      },
      canEdit,
      canLinkOwn: false,
      left,
      today,
    };
  }
}
