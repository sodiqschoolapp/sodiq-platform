import {
  JOURNAL_EXPORT_TEXTS,
  closingChecklistSchema,
  journalGridSchema,
  ratingSubjectListSchema,
  studentResultsSchema,
  type JournalGrid,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { closeQuarter } from '../../testing/closing-kit.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from './cells.js';
import { legendLines } from './journal-export.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): unknown =>
  (response.body as { error?: { code?: string } }).error?.code;

// All names are invented. The owner's spec change of 10 November 2026 (`05`, Grading weights on a
// subject, Grades 0 and 1; `edge/00-definitions`, Rating journal; 0168): a rating subject has its
// rating exam in grades 2–11 only. 1 London's Mathematics journal has no rating exam column, and
// its quarter result uses the subject's quarterly distribution with the rating exam left out, the
// other weights scaled up, never provisional for it; 2 Oxford's and 7 Oxford's keep the exam.
// There is no setting and no second distribution.
describe('rating exams in grades 2–11 through the routes', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let mathematics: string;

  /** Runs `work` with the clock at MOMENT and the sessions used then. */
  const at = async <T>(work: () => Promise<T>): Promise<T> => {
    t.clock.set(MOMENT);
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
      .execute();
    try {
      return await work();
    } finally {
      t.clock.set(START);
    }
  };

  const saveOn = async (
    branch: string,
    date: string,
    cells: { lessonId: string; studentId: string; workId?: string; value: number }[],
  ) => {
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
      t.clock.set(START);
    }
  };

  /**
   * A published scene of Mathematics (A 20 · CW 30 · HW 30 · RE 20) in a class of `grade`, with
   * one student present on the 12th with 9 of 10 in classwork and absent on the 19th: attendance
   * 50, classwork 90, homework 80 (given and checked on the 12th).
   */
  async function scene(grade: number) {
    const s = await publishedScene(t, load, {
      graded: true,
      ratingExam: true,
      subject: mathematics,
      grade,
    });
    const [l12, l19] = await t.database.migrator
      .selectFrom('lessons')
      .select(['id', sql<string>`lesson_date::text`.as('date')])
      .where('class_id', '=', s.classId)
      .where('lesson_date', '<=', '2026-10-31')
      .orderBy('starts_at')
      .execute();
    if (l12 === undefined || l19 === undefined) throw new Error('Two lessons.');
    const kit = new MembersKit(t.database.migrator, await load.classes.account());
    const student = await kit.student(s.branch, { startsOn: '2026-09-01', grade });
    await kit.member({
      branch: s.branch,
      classId: s.classId,
      studentId: student,
      from: '2026-09-01',
    });
    const workOf = async (kind: 'classwork' | 'homework') =>
      (
        await t.database.migrator
          .insertInto('journal_works')
          .values({ branch_id: s.branch, lesson_id: l12.id, kind, total: 10 })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    const work = await workOf('classwork');
    const homework = await workOf('homework');
    await saveOn(s.branch, l12.date, [
      { lessonId: l12.id, studentId: student, value: 1 },
      { lessonId: l12.id, studentId: student, workId: work, value: 9 },
      { lessonId: l12.id, studentId: student, workId: homework, value: 8 },
    ]);
    await saveOn(s.branch, l19.date, [{ lessonId: l19.id, studentId: student, value: 0 }]);
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .executeTakeFirstOrThrow()
    ).id;
    const quarters = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .orderBy('number')
        .execute()
    ).map((one) => one.id);
    return { s, student, journal, quarters };
  }

  let viceCount = 0;
  /** An Academic Vice Principal of the branch: the rating exam's date and entries are theirs. */
  const viceOf = async (branch: string) => {
    viceCount += 1;
    const vice = await t.kit.completeSession('Dilnoza', `Karimova${'a'.repeat(viceCount)}`);
    await t.kit.giveRole(vice.account.id, { role: 'academic_vice_principal', branchId: branch });
    return vice.cookie;
  };

  const gridOf = async (branch: string, journal: string, quarterId?: string) => {
    const response = await at(() =>
      t.get(
        `/api/journal/journals/${journal}${quarterId === undefined ? '' : `?quarterId=${quarterId}`}`,
        branch,
      ),
    );
    expect(response.status, JSON.stringify(response.body).slice(0, 500)).toBe(200);
    return journalGridSchema.parse(response.body);
  };

  const shownOf = (grid: JournalGrid, student: string) =>
    grid.students.find((one) => one.id === student)?.quarter?.result;

  const checklistOf = async (branch: string, quarterId: string) => {
    const response = await at(() => t.get(`/api/results/closing?quarterId=${quarterId}`, branch));
    expect(response.status, JSON.stringify(response.body).slice(0, 500)).toBe(200);
    return closingChecklistSchema.parse(response.body);
  };

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    mathematics = await load.classes.subject({ grades: [1, 2, 7], name: 'Mathematics' });
    await t.database.migrator
      .updateTable('subjects')
      .set({ rating_exam: true })
      .where('id', '=', mathematics)
      .execute();
  });

  afterAll(async () => {
    await t.close();
  });

  it('gives 1 London no rating exam and its quarter result with the exam left out, not provisional for it', async () => {
    const london = await scene(1);
    const grid = await gridOf(london.s.branch, london.journal);
    expect(grid.journal.ratingExam).toBe(false);
    expect(grid.rating).toBeNull();
    // The subject's one distribution, as stored.
    expect(grid.legend.quarterly).toEqual({
      attendance: 20,
      classwork: 30,
      homework: 30,
      ratingExam: 20,
    });
    // (20 × 50 + 30 × 90 + 30 × 80) ÷ 80 = 76.25: every other part has data, so only the rating
    // exam could make it provisional; it is left out by the rule and never named.
    const shown = shownOf(grid, london.student);
    expect(shown).toMatchObject({ kind: 'number', shown: 76, provisional: false });
    expect(shown?.kind === 'number' ? shown.leftOut : ['missing']).toEqual([]);
    // The closing checklist misses no rating exam entry and no weights of 1 London.
    const list = await checklistOf(london.s.branch, london.quarters[0] ?? '');
    expect(list.items.filter((item) => item.kind === 'rating_missing')).toEqual([]);
    expect(list.items.filter((item) => item.kind === 'weights_missing')).toEqual([]);
    // A rating exam date and an entry of the grade 1 journal are refused.
    const vice = await viceOf(london.s.branch);
    const date = await at(() =>
      t.put(
        `/api/journal/journals/${london.journal}/rating/${london.quarters[0] ?? ''}/date`,
        london.s.branch,
        { date: '2026-10-12', version: null },
        vice,
      ),
    );
    expect([date.status, codeOf(date)]).toEqual([409, 'rating_exam_off']);
    const exempt = await at(() =>
      t.post(
        `/api/journal/journals/${london.journal}/rating/${london.quarters[0] ?? ''}/entries`,
        london.s.branch,
        { studentId: london.student, entry: { kind: 'exempt' }, reason: null, version: null },
        vice,
      ),
    );
    expect([exempt.status, codeOf(exempt)]).toEqual([409, 'rating_exam_off']);
  });

  // The rating and the prepared totals read the outcomes through `quarterOutcomes` (the review of
  // #318: every reader of the rating entry is tested): 1 London's student ranks with 76.25.
  it('ranks 1 London in the subject rating with the rating exam left out', async () => {
    const london = await scene(1);
    const response = await at(() =>
      t.get(
        `/api/results/rating/subject?quarterId=${london.quarters[0] ?? ''}&journalId=${london.journal}`,
        london.s.branch,
      ),
    );
    expect(response.status, JSON.stringify(response.body).slice(0, 500)).toBe(200);
    const list = ratingSubjectListSchema.parse(response.body);
    expect(list.rows.map((row) => [row.student.id, row.state, row.value, row.place])).toEqual([
      [london.student, 'number', 763, 1],
    ]);
  });

  // The review of #318: the journal's file states the weights as the grid's legend does.
  it('says in the legend of the journal file of 1 London that the rating exam is left out', async () => {
    const london = await scene(1);
    const grid = await gridOf(london.s.branch, london.journal);
    const file = (language: 'en' | 'ru' | 'uz') =>
      legendLines(
        { grid, month: null, language, timeZone: 'Asia/Tashkent', asOf: new Date(MOMENT) },
        JOURNAL_EXPORT_TEXTS[language],
      );
    expect(file('en')).toContain(
      'Quarter: attendance 20 · classwork 30 · homework 30; no rating exam in grades 0 and 1, the other weights scaled up',
    );
    for (const language of ['ru', 'uz'] as const) {
      expect(file(language), language).toContain(
        JOURNAL_EXPORT_TEXTS[language].legend.quarterlyNoRating
          .replace('{{attendance}}', '20')
          .replace('{{classwork}}', '30')
          .replace('{{homework}}', '30'),
      );
    }
    // 7 Oxford's file names its rating exam.
    const oxford = await scene(7);
    const rated = legendLines(
      {
        grid: await gridOf(oxford.s.branch, oxford.journal),
        month: null,
        language: 'en',
        timeZone: 'Asia/Tashkent',
        asOf: new Date(MOMENT),
      },
      JOURNAL_EXPORT_TEXTS.en,
    );
    expect(rated).toContain('Quarter: attendance 20 · classwork 30 · homework 30 · rating exam 20');
  });

  it('keeps the rating exam of 2 Oxford and 7 Oxford, provisional while it has no score', async () => {
    for (const grade of [2, 7]) {
      const oxford = await scene(grade);
      const grid = await gridOf(oxford.s.branch, oxford.journal);
      expect(grid.journal.ratingExam, `grade ${String(grade)}`).toBe(true);
      const shown = shownOf(grid, oxford.student);
      // The same 76, provisional while the rating exam has no score.
      expect(shown).toMatchObject({ kind: 'number', shown: 76, provisional: true });
      expect(shown?.kind === 'number' ? shown.leftOut : []).toContain('ratingExam');
      const list = await checklistOf(oxford.s.branch, oxford.quarters[0] ?? '');
      expect(
        list.items.filter((item) => item.kind === 'rating_missing').map((item) => item.journal?.id),
      ).toEqual([oxford.journal]);
    }
  });

  // The review of #318 (the rules of the API: a refusal mapped from the database is reached through
  // each route that maps it): the group edit, the group restore and the class edit.
  it('refuses a class added to a group of grade 1 that makes grades 1 and 2, at the group edit', async () => {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    const first = await load.classes.schoolClass(branch, year, { grade: 1 });
    const second = await load.classes.schoolClass(branch, year, { grade: 2 });
    const created = await at(() =>
      t.post('/api/groups', branch, {
        academicYearId: year,
        subjectId: mathematics,
        classIds: [first],
        name: 'Maths 1',
        language: 'uz',
        maxSize: 20,
      }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const group = created.body as { id: string; version: number };
    const edited = await at(() =>
      t.put(`/api/groups/${group.id}`, branch, {
        classIds: [first, second],
        name: 'Maths 1',
        language: 'uz',
        maxSize: 20,
        version: group.version,
      }),
    );
    expect([edited.status, codeOf(edited)]).toEqual([409, 'groups_rating_grades_span']);
  });

  it('refuses the restore of a group of grades 1 and 2 whose subject has the rating exam since its archive', async () => {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    const reading = await load.classes.subject({ grades: [1, 2], journalType: 'graded' });
    const first = await load.classes.schoolClass(branch, year, { grade: 1 });
    const second = await load.classes.schoolClass(branch, year, { grade: 2 });
    const created = await at(() =>
      t.post('/api/groups', branch, {
        academicYearId: year,
        subjectId: reading,
        classIds: [first, second],
        name: 'Reading 1-2',
        language: 'uz',
        maxSize: 20,
      }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const group = created.body as { id: string };
    const archived = await at(() => t.post(`/api/groups/${group.id}/archive`, branch));
    expect(archived.status, JSON.stringify(archived.body)).toBeLessThan(300);
    // An archived group refuses nothing: the subject takes the rating exam.
    await t.database.migrator
      .updateTable('subjects')
      .set({ rating_exam: true })
      .where('id', '=', reading)
      .execute();
    const restored = await at(() =>
      t.post(`/api/groups/${group.id}/restore`, branch, { confirmMixedLanguage: false }),
    );
    expect([restored.status, codeOf(restored)]).toEqual([409, 'groups_rating_grades_span']);
  });

  it('refuses a class moved from grade 2 into 1 at its route while a quarter of its year is closed', async () => {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    const second = await load.classes.schoolClass(branch, year, { grade: 2 });
    await t.database.migrator
      .insertInto('journals')
      .values({
        branch_id: branch,
        academic_year_id: year,
        class_id: second,
        subject_id: mathematics,
        runs: sql`'{[2026-09-01,)}'::datemultirange`,
      })
      .execute();
    const quarter = await t.database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', year)
      .where('number', '=', 1)
      .executeTakeFirstOrThrow();
    await closeQuarter(t.database, {
      branchId: branch,
      quarterId: quarter.id,
      accountId: await load.classes.account(),
    });
    const row = await t.database.migrator
      .selectFrom('classes')
      .select(['name', 'language', 'main_room_id', 'max_size', 'version'])
      .where('id', '=', second)
      .executeTakeFirstOrThrow();
    const edited = await at(() =>
      t.put(`/api/classes/${second}`, branch, {
        grade: 1,
        name: row.name,
        language: row.language,
        mainRoomId: row.main_room_id,
        maxSize: row.max_size,
        version: row.version,
      }),
    );
    expect([edited.status, codeOf(edited)]).toEqual([409, 'class_grade_rating_primary']);
  });

  it('closes 1 London without exam scores, and its stored result names no rating exam left out', async () => {
    const london = await scene(1);
    const [q1] = london.quarters;
    await closeQuarter(t.database, {
      branchId: london.s.branch,
      quarterId: q1 ?? '',
      accountId: await load.classes.account(),
    });
    const closed = await gridOf(london.s.branch, london.journal, q1);
    expect(closed.journal.ratingExam).toBe(false);
    const shown = shownOf(closed, london.student);
    expect(shown).toMatchObject({ kind: 'number', shown: 76, provisional: false });
    expect(shown?.kind === 'number' ? shown.leftOut : []).not.toContain('ratingExam');
    // The student's results page reads the same: no rating exam part, none left out.
    const results = await at(() =>
      t.get(`/api/results/students/${london.student}`, london.s.branch),
    );
    expect(results.status, JSON.stringify(results.body).slice(0, 500)).toBe(200);
    const row = studentResultsSchema
      .parse(results.body)
      .subjects.find((one) => one.subject.id === mathematics)
      ?.quarters.find((one) => one.quarterId === q1);
    expect(row?.ratingShown).toBe(false);
    expect(row?.outcome).toMatchObject({ kind: 'number', shown: 76 });
    expect(row?.outcome.kind === 'number' ? row.outcome.leftOut : ['missing']).not.toContain(
      'ratingExam',
    );
  });
});
