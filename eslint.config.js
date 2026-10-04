import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/.turbo/**',
    '**/playwright-report/**',
    '**/test-results/**',
    // Written by `pnpm db:codegen`.
    '**/*.generated.ts',
  ]),
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md, Conventions: no `any`, no `@ts-ignore`, no non-null assertions
      // without a comment that explains why it is safe.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    // docs/spec/edge-cases/developer-rules.md, Time-based state: business code
    // never reads the clock directly; it is passed in, so tests can set it.
    files: ['apps/api/src/**/*.ts', 'packages/*/src/**/*.ts'],
    ignores: ['**/*.test.ts', 'apps/api/src/testing/**', 'apps/api/src/clock/system-clock.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          // Also without a call, so the function cannot be kept under another name.
          "MemberExpression[object.name='Date'][property.name='now']",
          "MemberExpression[object.name='globalThis'][property.name='Date']",
          "NewExpression[callee.name='Date'][arguments.length=0]",
          "CallExpression[callee.name='Date']",
        ].map((selector) => ({
          selector,
          message:
            'Do not read the system clock. Use the injected clock (CLOCK in apps/api, a Clock or a moment passed in elsewhere).',
        })),
      ],
    },
  },
  {
    // CLAUDE.md, Conventions: validate every API input with a schema. A route
    // reads its input only through the helpers of apps/api/src/http (ValidBody,
    // ValidQuery, ValidParams, RequestKey), which check it and describe it in
    // the OpenAPI document. The raw decorators stay inside that folder.
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/http/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/common',
              // `Request` is the other name of `Req`.
              importNames: ['Body', 'Query', 'Param', 'Headers', 'Req', 'Request'],
              message:
                'Read route input through ValidBody, ValidQuery, ValidParams or RequestKey (apps/api/src/http/schemas.ts), which check it against a schema.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  prettier,
);
