import { Global, Module, type DynamicModule } from '@nestjs/common';
import { CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.js';
import { JOB_DEFINITIONS } from './job-list.js';
import { JobQueue, type JobQueueOptions } from './job-queue.js';
import { JobRunner } from './job-runner.js';
import { Jobs } from './jobs.service.js';
import { JOB_DEFINITIONS_LIST, JOB_QUEUE_OPTIONS } from './jobs.tokens.js';

// Global, like the database and audit modules: any module may enqueue a job
// and name a handler. The pg-boss instance itself (JobQueue) is not exported.
@Global()
@Module({})
export class JobsModule {
  /** `worker: true` only in the worker's entry point (src/worker.ts). */
  static forRoot(role: { worker: boolean }): DynamicModule {
    return {
      module: JobsModule,
      providers: [
        { provide: JOB_DEFINITIONS_LIST, useValue: JOB_DEFINITIONS },
        {
          provide: JOB_QUEUE_OPTIONS,
          inject: [CONFIG],
          useFactory: (config: AppConfig): JobQueueOptions => ({
            connectionString: config.databaseUrl,
            worker: role.worker,
            unscheduled: config.unscheduledJobs,
          }),
        },
        JobQueue,
        Jobs,
        JobRunner,
      ],
      exports: [Jobs, JobRunner],
    };
  }
}
