import { studentResultLessonsSchema, type StudentResultLessons } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { codedItemAt, setCodes } from '../../testing/plan-codes-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

// All names are invented. Task 11.27 (pull request #399, review round 1, finding 2): the lessons
// behind a student's result (`GET /api/results/students/:id/lessons`, the breakdown that the
// assistant's explain_result also reads) answer a work's code only while its subject's codes are
// on (`09`, Codes: "Switching codes off … hides every code of that subject everywhere … and keeps
// them").
describe('the codes in the student results breakdown (task 11.27)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let s: PublishedScene;
  let student: string;
  let q1: string;

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

  /** The breakdown as the Super Admin reads it at the moment. */
  async function breakdown(): Promise<StudentResultLessons> {
    t.clock.set(MOMENT);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
        .execute();
      const answer = await t.get(
        `/api/results/students/${student}/lessons?subjectId=${s.subject}&quarterId=${q1}`,
        s.branch,
      );
      expect(answer.status, JSON.stringify(answer.body).slice(0, 600)).toBe(200);
      return studentResultLessonsSchema.parse(answer.body);
    } finally {
      t.clock.set(START);
    }
  }

  /** Each work of the breakdown as [date, kind, title, code, score]. */
  const worksOf = (found: StudentResultLessons) =>
    found.lessons.flatMap((lesson) => [
      ...lesson.classworks.map((one) => [lesson.date, 'classwork', one.title, one.code, one.score]),
      ...lesson.homeworks.map((one) => [lesson.date, 'homework', one.title, one.code, one.score]),
    ]);

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    s = await publishedScene(t, load, { graded: true });
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
    await saveOn('2026-10-19', [
      { lessonId: lesson, studentId: student, value: 1 },
      ...item.journalWorks.map((workId) => ({
        lessonId: lesson,
        studentId: student,
        workId,
        value: 6,
      })),
    ]);
  }, 600_000);

  afterAll(async () => {
    await t.close();
  });

  const coded = [
    ['2026-10-19', 'classwork', 'Quiz on fractions', 'Q1', 6],
    ['2026-10-19', 'homework', 'Exercise 5', 'H1', 6],
  ];

  it('answers the codes while on, `null` while off with the titles and scores kept, and the same codes when on again', async () => {
    const on = await breakdown();
    expect(on.reading).toBe('whole');
    expect(worksOf(on)).toEqual(coded);

    await setCodes(t.database.migrator, s.subject, false);
    try {
      const off = await breakdown();
      expect(worksOf(off)).toEqual([
        ['2026-10-19', 'classwork', 'Quiz on fractions', null, 6],
        ['2026-10-19', 'homework', 'Exercise 5', null, 6],
      ]);
      const text = JSON.stringify(off);
      for (const code of ['"Q1"', '"H1"', '"F1"']) expect(text).not.toContain(code);
    } finally {
      await setCodes(t.database.migrator, s.subject, true);
    }

    expect(worksOf(await breakdown())).toEqual(coded);
  });
});
