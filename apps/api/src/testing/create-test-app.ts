import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Clock, PermissionTable } from '@sodiq/shared';
import { AppModule } from '../app.module.js';
import { initApp } from '../app.setup.js';
import { CLOCK } from '../clock/clock.module.js';
import {
  DEMO_CLOCK_DEFAULT_TIMING,
  DEMO_CLOCK_TIMING,
  SYSTEM_CLOCK,
  type DemoClockTiming,
} from '../clock/demo-clock.js';
import { CONFIG } from '../config/config.module.js';
import { loadConfig, type AppConfig } from '../config/config.js';
import { databaseUrl, loadLocalEnvFile } from '../database/config.js';
import { createDatabase, type Database } from '../database/database.js';
import { DATABASE } from '../database/database.module.js';
import type { JobQueueOptions } from '../jobs/job-queue.js';
import { JOB_QUEUE_OPTIONS } from '../jobs/jobs.tokens.js';
import { PDF_RENDERER, type PdfRenderer } from '../http/pdf.js';
import { MAILER, RecordingMailer, type Mailer } from '../mail/mailer.js';
import { PERMISSION_TABLE } from '../modules/access/permission-table.token.js';
import { LiveSockets } from '../modules/notifications/live/socket-server.js';
import { PHOTO_STORE, type PhotoStore } from '../modules/people/photo-store.js';
import type { Fetch } from '../monitoring/grafana.js';
import { MONITORING_FETCH } from '../monitoring/monitoring.service.js';
import type { StopBeforeHandler } from './route-harness.js';
import { FixedClock } from './fixed-clock.js';
// From database-server.ts, which needs no vitest: the second API process of the speed run's load
// (testing/speed/server.ts, task 10.1c) builds this app in plain Node.
import { withDatabaseName } from './database-server.js';

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
  /**
   * Task 10.5: the application with the demo clock on (`DEMO_CLOCK=1`), over `real` as the
   * server's clock (usually a `FixedClock`). `CLOCK` is then the `DemoClock`, so `clock` is
   * left out. `timing` defaults to a jump that the test waits for by moving `real`.
   */
  demoClock?: { real: Clock; timing?: Partial<DemoClockTiming> };
  /** Settings of a server (`trustProxy`, `webFiles`) over those of the environment. */
  config?: Partial<AppConfig>;
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
  /** The photo store of the photo routes (`MemoryPhotoStore`, or one that fails). Without it: the configuration's. */
  photoStore?: PhotoStore;
  /** The PDFs (task 5.9c-1): a fake that keeps the HTML; unset, the real Chromium. */
  pdfRenderer?: PdfRenderer;
  /**
   * The mail service (task 2.3c-2). Without it: a `RecordingMailer` of its own,
   * so that no test prints a mail.
   */
  mailer?: Mailer;
  /** What the pushes to Grafana are sent through (task 10.2a), with `config.monitoring` set. */
  monitoringFetch?: Fetch;
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
  const demo = options.demoClock;
  if (demo !== undefined) {
    if (options.clock !== undefined) {
      throw new Error('A test app with the demo clock takes its real clock in demoClock.real.');
    }
    builder.overrideProvider(SYSTEM_CLOCK).useValue(demo.real);
    const real = demo.real;
    const timing: DemoClockTiming = {
      ...DEMO_CLOCK_DEFAULT_TIMING,
      // No reads on a timer: the test reads the row by the jump itself, or by `refresh`.
      refreshMs: 3_600_000,
      // The wait for a jump to take effect moves the test's real clock instead.
      wait: (milliseconds) => {
        if (real instanceof FixedClock && milliseconds > 0) real.advance(milliseconds);
        return Promise.resolve();
      },
      ...demo.timing,
    };
    builder.overrideProvider(DEMO_CLOCK_TIMING).useValue(timing);
  }
  if (options.config !== undefined || demo !== undefined) {
    builder.overrideProvider(CONFIG).useValue({
      ...loadConfig(process.env),
      ...options.config,
      ...(demo === undefined ? {} : { demoClock: true }),
    });
  }
  builder.overrideProvider(MAILER).useValue(options.mailer ?? new RecordingMailer());
  if (options.pdfRenderer !== undefined) {
    builder.overrideProvider(PDF_RENDERER).useValue(options.pdfRenderer);
  }
  if (options.photoStore !== undefined) {
    builder.overrideProvider(PHOTO_STORE).useValue(options.photoStore);
  }
  if (options.monitoringFetch !== undefined) {
    builder.overrideProvider(MONITORING_FETCH).useValue(options.monitoringFetch);
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
