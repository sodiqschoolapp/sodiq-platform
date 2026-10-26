import { STATUS_CAUSES, STATUS_REASON_MAX_LENGTH, studentNameKey } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../database/database.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { moveStudentBranch } from '../../testing/members-kit.js';
import { linkRelative } from '../../testing/relatives-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const UNIQUE_VIOLATION = '23505';

const HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
const MOMENT = '2026-10-12T09:00:00+05:00';

// What the database keeps of leaving, return and delete (db/migrations/0033,
// task 2.4b-1, pull request #68), also when the application has a fault: the
// cause and reason of each status row; no status row dated in a closed
// academic year (edge/students-classes-groups: "A date in a closed quarter is
// refused"), but the move to another branch passes (correction 1); the
// delete of a student created twice only without data (edge: "may delete a
// student only if there is no ... data"; decisions 4 and 14), taking the
// children with it and keeping its UIDs reserved for good (decision 3;
// developer-rules, Identifiers). All names are invented.
describe('leaving, return and delete in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let account: string;
  let count = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** A student written as the create of the service writes one, active from `startsOn`. */
  async function createStudent(
    branch: string,
    options: { uid?: string; startsOn?: string; scholarship?: boolean } = {},
  ): Promise<{ id: string; uid: string }> {
    count += 1;
    const uid = options.uid ?? String(2607100 + count);
    const startsOn = options.startsOn ?? '2026-09-02';
    const id = await inBranch(branch, async (transaction) => {
      const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
      const newId = found.rows[0]?.id ?? '';
      await transaction
        .insertInto('students')
        .values({
          id: newId,
          branch_id: branch,
          uid,
          first_name: 'Dilnoza',
          last_name: `Qodirova${'a'.repeat(count % 5)}`,
          name_key: studentNameKey(`Qodirova${'a'.repeat(count % 5)}`, 'Dilnoza'),
          sex: 'female',
          birth_date: '2013-04-04',
          grade: 8,
          starts_on: startsOn,
          created_by: account,
          ...(options.scholarship === true
            ? { scholarship_type: 'merit', scholarship_coverage: 'full' }
            : {}),
        })
        .execute();
      await transaction
        .insertInto('student_uids')
        .values({ uid, student_id: newId, branch_id: branch, held_from: new Date(MOMENT) })
        .execute();
      await transaction
        .insertInto('student_contracts')
        .values({
          student_id: newId,
          branch_id: branch,
          number: `L-${String(count)}`,
          signed_on: '2026-08-20',
        })
        .execute();
      await transaction
        .insertInto('student_statuses')
        .values({
          student_id: newId,
          branch_id: branch,
          status: 'active',
          valid_from: startsOn,
          cause: 'start',
        })
        .execute();
      await transaction
        .insertInto('student_accounts')
        .values({ student_id: newId, branch_id: branch, created_at: new Date(MOMENT) })
        .execute();
      await linkRelative(transaction, newId, branch, new Date(MOMENT));
      return newId;
    });
    return { id, uid };
  }

  /** The status rows of a student as the leaving of the service writes them. */
  async function leave(
    db: Database | Transaction,
    branch: string,
    id: string,
    from: string,
  ): Promise<void> {
    await db
      .updateTable('student_statuses')
      .set({ valid_until: from })
      .where('student_id', '=', id)
      .where('valid_until', 'is', null)
      .execute();
    await db
      .insertInto('student_statuses')
      .values({
        student_id: id,
        branch_id: branch,
        status: 'inactive',
        valid_from: from,
        cause: 'leaving',
        reason: 'Moved away',
      })
      .execute();
  }

  /** Academic years of a branch with their four undated quarters, all planned. */
  async function years(branch: string, ranges: readonly (readonly [string, string])[]) {
    const ids: string[] = [];
    for (const [start, end] of ranges) {
      await database.migrator.transaction().execute(async (transaction) => {
        const year = await transaction
          .insertInto('academic_years')
          .values({ branch_id: branch, start_date: start, end_date: end })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const number of [1, 2, 3, 4]) {
          await transaction
            .insertInto('quarters')
            .values({ branch_id: branch, academic_year_id: year.id, number })
            .execute();
        }
        ids.push(year.id);
      });
    }
    return ids;
  }

  const setYear = (id: string, status: 'current' | 'closed') =>
    database.migrator.updateTable('academic_years').set({ status }).where('id', '=', id).execute();

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(MOMENT));
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    account = (
      await database.migrator
        .insertInto('accounts')
        .values({
          login: 'b.qodirova',
          password_hash: HASH,
          must_change_password: false,
          created_at: new Date(MOMENT),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('cause and reason of a status row', () => {
    it('takes the causes of packages/shared and nothing else, and names one always', async () => {
      const { id } = await createStudent(north);
      const insert = (cause: string | undefined, reason: string | null) =>
        database.migrator
          .insertInto('student_statuses')
          .values({
            student_id: id,
            branch_id: north,
            status: 'active',
            valid_from: '2027-01-01',
            valid_until: '2027-01-01',
            ...(cause === undefined ? {} : { cause }),
            reason,
          } as never)
          .execute();
      await expect(insert('moved', null)).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(insert(undefined, null)).rejects.toMatchObject({ code: NOT_NULL_VIOLATION });
      for (const cause of STATUS_CAUSES) {
        await expect(insert(cause, 'A reason'), cause).resolves.toBeDefined();
      }
    });

    it('wants a reason for a leaving, an undo and a restore, of at most the shared bound', async () => {
      const { id } = await createStudent(north);
      const insert = (cause: string, reason: string | null) =>
        database.migrator
          .insertInto('student_statuses')
          .values({
            student_id: id,
            branch_id: north,
            status: 'inactive',
            valid_from: '2027-02-01',
            valid_until: '2027-02-01',
            cause,
            reason,
          })
          .execute();
      for (const cause of ['leaving', 'undo', 'restore']) {
        await expect(insert(cause, null), cause).rejects.toMatchObject({ code: CHECK_VIOLATION });
      }
      await expect(insert('cancel', null)).resolves.toBeDefined();
      await expect(insert('return', null)).resolves.toBeDefined();
      await expect(insert('leaving', 'x'.repeat(STATUS_REASON_MAX_LENGTH))).resolves.toBeDefined();
      await expect(
        insert('leaving', 'x'.repeat(STATUS_REASON_MAX_LENGTH + 1)),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(insert('leaving', ' padded ')).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('lets nobody change the cause or the reason of a row', async () => {
      const { id } = await createStudent(north);
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('student_statuses')
            .set({ cause: 'return' })
            .where('student_id', '=', id)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(
        database.migrator
          .updateTable('student_statuses')
          .set({ reason: 'Changed later' })
          .where('student_id', '=', id)
          .execute(),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });

  describe('a closed academic year (correction 1)', () => {
    let branch: string;
    let student: string;

    beforeAll(async () => {
      branch = await insertBranch(database.migrator, 'Closed year branch');
      const [first, second] = await years(branch, [
        ['2025-09-01', '2026-05-31'],
        ['2026-09-01', '2027-05-31'],
      ]);
      student = (await createStudent(branch, { startsOn: '2025-09-02' })).id;
      await setYear(first ?? '', 'current');
      await setYear(first ?? '', 'closed');
      expect(second).toBeDefined();
    });

    it('refuses a row that starts in it, as the application and as the migrator', async () => {
      for (const db of ['app', 'migrator'] as const) {
        const write = (target: Database | Transaction) =>
          leave(target, branch, student, '2026-05-16');
        const attempt =
          db === 'app'
            ? inBranch(branch, (transaction) => write(transaction))
            : write(database.migrator);
        await expect(attempt, db).rejects.toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'student_statuses_closed_year',
        });
      }
    });

    it('refuses an end moved into it, and takes a row of an open year', async () => {
      await expect(
        database.migrator
          .updateTable('student_statuses')
          .set({ valid_until: '2026-04-01' })
          .where('student_id', '=', student)
          .execute(),
      ).rejects.toMatchObject({ constraint: 'student_statuses_closed_year' });
      await expect(
        inBranch(branch, (transaction) => leave(transaction, branch, student, '2026-10-11')),
      ).resolves.toBeUndefined();
    });

    it('lets the move to another branch carry rows that start and end in a closed year there', async () => {
      // The sending branch has its years open; the receiving one has 2025–2026
      // closed. The student's rows end and start on 1 March 2026, inside it: a
      // guard that checked every update, or the start of a row on update,
      // would refuse the move (correction 1; code review, finding 1).
      const sending = await insertBranch(database.migrator, 'Sending branch');
      await years(sending, [['2025-09-01', '2026-05-31']]);
      const receiving = await insertBranch(database.migrator, 'Receiving branch');
      const [closed] = await years(receiving, [['2025-09-01', '2026-05-31']]);
      const { id } = await createStudent(sending, { startsOn: '2025-09-02' });
      await inBranch(sending, (transaction) => leave(transaction, sending, id, '2026-03-01'));
      await setYear(closed ?? '', 'current');
      await setYear(closed ?? '', 'closed');
      // Task 3.3c: the branch changes only with an accepted move (0053).
      await expect(
        moveStudentBranch(database.migrator, id, sending, receiving),
      ).resolves.toBeUndefined();
      const rows = await database.migrator
        .selectFrom('student_statuses')
        .select(['branch_id', 'valid_from', 'valid_until'])
        .where('student_id', '=', id)
        .orderBy('valid_from')
        .execute();
      expect(rows).toEqual([
        { branch_id: receiving, valid_from: '2025-09-02', valid_until: '2026-03-01' },
        { branch_id: receiving, valid_from: '2026-03-01', valid_until: null },
      ]);
    });

    it('refuses a row inserted to start in it, with no update before it', async () => {
      // An empty range overlaps nothing: only the insert branch of the guard can refuse it.
      const insert = (target: Database | Transaction) =>
        target
          .insertInto('student_statuses')
          .values({
            student_id: student,
            branch_id: branch,
            status: 'active',
            valid_from: '2026-05-16',
            valid_until: '2026-05-16',
            cause: 'cancel',
          })
          .execute();
      await expect(inBranch(branch, (transaction) => insert(transaction))).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'student_statuses_closed_year',
      });
      await expect(insert(database.migrator)).rejects.toMatchObject({
        constraint: 'student_statuses_closed_year',
      });
      // The same row in the open year passes: the refusal is the year's.
      await expect(
        inBranch(branch, (transaction) =>
          transaction
            .insertInto('student_statuses')
            .values({
              student_id: student,
              branch_id: branch,
              status: 'active',
              valid_from: '2026-09-16',
              valid_until: '2026-09-16',
              cause: 'cancel',
            })
            .execute(),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('the close of a year at the same moment as a status row', () => {
    it('makes a close wait for a leaving that holds the year, both directions', async () => {
      const branch = await insertBranch(database.migrator, 'Race two');
      const [year] = await years(branch, [['2026-09-01', '2027-05-31']]);
      const one = await createStudent(branch);
      await setYear(year ?? '', 'current');

      // A leaving holds the year FOR SHARE: the close waits, then closes.
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const writer = inBranch(branch, async (transaction) => {
        await leave(transaction, branch, one.id, '2026-10-11');
        ready();
        await released;
      });
      await isReady;
      const close = setYear(year ?? '', 'closed');
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      release();
      await writer;
      await close;
      const rows = await database.migrator
        .selectFrom('student_statuses')
        .select('status')
        .where('student_id', '=', one.id)
        .where('valid_until', 'is', null)
        .execute();
      expect(rows).toEqual([{ status: 'inactive' }]);

      // The other way: a close holds the year row; a leaving waits, then is refused.
      const branchTwo = await insertBranch(database.migrator, 'Race three');
      const [yearTwo] = await years(branchTwo, [['2026-09-01', '2027-05-31']]);
      const three = await createStudent(branchTwo);
      await setYear(yearTwo ?? '', 'current');
      let releaseClose: () => void = () => undefined;
      const closeReleased = new Promise<void>((resolve) => {
        releaseClose = resolve;
      });
      let closeReady: () => void = () => undefined;
      const closeIsReady = new Promise<void>((resolve) => {
        closeReady = resolve;
      });
      const closing = database.migrator.transaction().execute(async (transaction) => {
        await transaction
          .updateTable('academic_years')
          .set({ status: 'closed' })
          .where('id', '=', yearTwo ?? '')
          .execute();
        closeReady();
        await closeReleased;
      });
      await closeIsReady;
      const late = inBranch(branchTwo, (transaction) =>
        leave(transaction, branchTwo, three.id, '2026-10-11'),
      ).then(
        () => 'written',
        (error: unknown) => (error as { constraint?: string }).constraint,
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      releaseClose();
      await closing;
      expect(await late).toBe('student_statuses_closed_year');
    });
  });

  describe('the delete of a student created twice (decisions 3, 4 and 14)', () => {
    const deleteStudent = (branch: string, id: string) =>
      inBranch(branch, (transaction) =>
        transaction.deleteFrom('students').where('id', '=', id).executeTakeFirst(),
      );

    it('keeps the UID of a deleted student reserved in any spelling (task 9.4c)', async () => {
      const { id } = await createStudent(north, { uid: 'Dl2607901' });
      expect((await deleteStudent(north, id)).numDeletedRows).toBe(1n);
      for (const branch of [north, south]) {
        await expect(createStudent(branch, { uid: 'dL2607901' })).rejects.toMatchObject({
          code: UNIQUE_VIOLATION,
          constraint: 'student_uids_uid_key_idx',
        });
      }
    });

    it('takes the contract, the status rows and the account, and keeps the UID reserved', async () => {
      const { id, uid } = await createStudent(north);
      const result = await deleteStudent(north, id);
      expect(result.numDeletedRows).toBe(1n);
      for (const table of ['student_contracts', 'student_statuses', 'student_accounts'] as const) {
        const rows = await database.migrator
          .selectFrom(table)
          .select('student_id')
          .where('student_id', '=', id)
          .execute();
        expect(rows, table).toEqual([]);
      }
      const kept = await database.migrator
        .selectFrom('student_uids')
        .selectAll()
        .where('uid', '=', uid)
        .executeTakeFirstOrThrow();
      expect(kept).toMatchObject({ uid, student_id: null, branch_id: north });
      expect(kept.released_at).toEqual(new Date(MOMENT));
      for (const branch of [north, south]) {
        await expect(createStudent(branch, { uid })).rejects.toMatchObject({
          code: UNIQUE_VIOLATION,
        });
      }
    });

    it('refuses a student with a scholarship, a leaving, a graduation or a second contract', async () => {
      const scholar = await createStudent(north, { scholarship: true });
      const left = await createStudent(north);
      await inBranch(north, (transaction) => leave(transaction, north, left.id, '2026-10-01'));
      const scheduled = await createStudent(north);
      await inBranch(north, (transaction) => leave(transaction, north, scheduled.id, '2026-12-01'));
      const graduated = await createStudent(north);
      await database.migrator
        .updateTable('student_statuses')
        .set({ valid_until: '2026-10-01' })
        .where('student_id', '=', graduated.id)
        .execute();
      await database.migrator
        .insertInto('student_statuses')
        .values({
          student_id: graduated.id,
          branch_id: north,
          status: 'graduated',
          valid_from: '2026-10-01',
          cause: 'graduation',
        })
        .execute();
      const twice = await createStudent(north);
      await inBranch(north, (transaction) =>
        transaction
          .insertInto('student_contracts')
          .values({
            student_id: twice.id,
            branch_id: north,
            number: 'L-RETURN',
            signed_on: '2026-10-01',
          })
          .execute(),
      );
      for (const { id } of [scholar, left, scheduled, graduated, twice]) {
        await expect(deleteStudent(north, id)).rejects.toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'students_delete_guard',
        });
        await expect(
          database.migrator.deleteFrom('students').where('id', '=', id).execute(),
        ).rejects.toMatchObject({ constraint: 'students_delete_guard' });
      }
    });

    it('lets a student pass whose leaving was cancelled or undone', async () => {
      for (const cause of ['cancel', 'undo'] as const) {
        const { id } = await createStudent(north);
        await inBranch(north, async (transaction) => {
          await leave(transaction, north, id, '2026-10-01');
          await transaction
            .updateTable('student_statuses')
            .set({ valid_until: '2026-10-01' })
            .where('student_id', '=', id)
            .where('status', '=', 'inactive')
            .execute();
          await transaction
            .insertInto('student_statuses')
            .values({
              student_id: id,
              branch_id: north,
              status: 'active',
              valid_from: '2026-10-01',
              cause,
              reason: cause === 'undo' ? 'Entered by mistake' : null,
            })
            .execute();
        });
        expect((await deleteStudent(north, id)).numDeletedRows, cause).toBe(1n);
      }
    });

    it('deletes no student of another branch', async () => {
      const { id } = await createStudent(south);
      expect((await deleteStudent(north, id)).numDeletedRows).toBe(0n);
    });
  });

  describe('a reserved UID (decision 3)', () => {
    it('lets the application change no row of student_uids', async () => {
      const { id, uid } = await createStudent(north);
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('student_uids')
            .set({ student_id: null })
            .where('uid', '=', uid)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('student_uids')
            .set({ released_at: new Date(MOMENT) })
            .where('student_id', '=', id)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('lets nobody insert a UID that is already released (0034)', async () => {
      const { id } = await createStudent(north);
      for (const values of [
        { uid: '2607801', student_id: id, released_at: new Date(MOMENT) },
        { uid: '2607802', student_id: null, released_at: new Date(MOMENT) },
        { uid: '2607803', student_id: null, released_at: null },
      ]) {
        await expect(
          inBranch(north, (transaction) =>
            transaction
              .insertInto('student_uids')
              .values({ ...values, branch_id: north, held_from: new Date(MOMENT) })
              .execute(),
          ),
          values.uid,
        ).rejects.toMatchObject({ constraint: 'student_uids_insert_held' });
      }
    });

    it('releases a UID only through the delete of its student, with the moment of the transaction', async () => {
      const { id, uid } = await createStudent(north);
      // The migrator has no `app.now`: nothing is released without it.
      await expect(
        database.migrator
          .updateTable('student_uids')
          .set({ student_id: null })
          .where('uid', '=', uid)
          .execute(),
      ).rejects.toMatchObject({ constraint: 'student_uids_release_moment' });
      await expect(
        database.migrator
          .updateTable('student_uids')
          .set({ released_at: new Date(MOMENT) })
          .where('uid', '=', uid)
          .execute(),
      ).rejects.toMatchObject({ constraint: 'student_uids_release_only' });
      await expect(
        database.migrator
          .insertInto('student_uids')
          .values({
            uid: '2607999',
            student_id: null,
            branch_id: north,
            held_from: new Date(MOMENT),
          })
          .execute(),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      expect(id).toBeDefined();
    });
  });
});
