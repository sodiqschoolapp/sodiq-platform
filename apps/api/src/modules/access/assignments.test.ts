import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { insertSubject } from '../../testing/subjects-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { Audit } from '../audit/audit.service.js';
import { Accounts } from '../auth/accounts.service.js';
import { UnknownAccountError } from '../auth/password-resets.service.js';
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
  type NewAssignment,
} from './assignments.service.js';
import { currentAssignments } from './current-assignments.js';

const NOBODY = '00000000-0000-7000-8000-000000000000';
/** PostgreSQL answers a row that the row filter refuses with this code. */
const ROW_SECURITY_VIOLATION = '42501';
const START = '2026-10-05T09:00:00+05:00';
const HOUR = 60 * 60 * 1000;
/** No end here moves a Tutor lesson (task 5.5c-3b): a notice would be a mistake of the test. */
const noNotices = { send: () => Promise.reject(new Error('No notice is expected here.')) };

// Edge cases, "Who can act": rights are assignments: person, role, branch,
// with dates; the server allows an action if any current assignment permits it.
// All names are invented.
describe('assignments', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let assignments: Assignments;
  let accounts: Accounts;
  let north: string;
  let south: string;
  let administrator: string;
  let mathematics: string;
  let physics: string;
  const clock = new FixedClock(START);

  /** A new account without a role. */
  async function account(firstName: string, lastName: string): Promise<string> {
    const created = await transactions.run([], (transaction) =>
      accounts.create(transaction, { firstName, lastName, createdBy: null }),
    );
    return created.id;
  }

  /** In a transaction of the branch of the assignment, as a route of that branch would. */
  function give(assignment: Omit<NewAssignment, 'givenBy'>): Promise<{ id: string }> {
    return transactions.run(
      assignment.branchId === null ? [] : [assignment.branchId],
      (transaction) => assignments.give(transaction, { ...assignment, givenBy: administrator }),
    );
  }

  function end(assignmentId: string, branchId: string | null, endedBy = administrator) {
    return transactions.run(branchId === null ? [] : [branchId], (transaction) =>
      assignments.end(transaction, { assignmentId, endedBy, notifications: noNotices }),
    );
  }

  function current(accountId: string) {
    return transactions.run([], (transaction) =>
      currentAssignments(transaction, accountId, clock.now()),
    );
  }

  async function rowsOf(accountId: string) {
    const found = await sql<{
      role: string;
      branch_id: string | null;
      valid_from: Date;
      valid_until: Date | null;
      created_at: Date;
      given_by: string | null;
      ended_by: string | null;
    }>`
      select role, branch_id, valid_from, valid_until, created_at, given_by, ended_by
      from assignments where account_id = ${accountId} order by id
    `.execute(database.migrator);
    return found.rows;
  }

  /** The audit entries about an assignment, from the log of a branch or of the school. */
  async function auditOf(assignmentId: string, log: 'audit_log' | 'audit_log_school') {
    const found = await sql<{
      action: string;
      actor_id: string | null;
      old_value: unknown;
      new_value: unknown;
      details: unknown;
      request_id: string | null;
    }>`
      select action, actor_id, old_value, new_value, details, request_id
      from ${sql.table(log)} where record_type = 'assignment' and record_id = ${assignmentId}
      order by id
    `.execute(database.migrator);
    return found.rows;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, clock);
    const audit = new Audit(clock);
    assignments = new Assignments(audit);
    accounts = new Accounts(clock, audit);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    administrator = await account('Ilhom', 'Qodirov');
    mathematics = await insertSubject(database.migrator, 'Mathematics');
    physics = await insertSubject(database.migrator, 'Physics');
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('given', () => {
    it('are in force from that moment, with who gave them, and are written to the log of the branch', async () => {
      clock.set(START);
      const teacher = await account('Aziz', 'Valiyev');

      const given = await transactions.run([north], (transaction) =>
        assignments.give(transaction, {
          accountId: teacher,
          role: 'teacher',
          branchId: north,
          givenBy: administrator,
          requestId: 'request-1',
        }),
      );

      expect(await current(teacher)).toEqual([
        { id: given.id, role: 'teacher', branchId: north, subjectIds: [], classIds: [] },
      ]);
      expect(await rowsOf(teacher)).toEqual([
        {
          role: 'teacher',
          branch_id: north,
          valid_from: new Date(START),
          valid_until: null,
          created_at: new Date(START),
          given_by: administrator,
          ended_by: null,
        },
      ]);
      expect(await auditOf(given.id, 'audit_log')).toEqual([
        {
          action: 'assignment.given',
          actor_id: administrator,
          old_value: null,
          new_value: {
            accountId: teacher,
            role: 'teacher',
            branchId: north,
            validFrom: '2026-10-05T04:00:00.000Z',
          },
          details: null,
          request_id: 'request-1',
        },
      ]);
      expect(await auditOf(given.id, 'audit_log_school')).toEqual([]);
    });

    // A Senior Head Teacher's assignment has no branch.
    it('without a branch are written to the log of the school', async () => {
      const senior = await account('Barno', 'Valiyeva');

      const given = await give({
        accountId: senior,
        role: 'senior_head_teacher',
        branchId: null,
        subjectIds: [mathematics],
      });

      expect(await current(senior)).toEqual([
        {
          id: given.id,
          role: 'senior_head_teacher',
          branchId: null,
          subjectIds: [mathematics],
          classIds: [],
        },
      ]);
      expect(await auditOf(given.id, 'audit_log_school')).toMatchObject([
        {
          action: 'assignment.given',
          new_value: { role: 'senior_head_teacher', branchId: null, subjectIds: [mathematics] },
        },
      ]);
    });

    // "One person is Teacher, Tutor and Head Teacher"; "a person works in two branches".
    it('can be several for one person: several roles, and one role in two branches', async () => {
      const person = await account('Charos', 'Valiyeva');

      await give({ accountId: person, role: 'teacher', branchId: north });
      await give({ accountId: person, role: 'tutor', branchId: north });
      await give({
        accountId: person,
        role: 'head_teacher',
        branchId: north,
        subjectIds: [physics],
      });
      await give({ accountId: person, role: 'teacher', branchId: south });

      expect(
        (await current(person)).map((assignment) => [assignment.role, assignment.branchId]),
      ).toEqual([
        ['teacher', north],
        ['tutor', north],
        ['head_teacher', north],
        ['teacher', south],
      ]);
    });

    it('for a later moment are not in force before it, and are from it on', async () => {
      clock.set(START);
      const person = await account('Davron', 'Valiyev');
      const from = new Date(clock.now().getTime() + 24 * HOUR);

      await give({ accountId: person, role: 'tutor', branchId: north, validFrom: from });

      clock.set(new Date(from.getTime() - 1).toISOString().replace('Z', '+00:00'));
      expect(await current(person)).toEqual([]);
      clock.set(from.toISOString().replace('Z', '+00:00'));
      expect(await current(person)).toMatchObject([{ role: 'tutor' }]);
      expect(await rowsOf(person)).toMatchObject([
        { valid_from: from, created_at: new Date(START) },
      ]);
      clock.set(START);
    });

    it('leave neither a row nor an audit entry when the transaction rolls back', async () => {
      const person = await account('Elyor', 'Valiyev');
      let id = '';

      await expect(
        transactions.run([north], async (transaction) => {
          const given = await assignments.give(transaction, {
            accountId: person,
            role: 'teacher',
            branchId: north,
            givenBy: administrator,
          });
          id = given.id;
          throw new Error('The rest of the work failed.');
        }),
      ).rejects.toThrow('The rest of the work failed.');

      expect(await rowsOf(person)).toEqual([]);
      expect(await auditOf(id, 'audit_log')).toEqual([]);
    });

    // `02`, Head Teachers and Senior Head Teachers (task 2.3b-1).
    describe('with subjects', () => {
      it('name the subjects another Head Teacher of the branch holds', async () => {
        const first = await account('Jasur', 'Valiyev');
        const second = await account('Kamola', 'Valiyeva');
        const chemistry = await insertSubject(database.migrator, 'Chemistry');
        const biology = await insertSubject(database.migrator, 'Biology');
        await give({
          accountId: first,
          role: 'head_teacher',
          branchId: south,
          subjectIds: [chemistry],
        });

        const refused = give({
          accountId: second,
          role: 'head_teacher',
          branchId: south,
          subjectIds: [biology, chemistry],
        });

        await expect(refused).rejects.toBeInstanceOf(HeadTeacherTakenError);
        await expect(refused).rejects.toMatchObject({ subjectIds: [chemistry] });
        expect(await rowsOf(second)).toEqual([]);
      });

      it('refuse an unknown or archived subject', async () => {
        const person = await account('Lola', 'Valiyeva');
        const archived = await insertSubject(database.migrator, 'Latin', new Date(START));

        for (const subject of [archived, '019a0000-0000-7000-8000-0000000000ff']) {
          await expect(
            give({
              accountId: person,
              role: 'head_teacher',
              branchId: north,
              subjectIds: [subject],
            }),
          ).rejects.toBeInstanceOf(SubjectUnknownError);
        }
        expect(await rowsOf(person)).toEqual([]);
      });

      it('are a fault of the code without subjects, or for another role', async () => {
        const person = await account('Malika', 'Valiyeva');

        await expect(
          give({ accountId: person, role: 'head_teacher', branchId: north }),
        ).rejects.toThrow('given with subjects');
        await expect(
          give({ accountId: person, role: 'teacher', branchId: north, subjectIds: [physics] }),
        ).rejects.toThrow('given with subjects');
      });
    });

    describe('are refused', () => {
      // Rules: every role is limited to a branch, except the two that work across branches.
      it.each([
        ['a Teacher without a branch', 'teacher', false],
        ['a Parent without a branch', 'parent', false],
        ['a Super Admin with a branch', 'super_admin', true],
        ['a Senior Head Teacher with a branch', 'senior_head_teacher', true],
      ] as const)('for %s', async (_name, role, withBranch) => {
        const person = await account('Feruza', 'Valiyeva');

        await expect(
          transactions.run([north], (transaction) =>
            assignments.give(transaction, {
              accountId: person,
              role,
              branchId: withBranch ? north : null,
              givenBy: administrator,
            }),
          ),
        ).rejects.toBeInstanceOf(AssignmentBranchError);
        expect(await rowsOf(person)).toEqual([]);
      });

      it('for a branch that does not exist', async () => {
        const person = await account('Gulom', 'Valiyev');

        await expect(
          transactions.run([], (transaction) =>
            assignments.give(transaction, {
              accountId: person,
              role: 'teacher',
              branchId: NOBODY,
              givenBy: administrator,
            }),
          ),
        ).rejects.toBeInstanceOf(AssignmentBranchError);
      });

      it('for an account that does not exist', async () => {
        await expect(
          give({ accountId: NOBODY, role: 'teacher', branchId: north }),
        ).rejects.toBeInstanceOf(UnknownAccountError);
      });

      it('for a role the account holds in that branch already, now or later', async () => {
        const person = await account('Hilola', 'Valiyeva');
        await give({ accountId: person, role: 'teacher', branchId: north });

        await expect(
          give({ accountId: person, role: 'teacher', branchId: north }),
        ).rejects.toBeInstanceOf(AssignmentOverlapError);
        await expect(
          give({
            accountId: person,
            role: 'teacher',
            branchId: north,
            validFrom: new Date(clock.now().getTime() + 24 * HOUR),
          }),
        ).rejects.toBeInstanceOf(AssignmentOverlapError);
        expect(await rowsOf(person)).toHaveLength(1);
      });

      // The audit entry of a branch belongs to that branch's log: the row filter refuses it elsewhere.
      it('in a transaction that does not work for the branch', async () => {
        const person = await account('Ikrom', 'Valiyev');

        await expect(
          transactions.run([south], (transaction) =>
            assignments.give(transaction, {
              accountId: person,
              role: 'teacher',
              branchId: north,
              givenBy: administrator,
            }),
          ),
        ).rejects.toMatchObject({
          code: ROW_SECURITY_VIOLATION,
          message: expect.stringContaining('audit_log') as unknown,
        });
        expect(await rowsOf(person)).toEqual([]);
      });

      // A route may answer the refusal and go on in its transaction.
      it('without spoiling the transaction of the caller', async () => {
        const person = await account('Jahongir', 'Valiyev');
        await give({ accountId: person, role: 'teacher', branchId: north });

        const second = await transactions.run([north], async (transaction) => {
          await expect(
            assignments.give(transaction, {
              accountId: person,
              role: 'teacher',
              branchId: north,
              givenBy: administrator,
            }),
          ).rejects.toBeInstanceOf(AssignmentOverlapError);
          return assignments.give(transaction, {
            accountId: person,
            role: 'tutor',
            branchId: north,
            givenBy: administrator,
          });
        });

        expect((await current(person)).map((assignment) => assignment.role)).toEqual([
          'teacher',
          'tutor',
        ]);
        expect(await auditOf(second.id, 'audit_log')).toHaveLength(1);
      });
    });
  });

  describe('ended', () => {
    it('give no right from that moment on, and keep their row', async () => {
      clock.set(START);
      const person = await account('Jasur', 'Valiyev');
      const given = await give({ accountId: person, role: 'teacher', branchId: north });
      clock.advance(2 * HOUR);

      await transactions.run([north], (transaction) =>
        assignments.end(transaction, {
          assignmentId: given.id,
          endedBy: administrator,
          requestId: 'request-2',
          notifications: noNotices,
        }),
      );

      // At the moment of the end it is over; one millisecond earlier it was in force.
      expect(await current(person)).toEqual([]);
      const justBefore = await transactions.run([], (transaction) =>
        currentAssignments(transaction, person, new Date(clock.now().getTime() - 1)),
      );
      expect(justBefore).toMatchObject([{ id: given.id }]);
      expect(await rowsOf(person)).toMatchObject([
        { valid_until: new Date('2026-10-05T11:00:00+05:00'), ended_by: administrator },
      ]);
      expect(await auditOf(given.id, 'audit_log')).toMatchObject([
        { action: 'assignment.given' },
        {
          action: 'assignment.ended',
          actor_id: administrator,
          old_value: { validUntil: null },
          new_value: { validUntil: '2026-10-05T06:00:00.000Z' },
          details: { accountId: person, role: 'teacher' },
          request_id: 'request-2',
        },
      ]);
      clock.set(START);
    });

    it('can be given again afterwards, as a new assignment', async () => {
      clock.set(START);
      const person = await account('Kamola', 'Valiyeva');
      const first = await give({ accountId: person, role: 'tutor', branchId: north });
      clock.advance(HOUR);
      await end(first.id, north);

      const second = await give({ accountId: person, role: 'tutor', branchId: north });

      expect(second.id).not.toBe(first.id);
      expect(await current(person)).toEqual([
        { id: second.id, role: 'tutor', branchId: north, subjectIds: [], classIds: [] },
      ]);
      expect(await rowsOf(person)).toHaveLength(2);
      clock.set(START);
    });

    it('before they began are never in force', async () => {
      clock.set(START);
      const person = await account('Laziz', 'Valiyev');
      const from = new Date(clock.now().getTime() + 24 * HOUR);
      const given = await give({
        accountId: person,
        role: 'tutor',
        branchId: north,
        validFrom: from,
      });

      await end(given.id, north);

      expect(await rowsOf(person)).toMatchObject([{ valid_from: from, valid_until: from }]);
      clock.advance(48 * HOUR);
      expect(await current(person)).toEqual([]);
      clock.set(START);
    });

    // No service writes an end that is still to come; the rows allow it.
    it('now, when their end was still to come', async () => {
      clock.set(START);
      const person = await account('Lola', 'Valiyeva');
      const later = new Date(clock.now().getTime() + 48 * HOUR);
      const inserted = await sql<{ id: string }>`
        insert into assignments (account_id, role, branch_id, valid_from, valid_until, created_at)
        values (${person}, 'teacher', ${north}, ${clock.now()}, ${later}, ${clock.now()})
        returning id
      `.execute(database.migrator);
      const id = inserted.rows[0]?.id ?? '';
      clock.advance(HOUR);

      await end(id, north);

      expect(await current(person)).toEqual([]);
      expect(await rowsOf(person)).toMatchObject([
        { valid_until: new Date('2026-10-05T10:00:00+05:00'), ended_by: administrator },
      ]);
      expect(await auditOf(id, 'audit_log')).toMatchObject([
        {
          action: 'assignment.ended',
          old_value: { validUntil: later.toISOString() },
          new_value: { validUntil: '2026-10-05T05:00:00.000Z' },
        },
      ]);
      clock.set(START);
    });

    describe('are refused', () => {
      it('a second time', async () => {
        const person = await account('Malika', 'Valiyeva');
        const given = await give({ accountId: person, role: 'teacher', branchId: north });
        await end(given.id, north);

        await expect(end(given.id, north)).rejects.toBeInstanceOf(AssignmentAlreadyEndedError);
        expect(await auditOf(given.id, 'audit_log')).toHaveLength(2);
      });

      // Found by the review: its end is its start, which is still ahead.
      it('a second time for one that was taken back before it began', async () => {
        clock.set(START);
        const person = await account('Mansur', 'Valiyev');
        const given = await give({
          accountId: person,
          role: 'tutor',
          branchId: north,
          validFrom: new Date(clock.now().getTime() + 24 * HOUR),
        });
        await end(given.id, north);
        const colleague = await account('Munisa', 'Valiyeva');

        await expect(end(given.id, north, colleague)).rejects.toBeInstanceOf(
          AssignmentAlreadyEndedError,
        );

        expect(await rowsOf(person)).toMatchObject([{ ended_by: administrator }]);
        expect(await auditOf(given.id, 'audit_log')).toHaveLength(2);
      });

      it('for an assignment that does not exist', async () => {
        await expect(end(NOBODY, null)).rejects.toBeInstanceOf(UnknownAssignmentError);
      });

      it('in a transaction that does not work for the branch, and the assignment stays', async () => {
        const person = await account('Nargiza', 'Valiyeva');
        const given = await give({ accountId: person, role: 'teacher', branchId: north });

        await expect(end(given.id, south)).rejects.toMatchObject({
          code: ROW_SECURITY_VIOLATION,
        });

        expect(await current(person)).toMatchObject([{ id: given.id }]);
        expect(await rowsOf(person)).toMatchObject([{ valid_until: null, ended_by: null }]);
      });

      // Edge cases, "Accounts and sign-in": nobody can remove their own Super Admin role.
      it('for the own Super Admin role, which stays in force', async () => {
        const own = await give({ accountId: administrator, role: 'super_admin', branchId: null });

        await expect(end(own.id, null, administrator)).rejects.toBeInstanceOf(
          OwnSuperAdminRemovalError,
        );

        expect(await current(administrator)).toMatchObject([{ id: own.id, role: 'super_admin' }]);
        expect(await auditOf(own.id, 'audit_log_school')).toHaveLength(1);
      });

      it('not for the Super Admin role of somebody else, nor for another role of one’s own', async () => {
        const colleague = await account('Nodir', 'Valiyev');
        const theirs = await give({ accountId: colleague, role: 'super_admin', branchId: null });
        const ownOther = await give({ accountId: administrator, role: 'teacher', branchId: north });

        await end(theirs.id, null, administrator);
        await end(ownOther.id, north, administrator);

        expect(await current(colleague)).toEqual([]);
        expect(await current(administrator)).toMatchObject([{ role: 'super_admin' }]);
      });
    });
  });
});

