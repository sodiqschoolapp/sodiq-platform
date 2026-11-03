import {
  closingChecklistSchema,
  gradeChangesSchema,
  journalGridSchema,
  ratingExamsPrimaryPreviewSchema,
  schoolSettingsSchema,
  subjectListSchema,
  subjectQuarterWeightsSchema,
  type ClosingChecklist,
  type JournalGrid,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { closeQuarter, reopenQuarter } from '../../testing/closing-kit.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { prepareBranch } from '../../testing/prepared-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const SETTING = '/api/setup/school-settings';
const CHANGE = `${SETTING}/rating-exams-primary`;

const codeOf = (response: Response): unknown =>
  (response.body as { error?: { code?: string } }).error?.code;

const ok = (response: Response): unknown => {
  expect(response.status, JSON.stringify(response.body).slice(0, 800)).toBeLessThan(300);
  return response.body;
};

// All names are invented. Task 9.4f (pull request #276): the school setting "Rating exams in
// grades 0–4" (`05`, Grading weights on a subject, Grades 0–4; `edge/00-definitions`, Rating
// journal; `edge/academic-year`, publishing without weights; `07`, Closing a quarter). The
// done-when of the build plan: with the setting off, 1 London's Mathematics journal has no rating
// exam column, its quarter result uses A 10 · CW 50 · HW 40 and it closes without exam scores
// while 7 Oxford's keeps its rating exam; turning it on and off changes no closed quarter's
// results; turning it off is refused while a grade 0–4 journal of an open quarter holds a rating
// exam entry.
describe('the school setting "Rating exams in grades 0–4"', () => {
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
   * A published scene of the rating subject in a class of `grade`, with one student present on
   * the 12th with 9 of 10 in classwork and absent on the 19th: attendance 50, classwork 90.
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
    const work = (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: s.branch, lesson_id: l12.id, kind: 'classwork', total: 10 })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await saveOn(s.branch, l12.date, [
      { lessonId: l12.id, studentId: student, value: 1 },
      { lessonId: l12.id, studentId: student, workId: work, value: 9 },
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

  const checklistOf = async (branch: string, quarterId: string): Promise<ClosingChecklist> => {
    const response = await at(() => t.get(`/api/results/closing?quarterId=${quarterId}`, branch));
    expect(response.status, JSON.stringify(response.body).slice(0, 500)).toBe(200);
    return closingChecklistSchema.parse(response.body);
  };

  /** The change as the Super Admin sends it: school-wide work, no branch header. */
  const change = (body: object, cookie = t.admin) =>
    at(() => request(t.kit.server).put(CHANGE).set('Cookie', cookie).send(body));
  const preview = (body: object, cookie = t.admin) =>
    at(() => t.kit.post(`${CHANGE}/preview`, cookie).send(body));

  const settingRow = async () =>
    (
      await t.database.migrator
        .selectFrom('school_settings')
        .select('rating_exams_primary')
        .executeTakeFirstOrThrow()
    ).rating_exams_primary;

  const stateOf = async (quarter: string) =>
    (
      await t.database.migrator
        .selectFrom('quarter_rating_states')
        .select('rating_exams_primary')
        .where('quarter_id', '=', quarter)
        .executeTakeFirstOrThrow()
    ).rating_exams_primary;

  /** Every row the change writes, in every branch, and the audit log. */
  const rowsOf = async () => ({
    setting: await settingRow(),
    states: await t.database.migrator
      .selectFrom('quarter_rating_states')
      .selectAll()
      .orderBy('quarter_id')
      .execute(),
    audit: (
      await t.database.migrator
        .selectFrom('audit_log')
        .select(sql<number>`count(*)::int`.as('count'))
        .executeTakeFirstOrThrow()
    ).count,
    school: (
      await t.database.migrator
        .selectFrom('audit_log_school')
        .select(sql<number>`count(*)::int`.as('count'))
        .executeTakeFirstOrThrow()
    ).count,
  });

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    mathematics = await load.classes.subject({ grades: [1, 4, 5, 7], name: 'Mathematics' });
    await t.database.migrator
      .updateTable('subjects')
      .set({ rating_exam: true })
      .where('id', '=', mathematics)
      .execute();
  });

  afterAll(async () => {
    await t.close();
  });

  it('with the setting off, gives 1 London no rating exam and A 10 · CW 50 · HW 40, and 7 Oxford its exam', async () => {
    expect(await settingRow()).toBe(false);
    const london = await scene(1);
    const oxford = await scene(7);
    const first = await gridOf(london.s.branch, london.journal);
    expect(first.journal.ratingExam).toBe(false);
    expect(first.rating).toBeNull();
    expect(first.legend.quarterly).toEqual({
      attendance: 10,
      classwork: 50,
      homework: 40,
      ratingExam: null,
    });
    // (10 × 50 + 50 × 90) ÷ 60 = 83.3: homework has no data and is scaled out (`07` rule 3).
    const londonShown = shownOf(first, london.student);
    expect(londonShown).toMatchObject({ kind: 'number', shown: 83 });
    expect(londonShown?.kind === 'number' ? londonShown.leftOut : []).not.toContain('ratingExam');
    const seventh = await gridOf(oxford.s.branch, oxford.journal);
    expect(seventh.journal.ratingExam).toBe(true);
    expect(seventh.legend.quarterly).toEqual({
      attendance: 20,
      classwork: 30,
      homework: 30,
      ratingExam: 20,
    });
    // (20 × 50 + 30 × 90) ÷ 50 = 74: provisional while the exam has no score.
    const oxfordShown = shownOf(seventh, oxford.student);
    expect(oxfordShown).toMatchObject({ kind: 'number', shown: 74, provisional: true });
    expect(oxfordShown?.kind === 'number' ? oxfordShown.leftOut : []).toContain('ratingExam');
    // The closing checklist: 1 London has no rating exam entry to miss; 7 Oxford's is missing.
    const londonList = await checklistOf(london.s.branch, london.quarters[0] ?? '');
    expect(londonList.items.filter((item) => item.kind === 'rating_missing')).toEqual([]);
    expect(londonList.items.filter((item) => item.kind === 'weights_missing')).toEqual([]);
    const oxfordList = await checklistOf(oxford.s.branch, oxford.quarters[0] ?? '');
    expect(
      oxfordList.items
        .filter((item) => item.kind === 'rating_missing')
        .map((item) => item.journal?.id),
    ).toEqual([oxford.journal]);
    // Without its distribution without the rating exam, 1 London's journal has no valid weights.
    await t.database.migrator
      .deleteFrom('subject_quarter_primary_weights')
      .where('branch_id', '=', london.s.branch)
      .where('quarter_id', '=', london.quarters[1] ?? '')
      .execute();
    const missing = await gridOf(london.s.branch, london.journal, london.quarters[1]);
    expect(missing.legend.quarterly).toBeNull();
    // A rating exam date of the grade 1 journal is refused while the quarter's state is off.
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
    // So is an entry at the entry route ("exempt" is the Academic Vice Principal's).
    const exempt = await at(() =>
      t.post(
        `/api/journal/journals/${london.journal}/rating/${london.quarters[0] ?? ''}/entries`,
        london.s.branch,
        { studentId: london.student, entry: { kind: 'exempt' }, reason: null, version: null },
        vice,
      ),
    );
    expect([exempt.status, codeOf(exempt)]).toEqual([409, 'rating_exam_off']);
    // Without its distribution without the rating exam in quarter 1, the closing checklist
    // blocks 1 London's journal: its weights are missing (`07`, Closing).
    await t.database.migrator
      .deleteFrom('subject_quarter_primary_weights')
      .where('branch_id', '=', london.s.branch)
      .where('quarter_id', '=', london.quarters[0] ?? '')
      .execute();
    const blocked = await checklistOf(london.s.branch, london.quarters[0] ?? '');
    expect(
      blocked.items
        .filter((item) => item.kind === 'weights_missing')
        .map((item) => item.journal?.id),
    ).toContain(london.journal);
  });

  it('previews the grades that change, writes nothing, then changes with a reason and an audit entry', async () => {
    const london = await scene(1);
    const before = await rowsOf();
    const shown = ratingExamsPrimaryPreviewSchema.parse(ok(await preview({ on: true })));
    const own = shown.branches.find((one) => one.branchId === london.s.branch);
    // Quarter 1: the result becomes (20 × 50 + 30 × 90) ÷ 50 = 74 for the one student.
    expect(own?.quarters.find((one) => one.number === 1)?.journals).toEqual([
      expect.objectContaining({ journalId: london.journal, grades: 0, results: 1 }),
    ]);
    expect(shown.entries).toEqual([]);
    expect(shown.groups).toEqual([]);
    expect(await rowsOf()).toEqual(before);
    // A reason is required.
    const bare = await change({ on: true });
    expect([bare.status, codeOf(bare)]).toEqual([409, 'reason_required']);
    expect(await rowsOf()).toEqual(before);
    const done = schoolSettingsSchema.parse(
      ok(await change({ on: true, reason: 'Rating exams from grade 1 this year' })),
    );
    expect(done.ratingExamsPrimary).toBe(true);
    expect(done.differing).toEqual([]);
    expect(await stateOf(london.quarters[0] ?? '')).toBe(true);
    const grid = await gridOf(london.s.branch, london.journal);
    expect(grid.journal.ratingExam).toBe(true);
    expect(shownOf(grid, london.student)).toMatchObject({ shown: 74, provisional: true });
    // A school-wide entry: the change acts on every branch.
    const [entry] = await t.database.migrator
      .selectFrom('audit_log_school')
      .select(['old_value', 'new_value', 'details', 'assignment_id'])
      .where('action', '=', 'school_settings.rating_exams_primary')
      .execute();
    expect(entry).toMatchObject({
      old_value: { ratingExamsPrimary: false },
      new_value: { ratingExamsPrimary: true },
      assignment_id: t.adminAssignment,
    });
    expect((entry?.details as { reason?: string }).reason).toBe(
      'Rating exams from grade 1 this year',
    );
    // The value in force with no open quarter differing is refused.
    const again = await change({ on: true, reason: 'Again' });
    expect([again.status, codeOf(again)]).toEqual([409, 'setting_unchanged']);
    // Back off for the next tests.
    ok(await change({ on: false, reason: 'Back to the default' }));
    expect(await stateOf(london.quarters[0] ?? '')).toBe(false);
  });

  it('changes no closed quarter: its state and its results stay, the open quarters follow', async () => {
    const london = await scene(1);
    const [q1, q2] = london.quarters;
    await closeQuarter(t.database, {
      branchId: london.s.branch,
      quarterId: q1 ?? '',
      accountId: await load.classes.account(),
    });
    const closedBefore = await gridOf(london.s.branch, london.journal, q1);
    ok(await change({ on: true, reason: 'Turned on' }));
    expect(await stateOf(q1 ?? '')).toBe(false);
    expect(await stateOf(q2 ?? '')).toBe(true);
    const closedOn = await gridOf(london.s.branch, london.journal, q1);
    expect(closedOn.journal.ratingExam).toBe(false);
    expect(closedOn.students).toEqual(closedBefore.students);
    expect((await gridOf(london.s.branch, london.journal, q2)).journal.ratingExam).toBe(true);
    ok(await change({ on: false, reason: 'Turned off' }));
    expect(await stateOf(q1 ?? '')).toBe(false);
    expect(await stateOf(q2 ?? '')).toBe(false);
    expect((await gridOf(london.s.branch, london.journal, q1)).students).toEqual(
      closedBefore.students,
    );
  });

  it('refuses the turn-off while a grade 0–4 journal of an open quarter holds a rating exam entry', async () => {
    const london = await scene(1);
    ok(await change({ on: true, reason: 'Turned on' }));
    const quarter = london.quarters[0] ?? '';
    const vice = await viceOf(london.s.branch);
    const dated = await at(() =>
      t.put(
        `/api/journal/journals/${london.journal}/rating/${quarter}/date`,
        london.s.branch,
        { date: '2026-10-12', version: null },
        vice,
      ),
    );
    ok(dated);
    // The teacher's score, written as the entry route writes it (that route is tested in
    // `rating.test.ts`).
    const exam = await t.database.migrator
      .selectFrom('journal_rating_exams')
      .select('id')
      .where('journal_id', '=', london.journal)
      .executeTakeFirstOrThrow();
    const writer = await load.classes.account();
    await at(() =>
      t.app.get(Transactions).run([london.s.branch], async (transaction) => {
        await t.app.get(Audit).record(transaction, {
          branchId: london.s.branch,
          actorId: writer,
          action: 'journal.rating_entry',
        });
        await transaction
          .insertInto('journal_rating_entries')
          .values({
            branch_id: london.s.branch,
            rating_exam_id: exam.id,
            student_id: london.student,
            kind: 'score',
            score: 70,
            version: 1,
            changed_by: writer,
            changed_how: 'entry',
            changed_at: new Date(MOMENT),
          })
          .execute();
      }),
    );
    const before = await rowsOf();
    const shown = ratingExamsPrimaryPreviewSchema.parse(ok(await preview({ on: false })));
    expect(shown.entries.map((one) => [one.branchId, one.journalId])).toEqual([
      [london.s.branch, london.journal],
    ]);
    const refused = await change({ on: false, reason: 'Turned off' });
    expect([refused.status, codeOf(refused)]).toEqual([409, 'rating_primary_refused']);
    const details = (refused.body as { error: { details: { recordId?: string }[] } }).error.details;
    expect(details.map((one) => one.recordId)).toEqual([london.journal]);
    expect(await rowsOf()).toEqual(before);
    // Cleared by a correction, the turn-off goes through.
    await at(() =>
      t.app.get(Transactions).run([london.s.branch], async (transaction) => {
        await t.app.get(Audit).record(transaction, {
          branchId: london.s.branch,
          actorId: writer,
          action: 'journal.rating_entry',
        });
        await transaction
          .updateTable('journal_rating_entries')
          .set({
            kind: null,
            score: null,
            reason: 'Entered by mistake',
            changed_by: writer,
            changed_how: 'entry',
          })
          .where('rating_exam_id', '=', exam.id)
          .execute();
      }),
    );
    ok(await change({ on: false, reason: 'Turned off' }));
  });

  it('refuses a group of grades 4 and 5 of the rating subject at its route while the setting is off', async () => {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    const fourth = await load.classes.schoolClass(branch, year, { grade: 4 });
    const fifth = await load.classes.schoolClass(branch, year, { grade: 5 });
    const created = await at(() =>
      t.post('/api/groups', branch, {
        academicYearId: year,
        subjectId: mathematics,
        classIds: [fourth, fifth],
        name: 'Maths 4-5',
        language: 'uz',
        maxSize: 20,
      }),
    );
    expect([created.status, codeOf(created)]).toEqual([409, 'groups_rating_primary_span']);
  });

  it('refuses a class added to a group and a restore that make grades 4 and 5 while the setting is off', async () => {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    const fourth = await load.classes.schoolClass(branch, year, { grade: 4 });
    const fifth = await load.classes.schoolClass(branch, year, { grade: 5 });
    const created = await at(() =>
      t.post('/api/groups', branch, {
        academicYearId: year,
        subjectId: mathematics,
        classIds: [fourth],
        name: 'Maths 4',
        language: 'uz',
        maxSize: 20,
      }),
    );
    const group = ok(created) as { id: string; version: number };
    const edited = await at(() =>
      t.put(`/api/groups/${group.id}`, branch, {
        classIds: [fourth, fifth],
        name: 'Maths 4',
        language: 'uz',
        maxSize: 20,
        version: group.version,
      }),
    );
    expect([edited.status, codeOf(edited)]).toEqual([409, 'groups_rating_primary_span']);
    // Made while the setting was on, archived, then restored after it was turned off.
    ok(await change({ on: true, reason: 'Groups of grades 4 and 5' }));
    const both = ok(
      await at(() =>
        t.post('/api/groups', branch, {
          academicYearId: year,
          subjectId: mathematics,
          classIds: [fourth, fifth],
          name: 'Maths 4-5',
          language: 'uz',
          maxSize: 20,
        }),
      ),
    ) as { id: string };
    // While it stands, the turn-off is refused at the route and the group is named.
    const shownGroups = ratingExamsPrimaryPreviewSchema.parse(ok(await preview({ on: false })));
    expect(shownGroups.groups.map((one) => one.groupId)).toEqual([both.id]);
    const refusedOff = await change({ on: false, reason: 'Back to the default' });
    expect([refusedOff.status, codeOf(refusedOff)]).toEqual([409, 'rating_primary_refused']);
    expect(
      (refusedOff.body as { error: { details: { recordId?: string }[] } }).error.details.map(
        (one) => one.recordId,
      ),
    ).toEqual([both.id]);
    ok(await at(() => t.post(`/api/groups/${both.id}/archive`, branch)));
    ok(await change({ on: false, reason: 'Back to the default' }));
    const restored = await at(() =>
      t.post(`/api/groups/${both.id}/restore`, branch, { confirmMixedLanguage: false }),
    );
    expect([restored.status, codeOf(restored)]).toEqual([409, 'groups_rating_primary_span']);
  });

  it('refuses turning the rating exam on in one branch while another branch has a group of grades 4 and 5', async () => {
    const plain = await load.classes.subject({ grades: [4, 5], name: 'Geometry' });
    const elsewhere = await t.newBranch();
    const otherYear = await load.classes.year(elsewhere);
    await t.database.migrator.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto('groups')
        .values({
          branch_id: elsewhere,
          academic_year_id: otherYear,
          subject_id: plain,
          name: 'Geometry 4-5',
          language: 'uz',
          max_size: 20,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const grade of [4, 5]) {
        const classId = await load.classes.schoolClass(elsewhere, otherYear, { grade });
        await transaction
          .insertInto('group_classes')
          .values({ branch_id: elsewhere, group_id: row.id, class_id: classId })
          .execute();
      }
    });
    const branch = await t.newBranch();
    await load.classes.year(branch);
    const subject = await t.database.migrator
      .selectFrom('subjects')
      .selectAll()
      .where('id', '=', plain)
      .executeTakeFirstOrThrow();
    const edited = await at(() =>
      t.put(`/api/setup/subjects/${plain}`, branch, {
        names: { uz: subject.name_uz, ru: subject.name_ru, en: subject.name_en },
        departmentId: subject.department_id,
        grades: subject.grades,
        colour: subject.colour,
        journalType: 'graded',
        ratingExam: true,
        groupSubject: subject.group_subject,
        languageRule: subject.language_rule,
        demanding: subject.demanding,
        daily: { attendance: 20, classwork: 40, homework: 40 },
        switchesFrom: 1,
      }),
    );
    expect([edited.status, codeOf(edited)]).toEqual([409, 'groups_rating_primary_span']);
  });

  it('refuses at the route a turn-off that met an entry written at the same moment', async () => {
    const london = await scene(1);
    ok(await change({ on: true, reason: 'Turned on' }));
    const quarter = london.quarters[0] ?? '';
    const vice = await viceOf(london.s.branch);
    ok(
      await at(() =>
        t.put(
          `/api/journal/journals/${london.journal}/rating/${quarter}/date`,
          london.s.branch,
          { date: '2026-10-12', version: null },
          vice,
        ),
      ),
    );
    const exam = await t.database.migrator
      .selectFrom('journal_rating_exams')
      .select('id')
      .where('journal_id', '=', london.journal)
      .executeTakeFirstOrThrow();
    const writer = await load.classes.account();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let written: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      written = resolve;
    });
    t.clock.set(MOMENT);
    // The held side: an entry as the entry route writes it, its quarter's state held `for share`.
    const heldSide = t.app.get(Transactions).run([london.s.branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: london.s.branch,
        actorId: writer,
        action: 'journal.rating_entry',
      });
      await transaction
        .insertInto('journal_rating_entries')
        .values({
          branch_id: london.s.branch,
          rating_exam_id: exam.id,
          student_id: london.student,
          kind: 'score',
          score: 70,
          version: 1,
          changed_by: writer,
          changed_how: 'entry',
          changed_at: new Date(MOMENT),
        })
        .execute();
      written();
      await gate;
    });
    await ready;
    // The route's request, started now: its read of the entries sees none, and its update waits.
    const sent = new Promise<Response>((resolve, reject) => {
      request(t.kit.server)
        .put(CHANGE)
        .set('Cookie', t.admin)
        .send({ on: false, reason: 'Turned off' })
        .then(resolve, reject);
    });
    for (let tries = 0; tries < 300; tries += 1) {
      const found = await sql<{ waiting: number }>`
        select count(*)::int as waiting
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
      `.execute(t.database.migrator);
      if ((found.rows[0]?.waiting ?? 0) > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    release();
    await heldSide;
    const refused = await sent;
    t.clock.set(START);
    expect([refused.status, codeOf(refused)]).toEqual([409, 'rating_primary_refused']);
    expect(await stateOf(quarter)).toBe(true);
    // Cleared, so the next tests start with the setting off.
    await at(() =>
      t.app.get(Transactions).run([london.s.branch], async (transaction) => {
        await t.app.get(Audit).record(transaction, {
          branchId: london.s.branch,
          actorId: writer,
          action: 'journal.rating_entry',
        });
        await transaction
          .updateTable('journal_rating_entries')
          .set({
            kind: null,
            score: null,
            reason: 'Entered by mistake',
            changed_by: writer,
            changed_how: 'entry',
          })
          .where('rating_exam_id', '=', exam.id)
          .execute();
      }),
    );
    ok(await change({ on: false, reason: 'Turned off' }));
  });

  it('refuses a class moved from grade 5 into 4 at its route while a closed quarter has the state off', async () => {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    const fifth = await load.classes.schoolClass(branch, year, { grade: 5 });
    await t.database.migrator
      .insertInto('journals')
      .values({
        branch_id: branch,
        academic_year_id: year,
        class_id: fifth,
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
      .where('id', '=', fifth)
      .executeTakeFirstOrThrow();
    const edited = await at(() =>
      t.put(`/api/classes/${fifth}`, branch, {
        grade: 4,
        name: row.name,
        language: row.language,
        mainRoomId: row.main_room_id,
        maxSize: row.max_size,
        version: row.version,
      }),
    );
    expect([edited.status, codeOf(edited)]).toEqual([409, 'class_grade_rating_primary']);
  });

  it('sets and reads the distribution without the rating exam, and refuses it for a subject without the exam', async () => {
    const london = await scene(1);
    const quarter = london.quarters[2] ?? '';
    const path = `/api/setup/subjects/${mathematics}/quarter-weights/${quarter}/primary`;
    const written = subjectQuarterWeightsSchema.parse(
      ok(
        await at(() =>
          t.put(path, london.s.branch, {
            attendance: 20,
            classwork: 40,
            homework: 40,
            reason: 'Agreed by the department',
          }),
        ),
      ),
    );
    const third = written.quarters.find((one) => one.quarterId === quarter);
    expect(third?.primary).toEqual({ attendance: 20, classwork: 40, homework: 40 });
    expect(third?.primaryNeeded).toBe(true);
    const total = await at(() =>
      t.put(path, london.s.branch, { attendance: 20, classwork: 40, homework: 41 }),
    );
    expect(total.status).toBe(400);
    const plain = await load.classes.subject({ grades: [1] });
    const refused = await at(() =>
      t.put(`/api/setup/subjects/${plain}/quarter-weights/${quarter}/primary`, london.s.branch, {
        attendance: 20,
        classwork: 40,
        homework: 40,
      }),
    );
    expect([refused.status, codeOf(refused)]).toEqual([409, 'primary_weights_no_rating']);
    // A change of the stored one needs a reason, as the usual one (9.1).
    const bare = await at(() =>
      t.put(path, london.s.branch, { attendance: 30, classwork: 40, homework: 30 }),
    );
    expect([bare.status, codeOf(bare)]).toEqual([409, 'reason_required']);
    ok(
      await at(() =>
        t.put(path, london.s.branch, {
          attendance: 30,
          classwork: 40,
          homework: 30,
          reason: 'Agreed again',
        }),
      ),
    );
    const [entry] = (await t.entries('subject_quarter_primary_weights.set', mathematics)).slice(-1);
    expect(entry?.new_value).toEqual({ weights: { attendance: 30, classwork: 40, homework: 30 } });
  });

  // The owner's answer A on #276 (`edge/calculation`, week 7): the distribution without the rating
  // exam has a preview of its own, under the roles of its write, that writes nothing.
  it('previews the grades a change of the distribution without the rating exam alters, writes nothing, and refuses what its write refuses', async () => {
    const london = await scene(1);
    const quarter = london.quarters[0] ?? '';
    const path = `/api/setup/subjects/${mathematics}/quarter-weights/${quarter}/primary`;
    const stored = () =>
      t.database.migrator
        .selectFrom('subject_quarter_primary_weights')
        .selectAll()
        .where('branch_id', '=', london.s.branch)
        .orderBy('quarter_id')
        .execute();
    // Everything the test reads later is made first, so that nothing is written after `before`.
    const oxford = await scene(7);
    const plain = await load.classes.subject({ grades: [1] });
    const vice = await viceOf(london.s.branch);
    // A teacher of the branch of the request, so that the role decides the refusal, not the branch.
    const teacher = await t.kit.completeSession('Sardor', 'Toshmatov');
    await t.kit.giveRole(teacher.account.id, { role: 'teacher', branchId: london.s.branch });
    const before = { stored: await stored(), rows: await rowsOf() };
    // 20 · 40 · 40 in place of 10 · 50 · 40: (20 × 50 + 40 × 90) ÷ 60 = 76.7 in place of 83.3.
    const shown = gradeChangesSchema.parse(
      ok(
        await at(() =>
          t.post(`${path}/preview`, london.s.branch, {
            attendance: 20,
            classwork: 40,
            homework: 40,
          }),
        ),
      ),
    );
    expect(shown.reasonRequired).toBe(true);
    expect(shown.quarters).toEqual([
      expect.objectContaining({
        quarterId: quarter,
        number: 1,
        journals: [expect.objectContaining({ journalId: london.journal, results: 1 })],
      }),
    ]);
    expect({ stored: await stored(), rows: await rowsOf() }).toEqual(before);
    // The 7 Oxford journal of the same subject uses its usual distribution: nothing changes there.
    const seventh = gradeChangesSchema.parse(
      ok(
        await at(() =>
          t.post(
            `/api/setup/subjects/${mathematics}/quarter-weights/${oxford.quarters[0] ?? ''}/primary/preview`,
            oxford.s.branch,
            { attendance: 20, classwork: 40, homework: 40 },
          ),
        ),
      ),
    );
    expect(seventh.quarters.flatMap((one) => one.journals)).toEqual([]);
    // What the write refuses, the preview refuses: a subject without the rating exam.
    const refused = await at(() =>
      t.post(
        `/api/setup/subjects/${plain}/quarter-weights/${quarter}/primary/preview`,
        london.s.branch,
        { attendance: 20, classwork: 40, homework: 40 },
      ),
    );
    expect([refused.status, codeOf(refused)]).toEqual([409, 'primary_weights_no_rating']);
    const total = await at(() =>
      t.post(`${path}/preview`, london.s.branch, { attendance: 20, classwork: 40, homework: 41 }),
    );
    expect(total.status).toBe(400);
    // A teacher of the branch may not preview it; the Academic Vice Principal may.
    const refusedTeacher = await at(() =>
      t.post(
        `${path}/preview`,
        london.s.branch,
        { attendance: 20, classwork: 40, homework: 40 },
        teacher.cookie,
      ),
    );
    expect([refusedTeacher.status, codeOf(refusedTeacher)]).toEqual([403, 'permission_denied']);
    ok(
      await at(() =>
        t.post(
          `${path}/preview`,
          london.s.branch,
          { attendance: 20, classwork: 40, homework: 40 },
          vice,
        ),
      ),
    );
    expect({ stored: await stored(), rows: await rowsOf() }).toEqual(before);
  });

  // The review of #276, finding 3: the copy of quarter 1 carries its distribution without the
  // rating exam; finding 4: the list's marker counts a missing one.
  it('copies quarter 1’s distribution without the rating exam with the copy, and counts a missing one in the list', async () => {
    const london = await scene(1);
    const [q1, ...later] = london.quarters;
    const missingOf = async () => {
      const listed = subjectListSchema.parse(
        ok(await at(() => t.get('/api/setup/subjects', london.s.branch))),
      );
      const own = listed.subjects.find((one) => one.id === mathematics);
      return [own?.quarterWeightsMissing, own?.quarterCount];
    };
    expect(await missingOf()).toEqual([0, 4]);
    await t.database.migrator
      .deleteFrom('subject_quarter_primary_weights')
      .where('branch_id', '=', london.s.branch)
      .where('quarter_id', 'in', later)
      .execute();
    // Quarters 2 to 4 have their usual distribution but none without the rating exam.
    expect(await missingOf()).toEqual([3, 4]);
    ok(
      await at(() =>
        t.put(
          `/api/setup/subjects/${mathematics}/quarter-weights/${q1 ?? ''}/primary`,
          london.s.branch,
          { attendance: 30, classwork: 40, homework: 30, reason: 'Agreed by the department' },
        ),
      ),
    );
    ok(
      await at(() =>
        t.post(`/api/setup/subjects/${mathematics}/quarter-weights/copy`, london.s.branch, {
          yearId: london.s.year,
          reason: 'One distribution for the year',
        }),
      ),
    );
    const copied = await t.database.migrator
      .selectFrom('subject_quarter_primary_weights')
      .select(['quarter_id', 'attendance', 'classwork', 'homework'])
      .where('branch_id', '=', london.s.branch)
      .where('subject_id', '=', mathematics)
      .execute();
    expect(
      new Map(copied.map((one) => [one.quarter_id, [one.attendance, one.classwork, one.homework]])),
    ).toEqual(new Map(london.quarters.map((one) => [one, [30, 40, 30]])));
    expect(await missingOf()).toEqual([0, 4]);
    // Each copied quarter has its audit entry.
    const entries = await t.entries('subject_quarter_primary_weights.set', mathematics);
    for (const quarter of later) {
      expect(
        entries
          .filter(
            (entry) => (entry.details as { quarterId?: string } | null)?.quarterId === quarter,
          )
          .map((entry) => entry.new_value),
        quarter,
      ).toContainEqual({ weights: { attendance: 30, classwork: 40, homework: 30 } });
    }
    // With the state on, the journals of grades 0–4 use the usual one: nothing is missing.
    await t.database.migrator
      .deleteFrom('subject_quarter_primary_weights')
      .where('branch_id', '=', london.s.branch)
      .where('quarter_id', '=', later[0] ?? '')
      .execute();
    expect(await missingOf()).toEqual([1, 4]);
    ok(await change({ on: true, reason: 'Turned on' }));
    expect(await missingOf()).toEqual([0, 4]);
    ok(await change({ on: false, reason: 'Turned off' }));
  });

  // The review of #276, finding 1 (decision 12, second half): the value in force is accepted where
  // a reopened quarter differs from it, and sets that quarter.
  it('sets a reopened quarter that differs when the value in force is sent again', async () => {
    const london = await scene(1);
    const [q1, q2] = london.quarters;
    await closeQuarter(t.database, {
      branchId: london.s.branch,
      quarterId: q1 ?? '',
      accountId: await load.classes.account(),
    });
    ok(await change({ on: true, reason: 'Turned on' }));
    expect(await stateOf(q1 ?? '')).toBe(false);
    await reopenQuarter(t.database, {
      branchId: london.s.branch,
      quarterId: q1 ?? '',
      journalId: null,
      accountId: await load.classes.account(),
      at: '2026-10-27T09:00:00+05:00',
    });
    const read = schoolSettingsSchema.parse(ok(await at(() => t.get(SETTING, london.s.branch))));
    expect(read.ratingExamsPrimary).toBe(true);
    expect(read.differing).toEqual([
      expect.objectContaining({
        branchId: london.s.branch,
        quarterId: q1,
        number: 1,
        ratingExamsPrimary: false,
      }),
    ]);
    const done = schoolSettingsSchema.parse(
      ok(await change({ on: true, reason: 'The reopened quarter follows the setting' })),
    );
    expect(done.differing).toEqual([]);
    expect(await stateOf(q1 ?? '')).toBe(true);
    expect(await stateOf(q2 ?? '')).toBe(true);
    const [entry] = (
      await t.database.migrator
        .selectFrom('audit_log_school')
        .select(['old_value', 'new_value', 'details'])
        .where('action', '=', 'school_settings.rating_exams_primary')
        .orderBy('id', 'desc')
        .limit(1)
        .execute()
    ).slice(-1);
    expect(entry).toMatchObject({
      old_value: { ratingExamsPrimary: true },
      new_value: { ratingExamsPrimary: true },
    });
    // The entry names the one quarter it changed: the reopened one, from off.
    expect((entry?.details as { quarters?: unknown }).quarters).toEqual([
      { branchId: london.s.branch, quarterId: q1, number: 1, from: false },
    ]);
    // Now nothing differs: the same value again is refused.
    const again = await change({ on: true, reason: 'Again' });
    expect([again.status, codeOf(again)]).toEqual([409, 'setting_unchanged']);
    ok(await change({ on: false, reason: 'Turned off' }));
  });

  // The review of #276, finding 6: a change through the route puts the prepared report units of
  // the branch behind, so the totals are prepared again.
  it('puts the prepared report units of the branch behind when the setting changes through the route', async () => {
    const london = await scene(1);
    expect(await prepareBranch(t, london.s.branch)).toBeGreaterThan(0);
    expect(await prepareBranch(t, london.s.branch)).toBe(0);
    ok(await change({ on: true, reason: 'Turned on' }));
    expect(await prepareBranch(t, london.s.branch)).toBeGreaterThan(0);
    ok(await change({ on: false, reason: 'Turned off' }));
    expect(await prepareBranch(t, london.s.branch)).toBeGreaterThan(0);
  });

  it('lets the Principal and the Academic Vice Principal read the setting, and refuses them the change', async () => {
    const branch = t.north;
    for (const cookie of [t.principal, t.vicePrincipal]) {
      const read = schoolSettingsSchema.parse(ok(await at(() => t.get(SETTING, branch, cookie))));
      expect(read.mayChange).toBe(false);
      expect((await change({ on: true, reason: 'x' }, cookie)).status).toBe(403);
      expect((await preview({ on: true }, cookie)).status).toBe(403);
    }
    const admin = schoolSettingsSchema.parse(ok(await at(() => t.get(SETTING, branch))));
    expect(admin.mayChange).toBe(true);
    expect((await at(() => t.get(SETTING, branch, t.teacher))).status).toBe(403);
  });
});
