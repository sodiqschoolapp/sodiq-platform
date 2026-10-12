import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { insertSubject } from '../../testing/subjects-kit.js';
import { insertAppointmentSubjects } from './appointment-subjects.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA';

const MONDAY = '2026-10-05T09:00:00+05:00';
const WEDNESDAY = '2026-10-07T00:00:00+05:00';
const FRIDAY = '2026-10-09T00:00:00+05:00';
const NEXT_MONDAY = '2026-10-12T00:00:00+05:00';

// The rules of Head Teacher appointments that the database itself keeps
// (db/migrations/0028), also when the application has a fault. `02`, Head
// Teachers and Senior Head Teachers: "A subject in a branch has at most one
// Head Teacher"; appointments carry dates. Written as the application user,
// whose transactions carry `app.now` from the injected clock.
describe('the subjects of appointments in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let first: string;
  let second: string;
  let north: string;
  let south: string;
  let mathematics: string;
  let physics: string;
  const clock = new FixedClock(MONDAY);

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

  /** Inserts an assignment in the caller's transaction, as `Assignments.give` does. */
  async function insertAssignment(
    transaction: Transaction,
    held: { account: string; role: string; branch: string | null; from: string; until?: string },
  ): Promise<string> {
    const inserted = await transaction
      .insertInto('assignments')
      .values({
        account_id: held.account,
        role: held.role,
        branch_id: held.branch,
        valid_from: new Date(held.from),
        valid_until: held.until === undefined ? null : new Date(held.until),
        created_at: new Date(MONDAY),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return inserted.id;
  }

  function addSubjects(transaction: Transaction, assignment: string, subjects: readonly string[]) {
    return insertAppointmentSubjects(transaction, assignment, subjects);
  }

  /** An appointment with its subjects, in one transaction of the application. */
  function appoint(
    held: { account: string; role: string; branch: string | null; from: string; until?: string },
    subjects: readonly string[],
  ): Promise<string> {
    return transactions.run([], async (transaction) => {
      const id = await insertAssignment(transaction, held);
      await addSubjects(transaction, id, subjects);
      return id;
    });
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

  async function rowsOf(id: string) {
    return database.migrator
      .selectFrom('assignment_subjects')
      .select(['subject_id', 'role', 'branch_id', 'valid_from', 'valid_until'])
      .where('assignment_id', '=', id)
      .orderBy('subject_id')
      .execute();
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, clock);
    first = await newAccount('a.karimov');
    second = await newAccount('b.karimova');
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    mathematics = await insertSubject(database.migrator, 'Mathematics');
    physics = await insertSubject(database.migrator, 'Physics');
  });

  beforeEach(async () => {
    clock.set(MONDAY);
    await sql`delete from assignment_subjects`.execute(database.migrator);
    await sql`delete from assignments`.execute(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('copies the role, branch and dates of the assignment', async () => {
    const id = await appoint(
      { account: first, role: 'head_teacher', branch: north, from: WEDNESDAY, until: NEXT_MONDAY },
      [mathematics, physics],
    );

    const rows = await rowsOf(id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        role: 'head_teacher',
        branch_id: north,
        valid_from: new Date(WEDNESDAY),
        valid_until: new Date(NEXT_MONDAY),
      });
    }
  });

  it('refuses a second Head Teacher of a subject in a branch at an overlapping time', async () => {
    await appoint({ account: first, role: 'head_teacher', branch: north, from: WEDNESDAY }, [
      mathematics,
    ]);

    await expect(
      appoint({ account: second, role: 'head_teacher', branch: north, from: FRIDAY }, [
        physics,
        mathematics,
      ]),
    ).rejects.toMatchObject({
      code: EXCLUSION_VIOLATION,
      constraint: 'assignment_subjects_one_head_teacher',
    });
    expect(await database.migrator.selectFrom('assignments').select('id').execute()).toHaveLength(
      1,
    );
  });

  it('allows the same subject in another branch, and a Head Teacher who follows at the end', async () => {
    const before = await appoint(
      { account: first, role: 'head_teacher', branch: north, from: WEDNESDAY, until: FRIDAY },
      [mathematics],
    );
    await appoint({ account: second, role: 'head_teacher', branch: south, from: WEDNESDAY }, [
      mathematics,
    ]);
    const after = await appoint(
      { account: second, role: 'head_teacher', branch: north, from: FRIDAY },
      [mathematics],
    );

    expect(await rowsOf(before)).toHaveLength(1);
    expect(await rowsOf(after)).toHaveLength(1);
  });

  it('refuses a second Senior Head Teacher of a subject in the school (decision 4)', async () => {
    await appoint({ account: first, role: 'senior_head_teacher', branch: null, from: WEDNESDAY }, [
      mathematics,
    ]);

    await expect(
      appoint({ account: second, role: 'senior_head_teacher', branch: null, from: FRIDAY }, [
        mathematics,
      ]),
    ).rejects.toMatchObject({ constraint: 'assignment_subjects_one_senior' });
  });

  it('lets one person be the Head Teacher and another the Senior Head Teacher of a subject', async () => {
    await appoint({ account: first, role: 'head_teacher', branch: north, from: WEDNESDAY }, [
      mathematics,
    ]);
    const senior = await appoint(
      { account: second, role: 'senior_head_teacher', branch: null, from: WEDNESDAY },
      [mathematics],
    );

    expect(await rowsOf(senior)).toMatchObject([{ role: 'senior_head_teacher', branch_id: null }]);
  });

  it('refuses subjects on an assignment of another role', async () => {
    await expect(
      appoint({ account: first, role: 'teacher', branch: north, from: WEDNESDAY }, [mathematics]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'assignment_subjects_role' });
  });

  it('refuses a subject added to an appointment of an earlier transaction', async () => {
    const id = await appoint(
      { account: first, role: 'head_teacher', branch: north, from: WEDNESDAY },
      [mathematics],
    );

    await expect(
      transactions.run([], (transaction) => addSubjects(transaction, id, [physics])),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'assignment_subjects_fixed' });
  });

  it('refuses a subject added to an appointment the transaction only ended', async () => {
    const id = await appoint(
      { account: first, role: 'head_teacher', branch: north, from: WEDNESDAY },
      [mathematics],
    );

    await expect(
      transactions.run([], async (transaction) => {
        await transaction
          .updateTable('assignments')
          .set({ valid_until: new Date(FRIDAY) })
          .where('id', '=', id)
          .execute();
        await addSubjects(transaction, id, [physics]);
      }),
    ).rejects.toMatchObject({ constraint: 'assignment_subjects_fixed' });
    expect(await rowsOf(id)).toMatchObject([{ subject_id: mathematics, valid_until: null }]);
  });

  it('accepts subjects written under a savepoint of the transaction, as the give does', async () => {
    const id = await transactions.run([], async (transaction) => {
      await sql`savepoint given`.execute(transaction);
      const given = await insertAssignment(transaction, {
        account: first,
        role: 'head_teacher',
        branch: north,
        from: WEDNESDAY,
      });
      await sql`release savepoint given`.execute(transaction);
      await addSubjects(transaction, given, [mathematics]);
      return given;
    });

    expect(await rowsOf(id)).toHaveLength(1);
  });

  it('refuses an archived subject (decision 12)', async () => {
    const archived = await insertSubject(database.migrator, 'Astronomy', new Date(MONDAY));

    await expect(
      appoint({ account: first, role: 'head_teacher', branch: north, from: WEDNESDAY }, [archived]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'assignment_subjects_archived' });
  });

  it.each(['head_teacher', 'senior_head_teacher'])(
    'refuses at commit a %s assignment without subjects',
    async (role) => {
      await expect(
        transactions.run([], (transaction) =>
          insertAssignment(transaction, {
            account: first,
            role,
            branch: role === 'head_teacher' ? north : null,
            from: WEDNESDAY,
          }),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'assignments_subjects_needed' });
      expect(await database.migrator.selectFrom('assignments').select('id').execute()).toEqual([]);
    },
  );

  it('moves the end of the subject rows with every end of the assignment', async () => {
    const id = await appoint(
      { account: first, role: 'head_teacher', branch: north, from: WEDNESDAY },
      [mathematics, physics],
    );

    await setEnd(id, NEXT_MONDAY);
    expect((await rowsOf(id)).map((row) => row.valid_until)).toEqual([
      new Date(NEXT_MONDAY),
      new Date(NEXT_MONDAY),
    ]);
    await setEnd(id, FRIDAY);
    expect((await rowsOf(id)).map((row) => row.valid_until)).toEqual([
      new Date(FRIDAY),
      new Date(FRIDAY),
    ]);
    await setEnd(id, null);
    expect((await rowsOf(id)).map((row) => row.valid_until)).toEqual([null, null]);
  });

  it('refuses an end moved later over a Head Teacher appointed meanwhile (decision 10)', async () => {
    const before = await appoint(
      { account: first, role: 'head_teacher', branch: north, from: WEDNESDAY, until: FRIDAY },
      [mathematics],
    );
    await appoint({ account: second, role: 'head_teacher', branch: north, from: FRIDAY }, [
      mathematics,
    ]);

    await expect(setEnd(before, null)).rejects.toMatchObject({
      code: EXCLUSION_VIOLATION,
      constraint: 'assignment_subjects_one_head_teacher',
    });
    expect((await rowsOf(before)).map((row) => row.valid_until)).toEqual([new Date(FRIDAY)]);
    expect(
      (
        await database.migrator
          .selectFrom('assignments')
          .select('valid_until')
          .where('id', '=', before)
          .executeTakeFirstOrThrow()
      ).valid_until,
    ).toEqual(new Date(FRIDAY));
  });

  it.each([
    ['update', 'update assignment_subjects set valid_until = null'],
    ['delete', 'delete from assignment_subjects'],
  ])('does not let the application %s a subject row', async (_name, statement) => {
    await appoint({ account: first, role: 'head_teacher', branch: north, from: WEDNESDAY }, [
      mathematics,
    ]);

    await expect(
      transactions.run([], (transaction) => sql.raw(statement).execute(transaction)),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });
});
