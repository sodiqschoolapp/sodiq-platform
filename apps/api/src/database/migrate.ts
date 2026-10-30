import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client, escapeIdentifier } from 'pg';

const FILE_NAME = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

// The runner wraps each file in its own transaction. A file that ends that
// transaction itself could be left half-applied, so it is refused unread.
// (A PL/pgSQL `begin` has no semicolon and `end;` is not matched.)
const TRANSACTION_CONTROL =
  /^\s*(?:begin|start\s+transaction|commit|rollback)(?:\s+(?:work|transaction))?\s*;/im;

// Task 10.1b: a file whose first line is this marker builds indexes without a
// long lock (`edge/system-behaviour`: "tables are never locked for long";
// CLAUDE.md, Conventions). It runs outside a transaction, statement by
// statement, and holds only `create index concurrently if not exists <name> on
// <table> (...)`. On a partitioned table the runner builds the index in two
// steps itself: on the parent only, then concurrently on each partition,
// attached to the parent's. A run that stops half-way is finished by the next
// one: an invalid index left by a failed build is dropped and built again, and
// the file is recorded only when every statement has succeeded.
export const INDEX_ONLY_MARKER = '-- migrate: no transaction';
const INDEX_STATEMENT =
  /^create index concurrently if not exists ([a-z_][a-z0-9_]*) on ([a-z_][a-z0-9_]*) (\(.+)$/is;

// One runner at a time per database: a second one waits here until the first
// has finished, then finds nothing left to apply.
const LOCK_NAME = 'sodiq_schema_migrations';

export class MigrationError extends Error {
  override name = 'MigrationError';
}

export interface MigrationFile {
  number: number;
  /** The file name without `.sql`, for example `0001_foundations`. */
  name: string;
  checksum: string;
  sql: string;
  /** Index builds only, run outside a transaction (`INDEX_ONLY_MARKER`). */
  indexOnly: boolean;
}

export interface MigrateOptions {
  /** Connection of the migration user, who owns the tables. */
  connectionString: string;
  directory: string;
  log?: (line: string) => void;
}

interface AppliedRow {
  number: number;
  name: string;
  checksum: string;
}

/**
 * Line endings do not count: a Windows editor that saves an applied file with
 * CRLF has not changed the migration.
 */
export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex');
}

export async function readMigrationFiles(directory: string): Promise<MigrationFile[]> {
  const files: MigrationFile[] = [];
  for (const entry of (await readdir(directory)).sort()) {
    if (!FILE_NAME.test(entry)) {
      throw new MigrationError(
        `"${entry}" in ${directory} is not named like 0001_short_name.sql (four digits, lower-case words, underscores).`,
      );
    }
    const sql = await readFile(path.join(directory, entry), 'utf8');
    if (TRANSACTION_CONTROL.test(sql)) {
      throw new MigrationError(
        `"${entry}" contains begin, commit or rollback. The runner already runs each file in one transaction; remove the statement.`,
      );
    }
    const indexOnly = sql.replaceAll('\r\n', '\n').split('\n', 1)[0]?.trim() === INDEX_ONLY_MARKER;
    if (indexOnly) indexStatementsOf(entry, sql);
    files.push({
      number: Number(entry.slice(0, 4)),
      name: entry.slice(0, -'.sql'.length),
      checksum: checksumOf(sql),
      sql,
      indexOnly,
    });
  }
  for (const [index, file] of files.entries()) {
    const previous = files[index - 1];
    if (previous?.number === file.number) {
      throw new MigrationError(
        `Two migrations have the number ${String(file.number)}: ${previous.name} and ${file.name}.`,
      );
    }
  }
  return files;
}

interface IndexStatement {
  index: string;
  table: string;
  /** The columns and what follows them: `(lesson_id)`, `(a, b) where ...`. */
  rest: string;
}

/** The statements of an index-only file, each checked against the one form it may hold. */
export function indexStatementsOf(entry: string, sql: string): IndexStatement[] {
  const statements = sql
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((one) => one.replace(/\s+/g, ' ').trim())
    .filter((one) => one !== '');
  return statements.map((statement) => {
    const found = INDEX_STATEMENT.exec(statement);
    if (found?.[1] === undefined || found[2] === undefined || found[3] === undefined) {
      throw new MigrationError(
        `"${entry}" runs outside a transaction and may hold only "create index concurrently if not exists <name> on <table> (...)"; found: ${statement.slice(0, 120)}`,
      );
    }
    return { index: found[1], table: found[2], rest: found[3] };
  });
}

/** Drops an index of this name that a failed concurrent build left invalid. */
async function dropInvalid(client: Client, index: string): Promise<void> {
  const invalid = await client.query(
    'select 1 from pg_index where indexrelid = to_regclass($1) and not indisvalid',
    [index],
  );
  if (invalid.rowCount !== 0) {
    await client.query(`drop index concurrently ${escapeIdentifier(index)}`);
  }
}

