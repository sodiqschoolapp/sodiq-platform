import {
  journalGridSchema,
  studentLeavingResultsSchema,
  type StudentLeavingResults,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from './cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const resultsOf = (response: Response): StudentLeavingResults => {
  expect(response.status, JSON.stringify(response.body).slice(0, 500)).toBe(200);
  return studentLeavingResultsSchema.parse(response.body);
};

// All names are invented. Task 8.6, pull request #224: the results at leaving on the
// student's record (docs/spec/edge-cases/calculation.md, "A student left the school before
// the quarter ended": "A 'result at leaving' is stored on the profile: partial, labelled,
// with the number of lessons"; decisions 5 and 14 with correction 4 of the plan review).
describe('the results at leaving (edge/calculation, a result at leaving)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Feruza', `Ahmedova${'a'.repeat(names % 5)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };

  async function as<T>(
    browser: Browser,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (get: (branch: string, path: string) => Promise<Response>) => Promise<T>,
    moment = MOMENT,
  ): Promise<T> {
    for (const held of roles) {
      await t.kit.giveRole(browser.account.id, {
        ...held,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
    }
    t.clock.set(moment);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
        .where('account_id', '=', browser.account.id)
        .execute();
      return await work((branch, path) => t.get(path, branch, browser.cookie));
    } finally {
      t.clock.set(START);
    }
  }

  const saveAt = async (
    branch: string,
    moment: string,
    cells: { lessonId: string; studentId: string; workId?: string; value: number }[],
  ) => {
    t.clock.set(moment);
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
      t.clock.set(START);
    }
  };

  /**
   * A graded maths scene with Yulduz, who left with the last day Tuesday 20 October:
   * present on the 12th with a classwork 6 of 10, nothing yet on the 19th; the lesson of
   * the 26th is after the leaving. Her classmate Komil stays.
   */
  async function leftScene(accounts?: { readonly teacher?: string; readonly spare?: string }) {
    const scene = await publishedScene(t, load, {
      graded: true,
      ...(accounts === undefined ? {} : { accounts }),
    });
    const lessons = await t.database.migrator
      .selectFrom('lessons')
      .select(['id', sql<string>`lesson_date::text`.as('date')])
      .where('class_id', '=', scene.classId)
      .where('lesson_date', '<=', '2026-10-31')
      .orderBy('starts_at')
      .execute();
    const [first, second] = lessons;
    if (first === undefined || second === undefined) throw new Error('Two lessons.');
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const left = await members.student(scene.branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: 'Yulduz', last_name: 'Sobirova' })
      .where('id', '=', left)
      .execute();
    const stays = await members.student(scene.branch, { startsOn: '2026-09-01', grade: 7 });
    await members.member({
      branch: scene.branch,
      classId: scene.classId,
      studentId: stays,
      from: '2026-09-01',
    });
    const leavingId = await members.leaving(t.database.migrator, scene.branch, left, '2026-10-21');
    await members.member({
      branch: scene.branch,
      classId: scene.classId,
      studentId: left,
      from: '2026-09-01',
      until: '2026-10-21',
      endedBy: 'leaving',
      leavingId,
    });
    const work = (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: scene.branch, lesson_id: first.id, kind: 'classwork', total: 10 })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await saveAt(scene.branch, `${first.date}T18:00:00+05:00`, [
      { lessonId: first.id, studentId: left, value: 1 },
      { lessonId: first.id, studentId: left, workId: work, value: 6 },
    ]);
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', scene.classId)
        .executeTakeFirstOrThrow()
    ).id;
    const subject = await t.database.migrator
      .selectFrom('subjects')
      .select(['name_en'])
      .where('id', '=', scene.subject)
      .executeTakeFirstOrThrow();
    return { scene, left, stays, journal, lessons: { first, second }, subject };
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('works the result out on read, and a save after the leaving inside the edit period changes it', async () => {
    const s = await leftScene();
    const browser = await account();
    const path = `/api/people/students/${s.left}/leaving-results`;
    await as(
      browser,
      [{ role: 'principal', branchId: s.scene.branch }],
      async (get) => {
        const answer = resultsOf(await get(s.scene.branch, path));
        expect(answer.lastDay).toBe('2026-10-20');
        // Attendance 100 (the 19th has no mark), classwork 60: (20 × 100 + 40 × 60) ÷ 60 =
        // 73.3; homework left out; based on 2 of the 2 lessons up to the last day (the 26th
        // is after the leaving and counts in no N).
        expect(answer.results).toEqual([
          {
            subject: expect.objectContaining({ id: s.scene.subject }) as unknown,
            unit: { kind: 'class', id: s.scene.classId, name: expect.any(String) as unknown },
            quarter: { id: expect.any(String) as unknown, number: 1 },
            lastDay: '2026-10-20',
            countsFrom: null,
            outcome: {
              kind: 'number',
              shown: 73,
              grade: 4,
              provisional: true,
              leftOut: ['homework'],
              basedOn: { expected: 2, held: 2 },
            },
          },
        ]);
      },
      '2026-10-21T12:00:00+05:00',
    );
    // The teacher enters the absence of the 19th the day after the leaving.
    await saveAt(s.scene.branch, '2026-10-21T18:00:00+05:00', [
      { lessonId: s.lessons.second.id, studentId: s.left, value: 0 },
    ]);
    await as(browser, [], async (get) => {
      const answer = resultsOf(await get(s.scene.branch, path));
      // Attendance 50: (20 × 50 + 40 × 60) ÷ 60 = 56.7.
      expect(answer.results.map((one) => one.outcome)).toEqual([
        {
          kind: 'number',
          shown: 57,
          grade: 3,
          provisional: true,
          leftOut: ['homework'],
          basedOn: { expected: 2, held: 2 },
        },
      ]);
      // The journal shows the same result at leaving, folded and labelled.
      const grid = journalGridSchema.parse(
        (await get(s.scene.branch, `/api/journal/journals/${s.journal}`)).body,
      );
      const row = grid.students.find((one) => one.id === s.left);
      expect(row?.folded).toBe(true);
      expect(row?.atLeaving).toBe('2026-10-20');
      expect(row?.quarter?.result).toMatchObject({
        kind: 'number',
        shown: 57,
        basedOn: { expected: 2, held: 2 },
      });
    });
    // Nothing is written by a read.
    const audited = await t.database.migrator
      .selectFrom('audit_log')
      .select('id')
      .where('record_id', '=', s.left)
      .where('action', 'like', '%leaving_result%')
      .execute();
    expect(audited).toEqual([]);
  });

  it('answers no result for a student who has not left', async () => {
    const s = await leftScene();
    await as(await account(), [{ role: 'principal', branchId: s.scene.branch }], async (get) => {
      expect(
        resultsOf(await get(s.scene.branch, `/api/people/students/${s.stays}/leaving-results`)),
      ).toEqual({ lastDay: null, results: [] });
    });
  });

  it('answers each subject only to a reader who reads its journal whole, and refuses the readers outside the record', async () => {
    const s = await leftScene();
    const path = `/api/people/students/${s.left}/leaving-results`;
    const elsewhere = await load.classes.subject({ grades: [7] });
    const cases: { held: Omit<Held, 'validFrom'>; status: number; subjects: number }[] = [
      { held: { role: 'super_admin' }, status: 200, subjects: 1 },
      { held: { role: 'principal', branchId: s.scene.branch }, status: 200, subjects: 1 },
      {
        held: { role: 'academic_vice_principal', branchId: s.scene.branch },
        status: 200,
        subjects: 1,
      },
      {
        held: { role: 'head_teacher', branchId: s.scene.branch, subjectIds: [s.scene.subject] },
        status: 200,
        subjects: 1,
      },
      // A reader of the record who reads no journal of the subject whole: left out.
      {
        held: { role: 'head_teacher', branchId: s.scene.branch, subjectIds: [elsewhere] },
        status: 200,
        subjects: 0,
      },
      {
        held: { role: 'senior_head_teacher', subjectIds: [s.scene.subject] },
        status: 200,
        subjects: 1,
      },
      {
        held: { role: 'senior_head_teacher', subjectIds: [elsewhere] },
        status: 200,
        subjects: 0,
      },
      // The attendance readers (6.2 decision 2) read no result.
      {
        held: { role: 'spiritual_vice_principal', branchId: s.scene.branch },
        status: 200,
        subjects: 0,
      },
      { held: { role: 'head_tutor', branchId: s.scene.branch }, status: 200, subjects: 0 },
      // A Teacher reads the records of the students taught now; a student who left is none.
      { held: { role: 'teacher', branchId: s.scene.branch }, status: 403, subjects: 0 },
      // No role of the area `students`.
      { held: { role: 'nurse', branchId: s.scene.branch }, status: 403, subjects: 0 },
    ];
    for (const one of cases) {
      await as(await account(), [one.held], async (get) => {
        const response = await get(s.scene.branch, path);
        expect(response.status, `${one.held.role} ${JSON.stringify(response.body)}`).toBe(
          one.status,
        );
        if (one.status === 200) {
          expect(resultsOf(response).results.length, one.held.role).toBe(one.subjects);
          expect(resultsOf(response).lastDay).toBe('2026-10-20');
        }
      });
    }
  });

  it('answers the subject to a reader of the record who owned the journal as its Teacher on the last day, and leaves it out for another Teacher', async () => {
    // The Head Tutor and the Spiritual Vice Principal read the record (branch-wide) but the
    // journal only as attendance, so the subject turns on owning the journal on the last day
    // (the teacher of its row in the version in force on 20 October).
    for (const reader of ['head_tutor', 'spiritual_vice_principal'] as const) {
      const owner = await account();
      const spare = await account();
      const s = await leftScene({ teacher: owner.account.id, spare: spare.account.id });
      const path = `/api/people/students/${s.left}/leaving-results`;
      const roles = [
        { role: reader, branchId: s.scene.branch },
        { role: 'teacher' as const, branchId: s.scene.branch },
      ];
      await as(owner, roles, async (get) => {
        const answer = resultsOf(await get(s.scene.branch, path));
        expect(answer.lastDay, reader).toBe('2026-10-20');
        expect(
          answer.results.map((one) => [one.subject.id, one.unit.id, one.outcome.kind]),
          reader,
        ).toEqual([[s.scene.subject, s.scene.classId, 'number']]);
      });
      // A Teacher of the subject with a staff record who does not own the journal (the
      // spare teacher), with the same record reader: left out.
      await as(spare, roles, async (get) => {
        const answer = resultsOf(await get(s.scene.branch, path));
        expect(answer.lastDay, reader).toBe('2026-10-20');
        expect(answer.results, reader).toEqual([]);
      });
      // The record reader alone (no Teacher): left out, so the owning decides above.
      const alone = await account();
      await as(alone, [{ role: reader, branchId: s.scene.branch }], async (get) => {
        expect(resultsOf(await get(s.scene.branch, path)).results, reader).toEqual([]);
      });
    }
  });

  it('refuses the Tutor of the class alone, a student who left being of no class now, and answers a Tutor who also reads the record', async () => {
    const s = await leftScene();
    const path = `/api/people/students/${s.left}/leaving-results`;
    // The Tutor of the class on the last day and still now (from 1 September, no end).
    const tutor = await account();
    await load.classes.person(s.scene.branch, ['uz'], { accountId: tutor.account.id });
    await load.tutorOf(s.scene.branch, s.scene.classId, tutor.account.id);
    await as(tutor, [], async (get) => {
      const response = await get(s.scene.branch, path);
      expect(response.status, JSON.stringify(response.body)).toBe(403);
    });
    // The same Tutor given the Head Tutor's reading of the record: the Tutor reads the class
    // journal whole (6.2: own classes whole), so the subject is answered.
    await as(tutor, [{ role: 'head_tutor', branchId: s.scene.branch }], async (get) => {
      const answer = resultsOf(await get(s.scene.branch, path));
      expect(answer.results.map((one) => one.subject.id)).toEqual([s.scene.subject]);
    });
  });

  it('answers 404 for another branch’s student and an unknown one', async () => {
    const s = await leftScene();
    const other = await leftScene();
    for (const held of [
      { role: 'principal' as const, branchId: s.scene.branch },
      { role: 'super_admin' as const },
    ]) {
      await as(await account(), [held], async (get) => {
        for (const id of [other.left, UNKNOWN]) {
          const response = await get(s.scene.branch, `/api/people/students/${id}/leaving-results`);
          expect(response.status, held.role).toBe(404);
        }
      });
    }
  });
});
