import { randomUUID } from 'node:crypto';
import {
  assistantConversationSchema,
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  planItemSchema,
  type AssistantConversation,
  type AssistantMessage,
  type PlanItem,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answer, calls, FakeModel, lastResults } from '../../testing/assistant-model.js';
import { setEditDays } from '../../testing/branch-filter-sql.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { openPlanWindows } from '../../testing/plan-windows-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { OPEN_LESSON_JOURNAL } from './tools.js';
import { GENERATED_TOOLS } from './tools.generated.js';
import { settle } from '../../testing/assistant-kit.js';

// Task 11.14 (pull request #377). `02`, Assistant, "What a Teacher can do through it": "Read their
// own timetable, their classes and groups, their journals and the results calculated by the
// platform, their lesson plans and requests. Draft lesson plan items (topic, works, homework) and
// send unlock and plan edit requests, each as a proposal to confirm." Build plan 11.14, Done
// when: "refusals for 'mark everyone present'; a Teacher reads only own lessons and students, and
// the drafted plan item is saved only on Confirm, in the plan window's rules".
// `edge/people-roles-accounts`, The assistant: "A Teacher asks the assistant to mark everyone
// present. Refused: journal data is never entered through the assistant. It opens the lesson's
// journal column." All names are invented.

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const tool = (route: string): string => {
  const name = GENERATED_TOOLS[route]?.name;
  if (name === undefined) throw new Error(`${route} has no tool`);
  return name;
};
const propose = (route: string): string => `propose_${tool(route)}`.slice(0, 64);

const ITEM_CREATE = propose('POST /api/plans/journals/:journalId/items');
const ITEM_SAVE = propose('PUT /api/plans/items/:itemId');
const UNLOCK = propose('POST /api/journal/lessons/:lessonId/unlocks');
const PLAN_REQUEST = propose('POST /api/plans/journals/:journalId/requests');
const PREPARED_SEND = propose('POST /api/plans/requests/:requestId/send');
const JOURNAL_READ = tool('GET /api/journal/journals/:journalId');
const PLAN_READ = tool('GET /api/plans/journals/:journalId');
const PLAN_LESSON_READ = tool('GET /api/plans/lessons/:lessonId');
const PLAN_LIST = tool('GET /api/plans');
const CARD_READ = tool('GET /api/journal/lessons/:lessonId/card');
const TEACHER_VIEW = tool('GET /api/timetable/views/teacher');
const STUDENTS_READ = tool('GET /api/people/students');
const ATTENDANCE = propose('POST /api/journal/lessons/:lessonId/attendance');

const values = (change: Record<string, unknown> = {}) => ({
  topic: 'Fractions',
  objectives: '',
  links: [],
  classworks: [],
  homeworks: [],
  ...change,
});

