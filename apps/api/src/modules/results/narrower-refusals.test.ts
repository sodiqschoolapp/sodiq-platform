import { studentResultLessonsSchema } from '@sodiq/shared';
import type { Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): unknown =>
  (response.body as { error?: { code?: string } }).error?.code;

// All names are invented. Task 10.3a: the limits inside the routes for the
// whole-branch roles (`narrower`): the Spiritual Vice Principal reads
// attendance only (02; 08, Who sees it), and the Head Tutor ranks the students
// of a class, not a journal in one subject nor the classes of the branch
// (08, Rating; task 9.3a, decision 1).
describe('the results routes held narrower for a whole-branch role', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  /** A new account holding the role in the branch from 1 September, its session in use at MOMENT. */
  const reader = async (
    role: 'spiritual_vice_principal' | 'head_tutor' | 'principal',
    branchId: string,
  ) => {
    names += 1;
    const browser = await t.kit.completeSession('Sevara', `Nazarova${'a'.repeat(names % 7)}`);
    // An assignment in the branch of the request: the guard lets the role in.
    await t.kit.giveRole(browser.account.id, {
      role,
      branchId,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    t.clock.set(MOMENT);
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
      .where('account_id', '=', browser.account.id)
      .execute();
    return browser;
  };

  const quarterOf = async (scene: PublishedScene, number: number) =>
    (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', scene.year)
        .where('number', '=', number)
        .executeTakeFirstOrThrow()
    ).id;

  const journalOf = async (classId: string) =>
    (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', classId)
        .executeTakeFirstOrThrow()
    ).id;

  /** The graded scene with one student, present on the first lesson with a classwork 9 of 10. */
  async function scene() {
    const s = await publishedScene(t, load, { graded: true });
    const lesson = await t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('class_id', '=', s.classId)
      .where('lesson_date', '<=', '2026-10-31')
      .orderBy('starts_at')
      .executeTakeFirstOrThrow();
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const student = await members.student(s.branch, { startsOn: '2026-09-01', grade: 7 });
    await members.member({
      branch: s.branch,
      classId: s.classId,
      studentId: student,
      from: '2026-09-01',
    });
    const work = (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: s.branch, lesson_id: lesson.id, kind: 'classwork', total: 10 })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    t.clock.set(MOMENT);
    try {
      const writer = await load.classes.account();
      await t.app.get(Transactions).run([s.branch], (transaction) =>
        saveCells(transaction, t.app.get(Audit), { accountId: writer }, [
          { lessonId: lesson.id, studentId: student, workId: null, value: 1, version: null },
          { lessonId: lesson.id, studentId: student, workId: work, value: 9, version: null },
        ]),
      );
    } finally {
      t.clock.set(START);
    }
    return { s, student, work, q1: await quarterOf(s, 1), journal: await journalOf(s.classId) };
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterEach(() => {
    t.clock.set(START);
  });

  afterAll(async () => {
    await t.close();
  });

  it('answers the Spiritual Vice Principal the marks behind a figure, never the works', async () => {
    const c = await scene();
    const path = `/api/results/students/${c.student}/lessons?subjectId=${c.s.subject}&quarterId=${c.q1}`;
    // The Principal reads the same lesson whole, with the classwork: the fixture holds a work.
    const principal = await reader('principal', c.s.branch);
    const whole = studentResultLessonsSchema.parse(
      (await t.get(path, c.s.branch, principal.cookie)).body,
    );
    expect(whole.reading).toBe('whole');
    expect(whole.lessons.some((one) => one.classworks.some((cw) => cw.workId === c.work))).toBe(
      true,
    );

    const spiritual = await reader('spiritual_vice_principal', c.s.branch);
    const response = await t.get(path, c.s.branch, spiritual.cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const answer = studentResultLessonsSchema.parse(response.body);
    expect(answer.reading).toBe('attendance');
    expect(answer.lessons.length).toBeGreaterThan(0);
    expect(answer.lessons.every((one) => one.classworks.length === 0)).toBe(true);
    expect(JSON.stringify(answer)).not.toContain(c.work);
  });

  it('refuses the Head Tutor the export of a subject list and of the classes list, with nothing logged', async () => {
    const c = await scene();
    const headTutor = await reader('head_tutor', c.s.branch);
    const logged = async () =>
      t.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', 'rating.export')
        .execute();
    const before = await logged();

    for (const body of [
      { kind: 'subject', quarterId: c.q1, journalId: c.journal },
      { kind: 'classes', quarterId: c.q1 },
    ]) {
      const response = await t.post(
        '/api/results/rating/export',
        c.s.branch,
        body,
        headTutor.cookie,
      );
      expect(response.status, body.kind).toBe(403);
      expect(codeOf(response), body.kind).toBe('permission_denied');
    }
    expect(await logged()).toEqual(before);

    // The class list is the Head Tutor's: the same reader is let in there.
    const own = await t.post(
      '/api/results/rating/export',
      c.s.branch,
      { kind: 'class', quarterId: c.q1, classId: c.s.classId },
      headTutor.cookie,
    );
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(await logged()).toHaveLength(before.length + 1);
  });
});
