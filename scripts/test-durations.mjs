#!/usr/bin/env node
// Writes apps/api/test-durations.json from the logs of the API parts of a CI run, so
// the parts stay of the same time as files are added (apps/api/src/testing/
// duration-sequencer.ts). Download the log of each "tests (api n/4)" job, of one run or
// of several (a file's time swings from run to run with what runs beside it, so the
// mean of a few runs splits better), then:
//
//   node scripts/test-durations.mjs run1-part1.log … run2-part4.log
//
// A file missing from the logs counts as the median until the next refresh.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const logs = process.argv.slice(2);
if (logs.length === 0) {
  console.error('Give the log files of the API parts of one CI run.');
  process.exit(1);
}
const line = /(?:✓|×|❯) (src\/\S+\.test\.ts) \([^)]*\) (\d+)ms/;
const runs = {};
for (const log of logs) {
  // Colours of the CI log are dropped first.
  const text = readFileSync(log, 'utf8').replace(
    new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'),
    '',
  );
  for (const row of text.split('\n')) {
    const found = line.exec(row);
    if (found) (runs[found[1]] ??= []).push(Number(found[2]) / 1000);
  }
}
// The mean of every run that has the file, in whole seconds, at least 1.
const seconds = Object.entries(runs).map(([file, times]) => [
  file,
  Math.max(1, Math.round(times.reduce((sum, time) => sum + time, 0) / times.length)),
]);
const sorted = Object.fromEntries(seconds.sort(([a], [b]) => (a < b ? -1 : 1)));
const target = resolve(import.meta.dirname, '../apps/api/test-durations.json');
writeFileSync(target, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`${String(Object.keys(sorted).length)} files written to ${target}`);