// docs/spec/02-roles-and-access.md, Super Admin: "At most 3 accounts."
describe('the Super Admin role', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let assignments: Assignments;
  let accounts: Accounts;
  const clock = new FixedClock(START);

  async function account(firstName: string, lastName: string): Promise<string> {
    const created = await transactions.run([], (transaction) =>
      accounts.create(transaction, { firstName, lastName, createdBy: null }),
    );
    return created.id;
  }

  const give = (accountId: string, validFrom?: Date) =>
    transactions.run([], (transaction) =>
      assignments.give(transaction, {
        accountId,
        role: 'super_admin',
        branchId: null,
        givenBy: null,
        ...(validFrom === undefined ? {} : { validFrom }),
      }),
    );

  async function superAdmins(): Promise<number> {
    const found = await sql<{ rows: number }>`
      select count(distinct account_id)::int as rows from assignments
      where role = 'super_admin' and valid_until is null
    `.execute(database.migrator);
    return found.rows[0]?.rows ?? -1;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, clock);
    const audit = new Audit(clock);
    assignments = new Assignments(audit);
    accounts = new Accounts(clock, audit);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('is held by at most 3 accounts, also when two are given at the same moment', async () => {
    const [first, second, third, fourth] = [
      await account('Aziz', 'Saidov'),
      await account('Barno', 'Saidova'),
      await account('Charos', 'Saidova'),
      await account('Davron', 'Saidov'),
    ];
    await give(first ?? '');
    await give(second ?? '');

    const runs = await Promise.allSettled([give(third ?? ''), give(fourth ?? '')]);

    expect(runs.map((run) => run.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(runs.find((run) => run.status === 'rejected')?.reason).toBeInstanceOf(
      TooManySuperAdminsError,
    );
    expect(await superAdmins()).toBe(3);
  });

  it('counts one that begins later', async () => {
    // Three hold it; one of them ends, and the place is given for next month.
    const held = await sql<{ id: string; account_id: string }>`
      select id, account_id from assignments order by id
    `.execute(database.migrator);
    const [first, second] = held.rows;
    await transactions.run([], (transaction) =>
      assignments.end(transaction, {
        assignmentId: first?.id ?? '',
        endedBy: second?.account_id ?? '',
        notifications: noNotices,
      }),
    );
    const later = await account('Elyor', 'Saidov');
    await give(later, new Date('2026-11-05T09:00:00+05:00'));

    const fifth = await account('Feruza', 'Saidova');
    await expect(give(fifth)).rejects.toBeInstanceOf(TooManySuperAdminsError);
  });

  it('does not count one that has ended', async () => {
    const held = await sql<{ id: string; account_id: string }>`
      select id, account_id from assignments where valid_until is null order by id
    `.execute(database.migrator);
    const [first, second] = held.rows;
    await transactions.run([], (transaction) =>
      assignments.end(transaction, {
        assignmentId: second?.id ?? '',
        endedBy: first?.account_id ?? '',
        notifications: noNotices,
      }),
    );

    const sixth = await account('Gulom', 'Saidov');
    await give(sixth);

    expect(await superAdmins()).toBe(3);
  });

  // Found by the review: its end is its start, next month, and it holds no place.
  it('does not count one that was taken back before it began', async () => {
    const seventh = await account('Hilola', 'Saidova');
    await expect(give(seventh)).rejects.toBeInstanceOf(TooManySuperAdminsError);
    const later = await sql<{ id: string }>`
      select id from assignments where valid_from > ${clock.now()}
    `.execute(database.migrator);
    const holder = await sql<{ account_id: string }>`
      select account_id from assignments
      where valid_until is null and valid_from <= ${clock.now()} limit 1
    `.execute(database.migrator);

    await transactions.run([], (transaction) =>
      assignments.end(transaction, {
        assignmentId: later.rows[0]?.id ?? '',
        endedBy: holder.rows[0]?.account_id ?? '',
        notifications: noNotices,
      }),
    );
    await give(seventh);

    expect(await superAdmins()).toBe(3);
  });
});
