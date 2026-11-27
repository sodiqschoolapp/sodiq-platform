import {
  portalGradesSchema,
  portalHomeworkWeekSchema,
  type PortalGrades,
  type PortalHomeworkWeek,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { ParentsKit } from '../../testing/parents-kit.js';
import { codedItemAt, setCodes } from '../../testing/plan-codes-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Monday 26 October is held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

// All names are invented. Task 11.27 (pull request #399, review round 1, finding 2): the portal's
// Grades (also read by Today, which shows the latest scores of the grades route) and Homework
// answer a code only while its subject's codes are on (`09`, Codes: "in the parent portal";
// "Switching codes off for a subject hides every code of that subject everywhere … and keeps
// them"), and another subject is not affected.
describe('the codes in the parent portal (task 11.27)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let parents: ParentsKit;
  let s: PublishedScene;
  let maths: string;
  let second: string;
  let child: string;
  let parent: { cookie: string; accountId: string };

  const ok = (response: Response): unknown => {
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200);
    return response.body;
  };

  async function get(path: string): Promise<Response> {
    t.clock.set(MOMENT);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
        .where('account_id', '=', parent.accountId)
        .execute();
      return await request(t.kit.server).get(path).set('Cookie', parent.cookie);
    } finally {
      t.clock.set(START);
    }
  }

  const gradesOf = async (): Promise<PortalGrades> =>
    portalGradesSchema.parse(ok(await get(`/api/portal/children/${child}/grades`)));

  const homeworkOf = async (): Promise<PortalHomeworkWeek> =>
    portalHomeworkWeekSchema.parse(
      ok(await get(`/api/portal/children/${child}/homework?date=2026-10-26`)),
    );

  /** Each subject's scores as [title, code], and its homework as [topic, topic code, title, code]. */
  async function shown() {
    const grades = await gradesOf();
    const homework = await homeworkOf();
    const scoresOf = (subjectId: string) =>
      (grades.subjects.find((one) => one.subject.id === subjectId)?.scores ?? []).map((one) => [
        one.kind,
        one.title,
        one.code,
      ]);
    const homeworkOfSubject = (subjectId: string) =>
      homework.homework
        .filter((one) => one.subject.id === subjectId)
        .map((one) => [one.topic, one.topicCode, one.title, one.code]);
    return {
      maths: { scores: scoresOf(s.subject), homework: homeworkOfSubject(s.subject) },
      second: { scores: scoresOf(second), homework: homeworkOfSubject(second) },
    };
  }

  const saveOn = async (
    date: string,
    cells: { lessonId: string; studentId: string; workId?: string; value: number }[],
  ) => {
    t.clock.set(`${date}T18:00:00+05:00`);
    try {
      const writer = await load.classes.account();
      await t.app.get(Transactions).run([s.branch], (transaction) =>
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
      t.clock.set(START);
    }
  };

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    parents = new ParentsKit(t.app, t.database.migrator, await load.classes.account());
    // The other class has maths (Monday slot 1) and a second subject (Monday slot 3), both graded
    // here: the second is made graded with the branch's weights before anything is read.
    s = await publishedScene(t, load, { graded: true, secondSubject: true });
    second = s.secondSubject ?? '';
    await t.database.migrator
      .updateTable('subjects')
      .set({ journal_type: 'graded' })
      .where('id', '=', second)
      .execute();
    const quarters = await t.database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', s.year)
      .execute();
    await t.database.migrator
      .insertInto('subject_quarter_weights')
      .values(
        quarters.map((quarter) => ({
          branch_id: s.branch,
          subject_id: second,
          quarter_id: quarter.id,
          attendance: 20,
          classwork: 40,
          homework: 40,
        })),
      )
      .execute();
    const lessonOn = async (subjectId: string) =>
      (
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('class_id', '=', s.otherClass)
          .where('subject_id', '=', subjectId)
          .where(sql<string>`lesson_date::text`, '=', '2026-10-26')
          .executeTakeFirstOrThrow()
      ).id;
    const journalOf = async (subjectId: string) =>
      (
        await t.database.migrator
          .selectFrom('journals')
          .select('id')
          .where('class_id', '=', s.otherClass)
          .where('subject_id', '=', subjectId)
          .executeTakeFirstOrThrow()
      ).id;
    // The plans of the second journal, as 0117 lays them for a journal of a graded subject (the
    // journal was made while the subject was attendance-only).
    const secondJournal = await journalOf(second);
    for (const quarter of quarters) {
      const plan = await t.database.migrator
        .insertInto('lesson_plans')
        .values({ branch_id: s.branch, quarter_id: quarter.id, subject_id: second })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('lesson_plan_journals')
        .values({
          branch_id: s.branch,
          plan_id: plan.id,
          journal_id: secondJournal,
          quarter_id: quarter.id,
        })
        .execute();
    }
    const mathsLesson = await lessonOn(s.subject);
    const secondLesson = await lessonOn(second);
    maths = await journalOf(s.subject);
    const first = await parents.student(s.branch);
    child = first.studentId;
    await parents.members.member({
      branch: s.branch,
      classId: s.otherClass,
      studentId: child,
      from: '2026-09-01',
    });
    const session = await parents.session(first.relativeId);
    parent = { cookie: session.cookie, accountId: session.account.id };
    // Both subjects' codes on while the codes are written, as a save would leave them.
    await setCodes(t.database.migrator, s.subject, true);
    await setCodes(t.database.migrator, second, true);
    const mathsItem = await codedItemAt(t.database.migrator, {
      branch: s.branch,
      journalId: maths,
      lessonId: mathsLesson,
      topic: 'Fractions',
      topicCode: 'F1',
      works: [
        { kind: 'classwork', title: 'Quiz on fractions', code: 'Q1', total: 10 },
        { kind: 'homework', title: 'Exercise 5', code: 'H1', total: 10 },
      ],
    });
    const secondItem = await codedItemAt(t.database.migrator, {
      branch: s.branch,
      journalId: secondJournal,
      lessonId: secondLesson,
      topic: 'Rivers',
      topicCode: 'G7',
      works: [
        { kind: 'classwork', title: 'Map of rivers', code: 'GM', total: 10 },
        { kind: 'homework', title: 'Essay on rivers', code: 'GE', total: 10 },
      ],
    });
    await saveOn('2026-10-26', [
      { lessonId: mathsLesson, studentId: child, value: 1 },
      ...mathsItem.journalWorks.map((workId) => ({
        lessonId: mathsLesson,
        studentId: child,
        workId,
        value: 8,
      })),
      { lessonId: secondLesson, studentId: child, value: 1 },
      ...secondItem.journalWorks.map((workId) => ({
        lessonId: secondLesson,
        studentId: child,
        workId,
        value: 7,
      })),
    ]);
  }, 600_000);

  afterAll(async () => {
    await t.close();
  });

  const codedMaths = {
    scores: [
      ['classwork', 'Quiz on fractions', 'Q1'],
      ['homework', 'Exercise 5', 'H1'],
    ],
    homework: [['Fractions', 'F1', 'Exercise 5', 'H1']],
  };
  const codedSecond = {
    scores: [
      ['classwork', 'Map of rivers', 'GM'],
      ['homework', 'Essay on rivers', 'GE'],
    ],
    homework: [['Rivers', 'G7', 'Essay on rivers', 'GE']],
  };

  it('answers the codes while on, hides one subject’s while off and keeps the other’s, and shows them again unchanged when on', async () => {
    expect(await shown()).toEqual({ maths: codedMaths, second: codedSecond });

    await setCodes(t.database.migrator, s.subject, false);
    try {
      // Off: the titles and topic stay, every code of maths is `null`; the second subject keeps
      // its codes (Done when: "another subject is not affected").
      expect(await shown()).toEqual({
        maths: {
          scores: [
            ['classwork', 'Quiz on fractions', null],
            ['homework', 'Exercise 5', null],
          ],
          homework: [['Fractions', null, 'Exercise 5', null]],
        },
        second: codedSecond,
      });
      // The whole answer of maths carries none of its codes (nothing else names them).
      const grades = await gradesOf();
      const mathsGrades = JSON.stringify(
        grades.subjects.find((one) => one.subject.id === s.subject),
      );
      for (const code of ['"Q1"', '"H1"']) expect(mathsGrades).not.toContain(code);
    } finally {
      await setCodes(t.database.migrator, s.subject, true);
    }

    // On again: the codes kept are back unchanged.
    expect(await shown()).toEqual({ maths: codedMaths, second: codedSecond });
  });

  it('hides the second subject’s codes while its own switch is off, maths unaffected', async () => {
    await setCodes(t.database.migrator, second, false);
    try {
      expect(await shown()).toEqual({
        maths: codedMaths,
        second: {
          scores: [
            ['classwork', 'Map of rivers', null],
            ['homework', 'Essay on rivers', null],
          ],
          homework: [['Rivers', null, 'Essay on rivers', null]],
        },
      });
    } finally {
      await setCodes(t.database.migrator, second, true);
    }
    expect(await shown()).toEqual({ maths: codedMaths, second: codedSecond });
  });
});
