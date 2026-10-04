import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// CLAUDE.md, Conventions: validate every API input with a schema. The raw input
// decorators of NestJS hand a route unchecked input, so they may be imported
// only inside apps/api/src/http, where the checking helpers are built.
// The first check loads the TypeScript project of the repository, which takes
// most of the usual time limit on a slow machine.
describe('the lint rule against unchecked route input', { timeout: 120_000 }, () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
  const eslint = new ESLint({ cwd: repositoryRoot });
  // Existing files: the rule depends on where a file is.
  const moduleFile = path.join(repositoryRoot, 'apps/api/src/health/health.controller.ts');
  const testingFile = path.join(repositoryRoot, 'apps/api/src/testing/sample.controller.ts');
  const httpFile = path.join(repositoryRoot, 'apps/api/src/http/schemas.ts');

  async function refusedImports(code: string, file: string): Promise<number> {
    const [result] = await eslint.lintText(code, { filePath: file });
    return (result?.messages ?? []).filter((message) => message.ruleId === 'no-restricted-imports')
      .length;
  }

  /** A controller that reads its input with the raw decorator `name`. */
  const fixture = (name: string) =>
    [
      `import { Controller, Post, ${name} } from '@nestjs/common';`,
      '',
      "@Controller('fixture')",
      'export class FixtureController {',
      '  @Post()',
      `  create(@${name}() input: unknown): unknown {`,
      '    return input;',
      '  }',
      '}',
      '',
    ].join('\n');

  it.each(['Body', 'Query', 'Param', 'Headers', 'Req', 'Request'])(
    'refuses %s from @nestjs/common in a controller',
    async (name) => {
      expect(await refusedImports(fixture(name), moduleFile)).toBe(1);
    },
  );

  it('refuses them under another name and through the whole package', async () => {
    const renamed = "import { Body as Raw } from '@nestjs/common';\nexport const a = Raw;\n";
    const whole = "import * as common from '@nestjs/common';\nexport const a = common.Body;\n";

    expect(await refusedImports(renamed, moduleFile)).toBe(1);
    expect(await refusedImports(whole, moduleFile)).toBe(1);
  });

  it('refuses them in test-only controllers too', async () => {
    expect(await refusedImports(fixture('Body'), testingFile)).toBe(1);
  });

  it('allows them inside apps/api/src/http', async () => {
    expect(await refusedImports(fixture('Body'), httpFile)).toBe(0);
  });

  it('allows the rest of @nestjs/common and the request type of Express', async () => {
    const code = [
      "import { Controller, Get } from '@nestjs/common';",
      "import type { Request } from 'express';",
      '',
      "@Controller('fixture')",
      'export class FixtureController {',
      '  @Get()',
      '  read(): Request | null {',
      '    return null;',
      '  }',
      '}',
      '',
    ].join('\n');

    expect(await refusedImports(code, moduleFile)).toBe(0);
  });
});
