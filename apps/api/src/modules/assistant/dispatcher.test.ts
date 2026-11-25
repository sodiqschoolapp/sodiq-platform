import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { HttpAdapterHost } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AssistantCalls } from '../access/assistant-calls.js';
import type { AssistantRoutes } from '../access/assistant-routes.check.js';
import type { AssistantSwitches } from './assistant-switches.service.js';
import { AssistantDispatcher, READ_MAX_BYTES } from './dispatcher.js';
import { urlOf, type GeneratedTool } from './tools.js';
import { GENERATED_TOOLS } from './tools.generated.js';

// Task 11.12 (plan review, must fix 1 and should fix 6): a read is built only from the tool's own
// parameters, each passing its schema, so no `..` or `/` reaches the path; it is sent to the
// server's own address with a timeout and a cap on what is read.

const PASS = { cookieHeader: '__Host-sodiq_session=token' };

/** Task 11.20: the routes of the test, with the switch of each (`off`) and a school-wide one. */
const LISTED = [
  'GET /api/ok',
  'GET /api/slow',
  'GET /api/large',
  'GET /api/off',
  'GET /api/school',
];
const off = new Set(['GET /api/off']);
const routes = {
  factsOf: (name: string) =>
    LISTED.includes(name)
      ? { area: 'classes', action: 'view', kind: 'read', branchNone: name === 'GET /api/school' }
      : undefined,
  linesOf: () =>
    Object.fromEntries(LISTED.map((name) => [name, { group: 'classes', description: 'x' }])),
} as unknown as AssistantRoutes;
const switches = {
  rows: () => Promise.resolve({ areas: new Map(), actions: new Map() }),
  isOn: (_rows: unknown, _role: unknown, name: string) => !off.has(name),
} as unknown as AssistantSwitches;

describe('the dispatcher of the assistant’s reads', () => {
  let server: Server;
  const seen: IncomingMessage[] = [];
  let dispatcher: AssistantDispatcher;

  beforeAll(async () => {
    server = createServer((incoming, response) => {
      seen.push(incoming);
      if (incoming.url === '/api/slow') {
        setTimeout(() => response.end('{}'), 15_000);
        return;
      }
      if (incoming.url === '/api/large') {
        response.end(`"${'x'.repeat(READ_MAX_BYTES + 10)}"`);
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const host = { httpAdapter: { getHttpServer: () => server } } as unknown as HttpAdapterHost;
    dispatcher = new AssistantDispatcher(host, new AssistantCalls(), routes, switches);
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends the read to the server’s own address with the session, the branch and the mark of the role', async () => {
    const outcome = await dispatcher.read(
      '/api/ok',
      { pass: PASS, branchId: '0199a000-0000-7000-8000-000000000001', role: 'super_admin' },
      'GET /api/ok',
    );
    expect(outcome).toEqual({ status: 200, body: { ok: true } });
    const last = seen.at(-1);
    expect(last?.headers.cookie).toBe(PASS.cookieHeader);
    expect(last?.headers['x-branch-id']).toBe('0199a000-0000-7000-8000-000000000001');
    expect(last?.headers['x-assistant-role']).toBe('super_admin');
    expect(String(last?.headers['x-assistant-call']).length).toBeGreaterThan(30);
    expect((server.address() as AddressInfo).port).toBeGreaterThan(0);
  });

  it('stops a read past its time and one past its size, and reads nothing outside the API', async () => {
    const as = { pass: PASS, branchId: 'b', role: 'super_admin' as const };
    expect(await dispatcher.read('/api/slow', as, 'GET /api/slow')).toEqual({
      status: 0,
      failure: 'timeout',
    });
    expect(await dispatcher.read('/api/large', as, 'GET /api/large')).toEqual({
      status: 0,
      failure: 'too_large',
    });
    await expect(dispatcher.read('http://example.com/api/x', as, 'GET /api/ok')).rejects.toThrow();
    // A URL that is not the route's own path is never sent (review 5: the switch is the one sent).
    await expect(dispatcher.read('/api/large', as, 'GET /api/ok')).rejects.toThrow();
    // A route named by another method than the one sent is never sent.
    await expect(dispatcher.send('POST', '/api/ok', {}, as, 'GET /api/ok')).rejects.toThrow();
  }, 30_000);

  // Task 11.20 (plan review 6): the one place the switches are checked, for every request.
  it('sends nothing for an action switched off or not on the role’s list, and no branch for a school-wide route', async () => {
    const as = {
      pass: PASS,
      branchId: '0199a000-0000-7000-8000-000000000001',
      role: 'teacher' as const,
    };
    const before = seen.length;
    const refused = await dispatcher.read('/api/off', as, 'GET /api/off');
    expect(refused).toMatchObject({
      status: 403,
      body: { error: { code: 'assistant_action_off' } },
    });
    const closed = await dispatcher.read('/api/other', as, 'GET /api/other');
    expect(closed).toMatchObject({
      status: 403,
      body: { error: { code: 'assistant_route_closed' } },
    });
    expect(seen.length).toBe(before);
    await dispatcher.read('/api/school', as, 'GET /api/school');
    expect(seen.at(-1)?.headers['x-branch-id']).toBeUndefined();
  });

  it('builds a URL only from the tool’s own parameters, each passing its schema', () => {
    const detail = GENERATED_TOOLS['GET /api/classes/:id'] as GeneratedTool;
    const id = '0199a000-0000-7000-8000-000000000001';
    expect(urlOf(detail, { id })).toEqual({ url: `/api/classes/${id}` });
    for (const bad of ['..', '../members', '%2F..', 'a/b', `${id}/members`, 7]) {
      expect('fault' in urlOf(detail, { id: bad }), String(bad)).toBe(true);
    }
    expect('fault' in urlOf(detail, {})).toBe(true);
    expect('fault' in urlOf(detail, { id, extra: 1 })).toBe(true);
    const view = GENERATED_TOOLS['GET /api/timetable/views/class'] as GeneratedTool;
    expect(urlOf(view, { date: '2026-11-20', span: 'week', classId: id })).toEqual({
      url: `/api/timetable/views/class?date=2026-11-20&span=week&classId=${id}`,
    });
    expect('fault' in urlOf(view, { date: '20/11/2026', span: 'week', classId: id })).toBe(true);
    expect('fault' in urlOf(view, { date: '2026-11-20', span: 'month', classId: id })).toBe(true);
    // A number given as a number or as its text (the grade of a report).
    const rating = GENERATED_TOOLS['GET /api/results/rating/classes'] as GeneratedTool;
    expect('url' in urlOf(rating, { quarterId: id, grade: 7 })).toBe(true);
    expect('fault' in urlOf(rating, { quarterId: id, grade: 12 })).toBe(true);
  });
});
