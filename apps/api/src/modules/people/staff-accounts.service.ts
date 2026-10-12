import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_TIME_ZONE,
  schoolDateOf,
  type AccountRole,
  type Actor,
  type Clock,
  type ErrorCode,
  type FirstPasswordSlip,
  type LoginSuggestion,
  type RoleEnd,
  type RoleGive,
  type SchoolDate,
  type StaffAccount,
  type SuperAdminSummary,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import {
  AssignmentAlreadyEndedError,
  AssignmentBranchError,
  AssignmentOverlapError,
  Assignments,
  OwnSuperAdminRemovalError,
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
import { Accounts, LoginTakenError } from '../auth/accounts.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { startOfDate } from './staff-status.js';

/** The current Super Admin assignment of the account (`.claude/rules/api.md`: from every assignment). */
const superAdminOf = (access: Access): string | undefined =>
  access.assignments.find((assignment) => assignment.role === 'super_admin')?.id;

const refused = (code: ErrorCode): ApiException => new ApiException(code, 409);

/**
 * The branch of the request. Every route of a record is declared without
 * `branch: 'none'`, so the guard has always named a branch: a fault of the
 * code, never a request, reaches the throw.
 */
function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('An account route works for the branch of the request.');
  }
  return access.branchId;
}

/** The record of a person, as the account routes read it. */
interface Person {
  id: string;
  accountId: string | null;
  firstName: string;
  lastName: string;
  fatherName: string | null;
}

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
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Every branch for a Super Admin, else the branch of the request. */
  private async readingBranches(access: Access): Promise<readonly string[]> {
    if (superAdminOf(access) === undefined) {
      return access.branchIds;
    }
    return this.transactions.run([], async (transaction) =>
      (await transaction.selectFrom('branches').select('id').orderBy('id').execute()).map(
        (row) => row.id,
      ),
    );
  }

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
    return this.transactions.run(await this.readingBranches(access), async (transaction) => {
      const person = await this.findPerson(transaction, id, branchId, false);
      return this.sectionOf(transaction, access, person, branchId);
    });
  }

  /** The first free login of the owner's answer 14 for the person. */
  async suggest(access: Access, id: string): Promise<LoginSuggestion> {
    const branchId = branchOf(access);
    this.actingAs(access);
    return this.transactions.run(await this.readingBranches(access), async (transaction) => {
      const person = await this.findPerson(transaction, id, branchId, false);
      return { login: await this.accounts.suggest(transaction, person) };
    });
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
    return this.transactions.run(await this.readingBranches(access), async (transaction) => {
      const person = await this.findPerson(transaction, id, branchId, true);
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
    });
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
      this.transactions.run(await this.readingBranches(access), async (transaction) => {
        await lockSuperAdmins(transaction);
        const person = await this.findPerson(transaction, id, branchId, true);
        if (person.accountId === null) {
          throw refused('no_account');
        }
        await this.refuseLeft(transaction, id);
        if ((give.role === 'super_admin') !== (give.branchId === null)) {
          throw new ApiException('validation_failed', 400, undefined, [
            {
              path: 'branchId',
              code: 'branch',
              message: 'The Super Admin has no branch; every other role has one.',
            },
          ]);
        }
        if (give.branchId !== null) {
          const linked = await transaction
            .selectFrom('staff_branches')
            .select('branch_id')
            .where('staff_id', '=', id)
            .where('branch_id', '=', give.branchId.toLowerCase())
            .executeTakeFirst();
          if (linked === undefined) {
            throw refused('role_branch_not_person');
          }
        }
        const zone = await this.zoneOf(transaction, give.branchId);
        if (give.from < schoolDateOf(this.clock.now(), zone)) {
          throw refused('role_from_past');
        }
        await this.assignments.give(transaction, {
          accountId: person.accountId,
          role: give.role,
          branchId: give.branchId?.toLowerCase() ?? null,
          validFrom: await startOfDate(transaction, give.from, zone),
          givenBy: access.accountId,
          actingAssignmentId: superAdmin,
          personId: id,
          requestId,
        });
        return this.sectionOf(transaction, access, person, branchId);
      }),
    );
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
      this.transactions.run(await this.readingBranches(access), async (transaction) => {
        await lockSuperAdmins(transaction);
        const person = await this.findPerson(transaction, id, branchId, true);
        if (person.accountId === null) {
          throw refused('no_account');
        }
        const assignment = await transaction
          .selectFrom('assignments')
          .select(['id', 'branch_id'])
          .where('id', '=', assignmentId)
          .where('account_id', '=', person.accountId)
          .executeTakeFirst();
        if (assignment === undefined) {
          throw notFound();
        }
        const now = this.clock.now();
        const zone = await this.zoneOf(transaction, assignment.branch_id);
        const today = schoolDateOf(now, zone);
        if (end.from < today) {
          throw refused('role_from_past');
        }
        const at = end.from === today ? now : await startOfDate(transaction, end.from, zone);
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
      }),
    );
  }

  /** The number of active Super Admins, for the banner while fewer than two exist. */
  superAdmins(): Promise<SuperAdminSummary> {
    return this.transactions.run([], async (transaction) => ({
      active: await activeSuperAdmins(transaction, this.clock.now()),
    }));
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
      throw error;
    }
  }

  /**
   * The record of a person linked to the branch of the request, locked for a
   * change; 404 for another branch's record, an unknown id and a vacancy
   * ("no account", `04`, Vacancy).
   */
  private async findPerson(
    transaction: Transaction,
    id: string,
    branchId: string,
    lock: boolean,
  ): Promise<Person> {
    const linked = await transaction
      .selectFrom('staff_branches')
      .select('staff_id')
      .where('staff_id', '=', id)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (linked === undefined) {
      throw notFound();
    }
    let query = transaction
      .selectFrom('staff')
      .select(['id', 'account_id', 'first_name', 'last_name', 'father_name'])
      .where('id', '=', id)
      .where('kind', '=', 'person');
    if (lock) {
      query = query.forUpdate();
    }
    const row = await query.executeTakeFirst();
    if (row === undefined || row.first_name === null || row.last_name === null) {
      throw notFound();
    }
    return {
      id: row.id,
      accountId: row.account_id,
      firstName: row.first_name,
      lastName: row.last_name,
      fatherName: row.father_name,
    };
  }

  /** No account and no role for a person who has left for good (decision 12). */
  private async refuseLeft(transaction: Transaction, id: string): Promise<void> {
    if (await this.leftForGood(transaction, id)) {
      throw refused('staff_left');
    }
  }

  private async leftForGood(transaction: Transaction, id: string): Promise<boolean> {
    const found = await sql<{ out: boolean }>`
      select staff_out_for_good(${id}::uuid, ${this.clock.now()}) as out
    `.execute(transaction);
    return found.rows[0]?.out === true;
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
    const now = this.clock.now();
    const today = schoolDateOf(now, await this.zoneOf(transaction, branchId));
    const left = await this.leftForGood(transaction, person.id);
    const canEdit = superAdminOf(access) !== undefined;
    if (person.accountId === null) {
      return { account: null, canEdit, left, today };
    }
    const account = await transaction
      .selectFrom('accounts')
      .select(['login', 'created_at', 'locked_at'])
      .where('id', '=', person.accountId)
      .executeTakeFirstOrThrow();
    const used = await transaction
      .selectFrom('sessions')
      .select('id')
      .where('account_id', '=', person.accountId)
      .limit(1)
      .executeTakeFirst();
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
    const actors = await this.actorsOf(
      transaction,
      rows.flatMap((row) => [row.given_by, row.ended_by]),
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
      };
    });
    return {
      account: {
        login: account.login,
        createdAt: account.created_at.toISOString(),
        neverUsed: used === undefined,
        locked: account.locked_at !== null,
        roles,
      },
      canEdit,
      left,
      today,
    };
  }

  /**
   * Who gave or ended roles: the login always, the name only when the staff
   * record of that account is in a branch this transaction may read (the
   * membership filter), never through a function that reads every branch
   * (correction 1 of the review of pull request #62).
   */
  private async actorsOf(
    transaction: Transaction,
    ids: readonly (string | null)[],
  ): Promise<Map<string, Actor>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    const actors = new Map<string, Actor>();
    if (wanted.length === 0) {
      return actors;
    }
    const logins = await transaction
      .selectFrom('accounts')
      .select(['id', 'login'])
      .where('id', 'in', wanted)
      .execute();
    const names = await transaction
      .selectFrom('staff')
      .select(['account_id', 'first_name', 'last_name'])
      .where('account_id', 'in', wanted)
      .where('kind', '=', 'person')
      .execute();
    for (const row of logins) {
      const named = names.find((name) => name.account_id === row.id);
      actors.set(row.id, {
        login: row.login,
        name:
          named?.first_name == null || named.last_name == null
            ? null
            : { firstName: named.first_name, lastName: named.last_name },
      });
    }
    return actors;
  }
}
