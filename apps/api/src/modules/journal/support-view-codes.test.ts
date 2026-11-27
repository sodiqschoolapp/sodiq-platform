import { journalSupportSchema, type JournalSupport } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { codedItemAt, setCodes } from '../../testing/plan-codes-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from './cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Monday 19 October is held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

// All names are invented. Task 11.27 (pull request #399, review round 1, finding 2): the support
// view (`GET /api/journal/support`, task 8.9) shows the topic code and the works' codes as the grid
// does, in its lessons and in the works its lines name, only while the subject's codes are on
// (`09`, Codes: "Switching codes off … hides every code of that subject everywhere … and keeps
// them").
describe('the codes in the support view (task 11.27)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let s: PublishedScene;
  let journal: string;
  let student: string;
  let works: readonly string[];

  async function support(): Promise<JournalSupport> {
    t.clock.set(MOMENT);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
        .execute();
      const answer = await t.get(
        `/api/journal/support?studentId=${student}&journalId=${journal}&date=2026-10-19`,
        s.branch,
      );
      expect(answer.status, JSON.stringify(answer.body).slice(0, 600)).toBe(200);
      return journalSupportSchema.parse(answer.body);
    } finally {
      t.clock.set(START);
    }
  }

  /** What the view shows of the codes: the lesson's, and those of the works its score lines name. */
  const codesOf = (view: JournalSupport) => ({
    lessons: view.lessons.map((one) => [
      one.lesson.topicCode,
      ...one.lesson.works.map((work) => [work.title, work.code]),
    ]),
    cellLines: works.map((workId) => {
      const found = view.lines.flatMap((line) =>
        line.kind === 'cell' && line.work?.id === workId ? [[line.work.title, line.work.code]] : [],
      );
      // Every line of the work names it the same way; the first stands for them.
      expect(found.length).toBeGreaterThan(0);
      return found[0];
    }),
  });

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    s = await publishedScene(t, load, { graded: true });
    journal = (
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
    works = item.journalWorks;
    t.clock.set('2026-10-19T18:00:00+05:00');
    try {
      const writer = await load.classes.account();
      await t.app.get(Transactions).run([s.branch], (transaction) =>
        saveCells(transaction, t.app.get(Audit), { accountId: writer }, [
          { lessonId: lesson, studentId: student, workId: null, value: 1, version: null },
          ...works.map((workId) => ({
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
    await t.close();
  });

  const coded = {
    lessons: [['F1', ['Quiz on fractions', 'Q1'], ['Exercise 5', 'H1']]],
    cellLines: [
      ['Quiz on fractions', 'Q1'],
      ['Exercise 5', 'H1'],
    ],
  };

  it('shows the codes while on, `null` while off with the titles kept, and the same codes when on again', async () => {
    expect(codesOf(await support())).toEqual(coded);

    await setCodes(t.database.migrator, s.subject, false);
    try {
      const off = await support();
      expect(codesOf(off)).toEqual({
        lessons: [[null, ['Quiz on fractions', null], ['Exercise 5', null]]],
        cellLines: [
          ['Quiz on fractions', null],
          ['Exercise 5', null],
        ],
      });
      // No line or lesson of the view carries a code of the subject.
      const text = JSON.stringify(off);
      for (const code of ['"Q1"', '"H1"', '"F1"']) expect(text).not.toContain(code);
    } finally {
      await setCodes(t.database.migrator, s.subject, true);
    }

    expect(codesOf(await support())).toEqual(coded);
  });
});
