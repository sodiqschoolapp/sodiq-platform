import { describe, expect, it, vi } from 'vitest';
import { loadConfig, type AppConfig } from '../config/config.js';
import type { Database } from '../database/database.js';
import { FixedClock } from '../testing/fixed-clock.js';
import { DEMO_CLOCK_DEFAULT_TIMING, DemoClock, demoMomentOf } from './demo-clock.js';

// Task 10.5 (pull request #280): demo time is real time plus the stored offset, from the row
// alone (correction 1 of the plan review), read before the process serves (correction 2).
// docs/spec/edge-cases/developer-rules.md, Time-based state.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CONFIG: AppConfig = {
  ...loadConfig({
    DATABASE_URL: 'postgres://sodiq_app:not-a-real-password@localhost:5432/sodiq_dev',
    SECOND_STEP_KEY: Buffer.alloc(32, 7).toString('base64'),
  }),
  demoClock: true,
};

interface StoredRow {
  offset_ms: string;
  previous_offset_ms: string;
  effective_at: Date;
}

/** The table `demo_clock` as one value: what a jump of the route writes, and the reads of it. */
class FakeTable {
  row: StoredRow | undefined;
  failing = false;
  reads = 0;

  readonly database = {
    selectFrom: () => ({
      select: () => ({
        executeTakeFirst: () => {
          this.reads += 1;
          return this.failing
            ? Promise.reject(new Error('connection lost'))
            : Promise.resolve(this.row);
        },
      }),
    }),
  };

  /** The jump as `DemoClockService.jump` writes it, at real moment `real`, `lead` ahead. */
  jump(real: Date, to: Date, lead = 5_000): void {
    const takesEffect = real.getTime() + lead;
    const inForce =
      this.row === undefined
        ? 0
        : real.getTime() >= this.row.effective_at.getTime()
          ? Number(this.row.offset_ms)
          : Number(this.row.previous_offset_ms);
    this.row = {
      offset_ms: String(to.getTime() - takesEffect),
      previous_offset_ms: String(inForce),
      effective_at: new Date(takesEffect),
    };
  }
}

function clockOver(real: FixedClock, table: FakeTable, config: AppConfig = CONFIG): DemoClock {
  // The fake answers the one chain DemoClock reads (`selectFrom().select().executeTakeFirst()`).
  const database = table.database as unknown as Database;
  return new DemoClock(real, database, config, {
    ...DEMO_CLOCK_DEFAULT_TIMING,
    refreshMs: HOUR,
  });
}

describe('demoMomentOf', () => {
  const real = new Date('2026-11-04T10:00:00Z');

  it('is real time without a row', () => {
    expect(demoMomentOf(real, undefined).toISOString()).toBe('2026-11-04T10:00:00.000Z');
  });

  it('adds the offset once real time reaches the moment it takes effect, not a millisecond before', () => {
    const row = { offsetMs: DAY, previousOffsetMs: HOUR, effectiveAt: real };

    expect(demoMomentOf(new Date(real.getTime() - 1), row).toISOString()).toBe(
      '2026-11-04T10:59:59.999Z',
    );
    expect(demoMomentOf(real, row).toISOString()).toBe('2026-11-05T10:00:00.000Z');
  });
});

describe('DemoClock', () => {
  it('reads the row before the process serves, and shows real time plus its offset', async () => {
    const real = new FixedClock('2026-11-04T10:00:00Z');
    const table = new FakeTable();
    table.jump(new Date('2026-11-04T09:00:00Z'), new Date('2026-11-05T09:00:05Z'));
    const clock = clockOver(real, table);

    await clock.onModuleInit();

    expect(table.reads).toBe(1);
    expect(clock.now().toISOString()).toBe('2026-11-05T10:00:00.000Z');
    await clock.onModuleDestroy();
  });

  it('refuses the start when the first read fails, so no request sees real time', async () => {
    const table = new FakeTable();
    table.failing = true;
    const clock = clockOver(new FixedClock('2026-11-04T10:00:00Z'), table);

    await expect(clock.onModuleInit()).rejects.toThrow('connection lost');
  });

  it('keeps the row it last read when a later read fails', async () => {
    const real = new FixedClock('2026-11-04T10:00:00Z');
    const table = new FakeTable();
    table.jump(new Date('2026-11-04T09:00:00Z'), new Date('2026-11-05T09:00:05Z'));
    const clock = clockOver(real, table);
    await clock.onModuleInit();

    table.failing = true;
    await expect(clock.refresh()).rejects.toThrow('connection lost');

    expect(clock.now().toISOString()).toBe('2026-11-05T10:00:00.000Z');
    await clock.onModuleDestroy();
  });

  it('reads nothing and shows real time where DEMO_CLOCK is off', async () => {
    const table = new FakeTable();
    table.jump(new Date('2026-11-04T09:00:00Z'), new Date('2026-11-05T09:00:05Z'));
    const clock = clockOver(new FixedClock('2026-11-04T10:00:00Z'), table, {
      ...CONFIG,
      demoClock: false,
    });

    await clock.onModuleInit();

    expect(table.reads).toBe(0);
    expect(clock.now().toISOString()).toBe('2026-11-04T10:00:00.000Z');
  });

  it('reads the row every refresh period and stops on shutdown', async () => {
    vi.useFakeTimers();
    try {
      const table = new FakeTable();
      const clock = clockOver(new FixedClock('2026-11-04T10:00:00Z'), table);
      await clock.onModuleInit();
      expect(table.reads).toBe(1);

      await vi.advanceTimersByTimeAsync(HOUR);
      expect(table.reads).toBe(2);

      await clock.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(3 * HOUR);
      expect(table.reads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // Correction 1: "every process changes time at the same moment" (task, Done when), also when
  // one process missed a refresh between two quick jumps (two tabs, under 2 seconds apart).
  it('gives two processes the same moment at every instant, one of which missed a jump', async () => {
    const real = new FixedClock('2026-11-04T10:00:00Z');
    const table = new FakeTable();
    const seenBoth = clockOver(real, table);
    const missedOne = clockOver(real, table);
    await seenBoth.onModuleInit();
    await missedOne.onModuleInit();

    // The first jump: to tomorrow, taking effect at 10:00:05.
    table.jump(real.now(), new Date('2026-11-05T10:00:05Z'));
    await seenBoth.refresh();
    // The second, a second later, before the first took effect: to the day after.
    real.advance(1_000);
    table.jump(real.now(), new Date('2026-11-06T10:00:06Z'));
    // Each process reads the row within its refresh period, before either jump takes effect.
    real.advance(1_000);
    await seenBoth.refresh();
    await missedOne.refresh();

    for (const at of [
      '2026-11-04T10:00:02Z',
      '2026-11-04T10:00:04.999Z',
      '2026-11-04T10:00:05Z',
      '2026-11-04T10:00:05.500Z',
      '2026-11-04T10:00:06Z',
      '2026-11-04T12:00:00Z',
    ]) {
      real.set(at);
      expect(seenBoth.now().toISOString(), at).toBe(missedOne.now().toISOString());
    }
    real.set('2026-11-04T10:00:05.999Z');
    expect(seenBoth.now().toISOString()).toBe('2026-11-04T10:00:05.999Z');
    real.set('2026-11-04T10:00:06Z');
    expect(seenBoth.now().toISOString()).toBe('2026-11-06T10:00:06.000Z');
    await seenBoth.onModuleDestroy();
    await missedOne.onModuleDestroy();
  });
});
