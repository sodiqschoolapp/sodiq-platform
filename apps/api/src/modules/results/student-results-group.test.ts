import {
  BRANCH_HEADER,
  studentLeavingResultsSchema,
  studentResultLessonsSchema,
  studentResultsSchema,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { Audit } from '../audit/audit.service.js';

/** Tuesday 13 October 2026, noon in Tashkent: the group lesson of Monday 12 October is held. */
const MOMENT = '2026-10-13T12:00:00+05:00';

// All names are invented. Task 9.1: the Tutor of one class of a group reads the results of
// the own class's students in the group's subject (decision 4 with must-fix 1 of the spec
// review of the plan; docs/spec/07-journal.md, Who can do what: "Tutor | Views journals of
// own class"), and the rating exam entries in the result (docs/spec/07-journal.md, rule 8;
// docs/spec/edge-cases/calculation.md, "The rating exam", "A student is exempt on the exam
// day", "The exam is not held for one group this quarter").
describe('the student results of a group subject', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let cells: CellsKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Zarina', `Qodirova${'a'.repeat(names % 6)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };

  async function as<T>(
    browser: Browser,
    branch: string,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (get: (path: string) => Promise<Response>) => Promise<T>,
  ): Promise<T> {
    for (const held of roles) {
      await t.kit.giveRole(browser.account.id, {
        ...held,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
    }
    t.clock.set(MOMENT);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
        .where('account_id', '=', browser.account.id)
        .execute();
      return await work((path) =>
        request(t.kit.server).get(path).set('Cookie', browser.cookie).set(BRANCH_HEADER, branch),
      );
    } finally {
      t.clock.set(START);
    }
  }

  /**
   * A group of the kit's subject (weights 20 · 20 · 20 · 40 with the rating exam) that
   * mixes 7 Oxford and 7 Cambridge, a held lesson on 12 October where both are present,
   * and the rating exam of quarter 1 with the entries given.
   */
  async function scene(entries: {
    nurova: { kind: 'score'; score: number } | { kind: 'did_not_sit' | 'exempt' } | null;
    qosimov: { kind: 'score'; score: number } | { kind: 'did_not_sit' | 'exempt' } | null;
    notHeld?: boolean;
    /** Nurova leaves the school with the last day 12 October. */
    nurovaLeaves?: boolean;
  }) {
    const branch = await t.newBranch();
    const { year, quarters } = await cells.lessons.year(branch);
    const quarter = quarters[0] ?? '';
    const oxford = await load.classes.schoolClass(branch, year, { grade: 7 });
    const cambridge = await load.classes.schoolClass(branch, year, { grade: 7 });
    const group = await load.classes.group(branch, year, cells.subject, [oxford, cambridge]);
    await t.database.migrator
      .insertInto('subject_quarter_weights')
      .values({
        branch_id: branch,
        subject_id: cells.subject,
        quarter_id: quarter,
        attendance: 20,
        classwork: 20,
        homework: 20,
        rating_exam: 40,
      })
      .execute();
    const journal = (
      await t.database.migrator
        .insertInto('journals')
        .values({
          branch_id: branch,
          academic_year_id: year,
          class_id: null,
          group_id: group,
          subject_id: cells.subject,
          runs: '{}',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const placed = async (name: string, classId: string, leaves = false) => {
      const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
      const leavingId = leaves
        ? await members.leaving(t.database.migrator, branch, id, '2026-10-13')
        : null;
      const ends =
        leavingId === null ? {} : { until: '2026-10-13', endedBy: 'leaving' as const, leavingId };
      await t.database.migrator
        .updateTable('students')
        .set({ last_name: name })
        .where('id', '=', id)
        .execute();
      await t.database.migrator.transaction().execute(async (transaction) => {
        await members.member(
          { branch, classId, studentId: id, from: '2026-09-01', ...ends },
          transaction,
        );
        await members.groupMember(
          {
            branch,
            groupId: group,
            subjectId: cells.subject,
            studentId: id,
            from: '2026-09-01',
            ...ends,
          },
          transaction,
        );
      });
      return id;
    };
    const nurova = await placed('Nurova', oxford, entries.nurovaLeaves === true);
    const qosimov = await placed('Qosimov', cambridge);
    const lesson = await cells.groupLesson(branch, year, group, '2026-10-12');
    // The lesson's teacher is its pattern entry's: a held lesson (edge/00-definitions).
    await t.database.migrator
      .updateTable('lessons')
      .set((eb) => ({
        teacher_id: eb
          .selectFrom('pattern_entries')
          .select('pattern_entries.teacher_id')
          .whereRef('pattern_entries.id', '=', 'lessons.pattern_entry_id'),
      }))
      .where('id', '=', lesson)
      .execute();
    const writer = await load.classes.account();
    for (const student of [nurova, qosimov]) {
      await cells.cell(branch, {
        lessonId: lesson,
        studentId: student,
        mark: 1,
        by: writer,
        at: '2026-10-12T18:00:00+05:00',
      });
    }
    await t.app.get(Transactions).run([branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: branch,
        actorId: writer,
        action: 'journal.rating_entry',
      });
      const row = await transaction
        .insertInto('journal_rating_exams')
        .values({
          branch_id: branch,
          journal_id: journal,
          quarter_id: quarter,
          exam_date: '2026-10-05',
          not_held: entries.notHeld ?? false,
          version: 1,
          changed_by: writer,
          changed_at: new Date(0),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const [student, entry] of [
        [nurova, entries.nurova],
        [qosimov, entries.qosimov],
      ] as const) {
        if (entry === null) continue;
        await transaction
          .insertInto('journal_rating_entries')
          .values({
            branch_id: branch,
            rating_exam_id: row.id,
            student_id: student,
            kind: entry.kind,
            score: entry.kind === 'score' ? entry.score : null,
            version: 1,
            changed_by: writer,
            changed_how: 'entry',
            changed_at: new Date(0),
          })
          .execute();
      }
    });
    return { branch, year, quarter, oxford, cambridge, group, journal, nurova, qosimov, lesson };
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    cells = await CellsKit.create(t.database.migrator);
    await t.database.migrator
      .updateTable('subjects')
      .set({ journal_type: 'graded', rating_exam: true })
      .where('id', '=', cells.subject)
      .execute();
  });

  afterAll(async () => {
    await t.close();
  });

  const resultOf = async (get: (path: string) => Promise<Response>, student: string) => {
    const response = await get(`/api/results/students/${student}`);
    expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
    return studentResultsSchema.parse(response.body).subjects[0]?.quarters[0];
  };

  it('gives the Tutor of one class of the group the results and the works of the own class’s student, and refuses the other class’s', async () => {
    const s = await scene({ nurova: { kind: 'score', score: 70 }, qosimov: null });
    const tutor = await account();
    await load.classes.person(s.branch, ['uz'], { accountId: tutor.account.id });
    await load.tutorOf(s.branch, s.oxford, tutor.account.id);
    await as(tutor, s.branch, [], async (get) => {
      // Attendance 100, rating 70: (20 × 100 + 40 × 70) ÷ 60 = 80.
      expect(await resultOf(get, s.nurova)).toMatchObject({
        attendance: 100,
        ratingExam: 70,
        ratingShown: true,
        outcome: { kind: 'number', shown: 80, grade: 4, provisional: true },
      });
      const lessons = await get(
        `/api/results/students/${s.nurova}/lessons?subjectId=${cells.subject}&quarterId=${s.quarter}`,
      );
      expect(lessons.status, JSON.stringify(lessons.body)).toBe(200);
      const trace = studentResultLessonsSchema.parse(lessons.body);
      expect(trace.reading).toBe('whole');
      expect(trace.ratingExam).toEqual({ kind: 'score', score: 70 });
      // Not the Tutor's class: no record to read.
      expect((await get(`/api/results/students/${s.qosimov}`)).status).toBe(403);
    });
  });

  it('counts "did not sit" as 0, leaves "exempt", "not held" and a pending entry out', async () => {
    const principal = await account();
    const first = await scene({ nurova: { kind: 'did_not_sit' }, qosimov: { kind: 'exempt' } });
    await as(
      principal,
      first.branch,
      [{ role: 'principal', branchId: first.branch }],
      async (get) => {
        // (20 × 100 + 40 × 0) ÷ 60 = 33.3, grade 2.
        expect(await resultOf(get, first.nurova)).toMatchObject({
          ratingExam: 0,
          outcome: { kind: 'number', shown: 33, grade: 2 },
        });
        // Exempt: the part is left out, the other weights scaled up: 100.
        expect(await resultOf(get, first.qosimov)).toMatchObject({
          ratingExam: null,
          ratingShown: true,
          outcome: { kind: 'number', shown: 100, leftOut: ['classwork', 'homework', 'ratingExam'] },
        });
      },
    );
    const second = await scene({ nurova: null, qosimov: null, notHeld: true });
    const pending = await scene({ nurova: null, qosimov: null });
    const reader = await account();
    await t.kit.giveRole(reader.account.id, {
      role: 'principal',
      branchId: pending.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    await as(
      reader,
      second.branch,
      [{ role: 'principal', branchId: second.branch }],
      async (get) => {
        // "Not held": left out for everyone; the result is not provisional for it.
        expect(await resultOf(get, second.nurova)).toMatchObject({
          outcome: { kind: 'number', shown: 100, leftOut: ['classwork', 'homework', 'ratingExam'] },
        });
      },
    );
    await as(reader, pending.branch, [], async (get) => {
      // No entry yet: the part has no data, the result is provisional.
      expect(await resultOf(get, pending.nurova)).toMatchObject({
        ratingExam: null,
        outcome: { kind: 'number', shown: 100, provisional: true },
      });
    });
  });

  // The permission review of the code, must-fix 2: the same reading at leaving
  // (`GET /api/people/students/:id/leaving-results`; edge/calculation, a result at leaving).
  it('gives the result at leaving of a group subject to the Tutor of the student’s class on the last day, not to the other class’s', async () => {
    const s = await scene({
      nurova: { kind: 'score', score: 70 },
      qosimov: null,
      nurovaLeaves: true,
    });
    const path = `/api/people/students/${s.nurova}/leaving-results`;
    for (const [classId, subjects] of [
      [s.oxford, [cells.subject]],
      [s.cambridge, []],
    ] as const) {
      const tutor = await account();
      await load.classes.person(s.branch, ['uz'], { accountId: tutor.account.id });
      await load.tutorOf(s.branch, classId, tutor.account.id);
      // The Head Tutor's reading of the record (a student who left is of no class now).
      await as(tutor, s.branch, [{ role: 'head_tutor', branchId: s.branch }], async (get) => {
        const response = await get(path);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        const answer = studentLeavingResultsSchema.parse(response.body);
        expect(answer.lastDay).toBe('2026-10-12');
        expect(answer.results.map((one) => one.subject.id)).toEqual(subjects);
      });
    }
  });
});
