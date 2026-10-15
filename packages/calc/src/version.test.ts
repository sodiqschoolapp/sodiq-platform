import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CALC_VERSION } from './version.js';

// edge/calculation, "A bug is found after results were closed and exported": "The calculation
// module has a version, stored with every final result … A release never changes closed results
// silently". `.claude/rules/calc.md`: "A change to a formula changes the module's version number".
//
// One hash per version, append only: entry i is the source of version i + 1. A change of the
// module's source outside tests (a refactor included, task 4.3, decision 11) changes the hash,
// so this test fails until a new entry is appended and `CALC_VERSION` raised with it. The test
// cannot stop someone from rewriting the last entry instead: it makes the change visible in the
// diff, and the review checks that the version was raised.
const SOURCE_HASHES: readonly string[] = [
  'aef6025c99d7b06899808e7d4e56849bfe4ab99e1ceef710e07871ed503b3303',
];

const directory = new URL('./', import.meta.url);

function withoutCommentsAndSpace(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, '');
}

function sourceHash(): string {
  const hash = createHash('sha256');
  const names = readdirSync(directory)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
  for (const name of names) {
    hash.update(
      `${name}\n${withoutCommentsAndSpace(readFileSync(new URL(name, directory), 'utf8'))}\n`,
    );
  }
  return hash.digest('hex');
}

describe('CALC_VERSION', () => {
  it('is the number of source hashes', () => {
    expect(CALC_VERSION).toBe(SOURCE_HASHES.length);
  });

  it('matches the source: a change of the module raises the version', () => {
    expect(sourceHash(), 'append the new hash and raise CALC_VERSION').toBe(SOURCE_HASHES.at(-1));
  });

  it('has a different hash for every version', () => {
    expect(new Set(SOURCE_HASHES).size).toBe(SOURCE_HASHES.length);
  });
});
