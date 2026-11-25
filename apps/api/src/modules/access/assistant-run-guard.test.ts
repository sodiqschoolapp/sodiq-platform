import { randomUUID } from 'node:crypto';
import { ASSISTANT_RUN_HEADER, BRANCH_HEADER, type AssistantRole } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assistantScene, type AssistantScene } from '../../testing/assistant-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { AssistantCalls, type RunningStep } from './assistant-calls.js';

// Task 11.22, the guard change approved by the owner in chat on 25 November 2026 (stop-list item
// 5): an assistant request to a line of kind `file`, `download` or `export` passes only with a
// single-use run mark that `AssistantCalls` issued for that one request, checked against the
// account, the chosen role, the route and the branch the way a step is checked; `decide` still
// runs with the chosen role's assignments only, so no role gains a right; the audit entries are
// marked "via assistant". Review of the plan, correction 1: a second request with the same mark
// is refused `assistant_step_invalid`, even while the first one is still running. Names are
// invented.

const TEMPLATE = 'GET /api/people/students/import-template';
const NEVER_USED = 'GET /api/people/parent-accounts/never-used';
const IMPORT = 'PUT /api/people/students/imports';

describe('the permission guard for the assistant’s imports and exports', () => {
  let scene: AssistantScene;
  let server: Parameters<typeof request>[0];
  let calls: AssistantCalls;
  let teacher: string;
  let teacherAccount: string;

  /** Sends a route as the assistant, with a run mark when one is given. */
  const sent = (
    route: string,
    options: {
      cookie?: string;
      role?: AssistantRole;
      run?: string;
      branch?: string;
    } = {},
  ) => {
    const method = route.slice(0, route.indexOf(' '));
    const path = route.slice(route.indexOf(' ') + 1);
    const url = path === '/api/people/students/import-template' ? `${path}?language=en` : path;
    let call =
      method === 'PUT'
        ? request(server)
            .put(url)
            .set(
              'Content-Type',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            )
            .send(Buffer.from('not a workbook'))
        : request(server).get(url);
    call = call
      .set('Cookie', options.cookie ?? scene.admin)
      .set(BRANCH_HEADER, options.branch ?? scene.north);
    for (const [name, value] of Object.entries(calls.headersFor(options.role ?? 'super_admin'))) {
      call = call.set(name, value);
    }
    if (options.run !== undefined) call = call.set(ASSISTANT_RUN_HEADER, options.run);
    return call;
  };

  /** A run mark of the Super Admin for `route` in the North branch, changed as given. */
  const mark = (route: string, change: Partial<RunningStep> = {}): RunningStep => ({
    stepId: randomUUID(),
    accountId: scene.adminAccount,
    branchId: scene.north,
    role: 'super_admin',
    route,
    ...change,
  });

  beforeAll(async () => {
    scene = await assistantScene();
    server = scene.app.getHttpServer();
    calls = scene.app.get(AssistantCalls);
    const teaching = await scene.kit.fullSession('Bekzod', 'Teacherov');
    await scene.kit.giveRole(teaching.account.id, { role: 'teacher', branchId: scene.north });
    teacher = teaching.cookie;
    teacherAccount = teaching.account.id;
  }, 120_000);

  afterAll(async () => {
    await scene.close();
  });

  it.each([TEMPLATE, NEVER_USED, IMPORT])(
    'refuses %s without a run mark, with an unknown one, and with a step of Confirm (403 assistant_step_invalid)',
    async (route) => {
      for (const run of [undefined, randomUUID()]) {
        const response = await sent(route, run === undefined ? {} : { run });
        expect([response.status, errorCode(response)]).toEqual([403, 'assistant_step_invalid']);
      }
      // A step of a proposal is not a run mark.
      const step = mark(route);
      await calls.whileRunning(step, async () => {
        const response = await sent(route, { run: step.stepId });
        expect([response.status, errorCode(response)]).toEqual([403, 'assistant_step_invalid']);
      });
    },
  );

  it.each([TEMPLATE, NEVER_USED, IMPORT])(
    'refuses %s with the mark of another account, role, route or branch',
    async (route) => {
      const other = route === TEMPLATE ? NEVER_USED : TEMPLATE;
      for (const change of [
        { accountId: teacherAccount },
        { role: 'academic_vice_principal' as const },
        { route: other },
        { branchId: scene.south },
      ]) {
        const run = mark(route, change);
        await calls.whileRun(run, async () => {
          const response = await sent(route, { run: run.stepId });
          expect([response.status, errorCode(response)], JSON.stringify(change)).toEqual([
            403,
            'assistant_step_invalid',
          ]);
        });
      }
      // The mark of the South branch, sent to the South branch: allowed there only.
      const south = mark(route, { branchId: scene.south });
      await calls.whileRun(south, async () => {
        const response = await sent(route, { run: south.stepId, branch: scene.south });
        expect(response.status).not.toBe(403);
      });
    },
  );

  it.each([TEMPLATE, NEVER_USED, IMPORT])(
    'lets %s through once with its mark, and refuses the same mark again while the first still runs',
    async (route) => {
      const run = mark(route);
      await calls.whileRun(run, async () => {
        const first = await sent(route, { run: run.stepId });
        expect(first.status).not.toBe(403);
        const again = await sent(route, { run: run.stepId });
        expect([again.status, errorCode(again)]).toEqual([403, 'assistant_step_invalid']);
      });
    },
  );

  it('refuses a role that does not hold the route, whatever its mark: the Teacher has no student import', async () => {
    const run = mark(TEMPLATE, { accountId: teacherAccount, role: 'teacher' });
    await calls.whileRun(run, async () => {
      const response = await sent(TEMPLATE, { cookie: teacher, role: 'teacher', run: run.stepId });
      expect([response.status, errorCode(response)]).toEqual([403, 'assistant_route_closed']);
    });
  });

  it('marks the audit entry of an export run with its mark "via assistant"', async () => {
    const run = mark(NEVER_USED);
    await calls.whileRun(run, async () => {
      const response = await sent(NEVER_USED, { run: run.stepId });
      expect(response.status).toBe(200);
    });
    const entry = await scene.database.migrator
      .selectFrom('audit_log')
      .select(['action', 'assistant_step_id', 'actor_id'])
      .where('assistant_step_id', '=', run.stepId)
      .executeTakeFirstOrThrow();
    expect(entry).toEqual({
      action: 'parent_account.never_used',
      assistant_step_id: run.stepId,
      actor_id: scene.adminAccount,
    });
  });
});
