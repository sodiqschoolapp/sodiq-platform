import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';

/** What a promise came to: `written`, or the constraint or message that refused it. */
const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => (error as { constraint?: string }).constraint ?? (error as Error).message,
  );

// Room closures in the database (db/migrations/0098; task 5.7a-2b, pull
// request #187, decisions 1, 3 and 4). docs/spec/edge-cases/timetable.md,
// After publishing: "A room closure has a start, an end and a reason." Every
// write is made as `sodiq_app` through the branch filter, as the routes
// write it. All names are invented.
describe('room closures in the database', () => {
  let database: TestDatabase;
  let kit: LessonsKit;
  let north: string;
  let south: string;
  let author: string;

  const asApp = <T>(branches: readonly string[], work: (transaction: Transaction) => Promise<T>) =>
    new Transactions(database.app, new FixedClock(NOW)).run(branches, work);

  /** A closure of the room over `[from, until)`, written from `branch`. */
  const closure = (
    branch: string,
    roomId: string,
    from: Date,
    until: Date,
    days: { startsOn: string; endsOn: string } = { startsOn: '2026-10-19', endsOn: '2026-10-23' },
  ) =>
    asApp([branch], (transaction) =>
      transaction
        .insertInto('room_closures')
        .values({
          branch_id: branch,
          room_id: roomId,
          starts_on: days.startsOn,
          ends_on: days.endsOn,
          applies_from: from,
          applies_until: until,
          reason: 'Repairs',
          created_by: author,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );

  const week = (roomId: string, branch = north) =>
    closure(branch, roomId, at('2026-10-19', '00:00'), at('2026-10-24', '00:00'));

  beforeAll(async () => {
    database = await createTestDatabase();
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    author = await kit.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('room_closures_no_overlap', () => {
    it('refuses a second live closure of the room that meets the first', async () => {
      const room = await kit.room(north);
      await week(room);
      expect(
        await outcome(closure(north, room, at('2026-10-23', '00:00'), at('2026-10-27', '00:00'))),
      ).toBe('room_closures_no_overlap');
    });

    it('takes a closure that starts where the other ends, half-open', async () => {
      const room = await kit.room(north);
      await week(room);
      expect(
        await outcome(closure(north, room, at('2026-10-24', '00:00'), at('2026-10-27', '00:00'))),
      ).toBe('written');
    });

    it('does not count a withdrawn closure, nor another room', async () => {
      const room = await kit.room(north);
      const other = await kit.room(north);
      const id = await week(room);
      expect(await outcome(week(other))).toBe('written');
      await asApp([north], (transaction) =>
        transaction
          .updateTable('room_closures')
          .set({ withdrawn_at: new Date(NOW) })
          .where('id', '=', id)
          .execute(),
      );
      expect(await outcome(week(room))).toBe('written');
    });
  });

  describe('the checks', () => {
    it('refuses a last day before the first, an end not after the start, and an empty reason', async () => {
      const room = await kit.room(north);
      expect(
        await outcome(
          closure(north, room, at('2026-10-19', '00:00'), at('2026-10-24', '00:00'), {
            startsOn: '2026-10-23',
            endsOn: '2026-10-19',
          }),
        ),
      ).toBe('room_closures_days_check');
      expect(
        await outcome(closure(north, room, at('2026-10-19', '00:00'), at('2026-10-19', '00:00'))),
      ).toBe('room_closures_moments_check');
      expect(
        await outcome(
          asApp([north], (transaction) =>
            transaction
              .insertInto('room_closures')
              .values({
                branch_id: north,
                room_id: room,
                starts_on: '2026-10-19',
                ends_on: '2026-10-23',
                applies_from: at('2026-10-19', '00:00'),
                applies_until: at('2026-10-24', '00:00'),
                reason: '  ',
                created_by: author,
              })
              .execute(),
          ),
        ),
      ).toBe('room_closures_reason_check');
    });

    it('refuses a room of another branch', async () => {
      const room = await kit.room(south);
      expect(await outcome(week(room, north))).toBe('room_closures_room_fkey');
    });
  });

  describe('the branch filter', () => {
    it('shows the closure in its own branch only, and lets no other branch write one', async () => {
      const room = await kit.room(north);
      const id = await week(room);
      const seen = (branch: string) =>
        asApp([branch], (transaction) =>
          transaction.selectFrom('room_closures').select('id').where('id', '=', id).execute(),
        );
      expect(await seen(north)).toHaveLength(1);
      expect(await seen(south)).toHaveLength(0);
      expect(
        await outcome(
          asApp([south], (transaction) =>
            transaction
              .insertInto('room_closures')
              .values({
                branch_id: north,
                room_id: room,
                starts_on: '2026-11-02',
                ends_on: '2026-11-06',
                applies_from: at('2026-11-02', '00:00'),
                applies_until: at('2026-11-07', '00:00'),
                reason: 'Repairs',
                created_by: author,
              })
              .execute(),
          ),
        ),
      ).toMatch(/row-level security/);
    });
  });

  describe('the grants', () => {
    it('never deletes, and never changes the room or the reason', async () => {
      const room = await kit.room(north);
      const other = await kit.room(north);
      const id = await week(room);
      expect(
        await outcome(
          asApp([north], (transaction) =>
            transaction.deleteFrom('room_closures').where('id', '=', id).execute(),
          ),
        ),
      ).toMatch(/permission denied/);
      expect(
        await outcome(
          asApp([north], (transaction) =>
            transaction
              .updateTable('room_closures')
              .set({ room_id: other })
              .where('id', '=', id)
              .execute(),
          ),
        ),
      ).toMatch(/permission denied/);
      expect(
        await outcome(
          asApp([north], (transaction) =>
            transaction
              .updateTable('room_closures')
              .set({ reason: 'Another reason' })
              .where('id', '=', id)
              .execute(),
          ),
        ),
      ).toMatch(/permission denied/);
    });
  });
});