/** Builds the indexes of an index-only file, each without a long lock; see `INDEX_ONLY_MARKER`. */
async function buildIndexes(client: Client, file: MigrationFile): Promise<void> {
  for (const { index, table, rest } of indexStatementsOf(file.name, file.sql)) {
    const partitioned = await client.query(
      "select 1 from pg_class where oid = to_regclass($1) and relkind = 'p'",
      [table],
    );
    if (partitioned.rowCount === 0) {
      await dropInvalid(client, index);
      await client.query(
        `create index concurrently if not exists ${escapeIdentifier(index)} on ${escapeIdentifier(table)} ${rest}`,
      );
      continue;
    }
    if (!index.startsWith(`${table}_`)) {
      throw new MigrationError(
        `"${file.name}": the index ${index} of the partitioned ${table} must begin with "${table}_", so the indexes of its partitions are named after it.`,
      );
    }
    // The parent's index is a catalog entry only (`on only`): no row is read, no lock is long.
    await client.query(
      `create index if not exists ${escapeIdentifier(index)} on only ${escapeIdentifier(table)} ${rest}`,
    );
    const partitions = await client.query<{ name: string }>(
      `select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid
       where i.inhparent = to_regclass($1) order by c.relname`,
      [table],
    );
    for (const { name } of partitions.rows) {
      const own = `${name}${index.slice(table.length)}`;
      await dropInvalid(client, own);
      await client.query(
        `create index concurrently if not exists ${escapeIdentifier(own)} on ${escapeIdentifier(name)} ${rest}`,
      );
      const attached = await client.query(
        'select 1 from pg_inherits where inhrelid = to_regclass($1) and inhparent = to_regclass($2)',
        [own, index],
      );
      if (attached.rowCount === 0) {
        await client.query(
          `alter index ${escapeIdentifier(index)} attach partition ${escapeIdentifier(own)}`,
        );
      }
    }
  }
}

/** A merged migration is never edited, removed or overtaken by a lower number. */
function pendingFiles(files: MigrationFile[], applied: AppliedRow[]): MigrationFile[] {
  const byNumber = new Map(files.map((file) => [file.number, file]));
  let lastApplied = 0;
  for (const row of applied) {
    const file = byNumber.get(row.number);
    if (file === undefined) {
      throw new MigrationError(
        `Migration ${row.name} is applied to the database but its file is missing.`,
      );
    }
    if (file.name !== row.name || file.checksum !== row.checksum) {
      throw new MigrationError(
        `Migration ${row.name} was changed after it was applied. A migration is never edited; write a new numbered file.`,
      );
    }
    lastApplied = Math.max(lastApplied, row.number);
  }
  const appliedNumbers = new Set(applied.map((row) => row.number));
  const pending = files.filter((file) => !appliedNumbers.has(file.number));
  for (const file of pending) {
    if (file.number < lastApplied) {
      throw new MigrationError(
        `Migration ${file.name} has a lower number than one that is already applied (${String(lastApplied)}). Give it the next free number.`,
      );
    }
  }
  return pending;
}

/**
 * Applies the numbered SQL files that the database does not have yet, in
 * order, each in its own transaction. Returns the names it applied.
 */
export async function migrate(options: MigrateOptions): Promise<string[]> {
  const files = await readMigrationFiles(options.directory);
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    // A session lock: it is released when this connection ends.
    await client.query('select pg_advisory_lock(hashtext($1))', [LOCK_NAME]);
    await client.query(`
      create table if not exists schema_migrations (
        number integer primary key,
        name text not null unique,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);
    const applied = await client.query<AppliedRow>(
      'select number, name, checksum from schema_migrations order by number',
    );

    const done: string[] = [];
    for (const file of pendingFiles(files, applied.rows)) {
      if (file.indexOnly) {
        try {
          await buildIndexes(client, file);
          await client.query(
            'insert into schema_migrations (number, name, checksum) values ($1, $2, $3)',
            [file.number, file.name, file.checksum],
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new MigrationError(
            `Migration ${file.name} stopped: ${reason}. The indexes built so far stay; the next run finishes the file.`,
            { cause: error },
          );
        }
        options.log?.(`applied ${file.name}`);
        done.push(file.name);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(file.sql);
        await client.query(
          'insert into schema_migrations (number, name, checksum) values ($1, $2, $3)',
          [file.number, file.name, file.checksum],
        );
        await client.query('commit');
      } catch (error) {
        // If the connection is gone the rollback fails too; the first error is the one to report.
        await client.query('rollback').catch(() => undefined);
        const reason = error instanceof Error ? error.message : String(error);
        throw new MigrationError(`Migration ${file.name} failed and was rolled back: ${reason}`, {
          cause: error,
        });
      }
      options.log?.(`applied ${file.name}`);
      done.push(file.name);
    }
    return done;
  } finally {
    await client.end();
  }
}
