import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Clock, PermissionTable } from '@sodiq/shared';
import { AppModule } from '../app.module.js';
import { initApp } from '../app.setup.js';
import { CLOCK } from '../clock/clock.module.js';
import { databaseUrl, loadLocalEnvFile } from '../database/config.js';
import { createDatabase, type Database } from '../database/database.js';
import { DATABASE } from '../database/database.module.js';
import type { JobQueueOptions } from '../jobs/job-queue.js';
import { JOB_QUEUE_OPTIONS } from '../jobs/jobs.tokens.js';
import { PERMISSION_TABLE } from '../modules/access/permission-table.token.js';
import { LiveSockets } from '../modules/notifications/live/socket-server.js';
import type { StopBeforeHandler } from './route-harness.js';
import { withDatabaseName } from './test-database.js';

/** Does not exist, so a test that forgot to pass a database fails instead of using `sodiq_dev`. */
const NO_DATABASE = 'sodiq_test_database_not_passed';

export interface TestAppOptions {
  /** The `app` connection of a `TestDatabase`. Closing the application closes it. */
  database?: Database;
  /**
   * The `appUrl` of the same `TestDatabase`, for a test whose route enqueues a
   * job. Without it the first job fails instead of reaching `sodiq_dev`.
   */
  jobsDatabaseUrl?: string;
  /** For a test that runs the jobs in its process (`JobRunner.start`): how often it looks for them. */
  jobsPollingIntervalSeconds?: number;
  /** Usually a `FixedClock`. Without it the application reads the system clock. */
  clock?: Clock;
  /** Controllers that exist only in tests, for example `SampleController`. */
  controllers?: Type[];
  /**
   * The permission table the guard reads, for test controllers with areas of
   * their own (`SAMPLE_PERMISSIONS`). Without it: the table of the application.
   */
  permissionTable?: PermissionTable;
  /**
   * For the route-by-role harness: while it is switched on, a request that
   * passes the guards is answered before its handler runs.
   */
  handlerStop?: StopBeforeHandler;
}

/**
 * The whole application, set up as in `main.ts`, without listening on a port.
 * Pass `database` for tests that reach the database.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestExpressApplication> {
  loadLocalEnvFile();
  const database =
    options.database ?? createDatabase(withDatabaseName(databaseUrl('DATABASE_URL'), NO_DATABASE));
  // The job queue has a connection of its own; it must never be that of `sodiq_dev`.
  const jobQueue: JobQueueOptions = {
    connectionString:
      options.jobsDatabaseUrl ?? withDatabaseName(databaseUrl('DATABASE_URL'), NO_DATABASE),
    worker: false,
    ...(options.jobsPollingIntervalSeconds === undefined
      ? {}
      : { pollingIntervalSeconds: options.jobsPollingIntervalSeconds }),
  };
  const builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(DATABASE)
    .useValue(database)
    .overrideProvider(JOB_QUEUE_OPTIONS)
    .useValue(jobQueue);
  if (options.clock !== undefined) {
    builder.overrideProvider(CLOCK).useValue(options.clock);
  }
  if (options.permissionTable !== undefined) {
    builder.overrideProvider(PERMISSION_TABLE).useValue(options.permissionTable);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  if (options.handlerStop !== undefined) {
    // Before the interceptors of the application, so that none of them sees the empty answer.
    app.useGlobalInterceptors(options.handlerStop);
  }
  await initApp(app);
  // As main.ts: the live connection is on the server of every test app; a test
  // that needs pushes also starts `LiveListener` with the address of its database.
  app.get(LiveSockets).attach(app.getHttpServer());
  return app;
}
