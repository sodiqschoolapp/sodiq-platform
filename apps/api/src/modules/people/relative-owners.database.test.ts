import { studentNameKey } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemClock } from '../../clock/system-clock.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { linkRelative } from '../../testing/relatives-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

const HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
const MOMENT = new Date('2026-10-12T09:00:00+05:00');

// The rules of the new owner of a phone, "no valid phone" and the merge that
// the database itself keeps (db/migrations/0037; task 2.5b-1, pull request
// #73): `relative_release_phone` writes only the phone of the exact holder,
// visible to the branch or not (decision 2), and names the Academic Vice
// Principals to tell (review finding 1); `relative_notice_accounts` names
// those of the other branches as ids (decision 5); a merged record has no
// phone, is archived at the commit and is never linked again (decisions 6
// and 9); "no valid phone" is set only by the function and cleared by a phone
// (decision 3). All names are invented.
describe('phone owners and merges in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let account: string;
  let southVice: string;
  let count = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  async function newAccount(login: string): Promise<string> {
    return (
      await database.migrator
        .insertInto('accounts')
        .values({ login, password_hash: HASH, must_change_password: false, created_at: MOMENT })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  async function give(
    accountId: string,
    branch: string,
    from: Date,
    until: Date | null = null,
  ): Promise<void> {
    await database.migrator
      .insertInto('assignments')
      .values({
        account_id: accountId,
        role: 'academic_vice_principal',
        branch_id: branch,
        valid_from: from,
        valid_until: until,
        created_at: from,
      })
      .execute();
  }

  async function writeStudent(transaction: Transaction, branch: string): Promise<string> {
    count += 1;
    const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
    const id = found.rows[0]?.id ?? '';
    const uid = String(2608000 + count);
    await transaction
      .insertInto('students')
      .values({
        id,
        branch_id: branch,
        uid,
        first_name: 'Malika',
        last_name: 'Usmonova',
        name_key: studentNameKey('Usmonova', 'Malika'),
        sex: 'female',
        birth_date: '2014-03-02',
        grade: 7,
        starts_on: '2026-09-02',
        created_by: account,
      })
      .execute();
    await transaction
      .insertInto('student_uids')
      .values({ uid, student_id: id, branch_id: branch, held_from: MOMENT })
      .execute();
    await transaction
      .insertInto('student_contracts')
      .values({ student_id: id, branch_id: branch, number: `RO-${uid}`, signed_on: '2026-08-20' })
      .execute();
    await transaction
      .insertInto('student_statuses')
      .values({
        student_id: id,
        branch_id: branch,
        status: 'active',
        valid_from: '2026-09-02',
        cause: 'start',
      })
      .execute();
    await transaction
      .insertInto('student_accounts')
      .values({ student_id: id, branch_id: branch, created_at: MOMENT })
      .execute();
    return id;
  }

  async function studentWithRelative(
    branch: string,
    phone: string | null = null,
  ): Promise<{ student: string; relative: string }> {
    return inBranch(branch, async (transaction) => {
      const student = await writeStudent(transaction, branch);
      const relative = await linkRelative(transaction, student, branch, MOMENT, { phone });
      return { student, relative };
    });
  }

  const linkTo = (transaction: Transaction, student: string, branch: string, relative: string) =>
    transaction
      .insertInto('student_relatives')
      .values({
        student_id: student,
        branch_id: branch,
        relative_id: relative,
        relationship: 'father',
        main_contact: false,
        linked_at: MOMENT,
      })
      .execute();

  const stored = (relative: string) =>
    database.migrator
      .selectFrom('relatives')
      .select(['phone', 'phone_invalid_since', 'merged_into', 'archived_at', 'full_name'])
      .where('id', '=', relative)
      .executeTakeFirstOrThrow();

  const release = (
    branch: string,
    relative: string,
    phone: string,
    newPhone: string | null,
    requestBranch: string = branch,
  ) =>
    inBranch(branch, async (transaction) => {
      const found = await sql<Record<string, unknown>>`
        select * from relative_release_phone(
          ${relative}::uuid, ${phone}, ${newPhone}, ${requestBranch}::uuid
        )
      `.execute(transaction);
      return found.rows;
    });

  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  async function holdOpen(branch: string, work: (transaction: Transaction) => Promise<void>) {
    let releaseIt: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      releaseIt = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = inBranch(branch, async (transaction) => {
      await work(transaction);
      ready();
      await released;
    });
    await Promise.race([isReady, done]);
    return { release: releaseIt, done };
  }

  async function untilWaiting(): Promise<void> {
    for (let tries = 0; tries < 100 && (await waitingForALock()) === 0; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await waitingForALock()).toBeGreaterThan(0);
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    account = await newAccount('b.yusupova');
    southVice = await newAccount('s.rahimov');
    await give(southVice, south, new Date('2026-01-01T00:00:00Z'));
    // An ended assignment and one in the future are never told.
    await give(
      await newAccount('o.ended'),
      south,
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-06-01T00:00:00Z'),
    );
    await give(await newAccount('o.future'), south, new Date('2099-01-01T00:00:00Z'));
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the new owner of a phone (decision 2)', () => {
    it('gives the holder of the exact phone a new phone, from a branch that does not see it', async () => {
      const holder = await studentWithRelative(south, '+998901120001');
      const targets = await release(north, holder.relative, '+998901120001', '+998901120002');
      expect(targets).toEqual([{ branch_id: south, account_id: southVice }]);
      expect(await stored(holder.relative)).toMatchObject({
        phone: '+998901120002',
        phone_invalid_since: null,
      });
    });

    it('sets "no valid phone" from the moment of the transaction', async () => {
      const holder = await studentWithRelative(south, '+998901120003');
      await release(north, holder.relative, '+998901120003', null);
      const row = await stored(holder.relative);
      expect(row.phone).toBeNull();
      expect(row.phone_invalid_since).not.toBeNull();
    });

    it('refuses a phone that moved and changes nothing', async () => {
      const holder = await studentWithRelative(south, '+998901120004');
      await expect(
        release(north, holder.relative, '+998901120099', '+998901120005'),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'relative_phone_changed' });
      expect((await stored(holder.relative)).phone).toBe('+998901120004');
    });

    it('raises the unique index for a taken new phone', async () => {
      const holder = await studentWithRelative(south, '+998901120006');
      await studentWithRelative(north, '+998901120007');
      await expect(
        release(north, holder.relative, '+998901120006', '+998901120007'),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'relatives_phone_idx' });
    });

    it('works on an archived holder', async () => {
      const holder = await studentWithRelative(north, '+998901120008');
      await inBranch(north, async (transaction) => {
        await linkRelative(transaction, holder.student, north, MOMENT, { mainContact: false });
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: false, unlinked_at: MOMENT })
          .where('relative_id', '=', holder.relative)
          .execute();
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: true })
          .where('student_id', '=', holder.student)
          .where('unlinked_at', 'is', null)
          .execute();
      });
      expect((await stored(holder.relative)).archived_at).not.toBeNull();
      expect(await release(south, holder.relative, '+998901120008', null)).toEqual([]);
      expect((await stored(holder.relative)).phone).toBeNull();
    });

    it('refuses a branch of the request outside the transaction (correction 3)', async () => {
      const holder = await studentWithRelative(south, '+998901120009');
      await expect(
        release(north, holder.relative, '+998901120009', null, south),
      ).rejects.toMatchObject({ constraint: 'relative_request_branch' });
      expect((await stored(holder.relative)).phone).toBe('+998901120009');
    });
  });

  describe('"no valid phone" (decision 3)', () => {
    it('is not written by the application, and a phone clears it while a name keeps it', async () => {
      const holder = await studentWithRelative(north, '+998901130001');
      await release(north, holder.relative, '+998901130001', null);
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('relatives')
            .set({ phone_invalid_since: null })
            .where('id', '=', holder.relative)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('relatives')
          .set({ full_name: 'Dilfuza Karimova' })
          .where('id', '=', holder.relative)
          .execute(),
      );
      expect((await stored(holder.relative)).phone_invalid_since).not.toBeNull();
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('relatives')
          .set({ phone: '+998901130002' })
          .where('id', '=', holder.relative)
          .execute(),
      );
      expect((await stored(holder.relative)).phone_invalid_since).toBeNull();
    });

    it('never stands with a phone: cleared on an update, refused on an insert', async () => {
      const holder = await studentWithRelative(north, '+998901130003');
      await database.migrator
        .updateTable('relatives')
        .set({ phone_invalid_since: MOMENT })
        .where('id', '=', holder.relative)
        .execute();
      expect((await stored(holder.relative)).phone_invalid_since).toBeNull();
      await expect(
        database.migrator
          .insertInto('relatives')
          .values({
            full_name: 'Dilfuza Karimova',
            name_key: 'dilfuza karimova',
            phone: '+998901130004',
            phone_invalid_since: MOMENT,
          })
          .execute(),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'relatives_phone_invalid_check',
      });
    });
  });

  describe('a merged record (decisions 6 and 9)', () => {
    /** Merges `merged` into `kept`, both of one branch, as the route does. */
    async function mergeInto(
      branch: string,
      merged: { student: string; relative: string },
      kept: string,
    ) {
      await inBranch(branch, async (transaction) => {
        await transaction
          .updateTable('relatives')
          .set({ phone: null, merged_into: kept })
          .where('id', '=', merged.relative)
          .execute();
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: false, unlinked_at: MOMENT })
          .where('relative_id', '=', merged.relative)
          .execute();
        await transaction
          .insertInto('student_relatives')
          .values({
            student_id: merged.student,
            branch_id: branch,
            relative_id: kept,
            relationship: 'mother',
            main_contact: true,
            linked_at: MOMENT,
          })
          .execute();
      });
    }

    it('is archived with its account off, and the kept record keeps its own', async () => {
      const kept = await studentWithRelative(north, '+998901140001');
      const merged = await studentWithRelative(north, '+998901140002');
      await mergeInto(north, merged, kept.relative);
      expect(await stored(merged.relative)).toMatchObject({
        phone: null,
        merged_into: kept.relative,
      });
      expect((await stored(merged.relative)).archived_at).not.toBeNull();
      const accounts = await database.migrator
        .selectFrom('relative_accounts')
        .select(['relative_id', 'switched_on_at'])
        .where('relative_id', 'in', [kept.relative, merged.relative])
        .execute();
      expect(accounts).toHaveLength(2);
      expect(accounts.every((one) => one.switched_on_at === null)).toBe(true);
    });

    it('refuses a merged record with a phone, into itself, and one left linked at the commit', async () => {
      const one = await studentWithRelative(north, '+998901140003');
      const other = await studentWithRelative(north, '+998901140004');
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('relatives')
            .set({ merged_into: other.relative })
            .where('id', '=', one.relative)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'relatives_merged_into_check' });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('relatives')
            .set({ phone: null, merged_into: one.relative })
            .where('id', '=', one.relative)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'relatives_merged_into_check' });
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('relatives')
            .set({ phone: null, merged_into: other.relative })
            .where('id', '=', one.relative)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'relative_merged_links' });
    });

    it('takes no change after the merge and is never linked again, also from another branch', async () => {
      const kept = await studentWithRelative(north, '+998901140005');
      const merged = await studentWithRelative(north, '+998901140006');
      await mergeInto(north, merged, kept.relative);
      await expect(
        database.migrator
          .updateTable('relatives')
          .set({ merged_into: null })
          .where('id', '=', merged.relative)
          .execute(),
      ).rejects.toMatchObject({ constraint: 'relative_merged' });
      for (const branch of [north, south]) {
        await expect(
          inBranch(branch, async (transaction) => {
            const student = await writeStudent(transaction, branch);
            await linkRelative(transaction, student, branch, MOMENT);
            await linkTo(transaction, student, branch, merged.relative);
          }),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'relative_merged' });
      }
      expect(await release(north, kept.relative, '+998901140005', '+998901140007')).toEqual([]);
    });

    it('refuses a merge that leaves a live link in a branch the transaction does not see', async () => {
      const kept = await studentWithRelative(north, '+998901140010');
      const merged = await studentWithRelative(north, '+998901140011');
      await inBranch(south, async (transaction) => {
        const student = await writeStudent(transaction, south);
        await linkRelative(transaction, student, south, MOMENT);
        await linkTo(transaction, student, south, merged.relative);
      });
      await expect(mergeInto(north, merged, kept.relative)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'relative_merged_links',
      });
      expect((await stored(merged.relative)).merged_into).toBeNull();
    });

    it('is never restored, and its account is never switched on (correction 2)', async () => {
      const kept = await studentWithRelative(north, '+998901140012');
      const merged = await studentWithRelative(north, '+998901140013');
      await mergeInto(north, merged, kept.relative);
      await expect(
        database.migrator
          .updateTable('relatives')
          .set({ archived_at: null })
          .where('id', '=', merged.relative)
          .execute(),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'relative_merged' });
      // Before the check of 0036, which Release 2 drops.
      await expect(
        database.migrator
          .updateTable('relative_accounts')
          .set({ switched_on_at: MOMENT })
          .where('relative_id', '=', merged.relative)
          .execute(),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'relative_merged' });
    });

    it('refuses a link held open while a merge commits, after the wait', async () => {
      const kept = await studentWithRelative(north, '+998901140008');
      const merged = await studentWithRelative(north, '+998901140009');
      const merging = await holdOpen(north, async (transaction) => {
        await transaction
          .updateTable('relatives')
          .set({ phone: null, merged_into: kept.relative })
          .where('id', '=', merged.relative)
          .execute();
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: false, unlinked_at: MOMENT })
          .where('relative_id', '=', merged.relative)
          .execute();
        await transaction
          .insertInto('student_relatives')
          .values({
            student_id: merged.student,
            branch_id: north,
            relative_id: kept.relative,
            relationship: 'mother',
            main_contact: true,
            linked_at: MOMENT,
          })
          .execute();
      });
      const linking = inBranch(south, async (transaction) => {
        const student = await writeStudent(transaction, south);
        await linkRelative(transaction, student, south, MOMENT);
        await linkTo(transaction, student, south, merged.relative);
      });
      await untilWaiting();
      merging.release();
      await merging.done;
      await expect(linking).rejects.toMatchObject({ constraint: 'relative_merged' });
      expect((await stored(merged.relative)).archived_at).not.toBeNull();
    });
  });

  describe('the accounts to tell (decision 5)', () => {
    const noticeAccounts = (branches: string[], relative: string, requestBranch: string) =>
      transactions.run(branches, async (transaction) => {
        const found = await sql<Record<string, unknown>>`
          select * from relative_notice_accounts(${relative}::uuid, ${requestBranch}::uuid)
        `.execute(transaction);
        return found.rows;
      });

    it('names the current Academic Vice Principal of each other branch, ids only', async () => {
      const shared = await studentWithRelative(north, '+998901150001');
      await inBranch(south, async (transaction) => {
        const student = await writeStudent(transaction, south);
        await linkRelative(transaction, student, south, MOMENT);
        await linkTo(transaction, student, south, shared.relative);
      });
      expect(await noticeAccounts([north], shared.relative, north)).toEqual([
        { branch_id: south, account_id: southVice },
      ]);
      // Against the branch of the request, not the transaction's: the Super
      // Admin's every-branch merge still tells the other branch.
      expect(await noticeAccounts([north, south], shared.relative, north)).toEqual([
        { branch_id: south, account_id: southVice },
      ]);
      expect(await noticeAccounts([south], shared.relative, south)).toEqual([]);
    });

    it('answers nothing for a relative the transaction does not see, and refuses another branch of the request', async () => {
      const only = await studentWithRelative(south, '+998901150002');
      expect(await noticeAccounts([north], only.relative, north)).toEqual([]);
      await expect(noticeAccounts([north], only.relative, south)).rejects.toMatchObject({
        constraint: 'relative_request_branch',
      });
    });
  });
});
