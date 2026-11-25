import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  ASSISTANT_ROLES,
  HEAVY_AREAS,
  HEAVY_ROUTES,
  assistantDefaultOn,
  type AssistantRole,
} from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assistantToolsOf,
  renderAssistantTools,
  type ToolsDocument,
} from '../../openapi/assistant-tools.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { ROUTE_ACCESS } from '../../testing/route-access-list.js';
import { routesOf, type Route } from '../../testing/routes.js';
import { OPEN_FILTER, STRICT_FILTER, isSecretKey } from '../assistant/field-filter.js';
import { generatedOf, requiredFieldsWithheld, toolsOf } from '../assistant/tools.js';
import { WARNING_FLAGS } from './assistant-change-routes.js';
import { AssistantRoutes } from './assistant-routes.check.js';
import {
  ROUTE_LINES,
  assistantRouteFault,
  kindOfLine,
  notThroughAssistant,
  type AssistantRouteLine,
} from './assistant-routes.js';

// Task 11.20 (`02`, build order: "The same permission check for the person and the chosen role,
// limited to the actions of that role the Super Admin switched on for the assistant. A test holds
// that every action of each role is on its list"; What it can do: "Every action the person's
// chosen role has on the screens"). Build plan 11.20, Done when: "a test that every `@Requires`
// route of each role is on its list and no route outside the role's rights is". The lists of
// 11.12 to 11.14, and their "never" lists, gave way to the derivation (plan decision 1, Look
// first: the requirement changed).

const API_ROOT = path.resolve(import.meta.dirname, '../../..');
const REPO_ROOT = path.resolve(API_ROOT, '../..');

/**
 * Routes whose path or area names a role, an appointment, an account, a secret or one of the
 * heavy actions of `02`, Switches (plan review 5): each such change is off at the start, or named
 * here with the reason it is not one of `02`'s list ("Everything is on at the start except
 * these").
 */
const HEAVY_WORDS =
  /roles|tutors|acting-teachers|head-teacher|account|password|session|slips|second-step|publish|withdraw|\/start|close|closing|recalculation|forced|integration-keys|reopen/;

const NOT_HEAVY: Readonly<Record<string, string>> = {
  'POST /api/people/staff/:id/status':
    "a status change (leave, dismissal, re-hire): not on 02's list; a re-hire's slip goes through the floor (plan review correction 2)",
  'POST /api/classes/:id/members/:memberId/withdraw':
    'takes back a class membership, not an appointment',
  'POST /api/groups/:id/members/:memberId/withdraw':
    'takes back a group membership, not an appointment',
  'POST /api/journal/orphans/assignments/:assignmentId/withdraw':
    'takes back a journal of a lesson without a teacher, not an appointment',
  'POST /api/journal/unlocks/:unlockId/withdraw': 'takes back an own unlock request',
  'POST /api/timetable/absences/:id/withdraw': 'takes back an absence of a teacher',
  'POST /api/timetable/lessons/:id/substitution/withdraw':
    'takes back a substitution of one lesson',
  'POST /api/timetable/room-closures/:id/withdraw': 'takes back a room closure',
  'POST /api/people/vacancies/:id/close': 'closes a vacancy, not a quarter or a year',
  'POST /api/people/vacancies/:id/reopen': 'opens a closed vacancy again, not a quarter',
  'POST /api/people/parents/:relativeId/telegram-unlink':
    'an area of parent accounts, off at the start with it',
  'POST /api/timetable/versions/:id/load/imports/:importId/preview':
    'not a heavy word: "imports" holds "port"',
};

