import { databaseUrl, loadLocalEnvFile, migrationsDirectory } from '../../database/config.js';
import { migrate } from '../../database/migrate.js';
import {
  createEmptyDatabase,
  dropDatabaseOnceUnused,
  requireLocalDatabase,
  withDatabaseName,
} from '../database-server.js';

/**
 * The database of the browser tests (Playwright). It is dropped and built
 * again from the real migrations at the start of every run, so `sodiq_dev`
 * stays for hand tests and collects no test accounts (decided by the owner,
 * task 0.8a).
 */
export const E2E_DATABASE = 'sodiq_e2e';

export interface E2eDatabaseUrls {
  /** As `sodiq_app`, like the API. */
  appUrl: string;
  /** As `sodiq_migrator`, the owner. */
  migrationUrl: string;
}

/**
 * The two addresses of `.env` or of CI, with the name of the database
 * replaced. Refused unless both point at this machine.
 */
export function e2eDatabaseUrls(): E2eDatabaseUrls {
  loadLocalEnvFile();
  const urls = {
    appUrl: withDatabaseName(databaseUrl('DATABASE_URL'), E2E_DATABASE),
    migrationUrl: withDatabaseName(databaseUrl('DATABASE_MIGRATION_URL'), E2E_DATABASE),
  };
  requireLocalDatabase(urls.appUrl);
  requireLocalDatabase(urls.migrationUrl);
  return urls;
}

/** Drops what the last run left and builds the database again: every migration, no rows. */
export async function rebuildE2eDatabase(): Promise<E2eDatabaseUrls> {
  // First: nothing is dropped or created when an address is not local.
  const urls = e2eDatabaseUrls();
  await dropDatabaseOnceUnused(E2E_DATABASE);
  const connectionString = await createEmptyDatabase(E2E_DATABASE);
  await migrate({ connectionString, directory: migrationsDirectory });
  return urls;
}
