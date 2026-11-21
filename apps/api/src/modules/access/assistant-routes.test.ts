import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ASSISTANT_ROLES } from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assistantToolsOf,
  renderAssistantTools,
  type ToolsDocument,
} from '../../openapi/assistant-tools.js';
import { ASSISTANT_ROUTE_COPY } from '../../testing/assistant-route-list.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { routesOf, type Route } from '../../testing/routes.js';
import { toolsOf } from '../assistant/tools.js';
import {
  ASSISTANT_ROUTES,
  NEVER_CHANGED_THROUGH_ASSISTANT,
  NEVER_ROUTES_THROUGH_ASSISTANT,
  assistantRouteFault,
  assistantRoutesOf,
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

  beforeAll(async () => {
    app = await createTestApp();
    routes = routesOf(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('holds each role’s list against its independent copy (`testing/assistant-route-list.ts`)', () => {
    for (const role of ASSISTANT_ROLES) {
      expect(Object.keys(assistantRoutesOf(role)).sort(), role).toEqual(
        Object.keys(ASSISTANT_ROUTE_COPY[role] ?? {}).sort(),
      );
    }
    expect(Object.keys(ASSISTANT_ROUTES).sort()).toEqual(Object.keys(ASSISTANT_ROUTE_COPY).sort());
  });

  it('has a list for the Super Admin alone in this task (the other two roles come with 11.13 and 11.14)', () => {
    expect(Object.keys(ASSISTANT_ROUTES)).toEqual(['super_admin']);
    expect(Object.keys(assistantRoutesOf('super_admin')).length).toBeGreaterThan(50);
  });

  it('puts no route of "Never through the assistant" on any list, walking every route of the application', () => {
    const listed = new Set(ASSISTANT_ROLES.flatMap((role) => Object.keys(assistantRoutesOf(role))));
    const never = routes.filter(isNever).map((route) => route.name);
    expect(never.length).toBeGreaterThan(100);
    expect(never.filter((name) => listed.has(name))).toEqual([]);
    for (const route of routes.filter((one) => listed.has(one.name))) {
      expect(
        assistantRouteFault({ name: route.name, method: route.method, declarations: route.access }),
        route.name,
      ).toBeUndefined();
    }
  });

  it('lists only reads in this task, and every listed route exists', () => {
    const names = new Set(routes.map((route) => route.name));
    for (const role of ASSISTANT_ROLES) {
      for (const name of Object.keys(assistantRoutesOf(role))) {
        expect(names.has(name), name).toBe(true);
        expect(name.startsWith('GET '), name).toBe(true);
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
    const tools = toolsOf('super_admin', ['home', 'people']);
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
