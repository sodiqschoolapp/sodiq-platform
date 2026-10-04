import { setTimeout as delay } from 'node:timers/promises';
import { Client, escapeIdentifier } from 'pg';
import { databaseUrl, loadLocalEnvFile } from '../database/config.js';

// What the API tests (test-database.ts) and the database of the browser tests
// (e2e/) share: creating and dropping whole databases on this machine. Nothing
// here needs vitest.

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export function withDatabaseName(url: string, name: string): string {
  const copy = new URL(url);
  copy.pathname = `/${name}`;
  return copy.toString();
}

/** The tests create and force-drop databases, so they only ever talk to a PostgreSQL on this machine. */
export function requireLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `The tests create and drop databases and refuse to run against "${host}". DATABASE_URL and DATABASE_MIGRATION_URL must point at localhost.`,
    );
  }
}

/** Runs statements as the migration user in the server's `postgres` database. */
export async function onServer<T>(run: (client: Client) => Promise<T>): Promise<T> {
  loadLocalEnvFile();
  const url = withDatabaseName(databaseUrl('DATABASE_MIGRATION_URL'), 'postgres');
  requireLocalDatabase(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** A database with nothing in it: for the template and for tests of the migration runner. */
export async function createEmptyDatabase(name: string): Promise<string> {
  await onServer((client) => client.query(`create database ${escapeIdentifier(name)}`));
  return withDatabaseName(databaseUrl('DATABASE_MIGRATION_URL'), name);
}

/**
 * Drops a database whose connections were just closed, or does nothing when it
 * does not exist. A backend lives a moment longer than the connection that was
 * just closed. `with (force)` would have to terminate it, and the owner may not
 * terminate a backend of the application user: wait until it is gone.
 */
export async function dropDatabaseOnceUnused(name: string): Promise<void> {
  await onServer(async (client) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const found = await client.query<{ open: number }>(
        'select count(*)::int as open from pg_stat_activity where datname = $1',
        [name],
      );
      if (found.rows[0]?.open === 0) {
        break;
      }
      await delay(50);
    }
    await client.query(`drop database if exists ${escapeIdentifier(name)} with (force)`);
  });
}
