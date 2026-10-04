import type { Clock } from '@sodiq/shared';

/** A clock that shows the moment a test gives it and moves only when told. */
export class FixedClock implements Clock {
  private moment: number;

  /** `start` is a moment with its offset, for example `2026-10-05T23:59:00+05:00`. */
  constructor(start: string | Date) {
    this.moment = FixedClock.toMilliseconds(start);
  }

  now(): Date {
    return new Date(this.moment);
  }

  set(moment: string | Date): void {
    this.moment = FixedClock.toMilliseconds(moment);
  }

  advance(milliseconds: number): void {
    this.moment += milliseconds;
  }

  private static toMilliseconds(moment: string | Date): number {
    const value = new Date(moment).getTime();
    if (Number.isNaN(value)) {
      throw new Error('FixedClock needs a valid moment.');
    }
    return value;
  }
}
