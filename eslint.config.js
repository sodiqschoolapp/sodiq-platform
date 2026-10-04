import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const noSystemClock = [
  // Also without a call, so the function cannot be kept under another name.
  "MemberExpression[object.name='Date'][property.name='now']",
  "MemberExpression[object.name='globalThis'][property.name='Date']",
  "NewExpression[callee.name='Date'][arguments.length=0]",
  "CallExpression[callee.name='Date']",
].map((selector) => ({
  selector,
  message:
    'Do not read the system clock. Use the injected clock (CLOCK in apps/api, a Clock or a moment passed in elsewhere).',
}));

/** Decorators of NestJS that hand a route unchecked input, or the whole request. */
const rawInputDecorators = [
  'Body',
  'Query',
  'Param',
  'Headers',
  'Req',
  // The other name of `Req`.
  'Request',
  // The response leads back to the request.
  'Res',
  'Response',
  'Next',
  'RawBody',
  'HostParam',
  'Ip',
  'Session',
  'UploadedFile',
  'UploadedFiles',
  // The whole package under one name.
  'default',
];

const rawInputMessage =
  'Read route input through ValidBody, ValidQuery, ValidParams or RequestKey (apps/api/src/http/schemas.ts), which check it against a schema.';

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    // The watch build of the jobs worker (apps/api, dev:worker).
    '**/dist-worker/**',
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
      'no-restricted-syntax': ['error', ...noSystemClock],
    },
  },
  {
    // docs/spec/edge-cases/developer-rules.md, Branch filter: set per transaction,
    // never on a pooled connection. Only transactions.ts names the setting. This
    // block repeats the clock selectors because a later block replaces the rule.
    files: ['apps/api/src/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      'apps/api/src/testing/**',
      'apps/api/src/clock/system-clock.ts',
      'apps/api/src/database/transactions.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...noSystemClock,
        ...[
          'Literal[value=/app\\.branch_ids/]',
          'TemplateElement[value.raw=/app\\.branch_ids/]',
        ].map((selector) => ({
          selector,
          message:
            'Only apps/api/src/database/transactions.ts names the branch filter setting. Use Transactions.run.',
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
            { name: '@nestjs/common', importNames: rawInputDecorators, message: rawInputMessage },
          ],
          // The same decorators through a file inside the package.
          patterns: [{ group: ['@nestjs/common/*'], message: rawInputMessage }],
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
