import {
  RELATIONSHIPS,
  RELATIVE_NAME_MAX_LENGTH,
  RELATIVE_WORKPLACE_MAX_LENGTH,
  relativeNameKey,
  studentNameKey,
} from '@sodiq/shared';
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

// The rules of close relatives that the database itself keeps (db/migrations/
// 0036; task 2.5a, pull request #72), also when the application has a fault:
// the main phone unique across the school, archived relatives included (the
// done-when of 2.5); a relative opened in a branch only while a student of
// that branch is linked live (decision 2); at least one relative and exactly
// one main contact per student at the commit (`04`, Always connected); a link
// unlinked once (decision 10); the archive and restore that follow the links
// in every branch (decisions 10 and 14); a relative committed only with its
// account and a live link (correction 2). All names are invented.
describe('close relatives in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let account: string;
  let count = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  async function newId(transaction: Transaction | TestDatabase['migrator']): Promise<string> {
    const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
    return found.rows[0]?.id ?? '';
  }

  /** The writes of a student of the create, without its relative. */
  async function writeStudent(transaction: Transaction, branch: string): Promise<string> {
    count += 1;
    const id = await newId(transaction);
    const uid = String(2607000 + count);
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
      .values({ student_id: id, branch_id: branch, number: `RL-${uid}`, signed_on: '2026-08-20' })
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

  /** A student of a branch with one relative, its main contact. */
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

  /** A link of an existing relative to a student, not the main contact. */
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

  const unlink = (transaction: Transaction, student: string, relative: string) =>
    transaction
      .updateTable('student_relatives')
      .set({ unlinked_at: MOMENT })
      .where('student_id', '=', student)
      .where('relative_id', '=', relative)
      .where('unlinked_at', 'is', null)
      .execute();

  const archivedAt = async (relative: string) =>
    (
      await database.migrator
        .selectFrom('relatives')
        .select('archived_at')
        .where('id', '=', relative)
        .executeTakeFirstOrThrow()
    ).archived_at;

  const visibleIn = async (branch: string, relative: string) =>
    inBranch(branch, async (transaction) => [
      (await transaction.selectFrom('relatives').select('id').where('id', '=', relative).execute())
        .length,
      (
        await transaction
          .selectFrom('relative_accounts')
          .select('relative_id')
          .where('relative_id', '=', relative)
          .execute()
      ).length,
    ]);

  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  /** A transaction of a branch held open after `work` until released. */
  async function holdOpen(branch: string, work: (transaction: Transaction) => Promise<void>) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
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
    return { release, done };
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    account = (
      await database.migrator
        .insertInto('accounts')
        .values({
          login: 'b.yusupova',
          password_hash: HASH,
          must_change_password: false,
          created_at: MOMENT,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the main phone (the done-when of task 2.5)', () => {
    it('is unique across the school, also against an archived holder', async () => {
      const holder = await studentWithRelative(north, '+998901110001');
      for (const branch of [north, south]) {
        await expect(studentWithRelative(branch, '+998901110001')).rejects.toMatchObject({
          code: UNIQUE_VIOLATION,
          constraint: 'relatives_phone_idx',
        });
      }
      // The holder archived: a second relative of the student keeps it linked.
      await inBranch(north, async (transaction) => {
        const other = await linkRelative(transaction, holder.student, north, MOMENT, {
          mainContact: false,
        });
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: false })
          .where('relative_id', '=', holder.relative)
          .execute();
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: true })
          .where('relative_id', '=', other)
          .execute();
        await unlink(transaction, holder.student, holder.relative);
      });
      expect(await archivedAt(holder.relative)).not.toBeNull();
      await expect(studentWithRelative(south, '+998901110001')).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'relatives_phone_idx',
      });
    });

    it('is not compared for relatives with no phone of their own', async () => {
      const first = await studentWithRelative(north, null);
      const second = await studentWithRelative(south, null);
      expect(first.relative).not.toBe(second.relative);
    });
  });

  describe('the checks of what is typed, as packages/shared bounds them', () => {
    const insertRelative = ({ relationship, ...values }: Record<string, unknown>) =>
      inBranch(north, async (transaction) => {
        const student = await writeStudent(transaction, north);
        const id = await newId(transaction);
        await transaction
          .insertInto('relatives')
          .values({
            id,
            full_name: 'Aziza Rahimova',
            name_key: relativeNameKey('Aziza Rahimova'),
            ...values,
          })
          .execute();
        await transaction
          .insertInto('relative_accounts')
          .values({ relative_id: id, created_at: MOMENT })
          .execute();
        await transaction
          .insertInto('student_relatives')
          .values({
            student_id: student,
            branch_id: north,
            relative_id: id,
            relationship: (relationship as string | undefined) ?? 'aunt',
            main_contact: true,
            linked_at: MOMENT,
          })
          .execute();
      });

    it('takes a name of the longest length and refuses one longer, a mixed one and a phone without its code', async () => {
      const longest = `A${'a'.repeat(RELATIVE_NAME_MAX_LENGTH - 1)}`;
      await expect(
        insertRelative({ full_name: longest, name_key: relativeNameKey(longest) }),
      ).resolves.toBeUndefined();
      for (const values of [
        { full_name: `${longest}a` },
        { full_name: 'Aziza Раҳимова' },
        { phone: '998901234567' },
        { workplace: 'a'.repeat(RELATIVE_WORKPLACE_MAX_LENGTH + 1) },
        { workplace: ' Bank ' },
        { email: 'Not An Email' },
      ]) {
        await expect(insertRelative(values), JSON.stringify(values)).rejects.toMatchObject({
          code: CHECK_VIOLATION,
        });
      }
    });

    it('keeps the relationships of packages/shared', async () => {
      for (const relationship of RELATIONSHIPS) {
        await expect(insertRelative({ relationship })).resolves.toBeUndefined();
      }
      await expect(insertRelative({ relationship: 'cousin' })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
    });
  });

  describe('the membership filter (decision 2)', () => {
    it('shows a relative and its account only in a branch with a live link', async () => {
      const { student, relative } = await studentWithRelative(north, '+998901110010');
      expect(await visibleIn(north, relative)).toEqual([1, 1]);
      expect(await visibleIn(south, relative)).toEqual([0, 0]);

      // Linked in the south too: both see one record.
      await inBranch(south, async (transaction) => {
        const other = await writeStudent(transaction, south);
        await linkTo(transaction, other, south, relative);
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: true })
          .where('student_id', '=', other)
          .execute();
      });
      expect(await visibleIn(south, relative)).toEqual([1, 1]);

      // Every link of the north unlinked: the north no longer sees it.
      await inBranch(north, async (transaction) => {
        await linkRelative(transaction, student, north, MOMENT, { mainContact: false });
        const others = await transaction
          .selectFrom('student_relatives')
          .select('relative_id')
          .where('student_id', '=', student)
          .where('relative_id', '<>', relative)
          .executeTakeFirstOrThrow();
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: false })
          .where('relative_id', '=', relative)
          .where('student_id', '=', student)
          .execute();
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: true })
          .where('relative_id', '=', others.relative_id)
          .execute();
        await unlink(transaction, student, relative);
      });
      expect(await visibleIn(north, relative)).toEqual([0, 0]);
      expect(await visibleIn(south, relative)).toEqual([1, 1]);
    });

    it('lets a branch write a link of its own branch only', async () => {
      const { relative } = await studentWithRelative(north);
      await expect(
        inBranch(south, async (transaction) => {
          const other = await writeStudent(transaction, south);
          await transaction
            .insertInto('student_relatives')
            .values({
              student_id: other,
              branch_id: north,
              relative_id: relative,
              relationship: 'father',
              main_contact: true,
              linked_at: MOMENT,
            })
            .execute();
        }),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('gives the application no delete and no write of the archive moment', async () => {
      const { student, relative } = await studentWithRelative(north);
      const statements: ((transaction: Transaction) => Promise<unknown>)[] = [
        (transaction: Transaction) =>
          transaction.deleteFrom('relatives').where('id', '=', relative).execute(),
        (transaction: Transaction) =>
          transaction.deleteFrom('student_relatives').where('student_id', '=', student).execute(),
        (transaction: Transaction) =>
          transaction.deleteFrom('relative_accounts').where('relative_id', '=', relative).execute(),
        (transaction: Transaction) =>
          transaction
            .updateTable('relatives')
            .set({ archived_at: MOMENT })
            .where('id', '=', relative)
            .execute(),
        (transaction: Transaction) =>
          transaction
            .updateTable('student_relatives')
            .set({ linked_at: MOMENT })
            .where('student_id', '=', student)
            .execute(),
      ];
      for (const statement of statements) {
        await expect(inBranch(north, statement)).rejects.toMatchObject({
          code: INSUFFICIENT_PRIVILEGE,
        });
      }
    });
  });

  describe('always connected (04) and one main contact (edge)', () => {
    it('refuses at the commit a student with no relative', async () => {
      await expect(
        inBranch(north, (transaction) => writeStudent(transaction, north)),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'student_needs_relative' });
    });

    it('refuses at the commit the last live link unlinked', async () => {
      const { student, relative } = await studentWithRelative(north);
      await expect(
        inBranch(north, (transaction) => unlink(transaction, student, relative)),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'student_needs_relative' });
    });

    it('refuses at the commit a student with no main contact', async () => {
      const { student } = await studentWithRelative(north);
      await expect(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('student_relatives')
            .set({ main_contact: false })
            .where('student_id', '=', student)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'student_main_contact' });
    });

    it('refuses a second live main contact at once', async () => {
      const { student } = await studentWithRelative(north);
      await expect(
        inBranch(north, (transaction) =>
          linkRelative(transaction, student, north, MOMENT, { mainContact: true }),
        ),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'student_relatives_main_idx' });
    });

    it('refuses a relative linked twice live to one student', async () => {
      const { student, relative } = await studentWithRelative(north);
      await expect(
        inBranch(north, (transaction) => linkTo(transaction, student, north, relative)),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'student_relatives_live_idx' });
    });

    describe('a student of 2.4a with no relative (decision 11)', () => {
      /**
       * A student whose link the migrator removed, as one saved before 0036.
       * Its relative keeps a link of another student, so nothing is archived.
       */
      async function linkless(): Promise<string> {
        const kept = await studentWithRelative(north);
        const removed = await studentWithRelative(north);
        await inBranch(north, (transaction) =>
          linkTo(transaction, kept.student, north, removed.relative),
        );
        await database.migrator
          .deleteFrom('student_relatives')
          .where('student_id', '=', removed.student)
          .execute();
        return removed.student;
      }

      const rename = (transaction: Transaction, student: string) =>
        transaction
          .updateTable('students')
          .set({ first_name: 'Malohat', name_key: studentNameKey('Usmonova', 'Malohat') })
          .where('id', '=', student)
          .execute();

      it('refuses the edit of the record', async () => {
        const student = await linkless();
        await expect(
          inBranch(north, (transaction) => rename(transaction, student)),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'student_needs_relative' });
      });

      it('lets a photo, a status, a UID and the branch move pass', async () => {
        const student = await linkless();
        await inBranch(north, async (transaction) => {
          await transaction
            .updateTable('students')
            .set({ photo_id: '0199a000-0000-7000-8000-0000000000aa', photo_type: 'image/png' })
            .where('id', '=', student)
            .execute();
          await transaction
            .updateTable('student_statuses')
            .set({ valid_until: '2026-12-31' })
            .where('student_id', '=', student)
            .execute();
          await transaction
            .insertInto('student_uids')
            .values({ uid: '2607999', student_id: student, branch_id: north, held_from: MOMENT })
            .execute();
          await transaction
            .updateTable('students')
            .set({ uid: '2607999' })
            .where('id', '=', student)
            .execute();
        });
        for (const branch of [south, north]) {
          await database.migrator
            .updateTable('students')
            .set({ branch_id: branch })
            .where('id', '=', student)
            .execute();
        }
      });

      it('lets the edit pass with a relative linked in the same transaction', async () => {
        const student = await linkless();
        await inBranch(north, async (transaction) => {
          await linkRelative(transaction, student, north, MOMENT);
          await rename(transaction, student);
        });
      });
    });
  });

  describe('a link is unlinked once (decision 10)', () => {
    /** A student with two relatives; the second is not the main contact. */
    async function twoRelatives() {
      const { student, relative } = await studentWithRelative(north);
      const second = await inBranch(north, (transaction) =>
        linkRelative(transaction, student, north, MOMENT, { mainContact: false }),
      );
      return { student, main: relative, second };
    }

    it('writes the moment of the transaction, whatever was sent', async () => {
      const { student, second } = await twoRelatives();
      const before = Date.now();
      await inBranch(north, (transaction) => unlink(transaction, student, second));
      const stored = await database.migrator
        .selectFrom('student_relatives')
        .select('unlinked_at')
        .where('relative_id', '=', second)
        .executeTakeFirstOrThrow();
      expect(stored.unlinked_at?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it('refuses to take an unlink back, to move it and to change an unlinked row', async () => {
      const { student, second } = await twoRelatives();
      await inBranch(north, (transaction) => unlink(transaction, student, second));
      for (const values of [
        { unlinked_at: null },
        { unlinked_at: new Date('2027-01-01T00:00:00Z') },
        { relationship: 'uncle' },
        { portal_access: false },
      ]) {
        await expect(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('student_relatives')
              .set(values)
              .where('relative_id', '=', second)
              .execute(),
          ),
          JSON.stringify(values),
        ).rejects.toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'student_relatives_unlinked',
        });
      }
    });

    it('refuses an unlink before the link', async () => {
      const { student } = await studentWithRelative(north);
      const later = await inBranch(north, async (transaction) => {
        const id = await linkRelative(transaction, student, north, MOMENT, { mainContact: false });
        await transaction
          .updateTable('student_relatives')
          .set({ relationship: 'uncle' })
          .where('relative_id', '=', id)
          .execute();
        return id;
      });
      await database.migrator
        .updateTable('student_relatives')
        .set({ linked_at: new Date('2099-01-01T00:00:00Z') })
        .where('relative_id', '=', later)
        .execute();
      await expect(
        inBranch(north, (transaction) => unlink(transaction, student, later)),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'student_relatives_unlink_moment',
      });
    });
  });

  describe('the archive follows the links in every branch (decisions 10 and 14)', () => {
    it('archives a relative at its last unlink and restores it with a new link', async () => {
      const { student, second } = await (async () => {
        const first = await studentWithRelative(north);
        const id = await inBranch(north, (transaction) =>
          linkRelative(transaction, first.student, north, MOMENT, { mainContact: false }),
        );
        return { student: first.student, second: id };
      })();
      expect(await archivedAt(second)).toBeNull();
      await inBranch(north, (transaction) => unlink(transaction, student, second));
      expect(await archivedAt(second)).not.toBeNull();

      await inBranch(south, async (transaction) => {
        const other = await writeStudent(transaction, south);
        await linkTo(transaction, other, south, second);
        await transaction
          .updateTable('student_relatives')
          .set({ main_contact: true })
          .where('student_id', '=', other)
          .execute();
      });
      expect(await archivedAt(second)).toBeNull();
    });

    it('archives the relatives of a student deleted as created twice', async () => {
      const { student, relative } = await studentWithRelative(north);
      await inBranch(north, (transaction) =>
        transaction.deleteFrom('students').where('id', '=', student).execute(),
      );
      expect(await archivedAt(relative)).not.toBeNull();
      const links = await database.migrator
        .selectFrom('student_relatives')
        .select('id')
        .where('student_id', '=', student)
        .execute();
      expect(links).toEqual([]);
    });

    // Finding 4 of the plan review: a link in one branch and the last unlink
    // in another meet on the relative's row, in both orders.
    describe('when a link and the last unlink of another branch meet', () => {
      /** A relative linked in the south only, to a student with a second relative. */
      async function sharedRelative() {
        const south1 = await studentWithRelative(south);
        const relative = await inBranch(south, (transaction) =>
          linkRelative(transaction, south1.student, south, MOMENT, { mainContact: false }),
        );
        const northStudent = await studentWithRelative(north);
        return { southStudent: south1.student, relative, northStudent: northStudent.student };
      }

      it('leaves the relative live when the link is held first', async () => {
        const { southStudent, relative, northStudent } = await sharedRelative();
        const held = await holdOpen(north, (transaction) =>
          linkTo(transaction, northStudent, north, relative).then(() => undefined),
        );
        const unlinking = inBranch(south, (transaction) =>
          unlink(transaction, southStudent, relative),
        );
        await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
        held.release();
        await held.done;
        await unlinking;
        expect(await archivedAt(relative)).toBeNull();
      });

      it('leaves the relative live when the unlink is held first', async () => {
        const { southStudent, relative, northStudent } = await sharedRelative();
        const held = await holdOpen(south, (transaction) =>
          unlink(transaction, southStudent, relative).then(() => undefined),
        );
        const linking = inBranch(north, (transaction) =>
          linkTo(transaction, northStudent, north, relative),
        );
        await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
        held.release();
        await held.done;
        await linking;
        expect(await archivedAt(relative)).toBeNull();
      });
    });
  });

  describe('a relative is committed whole (correction 2)', () => {
    const writeRelative = async (
      transaction: Transaction,
      parts: { account: boolean; link: boolean },
    ) => {
      const student = await writeStudent(transaction, north);
      await linkRelative(transaction, student, north, MOMENT);
      const id = await newId(transaction);
      await transaction
        .insertInto('relatives')
        .values({ id, full_name: 'Sardor Aliyev', name_key: relativeNameKey('Sardor Aliyev') })
        .execute();
      if (parts.account) {
        await transaction
          .insertInto('relative_accounts')
          .values({ relative_id: id, created_at: MOMENT })
          .execute();
      }
      if (parts.link) {
        await linkTo(transaction, student, north, id);
      }
    };

    it('refuses a relative without its account, and one without a live link', async () => {
      await expect(
        inBranch(north, (transaction) =>
          writeRelative(transaction, { account: false, link: true }),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'relative_needs_account' });
      await expect(
        inBranch(north, (transaction) =>
          writeRelative(transaction, { account: true, link: false }),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'relative_needs_link' });
      await expect(
        inBranch(north, (transaction) => writeRelative(transaction, { account: true, link: true })),
      ).resolves.toBeUndefined();
    });

    it('holds the Parent account switched off until Release 2', async () => {
      const { relative } = await studentWithRelative(north);
      await expect(
        database.migrator
          .updateTable('relative_accounts')
          .set({ switched_on_at: MOMENT })
          .where('relative_id', '=', relative)
          .execute(),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'relative_accounts_switched_off_check',
      });
    });
  });

  describe('the functions across branches (decision 3)', () => {
    it('name the holder of an exact phone with a count, and nothing else', async () => {
      const { student, relative } = await studentWithRelative(north, '+998901110020');
      await inBranch(north, async (transaction) => {
        const other = await writeStudent(transaction, north);
        await linkRelative(transaction, other, north, MOMENT);
        await linkTo(transaction, other, north, relative);
      });
      const found = await inBranch(south, (transaction) =>
        sql<Record<string, unknown>>`select * from relative_by_phone(${'+998901110020'})`.execute(
          transaction,
        ),
      );
      expect(found.rows).toEqual([{ id: relative, full_name: 'Dilfuza Karimova', students: '2' }]);
      const none = await inBranch(south, (transaction) =>
        sql`select * from relative_by_phone(${'+998901110'})`.execute(transaction),
      );
      expect(none.rows).toEqual([]);
      expect(student).toBeTruthy();
    });

    it('count the students elsewhere of a relative the branch sees, and nothing otherwise', async () => {
      const { relative } = await studentWithRelative(north);
      const elsewhere = (branch: string) =>
        inBranch(branch, async (transaction) => {
          const found = await sql<{ count: string | null }>`
            select relative_links_elsewhere(${relative}::uuid) as count
          `.execute(transaction);
          return found.rows[0]?.count ?? null;
        });
      expect(await elsewhere(south)).toBeNull();
      expect(await elsewhere(north)).toBe('0');
      await inBranch(south, async (transaction) => {
        const other = await writeStudent(transaction, south);
        await linkRelative(transaction, other, south, MOMENT);
        await linkTo(transaction, other, south, relative);
      });
      expect(await elsewhere(north)).toBe('1');
      expect(await elsewhere(south)).toBe('1');
    });
  });
});
