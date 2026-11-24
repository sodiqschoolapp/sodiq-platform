import { BRANCH_HEADER, ASSISTANT_STEP_HEADER, type AssistantRole } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { answer, calls } from '../../testing/assistant-model.js';
import { ask, assistantScene, type AssistantScene } from '../../testing/assistant-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { AssistantCalls } from '../access/assistant-calls.js';
import { AssistantDispatcher } from './dispatcher.js';
import { GENERATED_TOOLS } from './tools.generated.js';

// Task 11.13 (pull request #376), the permission review of the code: every refusal of Confirm
// and Decline reached with each earlier check passing, 404 for another person's, another
// branch's and an unknown proposal with every row of the tables they write unchanged, two
// Confirms at the same moment, and the guard's and the same-site check's handling of the
// process's mark. All names are invented.

const ROOM_EDIT = `propose_${GENERATED_TOOLS['PUT /api/setup/rooms/:id']?.name ?? ''}`.slice(0, 64);
const CLASS_ARCHIVE =
  `propose_${GENERATED_TOOLS['POST /api/classes/:id/archive']?.name ?? ''}`.slice(0, 64);
const UNKNOWN = '0199a3c4-0000-7000-8000-00000000abcd';

describe('Confirm and Decline: refusals, 404s and the mark of a step', () => {
  let scene: AssistantScene;

  beforeAll(async () => {
    scene = await assistantScene();
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ school_on: true, roles_on: ['super_admin', 'academic_vice_principal'] })
      .execute();
  });

  afterAll(async () => {
    await scene.close();
  });

  const server = () => scene.app.getHttpServer() as Parameters<typeof request>[0];

  const decide = (
    which: 'confirm' | 'decline',
    id: string,
    cookie: string,
    branch: string,
    role: AssistantRole,
  ) =>
    request(server())
      .post(`/api/assistant/proposals/${id}/${which}`)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .send({ role });

  /** Every row of the tables Confirm and Decline write, and of the steps' targets, in both branches. */
  const rows = async () => ({
    decisions: await scene.database.migrator
      .selectFrom('assistant_proposal_decisions')
      .selectAll()
      .orderBy('proposal_id')
      .execute(),
    steps: await scene.database.migrator
      .selectFrom('assistant_proposal_steps')
      .selectAll()
      .orderBy('step_id')
      .execute(),
    rooms: await scene.database.migrator.selectFrom('rooms').selectAll().orderBy('id').execute(),
    classes: await scene.database.migrator
      .selectFrom('classes')
      .selectAll()
      .orderBy('id')
      .execute(),
    audit: await scene.database.migrator
      .selectFrom('audit_log')
      .selectAll()
      .orderBy('id')
      .execute(),
  });

  async function room(branch = scene.north) {
    const id = await scene.people.room(branch);
    const row = await scene.database.migrator
      .selectFrom('rooms')
      .select('floor_id')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return { id, floorId: row.floor_id };
  }

  const roomEdit = (target: { id: string; floorId: string }, name: string) => ({
    name: ROOM_EDIT,
    args: {
      id: target.id,
      body: {
        name,
        floorId: target.floorId,
        type: 'classroom',
        capacity: 28,
        status: 'in_use',
        shared: false,
        maxSimultaneousLessons: null,
      },
      summary: `Rename to ${name}.`,
    },
  });

  async function proposeAs(
    cookie: string,
    role: AssistantRole,
    wanted: { name: string; args: Record<string, unknown> },
    conversationId?: string,
  ): Promise<{ proposalId: string; conversationId: string }> {
    scene.model.script(calls(wanted), answer('Proposed.'));
    const response = await ask(scene, cookie, scene.north, {
      text: 'Please change it.',
      role,
      ...(conversationId === undefined ? {} : { conversationId }),
    });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(202);
    const conversation = (
      response.body as { conversation: { id: string; proposals: { id: string }[] } }
    ).conversation;
    const proposal = conversation.proposals.at(-1);
    expect(proposal, JSON.stringify(response.body).slice(0, 600)).toBeDefined();
    return { proposalId: proposal?.id ?? '', conversationId: conversation.id };
  }

  async function viceOf(firstName: string) {
    const browser = await scene.kit.completeSession(firstName, 'Qodirova');
    const given = await scene.kit.giveRole(browser.account.id, {
      role: 'academic_vice_principal',
      branchId: scene.north,
    });
    return { cookie: browser.cookie, accountId: browser.account.id, assignmentId: given.id };
  }

  it('answers 404 for an unknown proposal, another person’s and the own one in another branch, to Confirm and Decline alike, with every row unchanged', async () => {
    const vice = await viceOf('Zarina');
    const klass = await scene.people.schoolClass(scene.north, scene.northYear);
    const theirs = await proposeAs(vice.cookie, 'academic_vice_principal', {
      name: CLASS_ARCHIVE,
      args: { id: klass, summary: 'Archive.' },
    });
    const own = await proposeAs(scene.admin, 'super_admin', roomEdit(await room(), 'Kept'));
    const before = await rows();
    for (const which of ['confirm', 'decline'] as const) {
      expect((await decide(which, UNKNOWN, scene.admin, scene.north, 'super_admin')).status).toBe(
        404,
      );
      // Another person's: the Super Admin may not decide the Vice Principal's proposal.
      expect(
        (await decide(which, theirs.proposalId, scene.admin, scene.north, 'super_admin')).status,
      ).toBe(404);
      // The own proposal of the north, asked in the south: the row filter of the branch of the
      // request, also for the Super Admin, whose rights reach every branch.
      expect(
        (await decide(which, own.proposalId, scene.admin, scene.south, 'super_admin')).status,
      ).toBe(404);
    }
    expect(await rows()).toEqual(before);
  });

  it('refuses a proposal made in a role no longer held while another role lets the person in', async () => {
    const browser = await scene.kit.completeSession('Feruza', 'Nazarova');
    const vice = await scene.kit.giveRole(browser.account.id, {
      role: 'academic_vice_principal',
      branchId: scene.north,
    });
    await scene.kit.giveRole(browser.account.id, { role: 'super_admin' });
    const klass = await scene.people.schoolClass(scene.north, scene.northYear);
    const { proposalId } = await proposeAs(browser.cookie, 'academic_vice_principal', {
      name: CLASS_ARCHIVE,
      args: { id: klass, summary: 'Archive.' },
    });
    await scene.database.migrator
      .updateTable('assignments')
      .set({
        valid_from: new Date('2026-11-20T08:00:00+05:00'),
        valid_until: new Date('2026-11-20T09:00:00+05:00'),
      })
      .where('id', '=', vice.id)
      .execute();
    const before = await rows();
    // The guard lets the person in through the Super Admin's panel; the chosen role is gone.
    for (const which of ['confirm', 'decline'] as const) {
      expect(
        errorCode(
          await decide(which, proposalId, browser.cookie, scene.north, 'academic_vice_principal'),
        ),
      ).toBe('assistant_role_not_held');
    }
    expect(await rows()).toEqual(before);
  });

  it('refuses a superseded proposal, then a decided one, and an expired one is refused by Decline too', async () => {
    const first = await proposeAs(scene.admin, 'super_admin', roomEdit(await room(), 'First'));
    const second = await proposeAs(
      scene.admin,
      'super_admin',
      roomEdit(await room(), 'Second'),
      first.conversationId,
    );
    for (const which of ['confirm', 'decline'] as const) {
      expect(
        errorCode(await decide(which, first.proposalId, scene.admin, scene.north, 'super_admin')),
      ).toBe('assistant_proposal_superseded');
    }
    expect(
      (await decide('decline', second.proposalId, scene.admin, scene.north, 'super_admin')).status,
    ).toBe(200);
    for (const which of ['confirm', 'decline'] as const) {
      expect(
        errorCode(await decide(which, second.proposalId, scene.admin, scene.north, 'super_admin')),
      ).toBe('assistant_proposal_decided');
    }
  });

  it('runs one of two Confirms sent at the same moment; the other is refused as decided and each step runs once', async () => {
    const target = await room();
    const { proposalId } = await proposeAs(scene.admin, 'super_admin', roomEdit(target, 'Once'));
    const [a, b] = await Promise.all([
      decide('confirm', proposalId, scene.admin, scene.north, 'super_admin'),
      decide('confirm', proposalId, scene.admin, scene.north, 'super_admin'),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(errorCode(a.status === 409 ? a : b)).toBe('assistant_proposal_decided');
    const entries = await scene.database.migrator
      .selectFrom('audit_log')
      .select('id')
      .where('record_id', '=', target.id)
      .execute();
    expect(entries.length).toBe(1);
  });

  it('refuses a change marked with the process’s secret unless Confirm is running that very step', async () => {
    const calls = scene.app.get(AssistantCalls);
    const target = await room();
    const other = await scene.kit.completeSession('Lola', 'Ergasheva');
    const body = roomEdit(target, 'Forged').args.body;
    const send = (headers: Record<string, string>, branch = scene.north) =>
      request(server())
        .put(`/api/setup/rooms/${target.id}`)
        .set('Cookie', scene.admin)
        .set(BRANCH_HEADER, branch)
        .set(headers)
        .send(body);
    const marked = calls.headersFor('super_admin');
    const step = {
      stepId: '0199a3c4-0000-7000-8000-0000000000aa',
      accountId: scene.adminAccount,
      branchId: scene.north,
      role: 'super_admin' as const,
      route: 'PUT /api/setup/rooms/:id',
    };
    const before = await rows();
    // No running step.
    expect(errorCode(await send({ ...marked, [ASSISTANT_STEP_HEADER]: step.stepId }))).toBe(
      'assistant_step_invalid',
    );
    expect(errorCode(await send(marked))).toBe('assistant_step_invalid');
    // A running step of another account, another role, another route, another branch.
    for (const running of [
      { ...step, accountId: other.account.id },
      { ...step, role: 'academic_vice_principal' as const },
      { ...step, route: 'POST /api/setup/rooms' },
      { ...step, branchId: scene.south },
    ]) {
      const answerOf = await calls.whileRunning(running, () =>
        send({ ...marked, [ASSISTANT_STEP_HEADER]: step.stepId }),
      );
      expect(errorCode(answerOf), JSON.stringify(running)).toBe('assistant_step_invalid');
    }
    expect(await rows()).toEqual(before);
    // The step itself, running: the change is made, and its audit entry names the step.
    const done = await calls.whileRunning(step, () =>
      send({ ...marked, [ASSISTANT_STEP_HEADER]: step.stepId }),
    );
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const entry = await scene.database.migrator
      .selectFrom('audit_log')
      .select('assistant_step_id')
      .where('record_id', '=', target.id)
      .executeTakeFirstOrThrow();
    expect(entry.assistant_step_id).toBe(step.stepId);
  });

  it('lets a changing request from another site through the same-site check only with the process’s secret', async () => {
    const calls = scene.app.get(AssistantCalls);
    const target = await room();
    const body = roomEdit(target, 'Cross').args.body;
    const send = (headers: Record<string, string>) =>
      request(server())
        .put(`/api/setup/rooms/${target.id}`)
        .set('Cookie', scene.admin)
        .set(BRANCH_HEADER, scene.north)
        .set('Origin', 'https://elsewhere.example')
        .set(headers)
        .send(body);
    const marked = calls.headersFor('super_admin');
    expect(errorCode(await send({ ...marked, 'X-Assistant-Call': 'not-the-secret' }))).toBe(
      'cross_site_request',
    );
    expect(
      errorCode(await send({ [ASSISTANT_STEP_HEADER]: '0199a3c4-0000-7000-8000-0000000000bb' })),
    ).toBe('cross_site_request');
    // The right secret passes the same-site check and meets the guard's step check.
    expect(errorCode(await send(marked))).toBe('assistant_step_invalid');
  });

  // Review of the code, finding 3: a step whose answer does not come back (a timeout, a lost
  // connection) may still have been made by its route; it is "not known", never "refused".
  it('records a step whose answer was lost as not known, stops the rest, and the change it made is audited as the step’s', async () => {
    const first = await room();
    const second = await room();
    scene.model.script(
      calls(roomEdit(first, 'Lost answer'), roomEdit(second, 'Never run')),
      answer('Proposed.'),
    );
    const asked = await ask(scene, scene.admin, scene.north, { text: 'Rename both rooms.' });
    const proposal = (asked.body as { conversation: { proposals: { id: string }[] } }).conversation
      .proposals[0];
    const dispatcher = scene.app.get(AssistantDispatcher);
    const send = dispatcher.send.bind(dispatcher);
    const spy = vi.spyOn(dispatcher, 'send').mockImplementation(async (method, url, body, as) => {
      const outcome = await send(method, url, body, as);
      // The route ran and answered; the answer is lost on the way back.
      return as.stepId === undefined ? outcome : { status: 0, failure: 'timeout' };
    });
    try {
      const confirmed = await decide(
        'confirm',
        proposal?.id ?? '',
        scene.admin,
        scene.north,
        'super_admin',
      );
      expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 300)).toBe(200);
      const steps = (
        confirmed.body as { proposals: { id: string; steps: { id: string; state: string }[] }[] }
      ).proposals.find((one) => one.id === proposal?.id)?.steps;
      expect(steps?.map((one) => one.state)).toEqual(['unknown', 'not_run']);
      const entry = await scene.database.migrator
        .selectFrom('audit_log')
        .select('assistant_step_id')
        .where('record_id', '=', first.id)
        .executeTakeFirstOrThrow();
      expect(entry.assistant_step_id).toBe(steps?.[0]?.id);
      const untouched = await scene.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('record_id', '=', second.id)
        .execute();
      expect(untouched).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
