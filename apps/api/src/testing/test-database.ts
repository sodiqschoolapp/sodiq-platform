import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, escapeIdentifier } from 'pg';
import { inject } from 'vitest';
import { databaseUrl, loadLocalEnvFile } from '../database/config.js';
import { createDatabase, type Database } from '../database/database.js';

declare module 'vitest' {
  interface ProvidedContext {
    /** The prefix of every database of this test run, set by `global-setup.ts`. */
    testRunPrefix: string;
  }
}

const PREFIX = 'sodiq_test_';
// sodiq_test_<start of the run in seconds>_<random>_<template or random>
const RUN_DATABASE = /^sodiq_test_(\d+)_[0-9a-f]+_/;
const STALE_AFTER_SECONDS = 60 * 60;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

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

export function withDatabaseName(url: string, name: string): string {
  const copy = new URL(url);
  copy.pathname = `/${name}`;
  return copy.toString();
}

/** Each run has its own prefix, so two runs at once do not touch each other's databases. */
export function newRunPrefix(nowMs: number): string {
  return `${PREFIX}${String(Math.floor(nowMs / 1000))}_${randomBytes(3).toString('hex')}_`;
}

export function templateOf(runPrefix: string): string {
  return `${runPrefix}template`;
}

/**
 * Runs statements as the migration user in the server's `postgres` database.
 * The tests create and force-drop databases, so they only ever talk to a
 * PostgreSQL on this machine.
 */
async function onServer<T>(run: (client: Client) => Promise<T>): Promise<T> {
  loadLocalEnvFile();
  const url = withDatabaseName(databaseUrl('DATABASE_MIGRATION_URL'), 'postgres');
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `The tests create and drop databases and refuse to run against "${host}". DATABASE_MIGRATION_URL must point at localhost.`,
    );
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function dropWhere(shouldDrop: (name: string) => boolean): Promise<void> {
  await onServer(async (client) => {
    const found = await client.query<{ datname: string }>(
      'select datname from pg_database where starts_with(datname, $1)',
      [PREFIX],
    );
    for (const row of found.rows.filter((candidate) => shouldDrop(candidate.datname))) {
      await client.query(`drop database if exists ${escapeIdentifier(row.datname)} with (force)`);
    }
  });
}

/** At the end of a run: its template and whatever a failed file left behind. */
export function dropDatabasesOfRun(runPrefix: string): Promise<void> {
  return dropWhere((name) => name.startsWith(runPrefix));
}

/** At the start of a run: what an interrupted run left behind more than an hour ago. */
export function dropStaleTestDatabases(nowMs: number): Promise<void> {
  return dropWhere((name) => {
    const startedAt = RUN_DATABASE.exec(name)?.[1];
    return startedAt === undefined || nowMs / 1000 - Number(startedAt) > STALE_AFTER_SECONDS;
  });
}

/** A database with nothing in it: for the template and for tests of the migration runner. */
export async function createEmptyDatabase(name: string): Promise<string> {
  await onServer((client) => client.query(`create database ${escapeIdentifier(name)}`));
  return withDatabaseName(databaseUrl('DATABASE_MIGRATION_URL'), name);
}

/**
 * A new database for one test file. By default it is a copy of the run's
 * template, so it has every migration and no rows. Call `destroy` in `afterAll`.
 */
export async function createTestDatabase(options: { empty?: boolean } = {}): Promise<TestDatabase> {
  const runPrefix = inject('testRunPrefix');
  const name = `${runPrefix}${randomBytes(6).toString('hex')}`;
  if (options.empty === true) {
    await createEmptyDatabase(name);
  } else {
    await onServer((client) =>
      client.query(
        `create database ${escapeIdentifier(name)} template ${escapeIdentifier(templateOf(runPrefix))}`,
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
      await onServer(async (client) => {
        // A backend lives a moment longer than the connection that was just
        // closed. `with (force)` would have to terminate it, and the owner may
        // not terminate a backend of the application user: wait until it is gone.
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
        await client.query(`drop database ${escapeIdentifier(name)} with (force)`);
      });
    },
  };
}
