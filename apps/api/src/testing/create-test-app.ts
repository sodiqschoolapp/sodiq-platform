import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { databaseUrl, loadLocalEnvFile } from '../database/config.js';
import { createDatabase, type Database } from '../database/database.js';
import { DATABASE } from '../database/database.module.js';
import { withDatabaseName } from './test-database.js';

/** Does not exist, so a test that forgot to pass a database fails instead of using `sodiq_dev`. */
const NO_DATABASE = 'sodiq_test_database_not_passed';

/**
 * The whole application, set up as in `main.ts`, without listening on a port.
 * Pass `database` (the `app` connection of a `TestDatabase`) for tests that
 * reach the database. Closing the application closes that connection.
 */
export async function createTestApp(
  options: { database?: Database } = {},
): Promise<NestExpressApplication> {
  loadLocalEnvFile();
  const database =
    options.database ?? createDatabase(withDatabaseName(databaseUrl('DATABASE_URL'), NO_DATABASE));
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(database)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}
