import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { FixedClock } from '../testing/fixed-clock.js';
import { SystemClock } from './system-clock.js';

// docs/spec/edge-cases/developer-rules.md, Time-based state: business code never
// reads the clock directly; it is passed in, so tests can set it.
describe('FixedClock', () => {
  it('shows the moment it was given until it is moved', () => {
    const clock = new FixedClock('2026-10-05T23:59:00+05:00');

    expect(clock.now().toISOString()).toBe('2026-10-05T18:59:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-10-05T18:59:00.000Z');

    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe('2026-10-05T19:00:00.000Z');

    clock.set('2027-01-01T00:00:00+05:00');
    expect(clock.now().toISOString()).toBe('2026-12-31T19:00:00.000Z');
  });

  it('cannot be changed through a moment it handed out', () => {
    const clock = new FixedClock('2026-10-05T23:59:00+05:00');

    clock.now().setFullYear(2000);

    expect(clock.now().toISOString()).toBe('2026-10-05T18:59:00.000Z');
  });

  it('refuses a moment that is not one', () => {
    expect(() => new FixedClock('2026-13-45T00:00:00+05:00')).toThrow('valid moment');
  });

  // A moment without an offset is read in the time zone of the machine: a test
  // would pass in Tashkent and fail in CI.
  it.each(['2026-10-05T23:59:00', '2026-10-05', 'yesterday'])(
    'refuses %s, which has no offset',
    (moment) => {
      expect(() => new FixedClock(moment)).toThrow('offset');
      expect(() => {
        new FixedClock('2026-10-05T23:59:00Z').set(moment);
      }).toThrow('offset');
    },
  );

  it('accepts UTC and a Date', () => {
    expect(new FixedClock('2026-10-05T18:59:00Z').now().toISOString()).toBe(
      '2026-10-05T18:59:00.000Z',
    );
    expect(new FixedClock(new Date(0)).now().getTime()).toBe(0);
  });
});

describe('SystemClock', () => {
  it('shows the time of the server', () => {
    const before = Date.now();
    const shown = new SystemClock().now().getTime();

    expect(shown).toBeGreaterThanOrEqual(before);
    expect(shown).toBeLessThanOrEqual(Date.now());
  });
});

// The first check loads the TypeScript project of the repository, which takes
// most of the usual time limit on a slow machine.
describe('the lint rule against reading the system clock', { timeout: 120_000 }, () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
  const eslint = new ESLint({ cwd: repositoryRoot });
  // Any existing file of business code: the rule depends on where a file is.
  const businessFile = path.join(repositoryRoot, 'apps/api/src/app.setup.ts');

  async function clockReadsIn(code: string, file = businessFile): Promise<number> {
    const [result] = await eslint.lintText(code, { filePath: file });
    return (result?.messages ?? []).filter((message) => message.ruleId === 'no-restricted-syntax')
      .length;
  }

  it.each([
    ['Date.now()', 'export const a = Date.now();\n'],
    ['new Date()', 'export const a = new Date();\n'],
    ['Date()', 'export const a = Date();\n'],
    ['Date.now under another name', 'const f = Date.now;\nexport const a = f();\n'],
    ['globalThis.Date.now()', 'export const a = globalThis.Date.now();\n'],
    ['new globalThis.Date()', 'export const a = new globalThis.Date();\n'],
  ])('refuses %s in business code', async (_name, code) => {
    expect(await clockReadsIn(code)).toBe(1);
  });

  it.each([
    ['a moment built from a value', 'export const a = new Date("2026-10-05T00:00:00Z");\n'],
    ['a moment built from a clock', 'export const a = (now: Date) => new Date(now.getTime());\n'],
  ])('allows %s', async (_name, code) => {
    expect(await clockReadsIn(code)).toBe(0);
  });

  it('allows the system clock itself to read the time', async () => {
    const file = path.join(repositoryRoot, 'apps/api/src/clock/system-clock.ts');

    expect(await clockReadsIn('export const a = new Date();\n', file)).toBe(0);
  });

  it('covers the shared packages', async () => {
    const file = path.join(repositoryRoot, 'packages/calc/src/index.ts');

    expect(await clockReadsIn('export const a = Date.now();\n', file)).toBe(1);
  });
});
