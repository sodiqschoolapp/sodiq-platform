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
      })(request);
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

  it('refuses a day off today at the proposal, proposes the bulk cancel from lesson 3 with its lessons, and cancels lesson 3 alone at Confirm', async () => {
    const conversation = await askPowerCut();
    const results = lastResults(model.requests.at(-1) ?? { system: '', turns: [], tools: [] });
    // Turn by turn the model was given: the calendar's refusal, the check, the step.
    const given = model.requests.flatMap((one) => lastResults(one));
    expect(given.find((one) => one.name === CALENDAR_CREATE)?.result).toMatchObject({
      error: 'calendar_date_not_in_future',
    });
    void results;
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
});
