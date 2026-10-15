import { randomBytes } from 'node:crypto';
import { escapeIdentifier } from 'pg';
import { inject } from 'vitest';
import { databaseUrl } from '../database/config.js';
import { createDatabase, type Database } from '../database/database.js';
import {
  createEmptyDatabase,
  dropDatabaseOnceUnused,
  onServer,
  withDatabaseName,
} from './database-server.js';

export { createEmptyDatabase, withDatabaseName };

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

/** Each run has its own prefix, so two runs at once do not touch each other's databases. */
export function newRunPrefix(nowMs: number): string {
  return `${PREFIX}${String(Math.floor(nowMs / 1000))}_${randomBytes(3).toString('hex')}_`;
}

export function templateOf(runPrefix: string): string {
  return `${runPrefix}template`;
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
    // A database's rights are not copied from its template: the revoke of
    // 0058 (task 5.1a, decision 3) is made again on the copy.
    await onServer((client) =>
      client.query(`revoke temporary on database ${escapeIdentifier(name)} from public, sodiq_app`),
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
      await dropDatabaseOnceUnused(name);
    },
  };
}
