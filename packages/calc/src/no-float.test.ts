import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// docs/spec/14-quality-plan.md: "exact fractions …, never floating point"; CLAUDE.md,
// "Exact arithmetic". The property tests show the results are exact; this keeps a
// later edit from bringing a float into the module's own source. A division of two
// JS numbers cannot be told apart from text alone; that is left to the review and
// to the property tests against the BigInt reference.
const directory = new URL('./', import.meta.url);
const sources = readdirSync(directory).filter(
  (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
);

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const FORBIDDEN: readonly [string, RegExp][] = [
  ['Math', /\bMath\./],
  ['parseFloat', /\bparseFloat\b/],
  ['toFixed', /\.toFixed\b/],
  ['toPrecision', /\.toPrecision\b/],
  ['Number()', /\bNumber\(/],
  ['a decimal literal', /\b\d+\.\d/],
  ['a decimal literal with a leading dot', /(^|[^\w.)\]])\.\d/m],
  ['an exponent literal', /\b\d+e[+-]?\d/i],
];

describe('packages/calc source', () => {
  it('has source files to check', () => {
    expect(sources).toEqual(
      expect.arrayContaining([
        'index.ts',
        'fraction.ts',
        'work.ts',
        'attendance.ts',
        'daily.ts',
        'grade.ts',
        'quarter.ts',
        'year.ts',
      ]),
    );
  });

  it.each(sources)('%s uses no floating point', (name) => {
    const code = withoutComments(readFileSync(new URL(name, directory), 'utf8'));
    for (const [label, pattern] of FORBIDDEN) {
      expect(pattern.test(code), `${name} uses ${label}`).toBe(false);
    }
  });
});
