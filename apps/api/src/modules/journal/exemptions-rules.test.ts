import { randomUUID } from 'node:crypto';
import {
  REQUEST_KEY_HEADER,
  exemptionCreatedSchema,
  exemptionPreviewSchema,
  exemptionSchema,
  exemptionsTodaySchema,
  journalGridSchema,
  type ExemptionCreate,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setEditDays } from '../../testing/branch-filter-sql.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ?? `status ${response.status}`;

const ok = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as unknown;
};

// All names are invented. Task 8.5, pull request #223: the rules of exemptions the code
// reviews found untested (07, Exemptions; edge/exemptions; edge/system-behaviour).
describe('exemptions, the rules', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Malika', `Yusupova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };
  interface Calls {
    get: (path: string) => Promise<Response>;
    post: (path: string, body?: object, key?: string) => Promise<Response>;
    patch: (path: string, body: object) => Promise<Response>;
    put: (path: string, body: object) => Promise<Response>;
  }

  async function as<T>(
    branch: string,
    browser: Browser,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (calls: Calls) => Promise<T>,
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
      return await work({
        get: (path) => t.get(path, branch, browser.cookie),
        post: (path, body, key) =>
          t
            .post(path, branch, body ?? {}, browser.cookie)
            .set(REQUEST_KEY_HEADER, key ?? randomUUID()),
        patch: (path, body) => t.patch(path, branch, body, browser.cookie),
        put: (path, body) =>
          t.put(path, branch, body, browser.cookie).set(REQUEST_KEY_HEADER, randomUUID()),
      });
    } finally {
      t.clock.set(START);
    }
  }

  const student = async (branch: string, classId: string, last: string): Promise<string> => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: 'Olim', last_name: last })
      .where('id', '=', id)
      .execute();
    await members.member({ branch, classId, studentId: id, from: '2026-09-01' });
    return id;
  };

  /** The Tutor of the class: an account with the Tutor role and a Tutor row from 1 September. */
  async function tutorOf(branch: string, classId: string): Promise<Browser> {
    const browser = await account();
    const assignment = await t.kit.giveRole(browser.account.id, {
      role: 'tutor',
      branchId: branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    await load.classes.person(branch, ['uz'], { accountId: browser.account.id });
    await load.classes.tutorRow(branch, classId, assignment.id);
    return browser;
  }

  async function scene(options: { double?: boolean } = {}) {
    const owner = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id },
      ...(options.double === true ? { double: true } : {}),
    });
    const lessonsOf = async (classId: string) =>
      (
        await t.database.migrator
          .selectFrom('lessons')
          .select(['id', sql<string>`lesson_date::text`.as('date')])
          .where('class_id', '=', classId)
          .where('lesson_date', '<=', '2026-11-30')
          .orderBy('starts_at')
          .execute()
      ).map((row) => ({ id: row.id, date: row.date }));
    const vice = await account();
    await t.kit.giveRole(vice.account.id, {
      role: 'academic_vice_principal',
      branchId: s.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    const all = await lessonsOf(s.classId);
    return {
      ...s,
      owner,
      vice,
      // The held lessons of the class (12, 19 and 26 October), then the later ones.
      lessons: all.filter((one) => one.date <= '2026-10-31'),
      later: all.filter((one) => one.date > '2026-10-31'),
      otherLessons: await lessonsOf(s.otherClass),
      ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
      boboyev: await student(s.branch, s.classId, 'Boboyev'),
      other: await student(s.branch, s.otherClass, 'Sobirov'),
    };
  }

  /** A typed mark, written by the migrator at a moment of the lesson's day. */
  const mark = async (branch: string, lessonId: string, studentId: string, value: number) =>
    t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', '2026-10-12T09:00:00+05:00', true)`.execute(
        transaction,
      );
      const row = await transaction
        .insertInto('journal_cells')
        .values({
          branch_id: branch,
          lesson_id: lessonId,
          student_id: studentId,
          mark: value,
          version: 1,
          changed_by: await accountOfAdmin(),
          changed_how: 'entry',
          changed_at: new Date(0),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });

  let admin = '';
  const accountOfAdmin = async () => {
    if (admin === '') {
      const row = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.adminAssignment)
        .executeTakeFirstOrThrow();
      admin = row.account_id;
    }
    return admin;
  };

  /** The clock at the moment, with the Super Admin's session in use then. */
  const adminAt = async (moment: string) => {
    t.clock.set(moment);
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
      .where('account_id', '=', await accountOfAdmin())
      .execute();
  };

  const cellOf = (lessonId: string, studentId: string) =>
    t.database.migrator
      .selectFrom('journal_cells')
      .select(['id', 'mark', 'version', 'changed_how'])
      .where('lesson_id', '=', lessonId)
      .where('student_id', '=', studentId)
      .where('work_id', 'is', null)
      .executeTakeFirst();

  const expected = (lessonId: string, studentId: string) =>
    sql<{ expected: boolean; kind: string | null }>`
      select lesson_student_expected(${lessonId}::uuid, ${studentId}::uuid) as expected,
        lesson_student_exemption(${lessonId}::uuid, ${studentId}::uuid) as kind
    `
      .execute(t.database.migrator)
      .then((found) => found.rows[0]);

  const body = (input: Partial<ExemptionCreate> & { studentIds: string[] }): ExemptionCreate => ({
    kind: 'temporary',
    subjectIds: null,
    startDate: '2026-10-12',
    endDate: '2026-10-20',
    slots: null,
    category: 'illness',
    detail: 'A certificate from the clinic',
    choices: [],
    ...input,
  });

  const noticesTo = (kind: string, accountId: string) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['account_id', 'data'])
      .where('kind', '=', kind)
      .where('account_id', '=', accountId)
      .orderBy('id')
      .execute();

  /** Creates exemptions as the vice and answers the first id and the batch. */
  const create = async (branch: string, vice: Browser, input: ExemptionCreate) =>
    as(branch, vice, [], async ({ post }) => {
      const created = exemptionCreatedSchema.parse(ok(await post('/api/exemptions', input)));
      return { id: created.exemptions[0]?.id ?? '', batch: created.batchId, all: created };
    });

  const clearsOf = (lessonId: string, studentId: string) =>
    t.database.migrator
      .selectFrom('exemption_clears')
      .select(['id', 'given_back_at'])
      .where('lesson_id', '=', lessonId)
      .where('student_id', '=', studentId)
      .execute();

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a full and a temporary exemption over one lesson (edge/exemptions, row 1)', () => {
    it('keeps the cell closed and gives nothing back when one of them ends', async () => {
      const s = await scene();
      const [first] = s.lessons;
      if (first === undefined) throw new Error('A held lesson.');
      await mark(s.branch, first.id, s.ahmedov, 1);
      const temporary = await create(
        s.branch,
        s.vice,
        body({
          studentIds: [s.ahmedov],
          choices: [{ studentId: s.ahmedov, lessonId: first.id, choice: 'exempt' }],
        }),
      );
      // A full exemption of the subject to the year's end, from the same day (a late certificate).
      await create(
        s.branch,
        s.vice,
        body({
          studentIds: [s.ahmedov],
          kind: 'full',
          endDate: null,
          subjectIds: [s.subject],
        }),
      );
      expect(await expected(first.id, s.ahmedov)).toEqual({ expected: false, kind: 'full' });
      await as(s.branch, s.vice, [], async ({ post }) => {
        ok(
          await post(`/api/exemptions/${temporary.id}/void`, {
            version: 1,
            reason: 'Entered twice',
          }),
        );
      });
      // The full one still covers the lesson: the cell stays closed and cleared.
      expect(await expected(first.id, s.ahmedov)).toEqual({ expected: false, kind: 'full' });
      expect(await cellOf(first.id, s.ahmedov)).toMatchObject({
        mark: null,
        changed_how: 'exemption',
      });
      expect((await clearsOf(first.id, s.ahmedov)).map((one) => one.given_back_at)).toEqual([null]);
    });
  });

  describe('a lesson removed after "exempt and clear" (correction 2)', () => {
    it('takes the clears and the skips with the lesson, and the exemption stays', async () => {
      const s = await scene();
      const [first, second] = s.lessons;
      if (first === undefined || second === undefined) throw new Error('Two held lessons.');
      await mark(s.branch, first.id, s.ahmedov, 1);
      await mark(s.branch, second.id, s.ahmedov, 2);
      const made = await create(
        s.branch,
        s.vice,
        body({
          studentIds: [s.ahmedov],
          choices: [
            { studentId: s.ahmedov, lessonId: first.id, choice: 'exempt' },
            { studentId: s.ahmedov, lessonId: second.id, choice: 'keep' },
          ],
        }),
      );
      const skips = () =>
        t.database.migrator
          .selectFrom('exemption_skips')
          .select('lesson_id')
          .where('exemption_id', '=', made.id)
          .execute();
      expect(await clearsOf(first.id, s.ahmedov)).toHaveLength(1);
      expect(await skips()).toHaveLength(1);
      await adminAt(MOMENT);
      for (const lesson of [first, second]) {
        const removed = await t
          .post(
            `/api/timetable/lessons/${lesson.id}/forced-delete`,
            s.branch,
            { reason: 'Entered for the wrong class' },
            t.admin,
          )
          .set(REQUEST_KEY_HEADER, randomUUID());
        expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      }
      await adminAt(START);
      expect(await clearsOf(first.id, s.ahmedov)).toEqual([]);
      expect(await skips()).toEqual([]);
      const read = await as(s.branch, s.vice, [], async ({ get }) =>
        exemptionSchema.parse(ok(await get(`/api/exemptions/${made.id}`))),
      );
      expect(read).toMatchObject({ startDate: '2026-10-12', endDate: '2026-10-20' });
    });
  });

  describe('the readers of marks (decision 2)', () => {
    it('counts no hidden mark as "at school earlier", and copies none into the second lesson', async () => {
      const s = await scene({ double: true });
      const pair = s.lessons.filter((one) => one.date === '2026-10-26');
      const [first, second] = pair;
      if (first === undefined || second === undefined) throw new Error('A double on 26 October.');
      // The two lessons of the day as a double (as `journal-locks.test.ts` pairs them).
      const blocks = await t.database.migrator
        .selectFrom('lessons')
        .select('block_id')
        .where('id', 'in', [first.id, second.id])
        .execute();
      await t.database.migrator
        .updateTable('lesson_blocks')
        .set({ double_pair_id: randomUUID() })
        .where(
          'id',
          'in',
          blocks.map((one) => one.block_id ?? ''),
        )
        .execute();
      await mark(s.branch, first.id, s.ahmedov, 1);
      await mark(s.branch, first.id, s.boboyev, 1);
      // Ahmedov is exempt from the first lesson of the day only (its slot, 08:00–08:45).
      await create(
        s.branch,
        s.vice,
        body({
          studentIds: [s.ahmedov],
          startDate: '2026-10-26',
          endDate: '2026-10-26',
          slots: { start: '08:00', end: '08:45' },
          choices: [{ studentId: s.ahmedov, lessonId: first.id, choice: 'keep' }],
        }),
      );
      // "Keep" leaves the present mark counted: drop the skip, so the mark is hidden.
      await t.database.migrator
        .deleteFrom('exemption_skips')
        .where('lesson_id', '=', first.id)
        .execute();
      expect(await expected(first.id, s.ahmedov)).toEqual({ expected: false, kind: 'temporary' });
      expect(await expected(second.id, s.ahmedov)).toEqual({ expected: true, kind: null });
      await as(s.branch, s.owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        const copied = ok(await post(`/api/journal/lessons/${second.id}/copy-attendance`)) as {
          filled: { studentId: string }[];
        };
        expect(copied.filled.map((one) => one.studentId)).toEqual([s.boboyev]);
        const saved = ok(
          await post(`/api/journal/lessons/${second.id}/attendance`, {
            saves: [
              { studentId: s.ahmedov, mark: 0, version: null },
              {
                studentId: s.boboyev,
                mark: 0,
                version: (await cellOf(second.id, s.boboyev))?.version ?? null,
              },
            ],
          }),
        ) as { presentEarlier: string[] };
        // Boboyev was marked present in the first lesson; Ahmedov's mark there is hidden.
        expect(saved.presentEarlier).toEqual([s.boboyev]);
      });
    });
  });

  describe('an end into the past (edge/exemptions, row 4)', () => {
    it('gives back the marks of the lessons after the new end, and reopens a locked one', async () => {
      const s = await scene();
      await setEditDays(t.database.migrator, s.branch, 7);
      const [first, second, third] = s.lessons;
      if (first === undefined || second === undefined || third === undefined) {
        throw new Error('Three held lessons.');
      }
      await mark(s.branch, second.id, s.ahmedov, 1);
      await mark(s.branch, third.id, s.ahmedov, 2);
      const made = await create(
        s.branch,
        s.vice,
        body({
          studentIds: [s.ahmedov],
          endDate: '2026-10-26',
          choices: [
            { studentId: s.ahmedov, lessonId: second.id, choice: 'exempt' },
            { studentId: s.ahmedov, lessonId: third.id, choice: 'exempt' },
          ],
        }),
      );
      expect(await cellOf(second.id, s.ahmedov)).toMatchObject({ mark: null });
      await as(s.branch, s.vice, [], async ({ post }) => {
        const preview = exemptionPreviewSchema.parse(
          ok(
            await post(`/api/exemptions/${made.id}/end/preview`, {
              version: 1,
              endDate: '2026-10-12',
              choices: [],
            }),
          ),
        );
        expect(preview.students[0]?.reopen.map((one) => [one.lessonId, one.givesBack])).toEqual([
          [second.id, true],
          [third.id, true],
        ]);
        expect(
          exemptionSchema.parse(
            ok(
              await post(`/api/exemptions/${made.id}/end`, {
                version: 1,
                endDate: '2026-10-12',
                choices: [],
              }),
            ),
          ),
        ).toMatchObject({ endDate: '2026-10-12', endCause: 'end' });
      });
      expect(await expected(first.id, s.ahmedov)).toEqual({ expected: false, kind: 'temporary' });
      expect(await cellOf(second.id, s.ahmedov)).toMatchObject({
        mark: 1,
        changed_how: 'exemption',
      });
      expect(await cellOf(third.id, s.ahmedov)).toMatchObject({ mark: 2 });
      const reopened = await t.database.migrator
        .selectFrom('exemption_reopened_cells')
        .select('lesson_id')
        .where('exemption_id', '=', made.id)
        .execute();
      // The lesson of 19 October is locked after 7 edit days; the one of 26 October is not.
      expect(reopened.map((one) => one.lesson_id)).toContain(second.id);
      expect(await t.entries('exemption.end', s.ahmedov)).toHaveLength(1);
    });
  });

  describe('a transfer (edge/exemptions, row 12)', () => {
    it('follows the student into the lessons of the new class', async () => {
      const s = await scene();
      await create(
        s.branch,
        s.vice,
        body({ studentIds: [s.ahmedov], startDate: '2026-11-02', endDate: '2026-11-20' }),
      );
      await adminAt(MOMENT);
      const read = await t.get(`/api/people/students/${s.ahmedov}`, s.branch, t.admin);
      const moved = await t.post(
        '/api/classes/transfers',
        s.branch,
        {
          studentId: s.ahmedov,
          version: (read.body as { version: number }).version,
          toClassId: s.otherClass,
          from: '2026-11-02',
        },
        t.admin,
      );
      await adminAt(START);
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const inNew = s.otherLessons.find((one) => one.date === '2026-11-09');
      const inOld = s.later.find((one) => one.date === '2026-11-09');
      if (inNew === undefined || inOld === undefined) throw new Error('The lessons of 9 November.');
      expect(await expected(inNew.id, s.ahmedov)).toEqual({ expected: false, kind: 'temporary' });
      // No longer a member of the old class: neither expected nor exempt there.
      expect(await expected(inOld.id, s.ahmedov)).toMatchObject({ expected: false });
    });
  });

  describe('the journal (From 4.3, From 8.2)', () => {
    it('flags a result based on few lessons, with how many', async () => {
      const s = await scene({ double: true });
      const late = s.lessons.filter((one) => one.date === '2026-10-26');
      const [first, second] = late;
      if (first === undefined || second === undefined) throw new Error('A double on 26 October.');
      await mark(s.branch, second.id, s.ahmedov, 1);
      // 12 and 19 October whole days, and the first lesson of 26 October: one lesson of six left.
      await create(
        s.branch,
        s.vice,
        body({ studentIds: [s.ahmedov], startDate: '2026-10-12', endDate: '2026-10-19' }),
      );
      await create(
        s.branch,
        s.vice,
        body({
          studentIds: [s.ahmedov],
          startDate: '2026-10-26',
          endDate: '2026-10-26',
          slots: { start: '08:00', end: '08:45' },
        }),
      );
      const journal = (
        await t.database.migrator
          .selectFrom('journals')
          .select('id')
          .where('class_id', '=', s.classId)
          .executeTakeFirstOrThrow()
      ).id;
      const grid = await as(
        s.branch,
        s.owner,
        [{ role: 'teacher', branchId: s.branch }],
        async ({ get }) =>
          journalGridSchema.parse(ok(await get(`/api/journal/journals/${journal}`))),
      );
      const result = grid.students.find((one) => one.id === s.ahmedov)?.quarter?.result;
      expect(result).toMatchObject({ kind: 'number', basedOn: { expected: 1, held: 6 } });
      const boboyev = grid.students.find((one) => one.id === s.boboyev)?.quarter?.result;
      expect(boboyev).not.toMatchObject({ basedOn: { expected: 1 } });
    });

    it('marks a student exempt on the rating exam day pending', async () => {
      const s = await scene();
      await t.database.migrator
        .updateTable('subjects')
        .set({ rating_exam: true })
        .where('id', '=', s.subject)
        .execute();
      await t.database.migrator
        .updateTable('subject_quarter_weights')
        .set({ attendance: 20, classwork: 20, homework: 20, rating_exam: 40 })
        .where('subject_id', '=', s.subject)
        .where('branch_id', '=', s.branch)
        .execute();
      const journal = (
        await t.database.migrator
          .selectFrom('journals')
          .select('id')
          .where('class_id', '=', s.classId)
          .executeTakeFirstOrThrow()
      ).id;
      const quarter = (
        await t.database.migrator
          .selectFrom('quarters')
          .select('id')
          .where('academic_year_id', '=', s.year)
          .where('number', '=', 1)
          .executeTakeFirstOrThrow()
      ).id;
      await as(s.branch, s.owner, [{ role: 'teacher', branchId: s.branch }], async ({ put }) => {
        ok(
          await put(`/api/journal/journals/${journal}/rating/${quarter}/date`, {
            date: '2026-10-26',
            version: null,
          }),
        );
      });
      await create(
        s.branch,
        s.vice,
        body({ studentIds: [s.ahmedov], startDate: '2026-10-26', endDate: '2026-10-26' }),
      );
      const grid = await as(s.branch, s.owner, [], async ({ get }) =>
        journalGridSchema.parse(
          ok(await get(`/api/journal/journals/${journal}?quarterId=${quarter}`)),
        ),
      );
      expect(grid.rating?.pending).toEqual([s.ahmedov]);
    });
  });

  describe('an end at midnight (edge/system-behaviour)', () => {
    it('shows the student exempt at 23:59 of the last day and back at 00:00 the next', async () => {
      const s = await scene();
      await create(
        s.branch,
        s.vice,
        body({ studentIds: [s.ahmedov], startDate: '2026-11-02', endDate: '2026-11-03' }),
      );
      const tutor = await tutorOf(s.branch, s.classId);
      const cardsAt = (moment: string) =>
        as(
          s.branch,
          tutor,
          [],
          async ({ get }) =>
            exemptionsTodaySchema.parse(ok(await get('/api/journal/exemptions-today'))),
          moment,
        );
      const late = await cardsAt('2026-11-03T23:59:00+05:00');
      expect(late.date).toBe('2026-11-03');
      expect(late.exemptToday.map((one) => one.student.id)).toEqual([s.ahmedov]);
      expect(late.backToday).toEqual([]);
      const next = await cardsAt('2026-11-04T00:00:00+05:00');
      expect(next.date).toBe('2026-11-04');
      expect(next.exemptToday).toEqual([]);
      expect(next.backToday.map((one) => one.student.id)).toEqual([s.ahmedov]);
      // The span of the exemption, in the branch's local time.
      const covered = await sql<{ late: boolean; next: boolean }>`
        select bool_or(s.span @> '2026-11-03 23:59'::timestamp) as late,
          bool_or(s.span @> '2026-11-04 00:00'::timestamp) as next
        from exemption_spans s where s.student_id = ${s.ahmedov}::uuid and s.live
      `.execute(t.database.migrator);
      expect(covered.rows[0]).toEqual({ late: true, next: false });
    });
  });

  describe('a batch end (edge/exemptions, row 8)', () => {
    it('ends every exemption of the batch, with an entry and a notice for each', async () => {
      const s = await scene();
      const made = await create(
        s.branch,
        s.vice,
        body({
          studentIds: [s.ahmedov, s.boboyev],
          startDate: '2026-10-28',
          endDate: '2026-11-20',
          category: 'competition',
          detail: 'Olympiad',
        }),
      );
      await as(s.branch, s.vice, [], async ({ post }) => {
        ok(
          await post(`/api/exemptions/batches/${made.batch}/end`, {
            endDate: '2026-11-10',
            choices: [],
          }),
        );
      });
      const stored = await t.database.migrator
        .selectFrom('exemptions')
        .select(['student_id', sql<string>`end_date::text`.as('end'), 'end_cause'])
        .where('batch_id', '=', made.batch)
        .orderBy('student_id')
        .execute();
      expect(stored.map((one) => [one.end, one.end_cause])).toEqual([
        ['2026-11-10', 'end'],
        ['2026-11-10', 'end'],
      ]);
      expect(await t.entries('exemption.end', s.ahmedov)).toHaveLength(1);
      expect(await t.entries('exemption.end', s.boboyev)).toHaveLength(1);
      const told = await noticesTo('journal.exemption_changed', s.owner.account.id);
      expect(
        told
          .map((one) => one.data as { student: string; change: string; until: string })
          .map((one) => [one.student, one.change, one.until])
          .sort(),
      ).toEqual([
        ['Ahmedov Olim', 'ended', '2026-11-10'],
        ['Boboyev Olim', 'ended', '2026-11-10'],
      ]);
    });
  });

  describe('a batch void over a locked lesson (edge/journal, Locks)', () => {
    it('tells the teacher once, naming both students', async () => {
      const s = await scene();
      await setEditDays(t.database.migrator, s.branch, 7);
      const [first] = s.lessons;
      if (first === undefined) throw new Error('A held lesson.');
      await mark(s.branch, first.id, s.ahmedov, 1);
      await mark(s.branch, first.id, s.boboyev, 1);
      const made = await create(
        s.branch,
        s.vice,
        body({
          studentIds: [s.ahmedov, s.boboyev],
          endDate: '2026-10-12',
          choices: [
            { studentId: s.ahmedov, lessonId: first.id, choice: 'exempt' },
            { studentId: s.boboyev, lessonId: first.id, choice: 'exempt' },
          ],
        }),
      );
      await as(s.branch, s.vice, [], async ({ post }) => {
        ok(await post(`/api/exemptions/batches/${made.batch}/void`, { reason: 'Wrong class' }));
      });
      const told = await noticesTo('journal.exemption_reopened', s.owner.account.id);
      expect(told.map((one) => one.data)).toEqual([
        { students: 'Ahmedov Olim, Boboyev Olim', lessons: 1 },
      ]);
      expect(await cellOf(first.id, s.boboyev)).toMatchObject({ mark: 1 });
    });
  });
  // The fixes of the code reviews of task 8.5, each through its route.
  describe('what the code reviews found', () => {
    const edit = (input: Partial<ExemptionCreate>) => ({
      kind: 'temporary',
      subjectIds: null,
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      slots: null,
      category: 'illness',
      detail: 'A certificate from the clinic',
      choices: [],
      version: 1,
      ...input,
    });

    it('moves the start of an exemption of chosen subjects into the past, and turns all subjects into chosen ones (must-fix 3)', async () => {
      const s = await scene();
      const chosen = await create(
        s.branch,
        s.vice,
        body({
          studentIds: [s.ahmedov],
          subjectIds: [s.subject],
          startDate: '2026-11-10',
          endDate: '2026-11-12',
        }),
      );
      const every = await create(
        s.branch,
        s.vice,
        body({ studentIds: [s.boboyev], startDate: '2026-11-10', endDate: '2026-11-12' }),
      );
      await as(s.branch, s.vice, [], async ({ patch }) => {
        const late = exemptionSchema.parse(
          ok(
            await patch(
              `/api/exemptions/${chosen.id}`,
              edit({ subjectIds: [s.subject], startDate: '2026-10-20' }),
            ),
          ),
        );
        expect(late).toMatchObject({ startDate: '2026-10-20', subjects: [{ id: s.subject }] });
        const narrowed = exemptionSchema.parse(
          ok(
            await patch(
              `/api/exemptions/${every.id}`,
              edit({ subjectIds: [s.subject], startDate: '2026-10-20' }),
            ),
          ),
        );
        expect(narrowed).toMatchObject({ startDate: '2026-10-20', subjects: [{ id: s.subject }] });
      });
      const third = s.lessons[2];
      if (third === undefined) throw new Error('The lesson of 26 October.');
      expect(await expected(third.id, s.ahmedov)).toEqual({ expected: false, kind: 'temporary' });
      expect(await expected(third.id, s.boboyev)).toEqual({ expected: false, kind: 'temporary' });
    });

    it('ends a full exemption that has not started, by an End and by a leaving after its start (must-fix 2)', async () => {
      const s = await scene();
      const ended = await create(
        s.branch,
        s.vice,
        body({ studentIds: [s.ahmedov], kind: 'full', endDate: null, startDate: '2026-11-10' }),
      );
      await as(s.branch, s.vice, [], async ({ post }) => {
        expect(
          exemptionSchema.parse(
            ok(
              await post(`/api/exemptions/${ended.id}/end`, {
                version: 1,
                endDate: '2026-11-20',
                choices: [],
              }),
            ),
          ),
        ).toMatchObject({ endDate: '2026-11-20', endCause: 'end' });
      });
      const left = await create(
        s.branch,
        s.vice,
        body({ studentIds: [s.other], kind: 'full', endDate: null, startDate: '2026-11-02' }),
      );
      await adminAt(MOMENT);
      const read = await t.get(`/api/people/students/${s.other}`, s.branch, t.admin);
      const leaving = await t.post(
        `/api/people/students/${s.other}/leaving`,
        s.branch,
        {
          lastDay: '2026-11-15',
          reason: 'Moved to another city',
          version: (read.body as { version: number }).version,
        },
        t.admin,
      );
      await adminAt(START);
      expect(leaving.status, JSON.stringify(leaving.body)).toBe(200);
      const stored = await t.database.migrator
        .selectFrom('exemptions')
        .select([sql<string>`end_date::text`.as('end'), 'leaving_id'])
        .where('id', '=', left.id)
        .executeTakeFirstOrThrow();
      expect(stored.end).toBe('2026-11-15');
      expect(stored.leaving_id).not.toBeNull();
    });

    it('refuses to take a leaving back over an exemption entered since (note 3)', async () => {
      const s = await scene();
      await create(
        s.branch,
        s.vice,
        body({ studentIds: [s.other], startDate: '2026-10-28', endDate: '2026-11-20' }),
      );
      await adminAt(MOMENT);
      const read = await t.get(`/api/people/students/${s.other}`, s.branch, t.admin);
      const leaving = await t.post(
        `/api/people/students/${s.other}/leaving`,
        s.branch,
        {
          lastDay: '2026-11-10',
          reason: 'Moved to another city',
          version: (read.body as { version: number }).version,
        },
        t.admin,
      );
      expect(leaving.status, JSON.stringify(leaving.body)).toBe(200);
      await adminAt(START);
      // An exemption over the days the leaving cut, entered after it.
      await create(
        s.branch,
        s.vice,
        body({ studentIds: [s.other], startDate: '2026-11-16', endDate: '2026-11-18' }),
      );
      await adminAt(MOMENT);
      const cancelled = await t.post(
        `/api/people/students/${s.other}/leaving/cancel`,
        s.branch,
        { version: (leaving.body as { version: number }).version },
        t.admin,
      );
      await adminAt(START);
      expect(codeOf(cancelled)).toBe('student_status_exemption_overlap');
    });

    it('keeps an absence an exemption of one subject or of some slots leaves, and drops one a whole day covers (should-fix 7)', async () => {
      const s = await scene();
      const reason = (studentId: string) =>
        t.database.migrator.transaction().execute(async (transaction) => {
          await sql`select set_config('app.now', '2026-10-27T09:00:00+05:00', true)`.execute(
            transaction,
          );
          await transaction
            .insertInto('student_absence_reasons')
            .values({
              branch_id: s.branch,
              student_id: studentId,
              absence_date: '2026-10-26',
              category: 'illness',
              note: '',
              changed_by: s.vice.account.id,
              changed_at: new Date(0),
            })
            .execute();
        });
      for (const one of [s.ahmedov, s.boboyev, s.other]) await reason(one);
      const day = { startDate: '2026-10-26', endDate: '2026-10-26' };
      await create(
        s.branch,
        s.vice,
        body({ studentIds: [s.ahmedov], ...day, subjectIds: [s.subject] }),
      );
      await create(
        s.branch,
        s.vice,
        body({ studentIds: [s.boboyev], ...day, slots: { start: '10:00', end: '11:00' } }),
      );
      await create(s.branch, s.vice, body({ studentIds: [s.other], ...day }));
      const listed = await as(s.branch, s.vice, [], async ({ get }) =>
        (
          ok(await get('/api/exemptions/absences-without')) as {
            items: { student: { id: string } }[];
          }
        ).items
          .map((one) => one.student.id)
          .sort(),
      );
      expect(listed).toEqual([s.ahmedov, s.boboyev].sort());
    });

    it("answers the year's last day in the preview of a void (should-fix 6)", async () => {
      const s = await scene();
      const made = await create(
        s.branch,
        s.vice,
        body({ studentIds: [s.ahmedov], startDate: '2026-11-10', endDate: '2026-11-12' }),
      );
      const year = await t.database.migrator
        .selectFrom('academic_years')
        .select(sql<string>`end_date::text`.as('end'))
        .where('id', '=', s.year)
        .executeTakeFirstOrThrow();
      expect(year.end).not.toBe('2026-11-12');
      await as(s.branch, s.vice, [], async ({ post }) => {
        const preview = exemptionPreviewSchema.parse(
          ok(await post(`/api/exemptions/${made.id}/void/preview`, { version: 1 })),
        );
        expect(preview.yearEnd).toBe(year.end);
      });
    });

    it('carries an exemption of a closed year to the kept record of a merge (should-fix 4)', async () => {
      const s = await scene();
      const twice = await student(s.branch, s.classId, 'Ahmedov');
      const made = await create(
        s.branch,
        s.vice,
        body({ studentIds: [twice], startDate: '2026-11-10', endDate: '2026-11-12' }),
      );
      // The scene's branch and year are its own; a closed year is final.
      await load.classes.setYear(s.year, 'closed');
      try {
        await adminAt(MOMENT);
        const uid = (
          (await t.get(`/api/people/students/${twice}`, s.branch, t.admin)).body as { uid: string }
        ).uid;
        const seen = await t.get(
          `/api/people/students/${s.ahmedov}/merge?uid=${uid}`,
          s.branch,
          t.admin,
        );
        expect(seen.status, JSON.stringify(seen.body)).toBe(200);
        const merged = await t.post(
          `/api/people/students/${s.ahmedov}/merge`,
          s.branch,
          {
            uid,
            reason: 'Created twice by mistake',
            digest: (seen.body as { digest: string }).digest,
          },
          t.admin,
        );
        expect(merged.status, JSON.stringify(merged.body)).toBe(200);
      } finally {
        await adminAt(START);
      }
      const stored = await t.database.migrator
        .selectFrom('exemptions')
        .select('student_id')
        .where('id', '=', made.id)
        .executeTakeFirstOrThrow();
      expect(stored.student_id).toBe(s.ahmedov);
    });
  });
});
