import {
  assistantActionsSchema,
  assistantConfirmedSchema,
  BRANCH_HEADER,
  staffDetailSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ShippingLogger } from '../../monitoring/monitoring.service.js';
import { ask, assistantScene, type AssistantScene } from '../../testing/assistant-kit.js';
import { answer, calls, lastResults } from '../../testing/assistant-model.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { ASSISTANT_QUESTION_ACTIONS_DEFAULT } from '@sodiq/shared';
import { modelCallsOf } from './assistant.engine.js';
import { AssistantDispatcher } from './dispatcher.js';
import { GENERATED_TOOLS } from './tools.generated.js';
import { MAX_DECLARED_ACTIONS, declaredActions, toolOf } from './tools.js';
import { OPEN_FILTER } from './field-filter.js';
import { AssistantRoutes } from '../access/assistant-routes.check.js';

/** Task 11.21: the reads and changes of one question at the setting's default (40), and the model calls. */
const MAX_READS = ASSISTANT_QUESTION_ACTIONS_DEFAULT;
const MAX_MODEL_CALLS = modelCallsOf(MAX_READS);

// Task 11.20. `02`, Assistant, Switches: "the Super Admin sees, for each of the three roles, every
// action of that role grouped by area … and switches each action, or a whole area, on or off; the
// assistant uses only what is switched on, and a proposal waiting on an action switched off since
// is refused at Confirm. Everything is on at the start except these … Each change of a switch is
// in the audit log." Never, whatever the switches: "The model never sees a secret … An action
// that gives one out still runs on Confirm, and the secret is shown to the person in the
// conversation once, as the screen shows it, never to the model and never stored in the
// conversation." The rows of `edge/people-roles-accounts` (The assistant) of 25 November 2026:
// "The Super Admin switches an action off while a proposal that uses it waits", "The Super Admin
// asks the assistant to reset a teacher's password, with accounts switched on", "How do we move a
// student to another branch?" (its switch). Every name is invented.

const propose = (route: string): string =>
  `propose_${GENERATED_TOOLS[route]?.name ?? ''}`.slice(0, 64);
const ROOM_EDIT = propose('PUT /api/setup/rooms/:id');
const CLASS_ARCHIVE = propose('POST /api/classes/:id/archive');
const RESET = propose('POST /api/people/staff/:id/account/password-reset');
const BRANCH_MOVE = propose('POST /api/people/students/:id/branch-move');
const STUDENT_CREATE = propose('POST /api/people/students');

