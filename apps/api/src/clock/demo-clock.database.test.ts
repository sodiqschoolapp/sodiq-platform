import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { readDemoClockRow } from './demo-clock.js';

// Task 10.5 (pull request #280): the table of the demo clock (db/migrations/0156). One row, no
// delete for the application, and an offset that never goes back, for every user (decision 5).

describe('the table of the demo clock', () => {
  let database: TestDatabase;
  let account: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    account = (
      await database.migrator
        .insertInto('accounts')
        .values({
          login: 'demo.clock',
          password_hash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA',
          must_change_password: false,
          created_at: new Date('2026-11-04T05:00:00Z'),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await database.destroy();
  });

  const row = (offset: number, previous = 0) => ({
    id: true,
    offset_ms: String(offset),
    previous_offset_ms: String(previous),
    effective_at: new Date('2026-11-04T05:00:05Z'),
    changed_at: new Date('2026-11-04T05:00:00Z'),
    changed_by: account,
  });

  it('reads no row as real time', async () => {
    expect(await readDemoClockRow(database.app)).toBeUndefined();
  });

  it('holds one row, which the application writes and reads', async () => {
    await database.app.insertInto('demo_clock').values(row(5_000)).execute();

    expect(await readDemoClockRow(database.app)).toEqual({
      offsetMs: 5_000,
      previousOffsetMs: 0,
      effectiveAt: new Date('2026-11-04T05:00:05Z'),
    });
    await expect(
      database.app.insertInto('demo_clock').values(row(6_000)).execute(),
    ).rejects.toThrow('demo_clock_pkey');
    await expect(
      database.app
        .insertInto('demo_clock')
        .values({ ...row(6_000), id: false })
        .execute(),
    ).rejects.toThrow('demo_clock_one_row');
  });

  it('gives the application no right to delete the row', async () => {
    await expect(database.app.deleteFrom('demo_clock').execute()).rejects.toThrow(
      'permission denied',
    );
  });

  it('refuses an offset that goes back, also to the owner of the table', async () => {
    await expect(
      database.migrator.updateTable('demo_clock').set({ offset_ms: '1000' }).execute(),
    ).rejects.toThrow('only moves forward');
    await expect(
      database.app.updateTable('demo_clock').set({ offset_ms: '1000' }).execute(),
    ).rejects.toThrow('only moves forward');
    await database.app
      .updateTable('demo_clock')
      .set({ offset_ms: '9000', previous_offset_ms: '5000' })
      .execute();
    await expect(
      database.app.updateTable('demo_clock').set({ previous_offset_ms: '4000' }).execute(),
    ).rejects.toThrow('only moves forward');
  });

  it('refuses a previous offset beyond the offset, and a negative one', async () => {
    await expect(
      database.app.updateTable('demo_clock').set({ previous_offset_ms: '10000' }).execute(),
    ).rejects.toThrow('demo_clock_previous_check');
    await database.migrator.deleteFrom('demo_clock').execute();
    await expect(database.app.insertInto('demo_clock').values(row(-1)).execute()).rejects.toThrow(
      'demo_clock_offset_check',
    );
  });
});
