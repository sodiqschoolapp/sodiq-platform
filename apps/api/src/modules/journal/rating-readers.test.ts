import {
  journalGridSchema,
  ratingExamSchema,
  subjectListSchema,
  type Subject,
} from '@sodiq/shared';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { BRANCH_HEADER } from '@sodiq/shared';
import { Audit } from '../audit/audit.service.js';

/** Tuesday 27 October 2026, noon in Tashkent. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ??
  `status ${String(response.status)}`;

// All names are invented. Task 8.2, pull request #218 (permission review of the code):
// who reads the rating exam and the comments of a group journal that mixes two classes,
// and what the Super Admin may do. docs/spec/07-journal.md, Who can do what;
// docs/spec/edge-cases/journal.md, "A Tutor opens the journal of a group that mixes three
// classes"; .claude/rules/api.md.
describe('the readers of the rating exam and comments', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let cells: CellsKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Gulnora', `Saidova${'a'.repeat(names % 6)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };

  /** Runs `work` as the browser in `branch` with the clock at MOMENT and the roles held from 1 September. */
  async function as<T>(
    browser: Browser,
    branch: string,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (calls: {
      get: (path: string) => Promise<Response>;
      put: (path: string, body: object) => Promise<Response>;
    }) => Promise<T>,
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
      const at = (method: 'get' | 'put', path: string) =>
        request(t.kit.server)
          [method](path)
          .set('Cookie', browser.cookie)
          .set(BRANCH_HEADER, branch);
      return await work({
        get: (path) => at('get', path),
        put: (path, body) => at('put', path).send(body),
      });
    } finally {
      t.clock.set(START);
    }
  }

  /**
   * A branch with a group of the kit's subject that mixes 7 Oxford and 7 Cambridge,
   * its journal with the rating exam of quarter 1 dated 5 October, a score of each
   * student, a rating comment of each, and a note on the lesson of 12 October.
   */
  async function scene() {
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
    const placed = async (name: string, classId: string) => {
      const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
      await t.database.migrator
        .updateTable('students')
        .set({ last_name: name })
        .where('id', '=', id)
        .execute();
      await t.database.migrator.transaction().execute(async (transaction) => {
        await members.member({ branch, classId, studentId: id, from: '2026-09-01' }, transaction);
        await members.groupMember(
          { branch, groupId: group, subjectId: cells.subject, studentId: id, from: '2026-09-01' },
          transaction,
        );
      });
      return id;
    };
    const nurova = await placed('Nurova', oxford);
    const qosimov = await placed('Qosimov', cambridge);
    const lesson = await cells.groupLesson(branch, year, group, '2026-10-12');
    const writer = await load.classes.account();
    const exam = await t.app.get(Transactions).run([branch], async (transaction) => {
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
          version: 1,
          changed_by: writer,
          changed_at: new Date(0),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const student of [nurova, qosimov]) {
        await transaction
          .insertInto('journal_rating_entries')
          .values({
            branch_id: branch,
            rating_exam_id: row.id,
            student_id: student,
            kind: 'score',
            score: 70,
            version: 1,
            changed_by: writer,
            changed_how: 'entry',
            changed_at: new Date(0),
          })
          .execute();
        await transaction
          .insertInto('journal_comments')
          .values({
            branch_id: branch,
            student_id: student,
            target: 'rating',
            rating_exam_id: row.id,
            body: 'Strong exam',
            visibility: 'staff',
            version: 1,
            changed_by: writer,
            changed_how: 'entry',
            changed_at: new Date(0),
          })
          .execute();
      }
      await transaction
        .insertInto('journal_comments')
        .values({
          branch_id: branch,
          student_id: nurova,
          target: 'note',
          lesson_id: lesson,
          body: 'Quiet today',
          visibility: 'staff',
          version: 1,
          changed_by: writer,
          changed_how: 'entry',
          changed_at: new Date(0),
        })
        .execute();
      return row.id;
    });
    return {
      branch,
      year,
      quarter,
      oxford,
      cambridge,
      group,
      journal,
      nurova,
      qosimov,
      lesson,
      exam,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const ratingHistory = (s: Scene, student: string) =>
    `/api/journal/journals/${s.journal}/rating/${s.quarter}/students/${student}/history`;
  const commentHistory = (s: Scene, query: Record<string, string>) =>
    `/api/journal/comments/history?${new URLSearchParams(query).toString()}`;
  const ratingComment = (s: Scene, student: string) =>
    commentHistory(s, {
      target: 'rating',
      studentId: student,
      journalId: s.journal,
      quarterId: s.quarter,
    });

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

  it('gives the Tutor of one class of the group the rows of own class only, also in both histories', async () => {
    const s = await scene();
    const tutor = await account();
    const assignment = await t.kit.giveRole(tutor.account.id, {
      role: 'tutor',
      branchId: s.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    await load.classes.person(s.branch, ['uz'], { accountId: tutor.account.id });
    await load.classes.tutorRow(s.branch, s.oxford, assignment.id);
    await as(tutor, s.branch, [], async (calls) => {
      const grid = journalGridSchema.parse(
        (await calls.get(`/api/journal/journals/${s.journal}`)).body,
      );
      expect(grid.students.map((one) => one.id)).toEqual([s.nurova]);
      expect(grid.rating?.entries.map((one) => one.studentId)).toEqual([s.nurova]);
      expect(grid.students[0]?.comments.map((one) => one.target).sort()).toEqual([
        'note',
        'rating',
      ]);
      expect((await calls.get(ratingHistory(s, s.nurova))).status).toBe(200);
      expect(codeOf(await calls.get(ratingHistory(s, s.qosimov)))).toBe('journal_scope');
      expect((await calls.get(ratingComment(s, s.nurova))).status).toBe(200);
      expect(codeOf(await calls.get(ratingComment(s, s.qosimov)))).toBe('journal_scope');
    });
  });

  it('shows the readers of attendance no rating exam and no comment but on marks (decision 10)', async () => {
    const s = await scene();
    for (const role of ['head_tutor', 'spiritual_vice_principal'] as const) {
      const reader = await account();
      await as(reader, s.branch, [{ role, branchId: s.branch }], async (calls) => {
        const grid = journalGridSchema.parse(
          (await calls.get(`/api/journal/journals/${s.journal}`)).body,
        );
        expect(grid.shape).toBe('attendance');
        expect(grid.rating).toBeNull();
        expect(grid.students.flatMap((one) => one.comments)).toEqual([]);
        expect(codeOf(await calls.get(ratingHistory(s, s.nurova)))).toBe('journal_scope');
        expect(codeOf(await calls.get(ratingComment(s, s.nurova)))).toBe('journal_scope');
        expect(
          codeOf(
            await calls.get(
              commentHistory(s, { target: 'note', studentId: s.nurova, lessonId: s.lesson }),
            ),
          ),
        ).toBe('journal_scope');
      });
    }
  });

  it('lets a Head Teacher of the subject read both histories, and refuses one of another subject and a Teacher with no lesson', async () => {
    const s = await scene();
    const own = await account();
    await as(
      own,
      s.branch,
      [{ role: 'head_teacher', branchId: s.branch, subjectIds: [cells.subject] }],
      async (calls) => {
        expect((await calls.get(ratingHistory(s, s.qosimov))).status).toBe(200);
        expect((await calls.get(ratingComment(s, s.qosimov))).status).toBe(200);
      },
    );
    const other = await account();
    await as(other, s.branch, [{ role: 'head_teacher', branchId: s.branch }], async (calls) => {
      expect(codeOf(await calls.get(ratingHistory(s, s.qosimov)))).toBe('journal_scope');
      expect(codeOf(await calls.get(ratingComment(s, s.qosimov)))).toBe('journal_scope');
    });
    const teacher = await account();
    await as(teacher, s.branch, [{ role: 'teacher', branchId: s.branch }], async (calls) => {
      expect(codeOf(await calls.get(ratingHistory(s, s.qosimov)))).toBe('journal_scope');
    });
  });

  it('lets the Super Admin set the date, "exempt" and "not held", and answers it 404 for another branch\'s journal', async () => {
    const s = await scene();
    const other = await scene();
    const base = `/api/journal/journals/${s.journal}/rating/${s.quarter}`;
    const send = (method: 'put' | 'post', path: string, body: object) =>
      request(t.kit.server)
        [method](path)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .send(body);
    const dated = ratingExamSchema.parse(
      (await send('put', `${base}/date`, { date: '2026-10-06', version: 1 })).body,
    );
    expect(dated.date).toBe('2026-10-06');
    const exempt = await send('post', `${base}/entries`, {
      studentId: s.nurova,
      entry: { kind: 'exempt' },
      reason: 'Competition on the exam day',
      version: 1,
    });
    expect(exempt.status, JSON.stringify(exempt.body)).toBe(200);
    expect(
      codeOf(await send('put', `${base}/not-held`, { notHeld: true, version: dated.version })),
    ).toBe('rating_exam_entries');
    const held = await send('put', `${base}/not-held`, {
      notHeld: true,
      version: dated.version,
      confirm: true,
    });
    expect(held.status, JSON.stringify(held.body)).toBe(200);
    const elsewhere = `/api/journal/journals/${other.journal}/rating/${other.quarter}`;
    expect(codeOf(await send('put', `${elsewhere}/date`, { date: '2026-10-06', version: 1 }))).toBe(
      'not_found',
    );
    expect(codeOf(await send('put', `${elsewhere}/not-held`, { notHeld: true, version: 1 }))).toBe(
      'not_found',
    );
    expect(
      codeOf(
        await send('post', `${elsewhere}/entries`, {
          studentId: other.nurova,
          entry: { kind: 'exempt' },
          reason: 'x',
          version: 1,
        }),
      ),
    ).toBe('not_found');
  });

  it('answers 404 for every id of the comment history that the branch does not hold, and for a work of another lesson', async () => {
    const s = await scene();
    const other = await scene();
    const work = (
      await t.database.migrator
        .insertInto('journal_works')
        .values({
          branch_id: s.branch,
          lesson_id: s.lesson,
          source_lesson_id: s.lesson,
          position: 1,
          kind: 'classwork',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const otherWork = (
      await t.database.migrator
        .insertInto('journal_works')
        .values({
          branch_id: other.branch,
          lesson_id: other.lesson,
          source_lesson_id: other.lesson,
          position: 1,
          kind: 'classwork',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const secondLesson = await cells.groupLesson(s.branch, s.year, s.group, '2026-10-19');
    const vice = await account();
    await as(
      vice,
      s.branch,
      [{ role: 'academic_vice_principal', branchId: s.branch }],
      async (calls) => {
        // Read after the role is given: giving it writes an entry of its own.
        const audits = await t.auditCount();
        expect(
          (
            await calls.get(
              commentHistory(s, {
                target: 'work',
                studentId: s.nurova,
                lessonId: s.lesson,
                workId: work,
              }),
            )
          ).status,
        ).toBe(200);
        for (const query of <Record<string, string>[]>[
          { target: 'note', studentId: s.nurova, lessonId: randomUUID() },
          { target: 'note', studentId: s.nurova, lessonId: other.lesson },
          { target: 'note', studentId: other.nurova, lessonId: s.lesson },
          { target: 'note', studentId: randomUUID(), lessonId: s.lesson },
          { target: 'work', studentId: s.nurova, lessonId: s.lesson, workId: randomUUID() },
          { target: 'work', studentId: s.nurova, lessonId: s.lesson, workId: otherWork },
          { target: 'work', studentId: s.nurova, lessonId: secondLesson, workId: work },
          { target: 'rating', studentId: s.nurova, journalId: randomUUID(), quarterId: s.quarter },
          {
            target: 'rating',
            studentId: s.nurova,
            journalId: other.journal,
            quarterId: other.quarter,
          },
          { target: 'rating', studentId: s.nurova, journalId: s.journal, quarterId: randomUUID() },
        ]) {
          expect(codeOf(await calls.get(commentHistory(s, query))), JSON.stringify(query)).toBe(
            'not_found',
          );
        }
        // A comment save naming another branch's work or an unknown journal: 404, nothing written.
        const rows = await t.database.migrator
          .selectFrom('journal_comments')
          .selectAll()
          .orderBy('id')
          .execute();
        for (const on of [
          { target: 'work', lessonId: s.lesson, workId: otherWork, studentId: s.nurova },
          { target: 'rating', journalId: randomUUID(), quarterId: s.quarter, studentId: s.nurova },
        ]) {
          expect(
            codeOf(
              await calls.put('/api/journal/comments', {
                on,
                body: 'Text',
                visibility: 'staff',
                version: null,
              }),
            ),
          ).toBe('not_found');
        }
        expect(
          await t.database.migrator
            .selectFrom('journal_comments')
            .selectAll()
            .orderBy('id')
            .execute(),
        ).toEqual(rows);
        expect(await t.auditCount()).toBe(audits);
      },
    );
  });

  it('refuses a switch change for scores held in another branch, with a count and no name (decisions 2 and 3)', async () => {
    await scene();
    const branch = await t.newBranch();
    const vice = await account();
    await as(
      vice,
      branch,
      [{ role: 'academic_vice_principal', branchId: branch }],
      async (calls) => {
        const listed = subjectListSchema.parse((await calls.get('/api/setup/subjects')).body);
        const subject = listed.subjects.find((one) => one.id === cells.subject) as Subject;
        const refused = await calls.put(`/api/setup/subjects/${cells.subject}`, {
          names: subject.names,
          departmentId: subject.departmentId,
          grades: subject.grades,
          colour: subject.colour,
          journalType: subject.journalType,
          ratingExam: false,
          groupSubject: subject.groupSubject,
          languageRule: subject.languageRule,
          demanding: subject.demanding,
          daily: subject.daily === null ? { attendance: 20, classwork: 40, homework: 40 } : null,
          switchesFrom: 1,
        });
        expect(codeOf(refused)).toBe('subject_switch_scores');
        const details = (refused.body as { error: { details: Record<string, unknown>[] } }).error
          .details;
        expect(details).toHaveLength(1);
        expect(Object.keys(details[0] ?? {}).sort()).toEqual(['code', 'count', 'message', 'path']);
        expect(Number(details[0]?.count)).toBeGreaterThanOrEqual(1);
      },
    );
  });
});
