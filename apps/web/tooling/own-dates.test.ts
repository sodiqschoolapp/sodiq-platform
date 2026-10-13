// @vitest-environment node
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Task 2.7a (issue #39, hand test of 13 October 2026, finding 3): every date
// and time of the web app comes from apps/web/src/lib/dates.ts, because the
// browser's own Uzbek data may be trimmed. The first check loads the
// TypeScript project of the repository, which takes most of the usual time
// limit on a slow machine.
describe('the lint rule that keeps dates in lib/dates.ts', { timeout: 120_000 }, () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
  const eslint = new ESLint({ cwd: repositoryRoot });
  // Existing files: the rule depends on where a file is.
  const component = path.join(repositoryRoot, 'apps/web/src/app/pages.tsx');
  const module = path.join(repositoryRoot, 'apps/web/src/features/setup/setup-api.ts');
  const dates = path.join(repositoryRoot, 'apps/web/src/lib/dates.ts');

  async function refused(code: string, filePath: string): Promise<number> {
    const [result] = await eslint.lintText(`${code}\n`, { filePath });
    return (result?.messages ?? []).filter((message) => message.ruleId === 'no-restricted-syntax')
      .length;
  }

  it.each([
    ['Intl.DateTimeFormat', "export const a = new Intl.DateTimeFormat('uz').format(new Date());"],
    ['Intl.DateTimeFormat called', "export const a = Intl.DateTimeFormat('uz');"],
    ['toLocaleDateString', "export const a = new Date().toLocaleDateString('uz');"],
    ['toLocaleString', "export const a = new Date().toLocaleString('uz');"],
    ['toLocaleTimeString', "export const a = new Date().toLocaleTimeString('uz');"],
  ])('refuses %s in a component and in a module', async (_name, code) => {
    expect(await refused(code, component)).toBe(1);
    expect(await refused(code, module)).toBe(1);
  });

  it('accepts it in lib/dates.ts', async () => {
    expect(
      await refused("export const a = new Intl.DateTimeFormat('uz').format(new Date());", dates),
    ).toBe(0);
  });

  it('leaves numbers and capitals alone', async () => {
    expect(await refused("export const a = new Intl.NumberFormat('uz').format(1);", module)).toBe(
      0,
    );
    expect(await refused("export const a = 'a'.toLocaleUpperCase('uz');", module)).toBe(0);
  });

  it('keeps the rule against hard-coded text in the same components', async () => {
    const code =
      'export function Fixture() {\n  return <p>Sign in {new Date().toLocaleDateString()}</p>;\n}';
    expect(await refused(code, component)).toBe(2);
  });
});
