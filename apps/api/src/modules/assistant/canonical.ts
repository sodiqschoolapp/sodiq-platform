import { createHash } from 'node:crypto';

/**
 * The canonical form of a read or a preview (task 11.13, plan review must fix 3): object keys in
 * order, every list sorted by the canonical text of its rows (a row order that a query does not
 * fix never makes a step outdated), and the keys that change with the clock left out at any
 * depth.
 */
export function canonicalOf(value: unknown, clockKeys: readonly string[] = []): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => canonicalOf(item, clockKeys))
      .map((item) => ({ item, text: JSON.stringify(item) }))
      .sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0))
      .map(({ item }) => item);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (clockKeys.includes(key)) {
        continue;
      }
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) {
        out[key] = canonicalOf(item, clockKeys);
      }
    }
    return out;
  }
  return value;
}

/** The SHA-256 of the canonical form, in hex: what a step was proposed on, never given to the model. */
export function fingerprintOf(value: unknown, clockKeys: readonly string[] = []): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalOf(value, clockKeys)))
    .digest('hex');
}

/** The first object at any depth whose `key` is `value`, or `undefined`. */
export function findRecord(
  value: unknown,
  key: string,
  wanted: string,
): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecord(item, key, wanted);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record[key] === wanted) {
      return record;
    }
    for (const item of Object.values(record)) {
      const found = findRecord(item, key, wanted);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every id (a uuid) that appears at any depth, in lower case. */
export function idsIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (UUID.test(value)) into.add(value.toLowerCase());
  } else if (Array.isArray(value)) {
    for (const item of value) idsIn(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) idsIn(item, into);
  }
  return into;
}
