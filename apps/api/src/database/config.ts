import { existsSync } from 'node:fs';
import path from 'node:path';

// src/database and dist/database are both four levels below the repository root.
export const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');

export const migrationsDirectory = path.join(repositoryRoot, 'db/migrations');

/**
 * Reads the root `.env` on a developer machine. Variables that are already set
 * win, so CI and the servers, which have no `.env`, are not affected. The
 * values are checked afterwards by `loadConfig` (src/config).
 */
export function loadLocalEnvFile(): void {
  const file = path.join(repositoryRoot, '.env');
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

export type DatabaseUrlName = 'DATABASE_URL' | 'DATABASE_MIGRATION_URL';

export function databaseUrl(name: DatabaseUrlName): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set. On a developer machine: run db/setup/local.sql once and copy .env.example to .env (README.md, Setup).`,
    );
  }
  return value;
}