describe('the assistant for teachers (task 11.14)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  const model = new FakeModel();
  let scene: PublishedScene;
  let owner: { cookie: string; account: { id: string } };
  let journal: string;
  let otherJournal: string;
  let q1: string;
  /** The class's lessons of the first quarter (the Mondays 12, 19, 26 October), and the other class's. */
  let lessons: string[];
  let otherLessons: string[];
  let q2: string;
  /** The class's lessons of the second quarter (the eight Mondays of 9 November to 28 December). */
  let q2Lessons: string[];
  /** Another branch's journal, quarter and lesson. */
  let away: { branch: string; journal: string; quarter: string; lesson: string };

  const server = () => t.kit.server;

  /** Moves the clock and keeps the sessions fresh (`plans.test.ts`, `as`). */
  async function at(moment: string): Promise<void> {
    t.clock.set(moment);
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
      .execute();
  }

  const lessonsOf = async (classId: string) =>
    (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', classId)
        .where('subject_id', '=', scene.subject)
        .where('lesson_date', '>=', '2026-09-01')
        .where('lesson_date', '<=', '2026-10-31')
        .where('cancel_cause', 'is', null)
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);

  const journalOf = async (classId: string) =>
    (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', classId)
        .executeTakeFirstOrThrow()
    ).id;

  /** Asks as the Teacher with a model that makes these calls, and answers the conversation. */
  async function asked(
    wanted: { name: string; args?: Record<string, unknown> }[],
    cookie = owner.cookie,
  ): Promise<AssistantConversation> {
    model.script(calls(...wanted), answer('Here it is.'));
    const response = await request(server())
      .post('/api/assistant/questions')
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, scene.branch)
      .send({ role: 'teacher', text: 'Please.' });
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(202);
    await settle(t.app, response, cookie, scene.branch);
    return assistantConversationSchema.parse(
      (response.body as { conversation: unknown }).conversation,
    );
  }

  const confirm = (id: string, cookie = owner.cookie) =>
    request(server())
      .post(`/api/assistant/proposals/${id}/confirm`)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, scene.branch)
      .send({ role: 'teacher' });

  /** The proposal of the conversation's last answer: its id and each step's state and code. */
  function proposalOf(conversation: AssistantConversation) {
    const proposal = conversation.proposals.at(-1);
    return {
      id: proposal?.id ?? '',
      steps: proposal?.steps.map((step) => [step.state, step.code]) ?? [],
    };
  }

  const stepsAfter = async (id: string, cookie = owner.cookie) => {
    const response = await confirm(id, cookie);
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
    return proposalOf(assistantConversationSchema.parse(response.body)).steps;
  };

  /** What the model was given back for each call of the last question. */
  const results = (): unknown[] =>
    lastResults(model.requests.at(-1) ?? { system: '', turns: [], tools: [] }).map(
      (one) => one.result,
    );

  /** The reads of the conversation's last question, by status. */
  const readStatuses = (conversation: AssistantConversation): number[] =>
    conversation.messages
      .filter(
        (message): message is Extract<AssistantMessage, { kind: 'read' }> =>
          message.kind === 'read',
      )
      .map((message) => message.status);

  /** Every row of the plan, journal and request tables, in every branch, and the audit log. */
  const everyRow = async () => {
    const rows: Record<string, unknown[]> = {};
    for (const table of [
      'lesson_plan_items',
      'lesson_plan_works',
      'lesson_plan_requests',
      'journal_cells',
      'journal_unlocks',
      'audit_log',
    ] as const) {
      rows[table] = await t.database.migrator.selectFrom(table).selectAll().orderBy('id').execute();
    }
    return rows;
  };

  const planItem = async (itemId: string) =>
    t.database.migrator
      .selectFrom('lesson_plan_items')
      .select(['topic', 'objectives'])
      .where('id', '=', itemId)
      .executeTakeFirst();

  /** An item written through the plan's own route, as the owner on the screen. */
  async function screenItem(position: number, topic: string, cookie = owner.cookie) {
    const response = await request(server())
      .post(`/api/plans/journals/${journal}/items`)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, scene.branch)
      .send({
        quarterId: q1,
        position,
        lessonId: lessons[position - 1],
        values: values({ topic }),
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return planItemSchema.parse(response.body);
  }

  const baseOf = (item: PlanItem) => ({
    topic: item.topic,
    objectives: item.objectives,
    links: item.links,
    classworks: item.classworks,
    homeworks: item.homeworks,
  });

  beforeAll(async () => {
    t = await dayTemplatesKit({ assistantModel: model, listen: true, jobs: true });
    load = new LoadKit(t.database.migrator);
    owner = await t.kit.completeSession('Sevara', 'Olimova');
    scene = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id },
    });
    await t.kit.giveRole(owner.account.id, {
      role: 'teacher',
      branchId: scene.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    await openPlanWindows(t.database.migrator, scene.branch, scene.year);
    // The school's 7 edit days (test branches start with every lesson open): the Mondays 12 and
    // 19 October are locked on 27 October (`00-definitions`, Lock moment).
    await setEditDays(t.database.migrator, scene.branch, 7);
    journal = await journalOf(scene.classId);
    otherJournal = await journalOf(scene.otherClass);
    q1 = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', scene.year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    lessons = await lessonsOf(scene.classId);
    otherLessons = await lessonsOf(scene.otherClass);
    expect(lessons.length).toBe(3);
    await t.database.migrator
      .updateTable('assistant_settings')
      .set({ school_on: true, roles_on: ['super_admin', 'academic_vice_principal', 'teacher'] })
      .execute();
    q2 = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', scene.year)
        .where('number', '=', 2)
        .executeTakeFirstOrThrow()
    ).id;
    q2Lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', scene.classId)
        .where('subject_id', '=', scene.subject)
        .where('lesson_date', '>=', '2026-11-09')
        .where('lesson_date', '<=', '2026-12-28')
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    expect(q2Lessons.length).toBe(8);
    await t.kit.giveRole(owner.account.id, {
      role: 'head_teacher',
      branchId: scene.branch,
      subjectIds: [scene.subject],
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    await load.tutorOf(scene.branch, scene.otherClass, owner.account.id);
    // Another branch with a published timetable of its own: its journal, quarter and a lesson.
    const awayScene = await publishedScene(t, load, { branch: await t.newBranch(), graded: true });
    const awayLesson = await t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('class_id', '=', awayScene.classId)
      .orderBy('starts_at')
      .executeTakeFirstOrThrow();
    away = {
      branch: awayScene.branch,
      journal: await journalOf(awayScene.classId),
      lesson: awayLesson.id,
      quarter: (
        await t.database.migrator
          .selectFrom('quarters')
          .select('id')
          .where('academic_year_id', '=', awayScene.year)
          .where('number', '=', 1)
          .executeTakeFirstOrThrow()
      ).id,
    };
    await at(MOMENT);
  });

  afterAll(async () => {
    t.clock.set(START);
    await t.close();
  });

  // Task 11.20, `edge/people-roles-accounts`, "A Teacher asks the assistant to mark everyone
  // present": "It reads the lesson's students and proposes 'present' for each, in one proposal. On
  // Confirm each entry is saved through the journal's own action, in its edit window and locks: a
  // locked or closed lesson is refused as on the screen, and the answer names it." (The 11.14
  // refusal gave way: plan decision 1, Look first.)
  it('proposes "mark everyone present" as one step of the journal’s bulk save naming each student, saves it at Confirm marked "via assistant", and refuses a locked lesson as the screen does', async () => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const pupils: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const student = await members.student(scene.branch);
      await members.member({
        branch: scene.branch,
        classId: scene.classId,
        studentId: student,
        from: '2026-09-01',
      });
      pupils.push(student);
    }
    const saves = pupils.map((studentId) => ({ studentId, mark: 1, version: null }));
    const cellsOf = (lessonId: string) =>
      t.database.migrator
        .selectFrom('journal_cells')
        .select(['student_id', 'mark'])
        .where('lesson_id', '=', lessonId)
        .where('work_id', 'is', null)
        .where('student_id', 'in', pupils)
        .execute();
    let conversation = await asked([
      {
        name: ATTENDANCE,
        args: { lessonId: lessons[2], body: { saves }, summary: 'Everyone present.' },
      },
    ]);
    const shown = conversation.proposals.at(-1);
    expect(shown, JSON.stringify(results())).toBeDefined();
    // One step, the entries grouped and each student named (build plan 11.20).
    expect(shown?.steps).toHaveLength(1);
    expect(shown?.steps[0]?.entries.map((entry) => entry.value)).toEqual(['present', 'present']);
    expect(shown?.steps[0]?.entries.every((entry) => entry.name !== null)).toBe(true);
    expect(await cellsOf(lessons[2] ?? '')).toEqual([]);
    expect(await stepsAfter(proposalOf(conversation).id)).toEqual([['done', null]]);
    expect((await cellsOf(lessons[2] ?? '')).length).toBe(2);
    const audited = await t.database.migrator
      .selectFrom('audit_log')
      .select(['assistant_step_id'])
      .where('assistant_step_id', '=', shown?.steps[0]?.id ?? '')
      .execute();
    expect(audited.length).toBeGreaterThan(0);
    // The Monday of 12 October is locked on 27 October: refused as on the screen, nothing saved.
    const before = await everyRow();
    conversation = await asked([
      {
        name: ATTENDANCE,
        args: { lessonId: lessons[0], body: { saves }, summary: 'Everyone present.' },
      },
    ]);
    const locked = proposalOf(conversation);
    expect(locked.steps).toEqual([['waiting', null]]);
    const outcome = await stepsAfter(locked.id);
    expect(outcome[0]?.[0]).toBe('refused');
    expect(outcome[0]?.[1]).toBe('journal_locked');
    expect(await cellsOf(lessons[0] ?? '')).toEqual([]);
    const after = await everyRow();
    expect(after.journal_cells).toEqual(before.journal_cells);
  });

  // Code review 4a, 4b and permission review 2: a cell saved by another person between the
  // proposal and Confirm makes the step outdated (the journal's own version refusal); a lesson
  // of a colleague names none of its students in the card; a route of another role is no tool.
  it('finds "mark everyone present" outdated when a cell was saved since, names nobody of a colleague’s lesson, and runs no route of another role', async () => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const pupil = await members.student(scene.branch);
    await members.member({
      branch: scene.branch,
      classId: scene.classId,
      studentId: pupil,
      from: '2026-09-01',
    });
    const saves = [{ studentId: pupil, mark: 1, version: null }];
    let conversation = await asked([
      { name: ATTENDANCE, args: { lessonId: lessons[2], body: { saves }, summary: 'Present.' } },
    ]);
    const waiting = proposalOf(conversation);
    expect(waiting.steps).toEqual([['waiting', null]]);
    // The same cell saved on the screen meanwhile.
    const screen = await request(server())
      .post(`/api/journal/lessons/${lessons[2] ?? ''}/attendance`)
      .set('Cookie', owner.cookie)
      .set(BRANCH_HEADER, scene.branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ saves: [{ studentId: pupil, mark: 0, version: null }] });
    expect(screen.status, JSON.stringify(screen.body)).toBe(200);
    expect((await stepsAfter(waiting.id))[0]?.[0]).toBe('outdated');
    const cell = await t.database.migrator
      .selectFrom('journal_cells')
      .select('mark')
      .where('lesson_id', '=', lessons[2] ?? '')
      .where('student_id', '=', pupil)
      .where('work_id', 'is', null)
      .executeTakeFirstOrThrow();
    expect(cell.mark).toBe(0);
    // A colleague's lesson: the step may be drafted, but no student of it is named.
    conversation = await asked([
      {
        name: ATTENDANCE,
        args: { lessonId: otherLessons[2], body: { saves }, summary: 'Present.' },
      },
    ]);
    const theirs = conversation.proposals.at(-1);
    for (const step of theirs?.steps ?? []) {
      expect(step.entries.every((entry) => entry.name === null)).toBe(true);
    }
    // A route the Teacher does not hold is no tool: refused before anything is sent.
    await asked([
      { name: `propose_${GENERATED_TOOLS['PUT /api/setup/rooms/:id']?.name ?? ''}`.slice(0, 64) },
    ]);
    expect(results()).toEqual([{ error: 'not_on_list' }]);
  });

  // The lesson's journal column is still linked when the person would rather enter it there.
  it('links the journal column of an own lesson, and nothing of another teacher’s', async () => {
    await asked([
      { name: OPEN_LESSON_JOURNAL, args: { lessonId: lessons[2] } },
      { name: OPEN_LESSON_JOURNAL, args: { lessonId: otherLessons[2] } },
    ]);
    expect(results()).toEqual([{ linked: 'lesson_journal' }, { error: 'not_open' }]);
  });

  it('reads the Teacher’s own journal, plan and timetable, and refuses another teacher’s journal, plan, lesson card and timetable, also for a Teacher who is the subject’s Head Teacher and a Tutor of that class', async () => {
    const conversation = await asked([
      { name: JOURNAL_READ, args: { journalId: journal, quarterId: q1 } },
      { name: PLAN_READ, args: { journalId: journal, quarterId: q1 } },
      { name: JOURNAL_READ, args: { journalId: otherJournal, quarterId: q1 } },
      { name: PLAN_READ, args: { journalId: otherJournal, quarterId: q1 } },
      {
        name: TEACHER_VIEW,
        args: { staffId: scene.otherTeacher.staffId, date: '2026-10-26', span: 'day' },
      },
    ]);
    const [ownJournal, ownPlan] = readStatuses(conversation);
    expect([ownJournal, ownPlan]).toEqual([200, 200]);
    const [, , theirJournal, theirPlan, theirTimetable] = results();
    expect(theirJournal).toEqual({ status: 403, error: 'journal_scope' });
    expect(theirTimetable).toEqual({ status: 403, error: 'timetable_view_scope' });
    // `edge/lesson-plans`, "Who may read a plan?", lets a teacher of the same subject and grade
    // read it on the plan page. Task 11.20 (plan decision 4, Look first; `02`, What it can do:
    // "Every action the person's chosen role has on the screens"): the Teacher's assistant reads
    // it too, as the screen in the Teacher role does; the narrowing of 11.14 went.
    expect((theirPlan as { status?: number }).status).toBe(200);
    await asked([
      { name: CARD_READ, args: { lessonId: otherLessons[0] } },
      { name: PLAN_LESSON_READ, args: { lessonId: otherLessons[0] } },
      { name: CARD_READ, args: { lessonId: lessons[0] } },
    ]);
    const [theirCard, theirItem, ownCard] = results();
    expect((theirCard as { status?: number }).status).toBe(200);
    expect((theirItem as { status?: number }).status).toBe(200);
    expect((ownCard as { status?: number }).status).toBe(200);
    // The same person also holds the Head Teacher of the subject and the Tutor of the other
    // class (given at the start): with the Teacher role chosen, neither counts (`02`: "in the
    // role chosen"), here and in every test of this file.
    await asked([
      { name: JOURNAL_READ, args: { journalId: otherJournal, quarterId: q1 } },
      {
        name: TEACHER_VIEW,
        args: { staffId: scene.otherTeacher.staffId, date: '2026-10-26', span: 'day' },
      },
    ]);
    expect(results()).toEqual([
      { status: 403, error: 'journal_scope' },
      { status: 403, error: 'timetable_view_scope' },
    ]);
    // The same reads in the person's own session, where every role counts, are answered.
    const asHeadTeacher = await request(server())
      .get(`/api/journal/journals/${otherJournal}?quarterId=${q1}`)
      .set('Cookie', owner.cookie)
      .set(BRANCH_HEADER, scene.branch);
    expect(asHeadTeacher.status).toBe(200);
  });

  // Task 11.20 (plan decision 4, Look first): the plan list as the screen gives it in the Teacher
  // role, a colleague's of the same subject and grade included.
  it('lists the plans the Teacher role lists on the plan page, a colleague’s of the same subject and grade included', async () => {
    await asked([{ name: PLAN_LIST }]);
    const [read] = results();
    const plans = ((read as { data?: { plans?: { journalId: string }[] } }).data?.plans ?? []).map(
      (one) => one.journalId,
    );
    expect(plans).toContain(journal);
    expect(plans).toContain(otherJournal);
    // In the person's own session every role counts (a teacher of the same subject and grade,
    // `edge/lesson-plans`, and here the subject's Head Teacher too): both are listed.
    const onScreen = await request(server())
      .get('/api/plans')
      .set('Cookie', owner.cookie)
      .set(BRANCH_HEADER, scene.branch);
    expect(onScreen.status).toBe(200);
    const listed = (onScreen.body as { plans: { journalId: string }[] }).plans.map(
      (one) => one.journalId,
    );
    expect(listed).toContain(otherJournal);
    expect(listed).toContain(journal);
  });

  it('lists only the students the Teacher teaches, also for a Teacher who is the Tutor of another class (`02`, Teacher)', async () => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const taught = await members.student(scene.branch);
    await members.member({
      branch: scene.branch,
      classId: scene.classId,
      studentId: taught,
      from: '2026-09-01',
    });
    const notTaught = await members.student(scene.branch);
    await members.member({
      branch: scene.branch,
      classId: scene.otherClass,
      studentId: notTaught,
      from: '2026-09-01',
    });
    await asked([{ name: STUDENTS_READ }]);
    const [read] = results();
    const text = JSON.stringify(read);
    expect((read as { status?: number }).status).toBe(200);
    expect(text).toContain(taught);
    // The Tutor of the other class reads its students on the screen, never through the Teacher's role.
    expect(text).not.toContain(notTaught);
    const onScreen = await request(server())
      .get('/api/people/students')
      .set('Cookie', owner.cookie)
      .set(BRANCH_HEADER, scene.branch);
    expect(JSON.stringify(onScreen.body)).toContain(notTaught);
  });

  it('refuses another branch: a question in a branch where the person is no Teacher, and a link, a read or a change with another branch’s ids; nothing changes', async () => {
    const refused = await request(server())
      .post('/api/assistant/questions')
      .set('Cookie', owner.cookie)
      .set(BRANCH_HEADER, away.branch)
      .send({ role: 'teacher', text: 'Please.' });
    expect([refused.status, (refused.body as { error?: { code?: string } }).error?.code]).toEqual([
      403,
      'permission_denied',
    ]);
    const before = await everyRow();
    let conversation = await asked([
      { name: OPEN_LESSON_JOURNAL, args: { lessonId: away.lesson } },
      { name: JOURNAL_READ, args: { journalId: away.journal } },
      {
        name: ITEM_SAVE,
        args: {
          itemId: away.lesson,
          body: { journalId: away.journal, quarterId: away.quarter, values: values() },
          summary: 'Change it.',
        },
      },
    ]);
    expect(results()).toEqual([
      { error: 'not_open' },
      { status: 404, error: 'not_found' },
      { status: 404, error: 'not_found' },
    ]);
    const last = conversation.messages.at(-1);
    expect(last?.kind === 'answer' ? last.lessons : null).toEqual([]);
    conversation = await asked([
      {
        name: ITEM_CREATE,
        args: {
          journalId: away.journal,
          body: { quarterId: away.quarter, position: 1, lessonId: away.lesson, values: values() },
          summary: 'Write it.',
        },
      },
    ]);
    expect(await stepsAfter(proposalOf(conversation).id)).toEqual([['refused', 'not_found']]);
    expect(await everyRow()).toEqual(before);
  });

  it('finds a new item outdated when its row was taken, when another lesson stands there after a cancel, and when the row is gone', async () => {
    const draft = (position: number, lessonId: string | undefined) => ({
      name: ITEM_CREATE,
      args: {
        journalId: journal,
        body: {
          quarterId: q2,
          position,
          lessonId,
          values: values({ topic: `Row ${String(position)}` }),
        },
        summary: `Write row ${String(position)}.`,
      },
    });
    const cancel = async (lessonId: string | undefined) => {
      const response = await request(server())
        .post(`/api/timetable/lessons/${lessonId ?? ''}/cancel`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, scene.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ reason: 'School event' });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
    };
    // Taken: the row is written on the screen meanwhile.
    let conversation = await asked([draft(1, q2Lessons[0])]);
    const taken = await request(server())
      .post(`/api/plans/journals/${journal}/items`)
      .set('Cookie', owner.cookie)
      .set(BRANCH_HEADER, scene.branch)
      .send({
        quarterId: q2,
        position: 1,
        lessonId: q2Lessons[0],
        values: values({ topic: 'Screen' }),
      });
    expect(taken.status, JSON.stringify(taken.body)).toBe(201);
    expect(await stepsAfter(proposalOf(conversation).id)).toEqual([['outdated', 'plan_row_taken']]);
    // Moved: the first lesson is cancelled, so the second row now holds the third lesson.
    conversation = await asked([draft(2, q2Lessons[1])]);
    await cancel(q2Lessons[0]);
    expect(await stepsAfter(proposalOf(conversation).id)).toEqual([['outdated', 'plan_row_moved']]);
    // Gone: the last row (the eighth lesson, now at row 7) disappears with another cancel.
    conversation = await asked([draft(7, q2Lessons[7])]);
    await cancel(q2Lessons[1]);
    expect(await stepsAfter(proposalOf(conversation).id)).toEqual([
      ['outdated', 'plan_row_unknown'],
    ]);
  });

  it('refuses the Teacher another person’s conversation and proposal (404), and lists only the Teacher’s own', async () => {
    // The Super Admin's conversation with a waiting proposal (a room to add).
    model.script(
      calls({
        name: propose('POST /api/setup/rooms'),
        args: {
          body: {
            name: 'Room 9',
            floorId: randomUUID(),
            type: 'classroom',
            capacity: 20,
            status: 'in_use',
            shared: false,
            maxSimultaneousLessons: null,
          },
          summary: 'Add a room.',
        },
      }),
      answer('Here is the proposal.'),
    );
    const theirs = await request(server())
      .post('/api/assistant/questions')
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, scene.branch)
      .send({ role: 'super_admin', text: 'Add a room.' });
    expect(theirs.status, JSON.stringify(theirs.body).slice(0, 400)).toBe(202);
    await settle(t.app, theirs, t.admin, scene.branch);
    const conversation = assistantConversationSchema.parse(
      (theirs.body as { conversation: unknown }).conversation,
    );
    const proposalId = conversation.proposals[0]?.id ?? '';
    expect(proposalId).not.toBe('');
    const codeOf = (response: request.Response) =>
      [response.status, (response.body as { error?: { code?: string } }).error?.code] as const;
    const read = await request(server())
      .get(`/api/assistant/conversations/${conversation.id}`)
      .set('Cookie', owner.cookie)
      .set(BRANCH_HEADER, scene.branch);
    expect(codeOf(read)).toEqual([404, 'not_found']);
    for (const which of ['confirm', 'decline'] as const) {
      const decided = await request(server())
        .post(`/api/assistant/proposals/${proposalId}/${which}`)
        .set('Cookie', owner.cookie)
        .set(BRANCH_HEADER, scene.branch)
        .send({ role: 'teacher' });
      expect(codeOf(decided), which).toEqual([404, 'not_found']);
    }
    const list = await request(server())
      .get('/api/assistant/conversations')
      .set('Cookie', owner.cookie)
      .set(BRANCH_HEADER, scene.branch);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(conversation.id);
    // The proposal still waits for its own person.
    const still = await t.database.migrator
      .selectFrom('assistant_proposal_decisions')
      .selectAll()
      .where('proposal_id', '=', proposalId)
      .execute();
    expect(still).toEqual([]);
  });

  it('saves a drafted plan item only at Confirm, through the plan’s route, marked "via assistant"', async () => {
    const before = await everyRow();
    const conversation = await asked([
      {
        name: ITEM_CREATE,
        args: {
          journalId: journal,
          body: {
            quarterId: q1,
            position: 1,
            lessonId: lessons[0],
            values: values({
              topic: 'Common denominators',
              classworks: [{ title: 'Quiz 1', description: '' }],
            }),
          },
          summary: 'Topic and a classwork for lesson 1.',
        },
      },
    ]);
    // Nothing changes before Confirm: every row of the plan, journal and audit tables is as it was.
    expect(await everyRow()).toEqual(before);
    const proposal = proposalOf(conversation);
    expect(proposal.steps).toEqual([['waiting', null]]);
    expect(await stepsAfter(proposal.id)).toEqual([['done', null]]);
    const item = await t.database.migrator
      .selectFrom('lesson_plan_items')
      .innerJoin(
        'lesson_plan_journals',
        'lesson_plan_journals.plan_id',
        'lesson_plan_items.plan_id',
      )
      .select(['lesson_plan_items.id', 'lesson_plan_items.topic'])
      .where('lesson_plan_journals.journal_id', '=', journal)
      .where('lesson_plan_items.topic', '=', 'Common denominators')
      .executeTakeFirst();
    expect(item?.topic).toBe('Common denominators');
    const entries = await t.database.migrator
      .selectFrom('audit_log')
      .select(['action', 'actor_id', 'assistant_step_id'])
      .where('assistant_step_id', 'is not', null)
      .where('actor_id', '=', owner.account.id)
      .execute();
    expect(entries.some((entry) => entry.action.startsWith('plan.'))).toBe(true);
  });

  it('merges a save of another field made between the proposal and Confirm, and finds a change of the same field outdated', async () => {
    const item = await screenItem(2, 'Decimals');
    // The model proposes a new topic; the server reads the item as stored for its base.
    let conversation = await asked([
      {
        name: ITEM_SAVE,
        args: {
          itemId: item.id,
          body: { journalId: journal, quarterId: q1, values: values({ topic: 'Decimal places' }) },
          summary: 'A clearer topic.',
        },
      },
    ]);
    let proposal = proposalOf(conversation);
    expect(proposal.steps).toEqual([['waiting', null]]);
    // On the screen, the objectives are written meanwhile, on the same base.
    const screen = await request(server())
      .put(`/api/plans/items/${item.id}`)
      .set('Cookie', owner.cookie)
      .set(BRANCH_HEADER, scene.branch)
      .send({ base: baseOf(item), values: values({ topic: 'Decimals', objectives: 'Page 12' }) });
    expect(screen.status, JSON.stringify(screen.body)).toBe(200);
    // Per field, as the route decides (review correction 1): the objectives stay, the topic is saved.
    expect(await stepsAfter(proposal.id)).toEqual([['done', null]]);
    expect(await planItem(item.id)).toEqual({ topic: 'Decimal places', objectives: 'Page 12' });

    // The same field changed between the proposal and Confirm: outdated.
    conversation = await asked([
      {
        name: ITEM_SAVE,
        args: {
          itemId: item.id,
          body: {
            journalId: journal,
            quarterId: q1,
            values: values({ topic: 'Rounding', objectives: 'Page 12' }),
          },
          summary: 'Another topic.',
        },
      },
    ]);
    proposal = proposalOf(conversation);
    // The item as stored now (it has no works): the screen's next save of the topic.
    const again = await request(server())
      .put(`/api/plans/items/${item.id}`)
      .set('Cookie', owner.cookie)
      .set(BRANCH_HEADER, scene.branch)
      .send({
        base: values({ topic: 'Decimal places', objectives: 'Page 12' }),
        values: values({ topic: 'Percent', objectives: 'Page 12' }),
      });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(await stepsAfter(proposal.id)).toEqual([['outdated', 'plan_item_stale']]);
    expect((await planItem(item.id))?.topic).toBe('Percent');

    // Values equal to the stored item save nothing: no step.
    conversation = await asked([
      {
        name: ITEM_SAVE,
        args: {
          itemId: item.id,
          body: {
            journalId: journal,
            quarterId: q1,
            values: values({ topic: 'Percent', objectives: 'Page 12' }),
          },
          summary: 'The same.',
        },
      },
    ]);
    expect(conversation.proposals.at(-1)?.questionId).not.toBe(
      conversation.messages.filter((one) => one.kind === 'question').at(-1)?.id,
    );
    const results = lastResults(model.requests.at(-1) ?? { system: '', turns: [], tools: [] });
    expect(results[0]?.result).toEqual({ error: 'assistant_nothing_to_change' });
  });

  it('refuses a save of another teacher’s plan item and a new item at Confirm, as the plan page does; nothing saved', async () => {
    // An item of the other class's plan, written by its own teacher on the screen.
    // A session of a new account moved to the colleague's own account (the staff record's
    // account link is fixed once set).
    const colleague = await t.kit.completeSession('Jamshid', 'Rahimov');
    await t.database.migrator
      .updateTable('sessions')
      .set({ account_id: scene.otherTeacher.accountId })
      .where('account_id', '=', colleague.account.id)
      .execute();
    await t.kit.giveRole(scene.otherTeacher.accountId, {
      role: 'teacher',
      branchId: scene.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    await at(MOMENT);
    const written = await request(server())
      .post(`/api/plans/journals/${otherJournal}/items`)
      .set('Cookie', colleague.cookie)
      .set(BRANCH_HEADER, scene.branch)
      .send({
        quarterId: q1,
        position: 1,
        lessonId: otherLessons[0],
        values: values({ topic: 'Theirs' }),
      });
    expect(written.status, JSON.stringify(written.body)).toBe(201);
    const theirs = planItemSchema.parse(written.body);
    const before = await everyRow();
    let conversation = await asked([
      {
        name: ITEM_SAVE,
        args: {
          itemId: theirs.id,
          body: { journalId: otherJournal, quarterId: q1, values: values({ topic: 'Mine now' }) },
          summary: 'Change it.',
        },
      },
    ]);
    // Task 11.20 (plan decision 4): the colleague's plan is read as the Teacher reads it on the
    // screen; the save is proposed, and the plan's own route refuses it at Confirm.
    const saving = proposalOf(conversation);
    expect(saving.steps).toEqual([['waiting', null]]);
    expect((await stepsAfter(saving.id))[0]?.[0]).toBe('refused');
    expect((await planItem(theirs.id))?.topic).toBe('Theirs');
    conversation = await asked([
      {
        name: ITEM_CREATE,
        args: {
          journalId: otherJournal,
          body: {
            quarterId: q1,
            position: 2,
            lessonId: otherLessons[1],
            values: values({ topic: 'Mine' }),
          },
          summary: 'Write it.',
        },
      },
    ]);
    const proposal = proposalOf(conversation);
    expect(proposal.steps).toEqual([['waiting', null]]);
    expect(await stepsAfter(proposal.id)).toEqual([['refused', 'plan_scope']]);
    expect(await everyRow()).toEqual(before);
    expect((await planItem(theirs.id))?.topic).toBe('Theirs');
  });

  it('sends an unlock of an own locked lesson at Confirm, and refuses one of another teacher’s lesson', async () => {
    const before = await everyRow();
    const conversation = await asked([
      {
        name: UNLOCK,
        args: {
          lessonId: lessons[0],
          body: { reason: 'Marks of the quiz were late.' },
          summary: 'Unlock 12 October.',
        },
      },
      {
        name: UNLOCK,
        args: {
          lessonId: otherLessons[0],
          body: { reason: 'Not mine.' },
          summary: 'Unlock their lesson.',
        },
      },
    ]);
    expect(await everyRow()).toEqual(before);
    const proposal = proposalOf(conversation);
    const steps = await stepsAfter(proposal.id);
    expect(steps[0]).toEqual(['done', null]);
    expect(steps[1]?.[0]).toBe('refused');
    const unlocks = await t.database.migrator
      .selectFrom('journal_unlocks')
      .select(['lesson_id', 'requested_by'])
      .execute();
    expect(unlocks).toEqual([{ lesson_id: lessons[0], requested_by: owner.account.id }]);
    // Audited as the person's change, marked by its step ("via assistant").
    const entries = await t.database.migrator
      .selectFrom('audit_log')
      .select(['action', 'assistant_step_id'])
      .where('actor_id', '=', owner.account.id)
      .where('action', 'like', 'journal.unlock%')
      .execute();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.assistant_step_id).not.toBeNull();
    // The route's own routing: the person is the subject's Head Teacher here, so their own request
    // goes past them (`02`, "Nobody approves their own") to the deciders above; none to them.
    const notices = await t.database.migrator
      .selectFrom('notifications')
      .select('account_id')
      .where('kind', '=', 'journal.unlock_requested')
      .execute();
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.map((one) => one.account_id)).not.toContain(owner.account.id);
  });

  it('keeps the plan window’s rules: a save after the window ended is refused at Confirm; a Text request confirmed and approved opens it', async () => {
    const item = await screenItem(3, 'Ratios');
    const conversation = await asked([
      {
        name: ITEM_SAVE,
        args: {
          itemId: item.id,
          body: {
            journalId: journal,
            quarterId: q1,
            values: values({ topic: 'Ratios and rates' }),
          },
          summary: 'A longer topic.',
        },
      },
    ]);
    const proposal = proposalOf(conversation);
    // The window ends while the proposal waits (`edge/lesson-plans`: "A save arriving later is refused").
    await sql`
      update lesson_plan_windows set ends_at = ${new Date('2026-10-27T12:01:00+05:00')}
      where quarter_id = ${q1}
    `.execute(t.database.migrator);
    await at('2026-10-27T12:02:00+05:00');
    expect(await stepsAfter(proposal.id)).toEqual([['refused', 'plan_window_closed']]);
    expect((await planItem(item.id))?.topic).toBe('Ratios');

    // `09`, Editing after the window: the Teacher sends a Text request through the assistant.
    const requested = await asked([
      {
        name: PLAN_REQUEST,
        args: {
          journalId: journal,
          body: {
            kind: 'text',
            quarterId: q1,
            lessonIds: [lessons[2]],
            reason: 'A clearer topic.',
          },
          summary: 'Ask to change lesson 3.',
        },
      },
    ]);
    expect(await stepsAfter(proposalOf(requested).id)).toEqual([['done', null]]);
    const sent = await t.database.migrator
      .selectFrom('lesson_plan_requests')
      .select(['id', 'status', 'requested_by'])
      .where('journal_id', '=', journal)
      .executeTakeFirstOrThrow();
    expect([sent.status, sent.requested_by]).toEqual(['sent', owner.account.id]);
    // The Super Admin approves it on the screen; then the same save through the assistant is done.
    const approved = await request(server())
      .post(`/api/plans/requests/${sent.id}/decide`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, scene.branch)
      .send({ decision: 'approve', days: 3 });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const again = await asked([
      {
        name: ITEM_SAVE,
        args: {
          itemId: item.id,
          body: {
            journalId: journal,
            quarterId: q1,
            values: values({ topic: 'Ratios and rates' }),
          },
          summary: 'A longer topic.',
        },
      },
    ]);
    expect(await stepsAfter(proposalOf(again).id)).toEqual([['done', null]]);
    expect((await planItem(item.id))?.topic).toBe('Ratios and rates');
  });

  it('finds the send of a prepared request outdated when it was sent or decided before Confirm', async () => {
    const plan = await t.database.migrator
      .selectFrom('lesson_plan_journals')
      .select('plan_id')
      .where('journal_id', '=', journal)
      .where('quarter_id', '=', q1)
      .executeTakeFirstOrThrow();
    const prepared = await t.database.migrator
      .insertInto('lesson_plan_requests')
      .values({
        branch_id: scene.branch,
        journal_id: journal,
        quarter_id: q1,
        plan_id: plan.plan_id,
        kind: 'replan',
        from_date: '2026-10-26',
        status: 'prepared',
        prepared_at: new Date(MOMENT),
        updated_at: new Date(MOMENT),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const conversation = await asked([
      {
        name: PREPARED_SEND,
        args: { requestId: prepared.id, body: {}, summary: 'Send the prepared request.' },
      },
    ]);
    const proposal = proposalOf(conversation);
    expect(proposal.steps).toEqual([['waiting', null]]);
    // Sent on the screen (or decided) meanwhile.
    await t.database.migrator
      .updateTable('lesson_plan_requests')
      .set({ status: 'sent', sent_at: new Date(MOMENT), requested_by: owner.account.id })
      .where('id', '=', prepared.id)
      .execute();
    expect(await stepsAfter(proposal.id)).toEqual([['outdated', 'plan_request_decided']]);

    // A prepared request still waiting is sent at Confirm, as the person's own send.
    await t.database.migrator
      .updateTable('lesson_plan_requests')
      .set({ status: 'refused', decided_by: owner.account.id, decided_at: new Date(MOMENT) })
      .where('id', '=', prepared.id)
      .execute();
    const waiting = await t.database.migrator
      .insertInto('lesson_plan_requests')
      .values({
        branch_id: scene.branch,
        journal_id: journal,
        quarter_id: q1,
        plan_id: plan.plan_id,
        kind: 'replan',
        from_date: '2026-10-26',
        status: 'prepared',
        prepared_at: new Date(MOMENT),
        updated_at: new Date(MOMENT),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.database.migrator
      .insertInto('lesson_plan_request_lessons')
      .values({
        branch_id: scene.branch,
        request_id: waiting.id,
        lesson_id: lessons[2] ?? '',
        lesson_date: '2026-10-26',
      })
      .execute();
    const sending = await asked([
      {
        name: PREPARED_SEND,
        args: { requestId: waiting.id, body: {}, summary: 'Send the prepared request.' },
      },
    ]);
    expect(await stepsAfter(proposalOf(sending).id)).toEqual([['done', null]]);
    const sent = await t.database.migrator
      .selectFrom('lesson_plan_requests')
      .select(['status', 'requested_by'])
      .where('id', '=', waiting.id)
      .executeTakeFirstOrThrow();
    expect(sent).toEqual({ status: 'sent', requested_by: owner.account.id });
    const entry = await t.database.migrator
      .selectFrom('audit_log')
      .select(['action', 'assistant_step_id'])
      .where('actor_id', '=', owner.account.id)
      .where('assistant_step_id', 'is not', null)
      .orderBy('id', 'desc')
      .executeTakeFirst();
    expect(entry?.action.startsWith('plan.'), entry?.action).toBe(true);
  });
});
