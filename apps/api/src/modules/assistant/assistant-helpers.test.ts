import { randomUUID } from 'node:crypto';
import {
  assistantConversationSchema,
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  type AssistantConversation,
  type AssistantRole,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import {
  answer,
  calls,
  FakeModel,
  lastResults,
  type FakeTurn,
} from '../../testing/assistant-model.js';
import { settle } from '../../testing/assistant-kit.js';
import { setEditDays } from '../../testing/branch-filter-sql.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { openPlanWindows } from '../../testing/plan-windows-kit.js';
import { hoursOf, publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';
import {
  DRAFT_PLAN_UNIT,
  EXPLAIN_RESULT,
  SUGGEST_SUBSTITUTES,
  TODAYS_BRIEFING,
} from './helpers.js';
import { GENERATED_TOOLS } from './tools.generated.js';

// Task 11.23 (`02`, Assistant, Helpers; Calculation stays here; build plan 11.23, Done when: "the
// briefing … lists each kind with links; the substitutes offered for an absence never clash with a
// lesson of the substitute at that clock time (a test with lessons of different slot lengths); a
// unit of 8 items is drafted and saved only on Confirm; the explanation of a result quotes the
// figures of the breakdown read, and a test fails if a figure in the answer is not in the read").
// All names are invented.

/** Monday 26 October 2026, 07:00 in Tashkent: the Mondays 12 and 19 are held, the 26th not yet. */
const MONDAY_26 = '2026-10-26T07:00:00+05:00';
/** Monday 2 November 2026, noon: the second quarter (from 9 November) has not started. */
const NOVEMBER_2 = '2026-11-02T12:00:00+05:00';
/** Monday 16 November 2026, 07:00: the day's lessons from 08:00 have not started. */
const NOVEMBER_16 = '2026-11-16T07:00:00+05:00';

const tool = (route: string): string => {
  const name = GENERATED_TOOLS[route]?.name;
  if (name === undefined) throw new Error(`${route} has no tool`);
  return name;
};
const propose = (route: string): string => `propose_${tool(route)}`.slice(0, 64);

const ITEM_CREATE = propose('POST /api/plans/journals/:journalId/items');
const SUBSTITUTE = propose('POST /api/timetable/lessons/:id/substitute');

type Browser = { cookie: string; account: { id: string } };

/** The reads of the conversation's last question. */
function readsOfLast(conversation: AssistantConversation) {
  const asked = conversation.messages.map((one) => one.kind).lastIndexOf('question');
  return conversation.messages.slice(asked).filter((one) => one.kind === 'read');
}

/** What one helper gave the model, from the request after its call. */
function given(model: FakeModel, name: string): Record<string, unknown> {
  for (const sent of [...model.requests].reverse()) {
    const found = lastResults(sent).find((one) => one.name === name);
    if (found !== undefined) return found.result as Record<string, unknown>;
  }
  throw new Error(`${name} gave nothing`);
}

describe('the helpers of the assistant (task 11.23)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  const model = new FakeModel();
  let names = 0;

  const account = async (): Promise<Browser> => {
    names += 1;
    return t.kit.completeSession('Nodira', `Ergasheva${'a'.repeat(names)}`);
  };

  /** Moves the clock and keeps the sessions fresh. */
  async function at(moment: string): Promise<void> {
    t.clock.set(moment);
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
      .execute();
  }

  /** Asks one question with the model's turns, and answers the conversation when it settled. */
  async function ask(
    as: { cookie: string; branch: string; role: AssistantRole },
    turns: FakeTurn[],
    text = 'Please.',
  ): Promise<AssistantConversation> {
    model.script(...turns);
    const response = await request(t.kit.server)
      .post('/api/assistant/questions')
      .set('Cookie', as.cookie)
      .set(BRANCH_HEADER, as.branch)
      .send({ role: as.role, text });
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(202);
    await settle(t.app, response, as.cookie, as.branch);
    return assistantConversationSchema.parse(
      (response.body as { conversation: unknown }).conversation,
    );
  }

  const confirm = (id: string, as: { cookie: string; branch: string; role: AssistantRole }) =>
    request(t.kit.server)
      .post(`/api/assistant/proposals/${id}/confirm`)
      .set('Cookie', as.cookie)
      .set(BRANCH_HEADER, as.branch)
      .send({ role: as.role });

  const lessonsOf = async (classId: string, subjectId: string, from: string, until: string) =>
    (
      await t.database.migrator
        .selectFrom('lessons')
        .select(['id', sql<string>`lesson_date::text`.as('date')])
        .where('class_id', '=', classId)
        .where('subject_id', '=', subjectId)
        .where('lesson_date', '>=', from)
        .where('lesson_date', '<=', until)
        .where('cancel_cause', 'is', null)
        .orderBy('starts_at')
        .execute()
    ).map((one) => ({ id: one.id, date: one.date }));

  const quarterOf = async (scene: PublishedScene, number: number) =>
    (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', scene.year)
        .where('number', '=', number)
        .executeTakeFirstOrThrow()
    ).id;

  const journalOf = async (classId: string, subjectId: string) =>
    (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', classId)
        .where('subject_id', '=', subjectId)
        .executeTakeFirstOrThrow()
    ).id;

  const saveOn = async (
    branch: string,
    date: string,
    cells: { lessonId: string; studentId: string; workId?: string; value: number }[],
  ) => {
    const before = t.clock.now();
    t.clock.set(`${date}T18:00:00+05:00`);
    try {
      const writer = await load.classes.account();
      await t.app.get(Transactions).run([branch], (transaction) =>
        saveCells(
          transaction,
          t.app.get(Audit),
          { accountId: writer },
          cells.map((cell) => ({
            lessonId: cell.lessonId,
            studentId: cell.studentId,
            workId: cell.workId ?? null,
            value: cell.value,
            version: null,
          })),
        ),
      );
    } finally {
      t.clock.set(before.toISOString());
    }
  };

  const classworksOn = async (branch: string, lessonId: string, count: number) => {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(
        (
          await t.database.migrator
            .insertInto('journal_works')
            .values({ branch_id: branch, lesson_id: lessonId, kind: 'classwork', total: 10 })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id,
      );
    }
    return ids;
  };

  const student = async (branch: string, classId: string, first: string, last: string) => {
    const kit = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await kit.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: first, last_name: last })
      .where('id', '=', id)
      .execute();
    await kit.member({ branch, studentId: id, classId, from: '2026-09-01' });
    return id;
  };

  const absent = async (
    branch: string,
    staffId: string,
    startsOn: string,
    endsOn: string | null,
  ) => {
    const response = await t.post('/api/timetable/absences', branch, {
      staffId,
      startsOn,
      endsOn,
      reason: 'Ill',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as { id: string }).id;
  };

  beforeAll(async () => {
    t = await dayTemplatesKit({ assistantModel: model, listen: true, jobs: true });
    load = new LoadKit(t.database.migrator);
    await t.database.migrator
      .updateTable('assistant_settings')
      .set({ school_on: true, roles_on: ['super_admin', 'academic_vice_principal', 'teacher'] })
      .execute();
  });

  afterAll(async () => {
    t.clock.set(START);
    await t.close();
  });

  describe('the day, the plans and the results of one branch', () => {
    let scene: PublishedScene;
    let owner: Browser;
    let vice: Browser;
    let q1: string;
    let q2: string;
    let journal: string;
    let low: string;
    let good: string;
    let absence: string;

    beforeAll(async () => {
      owner = await account();
      vice = await account();
      scene = await publishedScene(t, load, {
        graded: true,
        secondSubject: true,
        accounts: { teacher: owner.account.id },
      });
      for (const [who, role] of [
        [owner, 'teacher'],
        [vice, 'academic_vice_principal'],
      ] as const) {
        await t.kit.giveRole(who.account.id, {
          role,
          branchId: scene.branch,
          validFrom: new Date('2026-09-01T00:00:00+05:00'),
        });
      }
      q1 = await quarterOf(scene, 1);
      q2 = await quarterOf(scene, 2);
      journal = await journalOf(scene.classId, scene.subject);
      // The first quarter's window ended on 20 October: the plan of the class, with no item, is
      // overdue (`09`: "listed as overdue"); the other quarters are open.
      await sql`
        insert into lesson_plan_windows
          (branch_id, quarter_id, start_date, end_date, starts_at, ends_at, opened_at, opened_by)
        select q.branch_id, q.id, date '2026-09-01', date '2026-10-20',
          (date '2026-09-01')::timestamp at time zone b.time_zone,
          (date '2026-10-21')::timestamp at time zone b.time_zone - interval '1 millisecond',
          now(), (select a.id from accounts a order by a.id limit 1)
        from quarters q join branches b on b.id = q.branch_id
        where q.id = ${q1}
      `.execute(t.database.migrator);
      await openPlanWindows(t.database.migrator, scene.branch, scene.year);
      const [l12, l19] = await lessonsOf(scene.classId, scene.subject, '2026-10-01', '2026-10-25');
      if (l12 === undefined || l19 === undefined) throw new Error('The Mondays 12 and 19.');
      // A student absent on both with five classworks of 1 of 10 (a low result), and one present
      // with 9 of 10.
      low = await student(scene.branch, scene.classId, 'Anvar', 'Aliyev');
      good = await student(scene.branch, scene.classId, 'Charos', 'Choriyeva');
      const works = await classworksOn(scene.branch, l12.id, 5);
      await saveOn(scene.branch, l12.date, [
        { lessonId: l12.id, studentId: low, value: 0 },
        { lessonId: l12.id, studentId: good, value: 1 },
        ...works.map((workId) => ({ lessonId: l12.id, studentId: low, workId, value: 1 })),
        ...works.map((workId) => ({ lessonId: l12.id, studentId: good, workId, value: 9 })),
      ]);
      await saveOn(scene.branch, l19.date, [
        { lessonId: l19.id, studentId: low, value: 0 },
        { lessonId: l19.id, studentId: good, value: 1 },
      ]);
      await setEditDays(t.database.migrator, scene.branch, 7);
      await at(MONDAY_26);
      // The teacher asks to unlock the 12th (locked) and to edit the plan after the window.
      const unlock = await request(t.kit.server)
        .post(`/api/journal/lessons/${l12.id}/unlocks`)
        .set('Cookie', owner.cookie)
        .set(BRANCH_HEADER, scene.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ reason: 'A mark was missed.' });
      expect(unlock.status, JSON.stringify(unlock.body)).toBe(201);
      const planRequest = await request(t.kit.server)
        .post(`/api/plans/journals/${journal}/requests`)
        .set('Cookie', owner.cookie)
        .set(BRANCH_HEADER, scene.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ kind: 'text', quarterId: q1, lessonIds: [l12.id], reason: 'The topic was late.' });
      expect(planRequest.status, JSON.stringify(planRequest.body)).toBe(201);
      // The other class's teacher is away today: today's lesson of the other class needs a teacher.
      absence = await absent(scene.branch, scene.otherTeacher.staffId, '2026-10-26', '2026-10-27');
    });

    const viceAs = () => ({
      cookie: vice.cookie,
      branch: scene.branch,
      role: 'academic_vice_principal' as const,
    });
    const adminAs = () => ({ cookie: t.admin, branch: scene.branch, role: 'super_admin' as const });
    const ownerAs = () => ({
      cookie: owner.cookie,
      branch: scene.branch,
      role: 'teacher' as const,
    });

    it('answers "what needs me today" for the Academic Vice Principal with each kind counted and linked', async () => {
      await at(MONDAY_26);
      const conversation = await ask(viceAs(), [calls({ name: TODAYS_BRIEFING }), answer('Here.')]);
      const result = given(model, TODAYS_BRIEFING) as Record<string, Record<string, unknown>>;
      expect(result.absencesToday).toMatchObject({ count: 1, page: '/timetable/absences' });
      expect(result.absencesToday?.rows).toEqual([
        expect.objectContaining({ absenceId: absence, from: '2026-10-26', to: '2026-10-27' }),
      ]);
      expect(result.lessonsWithoutTeacher).toMatchObject({ count: 1 });
      expect(result.unlockRequestsWaiting).toMatchObject({ count: 1, page: '/journal/unlocks' });
      expect(result.planRequestsWaiting).toMatchObject({ count: 1, page: '/plans/requests' });
      expect(result.overduePlans).toMatchObject({ page: '/plans/reports' });
      expect(result.overduePlans?.rows).toEqual(
        expect.arrayContaining([expect.objectContaining({ journalId: journal })]),
      );
      expect(result.earlyWarning).toMatchObject({ page: '/results/early-warning' });
      expect(result.earlyWarning?.rows).toEqual(
        expect.arrayContaining([expect.objectContaining({ studentId: low })]),
      );
      // The answer links each kind's page; each read is in the conversation, as the person's.
      const last = conversation.messages.at(-1);
      expect(last?.kind).toBe('answer');
      if (last?.kind !== 'answer') return;
      expect(last.links.map((one) => one.to).sort()).toEqual(
        [
          '/journal/unlocks',
          '/plans/reports',
          '/plans/requests',
          '/results/early-warning',
          '/timetable/absences',
        ].sort(),
      );
      const reads = readsOfLast(conversation);
      expect(reads).toHaveLength(6);
    });

    it('gives the Super Admin the briefing, names a part switched off at the request, and keeps the rest', async () => {
      await at(MONDAY_26);
      // Switched off between the start of the question and the read: the dispatcher refuses it.
      model.script(async (sent) => {
        await t.database.migrator
          .insertInto('assistant_action_switches')
          .values({
            role: 'super_admin',
            route: 'GET /api/results/early-warning',
            is_on: false,
            changed_at: new Date(MONDAY_26),
            changed_by: owner.account.id,
          })
          .execute();
        return calls({ name: TODAYS_BRIEFING })(sent, 'region');
      }, answer('Here.'));
      try {
        const response = await request(t.kit.server)
          .post('/api/assistant/questions')
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, scene.branch)
          .send({ role: 'super_admin', text: 'What needs me today?' });
        expect(response.status).toBe(202);
        await settle(t.app, response, t.admin, scene.branch);
        const result = given(model, TODAYS_BRIEFING) as Record<string, Record<string, unknown>>;
        expect(result.earlyWarning).toEqual({ error: 'action_off' });
        expect(result.absencesToday).toMatchObject({ count: 1 });
        expect(result.overduePlans).toMatchObject({ page: '/plans/reports' });
      } finally {
        await t.database.migrator
          .deleteFrom('assistant_action_switches')
          .where('route', '=', 'GET /api/results/early-warning')
          .execute();
      }
    });

    it('never gives the Teacher the briefing or the substitutes; called by name they are not on the list', async () => {
      await at(MONDAY_26);
      await ask(ownerAs(), [
        (sent) => {
          const offered = sent.tools.map((one) => one.name);
          expect(offered).not.toContain(TODAYS_BRIEFING);
          expect(offered).not.toContain(SUGGEST_SUBSTITUTES);
          expect(offered).toContain(DRAFT_PLAN_UNIT);
          expect(offered).toContain(EXPLAIN_RESULT);
          return calls({ name: TODAYS_BRIEFING })(sent, 'region');
        },
        answer('No.'),
      ]);
      expect(given(model, TODAYS_BRIEFING)).toEqual({ error: 'not_on_list' });
    });

    it('stops a helper’s reads at the question’s limit of reads', async () => {
      await at(MONDAY_26);
      await t.database.migrator
        .updateTable('assistant_settings')
        .set({ question_actions: 2 })
        .execute();
      try {
        const conversation = await ask(viceAs(), [
          calls({ name: TODAYS_BRIEFING }),
          answer('Part.'),
        ]);
        const result = given(model, TODAYS_BRIEFING) as Record<string, Record<string, unknown>>;
        expect(result.absencesToday).toMatchObject({ count: 1 });
        expect(result.lessonsWithoutTeacher).toMatchObject({ count: 1 });
        expect(result.unlockRequestsWaiting).toEqual({ error: 'too_many_reads' });
        expect(result.earlyWarning).toEqual({ error: 'too_many_reads' });
        const reads = readsOfLast(conversation);
        expect(reads).toHaveLength(2);
      } finally {
        await t.database.migrator
          .updateTable('assistant_settings')
          .set({ question_actions: 40 })
          .execute();
      }
    });

    describe('a unit of plans (Teacher)', () => {
      it('drafts a unit of 8 items in one proposal and saves them only on Confirm', async () => {
        await at(NOVEMBER_2);
        const conversation = await ask(ownerAs(), [
          calls({ name: DRAFT_PLAN_UNIT, args: { journalId: journal, quarterId: q2, count: 8 } }),
          (sent) => {
            const unit = lastResults(sent)[0]?.result as {
              rows: { position: number; lessonId: string }[];
            };
            expect(unit.rows).toHaveLength(8);
            expect(sent.tools.map((one) => one.name)).toContain(ITEM_CREATE);
            return calls(
              ...unit.rows.map((row) => ({
                name: ITEM_CREATE,
                args: {
                  journalId: journal,
                  body: {
                    quarterId: q2,
                    position: row.position,
                    lessonId: row.lessonId,
                    values: {
                      topic: `Fractions, part ${String(row.position)}`,
                      objectives: '',
                      links: [],
                      classworks: [],
                      homeworks: [],
                    },
                  },
                  summary: `Item ${String(row.position)}.`,
                },
              })),
            )(sent, 'region');
          },
          answer('The unit is drafted.'),
        ]);
        const items = () =>
          t.database.migrator
            .selectFrom('lesson_plan_items')
            .innerJoin(
              'lesson_plan_journals',
              'lesson_plan_journals.plan_id',
              'lesson_plan_items.plan_id',
            )
            .select('lesson_plan_items.topic')
            .where('lesson_plan_journals.journal_id', '=', journal)
            .where('lesson_plan_journals.quarter_id', '=', q2)
            .where('lesson_plan_items.cleared_at', 'is', null)
            .execute();
        expect(await items()).toEqual([]);
        const proposal = conversation.proposals.at(-1);
        expect(proposal?.steps).toHaveLength(8);
        const confirmed = await confirm(proposal?.id ?? '', ownerAs());
        expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 600)).toBe(200);
        expect((await items()).map((one) => one.topic).sort()).toEqual(
          Array.from({ length: 8 }, (_, index) => `Fractions, part ${String(index + 1)}`).sort(),
        );
      });

      it('says the rows are closed after the window and proposes nothing; another teacher’s plan gives no row to write', async () => {
        await at(MONDAY_26);
        await ask(ownerAs(), [
          calls({ name: DRAFT_PLAN_UNIT, args: { journalId: journal, quarterId: q1, count: 3 } }),
          answer('Closed.'),
        ]);
        const closed = given(model, DRAFT_PLAN_UNIT);
        expect(closed.rows).toEqual([]);
        expect((closed.window as { state: string }).state).toBe('ended');
        const other = await journalOf(scene.otherClass, scene.subject);
        await ask(ownerAs(), [
          calls({ name: DRAFT_PLAN_UNIT, args: { journalId: other, count: 3 } }),
          answer('No.'),
        ]);
        // Another teacher's plan of the subject is readable (`09`), never writable: no row, no item tool.
        expect(given(model, DRAFT_PLAN_UNIT)).toMatchObject({ canEdit: false, rows: [] });
      });

      it('is never given to the Super Admin or the Academic Vice Principal', async () => {
        await at(NOVEMBER_2);
        for (const as of [adminAs(), viceAs()]) {
          await ask(as, [
            (sent) => {
              expect(sent.tools.map((one) => one.name)).not.toContain(DRAFT_PLAN_UNIT);
              return calls({ name: DRAFT_PLAN_UNIT, args: { journalId: journal, count: 2 } })(
                sent,
                'region',
              );
            },
            answer('No.'),
          ]);
          expect(given(model, DRAFT_PLAN_UNIT)).toEqual({ error: 'not_on_list' });
        }
      });
    });

    describe('why this result', () => {
      const explainCall = () =>
        calls({
          name: EXPLAIN_RESULT,
          args: { studentId: low, subjectId: scene.subject, quarterId: q1 },
        });

      /** The figures of the breakdown the model was given, for an answer that quotes them. */
      const quoting = answer((sent) => {
        const breakdown = lastResults(sent)[0]?.result as {
          averages: { attendance: number; classwork: number };
          weights: { attendance: number; classwork: number };
        };
        return `Attendance ${String(breakdown.averages.attendance)}% at weight ${String(breakdown.weights.attendance)}; classwork ${String(breakdown.averages.classwork)} % at weight ${String(breakdown.weights.classwork)}.`;
      });

      it('quotes the breakdown read (averages, weights, works) and keeps an answer of its figures', async () => {
        await at(MONDAY_26);
        const conversation = await ask(viceAs(), [explainCall(), quoting]);
        const breakdown = given(model, EXPLAIN_RESULT) as {
          averages: Record<string, unknown>;
          weights: Record<string, unknown>;
          classworks: { score: number; total: number; percent: number }[];
          outcome: { kind: string };
        };
        expect(breakdown.weights).toEqual({
          attendance: 20,
          classwork: 40,
          homework: 40,
          ratingExam: null,
        });
        expect(breakdown.averages.attendance).toBe(0);
        expect(breakdown.averages.classwork).toBe(10);
        expect(breakdown.classworks).toHaveLength(5);
        expect(breakdown.classworks[0]).toMatchObject({ score: 1, total: 10, percent: 10 });
        const last = conversation.messages.at(-1);
        expect(last?.kind).toBe('answer');
        expect(last?.kind === 'answer' ? last.text : '').toContain('classwork 10 % at weight 40');
      });

      it('refuses a figure that is not in the breakdown, also one found elsewhere in the journal read: one more call, then the notice', async () => {
        await at(MONDAY_26);
        // 90 is another student's classwork percent in the journal read, never this student's.
        const conversation = await ask(viceAs(), [
          explainCall(),
          answer('The classwork is 90%.'),
          answer('The classwork is 32.8 points.'),
        ]);
        const last = conversation.messages.at(-1);
        expect(last).toMatchObject({ kind: 'notice', code: 'assistant_figures_unchecked' });
        const retry = model.requests.at(-1)?.turns.at(-1)?.parts[0];
        expect(retry?.kind === 'text' ? retry.text : '').toContain('90');
      });

      it('keeps the answer when the call after the check quotes only the breakdown', async () => {
        await at(MONDAY_26);
        const conversation = await ask(viceAs(), [
          explainCall(),
          answer('The classwork is 90%.'),
          answer('The classwork average is 10, at weight 40.'),
        ]);
        const last = conversation.messages.at(-1);
        expect(last).toMatchObject({
          kind: 'answer',
          text: 'The classwork average is 10, at weight 40.',
        });
      });

      it('gives a Teacher of another subject of the student nothing to quote: the subject is not in the read', async () => {
        await at(MONDAY_26);
        // The owner teaches the other class its second subject only; its maths is another's.
        const pupil = await student(scene.branch, scene.otherClass, 'Laylo', 'Hasanova');
        await ask(ownerAs(), [
          calls({
            name: EXPLAIN_RESULT,
            args: { studentId: pupil, subjectId: scene.subject, quarterId: q1 },
          }),
          answer('Not open.'),
        ]);
        const result = given(model, EXPLAIN_RESULT);
        expect(result.error).toMatch(/^(not_open|not_found)$/);
        expect(result).not.toHaveProperty('averages');
      });
    });
  });

  describe('the substitutes of an absence', () => {
    /**
     * Branch A: maths of the class on Monday 08:00–08:45 (lesson 1 of 45 minutes). Branch B: slots
     * of 80 minutes from 06:30, so its lesson 1 is 06:30–07:50 and its lesson 2 08:00–09:20.
     */
    async function scenes(subjectOfCandidates: 'same' | 'other') {
      t.clock.set(START);
      const a = await publishedScene(t, load, { graded: true });
      const b = await publishedScene(t, load, {
        graded: true,
        secondSubject: true,
        startTime: '06:30',
        lessonMinutes: 80,
        subject: a.subject,
      });
      // Ten minutes between the branches: the free teacher's lesson there ends 10 minutes before.
      const [low, high] = [a.branch, b.branch].sort();
      await t.database.migrator
        .insertInto('travel_times')
        .values({ branch_low: low ?? '', branch_high: high ?? '', minutes: 10 })
        .execute();
      const candidateSubject =
        subjectOfCandidates === 'same' ? a.subject : await load.classes.subject({ grades: [7] });
      // Busy: teaches B's lesson 2 (08:00–09:20), which meets A's lesson 1 at clock time.
      const busy = await load.teacher(a.branch, {
        subjects: [{ subject: candidateSubject, grades: [7] }],
      });
      // Free: teaches B's lesson 1 (06:30–07:50), the same lesson number as A's, at another time.
      const free = await load.teacher(a.branch, {
        subjects: [{ subject: candidateSubject, grades: [7] }],
      });
      for (const one of [busy, free]) {
        await hoursOf(t, a.branch, one.staffId);
        await t.database.migrator
          .insertInto('staff_branches')
          .values({ staff_id: one.staffId, branch_id: b.branch, is_main: false })
          .execute();
      }
      const onMonday = async (classId: string, subjectId: string) =>
        (await lessonsOf(classId, subjectId, '2026-11-16', '2026-11-16'))[0]?.id ?? '';
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: busy.staffId })
        .where('id', '=', await onMonday(b.otherClass, b.secondSubject ?? ''))
        .execute();
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: free.staffId })
        .where('id', '=', await onMonday(b.otherClass, b.subject))
        .execute();
      const lesson = await onMonday(a.classId, a.subject);
      return { a, b, busy: busy.staffId, free: free.staffId, lesson };
    }

    const adminOf = (branch: string) => ({ cookie: t.admin, branch, role: 'super_admin' as const });

    it('never offers a teacher whose 80-minute lesson meets the absent teacher’s at clock time, and offers one free then; the substitution is made only on Confirm', async () => {
      const s = await scenes('same');
      await at(NOVEMBER_16);
      const absence = await absent(s.a.branch, s.a.teacher.staffId, '2026-11-16', '2026-11-16');
      const conversation = await ask(adminOf(s.a.branch), [
        calls({ name: SUGGEST_SUBSTITUTES, args: { absenceId: absence } }),
        (sent) => {
          const result = lastResults(sent)[0]?.result as {
            lessons: { lessonId: string; teachers: { id: string }[] }[];
          };
          const offered = result.lessons.find((one) => one.lessonId === s.lesson);
          const chosen = offered?.teachers[0]?.id ?? '';
          return calls({
            name: SUBSTITUTE,
            args: {
              id: s.lesson,
              body: { teacherId: chosen, reason: 'Ill' },
              summary: 'Substitute.',
            },
          })(sent, 'region');
        },
        answer('Proposed.'),
      ]);
      const result = given(model, SUGGEST_SUBSTITUTES) as {
        lessons: {
          lessonId: string;
          time: string;
          teachers: { id: string; lessonsThatDay: number }[];
        }[];
      };
      const forLesson = result.lessons.find((one) => one.lessonId === s.lesson);
      expect(forLesson?.time).toBe('08:00–08:45');
      const ids = forLesson?.teachers.map((one) => one.id) ?? [];
      expect(ids).toContain(s.free);
      expect(ids).not.toContain(s.busy);
      const teacherOf = async () =>
        (
          await t.database.migrator
            .selectFrom('lessons')
            .select('teacher_id')
            .where('id', '=', s.lesson)
            .executeTakeFirstOrThrow()
        ).teacher_id;
      const before = await teacherOf();
      const proposal = conversation.proposals.at(-1);
      expect(proposal?.steps).toHaveLength(1);
      const confirmed = await confirm(proposal?.id ?? '', adminOf(s.a.branch));
      expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 600)).toBe(200);
      const after = await teacherOf();
      expect(before).toBe(s.a.teacher.staffId);
      expect(ids.includes(after ?? '')).toBe(true);
      expect(after).not.toBe(before);
    });

    it('when no teacher of the subject is free, the fallback list still never holds a teacher busy at that clock time, and names the warnings', async () => {
      const s = await scenes('other');
      await at(NOVEMBER_16);
      // Every teacher of the subject is away or teaching then.
      await absent(s.a.branch, s.a.spareTeacher.staffId, '2026-11-16', '2026-11-16');
      const absence = await absent(s.a.branch, s.a.teacher.staffId, '2026-11-16', '2026-11-16');
      await ask(adminOf(s.a.branch), [
        calls({ name: SUGGEST_SUBSTITUTES, args: { absenceId: absence } }),
        answer('Here.'),
      ]);
      const result = given(model, SUGGEST_SUBSTITUTES) as {
        lessons: {
          lessonId: string;
          noSubjectTeacherFree: boolean;
          teachers: { id: string; warnings: string[] }[];
        }[];
      };
      const forLesson = result.lessons.find((one) => one.lessonId === s.lesson);
      expect(forLesson?.noSubjectTeacherFree).toBe(true);
      const free = forLesson?.teachers.find((one) => one.id === s.free);
      expect(free?.warnings).toContain('teacher_subject');
      expect(forLesson?.teachers.map((one) => one.id)).not.toContain(s.busy);
    });
  });
});
