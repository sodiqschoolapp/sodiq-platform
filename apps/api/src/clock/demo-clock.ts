import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.js';
import type { Database } from '../database/database.js';
import { DATABASE } from '../database/database.tokens.js';

/** Injection token of the clock of the server itself, under the demo clock. Tests replace it. */
export const SYSTEM_CLOCK = Symbol('SYSTEM_CLOCK');

/** Injection token of the timing of the demo clock (`DemoClockTiming`). Tests replace it. */
export const DEMO_CLOCK_TIMING = Symbol('DEMO_CLOCK_TIMING');

/** How the demo clock keeps every process at one moment (task 10.5, plan "One switch moment"). */
export interface DemoClockTiming {
  /** How long after it is written a jump takes effect: longer than two refreshes. */
  readonly leadMs: number;
  /** How often each process reads the row. */
  readonly refreshMs: number;
  /** How long after the jump takes effect the daily work of the new date is looked for. */
  readonly tickDelayMs: number;
  /** Waits that long; the jump answers only once it has taken effect. Tests move their clock. */
  readonly wait: (milliseconds: number) => Promise<void>;
}

export const DEMO_CLOCK_DEFAULT_TIMING: DemoClockTiming = {
  leadMs: 5_000,
  refreshMs: 2_000,
  tickDelayMs: 2_000,
  wait: (milliseconds) =>
    new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, milliseconds));
    }),
};

/** The row of `demo_clock` (db/migrations/0156), as the clock needs it. */
export interface DemoClockRow {
  readonly offsetMs: number;
  readonly previousOffsetMs: number;
  readonly effectiveAt: Date;
}

/**
 * The demo moment at a real moment, from the row alone (correction 1 of the plan review): the
 * offset once real time has reached `effectiveAt`, the previous one before. No row: real time.
 */
export function demoMomentOf(real: Date, row: DemoClockRow | undefined): Date {
  if (row === undefined) return new Date(real.getTime());
  const offset = real.getTime() >= row.effectiveAt.getTime() ? row.offsetMs : row.previousOffsetMs;
  return new Date(real.getTime() + offset);
}

/** Reads the row; `undefined` when there is none. */
export async function readDemoClockRow(
  database: Pick<Database, 'selectFrom'>,
): Promise<DemoClockRow | undefined> {
  const row = await database
    .selectFrom('demo_clock')
    .select(['offset_ms', 'previous_offset_ms', 'effective_at'])
    .executeTakeFirst();
  return row === undefined
    ? undefined
    : {
        offsetMs: Number(row.offset_ms),
        previousOffsetMs: Number(row.previous_offset_ms),
        effectiveAt: row.effective_at,
      };
}

/**
 * The clock of every business rule on the test environment (task 10.5): the server's clock plus
 * the offset of `demo_clock`. The row is read before the process serves anything (correction 2:
 * a failed first read refuses the start) and again every `refreshMs`; a failed later read keeps
 * the row last read and is logged. Where `DEMO_CLOCK` is off it reads nothing and shows the
 * server's clock (and `CLOCK` is not this one: `clock.module.ts`).
 */
@Injectable()
export class DemoClock implements Clock, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DemoClock');
  private row: DemoClockRow | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private reading: Promise<void> | undefined;

  constructor(
    @Inject(SYSTEM_CLOCK) private readonly real: Clock,
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DEMO_CLOCK_TIMING) private readonly timing: DemoClockTiming,
  ) {}

  now(): Date {
    return demoMomentOf(this.real.now(), this.row);
  }

  /** Whether demo time is ahead of real time now: from the first jump that took effect. */
  moved(): boolean {
    const real = this.real.now();
    return demoMomentOf(real, this.row).getTime() > real.getTime();
  }

  /** Correction 2: the first read before the API listens and before the worker takes jobs. */
  async onModuleInit(): Promise<void> {
    if (!this.config.demoClock) return;
    await this.refresh();
    this.timer = setInterval(() => {
      this.refresh().catch((error: unknown) => {
        this.logger.error(
          `The demo clock could not read its row; it keeps the last one. ${String(error)}`,
        );
      });
    }, this.timing.refreshMs);
    // The timer never keeps a process alive on its own.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Reads the row now. Two calls at once share one read. */
  refresh(): Promise<void> {
    this.reading ??= readDemoClockRow(this.database)
      .then((row) => {
        this.row = row;
      })
      .finally(() => {
        this.reading = undefined;
      });
    return this.reading;
  }
}
