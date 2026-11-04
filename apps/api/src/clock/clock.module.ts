import { Global, Module } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.js';
import {
  DEMO_CLOCK_DEFAULT_TIMING,
  DEMO_CLOCK_TIMING,
  DemoClock,
  SYSTEM_CLOCK,
} from './demo-clock.js';
import { SystemClock } from './system-clock.js';

/**
 * Injection token of the clock (`Clock` of `@sodiq/shared`): what every business rule reads.
 * Tests replace it with a `FixedClock`. On the test environment (`DEMO_CLOCK=1`, task 10.5) it
 * is the `DemoClock`; everywhere else the server's clock.
 */
export const CLOCK = Symbol('CLOCK');

/**
 * Injection token of real time (task 10.5, decision 1, Look first): what the timing of sign-in
 * reads (sessions, trusted devices, the second step, the throttle, one-time passwords, reset
 * links), so that a jump of the demo clock signs nobody out. With `DEMO_CLOCK` off it is the
 * same clock as `CLOCK`, also a test's `FixedClock` that replaces it, so production and every
 * test without the demo clock have one clock, as before.
 */
export const REAL_CLOCK = Symbol('REAL_CLOCK');

@Global()
@Module({
  providers: [
    { provide: SYSTEM_CLOCK, useClass: SystemClock },
    { provide: DEMO_CLOCK_TIMING, useValue: DEMO_CLOCK_DEFAULT_TIMING },
    DemoClock,
    {
      provide: CLOCK,
      inject: [CONFIG, SYSTEM_CLOCK, DemoClock],
      useFactory: (config: AppConfig, system: Clock, demo: DemoClock): Clock =>
        config.demoClock ? demo : system,
    },
    {
      provide: REAL_CLOCK,
      inject: [CONFIG, SYSTEM_CLOCK, CLOCK],
      useFactory: (config: AppConfig, system: Clock, clock: Clock): Clock =>
        config.demoClock ? system : clock,
    },
  ],
  exports: [CLOCK, REAL_CLOCK, DemoClock, DEMO_CLOCK_TIMING],
})
export class ClockModule {}
