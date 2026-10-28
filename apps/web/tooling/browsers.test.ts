import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Task 10.1 (the owner's answer 7, docs/decisions.md, Decided ahead for Phase
// 10): the current and the previous version of Chrome, Edge, Firefox and
// Safari are supported (docs/handbook/README.md). The versions that were
// current in October 2025, a year before the pilot, are older than the
// previous versions of any later day, so a build target no newer than them
// runs in every supported browser.
const CURRENT_IN_OCTOBER_2025: Record<string, number> = {
  chrome: 141,
  edge: 141,
  firefox: 144,
  safari: 26,
  ios: 26,
};

const config = readFileSync(resolve(import.meta.dirname, '../vite.config.ts'), 'utf8');

describe('the build target of the web app', () => {
  it('names each supported browser no newer than the oldest one supported', () => {
    const list = /build:\s*{\s*target:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? '';
    const targets = [...list.matchAll(/'([a-z]+)([\d.]+)'/g)].map(
      ([, name = '', version = '']) => ({
        name,
        version: Number(version),
      }),
    );
    expect(targets.map((one) => one.name).sort()).toEqual(
      Object.keys(CURRENT_IN_OCTOBER_2025).sort(),
    );
    for (const { name, version } of targets) {
      expect(version, name).toBeLessThanOrEqual(CURRENT_IN_OCTOBER_2025[name] ?? 0);
    }
  });
});
