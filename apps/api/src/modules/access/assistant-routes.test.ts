import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ASSISTANT_ROLES, PERMISSIONS, permits } from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assistantToolsOf,
  renderAssistantTools,
  type ToolsDocument,
} from '../../openapi/assistant-tools.js';
import {
  ASSISTANT_ROUTE_COPY,
  WRITTEN_ASSISTANT_LISTS,
} from '../../testing/assistant-route-list.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { routesOf, type Route } from '../../testing/routes.js';
import { isRemovedKey } from '../assistant/field-filter.js';
import { requiredFieldsWithheld, toolsOf } from '../assistant/tools.js';
import { WARNING_FLAGS } from './assistant-change-routes.js';
import { AssistantRoutes } from './assistant-routes.check.js';
import {
  ASSISTANT_ROUTES,
  NEVER_CHANGED_THROUGH_ASSISTANT,
  NEVER_ROUTES_THROUGH_ASSISTANT,
  assistantRouteFault,
  assistantRoutesOf,
  type AssistantRouteLine,
} from './assistant-routes.js';

// Task 11.12 (pull request #374). Build plan 11.12, Done when: "a test holds the Super Admin's
// list, and one that no route of 'Never through the assistant' is on it". `02`, Assistant: "Never
// through the assistant. Entering or changing journal data …, journal corrections, exemptions,
// closing a quarter; publishing or withdrawing a timetable version; starting or closing a year;
// force delete; accounts (passwords, second step, sessions, printed slips), roles, appointments
// and permissions; integration keys; exports."

const API_ROOT = path.resolve(import.meta.dirname, '../../..');

/** Whether a route is one the spec's Never list names. */
function isNever(route: Route): boolean {
  const [access] = route.access;
  if (route.access.length !== 1 || access?.kind !== 'requires') {
    // An own-account, a public, a portal or a key route: never on a list.
    return true;
  }
  return (
    access.action === 'export' ||
    NEVER_ROUTES_THROUGH_ASSISTANT.includes(route.name) ||
    (route.method !== 'GET' && NEVER_CHANGED_THROUGH_ASSISTANT.includes(access.area))
  );
}

