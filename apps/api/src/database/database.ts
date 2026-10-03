import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import type { DB } from './types.generated.js';

export type Database = Kysely<DB>;

/**
 * A school date (`date` column) stays the text `YYYY-MM-DD`. The driver's own
 * parser turns it into a JavaScript `Date` at local midnight, which becomes
 * another day as soon as it is read in another time zone. Moments
 * (`timestamptz`) are real instants and stay `Date`.
 */
const DATE_OID: number = types.builtins.DATE;
const keepText = (value: string): string => value;

function parserFor(oid: number, format?: 'text' | 'binary'): unknown {
  if (oid === DATE_OID) {
    return keepText;
  }
  return format === 'binary'
    ? (types.getTypeParser(oid, 'binary') as unknown)
    : (types.getTypeParser(oid, 'text') as unknown);
}

const schoolDatesAsText = { getTypeParser: parserFor as typeof types.getTypeParser };

/** The pool connects on the first query, not here. */
export function createDatabase(connectionString: string): Database {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, types: schoolDatesAsText }),
    }),
  });
}
