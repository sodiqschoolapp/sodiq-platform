import { Global, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { stopReporting } from './reporting.js';

/**
 * Ends the reports when the application stops, after the connections closed:
 * the last report of a stop still leaves (task 0.10). The reports themselves
 * start in the entry points (`main.ts`, `worker.ts`), before the application.
 */
@Injectable()
export class Reporting implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await stopReporting();
  }
}

@Global()
@Module({ providers: [Reporting] })
export class ReportingModule {}