describe('the actions open to the assistant', () => {
  let app: NestExpressApplication;
  let routes: Route[];
  let linesOf: (
    role: (typeof ASSISTANT_ROLES)[number],
  ) => Readonly<Record<string, AssistantRouteLine>>;

  beforeAll(async () => {
    app = await createTestApp();
    routes = routesOf(app);
    const assistantRoutes = app.get(AssistantRoutes);
    linesOf = (role) => assistantRoutes.linesOf(role);
  });

  afterAll(async () => {
    await app.close();
  });

  it('holds each role’s list against its independent copy (`testing/assistant-route-list.ts`)', () => {
    for (const role of ASSISTANT_ROLES) {
      expect(Object.keys(linesOf(role)).sort(), role).toEqual(
        Object.keys(ASSISTANT_ROUTE_COPY[role] ?? {}).sort(),
      );
    }
    expect(Object.keys(ASSISTANT_ROUTES).sort()).toEqual([...WRITTEN_ASSISTANT_LISTS].sort());
  });

  // Task 11.13, plan decision 4 (Look first) and decision 18: the Academic Vice Principal's list
  // is the Super Admin's narrowed by the permission table, nothing written for the role by hand.
  it('gives the Academic Vice Principal exactly the Super Admin’s lines the table gives the role', () => {
    const byName = new Map(routes.map((route) => [route.name, route]));
    const expected = Object.keys(assistantRoutesOf('super_admin')).filter((name) => {
      const [access] = byName.get(name)?.access ?? [];
      return (
        access?.kind === 'requires' &&
        permits(PERMISSIONS, 'academic_vice_principal', access.area, access.action)
      );
    });
    expect(Object.keys(linesOf('academic_vice_principal')).sort()).toEqual(expected.sort());
    expect(expected.length).toBeGreaterThan(100);
    // `02`: "rooms and buildings (Super Admin)".
    for (const name of [
      'POST /api/setup/rooms',
      'PUT /api/setup/rooms/:id',
      'POST /api/setup/buildings',
      'POST /api/setup/buildings/:id/floors',
    ]) {
      expect(linesOf('academic_vice_principal')[name], name).toBeUndefined();
      expect(linesOf('super_admin')[name]?.kind, name).toBe('change');
    }
  });

  it('puts no route of "Never through the assistant" on any list, walking every route of the application', () => {
    const listed = new Set(ASSISTANT_ROLES.flatMap((role) => Object.keys(linesOf(role))));
    const never = routes.filter(isNever).map((route) => route.name);
    expect(never.length).toBeGreaterThan(100);
    expect(never.filter((name) => listed.has(name))).toEqual([]);
    for (const role of ASSISTANT_ROLES) {
      for (const route of routes.filter((one) => Object.hasOwn(linesOf(role), one.name))) {
        expect(
          assistantRouteFault({
            name: route.name,
            method: route.method,
            declarations: route.access,
            line: linesOf(role)[route.name],
          }),
          route.name,
        ).toBeUndefined();
      }
    }
  });

  // Build plan 11.14, Done when: "a test that no journal entry route is on any list". `02`,
  // Never through the assistant: "Entering or changing journal data (attendance, numbers, totals,
  // comments, \"not held\"), journal corrections, exemptions". Every route of the application
  // that changes journal data (the areas of the journal's entry, the lesson card's topic and works
  // included) is walked, and none is on a list, written or derived.
  it('puts no journal entry route on any role’s list (build plan 11.14)', () => {
    const entryAreas = ['journal', 'journal_support', 'exemptions', 'absence_reasons'];
    const entry = routes.filter((route) => {
      const [access] = route.access;
      return (
        route.method !== 'GET' &&
        access?.kind === 'requires' &&
        entryAreas.includes(access.area) &&
        access.action !== 'export'
      );
    });
    // The attendance, the scores, the works and their totals, "not held", comments, the rating
    // exam's entries, the card's topic and delivery, corrections, exemptions, absence reasons.
    expect(entry.length).toBeGreaterThan(20);
    for (const name of [
      'POST /api/journal/lessons/:lessonId/all-present',
      'POST /api/journal/lessons/:lessonId/attendance',
      'POST /api/journal/lessons/:lessonId/scores',
      'PUT /api/journal/comments',
      'PUT /api/journal/lessons/:lessonId/topic',
      'PUT /api/journal/lessons/:lessonId/works/not-held',
    ]) {
      expect(
        entry.some((route) => route.name === name),
        name,
      ).toBe(true);
    }
    for (const role of ASSISTANT_ROLES) {
      const lines = linesOf(role);
      expect(
        entry.filter((route) => Object.hasOwn(lines, route.name)).map((route) => route.name),
        role,
      ).toEqual([]);
    }
  });

  // Task 11.14, plan decisions 2 to 7: the Teacher's list is written, reads of a `view` the
  // table gives the Teacher and the drafting of plan items, unlocks and plan requests.
  it('gives the Teacher reads of own work and the six proposals of build plan 11.14, each permitted by the table', () => {
    const byName = new Map(routes.map((route) => [route.name, route]));
    const lines = linesOf('teacher');
    for (const name of Object.keys(lines)) {
      const [access] = byName.get(name)?.access ?? [];
      expect(access?.kind, name).toBe('requires');
      if (access?.kind === 'requires') {
        expect(permits(PERMISSIONS, 'teacher', access.area, access.action), name).toBe(true);
      }
    }
    expect(
      Object.entries(lines)
        .filter(([, line]) => line.kind === 'change')
        .map(([name]) => name)
        .sort(),
    ).toEqual(
      [
        'POST /api/plans/journals/:journalId/items',
        'PUT /api/plans/items/:itemId',
        'POST /api/journal/lessons/:lessonId/unlocks',
        'POST /api/journal/journals/:journalId/rating/:quarterId/unlocks',
        'POST /api/plans/journals/:journalId/requests',
        'POST /api/plans/requests/:requestId/send',
      ].sort(),
    );
    // Reading only own work: nothing of the setup, the staff, classes and groups or other branches.
    for (const name of [
      'GET /api/timetable/views/branch',
      'GET /api/classes',
      'GET /api/people/staff',
      'GET /api/people/students/:id',
      'GET /api/exemptions',
      'GET /api/plans/masters',
    ]) {
      expect(lines[name], name).toBeUndefined();
    }
  });

  it('lists reads as GETs and changes and previews as other methods, every listed route existing', () => {
    const names = new Set(routes.map((route) => route.name));
    for (const role of ASSISTANT_ROLES) {
      for (const [name, line] of Object.entries(linesOf(role))) {
        expect(names.has(name), name).toBe(true);
        expect(name.startsWith('GET '), name).toBe((line.kind ?? 'read') === 'read');
        if (line.kind === 'change') {
          if (line.basis.kind === 'read') {
            expect(linesOf(role)[line.basis.route]?.kind ?? 'read', name).toBe('read');
            expect(Object.hasOwn(linesOf(role), line.basis.route), name).toBe(true);
          }
          if (line.preview !== undefined) {
            expect(linesOf(role)[line.preview.route]?.kind, name).toBe('preview');
          }
        }
      }
    }
  });

  // `06`, Changes after publishing: "The school never holds an extra lesson" (the extra-lesson
  // case of `edge/people-roles-accounts`): no listed route creates a lesson.
  it('lists no route that adds a lesson', () => {
    for (const role of ASSISTANT_ROLES) {
      for (const name of Object.keys(linesOf(role))) {
        expect(
          /^POST \/api\/timetable\/lessons$|^POST \/api\/timetable\/versions\/:id\/(pattern|lessons)$/.test(
            name,
          ),
          name,
        ).toBe(false);
      }
    }
  });

  // Plan review must fix 4 and review correction 2: the tools of the changes hold no field that
  // never goes to the model, and no warning flag but those a check shows again.
  it('gives the model no field that never goes to it and no warning flag it was not shown', () => {
    const walk = (schema: unknown, where: string, found: string[]): void => {
      if (schema === null || typeof schema !== 'object') return;
      const record = schema as {
        properties?: Record<string, unknown>;
        items?: unknown;
        anyOf?: unknown[];
      };
      for (const [key, value] of Object.entries(record.properties ?? {})) {
        if (isRemovedKey(key)) found.push(`${where}.${key}`);
        walk(value, `${where}.${key}`, found);
      }
      walk(record.items, `${where}[]`, found);
      for (const option of record.anyOf ?? []) walk(option, where, found);
    };
    for (const role of ASSISTANT_ROLES) {
      const lines = linesOf(role);
      const tools = toolsOf(lines, []);
      const never: string[] = [];
      for (const tool of tools) {
        walk(tool.parameters, tool.name, never);
      }
      expect(never, role).toEqual([]);
      for (const [name, line] of Object.entries(lines)) {
        if (line.kind !== 'change') continue;
        expect(requiredFieldsWithheld(name), name).toEqual([]);
      }
      // Every key at any depth of a body, so that a nested flag is found too (review should fix 13).
      const keysOf = (schema: unknown): string[] => {
        if (schema === null || typeof schema !== 'object') return [];
        const record = schema as {
          properties?: Record<string, unknown>;
          items?: unknown;
          anyOf?: unknown[];
        };
        return [
          ...Object.entries(record.properties ?? {}).flatMap(([key, value]) => [
            key,
            ...keysOf(value),
          ]),
          ...keysOf(record.items),
          ...(record.anyOf ?? []).flatMap(keysOf),
        ];
      };
      for (const tool of tools.filter((one) => one.name.startsWith('propose_'))) {
        const flags = keysOf(tool.parameters.properties.body).filter((key) =>
          WARNING_FLAGS.includes(key),
        );
        const kept = flags.length === 0 || tool.name.includes('ExamsController');
        expect(kept, `${tool.name}: ${flags.join(', ')}`).toBe(true);
      }
      const relative = tools.find(
        (one) => one.name.startsWith('propose_') && one.name.includes('Relatives'),
      );
      if (role === 'super_admin' || role === 'academic_vice_principal') {
        expect(Object.keys(relative?.parameters.properties.body?.properties ?? {}), role).toEqual([
          'portalAccess',
        ]);
      }
    }
  });

  it('names in its Never list only routes that exist', () => {
    const names = new Set(routes.map((route) => route.name));
    for (const name of NEVER_ROUTES_THROUGH_ASSISTANT) {
      expect(names.has(name), name).toBe(true);
    }
    const areas = new Set(
      routes.flatMap((route) =>
        route.access.flatMap((one) => (one.kind === 'requires' ? [one.area] : [])),
      ),
    );
    for (const area of NEVER_CHANGED_THROUGH_ASSISTANT) {
      expect(areas.has(area), area).toBe(true);
    }
  });

  it('refuses, at the start, a listed export, a listed never-route, a listed change and a route without a permission', () => {
    const requires = (area: string, action: 'view' | 'edit' | 'export') => [
      { kind: 'requires', area, action },
    ];
    expect(
      assistantRouteFault({
        name: 'GET /api/x/export',
        method: 'GET',
        declarations: requires('staff', 'export'),
      }),
    ).toMatch(/export/);
    expect(
      assistantRouteFault({
        name: 'POST /api/timetable/versions/:id/publish',
        method: 'POST',
        declarations: requires('timetable', 'edit'),
      }),
    ).toMatch(/never/);
    expect(
      assistantRouteFault({
        name: 'POST /api/journal/x',
        method: 'POST',
        declarations: requires('journal', 'edit'),
      }),
    ).toMatch(/never/);
    expect(
      assistantRouteFault({
        name: 'POST /api/setup/rooms',
        method: 'POST',
        declarations: requires('rooms', 'edit'),
      }),
    ).toMatch(/read/);
    expect(
      assistantRouteFault({
        name: 'POST /api/setup/rooms',
        method: 'POST',
        declarations: requires('rooms', 'edit'),
        line: { kind: 'change', group: 'setup', description: '', basis: { kind: 'create' } },
      }),
    ).toBeUndefined();
    expect(
      assistantRouteFault({
        name: 'GET /api/setup/rooms',
        method: 'GET',
        declarations: requires('rooms', 'view'),
        line: { kind: 'change', group: 'setup', description: '', basis: { kind: 'create' } },
      }),
    ).toMatch(/GET/);
    expect(
      assistantRouteFault({
        name: 'POST /api/setup/rooms',
        method: 'POST',
        declarations: requires('rooms', 'edit'),
        line: { kind: 'preview', group: 'setup', description: '' },
      }),
    ).toMatch(/preview/);
    expect(
      assistantRouteFault({
        name: 'GET /api/auth/sessions',
        method: 'GET',
        declarations: [{ kind: 'any_signed_in' }],
      }),
    ).toMatch(/permission/);
    expect(
      assistantRouteFault({
        name: 'GET /api/classes',
        method: 'GET',
        declarations: requires('classes', 'view'),
      }),
    ).toBeUndefined();
  });

  it('has the tools file `pnpm api:client` writes, with each tool’s parameters exactly its route’s path and query parameters', () => {
    const document = JSON.parse(
      readFileSync(path.join(API_ROOT, 'openapi.generated.json'), 'utf8'),
    ) as ToolsDocument;
    const file = readFileSync(
      path.join(API_ROOT, 'src/modules/assistant/tools.generated.ts'),
      'utf8',
    );
    expect(file, 'run "pnpm api:client"').toBe(renderAssistantTools(document));
    const generated = assistantToolsOf(document);
    for (const [name, tool] of Object.entries(generated)) {
      const route = routes.find((one) => one.name === name);
      const pathParameters = [...(route?.path ?? '').matchAll(/:([A-Za-z0-9_]+)/g)].map(
        (match) => match[1],
      );
      expect(
        tool.parameters.filter((one) => one.in === 'path').map((one) => one.name),
        name,
      ).toEqual(pathParameters);
      expect(tool.name).toMatch(/^[A-Za-z0-9_]{1,64}$/);
    }
    // Every tool of the Super Admin builds, names are unique, and suggest_page is last.
    const tools = toolsOf(assistantRoutesOf('super_admin'), ['home', 'people']);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    expect(tools.at(-1)?.name).toBe('suggest_page');
  });

  it('calls the model through one file: only `gemini-model.ts` imports `@google/genai`', () => {
    const importers: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const full = path.join(directory, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (
          /\.tsx?$/.test(entry) &&
          /['"]@google\/genai['"]/.test(readFileSync(full, 'utf8'))
        ) {
          importers.push(path.relative(API_ROOT, full));
        }
      }
    };
    walk(path.join(API_ROOT, 'src'));
    expect(importers.filter((file) => !file.endsWith('.test.ts'))).toEqual([
      path.join('src', 'modules', 'assistant', 'gemini-model.ts'),
    ]);
  });
});
