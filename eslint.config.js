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

const hardCodedTextMessage =
  'No hard-coded user-facing text. Add an i18n key in Uzbek, Russian and English (apps/web/src/i18n/locales) and use t().';

/** Text a person reads or hears, written into a component instead of coming from an i18n key. */
const hardCodedText = [
  // <p>Text</p>
  'JSXText[value=/\\p{L}/u]',
  // <p>{'Text'}</p> and <p>{`Text`}</p>
  ':matches(JSXElement, JSXFragment) > JSXExpressionContainer > Literal[value=/\\p{L}/u]',
  ':matches(JSXElement, JSXFragment) > JSXExpressionContainer > TemplateLiteral',
  // aria-label="Text", also as {'Text'} and {`Text`}
  'JSXAttribute[name.name=/^(aria-label|aria-description|placeholder|title|alt)$/] > Literal',
  'JSXAttribute[name.name=/^(aria-label|aria-description|placeholder|title|alt)$/] > JSXExpressionContainer > :matches(Literal, TemplateLiteral)',
].map((selector) => ({ selector, message: hardCodedTextMessage }));

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
  'Read route input through ValidBody, ValidQuery, ValidParams or RequestKey (apps/api/src/http/schemas.ts), which check it against a schema. A decorator of your own (createParamDecorator) belongs in apps/api/src/http/ or in one of the two guards.';

const requestAccessMessage =
  'Only apps/api/src/http/ and the two guards (session.guard.ts, permission.guard.ts) reach the request itself. Use their decorators: CurrentSession, CurrentAccess, RequestId, RequestKey and the Valid... helpers.';

const testingMessage =
  'Code of the application does not import test helpers (apps/api/src/testing/, requiresInTable): the build leaves them out, and a sample table is not the permission table. Use Requires.';

/**
 * The `no-restricted-imports` rule of one group of files in apps/api/src. A
 * later block replaces the rule of an earlier one, so each group names all of
 * its parts.
 *
 * - `rawInput`: the raw request decorators of `@nestjs/common`.
 * - `requestAccess`: `createParamDecorator` and `REQUEST`, the two other ways
 *   to hand a route the whole request.
 * - `testing`: test helpers.
 */
function apiImportRule({ rawInput, requestAccess, testing }) {
  const paths = [];
  const patterns = [];
  // One entry per package: an import of the whole package is reported once.
  const fromCommon = [
    ...(rawInput ? rawInputDecorators : []),
    // `assignMetadata` is what `createParamDecorator` is built on.
    ...(requestAccess ? ['createParamDecorator', 'assignMetadata'] : []),
  ];
  if (fromCommon.length > 0) {
    paths.push({
      name: '@nestjs/common',
      importNames: fromCommon,
      message: rawInput ? rawInputMessage : requestAccessMessage,
    });
  }
  if (rawInput) {
    // The same decorators through a file inside the package.
    patterns.push({ group: ['@nestjs/common/*'], message: rawInputMessage });
  }
  if (requestAccess) {
    paths.push({
      name: '@nestjs/core',
      importNames: ['REQUEST', 'default'],
      message: requestAccessMessage,
    });
    patterns.push({ group: ['@nestjs/core/*'], message: requestAccessMessage });
  }
  if (testing) {
    patterns.push(
      { group: ['**/testing', '**/testing/**'], message: testingMessage },
      {
        group: ['**/access.decorators.js'],
        importNames: ['requiresInTable'],
        message: testingMessage,
      },
    );
  }
  return ['error', { paths, patterns }];
}

