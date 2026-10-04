// @vitest-environment node
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// docs/spec/12-ux-standards.md, Language: every label and message exists in
// Uzbek, Russian and English. CLAUDE.md: no hard-coded strings in components.
// The first check loads the TypeScript project of the repository, which takes
// most of the usual time limit on a slow machine.
describe('the lint rule against hard-coded text in components', { timeout: 120_000 }, () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
  const eslint = new ESLint({ cwd: repositoryRoot });
  // An existing file: the rule depends on where a file is.
  const component = path.join(repositoryRoot, 'apps/web/src/app/pages.tsx');

  async function refused(jsx: string): Promise<number> {
    const code = `export function Fixture({ text }: { text: string }) {\n  return ${jsx};\n}\n`;
    const [result] = await eslint.lintText(code, { filePath: component });
    return (result?.messages ?? []).filter((message) => message.ruleId === 'no-restricted-syntax')
      .length;
  }

  it.each([
    ['text between tags', '<p>Sign in</p>'],
    ['text in another script', '<p>Войти</p>'],
    ['text in a fragment', '<>Sign in</>'],
    ['a text literal in braces', "<p>{'Sign in'}</p>"],
    ['a template in braces', '<p>{`Sign in ${text}`}</p>'],
    ['an aria-label', '<button aria-label="Close" />'],
    ['an aria-label in braces', "<button aria-label={'Close'} />"],
    ['a placeholder', '<input placeholder="Login" />'],
    ['a title', '<abbr title="Quarter">{text}</abbr>'],
    ['an alt text', '<img alt="Photo" />'],
  ])('refuses %s', async (_name, jsx) => {
    expect(await refused(jsx)).toBe(1);
  });

  it.each([
    ['a text from a key', '<p>{text}</p>'],
    ['an aria-label from a key', '<button aria-label={text} />'],
    ['class names and other attributes', '<p className="text-sm" data-slot="note">{text}</p>'],
    ['signs without a letter', '<p>{text}: 7 / 10</p>'],
  ])('accepts %s', async (_name, jsx) => {
    expect(await refused(jsx)).toBe(0);
  });
});
