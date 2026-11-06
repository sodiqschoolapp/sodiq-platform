import type { Clock } from '@sodiq/shared';

const WITH_OFFSET = /T\d{2}:\d{2}.*(Z|[+-]\d{2}:\d{2})$/;

/**
 * A clock that shows the moment a test gives it and moves only when told, or, once told to run
 * (`runFrom`), with real time from that moment until it is set again.
 */
export class FixedClock implements Clock {
  private moment: number;
  /** The real moment (milliseconds since the epoch) the clock showed `moment` at, while it runs. */
  private runningSince: number | null = null;

  /** `start` is a moment with its offset, for example `2026-10-05T23:59:00+05:00`. */
  constructor(start: string | Date) {
    this.moment = FixedClock.toMilliseconds(start);
  }

  now(): Date {
    return new Date(
      this.moment + (this.runningSince === null ? 0 : Date.now() - this.runningSince),
    );
  }

  set(moment: string | Date): void {
    this.moment = FixedClock.toMilliseconds(moment);
    this.runningSince = null;
  }

  advance(milliseconds: number): void {
    this.moment += milliseconds;
  }

  /**
   * Task 10.1c (the load of the speed run, review of the plan, finding 1): from now on the clock
   * shows its moment at the real moment `realStart` and moves with real time, as the live
   * system's clock does. Two processes given the same moment and `realStart` show the same time.
   */
  runFrom(realStart: number): void {
    this.runningSince = realStart;
  }

  /** Stops a running clock at the moment it shows now. */
  stop(): void {
    this.moment = this.now().getTime();
    this.runningSince = null;
  }

  private static toMilliseconds(moment: string | Date): number {
    // Without an offset the text would mean another moment on a machine in
    // another time zone: a test would pass in Tashkent and fail in CI.
    if (typeof moment === 'string' && !WITH_OFFSET.test(moment)) {
      throw new Error('FixedClock needs a moment with its offset, for example +05:00 or Z.');
    }
    const value = new Date(moment).getTime();
    if (Number.isNaN(value)) {
      throw new Error('FixedClock needs a valid moment.');
    }
    return value;
  }
}
