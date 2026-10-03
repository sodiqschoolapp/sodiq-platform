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
const DATE_ARRAY_OID = 1182;
const keepText = (value: string): string => value;

/** `{2026-10-05,NULL}` becomes `['2026-10-05', null]`. Dates are never quoted. */
function dateArrayAsText(value: string): (string | null)[] {
  const inner = value.slice(1, -1);
  if (inner.includes('{')) {
    throw new Error('A date array with more than one dimension is not supported.');
  }
  return inner === '' ? [] : inner.split(',').map((item) => (item === 'NULL' ? null : item));
}

function parserFor(oid: number, format?: 'text' | 'binary'): unknown {
  if (oid === DATE_OID) {
    return keepText;
  }
  if (oid === DATE_ARRAY_OID) {
    return dateArrayAsText;
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
