import { ROLES, SCHOOL_WIDE_ROLES } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { insertSubject } from '../../testing/subjects-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const EXCLUSION_VIOLATION = '23P01';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA';
const NOBODY = '00000000-0000-7000-8000-000000000000';

const MONDAY = '2026-10-05T09:00:00+05:00';
const TUESDAY = '2026-10-06T09:00:00+05:00';
const WEDNESDAY = '2026-10-07T09:00:00+05:00';

// The rules of assignments that the database itself keeps (db/migrations/0009),
// also when the application has a fault. Edge cases, "Who can act": rights are
// assignments: person, role, branch, with dates; a Senior Head Teacher's
// assignment has no branch.
describe('assignments in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let accountId: string;
  let colleagueId: string;
  let north: string;
  let south: string;
  const clock = new FixedClock(MONDAY);

  /** Runs one statement as the application user, in a school-wide transaction. */
  function asApp(statement: string): Promise<unknown> {
    return transactions.run([], (transaction) => sql.raw(statement).execute(transaction));
  }

  /** An insert of an assignment of the first account; `until` and `branch` may be `null`. */
  function insert(
    role: string,
    branch: string | null,
    from: string,
    until: string | null = null,
    account: string = accountId,
  ): Promise<unknown> {
    const quoted = (value: string | null) => (value === null ? 'null' : `'${value}'`);
    return asApp(
      `insert into assignments (account_id, role, branch_id, valid_from, valid_until, created_at)
       values ('${account}', '${role}', ${quoted(branch)}, '${from}', ${quoted(until)}, '${from}')`,
    );
  }

  async function newAccount(login: string): Promise<string> {
    const inserted = await transactions.run([], (transaction) =>
      transaction
        .insertInto('accounts')
        .values({
          login,
          password_hash: HASH,
          must_change_password: false,
          created_at: new Date(MONDAY),
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    return inserted.id;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, clock);
    accountId = await newAccount('a.karimov');
    colleagueId = await newAccount('b.karimova');
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
  });

  afterAll(async () => {
    await database.destroy();
  });

  // Asked for by the owner: the constraint "no two at the same moment" needs it.
  it('has the extension btree_gist', async () => {
    const found = await sql<{ extname: string }>`
      select extname from pg_extension where extname = 'btree_gist'
    `.execute(database.migrator);

    expect(found.rows).toEqual([{ extname: 'btree_gist' }]);
  });

  // docs/spec/02-roles-and-access.md: "There are 15 user types."
  describe('know the 15 roles', () => {
    it('with the same names as the code', async () => {
      const found = await sql<{ definition: string }>`
        select pg_get_constraintdef(oid) as definition from pg_constraint
        where conrelid = 'public.assignments'::regclass and conname = 'assignments_role_check'
      `.execute(database.migrator);
      const names = [...(found.rows[0]?.definition ?? '').matchAll(/'([a-z_]+)'/g)].map(
        (match) => match[1],
      );

      expect(names.sort()).toEqual([...ROLES].sort());
    });

    it.each(['accountant', 'admissions_manager', 'Teacher', ''])(
      'and refuse the role "%s"',
      async (role) => {
        await expect(insert(role, north, MONDAY)).rejects.toMatchObject({ code: CHECK_VIOLATION });
      },
    );
  });

  // Rules: every role is limited to a branch; only the Super Admin and the
  // Senior Head Teacher work across branches.
  describe('give every role a branch, except the two that work across branches', () => {
    const branchRoles = ROLES.filter((role) => !SCHOOL_WIDE_ROLES.includes(role));

    it.each(branchRoles)('refuse the role %s without a branch', async (role) => {
      await expect(insert(role, null, MONDAY)).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it.each(SCHOOL_WIDE_ROLES)('refuse the role %s with a branch', async (role) => {
      await expect(insert(role, north, MONDAY)).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('refuse a branch and an account that do not exist', async () => {
      await expect(insert('teacher', NOBODY, MONDAY)).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
      });
      await expect(insert('teacher', north, MONDAY, null, NOBODY)).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
      });
    });
  });

  describe('hold one role in one branch once at any moment', () => {
    beforeAll(async () => {
      // Teacher in North from Monday to Wednesday; Super Admin from Monday on.
      await insert('teacher', north, MONDAY, WEDNESDAY);
      await insert('super_admin', null, MONDAY);
    });

    it.each([
      ['inside the first', TUESDAY, null],
      ['around the first', '2026-10-01T09:00:00+05:00', '2026-10-30T09:00:00+05:00'],
      ['over its start', '2026-10-01T09:00:00+05:00', TUESDAY],
      ['with the same moments', MONDAY, WEDNESDAY],
    ])('refuse a second one %s', async (_name, from, until) => {
      await expect(insert('teacher', north, from, until)).rejects.toMatchObject({
        code: EXCLUSION_VIOLATION,
      });
    });

    it('refuse it for a role without a branch too', async () => {
      await expect(insert('super_admin', null, TUESDAY)).rejects.toMatchObject({
        code: EXCLUSION_VIOLATION,
      });
    });

    // The end is not part of the time: one that begins at that moment follows it.
    it('accept one that begins at the moment the first ends, and one that ends where it begins', async () => {
      await insert('teacher', north, WEDNESDAY);
      await insert('teacher', north, '2026-10-01T09:00:00+05:00', MONDAY);
    });

    it('accept the same role in another branch, another role in the same branch, and another person', async () => {
      await insert('teacher', south, MONDAY);
      await insert('tutor', north, MONDAY);
      await insert('teacher', north, MONDAY, null, colleagueId);
    });

    // An assignment that was given for a later day and taken back was never in force.
    it('accept an assignment that ends at its start beside one in force', async () => {
      await insert('tutor', north, TUESDAY, TUESDAY);
    });
  });

  it('refuse an end before the start', async () => {
    await expect(insert('head_tutor', north, TUESDAY, MONDAY)).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    });
  });

  it('refuse a name of who ended it without an end', async () => {
    await expect(
      asApp(`update assignments set ended_by = '${colleagueId}' where valid_until is null`),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  // History shows who held which role when: an assignment is ended, never removed or rewritten.
  describe('are ended, never removed or rewritten', () => {
    it('refuse the application user a delete', async () => {
      await expect(asApp('delete from assignments')).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });

    it.each([
      ['the account', `account_id = '${NOBODY}'`],
      ['the role', `role = 'principal'`],
      ['the branch', `branch_id = '${NOBODY}'`],
      ['the start', `valid_from = '${TUESDAY}'`],
      ['who gave it', `given_by = '${NOBODY}'`],
      ['the moment it was written', `created_at = '${TUESDAY}'`],
    ])('refuse the application user a change of %s', async (_name, change) => {
      await expect(asApp(`update assignments set ${change}`)).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    });

    it('let the application user write the end and who ended it', async () => {
      await asApp(
        `update assignments set valid_until = '${WEDNESDAY}', ended_by = '${colleagueId}'
         where role = 'super_admin'`,
      );

      const found = await sql<{ valid_until: Date | null; ended_by: string | null }>`
        select valid_until, ended_by from assignments where role = 'super_admin'
      `.execute(database.migrator);
      expect(found.rows).toEqual([{ valid_until: new Date(WEDNESDAY), ended_by: colleagueId }]);
    });
  });

  // The owner's rule of 0.7a, held by `assignments_end_guard` (db/migrations/0027;
  // decision 3 and correction 5 of pull request #62): an end that has passed is
  // final, an end still ahead may be moved or emptied, and no new end lies
  // before 00:00 of the day of the injected clock (`app.now`).
  describe('keep an end that has passed', () => {
    let endsAccount: string;
    const MONDAY_START = '2026-10-05T00:00:00+05:00';

    /** A Teacher assignment of the account in North from last week, with the end given, written by the migrator. */
    async function given(until: string | null): Promise<string> {
      const found = await sql<{ id: string }>`
        insert into assignments (account_id, role, branch_id, valid_from, valid_until, created_at)
        values (${endsAccount}, 'teacher', ${north}, '2026-09-28T09:00:00+05:00',
          ${until}, '2026-09-28T09:00:00+05:00')
        returning id
      `.execute(database.migrator);
      const row = found.rows[0];
      if (row === undefined) {
        throw new Error('No assignment was written.');
      }
      return row.id;
    }

    /** Ends of earlier tests are closed, so the next one does not overlap. */
    async function clear(): Promise<void> {
      await sql`
        update assignments set valid_until = valid_from where account_id = ${endsAccount}
      `.execute(database.migrator);
    }

    function setEnd(id: string, until: string | null): Promise<unknown> {
      return transactions.run([], (transaction) =>
        transaction
          .updateTable('assignments')
          .set({ valid_until: until === null ? null : new Date(until) })
          .where('id', '=', id)
          .execute(),
      );
    }

    const until = async (id: string): Promise<Date | null> => {
      const found = await sql<{ valid_until: Date | null }>`
        select valid_until from assignments where id = ${id}
      `.execute(database.migrator);
      return found.rows[0]?.valid_until ?? null;
    };

    beforeAll(async () => {
      endsAccount = await newAccount('e.ends');
    });

    it('runs as the invoker, not with the rights of its owner', async () => {
      const found = await sql<{ prosecdef: boolean }>`
        select prosecdef from pg_proc where proname = 'assignments_end_guard'
      `.execute(database.migrator);

      expect(found.rows).toEqual([{ prosecdef: false }]);
    });

    it('refuses the application user an end without the moment of the transaction', async () => {
      await clear();
      const id = await given(null);

      await expect(
        sql`update assignments set valid_until = ${WEDNESDAY} where id = ${id}`.execute(
          database.app,
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'assignment_end_needs_moment' });
      expect(await until(id)).toBeNull();
    });

    it('lets the migrator write an end without it', async () => {
      await clear();
      const id = await given(null);

      await sql`update assignments set valid_until = ${WEDNESDAY} where id = ${id}`.execute(
        database.migrator,
      );

      expect(await until(id)).toEqual(new Date(WEDNESDAY));
    });

    it('writes an end now, and one at 00:00 of today (a person who leaves today)', async () => {
      clock.set(MONDAY);
      await clear();
      const now = await given(null);
      await setEnd(now, MONDAY);
      expect(await until(now)).toEqual(new Date(MONDAY));

      await clear();
      const today = await given(null);
      await setEnd(today, MONDAY_START);
      expect(await until(today)).toEqual(new Date(MONDAY_START));
    });

    it('refuses a new end before 00:00 of today', async () => {
      clock.set(MONDAY);
      await clear();
      const id = await given(null);

      await expect(setEnd(id, '2026-10-04T23:59:00+05:00')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'assignment_end_past',
      });
      expect(await until(id)).toBeNull();
    });

    it('moves and empties an end that is still ahead', async () => {
      clock.set(MONDAY);
      await clear();
      const id = await given(WEDNESDAY);

      await setEnd(id, TUESDAY);
      expect(await until(id)).toEqual(new Date(TUESDAY));
      await setEnd(id, null);
      expect(await until(id)).toBeNull();
    });

    it.each([
      ['moved later', WEDNESDAY],
      ['emptied', null],
    ])('refuses an end that has passed to be %s', async (_name, value) => {
      clock.set(MONDAY);
      await clear();
      const id = await given('2026-10-05T08:00:00+05:00');

      await expect(setEnd(id, value)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'assignment_end_final',
      });
      expect(await until(id)).toEqual(new Date('2026-10-05T08:00:00+05:00'));
    });

    it('takes 00:00 in the time zone of the school for a role without a branch', async () => {
      clock.set('2026-10-05T00:30:00+05:00');
      const subject = await insertSubject(database.migrator);
      // A Senior Head Teacher has subjects (db/migrations/0028), written in the same transaction.
      const id = await database.migrator.transaction().execute(async (transaction) => {
        const found = await sql<{ id: string }>`
          insert into assignments (account_id, role, branch_id, valid_from, created_at)
          values (${endsAccount}, 'senior_head_teacher', null, '2026-09-28T09:00:00+05:00',
            '2026-09-28T09:00:00+05:00')
          returning id
        `.execute(transaction);
        const given = found.rows[0]?.id ?? '';
        await sql`insert into assignment_subjects (assignment_id, subject_id) values (${given}, ${subject})`.execute(
          transaction,
        );
        return given;
      });

      await expect(setEnd(id, '2026-10-04T23:59:00+05:00')).rejects.toMatchObject({
        constraint: 'assignment_end_past',
      });
      await setEnd(id, MONDAY_START);
      expect(await until(id)).toEqual(new Date(MONDAY_START));
      clock.set(MONDAY);
    });
  });
});
