import { Fraction } from '@sodiq/calc';

/**
 * The value of a prepared total as JSON and back (task 9.3b-1, plan decision 4): what
 * `packages/calc` and the readers gave, exactly. A fraction keeps its numerator and denominator
 * as decimal texts read straight back into `BigInt` (review correction 4: never through
 * `Number`), a whole number of `bigint` likewise; moments, maps and sets keep their kind. Any
 * other object that is not plain fails here instead of coming back as something else.
 */

type Tagged =
  | { readonly $f: readonly [string, string] }
  | { readonly $b: string }
  | { readonly $d: string }
  | { readonly $m: readonly (readonly [unknown, unknown])[] }
  | { readonly $s: readonly unknown[] }
  | { readonly $u: 1 }
  | { readonly $o: Readonly<Record<string, unknown>> };

export function encode(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('A prepared value holds a number that is not finite.');
    return value;
  }
  if (value === undefined) return { $u: 1 } satisfies Tagged;
  if (typeof value === 'bigint') return { $b: value.toString() } satisfies Tagged;
  if (value instanceof Fraction) {
    return { $f: [value.num.toString(), value.den.toString()] } satisfies Tagged;
  }
  if (value instanceof Date) return { $d: value.toISOString() } satisfies Tagged;
  if (value instanceof Map) {
    return { $m: [...value].map(([key, one]) => [encode(key), encode(one)] as const) };
  }
  if (value instanceof Set) return { $s: [...value].map(encode) } satisfies Tagged;
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const fields: Record<string, unknown> = {};
    for (const [key, one] of Object.entries(value)) fields[key] = encode(one);
    // A plain object is wrapped, so that a field named like a tag is never read as one.
    return { $o: fields } satisfies Tagged;
  }
  throw new Error('A prepared value holds an object of a kind the codec does not keep.');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A whole number from its decimal text, never through a floating-point number. */
function whole(text: unknown): bigint {
  if (typeof text !== 'string' || !/^-?\d+$/.test(text)) {
    throw new Error('A prepared whole number is not a decimal text.');
  }
  return BigInt(text);
}

export function decode(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decode);
  if (!isRecord(value)) return value;
  const [tag, ...rest] = Object.keys(value);
  if (tag === undefined || rest.length > 0)
    throw new Error('A prepared value has an unknown shape.');
  const body = value[tag];
  switch (tag) {
    case '$f': {
      if (!Array.isArray(body) || body.length !== 2)
        throw new Error('A prepared fraction is malformed.');
      return Fraction.of(whole(body[0]), whole(body[1]));
    }
    case '$b':
      return whole(body);
    case '$d':
      if (typeof body !== 'string') throw new Error('A prepared moment is malformed.');
      return new Date(body);
    case '$m':
      if (!Array.isArray(body)) throw new Error('A prepared map is malformed.');
      return new Map(
        body.map((entry: unknown) => {
          if (!Array.isArray(entry) || entry.length !== 2) {
            throw new Error('A prepared map entry is malformed.');
          }
          return [decode(entry[0]), decode(entry[1])] as const;
        }),
      );
    case '$s':
      if (!Array.isArray(body)) throw new Error('A prepared set is malformed.');
      return new Set(body.map(decode));
    case '$u':
      return undefined;
    case '$o': {
      if (!isRecord(body)) throw new Error('A prepared object is malformed.');
      const fields: Record<string, unknown> = {};
      for (const [key, one] of Object.entries(body)) fields[key] = decode(one);
      return fields;
    }
    default:
      throw new Error('A prepared value has an unknown tag.');
  }
}
