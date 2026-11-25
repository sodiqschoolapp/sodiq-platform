import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assistantAnswerSchema, assistantMessageSchema, type AssistantAnswer } from '@sodiq/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { answer, calls, lastResults } from '../../testing/assistant-model.js';
import { ask, assistantScene, send, type AssistantScene } from '../../testing/assistant-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { MAX_MODEL_CALLS } from './assistant.engine.js';
import { messageOf } from './conversations.store.js';
import type { ModelRequest } from './model.js';
import {
  explainPlace,
  findInPlatform,
  linkOf,
  PLATFORM_MAP,
  placeOf,
  placeText,
} from './platform-map.js';
import { toolsOf } from './tools.js';

// Task 11.19 (`02`, Assistant, "Knows the platform", "Knows where the person is";
// `edge/people-roles-accounts`, The assistant: "What does the button at the top right of the
// journal do?", "How do we move a student to another branch?", "A person asks the assistant to
// do what their role cannot do"). The map's three tools, the place of a question, and links to
// the exact place. All names are invented.

const STUDENT_DETAIL = 'StudentsController_detail';
const CHANGE_BRANCHES = 'features/people/staff-panel.tsx#button:people.staff.changeBranches';
const JOURNAL = '/journal/$journalId';
const ID = '0190a000-0000-7000-8000-000000000001';

function answered(response: { status: number; body: unknown }): AssistantAnswer {
  expect(response.status, JSON.stringify(response.body).slice(0, 800)).toBe(202);
  return assistantAnswerSchema.parse(response.body);
}

/** The text of the person's turns of a request. */
function personText(request: ModelRequest | undefined): string[] {
  return (request?.turns ?? [])
    .filter((turn) => turn.role === 'person')
    .flatMap((turn) => turn.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])));
}

