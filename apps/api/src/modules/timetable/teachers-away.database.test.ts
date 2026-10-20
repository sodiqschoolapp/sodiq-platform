import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at } from '../../testing/lessons-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';

/** What a promise came to: `written`, or the constraint or message that refused it. */
const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => (error as { constraint?: string }).constraint ?? (error as Error).message,
  );

interface Span {
  readonly cause: string;
  readonly applies_from: Date;
  readonly applies_until: Date | null;
}

// Status and lock moments in the database (db/migrations/0097; task 5.7a-2a,
// pull request #186, decisions 3 to 5 and corrections 1 and 2).
// docs/spec/edge-cases/people-roles-accounts.md, Staff over time: "'Lock
// now' ... The teacher's future lessons go to 'needs a teacher'." Writes of
// the application run as `sodiq_app` with the moment set, as the routes
// write them. All names are invented.
describe('teachers away in the database', () => {
  let database: TestDatabase;
  let kit: LoadKit;
  let north: string;
  let south: string;
  let third: string;
  let locker: string;

  const asApp = <T>(
    branches: readonly string[],
    work: (transaction: Transaction) => Promise<T>,
    now = NOW,
  ) => new Transactions(database.app, new FixedClock(now)).run(branches, work);

  /**
   * The app's write of a status from `from`, as the status route writes it:
   * the open row cut at the date, the new one from it.
   */
  const status = (staffId: string, kind: string, from: string, now = NOW) =>
    asApp(
      [north],
      async (transaction) => {
        await transaction
          .updateTable('staff_statuses')
          .set({ valid_until: from })
          .where('staff_id', '=', staffId)
          .where('valid_until', 'is', null)
          .execute();
        const row = await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: staffId, status: kind, valid_from: from, valid_until: null })
          .returning('id')
          .executeTakeFirstOrThrow();
        return row.id;
      },
      now,
    );

  const cut = (id: string, until: string, now = NOW) =>
    asApp(
      [north],
      (transaction) =>
        transaction
          .updateTable('staff_statuses')
          .set({ valid_until: until })
          .where('id', '=', id)
          .execute(),
      now,
    );

  const momentsOf = (statusId: string) =>
    database.migrator
      .selectFrom('staff_status_moments')
      .select(['applies_from', 'applies_until'])
      .where('status_id', '=', statusId)
      .executeTakeFirstOrThrow();

  const away = (branch: string, staffId: string, from: Date, until: Date | null) =>
    asApp(
      [branch],
      async (transaction) =>
        (
          await sql<Span>`
          select cause, applies_from, applies_until
          from teachers_away(array[${staffId}]::uuid[], ${from}, ${until})
        `.execute(transaction)
        ).rows,
    );

  const lock = (accountId: string, now = NOW) =>
    asApp(
      [north],
      (transaction) =>
        transaction
          .updateTable('accounts')
          .set({ locked_at: new Date(now), locked_by: locker, lock_reason: 'Dismissed' })
          .where('id', '=', accountId)
          .execute(),
      now,
    );

  const unlock = (accountId: string, now: string) =>
    asApp(
      [north],
      (transaction) =>
        transaction
          .updateTable('accounts')
          .set({ locked_at: null, locked_by: null, lock_reason: null })
          .where('id', '=', accountId)
          .execute(),
      now,
    );

  const spansOf = (accountId: string) =>
    database.migrator
      .selectFrom('account_lock_spans')
      .select(['locked_at', 'unlocked_at'])
      .where('account_id', '=', accountId)
      .orderBy('locked_at')
      .execute();

  beforeAll(async () => {
    database = await createTestDatabase();
    kit = new LoadKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    third = await insertBranch(database.migrator, 'Third');
    locker = await kit.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('staff_status_moments', () => {
    it('starts a status from today at the moment of the save and a later one at its day’s start (decision 4)', async () => {
      const today = await kit.teacher(north);
      const later = await kit.teacher(north);
      const fromToday = await status(today.staffId, 'inactive', '2026-10-15');
      const fromLater = await status(later.staffId, 'left', '2026-10-20');
      expect(await momentsOf(fromToday)).toEqual({
        applies_from: new Date(NOW),
        applies_until: null,
      });
      expect(await momentsOf(fromLater)).toEqual({
        applies_from: at('2026-10-20', '00:00'),
        applies_until: null,
      });
    });

    it('moves the end with a cut: to today at the moment, to a later date at its start, a taken-back row empty', async () => {
      const person = await kit.teacher(north);
      const first = await status(person.staffId, 'inactive', '2026-10-15');
      await cut(first, '2026-10-15', '2026-10-15T12:00:00+05:00');
      expect(await momentsOf(first)).toEqual({
        applies_from: new Date(NOW),
        applies_until: new Date('2026-10-15T12:00:00+05:00'),
      });
      const other = await kit.teacher(north);
      const planned = await status(other.staffId, 'inactive', '2026-10-20');
      await cut(planned, '2026-10-27');
      expect((await momentsOf(planned)).applies_until).toEqual(at('2026-10-27', '00:00'));
      // Taken back before it took effect: its end set to its start.
      await cut(planned, '2026-10-20');
      expect(await momentsOf(planned)).toEqual({
        applies_from: at('2026-10-20', '00:00'),
        applies_until: at('2026-10-20', '00:00'),
      });
      expect(await away(north, other.staffId, at('2026-10-01', '00:00'), null)).toEqual([]);
    });

    it('gives the migrator’s rows their days’ starts (the kits, the seed)', async () => {
      const person = await kit.teacher(north);
      await database.migrator
        .updateTable('staff_statuses')
        .set({ valid_until: '2027-01-04' })
        .where('staff_id', '=', person.staffId)
        .execute();
      const row = await database.migrator
        .insertInto('staff_statuses')
        .values({ staff_id: person.staffId, status: 'left', valid_from: '2027-01-04' })
        .returning('id')
        .executeTakeFirstOrThrow();
      expect(await momentsOf(row.id)).toEqual({
        applies_from: at('2027-01-04', '00:00'),
        applies_until: null,
      });
    });

    it('refuses a write of the application without a moment (correction 1)', async () => {
      const person = await kit.teacher(north);
      // The transaction of a route with its moment taken away.
      const written = await outcome(
        asApp([north], async (transaction) => {
          await sql`select set_config('app.now', '', true)`.execute(transaction);
          await transaction
            .updateTable('staff_statuses')
            .set({ valid_until: '2027-01-04' })
            .where('staff_id', '=', person.staffId)
            .execute();
        }),
      );
      expect(written).toBe('status_moment_needs_moment');
    });

    it('is seen in every branch of the person and in no other, and the application never writes it', async () => {
      const person = await kit.teacher(north, { further: [south] });
      const id = await status(person.staffId, 'inactive', '2026-10-20');
      const seen = (branch: string) =>
        asApp([branch], (transaction) =>
          transaction
            .selectFrom('staff_status_moments')
            .select('status_id')
            .where('status_id', '=', id)
            .execute(),
        );
      expect(await seen(north)).toHaveLength(1);
      expect(await seen(south)).toHaveLength(1);
      expect(await seen(third)).toHaveLength(0);
      expect(
        await outcome(
          asApp([north], (transaction) =>
            transaction
              .updateTable('staff_status_moments')
              .set({ applies_until: at('2026-10-21', '00:00') })
              .where('status_id', '=', id)
              .execute(),
          ),
        ),
      ).toMatch(/permission denied/);
      expect(
        await outcome(
          asApp([north], (transaction) =>
            transaction.deleteFrom('staff_status_moments').where('status_id', '=', id).execute(),
          ),
        ),
      ).toMatch(/permission denied/);
      expect(
        await outcome(
          asApp([north], (transaction) =>
            transaction
              .insertInto('staff_status_moments')
              .values({
                status_id: id,
                staff_id: person.staffId,
                applies_from: at('2026-10-20', '00:00'),
              })
              .execute(),
          ),
        ),
      ).toMatch(/permission denied/);
    });
  });

  describe('account_lock_spans', () => {
    it('opens a span at a lock and closes it at the unlock, also at the same moment (decision 5)', async () => {
      const person = await kit.teacher(north);
      await lock(person.accountId);
      expect(await spansOf(person.accountId)).toEqual([
        { locked_at: new Date(NOW), unlocked_at: null },
      ]);
      await unlock(person.accountId, '2026-10-15T12:00:00+05:00');
      await lock(person.accountId, '2026-10-16T09:00:00+05:00');
      await unlock(person.accountId, '2026-10-16T09:00:00+05:00');
      expect(await spansOf(person.accountId)).toEqual([
        { locked_at: new Date(NOW), unlocked_at: new Date('2026-10-15T12:00:00+05:00') },
        {
          locked_at: new Date('2026-10-16T09:00:00+05:00'),
          unlocked_at: new Date('2026-10-16T09:00:00+05:00'),
        },
      ]);
    });

    it('closes a span at the start of the day for the migrator, never before the lock', async () => {
      const person = await kit.teacher(north);
      await lock(person.accountId, '2026-10-01T09:00:00+05:00');
      await database.migrator
        .updateTable('accounts')
        .set({ locked_at: null, locked_by: null, lock_reason: null })
        .where('id', '=', person.accountId)
        .execute();
      const [span] = await spansOf(person.accountId);
      expect(span?.unlocked_at).not.toBeNull();
      expect((span?.unlocked_at ?? new Date(0)).getTime()).toBeGreaterThanOrEqual(
        new Date('2026-10-01T09:00:00+05:00').getTime(),
      );
    });

    it('refuses an unlock of the application without a moment', async () => {
      const person = await kit.teacher(north);
      await lock(person.accountId);
      const written = await outcome(
        database.app
          .transaction()
          .execute((transaction) =>
            transaction
              .updateTable('accounts')
              .set({ locked_at: null, locked_by: null, lock_reason: null })
              .where('id', '=', person.accountId)
              .execute(),
          ),
      );
      expect(written).toBe('lock_span_needs_moment');
    });

    it('never overlaps, and the application never writes a span', async () => {
      const person = await kit.teacher(north);
      await lock(person.accountId);
      expect(
        await outcome(
          database.migrator
            .insertInto('account_lock_spans')
            .values({ account_id: person.accountId, locked_at: at('2026-10-15', '11:00') })
            .execute(),
        ),
      ).toBe('account_lock_spans_no_overlap');
      expect(
        await outcome(
          asApp([north], (transaction) =>
            transaction
              .updateTable('account_lock_spans')
              .set({ locked_at: at('2026-10-14', '00:00') })
              .where('account_id', '=', person.accountId)
              .execute(),
          ),
        ),
      ).toMatch(/permission denied/);
      expect(
        await outcome(
          asApp([north], (transaction) =>
            transaction
              .deleteFrom('account_lock_spans')
              .where('account_id', '=', person.accountId)
              .execute(),
          ),
        ),
      ).toMatch(/permission denied/);
    });
  });

  describe('teachers_away', () => {
    it('gives an absence, an inactive and a left status, and a lock, each with its moments', async () => {
      const person = await kit.teacher(north);
      await asApp([north], (transaction) =>
        transaction
          .insertInto('absences')
          .values({
            staff_id: person.staffId,
            starts_on: '2026-10-16',
            ends_on: '2026-10-16',
            applies_from: at('2026-10-16', '00:00'),
            applies_until: at('2026-10-17', '00:00'),
            reason: 'Ill',
            created_by: locker,
          })
          .execute(),
      );
      const inactive = await status(person.staffId, 'inactive', '2026-10-19');
      await cut(inactive, '2026-10-26');
      await status(person.staffId, 'left', '2026-11-02');
      await lock(person.accountId);
      expect(await away(north, person.staffId, at('2026-10-01', '00:00'), null)).toEqual([
        { cause: 'locked', applies_from: new Date(NOW), applies_until: null },
        {
          cause: 'absence',
          applies_from: at('2026-10-16', '00:00'),
          applies_until: at('2026-10-17', '00:00'),
        },
        {
          cause: 'inactive',
          applies_from: at('2026-10-19', '00:00'),
          applies_until: at('2026-10-26', '00:00'),
        },
        { cause: 'left', applies_from: at('2026-11-02', '00:00'), applies_until: null },
      ]);
      // Out of the range: nothing.
      expect(
        await away(north, person.staffId, at('2026-10-01', '00:00'), at('2026-10-15', '00:00')),
      ).toEqual([]);
    });

    it('leaves out an active status and a closed lock span that is empty', async () => {
      const person = await kit.teacher(north);
      await lock(person.accountId);
      await unlock(person.accountId, NOW);
      expect(await away(north, person.staffId, at('2026-09-01', '00:00'), null)).toEqual([]);
    });

    it('answers in a branch whose link to the person was removed (decision 3)', async () => {
      const east = await insertBranch(database.migrator, 'East');
      const person = await kit.teacher(north, { further: [east] });
      await status(person.staffId, 'inactive', '2026-10-20');
      await database.migrator
        .deleteFrom('staff_branches')
        .where('staff_id', '=', person.staffId)
        .where('branch_id', '=', east)
        .execute();
      expect(await away(east, person.staffId, at('2026-10-01', '00:00'), null)).toEqual([
        { cause: 'inactive', applies_from: at('2026-10-20', '00:00'), applies_until: null },
      ]);
    });
  });
});
