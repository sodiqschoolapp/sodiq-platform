import { assistantConversationSchema, BRANCH_HEADER, type AssistantRole } from '@sodiq/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { answer, calls, FakeModel, lastResults } from '../../testing/assistant-model.js';
import { settle } from '../../testing/assistant-kit.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { codedItemAt, setCodes } from '../../testing/plan-codes-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';
import { EXPLAIN_RESULT } from './helpers.js';

/** Monday 26 October 2026, 07:00 in Tashkent: the Mondays 12 and 19 are held. */
const MONDAY_26 = '2026-10-26T07:00:00+05:00';

// All names are invented. Task 11.27 (pull request #399, review round 1, finding 2): the breakdown
// explain_result gives the model (task 11.23) names each work with its code only while the
// subject's codes are on (`09`, Codes: "Switching codes off … hides every code of that subject
// everywhere, exports and the API included, and keeps them").
describe('the codes in the assistant’s explain_result (task 11.27)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  const model = new FakeModel();
  let s: PublishedScene;
  let vice: { cookie: string; account: { id: string } };
  let student: string;
  let q1: string;

  /** What explain_result gave the model, from the request after its call. */
  function given(): Record<string, unknown> {
    for (const sent of [...model.requests].reverse()) {
      const found = lastResults(sent).find((one) => one.name === EXPLAIN_RESULT);
      if (found !== undefined) return found.result as Record<string, unknown>;
    }
    throw new Error('explain_result gave nothing');
  }

  /** Asks for the explanation as the Academic Vice Principal and gives back the breakdown read. */
  async function explained(): Promise<{
    classworks: { title: unknown; code: unknown; score: unknown }[];
    homeworks: { title: unknown; code: unknown; score: unknown }[];
  }> {
    t.clock.set(MONDAY_26);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(MONDAY_26), last_used_at: new Date(MONDAY_26) })
        .execute();
      model.requests.length = 0;
      model.script(
        calls({
          name: EXPLAIN_RESULT,
          args: { studentId: student, subjectId: s.subject, quarterId: q1 },
        }),
        answer('Here is the breakdown.'),
      );
      const response = await request(t.kit.server)
        .post('/api/assistant/questions')
        .set('Cookie', vice.cookie)
        .set(BRANCH_HEADER, s.branch)
        .send({
          role: 'academic_vice_principal' satisfies AssistantRole,
          text: 'Why this result?',
        });
      expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(202);
      await settle(t.app, response, vice.cookie, s.branch);
      assistantConversationSchema.parse((response.body as { conversation: unknown }).conversation);
      return given() as Awaited<ReturnType<typeof explained>>;
    } finally {
      t.clock.set(START);
    }
  }

  const worksOf = (found: Awaited<ReturnType<typeof explained>>) => [
    ...found.classworks.map((one) => ['classwork', one.title, one.code, one.score]),
    ...found.homeworks.map((one) => ['homework', one.title, one.code, one.score]),
  ];

  beforeAll(async () => {
    t = await dayTemplatesKit({ assistantModel: model, listen: true, jobs: true });
    load = new LoadKit(t.database.migrator);
    await t.database.migrator
      .updateTable('assistant_settings')
      .set({ school_on: true, roles_on: ['academic_vice_principal'] })
      .execute();
    vice = await t.kit.completeSession('Gulnora', 'Karimova');
    s = await publishedScene(t, load, { graded: true });
    await t.kit.giveRole(vice.account.id, {
      role: 'academic_vice_principal',
      branchId: s.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    q1 = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .executeTakeFirstOrThrow()
    ).id;
    const lesson = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .where(sql<string>`lesson_date::text`, '=', '2026-10-19')
        .executeTakeFirstOrThrow()
    ).id;
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    student = await members.student(s.branch, { startsOn: '2026-09-01', grade: 7 });
    await members.member({
      branch: s.branch,
      studentId: student,
      classId: s.classId,
      from: '2026-09-01',
    });
    await setCodes(t.database.migrator, s.subject, true);
    const item = await codedItemAt(t.database.migrator, {
      branch: s.branch,
      journalId: journal,
      lessonId: lesson,
      topic: 'Fractions',
      topicCode: 'F1',
      works: [
        { kind: 'classwork', title: 'Quiz on fractions', code: 'Q1', total: 10 },
        { kind: 'homework', title: 'Exercise 5', code: 'H1', total: 10 },
      ],
    });
    t.clock.set('2026-10-19T18:00:00+05:00');
    try {
      const writer = await load.classes.account();
      await t.app.get(Transactions).run([s.branch], (transaction) =>
        saveCells(transaction, t.app.get(Audit), { accountId: writer }, [
          { lessonId: lesson, studentId: student, workId: null, value: 1, version: null },
          ...item.journalWorks.map((workId) => ({
            lessonId: lesson,
            studentId: student,
            workId,
            value: 6,
            version: null,
          })),
        ]),
      );
    } finally {
      t.clock.set(START);
    }
  }, 600_000);

  afterAll(async () => {
    t.clock.set(START);
    await t.close();
  });

  const coded = [
    ['classwork', 'Quiz on fractions', 'Q1', 6],
    ['homework', 'Exercise 5', 'H1', 6],
  ];

  it('gives the model the codes while on, `null` while off with the titles and scores kept, and the same codes when on again', async () => {
    expect(worksOf(await explained())).toEqual(coded);

    await setCodes(t.database.migrator, s.subject, false);
    try {
      const off = await explained();
      expect(worksOf(off)).toEqual([
        ['classwork', 'Quiz on fractions', null, 6],
        ['homework', 'Exercise 5', null, 6],
      ]);
      // Nothing the model was given in that turn names a code of the subject.
      const text = JSON.stringify(model.requests.map((sent) => lastResults(sent)));
      for (const code of ['"Q1"', '"H1"', '"F1"']) expect(text).not.toContain(code);
    } finally {
      await setCodes(t.database.migrator, s.subject, true);
    }

    expect(worksOf(await explained())).toEqual(coded);
  });
});