describe('the map of the platform', () => {
  it('is loaded from the generated file the API build carries (review correction 6)', () => {
    // The map is a `.ts` module under `src`, imported by `platform-map.ts`: `nest build`
    // (`tsconfig.build.json`) compiles it into `dist` with the engine; a `.json` would not be.
    const build = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, '../../../tsconfig.build.json'), 'utf8'),
    ) as { include: string[]; exclude: string[] };
    expect(build.include).toEqual(['src']);
    expect(
      build.exclude.some((one) =>
        'platform-map.generated.ts'.endsWith(one.replace('src/**/*', '')),
      ),
    ).toBe(false);
    const source = readFileSync(path.resolve(import.meta.dirname, 'platform-map.ts'), 'utf8');
    expect(source).toContain("from './platform-map.generated.js'");
    expect(PLATFORM_MAP.pages.length).toBeGreaterThan(70);
    expect(PLATFORM_MAP.nodes.length).toBeGreaterThan(1000);
  });

  it('finds the same control by its name in Uzbek Latin, Uzbek Cyrillic, Russian and English', () => {
    for (const words of [
      'Filiallarni oʻzgartirish',
      'Филиалларни ўзгартириш',
      'Изменить филиалы',
      'Change branches',
    ]) {
      const found = findInPlatform('super_admin', words, 'en') as { hits: Array<{ id: string }> };
      expect(
        found.hits.map((hit) => hit.id),
        words,
      ).toContain(CHANGE_BRANCHES);
    }
  });

  it('answers with the label in the person’s language, the roles that see it and where it is', () => {
    const found = findInPlatform('teacher', 'Change branches', 'ru') as {
      hits: Array<{ id: string; label: string; rolesThatSeeIt: string[]; youSeeIt: boolean }>;
    };
    const hit = found.hits.find((one) => one.id === CHANGE_BRANCHES);
    expect(hit?.label).toBe('Изменить филиалы');
    expect(hit?.youSeeIt).toBe(false);
    expect(hit?.rolesThatSeeIt).toContain('super_admin');
    expect(hit?.rolesThatSeeIt).not.toContain('teacher');
  });

  it('explains a page with what is on it, and a control with where it is', () => {
    const page = explainPlace('super_admin', '/people/students', 'en') as {
      kind: string;
      contains: Array<{ id: string }>;
    };
    expect(page.kind).toBe('page');
    expect(page.contains.length).toBeGreaterThan(0);
    const control = explainPlace('super_admin', CHANGE_BRANCHES, 'uz') as {
      label: string;
      on: Array<{ page: string }>;
    };
    expect(control.label).toBe('Filiallarni oʻzgartirish');
    expect(control.on.map((one) => one.page)).toContain('/people/staff');
    expect(explainPlace('super_admin', 'nowhere', 'en')).toEqual({ error: 'not_in_map' });
  });

  it('links only a page the role opens, with every path parameter and only search keys of its kinds', () => {
    expect(
      linkOf('teacher', { page: JOURNAL, params: [{ name: 'journalId', value: ID }] }),
    ).toEqual({
      link: {
        nodeId: `page:${JOURNAL}`,
        to: JOURNAL,
        params: { journalId: ID },
        search: {},
        label: PLATFORM_MAP.pages.find((page) => page.path === JOURNAL)?.title,
      },
    });
    // A missing path parameter, one that is not an id, a key the page does not take, a value
    // outside its set, a page the role does not open, and the Assistant page.
    expect(linkOf('teacher', { page: JOURNAL })).toEqual({ error: 'not_a_place_value' });
    expect(
      linkOf('teacher', { page: JOURNAL, params: [{ name: 'journalId', value: '1' }] }),
    ).toEqual({
      error: 'not_a_place_value',
    });
    expect(
      linkOf('teacher', {
        page: JOURNAL,
        params: [{ name: 'journalId', value: ID }],
        search: [{ name: 'colour', value: 'red' }],
      }),
    ).toEqual({ error: 'not_a_place_value' });
    expect(
      linkOf('super_admin', { page: '/journal', search: [{ name: 'tab', value: 'other' }] }),
    ).toEqual({
      error: 'not_a_place_value',
    });
    expect(linkOf('teacher', { page: '/setup/branches' })).toEqual({ error: 'not_a_page' });
    expect(linkOf('super_admin', { page: '/assistant' })).toEqual({ error: 'not_a_page' });
    // A filter of a list as `f.<key>`.
    const filtered = linkOf('super_admin', {
      page: '/people/students',
      search: [
        { name: 'open', value: ID },
        { name: 'f.status', value: 'active' },
      ],
    });
    expect('link' in filtered ? filtered.link.search : null).toEqual({
      open: ID,
      f: { status: 'active' },
    });
    // A class of the list by its id, or "No class" (review of #386, must fix 1).
    for (const value of [ID, 'none']) {
      expect(
        'link' in
          linkOf('super_admin', {
            page: '/people/students',
            search: [{ name: 'f.class', value }],
          }),
      ).toBe(true);
    }
    // A filter key the list does not have, or a value its options do not offer, would open the
    // list unfiltered: refused (review of #386, must fix 1).
    for (const pair of [
      { name: 'f.colour', value: 'red' },
      { name: 'f.status', value: 'nonsense' },
      { name: 'f.grade', value: '99' },
      { name: 'f.class', value: 'not-an-id' },
    ]) {
      expect(linkOf('super_admin', { page: '/people/students', search: [pair] })).toEqual({
        error: 'not_a_place_value',
      });
    }
    // A list page with no filter of its own takes none.
    expect(
      linkOf('super_admin', { page: '/audit', search: [{ name: 'f.status', value: 'active' }] }),
    ).toEqual({ error: 'not_a_place_value' });
  });

  it('names in a link only a control the role sees; for another, the page (review should fix 7)', () => {
    const add = 'features/setup/rooms-page.tsx#button:setup.rooms.add';
    const rooms = PLATFORM_MAP.pages.find((page) => page.path === '/setup/rooms');
    const vice = linkOf('academic_vice_principal', { page: '/setup/rooms', node: add });
    expect('link' in vice ? [vice.link.nodeId, vice.link.label] : null).toEqual([
      'page:/setup/rooms',
      rooms?.title,
    ]);
    const admin = linkOf('super_admin', { page: '/setup/rooms', node: add });
    expect('link' in admin ? admin.link.nodeId : null).toBe(add);
  });

  it('keeps of a place only what the map records for the page, its free texts filtered (correction 2)', () => {
    expect(
      placeOf('super_admin', {
        page: '/journal',
        search: { tab: 'other', q: 'Call +998 90 123 45 67', open: 'not-an-id', year: ID },
      }),
    ).toEqual({ page: '/journal', params: {}, search: { q: 'Call [removed]', year: ID } });
    // A filter key the list does not have and a value it does not offer are dropped, each
    // alone (review of #386, must fix 1).
    expect(
      placeOf('super_admin', {
        page: '/people/students',
        search: { f: { status: 'active', colour: 'red', grade: '99' } },
      }),
    ).toEqual({ page: '/people/students', params: {}, search: { f: { status: 'active' } } });
    expect(
      placeOf('super_admin', {
        page: '/people/students',
        search: { f: { status: 'nonsense' } },
      }),
    ).toEqual({ page: '/people/students', params: {}, search: {} });
    expect(placeOf('super_admin', { page: '/no-such-page' })).toBeUndefined();
    expect(placeOf('teacher', { page: '/setup/branches' })).toBeUndefined();
    expect(
      placeOf('teacher', {
        page: JOURNAL,
        params: { journalId: ID, other: ID },
        search: { mode: 'lesson', date: '2026-10-05' },
      }),
    ).toEqual({
      page: JOURNAL,
      params: { journalId: ID },
      search: { mode: 'lesson', date: '2026-10-05' },
    });
  });

  it('tells the newest place as where the person is now, an earlier one as where that question was asked', () => {
    const place = { page: '/people/students', params: {}, search: { open: ID } };
    expect(placeText(place, 'en', true)).toMatch(/^\[Where the person is now/);
    expect(placeText(place, 'en', true)).toContain(
      `the record with id ${ID} is open in the side panel`,
    );
    expect(placeText(place, 'en', false)).toMatch(/^\[That question was asked from/);
  });

  it('reads an answer stored before 11.19, with no links, as one with none', () => {
    const message = messageOf({
      id: ID,
      seq: 2,
      createdAt: new Date('2026-11-20T09:00:00Z'),
      content: { kind: 'answer', text: 'Old.', pages: ['people'] },
    });
    expect(assistantMessageSchema.parse(message)).toMatchObject({
      pages: ['people'],
      links: [],
      lessons: [],
    });
  });

  it('gives the map’s three tools to every assistant role, after the role’s own', () => {
    for (const lines of [{}]) {
      expect(toolsOf(lines).map((tool) => tool.name)).toEqual([
        'find_in_platform',
        'explain_place',
        'link_place',
      ]);
    }
  });
});

