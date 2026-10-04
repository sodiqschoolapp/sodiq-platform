import { Global, Module } from '@nestjs/common';
import { SystemClock } from './system-clock.js';

/** Injection token of the clock (`Clock` of `@sodiq/shared`). Tests replace it with a `FixedClock`. */
export const CLOCK = Symbol('CLOCK');

@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class ClockModule {}
