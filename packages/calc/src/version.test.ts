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
  // 2: task 3.6c-1, the year result from the published quarters, no extra lessons.
  '2bc9a1015c1f1bd837e905a04029dc40a5ecd58eb7f5c68d35b3219ac7d9d83e',
  // 3: task 6.2, the class or group average of the journal's bottom row (`groupAverage`); no
  // existing formula changes.
  'c68ce35f92e0abdfc99e441e58e971cc14c8b5607ac2ed513ac0f2d479f73160',
  // 4: task 9.2b, the readers of a stored final record (`storedQuarterOutcome`,
  // `storedQuarterInputs`); no existing formula changes.
  '5b067ddb39578b079fe3babe9fe21dfa871d5e1c94f77ef62d0391bf7bdeddf1',
  // 5: task 9.3a, the rating (`ratingPlaces`, `oneDecimal`, `subjectsFigure`, `classFigure`); no
  // existing formula changes.
  '8644c9d7282f0d84025109034a123f151de3595435dbf2c2b9e284efbe394edf',
  // 6: task 9.4a, the early-warning list (`currentWorkFigure`, `ownGradedWorks`,
  // `currentAbsenceRun`, `earlyWarningReasons`); no existing formula changes.
  '079763a8afc3703b84e6dd5997bd6d95e1f0a5f15adc9bbe9e6f336d48d5167b',
  // 7: task 9.4b, the attendance figures of the home pages (`dailyAttendance`, `absentNow`); no
  // existing formula changes.
  '8f0880fb32ce7f6e0fe805cf7f5e7f0fd0caaf3f0518a6f0b4c43336c26fb23f',
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
