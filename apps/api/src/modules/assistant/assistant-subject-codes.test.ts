import { assistantActionsSchema, assistantConfirmedSchema, BRANCH_HEADER } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ask, assistantScene, type AssistantScene } from '../../testing/assistant-kit.js';
import { answer, calls } from '../../testing/assistant-model.js';
import { GENERATED_TOOLS } from './tools.generated.js';

const ROUTE = 'PUT /api/setup/subjects/:id/codes';
const SWITCH = `propose_${GENERATED_TOOLS[ROUTE]?.name ?? ''}`.slice(0, 64);

// Task 11.27 (pull request #399): `02`, Assistant: "The switch on a subject is the Super Admin's,
// on the screen and through the assistant"; `09`, Codes; `02`, Switches: "a proposal waiting on an
// action switched off since is refused at Confirm" (review correction 2: the action starts on).
// Every name is invented.
describe('the codes switch through the assistant (task 11.27)', () => {
  let scene: AssistantScene;

  const server = () => scene.app.getHttpServer() as Parameters<typeof request>[0];

  const confirm = (id: string) =>
    request(server())
      .post(`/api/assistant/proposals/${id}/confirm`)
      .set('Cookie', scene.admin)
      .set(BRANCH_HEADER, scene.north)
      .send({ role: 'super_admin' });

  const setSwitch = (on: boolean) =>
    request(server())
      .put('/api/assistant/actions')
      .set('Cookie', scene.admin)
      .send({ changes: [{ role: 'super_admin', area: 'subject_codes', route: ROUTE, on }] });

  async function proposed(subject: string, codesOn: boolean) {
    scene.model.script(
      calls({
        name: SWITCH,
        args: { id: subject, body: { codesOn }, summary: 'Switch codes on.' },
      }),
      answer('Here it is.'),
    );
    const response = await ask(scene, scene.admin, scene.north, { text: 'Switch codes on.' });
    expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(202);
    const conversation = (
      response.body as { conversation: { proposals: { id: string; steps: unknown[] }[] } }
    ).conversation;
    const proposal = conversation.proposals.at(-1);
    expect(proposal?.steps).toHaveLength(1);
    return proposal?.id ?? '';
  }

  const codesOf = async (subject: string) =>
    (
      await scene.database.migrator
        .selectFrom('subjects')
        .select('codes_on')
        .where('id', '=', subject)
        .executeTakeFirstOrThrow()
    ).codes_on;

  beforeAll(async () => {
    scene = await assistantScene();
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ daily_limit: 500 })
      .execute();
  });

  afterAll(async () => {
    await scene.close();
  });

  it('is an action of the Super Admin alone, on at the start', async () => {
    const response = await request(server())
      .get('/api/assistant/actions')
      .set('Cookie', scene.admin);
    expect(response.status).toBe(200);
    const catalogue = assistantActionsSchema.parse(response.body);
    const actionOf = (role: string) =>
      catalogue.roles
        .find((one) => one.role === role)
        ?.areas.flatMap((area) => area.actions.map((action) => ({ ...action, area: area.area })))
        .find((action) => action.route === ROUTE);
    expect(actionOf('super_admin')).toMatchObject({
      area: 'subject_codes',
      on: true,
      defaultOn: true,
      kind: 'change',
    });
    expect(actionOf('academic_vice_principal')).toBeUndefined();
    expect(actionOf('teacher')).toBeUndefined();
  });

  it('switches codes on when the Super Admin confirms, and audits it', async () => {
    const subject = await scene.people.subject();
    const id = await proposed(subject, true);
    expect(await codesOf(subject)).toBe(false);
    const confirmed = await confirm(id);
    expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 400)).toBe(200);
    const steps = assistantConfirmedSchema
      .parse(confirmed.body)
      .proposals.at(-1)
      ?.steps.map((step) => [step.state, step.code]);
    expect(steps).toEqual([['done', null]]);
    expect(await codesOf(subject)).toBe(true);
    const entries = await scene.database.migrator
      // A change of a school-wide record is an entry of the whole school.
      .selectFrom('audit_log_school')
      .select(['old_value', 'new_value', 'assistant_step_id'])
      .where('action', '=', 'subject.codes')
      .where('record_id', '=', subject)
      .execute();
    expect(entries.map((one) => [one.old_value, one.new_value])).toEqual([
      [{ codesOn: false }, { codesOn: true }],
    ]);
    expect(entries[0]?.assistant_step_id).not.toBeNull();
  });

  it('refuses at Confirm a proposal whose action was switched off since', async () => {
    const subject = await scene.people.subject();
    const id = await proposed(subject, true);
    expect((await setSwitch(false)).status).toBe(200);
    const confirmed = await confirm(id);
    expect(confirmed.status).toBe(200);
    const steps = assistantConfirmedSchema
      .parse(confirmed.body)
      .proposals.at(-1)
      ?.steps.map((step) => [step.state, step.code]);
    expect(steps).toEqual([['refused', 'assistant_action_off']]);
    expect(await codesOf(subject)).toBe(false);
    expect((await setSwitch(true)).status).toBe(200);
  });
});
