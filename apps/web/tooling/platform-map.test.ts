// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { platformMapSchema } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/locales/en';
import { ru } from '../src/i18n/locales/ru';
import { uz } from '../src/i18n/locales/uz';
import { buildMap } from './platform-map/build';
import { allDescriptions, COMMON_ACTIONS } from './platform-map/descriptions';
import { CALLS, SHOWN_WITH } from './platform-map/controls';
import { SHARED_PARTS } from './platform-map/source';
import { walkApp } from './platform-map/walk';

// Task 11.19 (build plan, Done when: "a walk test fails when a page, tab, button, field or
// column of the app is missing from the map or has no description"). The map is built from a
// walk of the code as it is now and compared with the committed map; `pnpm assistant:map`
// (this file with `--mode assistant-map`) writes it.

const WEB = path.resolve(import.meta.dirname, '..');
const MAP_FILE = path.resolve(WEB, '../api/src/modules/assistant/platform-map.generated.ts');
const WRITE = process.env.MODE === 'assistant-map';

function build() {
  const walk = walkApp({
    src: path.join(WEB, 'src'),
    router: 'app/router.tsx',
    layoutRoute: 'appRoute',
    sharedParts: SHARED_PARTS,
    tsconfig: path.join(WEB, 'tsconfig.app.json'),
  });
  const { descriptions, twice } = allDescriptions();
  const openapi = JSON.parse(
    readFileSync(path.resolve(WEB, '../api/openapi.generated.json'), 'utf8'),
  ) as { paths: Record<string, Record<string, { operationId?: string }>> };
  const built = buildMap({
    walk,
    locales: { uz, ru, en },
    openapi,
    descriptions,
    commonActions: COMMON_ACTIONS,
    shownWith: SHOWN_WITH,
    calls: CALLS,
  });
  return { ...built, twice };
}

describe('the map of the platform', () => {
  const { map, problems, twice } = build();
  const text = [
    '// Written by `pnpm assistant:map` from the code of the web app (apps/web/tooling/platform-map/).',
    '// Do not edit: `apps/web/tooling/platform-map.test.ts` fails when this is not what it writes.',
    `export const PLATFORM_MAP_SOURCE: unknown = ${JSON.stringify(map, null, 1)};`,
    '',
  ].join('\n');

  it('has no problem: every page and control read, labelled in three languages and described', () => {
    expect(problems.map((one) => `${one.file}:${String(one.line)} ${one.problem}`)).toEqual([]);
    expect(twice).toEqual([]);
  });

  it('is the committed map (pnpm assistant:map writes it)', () => {
    if (WRITE) {
      writeFileSync(MAP_FILE, text);
      return;
    }
    expect(readFileSync(MAP_FILE, 'utf8')).toBe(text);
  });

  it('passes the schema the API reads it with', () => {
    expect(platformMapSchema.safeParse(map).success).toBe(true);
  });
});
