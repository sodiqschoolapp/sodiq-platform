import type { TestProject } from 'vitest/node';
import { loadLocalEnvFile, migrationsDirectory } from '../database/config.js';
import { migrate } from '../database/migrate.js';
import {
  createEmptyDatabase,
  dropDatabasesOfRun,
  dropStaleTestDatabases,
  newRunPrefix,
  templateOf,
} from './test-database.js';

/**
 * Runs once before the test files. Builds the template that `createTestDatabase`
 * copies, by running the real migration runner on the real migrations, and
 * removes this run's databases at the end.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  loadLocalEnvFile();
  // Test tooling, not business code: the time only names and ages the databases.
  const now = Date.now();
  await dropStaleTestDatabases(now);

  const runPrefix = newRunPrefix(now);
  const connectionString = await createEmptyDatabase(templateOf(runPrefix));
  await migrate({ connectionString, directory: migrationsDirectory });
  project.provide('testRunPrefix', runPrefix);

  return () => dropDatabasesOfRun(runPrefix);
}
