import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  assistantConversationSchema,
  type AssistantConversation,
} from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FakeModel,
  answer,
  calls,
  lastResults,
  type FakeTurn,
} from '../../testing/assistant-model.js';
import { dayTemplatesKit, MONDAY, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { Transactions } from '../../database/transactions.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';
import { GENERATED_TOOLS } from './tools.generated.js';

// Task 11.13 (pull request #376). `edge/people-roles-accounts`, The assistant: "'Cancel today,
// there is no electricity' at 11:05 after lesson 3 began. Today cannot become a day off
// (`edge/time-dates-calendar`). The assistant proposes a bulk cancel for the branch from the next
// slot that has not begun, asks about the lesson in progress …". Here the day has three lessons
// (08:00, 08:55, 09:50) and the person writes at 09:00, while lesson 2 is in progress: a day off
// for today is refused by the calendar's own preview and adds no step; the bulk cancel from
// lesson 3 is proposed with the platform's own check, and Confirm cancels lesson 3 alone. When
// lesson 3 has begun before Confirm, the check run again differs and nothing is cancelled
// (plan review, should fix 14). All names are invented.

const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

const at = (time: string): Date => new Date(`${MONDAY}T${time}:00+05:00`);

const tool = (route: string): string => GENERATED_TOOLS[route]?.name ?? '';
const CALENDAR_CREATE = `propose_${tool('POST /api/setup/calendar-entries')}`.slice(0, 64);
const BULK = `propose_${tool('POST /api/timetable/bulk-cancels')}`.slice(0, 64);
const BULK_CHECK = tool('POST /api/timetable/bulk-cancels/check');

describe('the assistant at a power cut: no day off today, a bulk cancel from the next slot', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  const model = new FakeModel();
  let branch: string;
  let oxford: string;
  let vice: { cookie: string };
  let shared: { other: string; oxford7: string; START: string };

  /** The branch of the shared-block test, set up while the admin's session of the kit is fresh. */
  async function sharedScene() {
    const other = await t.newBranch();
    const year = await load.classes.year(other);
    for (const [index, [start, end]] of QUARTERS.entries()) {
      await t.database.migrator
        .updateTable('quarters')
        .set({ start_date: start, end_date: end })
        .where('academic_year_id', '=', year)
        .where('number', '=', index + 1)
        .execute();
    }
    const lesson = await t.createSlotType(other, 'Lesson', 'lesson', 45);
    const template = await t.createTemplate(other, 'Regular', [lesson]);
    await t.assign(other, template);
    const english = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const oxford7 = await load.classes.schoolClass(other, year, { grade: 7, name: 'Oxford' });
    const princeton7 = await load.classes.schoolClass(other, year, { grade: 7, name: 'Princeton' });
    const START = '2026-10-19';
    const created = await t.post('/api/timetable/versions', other, {
      academicYearId: year,
      startsOn: START,
      copyFrom: null,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const version = (created.body as { id: string }).id;
    const rows: string[] = [];
    for (const [index, classIds] of [[oxford7, princeton7], [princeton7], [oxford7]].entries()) {
      const group = await load.classes.group(other, year, english, classIds, {
        name: `7-E-${String(index + 1)}`,
      });
      const teacher = await load.teacher(other, { subjects: [{ subject: english, grades: [7] }] });
      const entry = await t.database.migrator
        .insertInto('staff_availability')
        .values({ branch_id: other, staff_id: teacher.staffId, valid_from: '2026-09-01' })
        .returning(['id', 'valid_until'])
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('staff_availability_ranges')
        .values({
          entry_id: entry.id,
          branch_id: other,
          staff_id: teacher.staffId,
          weekday: 1,
          start_minutes: 0,
          end_minutes: 1440,
          valid_from: '2026-09-01',
          valid_until: entry.valid_until,
        })
        .execute();
      rows.push(
        await load.row({
          branch_id: other,
          version_id: version,
          group_id: group,
          subject_id: english,
          teacher_id: teacher.staffId,
          lessons_per_week: 1,
        }),
      );
    }
    const placed = await t.post(`/api/timetable/versions/${version}/pattern`, other, {
      loadRowId: rows[0],
      weekday: 1,
      slotPosition: 1,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const confirmedTemplates = await t.post(
      `/api/timetable/versions/${version}/templates/confirm`,
      other,
    );
    expect(confirmedTemplates.status, JSON.stringify(confirmedTemplates.body)).toBe(200);
    await load.freeEditLock(version);
    const published = await request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, other)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn: START });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return { other, oxford7, START };
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ assistantModel: model, listen: true, jobs: true });
    load = new LoadKit(t.database.migrator);
    branch = await t.newBranch();
    const year = await load.classes.year(branch);
    for (const [index, [start, end]] of QUARTERS.entries()) {
      await t.database.migrator
        .updateTable('quarters')
        .set({ start_date: start, end_date: end })
        .where('academic_year_id', '=', year)
        .where('number', '=', index + 1)
        .execute();
    }
    const lesson = await t.createSlotType(branch, 'Lesson', 'lesson', 45);
    const pause = await t.createSlotType(branch, 'Break', 'break', 10);
    const regular = await t.createTemplate(branch, 'Regular', [
      lesson,
      pause,
      lesson,
      pause,
      lesson,
    ]);
    await t.assign(branch, regular);
    oxford = await load.classes.schoolClass(branch, year, {
      grade: 7,
      name: 'Oxford',
      room: await load.classes.room(branch),
    });
    const created = await t.post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn: MONDAY,
      copyFrom: null,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const version = (created.body as { id: string }).id;
    for (const position of [1, 3, 5]) {
      const subject = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const teacher = await load.teacher(branch, { subjects: [{ subject, grades: [7] }] });
      const entry = await t.database.migrator
        .insertInto('staff_availability')
        .values({ branch_id: branch, staff_id: teacher.staffId, valid_from: '2026-09-01' })
        .returning(['id', 'valid_until'])
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('staff_availability_ranges')
        .values({
          entry_id: entry.id,
          branch_id: branch,
          staff_id: teacher.staffId,
          weekday: 1,
          start_minutes: 0,
          end_minutes: 1440,
          valid_from: '2026-09-01',
          valid_until: entry.valid_until,
        })
        .execute();
      const row = await load.row({
        branch_id: branch,
        version_id: version,
        class_id: oxford,
        subject_id: subject,
        teacher_id: teacher.staffId,
        lessons_per_week: 1,
      });
      const placed = await t.post(`/api/timetable/versions/${version}/pattern`, branch, {
        loadRowId: row,
        weekday: 1,
        slotPosition: position,
      });
      expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    }
    const confirmed = await t.post(`/api/timetable/versions/${version}/templates/confirm`, branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(version);
    const published = await request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn: MONDAY });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    await t.database.migrator
      .updateTable('assistant_settings')
      .set({ school_on: true, roles_on: ['super_admin', 'academic_vice_principal'] })
      .execute();
    shared = await sharedScene();
    // Monday 09:00: lesson 2 (08:55) is in progress, lesson 3 (09:50) has not begun.
    t.clock.set(at('09:00'));
    const browser = await t.kit.completeSession('Gulnora', 'Askarova');
    await t.kit.giveRole(browser.account.id, { role: 'academic_vice_principal', branchId: branch });
    vice = { cookie: browser.cookie };
  });

  afterAll(async () => {
    await t.close();
  });

  const cancelledNumbers = async (): Promise<number[]> => {
    const rows = await t.database.migrator
      .selectFrom('lessons')
      .select(['starts_at', 'cancel_cause'])
      .where('branch_id', '=', branch)
      .where('lesson_date', '=', MONDAY)
      .orderBy('starts_at')
      .execute();
    return rows.flatMap((row, index) => (row.cancel_cause === null ? [] : [index + 1]));
  };

  /** The model: a day off for today first, then the check, then the bulk cancel it lists. */
  const powerCut = (): FakeTurn[] => [
    calls({
      name: CALENDAR_CREATE,
      args: {
        body: {
          kind: 'day_off',
          name: 'Power cut',
          firstDate: MONDAY,
          lastDate: MONDAY,
          gradeFrom: null,
          gradeTo: null,
          dayTemplateId: null,
          followsWeekday: null,
          examWeek: null,
        },
        summary: 'Make today a day off.',
      },
    }),
    calls({
      name: BULK_CHECK,
      args: { body: { date: MONDAY, classIds: [oxford], lessonNumbers: [3] } },
    }),
    (request) => {
      const check = lastResults(request).at(-1)?.result as {
        data?: { cancel?: { lesson: { id: string } }[] };
      };
      return calls({
        name: BULK,
        args: {
          body: {
            date: MONDAY,
            classIds: [oxford],
            lessonNumbers: [3],
            reason: 'No electricity',
            blocks: [],
            lessonIds: (check.data?.cancel ?? []).map((one) => one.lesson.id),
            dataChoices: [],
          },
          summary: 'Cancel lesson 3 of 7 Oxford today.',
        },
      })(request, 'region');
    },
    answer('Today cannot become a day off. I propose to cancel lesson 3; lesson 2 has begun.'),
  ];

  const askPowerCut = async (): Promise<AssistantConversation> => {
    model.script(...powerCut());
    const response = await request(t.kit.server)
      .post('/api/assistant/questions')
      .set('Cookie', vice.cookie)
      .set(BRANCH_HEADER, branch)
      .send({
        role: 'academic_vice_principal',
        text: 'We had a power cut, cancel the rest of today.',
      });
    expect(response.status, JSON.stringify(response.body).slice(0, 500)).toBe(200);
    return assistantConversationSchema.parse(
      (response.body as { conversation: unknown }).conversation,
    );
  };

  const confirm = (id: string) =>
    request(t.kit.server)
      .post(`/api/assistant/proposals/${id}/confirm`)
      .set('Cookie', vice.cookie)
      .set(BRANCH_HEADER, branch)
      .send({ role: 'academic_vice_principal' });

  // `edge/people-roles-accounts`, "Add an extra lesson": no listed route adds one, and the move
  // that exists stays inside the quarter (`edge/time-dates-calendar`): the route refuses a move
  // into another quarter at Confirm, and the lesson is as it was.
  it('runs a proposed move into another quarter through its route, which refuses it', async () => {
    const lesson3 = await t.database.migrator
      .selectFrom('lessons')
      .select(['id', 'lesson_date', 'starts_at', 'cancel_cause'])
      .where('branch_id', '=', branch)
      .where('lesson_date', '=', MONDAY)
      .orderBy('starts_at', 'desc')
      .executeTakeFirstOrThrow();
    model.script(
      calls({
        name: `propose_${tool('POST /api/timetable/lessons/:id/move')}`.slice(0, 64),
        args: {
          id: lesson3.id,
          body: { date: '2026-11-10', lessonNumber: 1, reason: 'Power cut' },
          summary: 'Move lesson 3 to 10 November.',
        },
      }),
      answer('I propose to move the lesson.'),
    );
    const asked = await request(t.kit.server)
      .post('/api/assistant/questions')
      .set('Cookie', vice.cookie)
      .set(BRANCH_HEADER, branch)
      .send({ role: 'academic_vice_principal', text: 'Hold lesson 3 another day instead.' });
    expect(asked.status, JSON.stringify(asked.body).slice(0, 400)).toBe(200);
    const proposal = assistantConversationSchema.parse(
      (asked.body as { conversation: unknown }).conversation,
    ).proposals[0];
    // The lesson is named in the platform's words (class, date, slot), read from the day.
    expect(proposal?.steps[0]?.previewLessons.map((one) => [one.unitName, one.date])).toEqual([
      ['7 Oxford', MONDAY],
    ]);
    const confirmed = await confirm(proposal?.id ?? '');
    expect(confirmed.status).toBe(200);
    const state = assistantConversationSchema.parse(confirmed.body).proposals[0]?.steps[0];
    expect(state?.state).toBe('refused');
    expect(state?.code ?? '').toMatch(/^move_/);
    const after = await t.database.migrator
      .selectFrom('lessons')
      .select(['id', 'lesson_date', 'starts_at', 'cancel_cause'])
      .where('id', '=', lesson3.id)
      .executeTakeFirstOrThrow();
    expect(after).toEqual(lesson3);
  });

  it('refuses a day off today at the proposal, proposes the bulk cancel from lesson 3 with its lessons, and cancels lesson 3 alone at Confirm', async () => {
    const conversation = await askPowerCut();
    // Turn by turn the model was given: the calendar's refusal, the check, the step.
    const given = model.requests.flatMap((one) => lastResults(one));
    expect(given.find((one) => one.name === CALENDAR_CREATE)?.result).toMatchObject({
      error: 'calendar_date_not_in_future',
    });
    const [proposal] = conversation.proposals;
    expect(proposal?.steps.length).toBe(1);
    expect(proposal?.steps[0]?.action).toBe(tool('POST /api/timetable/bulk-cancels'));
    // The platform's own words: the lesson it cancels, by class, date and start.
    expect(
      proposal?.steps[0]?.previewLessons.map((one) => [
        one.list,
        one.unitName,
        one.date,
        one.start,
      ]),
    ).toEqual([['cancel', '7 Oxford', MONDAY, 9 * 60 + 50]]);
    expect(await cancelledNumbers()).toEqual([]);

    const confirmed = await confirm(proposal?.id ?? '');
    expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 500)).toBe(200);
    expect(
      assistantConversationSchema.parse(confirmed.body).proposals[0]?.steps.map((one) => one.state),
    ).toEqual(['done']);
    expect(await cancelledNumbers()).toEqual([3]);
    const marked = await t.database.migrator
      .selectFrom('audit_log')
      .select('assistant_step_id')
      .where('assistant_step_id', '=', proposal?.steps[0]?.id ?? '')
      .execute();
    expect(marked.length).toBeGreaterThan(0);
    // The lesson's own history names the change "via assistant" (plan, Web; review must fix 4).
    const cancelled = await t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('branch_id', '=', branch)
      .where('lesson_date', '=', MONDAY)
      .where('cancel_cause', 'is not', null)
      .executeTakeFirstOrThrow();
    const history = await request(t.kit.server)
      .get(`/api/timetable/lessons/${cancelled.id}/history`)
      .set('Cookie', vice.cookie)
      .set(BRANCH_HEADER, branch);
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    const lines = (history.body as { lines: { kind: string; viaAssistant: boolean }[] }).lines;
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.viaAssistant)).toBe(true);
  });

  it('finds the step outdated when lesson 3 began while the proposal waited, and cancels nothing', async () => {
    // Lesson 3 back: restored as on the screen, so the day is whole again.
    const lesson3 = await t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('branch_id', '=', branch)
      .where('lesson_date', '=', MONDAY)
      .where('cancel_cause', 'is not', null)
      .executeTakeFirstOrThrow();
    const restored = await request(t.kit.server)
      .post(`/api/timetable/lessons/${lesson3.id}/restore`)
      .set('Cookie', vice.cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({});
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    // In steps, with a request between, so the session stays in use.
    const stepTo = async (times: readonly string[]) => {
      for (const time of times) {
        t.clock.set(at(time));
        await request(t.kit.server)
          .get('/api/assistant/conversations')
          .set('Cookie', vice.cookie)
          .set(BRANCH_HEADER, branch);
      }
    };
    // Asked at 09:40, before lesson 3 (09:50); confirmed at 09:51, after it began.
    await stepTo(['09:05', '09:10', '09:15', '09:20', '09:25', '09:30', '09:35', '09:40']);
    const conversation = await askPowerCut();
    const id = conversation.proposals.at(-1)?.id ?? '';
    expect(conversation.proposals.at(-1)?.steps[0]?.previewLessons.length).toBe(1);
    await stepTo(['09:45', '09:51']);
    const confirmed = await confirm(id);
    expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 500)).toBe(200);
    expect(
      assistantConversationSchema
        .parse(confirmed.body)
        .proposals.at(-1)
        ?.steps.map((one) => [one.state, one.code]),
    ).toEqual([['outdated', 'assistant_step_outdated']]);
    expect(await cancelledNumbers()).toEqual([]);
  });

  // Review of the code, finding 1, and the plan's power-cut test: a lesson with data is named
  // with the choice the step sends ("keep as held" or "cancel"); without a choice the route
  // refuses the step, with it the lesson with data stays held and the other is cancelled.
  it('names each lesson with data with the choice it sends, refuses the cancel without one, and keeps it as held with one', async () => {
    const NEXT = '2026-10-19';
    const lessons = await t.database.migrator
      .selectFrom('lessons')
      .select(['id', 'starts_at'])
      .where('branch_id', '=', branch)
      .where('lesson_date', '=', NEXT)
      .orderBy('starts_at')
      .execute();
    expect(lessons.length).toBe(3);
    const marked = lessons[2]?.id ?? '';
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const studentId = await members.student(branch, { startsOn: '2026-09-01' });
    await t.database.migrator.transaction().execute(async (transaction) => {
      await members.member({ branch, classId: oxford, studentId, from: '2026-09-01' }, transaction);
    });
    const account = await load.classes.account();
    await t.app
      .get(Transactions)
      .run([branch], (transaction) =>
        saveCells(transaction, t.app.get(Audit), { accountId: account }, [
          { lessonId: marked, studentId, workId: null, value: 1, version: null },
        ]),
      );
    const askWith = async (dataChoices: { lessonId: string; choice: 'keep' | 'cancel' }[]) => {
      model.script(
        calls({
          name: BULK_CHECK,
          args: { body: { date: NEXT, classIds: [oxford], lessonNumbers: [2, 3] } },
        }),
        (request) => {
          const check = lastResults(request).at(-1)?.result as {
            data?: { cancel?: { lesson: { id: string } }[] };
          };
          const keep = new Set(
            dataChoices.filter((one) => one.choice === 'keep').map((one) => one.lessonId),
          );
          return calls({
            name: BULK,
            args: {
              body: {
                date: NEXT,
                classIds: [oxford],
                lessonNumbers: [2, 3],
                reason: 'No electricity',
                blocks: [],
                lessonIds: (check.data?.cancel ?? [])
                  .map((one) => one.lesson.id)
                  .filter((id) => !keep.has(id)),
                dataChoices,
              },
              summary: 'Cancel lessons 2 and 3 of 7 Oxford next Monday.',
            },
          })(request, 'region');
        },
        answer('Proposed.'),
      );
      const response = await request(t.kit.server)
        .post('/api/assistant/questions')
        .set('Cookie', vice.cookie)
        .set(BRANCH_HEADER, branch)
        .send({ role: 'academic_vice_principal', text: 'Cancel lessons 2 and 3 next Monday.' });
      expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
      return assistantConversationSchema.parse(
        (response.body as { conversation: unknown }).conversation,
      ).proposals[0];
    };
    const cancelledOn = async () =>
      (
        await t.database.migrator
          .selectFrom('lessons')
          .select(['id', 'cancel_cause'])
          .where('branch_id', '=', branch)
          .where('lesson_date', '=', NEXT)
          .orderBy('starts_at')
          .execute()
      ).map((one) => one.cancel_cause !== null);

    // Without a choice: the lesson with data is shown with its data and no choice; refused.
    const none = await askWith([]);
    const withData = none?.steps[0]?.previewLessons.find((one) => one.hasData);
    expect(withData?.choice).toBeNull();
    const refused = await confirm(none?.id ?? '');
    expect(
      assistantConversationSchema
        .parse(refused.body)
        .proposals[0]?.steps.map((one) => [one.state, one.code]),
    ).toEqual([['refused', 'bulk_data_choice_missing']]);
    expect(await cancelledOn()).toEqual([false, false, false]);

    // "Keep as held": named so on the lesson with data; Confirm cancels lesson 2 only.
    const kept = await askWith([{ lessonId: marked, choice: 'keep' }]);
    const lines = kept?.steps[0]?.previewLessons ?? [];
    expect(lines.filter((one) => one.hasData).map((one) => one.choice)).toEqual(['keep']);
    expect(lines.filter((one) => !one.hasData).map((one) => one.choice)).toEqual([null]);
    const done = await confirm(kept?.id ?? '');
    expect(
      assistantConversationSchema
        .parse(done.body)
        .proposals.at(-1)
        ?.steps.map((one) => one.state),
    ).toEqual(['done']);
    expect(await cancelledOn()).toEqual([false, true, false]);
  });

  // Review of the code, round 2: a lesson of a shared block is named with what Confirm does to
  // it. English in one block of three parallel groups: 7-E-1 of both classes, 7-E-2 of Princeton
  // alone, 7-E-3 of Oxford alone. A bulk cancel for Oxford: "keep" still cancels 7-E-3 (fed by
  // Oxford alone, `chosenOnly`) and holds the rest for Princeton; "cancel" cancels the block.
  it('names what a shared block’s keep or cancel does to each of its lessons', async () => {
    const { other, oxford7, START } = shared;
    const browser = await t.kit.completeSession('Sevara', 'Olimova');
    await t.kit.giveRole(browser.account.id, { role: 'academic_vice_principal', branchId: other });

    const propose = async (choice: 'keep' | 'cancel') => {
      model.script(
        calls({
          name: BULK_CHECK,
          args: { body: { date: START, classIds: [oxford7], lessonNumbers: [1] } },
        }),
        (request) => {
          const check = lastResults(request).at(-1)?.result as {
            data?: {
              cancel?: { lesson: { id: string } }[];
              shared?: { blockId: string; chosenOnly: string[]; lessons: { id: string }[] }[];
            };
          };
          const shared = check.data?.shared ?? [];
          return calls({
            name: BULK,
            args: {
              body: {
                date: START,
                classIds: [oxford7],
                lessonNumbers: [1],
                reason: 'Excursion',
                blocks: shared.map((one) => ({ blockId: one.blockId, choice })),
                lessonIds: [
                  ...(check.data?.cancel ?? []).map((one) => one.lesson.id),
                  ...shared.flatMap((one) =>
                    choice === 'cancel' ? one.lessons.map((each) => each.id) : one.chosenOnly,
                  ),
                ],
                dataChoices: [],
              },
              summary: 'Cancel English of 7 Oxford.',
            },
          })(request, 'region');
        },
        answer('Proposed.'),
      );
      const response = await request(t.kit.server)
        .post('/api/assistant/questions')
        .set('Cookie', browser.cookie)
        .set(BRANCH_HEADER, other)
        .send({ role: 'academic_vice_principal', text: 'Cancel English of 7 Oxford next Monday.' });
      expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
      const step = assistantConversationSchema.parse(
        (response.body as { conversation: unknown }).conversation,
      ).proposals[0]?.steps[0];
      return Object.fromEntries(
        (step?.previewLessons ?? [])
          .filter((one) => one.list === 'shared')
          .map((one) => [one.unitName, one.choice]),
      );
    };
    // The groups' names are the units of their lessons.
    expect(await propose('keep')).toEqual({ '7-E-1': 'held', '7-E-2': 'held', '7-E-3': 'cancel' });
    expect(await propose('cancel')).toEqual({
      '7-E-1': 'cancel',
      '7-E-2': 'cancel',
      '7-E-3': 'cancel',
    });
  });
});
