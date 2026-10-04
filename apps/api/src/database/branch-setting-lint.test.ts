import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// docs/spec/edge-cases/developer-rules.md, "Branch filter": set per transaction,
// never on a pooled connection. Only transactions.ts names the setting, so no
// other code can set it for a whole connection or widen it.
// The first check loads the TypeScript project of the repository, which takes
// most of the usual time limit on a slow machine.
describe(
  'the lint rule that keeps the branch filter setting in one file',
  { timeout: 120_000 },
  () => {
    const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
    const eslint = new ESLint({ cwd: repositoryRoot });
    const businessFile = path.join(repositoryRoot, 'apps/api/src/app.setup.ts');
    const ownFile = path.join(repositoryRoot, 'apps/api/src/database/transactions.ts');

    async function refused(code: string, file = businessFile): Promise<string[]> {
      const [result] = await eslint.lintText(code, { filePath: file });
      return (result?.messages ?? [])
        .filter((message) => message.ruleId === 'no-restricted-syntax')
        .map((message) => message.message);
    }

    it.each([
      ['in a query', "export const a = `select set_config('app.branch_ids', 'x', false)`;\n"],
      ['in a text', "export const a = 'app.branch_ids';\n"],
      ['in a set statement', 'export const a = "set app.branch_ids = 1";\n'],
    ])('refuses the name of the setting %s', async (_name, code) => {
      const messages = await refused(code);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('Transactions.run');
    });

    it('allows it in transactions.ts', async () => {
      expect(await refused("export const a = 'app.branch_ids';\n", ownFile)).toEqual([]);
    });

    it('still refuses the system clock in the same files', async () => {
      expect(await refused('export const a = Date.now();\n')).toHaveLength(1);
      expect(await refused('export const a = Date.now();\n', ownFile)).toHaveLength(1);
    });
  },
);
