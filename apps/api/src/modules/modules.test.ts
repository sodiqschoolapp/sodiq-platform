import { readdirSync } from 'node:fs';
import type { INestApplication, Type } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../testing/create-test-app.js';

// CLAUDE.md, Repository layout: API code is grouped by module in
// apps/api/src/modules/<module>/, with these names.
const MODULE_NAMES = [
  'access',
  'audit',
  'auth',
  'classes',
  'feedback',
  'journal',
  'notifications',
  'people',
  'plans',
  'results',
  'setup',
  'timetable',
];

function moduleClassName(folder: string): string {
  return `${folder.charAt(0).toUpperCase()}${folder.slice(1)}Module`;
}

describe('apps/api/src/modules', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('holds exactly the module folders named in CLAUDE.md', () => {
    const folders = readdirSync(new URL('.', import.meta.url), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(folders).toEqual(MODULE_NAMES);
  });

  it.each(MODULE_NAMES)('registers the %s module in AppModule', async (folder) => {
    const file = new URL(`./${folder}/${folder}.module.ts`, import.meta.url).href;
    const exported = (await import(file)) as Record<string, unknown>;
    const moduleClass = exported[moduleClassName(folder)];

    expect(moduleClass).toBeTypeOf('function');
    // `select` throws when the module is not part of the application.
    expect(() => app.select(moduleClass as Type<unknown>)).not.toThrow();
  });
});
