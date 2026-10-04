import type { Clock } from '@sodiq/shared';

/** The clock of the server. The only place in business code that reads the time. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
