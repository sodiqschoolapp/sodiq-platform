/**
 * Lines of the Influx line protocol (task 10.2a, plan decision 8), the format
 * Grafana Cloud's push endpoint takes and stores as Prometheus series named
 * `<measurement>_<field>`, with the tags as labels. Every value is a whole
 * number (`i`): the numbers of a minute, counts and moments in seconds.
 */

export interface Point {
  measurement: string;
  tags: Readonly<Record<string, string>>;
  fields: Readonly<Record<string, number>>;
  /** Milliseconds since 1970, from the injected clock. */
  at: number;
}

const NAME = /^[a-z][a-z0-9_]*$/;

/**
 * A tag key or value: commas, equals signs and spaces escaped. A backslash or a control
 * character becomes `_`: the protocol has no sure way to write a trailing backslash, and a
 * line break would end the line. Our values are route patterns, ids and names of our own.
 */
export function escapeTag(text: string): string {
  return text
    .replace(/[\\\p{Cc}]/gu, '_')
    .replace(/[,= ]/g, (character) => `\\${character}`);
}

/** One line; the tags in the order of their keys, so equal points give equal lines. */
export function lineOf(point: Point): string {
  if (!NAME.test(point.measurement)) {
    throw new Error(`Not a measurement name: ${point.measurement}`);
  }
  const fields = Object.entries(point.fields);
  if (fields.length === 0) {
    throw new Error('A point needs a field.');
  }
  const tags = Object.entries(point.tags)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `,${escapeTag(key)}=${escapeTag(value)}`)
    .join('');
  const values = fields
    .map(([key, value]) => {
      if (!NAME.test(key) || !Number.isSafeInteger(value)) {
        throw new Error(`Not a whole-number field: ${key}`);
      }
      return `${key}=${String(value)}i`;
    })
    .join(',');
  return `${point.measurement}${tags} ${values} ${String(point.at)}000000`;
}
