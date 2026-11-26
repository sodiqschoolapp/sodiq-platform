import { Kysely, PostgresDialect, type LogEvent } from 'kysely';
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

/**
 * A `numeric` (task 11.25a: the exact scores and totals of `work_amount`, 0188) becomes a JS
 * number, which holds every value of at most two decimals up to 1000 exactly as its shortest
 * text. A text that does not read back the same (more digits than a number keeps) is refused,
 * never rounded: no digit is lost silently (CLAUDE.md, Exact arithmetic).
 */
const NUMERIC_OID: number = types.builtins.NUMERIC;
const NUMERIC_ARRAY_OID = 1231;
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

/** `7.50` becomes 7.5, `8` becomes 8; `12345678901234567.1` throws. */
export function exactNumeric(value: string): number {
  if (!NUMERIC_TEXT.test(value)) {
    throw new Error(`A numeric value "${value}" is not a plain decimal.`);
  }
  const read = Number(value);
  const canonical = value.includes('.') ? value.replace(/\.?0+$/, '') : value;
  if (read === 0) {
    return 0;
  }
  if (String(read) !== canonical.replace(/^(-?)0+(?=\d)/, '$1')) {
    throw new Error(`A numeric value "${value}" cannot be held exactly as a number.`);
  }
  return read;
}

function numericArrayRefused(): never {
  throw new Error('A numeric array is not supported.');
}

function parserFor(oid: number, format?: 'text' | 'binary'): unknown {
  if (oid === NUMERIC_OID) {
    return exactNumeric;
  }
  if (oid === NUMERIC_ARRAY_OID) {
    return numericArrayRefused;
  }
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

export interface DatabaseOptions {
  /** The most connections the pool opens. A test of the pool itself uses 1. */
  max?: number;
  /** Task 10.1b: told of every query and its time (the speed run's breakdown); none by default. */
  log?: (event: LogEvent) => void;
}

/** The pool connects on the first query, not here. */
export function createDatabase(connectionString: string, options: DatabaseOptions = {}): Database {
  const { log, ...pool } = options;
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, types: schoolDatesAsText, ...pool }),
    }),
    ...(log === undefined ? {} : { log }),
  });
}