describe('the actions open to the assistant', () => {
  let app: NestExpressApplication;
  let routes: Route[];
  let assistantRoutes: AssistantRoutes;
  let linesOf: (role: AssistantRole) => Readonly<Record<string, AssistantRouteLine>>;

  beforeAll(async () => {
    app = await createTestApp();
    routes = routesOf(app);
    assistantRoutes = app.get(AssistantRoutes);
    linesOf = (role) => assistantRoutes.linesOf(role);
  });

  afterAll(async () => {
    await app.close();
  });

  // Plan review 2: the expected lists come from the hand-written `ROUTE_ACCESS` of the
  // permission harness, a source independent of the table's `permits`.
  it('lists for each role every route the hand-written route list gives the role, and no other', () => {
    for (const role of ASSISTANT_ROLES) {
      const expected = Object.entries(ROUTE_ACCESS)
        .filter(
          ([name, access]) =>
            typeof access === 'object' && access.roles.includes(role) && !notThroughAssistant(name),
        )
        .map(([name]) => name)
        .sort();
      expect(Object.keys(linesOf(role)).sort(), role).toEqual(expected);
    }
    expect(Object.keys(linesOf('super_admin')).length).toBeGreaterThan(450);
    expect(Object.keys(linesOf('teacher')).length).toBeGreaterThan(80);
  });

  it('has a line for every route a role holds, and only for routes that exist', () => {
    expect(assistantRoutes.routesWithoutLine()).toEqual([]);
    const names = new Set(routes.map((route) => route.name));
    expect(Object.keys(ROUTE_LINES).filter((name) => !names.has(name))).toEqual([]);
  });

  it('puts the assistant’s own routes on no list (plan decision 5)', () => {
    const own = routes
      .filter((route) => notThroughAssistant(route.name))
      .map((route) => route.name);
    expect(own).toEqual(
      expect.arrayContaining([
        'POST /api/assistant/questions',
        'PUT /api/assistant/actions',
        'PUT /api/setup/school-settings/assistant',
        'POST /api/assistant/all-conversations/:id/restore',
      ]),
    );
    for (const role of ASSISTANT_ROLES) {
      expect(
        own.filter((name) => Object.hasOwn(linesOf(role), name)),
        role,
      ).toEqual([]);
    }
  });

  it('writes each line as the kind its route is, with a description, and its basis and preview on the same list', () => {
    for (const route of routes) {
      const line = ROUTE_LINES[route.name];
      if (line === undefined) continue;
      expect(line.description.trim().length, route.name).toBeGreaterThan(10);
      expect(
        assistantRouteFault({
          name: route.name,
          method: route.method,
          declarations: route.access,
          takesFile: route.takesFile !== undefined,
          returnsFile: assistantRoutes.factsOf(route.name)?.kind === 'download',
          line,
        }),
        route.name,
      ).toBeUndefined();
    }
    for (const role of ASSISTANT_ROLES) {
      for (const [name, line] of Object.entries(linesOf(role))) {
        if (line.kind !== 'change') continue;
        if (line.basis.kind === 'read') {
          expect(kindOfLine(linesOf(role)[line.basis.route] ?? line), `${name} (${role})`).toBe(
            'read',
          );
        }
        if (line.preview !== undefined) {
          expect(linesOf(role)[line.preview.route]?.kind, `${name} (${role})`).toBe('preview');
        }
      }
    }
  });

  it('names an action and an area in the three languages for every route of a list', () => {
    const files = ['en', 'ru', 'uz'].map((language) =>
      readFileSync(path.join(REPO_ROOT, `apps/web/src/i18n/locales/${language}.ts`), 'utf8'),
    );
    const missing: string[] = [];
    for (const role of ASSISTANT_ROLES) {
      for (const name of Object.keys(linesOf(role))) {
        const operation = generatedOf(name).name;
        const key = /_(zero|one|two|few|many|other)$/.test(operation)
          ? `${operation}_op`
          : operation;
        const area = assistantRoutes.factsOf(name)?.area ?? '';
        files.forEach((file, index) => {
          if (!new RegExp(`\\n      ${key}:`).test(file)) missing.push(`${String(index)} ${key}`);
          if (!new RegExp(`\\n      ${area}:`).test(file))
            missing.push(`${String(index)} area ${area}`);
        });
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  // `02`, Switches: "Everything is on at the start except these, which start off" (plan
  // decision 3, review correction 2 and review 5).
  it('starts off every heavy action of 02, and walks every change whose words name one', () => {
    const names = new Set(routes.map((route) => route.name));
    for (const name of HEAVY_ROUTES) expect(names.has(name), name).toBe(true);
    const areas = new Set(
      routes.flatMap((route) =>
        route.access.flatMap((one) => (one.kind === 'requires' ? [one.area] : [])),
      ),
    );
    for (const area of HEAVY_AREAS) expect(areas.has(area), area).toBe(true);
    const missed: string[] = [];
    for (const name of Object.keys(linesOf('super_admin'))) {
      const facts = assistantRoutes.factsOf(name);
      if (facts === undefined || facts.kind === 'read') continue;
      const off = !assistantDefaultOn(facts.area, name, facts.kind);
      if (HEAVY_WORDS.test(name) && !off && NOT_HEAVY[name] === undefined) missed.push(name);
    }
    expect(missed).toEqual([]);
    for (const name of Object.keys(NOT_HEAVY)) expect(names.has(name), name).toBe(true);
    // The named ones of `02`.
    for (const name of [
      'POST /api/timetable/versions/:id/publish',
      'POST /api/timetable/versions/:id/withdraw',
      'POST /api/results/closing/:quarterId/close',
      'POST /api/setup/academic-years/:id/start',
      'POST /api/results/closing/:quarterId/recalculation/apply',
      'POST /api/timetable/lessons/:id/forced-delete',
      'POST /api/forced-deletes/:id/restore',
      'POST /api/people/staff/:id/account/password-reset',
      'POST /api/people/staff/:id/account/second-step-reset',
      'POST /api/people/classes/:classId/parent-slips',
      'POST /api/people/staff/:id/roles',
      'POST /api/classes/:id/tutors',
      'POST /api/timetable/acting-teachers',
      'POST /api/integration-keys',
      'POST /api/people/staff/imports/:id/confirm',
    ]) {
      const facts = assistantRoutes.factsOf(name);
      expect(facts, name).toBeDefined();
      expect(assistantDefaultOn(facts?.area ?? '', name, facts?.kind ?? 'change'), name).toBe(
        false,
      );
    }
    // And an ordinary change and a read of a heavy area are on.
    expect(
      assistantDefaultOn('journal', 'POST /api/journal/lessons/:lessonId/attendance', 'change'),
    ).toBe(true);
    expect(assistantDefaultOn('accounts', 'GET /api/people/staff/:id/account', 'read')).toBe(true);
  });

  // The extra-lesson case of `edge/people-roles-accounts` (`06`: "The school never holds an extra
  // lesson"): no route makes a dated lesson outside a published version. A draft's pattern
  // (`POST /api/timetable/versions/:id/pattern`) is the timetable's building, now on the list.
  it('lists no route that adds a dated lesson', () => {
    for (const role of ASSISTANT_ROLES) {
      for (const name of Object.keys(linesOf(role))) {
        expect(/^POST \/api\/timetable\/lessons$/.test(name), name).toBe(false);
      }
    }
  });

  // 11.13, review correction 2, and 11.20's floor: the tools hold no secret field and no warning
  // flag but those a check shows again; with a group switched off, none of its fields.
  it('gives the model no secret field, no field of a group switched off and no warning flag it was not shown', () => {
    const walk = (
      schema: unknown,
      where: string,
      found: string[],
      removes: (key: string) => boolean,
    ): void => {
      if (schema === null || typeof schema !== 'object') return;
      const record = schema as {
        properties?: Record<string, unknown>;
        items?: unknown;
        anyOf?: unknown[];
      };
      for (const [key, value] of Object.entries(record.properties ?? {})) {
        if (removes(key)) found.push(`${where}.${key}`);
        walk(value, `${where}.${key}`, found, removes);
      }
      walk(record.items, `${where}[]`, found, removes);
      for (const option of record.anyOf ?? []) walk(option, where, found, removes);
    };
    for (const role of ASSISTANT_ROLES) {
      const lines = linesOf(role);
      for (const filter of [OPEN_FILTER, STRICT_FILTER]) {
        const tools = toolsOf(lines, filter);
        const found: string[] = [];
        for (const tool of tools)
          walk(tool.parameters, tool.name, found, (key) => filter.removesKey(key));
        expect(found, role).toEqual([]);
        for (const tool of tools.filter((one) => one.name.startsWith('propose_'))) {
          const flags: string[] = [];
          walk(tool.parameters.properties.body, tool.name, flags, (key) =>
            WARNING_FLAGS.includes(key),
          );
          const kept =
            flags.length === 0 ||
            [...Object.entries(lines)].some(
              ([name, line]) =>
                line.kind === 'change' &&
                tool.name === `propose_${generatedOf(name).name}`.slice(0, 64) &&
                (line.keepsFlags ?? []).length > 0,
            );
          expect(kept, `${tool.name}: ${flags.join(', ')}`).toBe(true);
        }
      }
      // With every group on, every change has its tool: nothing it needs is withheld.
      for (const [name, line] of Object.entries(lines)) {
        if (line.kind !== 'change') continue;
        expect(requiredFieldsWithheld(name, OPEN_FILTER), name).toEqual([]);
        expect(isSecretKey('password')).toBe(true);
      }
    }
  });

  it('refuses, at the start, a line of another kind than its route, a line of the assistant’s own route and a route without a permission', () => {
    const requires = (area: string, action: 'view' | 'edit' | 'export') => [
      { kind: 'requires', area, action },
    ];
    const change: AssistantRouteLine = {
      kind: 'change',
      group: 'setup',
      description: 'x',
      basis: { kind: 'create' },
    };
    expect(
      assistantRouteFault({
        name: 'GET /api/x/export',
        method: 'GET',
        declarations: requires('staff', 'export'),
        line: { group: 'staff', description: 'x' },
      }),
    ).toMatch(/export/);
    expect(
      assistantRouteFault({
        name: 'POST /api/setup/rooms',
        method: 'POST',
        declarations: requires('rooms', 'edit'),
        line: { group: 'setup', description: 'x' },
      }),
    ).toMatch(/read.*change/);
    expect(
      assistantRouteFault({
        name: 'POST /api/setup/rooms',
        method: 'POST',
        declarations: requires('rooms', 'edit'),
        line: change,
      }),
    ).toBeUndefined();
    expect(
      assistantRouteFault({
        name: 'GET /api/setup/rooms',
        method: 'GET',
        declarations: requires('rooms', 'view'),
        line: change,
      }),
    ).toMatch(/change.*read/);
    expect(
      assistantRouteFault({
        name: 'POST /api/setup/rooms',
        method: 'POST',
        declarations: requires('rooms', 'edit'),
        line: { kind: 'preview', group: 'setup', description: 'x' },
      }),
    ).toMatch(/preview/);
    expect(
      assistantRouteFault({
        name: 'PUT /api/x/photo',
        method: 'PUT',
        declarations: requires('staff', 'edit'),
        takesFile: true,
        line: change,
      }),
    ).toMatch(/file/);
    expect(
      assistantRouteFault({
        name: 'GET /api/x/file',
        method: 'GET',
        declarations: requires('staff', 'view'),
        returnsFile: true,
        line: { group: 'staff', description: 'x' },
      }),
    ).toMatch(/download/);
    expect(
      assistantRouteFault({
        name: 'PUT /api/assistant/actions',
        method: 'PUT',
        declarations: requires('school_settings', 'edit'),
        line: change,
      }),
    ).toMatch(/own/);
    expect(
      assistantRouteFault({
        name: 'GET /api/auth/sessions',
        method: 'GET',
        declarations: [{ kind: 'any_signed_in' }],
        line: { group: 'setup', description: 'x' },
      }),
    ).toMatch(/permission/);
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
    // Every tool of the Super Admin builds, names are unique, and the map's three tools and
    // find_actions are last (task 11.19: `link_place` in place of `suggest_page`; 11.20).
    const tools = toolsOf(linesOf('super_admin'), OPEN_FILTER);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    expect(tools.slice(-4).map((tool) => tool.name)).toEqual([
      'find_in_platform',
      'explain_place',
      'link_place',
      'find_actions',
    ]);
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