describe('the assistant: where the person is, and the map in a question', () => {
  let scene: AssistantScene;
  let northStudent: string;
  let southStudent: string;
  let vice: string;
  let teacher: string;

  beforeAll(async () => {
    scene = await assistantScene();
    const members = new MembersKit(scene.database.migrator, scene.adminAccount);
    northStudent = await members.student(scene.north);
    southStudent = await members.student(scene.south);
    // Permission review, should fix 5: the two roles held in one branch.
    const viceSession = await scene.kit.completeSession('Gulnora', 'Viceova');
    await scene.kit.giveRole(viceSession.account.id, {
      role: 'academic_vice_principal',
      branchId: scene.north,
    });
    vice = viceSession.cookie;
    const teacherSession = await scene.kit.completeSession('Sardor', 'Teacherov');
    await scene.kit.giveRole(teacherSession.account.id, { role: 'teacher', branchId: scene.north });
    teacher = teacherSession.cookie;
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ school_on: true, roles_on: ['super_admin', 'academic_vice_principal', 'teacher'] })
      .execute();
  }, 120_000);

  afterAll(async () => {
    await scene.close();
  });

  beforeEach(() => {
    scene.model.requests.length = 0;
    scene.model.script();
  });

  it('resolves "this student" from the panel open: the place reaches the model and its read is answered', async () => {
    scene.model.script(
      calls({ name: STUDENT_DETAIL, args: { id: northStudent } }),
      answer('This student is in 7B.'),
    );
    const reply = answered(
      await ask(scene, scene.admin, scene.north, {
        text: 'Which class is this student in?',
        place: { page: '/people/students', search: { open: northStudent } },
      }),
    );
    const [first] = scene.model.requests;
    expect(personText(first).at(-1)).toContain(
      `the record with id ${northStudent} is open in the side panel`,
    );
    const [result] = lastResults(scene.model.requests[1] as ModelRequest);
    expect((result?.result as { status: number }).status).toBe(200);
    expect(reply.conversation.messages.at(-1)?.kind).toBe('answer');
  });

  it('reads another branch’s student of a place with the screen’s refusal', async () => {
    scene.model.script(
      calls({ name: STUDENT_DETAIL, args: { id: southStudent } }),
      answer('That record is not open to you.'),
    );
    answered(
      await ask(scene, scene.admin, scene.north, {
        text: 'Which class is this student in?',
        place: { page: '/people/students', search: { open: southStudent } },
      }),
    );
    const [result] = lastResults(scene.model.requests[1] as ModelRequest);
    expect(result?.result).toEqual({ status: 404, error: 'not_found' });
  });

  it('reads another branch’s student of a place with the screen’s refusal, as the Academic Vice Principal of one branch (permission review, should fix 5)', async () => {
    scene.model.script(
      calls({ name: STUDENT_DETAIL, args: { id: southStudent } }),
      answer('That record is not open to you.'),
    );
    answered(
      await ask(scene, vice, scene.north, {
        role: 'academic_vice_principal',
        text: 'Which class is this student in?',
        place: { page: '/people/students', search: { open: southStudent } },
      }),
    );
    const [result] = lastResults(scene.model.requests[1] as ModelRequest);
    expect(result?.result).toEqual({ status: 404, error: 'not_found' });
  });

  it('refuses a Teacher the journal a place names when it is not the Teacher’s own (permission review, should fix 5)', async () => {
    scene.model.script(
      calls({ name: 'JournalsController_grid', args: { journalId: ID } }),
      answer('That journal is not open to you.'),
    );
    answered(
      await ask(scene, teacher, scene.north, {
        role: 'teacher',
        text: 'Who is absent in this journal?',
        place: { page: JOURNAL, params: { journalId: ID } },
      }),
    );
    expect(personText(scene.model.requests[0]).at(-1)).toContain(`journalId = ${ID}`);
    const [result] = lastResults(scene.model.requests[1] as ModelRequest);
    const given = result?.result as { status?: number; error?: string; data?: unknown };
    expect(given.data).toBeUndefined();
    expect(given.status ?? 0).toBeGreaterThanOrEqual(400);
  });

  it('links nothing for a Teacher who asks for a page the Teacher does not open (permission review, should fix 6)', async () => {
    scene.model.script(
      calls({ name: 'link_place', args: { page: '/setup/branches' } }),
      answer('That page is not open to you.'),
    );
    const reply = answered(
      await ask(scene, teacher, scene.north, { role: 'teacher', text: 'Open the branches.' }),
    );
    expect(lastResults(scene.model.requests[1] as ModelRequest).map((one) => one.result)).toEqual([
      { error: 'not_a_page' },
    ]);
    const last = reply.conversation.messages.at(-1);
    expect(last?.kind === 'answer' ? last.links : null).toEqual([]);
  });

  it('knows which journal and which lesson are open (`edge`, "it knows which journal is meant")', async () => {
    scene.model.script(answer('That button opens lesson mode.'));
    answered(
      await ask(scene, scene.admin, scene.north, {
        text: 'What does the button at the top right of the journal do?',
        place: {
          page: JOURNAL,
          params: { journalId: ID },
          search: { mode: 'lesson', date: '2026-10-05' },
        },
      }),
    );
    const text = personText(scene.model.requests[0]).at(-1) ?? '';
    expect(text).toContain(`journalId = ${ID}`);
    expect(text).toContain('mode = lesson');
    expect(text).toContain('date = 2026-10-05');
  });

  it('leaves out a page the map does not know, and refuses a place with a key of no use (strict)', async () => {
    scene.model.script(answer('Here.'));
    answered(
      await ask(scene, scene.admin, scene.north, {
        text: 'Where am I?',
        place: { page: '/an-older-page' },
      }),
    );
    expect(personText(scene.model.requests[0]).at(-1)).toBe('Where am I?');
    const refused = await send(scene, scene.admin, scene.north, {
      text: 'Where am I?',
      place: { page: '/people/students', record: ID },
    });
    expect(refused.status).toBe(400);
  });

  it('drops through the route a tab outside the page’s values and an open that is not an id (review should fix 9)', async () => {
    scene.model.script(answer('Here.'));
    answered(
      await ask(scene, scene.admin, scene.north, {
        text: 'What is on this page?',
        place: { page: '/journal', search: { tab: 'other', open: 'not-an-id', year: ID } },
      }),
    );
    const text = personText(scene.model.requests[0]).at(-1) ?? '';
    expect(text).toContain(`year = ${ID}`);
    expect(text).not.toContain('tab =');
    expect(text).not.toContain('not-an-id');
  });

  it('filters a free text of the place as the person’s words (correction 2)', async () => {
    scene.model.script(answer('Here.'));
    answered(
      await ask(scene, scene.admin, scene.north, {
        text: 'Who is this?',
        place: { page: '/people/students', search: { q: '+998 90 123 45 67' } },
      }),
    );
    const seen = JSON.stringify(scene.model.requests[0]?.turns ?? []);
    expect(seen).toContain('q = [removed]');
    expect(seen).not.toContain('123 45 67');
  });

  it('gives an earlier question’s place as where it was asked, the newest as where the person is (correction 5)', async () => {
    scene.model.script(answer('First.'));
    const first = answered(
      await ask(scene, scene.admin, scene.north, {
        text: 'What is this student’s class?',
        place: { page: '/people/students', search: { open: northStudent } },
      }),
    );
    scene.model.requests.length = 0;
    scene.model.script(answer('Second.'));
    answered(
      await ask(scene, scene.admin, scene.north, {
        text: 'And this one?',
        conversationId: first.conversation.id,
        place: { page: '/classes' },
      }),
    );
    const texts = personText(scene.model.requests[0]);
    expect(texts.at(0)).toContain('[That question was asked from');
    expect(texts.at(0)).toContain(northStudent);
    expect(texts.at(-1)).toContain('[Where the person is now');
    expect(texts.at(-1)).not.toContain(northStudent);
  });

  it(`stops a model that searches the map forever at ${String(MAX_MODEL_CALLS)} calls, with no read of the platform (plan decision 5)`, async () => {
    scene.model.script(
      ...Array.from({ length: MAX_MODEL_CALLS + 3 }, () =>
        calls({ name: 'find_in_platform', args: { words: 'branches' } }),
      ),
    );
    const reply = answered(await ask(scene, scene.admin, scene.north, { text: 'Search, again.' }));
    expect(scene.model.requests).toHaveLength(MAX_MODEL_CALLS);
    expect(scene.model.requests.at(-1)?.tools).toEqual([]);
    expect(reply.conversation.messages.filter((message) => message.kind === 'read')).toEqual([]);
  });

  it('stores the links of an answer, and the map’s answer reaches the model', async () => {
    scene.model.script(
      calls(
        { name: 'find_in_platform', args: { words: 'Change branches' } },
        { name: 'link_place', args: { page: '/people/staff' } },
      ),
      answer('1. Open Staff. 2. Open the teacher. 3. Press Change branches.'),
    );
    const reply = answered(
      await ask(scene, scene.admin, scene.north, {
        text: 'How do we change a teacher’s branches?',
      }),
    );
    const results = lastResults(scene.model.requests[1] as ModelRequest);
    expect(JSON.stringify(results[0]?.result)).toContain(CHANGE_BRANCHES);
    expect(results[1]?.result).toEqual({ linked: '/people/staff' });
    const last = reply.conversation.messages.at(-1);
    expect(last?.kind === 'answer' ? last.links.map((link) => link.to) : null).toEqual([
      '/people/staff',
    ]);
  });
});
