import { Inject, Injectable } from '@nestjs/common';
import {
  DEMO_CLOCK_MAX_JUMP_DAYS,
  type Clock,
  type DemoClockJump,
  type DemoClockState,
} from '@sodiq/shared';
import { CLOCK, REAL_CLOCK } from '../../clock/clock.module.js';
import {
  DEMO_CLOCK_TIMING,
  DemoClock,
  demoMomentOf,
  readDemoClockRow,
  type DemoClockTiming,
} from '../../clock/demo-clock.js';
import { CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/config.js';
import { Transactions } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { Jobs } from '../../jobs/jobs.service.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { scheduleTickJob } from '../results/daily/daily-jobs.js';

const DAY_MS = 86_400_000;

/**
 * The demo clock of the test environment (task 10.5, pull request #280; the owner, 4 November
 * 2026): the Super Admin moves the platform's "now" forward. Demo time is real time plus the
 * offset of `demo_clock` (db/migrations/0156), which only grows (decision 5). A jump writes the
 * new offset to take effect `leadMs` after the write, so that every API instance and the worker,
 * which read the row every `refreshMs`, change time at the same real instant; it answers once it
 * has taken effect. The daily work of the new date is looked for by a `schedule.tick` written in
 * the jump's transaction to start after that instant (decision 4); days jumped over are not
 * replayed (decision 6).
 */
@Injectable()
export class DemoClockService {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly jobs: Jobs,
    private readonly demoClock: DemoClock,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(REAL_CLOCK) private readonly realClock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DEMO_CLOCK_TIMING) private readonly timing: DemoClockTiming,
  ) {}

  async read(): Promise<DemoClockState> {
    if (!this.config.demoClock) {
      const now = this.realClock.now().toISOString();
      return {
        enabled: false,
        realNow: now,
        demoNow: now,
        offsetMs: 0,
        effectiveAt: null,
        changedAt: null,
      };
    }
    const row = await this.transactions.run([], (transaction) =>
      transaction
        .selectFrom('demo_clock')
        .select(['offset_ms', 'previous_offset_ms', 'effective_at', 'changed_at'])
        .executeTakeFirst(),
    );
    const real = this.realClock.now();
    const offset =
      row === undefined
        ? 0
        : real.getTime() >= row.effective_at.getTime()
          ? Number(row.offset_ms)
          : Number(row.previous_offset_ms);
    return {
      enabled: true,
      realNow: real.toISOString(),
      demoNow: this.clock.now().toISOString(),
      offsetMs: offset,
      effectiveAt: row?.effective_at.toISOString() ?? null,
      changedAt: row?.changed_at.toISOString() ?? null,
    };
  }

  /**
   * Moves demo time to `jump.to` (a demo moment) at the real moment the jump takes effect.
   * Refused when the clock is off (`demo_clock_off`), when `to` is not after the demo time at
   * that moment (`demo_clock_backwards`, also the second of two jumps at once, which waits for
   * the row lock of the first), and beyond 400 days (`demo_clock_too_far`).
   */
  async jump(access: Access, jump: DemoClockJump, requestId: string): Promise<DemoClockState> {
    if (!this.config.demoClock) {
      throw new ApiException('demo_clock_off', 409);
    }
    const to = new Date(jump.to);
    const effectiveAt = await this.transactions.run([], async (transaction) => {
      const placed = this.realClock.now();
      // A missing row means offset 0; it is made here so that the lock below has a row to take.
      await transaction
        .insertInto('demo_clock')
        .values({
          id: true,
          offset_ms: '0',
          previous_offset_ms: '0',
          effective_at: placed,
          changed_at: placed,
          changed_by: access.accountId,
        })
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();
      await transaction.selectFrom('demo_clock').select('id').forUpdate().execute();
      // Read again after the lock, in a statement of its own (.claude/rules/database.md).
      const row = await readDemoClockRow(transaction);
      if (row === undefined) {
        throw new Error('The demo clock row is missing after it was made.');
      }
      const real = this.realClock.now();
      const takesEffect = new Date(real.getTime() + this.timing.leadMs);
      // The demo moment at `takesEffect` without this jump: the newest offset by then.
      const demoThen = takesEffect.getTime() + row.offsetMs;
      if (to.getTime() <= demoThen) {
        throw new ApiException('demo_clock_backwards', 409);
      }
      if (to.getTime() - demoThen > DEMO_CLOCK_MAX_JUMP_DAYS * DAY_MS) {
        throw new ApiException('demo_clock_too_far', 409);
      }
      const inForce = demoMomentOf(real, row).getTime() - real.getTime();
      const offset = to.getTime() - takesEffect.getTime();
      await transaction
        .updateTable('demo_clock')
        .set({
          offset_ms: String(offset),
          previous_offset_ms: String(inForce),
          effective_at: takesEffect,
          changed_at: real,
          changed_by: access.accountId,
        })
        .execute();
      await this.audit.record(transaction, {
        branchId: null,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'demo_clock.jump',
        oldValue: { demoAt: new Date(demoThen).toISOString(), offsetMs: row.offsetMs },
        newValue: { demoAt: to.toISOString(), offsetMs: offset },
        details: { effectiveAt: takesEffect.toISOString() },
        requestId,
      });
      await this.jobs.enqueue(transaction, scheduleTickJob, {
        branchIds: [],
        data: {},
        startAfter: new Date(takesEffect.getTime() + this.timing.tickDelayMs),
      });
      return takesEffect;
    });
    await this.timing.wait(effectiveAt.getTime() - this.realClock.now().getTime());
    await this.demoClock.refresh();
    return this.read();
  }
}