describe('the Super Admin’s switches of the assistant’s actions', () => {
  let scene: AssistantScene;
  let count = 0;

  const server = () => scene.app.getHttpServer() as Parameters<typeof request>[0];

  const switches = (cookie = scene.admin) =>
    request(server()).get('/api/assistant/actions').set('Cookie', cookie);
  const setSwitches = (
    changes: { role: string; area: string; route?: string; on: boolean }[],
    cookie = scene.admin,
  ) => request(server()).put('/api/assistant/actions').set('Cookie', cookie).send({ changes });

  const confirm = (id: string) =>
    request(server())
      .post(`/api/assistant/proposals/${id}/confirm`)
      .set('Cookie', scene.admin)
      .set(BRANCH_HEADER, scene.north)
      .send({ role: 'super_admin' });

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

  async function room() {
    const id = await scene.people.room(scene.north);
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

  /** Asks as the Super Admin with a model that makes these calls, and gives the conversation. */
  async function asked(
    wanted: { name: string; args?: Record<string, unknown> }[],
    conversationId?: string,
  ) {
    scene.model.script(calls(...wanted), answer('Here it is.'));
    const response = await ask(scene, scene.admin, scene.north, {
      text: 'Please.',
      ...(conversationId === undefined ? {} : { conversationId }),
    });
    expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(202);
    return (
      response.body as {
        conversation: {
          id: string;
          proposals: { id: string; steps: { id: string; state: string }[] }[];
        };
      }
    ).conversation;
  }

  const results = () =>
    lastResults(scene.model.requests.at(-1) ?? { system: '', turns: [], tools: [] }).map(
      (one) => one.result,
    );

  it('lists every action of the three roles by area, the heavy ones off at the start, and refuses every other role and an unknown action', async () => {
    const response = await switches();
    expect(response.status).toBe(200);
    const catalogue = assistantActionsSchema.parse(response.body);
    const actionOf = (role: string, route: string) =>
      catalogue.roles
        .find((one) => one.role === role)
        ?.areas.flatMap((area) => area.actions)
        .find((action) => action.route === route);
    expect(
      actionOf('super_admin', 'POST /api/people/staff/:id/account/password-reset'),
    ).toMatchObject({
      on: false,
      defaultOn: false,
      kind: 'change',
    });
    expect(actionOf('super_admin', 'POST /api/timetable/versions/:id/publish')?.on).toBe(false);
    expect(actionOf('super_admin', 'PUT /api/setup/rooms/:id')?.on).toBe(true);
    expect(actionOf('teacher', 'POST /api/journal/lessons/:lessonId/attendance')?.on).toBe(true);
    expect(actionOf('teacher', 'PUT /api/setup/rooms/:id')).toBeUndefined();
    // An export is listed with no tool yet (plan decision 7).
    expect(actionOf('super_admin', 'POST /api/people/students/export')?.hasTool).toBe(false);
    // Another role is refused, in the route and through the guard (`ROUTE_ACCESS` covers each).
    const vice = await scene.kit.completeSession('Zarina', 'Qodirova');
    await scene.kit.giveRole(vice.account.id, {
      role: 'academic_vice_principal',
      branchId: scene.north,
    });
    expect((await switches(vice.cookie)).status).toBe(403);
    expect(
      (await setSwitches([{ role: 'super_admin', area: 'rooms', on: false }], vice.cookie)).status,
    ).toBe(403);
    const unknown = await setSwitches([
      { role: 'teacher', area: 'rooms', route: 'PUT /api/setup/rooms/:id', on: false },
    ]);
    expect([unknown.status, errorCode(unknown)]).toEqual([400, 'assistant_action_unknown']);
    const unknownArea = await setSwitches([{ role: 'teacher', area: 'rooms', on: false }]);
    expect([unknownArea.status, errorCode(unknownArea)]).toEqual([400, 'assistant_action_unknown']);
  });

  it('switches an action and an area, audits each change, and gives the question only what is on', async () => {
    const before = await scene.database.migrator
      .selectFrom('audit_log_school')
      .select('id')
      .where('action', '=', 'assistant_switch.change')
      .execute();
    const off = await setSwitches([
      { role: 'super_admin', area: 'rooms', route: 'PUT /api/setup/rooms/:id', on: false },
    ]);
    expect(off.status).toBe(200);
    const audited = await scene.database.migrator
      .selectFrom('audit_log_school')
      .select(['old_value', 'new_value', 'actor_id'])
      .where('action', '=', 'assistant_switch.change')
      .execute();
    expect(audited.length).toBe(before.length + 1);
    expect(audited.at(-1)).toMatchObject({
      actor_id: scene.adminAccount,
      old_value: expect.objectContaining({ on: true }) as unknown,
      new_value: expect.objectContaining({
        on: false,
        route: 'PUT /api/setup/rooms/:id',
      }) as unknown,
    });
    // Called by name it is refused and nothing is sent; find_actions does not give it.
    const target = await room();
    const sent = vi.spyOn(scene.app.get(AssistantDispatcher), 'send');
    try {
      await asked([
        roomEdit(target, 'Off'),
        { name: 'find_actions', args: { words: 'change a room' } },
      ]);
      const [refused, found] = results();
      expect(refused).toEqual({ error: 'action_off' });
      expect(JSON.stringify(found)).not.toContain(ROOM_EDIT);
      expect(sent).not.toHaveBeenCalled();
    } finally {
      sent.mockRestore();
    }
    // The whole area off, and on again with one change: every action of it follows.
    expect((await setSwitches([{ role: 'super_admin', area: 'rooms', on: false }])).status).toBe(
      200,
    );
    let catalogue = assistantActionsSchema.parse((await switches()).body);
    const rooms = () =>
      catalogue.roles
        .find((one) => one.role === 'super_admin')
        ?.areas.find((area) => area.area === 'rooms');
    expect(rooms()?.on).toBe(false);
    expect(rooms()?.actions.every((action) => !action.on)).toBe(true);
    expect((await setSwitches([{ role: 'super_admin', area: 'rooms', on: true }])).status).toBe(
      200,
    );
    catalogue = assistantActionsSchema.parse((await switches()).body);
    expect(rooms()?.actions.every((action) => action.on)).toBe(true);
    // An area switched on turns on its heavy actions too, each audited (code review must fix 2).
    const audits = async () =>
      scene.database.migrator
        .selectFrom('audit_log_school')
        .select(['new_value'])
        .where('action', '=', 'assistant_switch.change')
        .execute();
    const count = (await audits()).length;
    expect((await setSwitches([{ role: 'super_admin', area: 'timetable', on: true }])).status).toBe(
      200,
    );
    const added = (await audits())
      .slice(count)
      .map((one) => one.new_value as { route: string | null });
    expect(added.map((one) => one.route)).toEqual(
      expect.arrayContaining([
        null,
        'POST /api/timetable/versions/:id/publish',
        'POST /api/timetable/versions/:id/withdraw',
      ]),
    );
    // Only what flipped: an action that was on already is not audited again.
    expect(added.map((one) => one.route)).not.toContain('POST /api/timetable/bulk-cancels');
    catalogue = assistantActionsSchema.parse((await switches()).body);
    // The Academic Vice Principal's own switches are untouched by the Super Admin's.
    expect(
      catalogue.roles
        .find((one) => one.role === 'academic_vice_principal')
        ?.areas.flatMap((area) => area.actions)
        .every((action) => action.on === action.defaultOn),
    ).toBe(true);
  });

  // `edge/people-roles-accounts`: "The Super Admin switches an action off while a proposal that
  // uses it waits. — Confirm refuses that change as switched off, and the changes after it are not
  // made; the answer says so. The changes before it stay done."
  it('refuses at Confirm a step whose action, or whose area, was switched off since; the steps before stay done and those after are not run', async () => {
    for (const how of ['action', 'area'] as const) {
      const first = await room();
      const last = await room();
      const klass = await scene.people.schoolClass(scene.north, scene.northYear, {
        name: `Cambridge ${how}`,
      });
      const conversation = await asked([
        roomEdit(first, `First ${how}`),
        { name: CLASS_ARCHIVE, args: { id: klass, summary: 'Archive.' } },
        roomEdit(last, `Last ${how}`),
      ]);
      const proposal = conversation.proposals.at(-1);
      expect(proposal?.steps).toHaveLength(3);
      expect(
        (
          await setSwitches([
            how === 'action'
              ? {
                  role: 'super_admin',
                  area: 'classes',
                  route: 'POST /api/classes/:id/archive',
                  on: false,
                }
              : { role: 'super_admin', area: 'classes', on: false },
          ])
        ).status,
      ).toBe(200);
      const confirmed = await confirm(proposal?.id ?? '');
      expect(confirmed.status).toBe(200);
      const steps = assistantConfirmedSchema
        .parse(confirmed.body)
        .proposals.at(-1)
        ?.steps.map((step) => [step.state, step.code]);
      expect(steps, `${how}: ${JSON.stringify(steps)}`).toEqual([
        ['done', null],
        ['refused', 'assistant_action_off'],
        ['not_run', null],
      ]);
      const names = await scene.database.migrator
        .selectFrom('rooms')
        .select(['id', 'name'])
        .where('id', 'in', [first.id, last.id])
        .execute();
      expect(names.find((one) => one.id === first.id)?.name).toBe(`First ${how}`);
      expect(names.find((one) => one.id === last.id)?.name).not.toBe(`Last ${how}`);
      const archived = await scene.database.migrator
        .selectFrom('classes')
        .select('archived_at')
        .where('id', '=', klass)
        .executeTakeFirstOrThrow();
      expect(archived.archived_at).toBeNull();
      expect((await setSwitches([{ role: 'super_admin', area: 'classes', on: true }])).status).toBe(
        200,
      );
    }
  });

  // Plan review 6: the basis read of a step at Confirm meets the switch too.
  it('refuses at Confirm a step whose basis read was switched off since, and sends nothing', async () => {
    const target = await room();
    const conversation = await asked([roomEdit(target, 'Basis off')]);
    await setSwitches([
      { role: 'super_admin', area: 'rooms', route: 'GET /api/setup/rooms', on: false },
    ]);
    const confirmed = assistantConfirmedSchema.parse(
      (await confirm(conversation.proposals.at(-1)?.id ?? '')).body,
    );
    expect(confirmed.proposals.at(-1)?.steps.map((step) => [step.state, step.code])).toEqual([
      ['refused', 'assistant_action_off'],
    ]);
    // Nothing was sent: the room keeps its name (code review 4c).
    const kept = await scene.database.migrator
      .selectFrom('rooms')
      .select('name')
      .where('id', '=', target.id)
      .executeTakeFirstOrThrow();
    expect(kept.name).not.toBe('Basis off');
    await setSwitches([
      { role: 'super_admin', area: 'rooms', route: 'GET /api/setup/rooms', on: true },
    ]);
  });

  // Code review 4c (plan test 4; plan review 6): the preview of a waiting step, switched off since.
  it('refuses at Confirm a step whose preview was switched off since, and creates nothing', async () => {
    const klass = await scene.people.schoolClass(scene.north, scene.northYear, {
      name: 'Oxford P',
    });
    const body = {
      uid: '2607111',
      firstName: 'Nodira',
      lastName: 'Previewova',
      paternalName: '',
      sex: 'female',
      birthDate: '2013-03-03',
      grade: 7,
      startsOn: '2026-09-02',
      classId: klass,
      documentType: 'birth_certificate',
      documentNumber: 'I-TN 7654320',
      jshshir: '31999999999990',
      phone: null,
      email: null,
      address: 'Previewstreet 1',
      region: 'khorezm',
      previousSchool: null,
      diagnosticScore: null,
      scholarship: { type: 'none', coverage: null, amount: null },
      consentSignedOn: null,
      contract: null,
      relatives: [
        {
          kind: 'new',
          relative: {
            fullName: 'Previewova Mother',
            phone: '+998901110099',
            workplace: '',
            email: '',
            extraPhones: [],
          },
          relationship: 'mother',
          mainContact: true,
          portalAccess: false,
          receivesNotices: false,
        },
      ],
    };
    const conversation = await asked([
      { name: STUDENT_CREATE, args: { body, summary: 'Add the student.' } },
    ]);
    const proposal = conversation.proposals.at(-1);
    expect(proposal?.steps, JSON.stringify(results())).toHaveLength(1);
    await setSwitches([
      {
        role: 'super_admin',
        area: 'students',
        route: 'POST /api/people/students/check',
        on: false,
      },
    ]);
    const confirmed = assistantConfirmedSchema.parse((await confirm(proposal?.id ?? '')).body);
    expect(confirmed.proposals.at(-1)?.steps.map((step) => [step.state, step.code])).toEqual([
      ['refused', 'assistant_action_off'],
    ]);
    const created = await scene.database.migrator
      .selectFrom('students')
      .select('id')
      .where('last_name', '=', 'Previewova')
      .execute();
    expect(created).toEqual([]);
    await setSwitches([
      { role: 'super_admin', area: 'students', route: 'POST /api/people/students/check', on: true },
    ]);
  });

  // Plan decision 6 (code review should fix 7): an action with no stored row follows its area.
  it('follows its area for an action the Super Admin never set', async () => {
    await scene.database.migrator
      .insertInto('assistant_area_switches')
      .values({
        role: 'teacher',
        area: 'plan_requests',
        is_on: false,
        changed_at: new Date(),
        changed_by: scene.adminAccount,
      })
      .execute();
    const catalogue = assistantActionsSchema.parse((await switches()).body);
    const area = catalogue.roles
      .find((one) => one.role === 'teacher')
      ?.areas.find((one) => one.area === 'plan_requests');
    expect(area?.on).toBe(false);
    expect(area?.actions.length).toBeGreaterThan(0);
    expect(area?.actions.every((action) => !action.on && action.defaultOn)).toBe(true);
    const stored = await scene.database.migrator
      .selectFrom('assistant_action_switches')
      .select('route')
      .where('role', '=', 'teacher')
      .execute();
    expect(stored).toEqual([]);
    await scene.database.migrator
      .deleteFrom('assistant_area_switches')
      .where('role', '=', 'teacher')
      .execute();
  });

  // `edge/people-roles-accounts`: "The Super Admin asks the assistant to reset a teacher's
  // password, with accounts switched on. — It proposes the reset. On Confirm the one-time password
  // is shown to the Super Admin in the conversation once, as the screen shows it; the model never
  // sees it and the conversation does not keep it."
  it('resets a password only with the area switched on, and shows the one-time password once, in the answer of Confirm only', async () => {
    count += 1;
    const division = async (table: 'divisions' | 'departments', name: string) =>
      (
        await scene.database.migrator
          .selectFrom(table)
          .select('id')
          .where('name_en', '=', name)
          .executeTakeFirstOrThrow()
      ).id;
    const staff = await scene.kit
      .post('/api/people/staff', scene.admin)
      .set(BRANCH_HEADER, scene.north)
      .send({
        firstName: 'Dilnoza',
        lastName: `Resetova${'x'.repeat(count)}`,
        fatherName: '',
        sex: 'female',
        birthDate: '1990-03-04',
        educationLevel: 'master',
        phone: '+998931234560',
        email: '',
        jshshir: '',
        admissionDate: '2026-09-01',
        contractType: 'full_time',
        contractDate: '2026-09-01',
        weeklyLessons: 18,
        dailyLessons: 5,
        divisions: [
          {
            divisionId: await division('divisions', 'Academic'),
            departmentId: await division('departments', 'STEAM'),
            main: true,
          },
        ],
      });
    expect(staff.status, JSON.stringify(staff.body)).toBe(201);
    const staffId = staffDetailSchema.parse(staff.body).id;
    const account = await scene.kit
      .post(`/api/people/staff/${staffId}/account`, scene.admin)
      .set(BRANCH_HEADER, scene.north)
      .send({ login: `d.resetova${'x'.repeat(count)}` });
    expect(account.status, JSON.stringify(account.body)).toBe(201);
    const reset = { name: RESET, args: { id: staffId, summary: 'Reset the password.' } };
    // Off at the start (`02`, Switches: accounts … password resets).
    await asked([reset]);
    expect(results()).toEqual([{ error: 'action_off' }]);
    expect(
      (await setSwitches([{ role: 'super_admin', area: 'account_access', on: true }])).status,
    ).toBe(200);
    const conversation = await asked([reset]);
    const proposal = conversation.proposals.at(-1);
    expect(proposal?.steps).toHaveLength(1);
    const lines: string[] = [];
    ShippingLogger.sink = (_level, text) => {
      lines.push(text);
    };
    let password: string;
    try {
      const confirmed = await confirm(proposal?.id ?? '');
      expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 400)).toBe(200);
      const answer_ = assistantConfirmedSchema.parse(confirmed.body);
      expect(answer_.proposals.at(-1)?.steps.map((step) => step.state)).toEqual(['done']);
      const item = answer_.secrets[0]?.items[0];
      password = typeof item?.password === 'string' ? item.password : '';
      expect(password.length).toBeGreaterThanOrEqual(10);
      expect(item?.login).toBe(`d.resetova${'x'.repeat(count)}`);
    } finally {
      ShippingLogger.sink = undefined;
    }
    // Nowhere else: the log lines, the stored conversation, its steps, the audit log, the model.
    expect(lines.join('\n')).not.toContain(password);
    const stored = JSON.stringify(
      (
        await sql`
          select (select json_agg(m) from assistant_messages m) as messages,
                 (select json_agg(p) from assistant_proposals p) as proposals,
                 (select json_agg(s) from assistant_proposal_steps s) as steps,
                 (select json_agg(a) from audit_log a) as audit,
                 (select json_agg(a) from audit_log_school a) as school,
                 (select json_agg(k) from request_keys k) as keys
        `.execute(scene.database.migrator)
      ).rows,
    );
    expect(stored).not.toContain(password);
    const again = await request(server())
      .get(`/api/assistant/conversations/${conversation.id}`)
      .set('Cookie', scene.admin)
      .set(BRANCH_HEADER, scene.north);
    expect(again.status).toBe(200);
    expect(JSON.stringify(again.body)).not.toContain(password);
    // The next question of the conversation gives the model the history, never the password.
    await asked([], conversation.id);
    expect(JSON.stringify(scene.model.requests)).not.toContain(password);
    await setSwitches([{ role: 'super_admin', area: 'account_access', on: false }]);
  });

  // Permission review 1: a school-wide change (`{ branch: 'none' }`) runs at Confirm, and the
  // key's secret is shown once, in the answer of Confirm only.
  it('creates an integration key, a school-wide change, at Confirm and shows its secret once', async () => {
    const person = await scene.people.person(scene.north, ['uz'], {
      first: 'Malika',
      last: 'Keyova',
    });
    await scene.kit.giveRole(person.accountId, { role: 'teacher', branchId: scene.north });
    expect(
      (await setSwitches([{ role: 'super_admin', area: 'integration_keys', on: true }])).status,
    ).toBe(200);
    const conversation = await asked([
      {
        name: propose('POST /api/integration-keys'),
        args: {
          body: {
            name: 'Library platform',
            staffRecordIds: [person.staffId],
            endsOn: '2027-06-01',
          },
          summary: 'Create the key.',
        },
      },
    ]);
    const proposal = conversation.proposals.at(-1);
    expect(proposal?.steps, JSON.stringify(results())).toHaveLength(1);
    const confirmed = await confirm(proposal?.id ?? '');
    expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 400)).toBe(200);
    const answer_ = assistantConfirmedSchema.parse(confirmed.body);
    expect(answer_.proposals.at(-1)?.steps.map((step) => [step.state, step.code])).toEqual([
      ['done', null],
    ]);
    const secret = answer_.secrets[0]?.items[0]?.secret;
    expect(typeof secret === 'string' && secret.length > 20).toBe(true);
    const stored = JSON.stringify(
      (
        await sql`
          select (select json_agg(m) from assistant_messages m) as messages,
                 (select json_agg(s) from assistant_proposal_steps s) as steps,
                 (select json_agg(a) from audit_log_school a) as school
        `.execute(scene.database.migrator)
      ).rows,
    );
    expect(stored).not.toContain(String(secret));
    expect(JSON.stringify(scene.model.requests)).not.toContain(String(secret));
    await setSwitches([{ role: 'super_admin', area: 'integration_keys', on: false }]);
  });

  // `edge/people-roles-accounts`, "How do we move a student to another branch?": "Where the
  // person's role can do it and the action is switched on, it offers to do it" (its switch).
  it('finds the branch move only while it is switched on, and declares it from the next call', async () => {
    await asked([{ name: 'find_actions', args: { words: 'move a student to another branch' } }]);
    expect(JSON.stringify(results())).toContain(BRANCH_MOVE);
    // Declared in the call after the search.
    expect((scene.model.requests.at(-1)?.tools ?? []).map((tool) => tool.name)).toContain(
      BRANCH_MOVE,
    );
    expect((scene.model.requests.at(-2)?.tools ?? []).map((tool) => tool.name)).not.toContain(
      BRANCH_MOVE,
    );
    await setSwitches([
      {
        role: 'super_admin',
        area: 'branch_moves',
        route: 'POST /api/people/students/:id/branch-move',
        on: false,
      },
    ]);
    await asked([{ name: 'find_actions', args: { words: 'move a student to another branch' } }]);
    expect(JSON.stringify(results())).not.toContain(BRANCH_MOVE);
    expect((scene.model.requests.at(-1)?.tools ?? []).map((tool) => tool.name)).not.toContain(
      BRANCH_MOVE,
    );
    await setSwitches([
      {
        role: 'super_admin',
        area: 'branch_moves',
        route: 'POST /api/people/students/:id/branch-move',
        on: true,
      },
    ]);
  });

  // Plan test 7 (code review 4f): the declarations of a question.
  it('declares the actions of the page open, finds actions by words of the three languages, and declares at most 64', async () => {
    const GROUP_ARCHIVE = propose('POST /api/groups/:id/archive');
    scene.model.script(answer('Here.'));
    const fromPage = await ask(scene, scene.admin, scene.north, {
      text: 'What can I do here?',
      place: { page: '/groups', params: {}, search: {} },
    });
    expect(fromPage.status).toBe(202);
    expect((scene.model.requests.at(-1)?.tools ?? []).map((tool) => tool.name)).toContain(
      GROUP_ARCHIVE,
    );
    for (const words of ['Группы', 'Guruhlar', 'groups']) {
      await asked([{ name: 'find_actions', args: { words } }]);
      expect(JSON.stringify(results()), words).toContain('GroupsController');
    }
    // The cap and its order, over every action of the Super Admin's list.
    const lines = scene.app.get(AssistantRoutes).linesOf('super_admin');
    const all = Object.keys(lines);
    const declared = declaredActions(lines, OPEN_FILTER, {
      found: all.slice(0, 100),
      used: [all[150] ?? ''],
      page: [all[151] ?? ''],
    });
    expect(declared).toHaveLength(MAX_DECLARED_ACTIONS);
    expect(MAX_DECLARED_ACTIONS).toBe(64);
    // The newest found first; the earlier proposals' and the page's after the found ones.
    const names = declared.map((tool) => tool.name);
    const lastFound =
      all
        .slice(0, 100)
        .reverse()
        .find((route) => toolOf(route, lines[route] as never, OPEN_FILTER) !== undefined) ?? '';
    expect(names[0]).toBe(toolOf(lastFound, lines[lastFound] as never, OPEN_FILTER)?.name);
    const few = declaredActions(lines, OPEN_FILTER, {
      found: [],
      used: [all[150] ?? ''],
      page: [all[151] ?? ''],
    });
    expect(few.length).toBeLessThanOrEqual(2);
  });

  // `.claude/rules/api.md`: a loop that calls a paid outside service bounds its calls, every
  // kind of turn counted (plan review 7): a model that searches the actions forever.
  it('ends a question whose model calls find_actions forever at the bound of model calls', async () => {
    const before = scene.model.requests.length;
    const forever = Array.from({ length: MAX_MODEL_CALLS + 4 }, () =>
      calls({ name: 'find_actions', args: { words: 'rooms' } }),
    );
    scene.model.script(...forever, answer('Done.'));
    const response = await ask(scene, scene.admin, scene.north, { text: 'Search forever.' });
    expect(response.status).toBe(202);
    expect(scene.model.requests.length - before).toBe(MAX_MODEL_CALLS);
  });

  it('audits a change of the personal-data groups as a setting', async () => {
    const settings = await request(server())
      .get('/api/setup/school-settings/assistant')
      .set('Cookie', scene.admin);
    const body = settings.body as Record<string, unknown>;
    const record = {
      schoolOn: body.schoolOn,
      rolesOn: body.rolesOn,
      dailyLimit: body.dailyLimit,
      monthlyCapDollars: body.monthlyCapDollars,
      questionActions: body.questionActions,
      proposalSteps: body.proposalSteps,
      questionMinutes: body.questionMinutes,
      fallbackOn: body.fallbackOn,
      dataGroupsOn: ['contact', 'identity', 'financial', 'diagnostic', 'relatives'],
    };
    const saved = await request(server())
      .put('/api/setup/school-settings/assistant')
      .set('Cookie', scene.admin)
      .send(record);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((saved.body as { dataGroupsOn: string[] }).dataGroupsOn).not.toContain('medical');
    const entry = await scene.database.migrator
      .selectFrom('audit_log_school')
      .select(['old_value', 'new_value'])
      .where('action', '=', 'assistant_settings.change')
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(entry.new_value).toMatchObject({ dataGroupsOn: record.dataGroupsOn });
    expect(entry.old_value).toMatchObject({
      dataGroupsOn: expect.arrayContaining(['medical']) as unknown,
    });
  });
});