/** The `no-restricted-syntax` rule of one group of files in apps/api/src. */
function apiSyntaxRule({ clock, branchSetting, request }) {
  return [
    'error',
    ...(clock ? noSystemClock : []),
    ...(branchSetting
      ? ['Literal[value=/app\\.branch_ids/]', 'TemplateElement[value.raw=/app\\.branch_ids/]'].map(
          (selector) => ({
            selector,
            message:
              'Only apps/api/src/database/transactions.ts names the branch filter setting. Use Transactions.run.',
          }),
        )
      : []),
    // The injection token of the request is the plain text 'REQUEST': it needs no import.
    ...(request
      ? ["Literal[value='REQUEST']", "TemplateElement[value.raw='REQUEST']"].map((selector) => ({
          selector,
          message: requestAccessMessage,
        }))
      : []),
  ];
}

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    // The watch build of the jobs worker (apps/api, dev:worker).
    '**/dist-worker/**',
    // The API and the seed command of the browser tests (apps/api, e2e:build).
    '**/dist-e2e/**',
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
    files: ['packages/*/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...noSystemClock],
    },
  },
  {
    // The same in apps/api, with two more rules:
    // - developer rules, Branch filter: set per transaction, never on a pooled
    //   connection. Only transactions.ts names the setting.
    // - task 0.7c: the whole request (`@Inject('REQUEST')`) stays inside
    //   apps/api/src/http and the two guards.
    // A later block replaces the rule of an earlier one, so each group of
    // files names all of its parts (`apiSyntaxRule`).
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': apiSyntaxRule({ clock: true, branchSetting: true, request: true }),
    },
  },
  {
    files: ['apps/api/src/database/transactions.ts'],
    rules: {
      'no-restricted-syntax': apiSyntaxRule({ clock: true, branchSetting: false, request: true }),
    },
  },
  {
    files: ['apps/api/src/clock/system-clock.ts'],
    rules: {
      'no-restricted-syntax': apiSyntaxRule({ clock: false, branchSetting: false, request: true }),
    },
  },
  {
    files: [
      'apps/api/src/http/**',
      'apps/api/src/modules/auth/session.guard.ts',
      'apps/api/src/modules/access/permission.guard.ts',
    ],
    rules: {
      'no-restricted-syntax': apiSyntaxRule({ clock: true, branchSetting: true, request: false }),
    },
  },
  {
    // Tests set the clock and may name the setting; they keep away from the request.
    files: ['apps/api/src/**/*.test.ts', 'apps/api/src/testing/**'],
    rules: {
      'no-restricted-syntax': apiSyntaxRule({ clock: false, branchSetting: false, request: true }),
    },
  },
  {
    files: ['apps/api/src/http/**/*.test.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // CLAUDE.md, Conventions: validate every API input with a schema. A route
    // reads its input only through the helpers of apps/api/src/http (ValidBody,
    // ValidQuery, ValidParams, RequestKey), which check it and describe it in
    // the OpenAPI document. The raw decorators stay inside that folder, and so
    // do `createParamDecorator` and `REQUEST` (task 0.7c), which the two guards
    // may use as well. Code of the application imports no test helper.
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-imports': apiImportRule({
        rawInput: true,
        requestAccess: true,
        testing: true,
      }),
    },
  },
  {
    // Tests and test helpers keep to the same rules about the request; they
    // are the ones that import test helpers.
    files: ['apps/api/src/**/*.test.ts', 'apps/api/src/testing/**'],
    rules: {
      'no-restricted-imports': apiImportRule({
        rawInput: true,
        requestAccess: true,
        testing: false,
      }),
    },
  },
  {
    // The two guards read the request to find the session and the branch, and
    // hand a route what they found (CurrentSession, CurrentAccess).
    files: [
      'apps/api/src/modules/auth/session.guard.ts',
      'apps/api/src/modules/access/permission.guard.ts',
    ],
    rules: {
      'no-restricted-imports': apiImportRule({
        rawInput: true,
        requestAccess: false,
        testing: true,
      }),
    },
  },
  {
    files: ['apps/api/src/http/**'],
    rules: {
      'no-restricted-imports': apiImportRule({
        rawInput: false,
        requestAccess: false,
        testing: true,
      }),
    },
  },
  {
    files: ['apps/api/src/http/**/*.test.ts'],
    rules: { 'no-restricted-imports': 'off' },
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
  {
    // docs/spec/12-ux-standards.md, Language: every label and message exists in
    // Uzbek, Russian and English. A text written into a component would exist
    // in one language only: it comes from an i18n key (apps/web/src/i18n).
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...hardCodedText],
    },
  },
  prettier,
);
