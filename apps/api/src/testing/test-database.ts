import { randomBytes } from 'node:crypto';
import { Client, escapeIdentifier } from 'pg';
import { databaseUrl, loadLocalEnvFile } from '../database/config.js';
import { createDatabase, type Database } from '../database/database.js';

/** Built once per test run by `global-setup.ts` from the real migrations. */
export const TEMPLATE_DATABASE = 'sodiq_test_template';
const PREFIX = 'sodiq_test_';

export interface TestDatabase {
  name: string;
  /** Connects as `sodiq_app`, like the API: a missing right fails the test. */
  app: Database;
  /** Connects as `sodiq_migrator`, the owner, for scratch tables and checks. */
  migrator: Database;
  appUrl: string;
  migrationUrl: string;
  /** Closes both connections and drops the database. */
  destroy: () => Promise<void>;
}

function withDatabaseName(url: string, name: string): string {
  const copy = new URL(url);
  copy.pathname = `/${name}`;
  return copy.toString();
}

/** Runs statements as the migration user in the server's `postgres` database. */
async function onServer<T>(run: (client: Client) => Promise<T>): Promise<T> {
  loadLocalEnvFile();
  const client = new Client({
    connectionString: withDatabaseName(databaseUrl('DATABASE_MIGRATION_URL'), 'postgres'),
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

export async function dropLeftOverTestDatabases(): Promise<void> {
  await onServer(async (client) => {
    const found = await client.query<{ datname: string }>(
      'select datname from pg_database where starts_with(datname, $1)',
      [PREFIX],
    );
    for (const row of found.rows) {
      await client.query(`drop database ${escapeIdentifier(row.datname)} with (force)`);
    }
  });
}

/** A database with nothing in it: for the template and for tests of the migration runner. */
export async function createEmptyDatabase(name: string): Promise<string> {
  await onServer((client) => client.query(`create database ${escapeIdentifier(name)}`));
  return withDatabaseName(databaseUrl('DATABASE_MIGRATION_URL'), name);
}

/**
 * A new database for one test file. By default it is a copy of the template,
 * so it has every migration and no rows. Call `destroy` in `afterAll`.
 */
export async function createTestDatabase(options: { empty?: boolean } = {}): Promise<TestDatabase> {
  const name = `${PREFIX}${randomBytes(6).toString('hex')}`;
  if (options.empty === true) {
    await createEmptyDatabase(name);
  } else {
    await onServer((client) =>
      client.query(
        `create database ${escapeIdentifier(name)} template ${escapeIdentifier(TEMPLATE_DATABASE)}`,
      ),
    );
  }
  const appUrl = withDatabaseName(databaseUrl('DATABASE_URL'), name);
  const migrationUrl = withDatabaseName(databaseUrl('DATABASE_MIGRATION_URL'), name);
  const app = createDatabase(appUrl);
  const migrator = createDatabase(migrationUrl);
  return {
    name,
    app,
    migrator,
    appUrl,
    migrationUrl,
    destroy: async () => {
      await app.destroy();
      await migrator.destroy();
      await onServer((client) =>
        client.query(`drop database ${escapeIdentifier(name)} with (force)`),
      );
    },
  };
}
