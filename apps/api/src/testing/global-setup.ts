import { loadLocalEnvFile, migrationsDirectory } from '../database/config.js';
import { migrate } from '../database/migrate.js';
import {
  createEmptyDatabase,
  dropLeftOverTestDatabases,
  TEMPLATE_DATABASE,
} from './test-database.js';

/**
 * Runs once before the test files. Removes what an interrupted run left behind
 * and builds the template that `createTestDatabase` copies, by running the real
 * migration runner on the real migrations.
 */
export default async function setup(): Promise<void> {
  loadLocalEnvFile();
  await dropLeftOverTestDatabases();
  const connectionString = await createEmptyDatabase(TEMPLATE_DATABASE);
  await migrate({ connectionString, directory: migrationsDirectory });
}
