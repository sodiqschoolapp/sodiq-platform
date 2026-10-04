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

  it.each([
    'Body',
    'Query',
    'Param',
    'Headers',
    'Req',
    'Request',
    'Res',
    'Response',
    'Next',
    'RawBody',
    'HostParam',
    'Ip',
    'Session',
    'UploadedFile',
    'UploadedFiles',
  ])('refuses %s from @nestjs/common in a controller', async (name) => {
    expect(await refusedImports(fixture(name), moduleFile)).toBe(1);
  });

  it('refuses them under another name and through the whole package', async () => {
    const renamed = "import { Body as Raw } from '@nestjs/common';\nexport const a = Raw;\n";
    const whole = "import * as common from '@nestjs/common';\nexport const a = common.Body;\n";

    const byDefault = "import common from '@nestjs/common';\nexport const a = common;\n";
    const inside =
      "import { Body } from '@nestjs/common/decorators/index.js';\nexport const a = Body;\n";

    expect(await refusedImports(byDefault, moduleFile)).toBe(1);
    expect(await refusedImports(inside, moduleFile)).toBe(1);
    expect(await refusedImports(renamed, moduleFile)).toBe(1);
    expect(await refusedImports(whole, moduleFile)).toBe(1);
  });

  it('refuses them in test-only controllers too', async () => {
    expect(await refusedImports(fixture('Body'), testingFile)).toBe(1);
  });

  it('allows them inside apps/api/src/http', async () => {
    expect(await refusedImports(fixture('Body'), httpFile)).toBe(0);
  });

  // docs/build-plan.md, task 0.7c: "the lint rule that keeps
  // `createParamDecorator` and `REQUEST` inside `apps/api/src/http/` and the
  // guard files". Both hand a route the whole request, unchecked.
  describe('createParamDecorator and REQUEST', () => {
    const sessionGuard = path.join(repositoryRoot, 'apps/api/src/modules/auth/session.guard.ts');
    const permissionGuard = path.join(
      repositoryRoot,
      'apps/api/src/modules/access/permission.guard.ts',
    );
    const testFile = path.join(repositoryRoot, 'apps/api/src/modules/auth/auth.test.ts');
    const ownDecorator =
      "import { createParamDecorator } from '@nestjs/common';\nexport const a = createParamDecorator(() => 1);\n";
    const wholeRequest = "import { REQUEST } from '@nestjs/core';\nexport const a = REQUEST;\n";

    it.each([
      ['createParamDecorator', ownDecorator],
      [
        'createParamDecorator under another name',
        "import { createParamDecorator as make } from '@nestjs/common';\nexport const a = make;\n",
      ],
      ['REQUEST', wholeRequest],
      [
        'REQUEST under another name',
        "import { REQUEST as WHOLE } from '@nestjs/core';\nexport const a = WHOLE;\n",
      ],
      [
        'REQUEST through the whole package',
        "import * as core from '@nestjs/core';\nexport const a = core.REQUEST;\n",
      ],
      [
        'REQUEST through a file inside the package',
        "import { REQUEST } from '@nestjs/core/router/request/request-constants.js';\nexport const a = REQUEST;\n",
      ],
    ])('refuses %s in a module, a test-only controller and a test', async (_name, code) => {
      expect(await refusedImports(code, moduleFile)).toBe(1);
      expect(await refusedImports(code, testingFile)).toBe(1);
      expect(await refusedImports(code, testFile)).toBe(1);
    });

    it('allows both inside apps/api/src/http and in the two guards', async () => {
      for (const file of [httpFile, sessionGuard, permissionGuard]) {
        expect(await refusedImports(ownDecorator, file)).toBe(0);
        expect(await refusedImports(wholeRequest, file)).toBe(0);
      }
    });

    it('still refuses the raw decorators in the two guards', async () => {
      expect(await refusedImports(fixture('Body'), sessionGuard)).toBe(1);
      expect(await refusedImports(fixture('Req'), permissionGuard)).toBe(1);
    });

    it('allows the rest of @nestjs/core', async () => {
      const code =
        "import { APP_GUARD, Reflector } from '@nestjs/core';\nexport const a = [APP_GUARD, Reflector];\n";

      expect(await refusedImports(code, moduleFile)).toBe(0);
    });
  });

  // Advice of the permission reviewer (0.7b), open since 0.4a: code of the
  // application imports no test helper. The build leaves `src/testing` out, and
  // `requiresInTable` names an area of a sample table.
  describe('test helpers', () => {
    const guardFile = path.join(repositoryRoot, 'apps/api/src/modules/access/permission.guard.ts');
    const testFile = path.join(repositoryRoot, 'apps/api/src/modules/access/own-request.test.ts');

    it.each([
      [
        'a file of src/testing',
        "import { FixedClock } from '../../testing/fixed-clock.js';\nexport const a = FixedClock;\n",
      ],
      [
        'a file of src/testing, for its types only',
        "import type { FixedClock } from '../testing/fixed-clock.js';\nexport type A = FixedClock;\n",
      ],
      [
        'requiresInTable',
        "import { requiresInTable } from './access.decorators.js';\nexport const a = requiresInTable;\n",
      ],
      [
        'requiresInTable from another module, under another name',
        "import { requiresInTable as needs } from '../access/access.decorators.js';\nexport const a = needs;\n",
      ],
    ])('refuses %s in code of the application', async (_name, code) => {
      expect(await refusedImports(code, moduleFile)).toBe(1);
      expect(await refusedImports(code, guardFile)).toBe(1);
      expect(await refusedImports(code, httpFile)).toBe(1);
    });

    it('allows them in a test and inside src/testing', async () => {
      const code = [
        "import { FixedClock } from '../../testing/fixed-clock.js';",
        "import { requiresInTable } from '../modules/access/access.decorators.js';",
        'export const a = [FixedClock, requiresInTable];',
        '',
      ].join('\n');

      expect(await refusedImports(code, testFile)).toBe(0);
      expect(await refusedImports(code, testingFile)).toBe(0);
      expect(
        await refusedImports(code, path.join(repositoryRoot, 'apps/api/src/http/http.test.ts')),
      ).toBe(0);
    });

    it('allows the other declarations of access.decorators.ts', async () => {
      const code =
        "import { AnySignedIn, Requires } from '../access/access.decorators.js';\nexport const a = [AnySignedIn, Requires];\n";

      expect(await refusedImports(code, moduleFile)).toBe(0);
    });
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
