import { Logger } from '@nestjs/common';
import {
  ASSISTANT_CALL_HEADER,
  ASSISTANT_ROLE_HEADER,
  BRANCH_HEADER,
  INTEGRATION_KEY_HEADER,
} from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ShippingLogger } from '../../monitoring/monitoring.service.js';
import { assistantScene, type AssistantScene } from '../../testing/assistant-kit.js';
import { answer, calls } from '../../testing/assistant-model.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { AssistantCalls } from './assistant-calls.js';
import { ASSISTANT_ROUTES, type AssistantRouteLists } from './assistant-routes.js';
import { readerPostsOf } from './request-posts.js';

// Task 11.12 (plan review, must fix 1 and 2). `02`, Assistant: "The assistant has no rights of
// its own. It works only through the platform's own actions, with the person's session and
// chosen role"; "The actions open to it are a list fixed in code for each of the three roles".
// Build plan 11.12, approved by the owner: "through the assistant a person does only what their
// chosen role already allows, on the actions of the list". Names are invented.

/**
 * A list for the Teacher, which has none in this task, to test the narrowing to a chosen role:
 * the staff list, which the Principal reads and the Teacher does not.
 */
const LISTS: AssistantRouteLists = {
  ...ASSISTANT_ROUTES,
  teacher: { 'GET /api/people/staff': { group: 'staff', description: 'The staff.' } },
};

describe('the permission guard for the assistant’s reads', () => {
  let scene: AssistantScene;
  let server: Parameters<typeof request>[0];
  let calls_: AssistantCalls;
  let principalTeacher: string;

  const get = (path: string, headers: Record<string, string>, cookie = scene.admin) => {
    let call = request(server).get(path).set('Cookie', cookie).set(BRANCH_HEADER, scene.north);
    for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
    return call;
  };

  beforeAll(async () => {
    scene = await assistantScene({ routeLists: LISTS });
    server = scene.app.getHttpServer() as Parameters<typeof request>[0];
    calls_ = scene.app.get(AssistantCalls);
    const both = await scene.kit.fullSession('Gulnora', 'Principalova');
    await scene.kit.giveRole(both.account.id, { role: 'principal', branchId: scene.north });
    await scene.kit.giveRole(both.account.id, { role: 'teacher', branchId: scene.north });
    principalTeacher = both.cookie;
  }, 120_000);

  afterAll(async () => {
    await scene.close();
  });

  it('refuses a mark without the server’s secret, with one header only, or with an unknown role (403 assistant_call_invalid)', async () => {
    const cases: Record<string, string>[] = [
      { [ASSISTANT_CALL_HEADER]: 'a'.repeat(43), [ASSISTANT_ROLE_HEADER]: 'super_admin' },
      { [ASSISTANT_ROLE_HEADER]: 'super_admin' },
      { [ASSISTANT_CALL_HEADER]: calls_.headersFor('super_admin')[ASSISTANT_CALL_HEADER] ?? '' },
      { ...calls_.headersFor('super_admin'), [ASSISTANT_ROLE_HEADER]: 'principal' },
    ];
    for (const headers of cases) {
      const response = await get('/api/classes', headers);
      expect([response.status, errorCode(response)], JSON.stringify(Object.keys(headers))).toEqual([
        403,
        'assistant_call_invalid',
      ]);
    }
    // With the secret the same read passes.
    expect((await get('/api/classes', calls_.headersFor('super_admin'))).status).toBe(200);
  });

  it('refuses the mark on every route off the role’s list, whatever its declaration: public, own account, portal, key only, a permission (403 assistant_route_closed)', async () => {
    for (const path of [
      '/api/health',
      '/api/auth/session',
      '/api/auth/sessions',
      '/api/portal/children',
      '/api/integration/people',
      '/api/integration-keys',
      '/api/audit/entries',
    ]) {
      const response = await get(path, calls_.headersFor('super_admin'));
      expect([response.status, errorCode(response)], path).toEqual([403, 'assistant_route_closed']);
    }
  });

  it('refuses the mark beside the header of an integration key', async () => {
    const response = await get('/api/classes', {
      ...calls_.headersFor('super_admin'),
      [INTEGRATION_KEY_HEADER]: `sodiq_ik_${'a'.repeat(43)}`,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(['assistant_call_invalid', 'integration_key_invalid']).toContain(errorCode(response));
    expect(response.status).not.toBe(200);
  });

  it('narrows the rights to the chosen role: a Principal who is also a Teacher, read as the Teacher, is refused what only the Principal reads', async () => {
    // Without the mark the session reads the staff list through its Principal role.
    expect((await get('/api/people/staff', {}, principalTeacher)).status).toBe(200);
    const narrowed = await get('/api/people/staff', calls_.headersFor('teacher'), principalTeacher);
    expect([narrowed.status, errorCode(narrowed)]).toEqual([403, 'permission_denied']);
  });

  it('keeps a decision read from the database to the post of the chosen role (`readerPostsOf`)', () => {
    const holders = [
      { accountId: 'a', post: 'super_admin' as const },
      { accountId: 'a', post: 'head_teacher' as const },
      { accountId: 'a', post: 'academic_vice_principal' as const },
    ];
    expect(readerPostsOf(holders, { accountId: 'a' })).toEqual({
      superAdmin: true,
      academicVicePrincipal: true,
      seniorHeadTeacher: false,
      headTeacher: true,
    });
    expect(readerPostsOf(holders, { accountId: 'a', assistantRole: 'super_admin' })).toEqual({
      superAdmin: true,
      academicVicePrincipal: false,
      seniorHeadTeacher: false,
      headTeacher: false,
    });
    expect(readerPostsOf(holders, { accountId: 'a', assistantRole: 'teacher' })).toEqual({
      superAdmin: false,
      academicVicePrincipal: false,
      seniorHeadTeacher: false,
      headTeacher: false,
    });
  });

  it('never writes the secret into a log line, an answer or a stored read', async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    Logger.overrideLogger(new ShippingLogger());
    ShippingLogger.sink = (_level, text) => {
      lines.push(text);
    };
    const secret = calls_.headersFor('super_admin')[ASSISTANT_CALL_HEADER] ?? '';
    let body = '';
    try {
      scene.model.script(
        calls({ name: 'ClassesController_list' }, { name: 'IntegrationKeysController_list' }),
        answer('Done.'),
      );
      const response = await request(server)
        .post('/api/assistant/questions')
        .set('Cookie', scene.admin)
        .set(BRANCH_HEADER, scene.north)
        .send({ role: 'super_admin', text: 'Read.' });
      body = JSON.stringify(response.body);
      expect(response.status).toBe(200);
      await get('/api/classes', {
        ...calls_.headersFor('super_admin'),
        [ASSISTANT_CALL_HEADER]: 'x',
      });
    } finally {
      ShippingLogger.sink = undefined;
      vi.restoreAllMocks();
    }
    expect(secret.length).toBeGreaterThan(30);
    expect(lines.join('\n')).not.toContain(secret);
    expect(body).not.toContain(secret);
    const stored = JSON.stringify(
      await scene.database.migrator.selectFrom('assistant_messages').selectAll().execute(),
    );
    expect(stored).not.toContain(secret);
    expect(JSON.stringify(scene.model.requests)).not.toContain(secret);
  });
});
