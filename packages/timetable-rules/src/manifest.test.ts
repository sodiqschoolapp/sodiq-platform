import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest: unknown = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

/** Runtime dependencies that are not packages of this workspace. */
function npmDependencies(field: string): string[] {
  if (typeof manifest !== 'object' || manifest === null) return [];
  const entries: unknown = (manifest as Record<string, unknown>)[field];
  if (typeof entries !== 'object' || entries === null) return [];
  return Object.entries(entries)
    .filter(([, range]) => typeof range !== 'string' || !range.startsWith('workspace:'))
    .map(([name]) => name);
}

// CLAUDE.md, Repository layout: "timetable rule engine, pure TypeScript". The engine also
// runs in the browser, so it may use workspace packages but nothing from npm.
describe('packages/timetable-rules manifest', () => {
  it.each(['dependencies', 'peerDependencies', 'optionalDependencies'])(
    'has no npm package in %s',
    (field) => {
      expect(npmDependencies(field)).toEqual([]);
    },
  );
});
