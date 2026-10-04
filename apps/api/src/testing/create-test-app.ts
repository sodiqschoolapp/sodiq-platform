import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Clock } from '@sodiq/shared';
import { AppModule } from '../app.module.js';
import { initApp } from '../app.setup.js';
import { CLOCK } from '../clock/clock.module.js';
import { databaseUrl, loadLocalEnvFile } from '../database/config.js';
import { createDatabase, type Database } from '../database/database.js';
import { DATABASE } from '../database/database.module.js';
import { withDatabaseName } from './test-database.js';

/** Does not exist, so a test that forgot to pass a database fails instead of using `sodiq_dev`. */
const NO_DATABASE = 'sodiq_test_database_not_passed';

export interface TestAppOptions {
  /** The `app` connection of a `TestDatabase`. Closing the application closes it. */
  database?: Database;
  /** Usually a `FixedClock`. Without it the application reads the system clock. */
  clock?: Clock;
  /** Controllers that exist only in tests, for example `SampleController`. */
  controllers?: Type[];
}

/**
 * The whole application, set up as in `main.ts`, without listening on a port.
 * Pass `database` for tests that reach the database.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestExpressApplication> {
  loadLocalEnvFile();
  const database =
    options.database ?? createDatabase(withDatabaseName(databaseUrl('DATABASE_URL'), NO_DATABASE));
  const builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(DATABASE)
    .useValue(database);
  if (options.clock !== undefined) {
    builder.overrideProvider(CLOCK).useValue(options.clock);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  await initApp(app);
  return app;
}
