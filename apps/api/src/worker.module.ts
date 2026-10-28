import { Module } from '@nestjs/common';
import { SHARED_MODULES } from './app.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MonitoringModule } from './monitoring/monitoring.module.js';

/** The jobs worker: the same modules as the API, started without HTTP. */
@Module({
  imports: [
    ...SHARED_MODULES,
    JobsModule.forRoot({ worker: true }),
    MonitoringModule.forRoot('worker'),
  ],
})
export class WorkerModule {}
