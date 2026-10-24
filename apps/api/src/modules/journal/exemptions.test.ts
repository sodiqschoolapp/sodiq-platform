import { randomUUID } from 'node:crypto';
import {
  REQUEST_KEY_HEADER,
  journalGridSchema,
  exemptionCreatedSchema,
  exemptionListSchema,
  exemptionPreviewSchema,
  exemptionSchema,
  type ExemptionCreate,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { setEditDays } from '../../testing/branch-filter-sql.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ?? `status ${response.status}`;

// All names are invented. Task 8.5, pull request #223: exemptions (07, Exemptions, Problem
// cases; edge/exemptions).
describe('exemptions', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Nodira', `Karimova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };
  interface Calls {
    get: (path: string) => Promise<Response>;
    post: (path: string, body?: object, key?: string) => Promise<Response>;
    patch: (path: string, body: object) => Promise<Response>;
  }

  async function as<T>(
    branch: string,
    browser: Browser,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (calls: Calls) => Promise<T>,
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
      return await work({
        get: (path) => t.get(path, branch, browser.cookie),
        post: (path, body, key) =>
          t
            .post(path, branch, body ?? {}, browser.cookie)
            .set(REQUEST_KEY_HEADER, key ?? randomUUID()),
        patch: (path, body) => t.patch(path, branch, body, browser.cookie),
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

  async function scene() {
    const owner = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id },
    });
    const lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select(['id', sql<string>`lesson_date::text`.as('date')])
        .where('class_id', '=', s.classId)
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute()
    ).map((row) => ({ id: row.id, date: row.date }));
    const vice = await account();
    await t.kit.giveRole(vice.account.id, {
      role: 'academic_vice_principal',
      branchId: s.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    return {
      ...s,
      owner,
      vice,
      lessons,
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
          changed_by: t.adminAssignment === '' ? '' : await accountOfAdmin(),
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
    detail: 'A certificate from the clinic, 12 to 20 October',
    choices: [],
    ...input,
  });

  const noticesOf = (kind: string) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['account_id', 'data'])
      .where('kind', '=', kind)
      .execute();

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a late certificate (07, Problem cases; edge/exemptions, row 5)', () => {
    it('hides an absence by itself and asks a choice for a present mark, through the lock, as the vice', async () => {
      const s = await scene();
      await setEditDays(t.database.migrator, s.branch, 7);
      const [first, second] = s.lessons;
      if (first === undefined || second === undefined) throw new Error('Two held lessons.');
      await mark(s.branch, first.id, s.ahmedov, 0);
      const present = await mark(s.branch, second.id, s.ahmedov, 1);
      await as(s.branch, s.vice, [], async ({ post }) => {
        const preview = await post('/api/exemptions/preview', body({ studentIds: [s.ahmedov] }));
        expect(preview.status, JSON.stringify(preview.body)).toBe(200);
        const parsed = exemptionPreviewSchema.parse(preview.body);
        expect(parsed.students[0]?.auto.map((one) => one.lessonId)).toEqual([first.id]);
        expect(parsed.students[0]?.choose.map((one) => one.lessonId)).toEqual([second.id]);
        expect(parsed.students[0]?.choose[0]).toMatchObject({ mark: 1, locked: true });
        // The preview writes nothing.
        expect(await expected(first.id, s.ahmedov)).toEqual({ expected: true, kind: null });

        const refused = await post('/api/exemptions', body({ studentIds: [s.ahmedov] }));
        expect(codeOf(refused)).toBe('exemption_choice_missing');
        const made = await post(
          '/api/exemptions',
          body({
            studentIds: [s.ahmedov],
            choices: [{ studentId: s.ahmedov, lessonId: second.id, choice: 'exempt' }],
          }),
        );
        expect(made.status, JSON.stringify(made.body)).toBe(200);
        const created = exemptionCreatedSchema.parse(made.body);
        expect(created.exemptions[0]).toMatchObject({
          kind: 'temporary',
          startDate: '2026-10-12',
          endDate: '2026-10-20',
          state: 'ended',
          grantedBy: { accountId: s.vice.account.id },
        });
      });
      // The absence stays stored and is hidden; the present mark is cleared, by the exemption.
      expect(await cellOf(first.id, s.ahmedov)).toMatchObject({ mark: 0, changed_how: 'entry' });
      expect(await expected(first.id, s.ahmedov)).toEqual({ expected: false, kind: 'temporary' });
      expect(await cellOf(second.id, s.ahmedov)).toMatchObject({
        mark: null,
        changed_how: 'exemption',
      });
      const lines = await t.database.migrator
        .selectFrom('journal_cell_history')
        .select(['mark_before', 'mark_after', 'changed_how', 'changed_by'])
        .where('cell_id', '=', present)
        .orderBy('version')
        .execute();
      expect(lines.at(-1)).toEqual({
        mark_before: 1,
        mark_after: null,
        changed_how: 'exemption',
        changed_by: s.vice.account.id,
      });
      const entries = await t.entries('exemption.create', s.ahmedov);
      expect(entries).toHaveLength(1);
    });

    it('keeps a lesson as attended when that is chosen', async () => {
      const s = await scene();
      const [first] = s.lessons;
      if (first === undefined) throw new Error('A held lesson.');
      await mark(s.branch, first.id, s.boboyev, 2);
      await as(s.branch, s.vice, [], async ({ post }) => {
        const made = await post(
          '/api/exemptions',
          body({
            studentIds: [s.boboyev],
            choices: [{ studentId: s.boboyev, lessonId: first.id, choice: 'keep' }],
          }),
        );
        expect(made.status, JSON.stringify(made.body)).toBe(200);
      });
      expect(await cellOf(first.id, s.boboyev)).toMatchObject({ mark: 2 });
      expect(await expected(first.id, s.boboyev)).toEqual({ expected: true, kind: null });
    });

    it('refuses a choice for a lesson that needs none', async () => {
      const s = await scene();
      const [first] = s.lessons;
      if (first === undefined) throw new Error('A held lesson.');
      await as(s.branch, s.vice, [], async ({ post }) => {
        const made = await post(
          '/api/exemptions',
          body({
            studentIds: [s.boboyev],
            choices: [{ studentId: s.boboyev, lessonId: first.id, choice: 'keep' }],
          }),
        );
        expect(codeOf(made)).toBe('exemption_choice_unknown');
      });
    });
  });

  describe('a void and an end (edge/exemptions, row 4)', () => {
    it('gives the cells back the marks they had, and reopens a locked lesson with one notice', async () => {
      const s = await scene();
      await setEditDays(t.database.migrator, s.branch, 7);
      const [first, second] = s.lessons;
      if (first === undefined || second === undefined) throw new Error('Two held lessons.');
      await mark(s.branch, first.id, s.ahmedov, 0);
      await mark(s.branch, second.id, s.ahmedov, 1);
      const id = await as(s.branch, s.vice, [], async ({ post }) => {
        const made = await post(
          '/api/exemptions',
          body({
            studentIds: [s.ahmedov],
            choices: [{ studentId: s.ahmedov, lessonId: second.id, choice: 'exempt' }],
          }),
        );
        return exemptionCreatedSchema.parse(made.body).exemptions[0]?.id ?? '';
      });
      await as(s.branch, s.vice, [], async ({ post }) => {
        const preview = await post(`/api/exemptions/${id}/void/preview`, { version: 1 });
        expect(preview.status, JSON.stringify(preview.body)).toBe(200);
        const parsed = exemptionPreviewSchema.parse(preview.body);
        expect(parsed.students[0]?.reopen.map((one) => [one.lessonId, one.givesBack])).toEqual([
          [first.id, false],
          [second.id, true],
        ]);
        const stale = await post(`/api/exemptions/${id}/void`, {
          version: 9,
          reason: 'Wrong dates',
        });
        expect(codeOf(stale)).toBe('exemption_stale');
        const voided = await post(`/api/exemptions/${id}/void`, {
          version: 1,
          reason: 'Entered for the wrong student',
        });
        expect(voided.status, JSON.stringify(voided.body)).toBe(200);
        expect(exemptionSchema.parse(voided.body).state).toBe('voided');
        const again = await post(`/api/exemptions/${id}/end`, {
          version: 2,
          endDate: '2026-10-13',
          choices: [],
        });
        expect(codeOf(again)).toBe('exemption_voided');
      });
      expect(await cellOf(first.id, s.ahmedov)).toMatchObject({ mark: 0 });
      expect(await cellOf(second.id, s.ahmedov)).toMatchObject({
        mark: 1,
        changed_how: 'exemption',
      });
      const reopened = await t.database.migrator
        .selectFrom('exemption_reopened_cells')
        .select(['lesson_id', 'open_until'])
        .where('exemption_id', '=', id)
        .orderBy('lesson_id')
        .execute();
      expect(reopened.map((one) => one.lesson_id).sort()).toEqual([first.id, second.id].sort());
      expect(new Date(reopened[0]?.open_until ?? 0).toISOString()).toBe(
        new Date('2026-10-30T19:00:00Z').toISOString(),
      );
      const told = await noticesOf('journal.exemption_reopened');
      expect(told.filter((one) => one.account_id === s.owner.account.id)).toHaveLength(1);
      expect(await t.entries('exemption.void', s.ahmedov)).toHaveLength(1);
    });

    it('ends from a date and refuses an end before the start', async () => {
      const s = await scene();
      const id = await as(s.branch, s.vice, [], async ({ post }) => {
        const made = await post(
          '/api/exemptions',
          body({ studentIds: [s.other], startDate: '2026-10-28', endDate: '2026-11-20' }),
        );
        expect(made.status, JSON.stringify(made.body)).toBe(200);
        return exemptionCreatedSchema.parse(made.body).exemptions[0]?.id ?? '';
      });
      await as(s.branch, s.vice, [], async ({ post }) => {
        const before = await post(`/api/exemptions/${id}/end`, {
          version: 1,
          endDate: '2026-10-27',
          choices: [],
        });
        expect(codeOf(before)).toBe('exemption_end_before_start');
        const ended = await post(`/api/exemptions/${id}/end`, {
          version: 1,
          endDate: '2026-11-10',
          choices: [],
        });
        expect(ended.status, JSON.stringify(ended.body)).toBe(200);
        expect(exemptionSchema.parse(ended.body)).toMatchObject({
          endDate: '2026-11-10',
          endCause: 'end',
          version: 2,
        });
        const past = await post(`/api/exemptions/${id}/end`, {
          version: 2,
          endDate: '2027-06-10',
          choices: [],
        });
        expect(codeOf(past)).toBe('exemption_outside_year');
      });
    });
  });

  describe('the edit (edge/exemptions, row 4)', () => {
    it('changes every field before the start and only the end after it', async () => {
      const s = await scene();
      const [started, coming] = await as(s.branch, s.vice, [], async ({ post }) => {
        const one = await post(
          '/api/exemptions',
          body({ studentIds: [s.other], startDate: '2026-10-26', endDate: '2026-10-28' }),
        );
        const two = await post(
          '/api/exemptions',
          body({ studentIds: [s.boboyev], startDate: '2026-11-10', endDate: '2026-11-12' }),
        );
        return [
          exemptionCreatedSchema.parse(one.body).exemptions[0]?.id ?? '',
          exemptionCreatedSchema.parse(two.body).exemptions[0]?.id ?? '',
        ];
      });
      const edit = {
        kind: 'temporary',
        subjectIds: [s.subject],
        startDate: '2026-11-11',
        endDate: '2026-11-13',
        slots: null,
        category: 'competition',
        detail: 'An olympiad in the capital',
        choices: [],
      };
      await as(s.branch, s.vice, [], async ({ patch }) => {
        expect(codeOf(await patch(`/api/exemptions/${started}`, { ...edit, version: 1 }))).toBe(
          'exemption_started',
        );
        const changed = await patch(`/api/exemptions/${coming}`, { ...edit, version: 1 });
        expect(changed.status, JSON.stringify(changed.body)).toBe(200);
        expect(exemptionSchema.parse(changed.body)).toMatchObject({
          startDate: '2026-11-11',
          endDate: '2026-11-13',
          category: 'competition',
          subjects: [{ id: s.subject }],
        });
      });
      expect(await t.entries('exemption.edit', s.boboyev)).toHaveLength(1);
    });

    it('takes a move of the start into the past through the late-entry preview (correction 1)', async () => {
      const s = await scene();
      const [first] = s.lessons;
      if (first === undefined) throw new Error('A held lesson.');
      await mark(s.branch, first.id, s.boboyev, 1);
      const id = await as(s.branch, s.vice, [], async ({ post }) => {
        const made = await post(
          '/api/exemptions',
          body({ studentIds: [s.boboyev], startDate: '2026-11-10', endDate: '2026-11-12' }),
        );
        return exemptionCreatedSchema.parse(made.body).exemptions[0]?.id ?? '';
      });
      const edit = {
        kind: 'temporary',
        subjectIds: null,
        startDate: '2026-10-12',
        endDate: '2026-11-12',
        slots: null,
        category: 'illness',
        detail: 'A longer illness',
      };
      await as(s.branch, s.vice, [], async ({ post, patch }) => {
        const preview = await post(`/api/exemptions/${id}/edit/preview`, {
          ...edit,
          version: 1,
          choices: [],
        });
        expect(exemptionPreviewSchema.parse(preview.body).students[0]?.choose).toHaveLength(1);
        expect(
          codeOf(await patch(`/api/exemptions/${id}`, { ...edit, version: 1, choices: [] })),
        ).toBe('exemption_choice_missing');
        const changed = await patch(`/api/exemptions/${id}`, {
          ...edit,
          version: 1,
          choices: [{ studentId: s.boboyev, lessonId: first.id, choice: 'keep' }],
        });
        expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      });
    });
  });

  describe('the overlap (07, Problem cases: "Two exemptions would overlap")', () => {
    it('refuses it and names the exemption met, so the screen can offer to extend it', async () => {
      const s = await scene();
      await as(s.branch, s.vice, [], async ({ post }) => {
        const first = await post(
          '/api/exemptions',
          body({ studentIds: [s.other], startDate: '2026-11-10', endDate: '2026-11-12' }),
        );
        const id = exemptionCreatedSchema.parse(first.body).exemptions[0]?.id;
        const refused = await post(
          '/api/exemptions',
          body({ studentIds: [s.other], startDate: '2026-11-12', endDate: '2026-11-14' }),
        );
        expect(codeOf(refused)).toBe('exemption_overlap');
        expect(
          (refused.body as { error: { details: { exemption?: { id: string } }[] } }).error
            .details[0]?.exemption?.id,
        ).toBe(id);
        // A subject exemption over the same days stands beside an all-subjects one.
        const subject = await post(
          '/api/exemptions',
          body({
            studentIds: [s.other],
            startDate: '2026-11-12',
            endDate: '2026-11-14',
            subjectIds: [s.subject],
          }),
        );
        expect(subject.status, JSON.stringify(subject.body)).toBe(200);
      });
    });
  });

  describe('a batch (edge/exemptions, row 8)', () => {
    it('creates one exemption per student and voids them together', async () => {
      const s = await scene();
      const batch = await as(s.branch, s.vice, [], async ({ post }) => {
        const made = await post(
          '/api/exemptions',
          body({
            studentIds: [s.ahmedov, s.boboyev, s.other],
            startDate: '2026-11-16',
            endDate: '2026-11-18',
            category: 'competition',
            detail: 'Olympiad',
          }),
        );
        expect(made.status, JSON.stringify(made.body)).toBe(200);
        const created = exemptionCreatedSchema.parse(made.body);
        expect(created.exemptions).toHaveLength(3);
        return created.batchId;
      });
      await as(s.branch, s.vice, [], async ({ post, get }) => {
        const voided = await post(`/api/exemptions/batches/${batch}/void`, { reason: 'Cancelled' });
        expect(voided.status, JSON.stringify(voided.body)).toBe(200);
        const list = exemptionListSchema.parse(
          (await get(`/api/exemptions?batchId=${batch}`)).body,
        );
        expect(list.items.map((one) => one.state)).toEqual(['voided', 'voided', 'voided']);
        expect(
          codeOf(await post(`/api/exemptions/batches/${batch}/void`, { reason: 'Again' })),
        ).toBe('exemption_batch_empty');
      });
    });
  });

  describe('the reason and the document (edge/exemptions, row 10)', () => {
    it('logs every opening of the detail, and leaves the detail out of the list', async () => {
      const s = await scene();
      const id = await as(s.branch, s.vice, [], async ({ post }) => {
        const made = await post(
          '/api/exemptions',
          body({ studentIds: [s.other], startDate: '2026-11-16', endDate: '2026-11-18' }),
        );
        return exemptionCreatedSchema.parse(made.body).exemptions[0]?.id ?? '';
      });
      const principal = await account();
      await as(
        s.branch,
        principal,
        [{ role: 'principal', branchId: s.branch }],
        async ({ get }) => {
          const listed = await get('/api/exemptions');
          expect(JSON.stringify(listed.body)).not.toContain('A certificate from the clinic');
          const opened = await get(`/api/exemptions/${id}/reason`);
          expect(opened.status, JSON.stringify(opened.body)).toBe(200);
          expect((opened.body as { detail: string }).detail).toContain('A certificate');
          await get(`/api/exemptions/${id}/reason`);
        },
      );
      expect(await t.entries('exemption.reason_open', s.other)).toHaveLength(2);
      const tutor = await tutorOf(s.branch, s.otherClass);
      await as(s.branch, tutor, [], async ({ get }) => {
        expect((await get(`/api/exemptions/${id}/reason`)).status).toBe(403);
      });
    });
  });

  describe('the notices (edge/exemptions, row 11)', () => {
    it('tells the Tutor and the teachers the kind and the dates, never the reason', async () => {
      const s = await scene();
      const tutor = await tutorOf(s.branch, s.otherClass);
      await as(s.branch, s.vice, [], async ({ post }) => {
        const made = await post(
          '/api/exemptions',
          body({ studentIds: [s.other], startDate: '2026-10-27', endDate: '2026-11-03' }),
        );
        expect(made.status, JSON.stringify(made.body)).toBe(200);
      });
      const told = await noticesOf('journal.exemption_granted');
      const mine = told.filter((one) => one.account_id === tutor.account.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]?.data).toEqual({
        student: 'Sobirov Olim',
        kind: 'temporary',
        from: '2026-10-27',
        until: '2026-11-03',
        slots: null,
      });
      expect(JSON.stringify(told)).not.toContain('certificate');
    });
  });

  describe('the branch and the ids', () => {
    it("answers 404 for another branch's student and an unknown one, writing nothing", async () => {
      const s = await scene();
      const elsewhere = await scene();
      await as(s.branch, s.vice, [], async ({ post }) => {
        for (const studentId of [elsewhere.other, UNKNOWN]) {
          const before = await t.auditCount();
          const refused = await post('/api/exemptions', body({ studentIds: [studentId] }));
          expect(refused.status).toBe(404);
          expect(await t.auditCount()).toBe(before);
          expect(
            (await post('/api/exemptions/preview', body({ studentIds: [studentId] }))).status,
          ).toBe(404);
        }
        const subject = await post(
          '/api/exemptions',
          body({ studentIds: [s.other], subjectIds: [UNKNOWN] }),
        );
        expect(subject.status).toBe(404);
      });
      const rows = await t.database.migrator
        .selectFrom('exemptions')
        .select('id')
        .where('student_id', 'in', [elsewhere.other, s.other])
        .execute();
      expect(rows).toEqual([]);
    });

    it("answers 404 for another branch's exemption and batch on every route", async () => {
      const s = await scene();
      const elsewhere = await scene();
      const [id, batch] = await as(elsewhere.branch, elsewhere.vice, [], async ({ post }) => {
        const made = await post(
          '/api/exemptions',
          body({ studentIds: [elsewhere.other], startDate: '2026-11-16', endDate: '2026-11-18' }),
        );
        const created = exemptionCreatedSchema.parse(made.body);
        return [created.exemptions[0]?.id ?? '', created.batchId];
      });
      const stored = () =>
        t.database.migrator.selectFrom('exemptions').selectAll().where('id', '=', id).execute();
      const was = await stored();
      await as(s.branch, s.vice, [], async ({ get, post, patch }) => {
        for (const one of [id, UNKNOWN]) {
          expect((await get(`/api/exemptions/${one}`)).status).toBe(404);
          expect((await get(`/api/exemptions/${one}/reason`)).status).toBe(404);
          expect((await get(`/api/exemptions/${one}/document`)).status).toBe(404);
          expect(
            (await post(`/api/exemptions/${one}/void`, { version: 1, reason: 'x' })).status,
          ).toBe(404);
          expect((await post(`/api/exemptions/${one}/void/preview`, { version: 1 })).status).toBe(
            404,
          );
          expect(
            (
              await post(`/api/exemptions/${one}/end`, {
                version: 1,
                endDate: '2026-11-17',
                choices: [],
              })
            ).status,
          ).toBe(404);
          expect(
            (
              await post(`/api/exemptions/${one}/end/preview`, {
                version: 1,
                endDate: '2026-11-17',
                choices: [],
              })
            ).status,
          ).toBe(404);
          const edit = {
            kind: 'temporary',
            subjectIds: null,
            startDate: '2026-11-17',
            endDate: '2026-11-18',
            slots: null,
            category: 'illness',
            detail: 'x',
            version: 1,
            choices: [],
          };
          expect((await patch(`/api/exemptions/${one}`, edit)).status).toBe(404);
          expect((await post(`/api/exemptions/${one}/edit/preview`, edit)).status).toBe(404);
        }
        for (const one of [batch, UNKNOWN]) {
          expect((await post(`/api/exemptions/batches/${one}/void`, { reason: 'x' })).status).toBe(
            404,
          );
          expect((await post(`/api/exemptions/batches/${one}/void/preview`)).status).toBe(404);
          expect(
            (
              await post(`/api/exemptions/batches/${one}/end`, {
                endDate: '2026-11-17',
                choices: [],
              })
            ).status,
          ).toBe(404);
          expect(
            (
              await post(`/api/exemptions/batches/${one}/end/preview`, {
                endDate: '2026-11-17',
                choices: [],
              })
            ).status,
          ).toBe(404);
        }
        for (const one of [UNKNOWN]) {
          expect(
            (await post(`/api/exemptions/move-offers/${one}/confirm`, { choices: [] })).status,
          ).toBe(404);
          expect((await post(`/api/exemptions/move-offers/${one}/confirm/preview`)).status).toBe(
            404,
          );
          expect((await post(`/api/exemptions/move-offers/${one}/drop`)).status).toBe(404);
        }
      });
      expect(await stored()).toEqual(was);
    });
  });

  describe('the request key', () => {
    it('answers a repeat with the first answer and refuses the key from another account', async () => {
      const s = await scene();
      const key = randomUUID();
      const input = body({ studentIds: [s.other], startDate: '2026-11-16', endDate: '2026-11-18' });
      const first = await as(s.branch, s.vice, [], ({ post }) =>
        post('/api/exemptions', input, key),
      );
      const again = await as(s.branch, s.vice, [], ({ post }) =>
        post('/api/exemptions', input, key),
      );
      expect(again.status).toBe(200);
      expect(exemptionCreatedSchema.parse(again.body).batchId).toBe(
        exemptionCreatedSchema.parse(first.body).batchId,
      );
      const other = await account();
      const refused = await as(
        s.branch,
        other,
        [{ role: 'academic_vice_principal', branchId: s.branch }],
        ({ post }) => post('/api/exemptions', input, key),
      );
      expect(codeOf(refused)).toBe('request_key_reused');
    });
  });

  describe('who enters them (edge/exemptions, row 13)', () => {
    it('lets the Super Admin enter one, and refuses a Teacher and a Tutor', async () => {
      const s = await scene();
      const made = await t
        .post(
          '/api/exemptions',
          s.branch,
          body({ studentIds: [s.other], startDate: '2026-11-16', endDate: '2026-11-18' }),
          t.admin,
        )
        .set(REQUEST_KEY_HEADER, randomUUID());
      expect(made.status, JSON.stringify(made.body)).toBe(200);
      const tutor = await tutorOf(s.branch, s.otherClass);
      await as(s.branch, tutor, [], async ({ post }) => {
        expect((await post('/api/exemptions', body({ studentIds: [s.other] }))).status).toBe(403);
      });
      await as(s.branch, s.owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        expect((await post('/api/exemptions', body({ studentIds: [s.other] }))).status).toBe(403);
      });
    });
  });

  describe('the journal (07, In the journal)', () => {
    it('skips an exempt student in "all present" and refuses a typed mark in an exempt cell', async () => {
      const s = await scene();
      const third = s.lessons[2];
      if (third === undefined) throw new Error('Three held lessons.');
      await as(s.branch, s.vice, [], async ({ post }) => {
        const made = await post(
          '/api/exemptions',
          body({ studentIds: [s.ahmedov], startDate: '2026-10-26', endDate: '2026-10-26' }),
        );
        expect(made.status, JSON.stringify(made.body)).toBe(200);
      });
      await as(s.branch, s.owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        const all = await post(`/api/journal/lessons/${third.id}/all-present`);
        expect(all.status, JSON.stringify(all.body)).toBe(200);
        expect(await cellOf(third.id, s.ahmedov)).toBeUndefined();
        expect(await cellOf(third.id, s.boboyev)).toMatchObject({ mark: 1 });
        const typed = await post(`/api/journal/lessons/${third.id}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: 1, version: null }],
        });
        expect(codeOf(typed)).toBe('cell_closed');
        const four = await post(`/api/journal/lessons/${third.id}/attendance`, {
          saves: [{ studentId: s.boboyev, mark: 4, version: 1 }],
        });
        expect(codeOf(four)).toBe('validation_failed');
        // "No person's route writes changed_how exemption": the save schema takes no kind.
        const kind = await post(`/api/journal/lessons/${third.id}/attendance`, {
          saves: [{ studentId: s.boboyev, mark: 0, version: 1, how: 'exemption' }],
        });
        expect(codeOf(kind)).toBe('validation_failed');
      });
    });
  });

  describe("at the same moment as a cell save (the plan's lock)", () => {
    it('waits for a present mark being saved and then asks its choice', async () => {
      const s = await scene();
      const [first] = s.lessons;
      if (first === undefined) throw new Error('A held lesson.');
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: (pid: number) => void = () => undefined;
      const isReady = new Promise<number>((resolve) => {
        ready = resolve;
      });
      t.clock.set(MOMENT);
      const held = t.app
        .get(Transactions)
        .run([s.branch], async (transaction: Transaction) => {
          await transaction
            .insertInto('audit_log')
            .values({ occurred_at: new Date(MOMENT), branch_id: s.branch, action: 'test.hold' })
            .execute();
          await transaction
            .insertInto('journal_cells')
            .values({
              branch_id: s.branch,
              lesson_id: first.id,
              student_id: s.other === '' ? '' : s.ahmedov,
              mark: 1,
              version: 1,
              changed_by: s.owner.account.id,
              changed_how: 'entry',
              changed_at: new Date(0),
            })
            .execute();
          const pid = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
            transaction,
          );
          ready(pid.rows[0]?.pid ?? 0);
          await released;
        })
        .catch((error: unknown) => error);
      const heldPid = await isReady;
      const answer = as(
        s.branch,
        s.vice,
        [],
        ({ post }) =>
          new Promise<Response>((resolve, reject) => {
            post('/api/exemptions', body({ studentIds: [s.ahmedov] })).then(resolve, reject);
          }),
      );
      let waited = false;
      for (let tries = 0; tries < 800 && !waited; tries += 1) {
        const found = await sql<{ n: number }>`
          select count(*)::int as n from pg_stat_activity a
          where a.datname = current_database() and ${heldPid}::int = any (pg_blocking_pids(a.pid))
        `.execute(t.database.migrator);
        waited = (found.rows[0]?.n ?? 0) >= 1;
        if (!waited) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      release();
      expect(waited, 'the create waited on the held save').toBe(true);
      expect(await held).toBeUndefined();
      expect(codeOf(await answer)).toBe('exemption_choice_missing');
    });
  });

  describe('the journal grid (07, In the journal; Effect on totals)', () => {
    const journalOf = async (classId: string) =>
      (
        await t.database.migrator
          .selectFrom('journals')
          .select('id')
          .where('class_id', '=', classId)
          .executeTakeFirstOrThrow()
      ).id;

    it('shows exempt cells as 4 or 5, hides the mark, gives "Exempt" when no lesson remains, and the category only to the Tutor', async () => {
      const s = await scene();
      const [first, second, third] = s.lessons;
      if (first === undefined || second === undefined || third === undefined) {
        throw new Error('Three held lessons.');
      }
      await mark(s.branch, first.id, s.ahmedov, 0);
      await as(s.branch, s.vice, [], async ({ post }) => {
        // Ahmedov: every held lesson exempt, the last one fully (a subject exemption to the year's end).
        expect(
          (
            await post(
              '/api/exemptions',
              body({ studentIds: [s.ahmedov], startDate: '2026-10-12', endDate: '2026-10-24' }),
            )
          ).status,
        ).toBe(200);
        expect(
          (
            await post(
              '/api/exemptions',
              body({
                studentIds: [s.ahmedov],
                kind: 'full',
                endDate: null,
                startDate: '2026-10-25',
                subjectIds: [s.subject],
              }),
            )
          ).status,
        ).toBe(200);
      });
      const journal = await journalOf(s.classId);
      const teacherGrid = await as(
        s.branch,
        s.owner,
        [{ role: 'teacher', branchId: s.branch }],
        async ({ get }) =>
          journalGridSchema.parse((await get(`/api/journal/journals/${journal}`)).body),
      );
      const ahmedov = teacherGrid.students.find((one) => one.id === s.ahmedov);
      expect(
        ahmedov?.cells.slice(0, 3).map((cell) => [cell.closed, cell.exempt, cell.mark]),
      ).toEqual([
        [true, 'temporary', null],
        [true, 'temporary', null],
        [true, 'full', null],
      ]);
      expect(ahmedov?.quarter?.result).toEqual({ kind: 'exempt' });
      expect(ahmedov?.exemptions.map((one) => [one.kind, one.category])).toEqual([
        ['temporary', null],
        ['full', null],
      ]);
      const boboyev = teacherGrid.students.find((one) => one.id === s.boboyev);
      expect(boboyev?.cells[0]?.exempt).toBeNull();
      const tutor = await tutorOf(s.branch, s.classId);
      const tutorGrid = await as(s.branch, tutor, [], async ({ get }) =>
        journalGridSchema.parse((await get(`/api/journal/journals/${journal}`)).body),
      );
      expect(
        tutorGrid.students
          .find((one) => one.id === s.ahmedov)
          ?.exemptions.map((one) => one.category),
      ).toEqual(['illness', 'illness']);
    });
  });

  describe('the readers of marks (decision 2)', () => {
    it("leaves a hidden absence off the Tutor's absences page", async () => {
      const s = await scene();
      const [first] = s.lessons;
      if (first === undefined) throw new Error('A held lesson.');
      await mark(s.branch, first.id, s.ahmedov, 0);
      await mark(s.branch, first.id, s.boboyev, 0);
      await as(s.branch, s.vice, [], async ({ post }) => {
        expect(
          (await post('/api/exemptions', body({ studentIds: [s.ahmedov], endDate: '2026-10-12' })))
            .status,
        ).toBe(200);
      });
      const tutor = await tutorOf(s.branch, s.classId);
      await as(s.branch, tutor, [], async ({ get }) => {
        const page = await get(
          `/api/journal/student-absences?classId=${s.classId}&from=2026-10-12&to=2026-10-12`,
        );
        expect(page.status, JSON.stringify(page.body)).toBe(200);
        const days = (page.body as { days: { student: { id: string } }[] }).days;
        expect(days.map((one) => one.student.id)).toEqual([s.boboyev]);
      });
    });

    it('refuses the delete of a student with an exemption (edge/students-classes-groups, row 22)', async () => {
      const s = await scene();
      const fresh = await student(s.branch, s.classId, 'Yusupov');
      await as(s.branch, s.vice, [], async ({ post }) => {
        expect(
          (
            await post(
              '/api/exemptions',
              body({ studentIds: [fresh], startDate: '2026-11-16', endDate: '2026-11-17' }),
            )
          ).status,
        ).toBe(200);
      });
      const read = await t.get(`/api/people/students/${fresh}`, s.branch, t.admin);
      const version = { version: (read.body as { version: number }).version };
      const refused = await t.post(
        `/api/people/students/${fresh}/delete`,
        s.branch,
        { reason: 'Created twice by mistake.', version: version.version },
        t.admin,
      );
      expect(codeOf(refused)).toBe('student_has_data');
    });
  });

  describe('a leaving and a branch move (edge/exemptions, row 12)', () => {
    const stateOf = (id: string) =>
      t.database.migrator
        .selectFrom('exemptions')
        .select([sql<string>`end_date::text`.as('end'), 'voided_at', 'void_cause', 'leaving_id'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

    it('ends an exemption on the last day, voids a later one, and gives both back when the leaving is cancelled', async () => {
      const s = await scene();
      const [running, later] = await as(s.branch, s.vice, [], async ({ post }) => {
        const one = await post(
          '/api/exemptions',
          body({ studentIds: [s.other], startDate: '2026-10-28', endDate: '2026-11-20' }),
        );
        const two = await post(
          '/api/exemptions',
          body({ studentIds: [s.other], startDate: '2026-11-25', endDate: '2026-11-27' }),
        );
        return [
          exemptionCreatedSchema.parse(one.body).exemptions[0]?.id ?? '',
          exemptionCreatedSchema.parse(two.body).exemptions[0]?.id ?? '',
        ];
      });
      await adminAt(MOMENT);
      const read = await t.get(`/api/people/students/${s.other}`, s.branch, t.admin);
      const left = await t.post(
        `/api/people/students/${s.other}/leaving`,
        s.branch,
        {
          lastDay: '2026-11-10',
          reason: 'Moved to another city',
          version: (read.body as { version: number }).version,
        },
        t.admin,
      );
      expect(left.status, JSON.stringify(left.body)).toBe(200);
      expect(await stateOf(running)).toMatchObject({ end: '2026-11-10', voided_at: null });
      expect(await stateOf(later)).toMatchObject({ void_cause: 'leaving' });
      expect(await t.entries('exemption.leaving', s.other)).toHaveLength(1);
      const cancelled = await t.post(
        `/api/people/students/${s.other}/leaving/cancel`,
        s.branch,
        { version: (left.body as { version: number }).version },
        t.admin,
      );
      await adminAt(START);
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      expect(await stateOf(running)).toMatchObject({ end: '2026-11-20', leaving_id: null });
      expect(await stateOf(later)).toMatchObject({ voided_at: null, leaving_id: null });
    });

    it('ends the exemption in the sending branch and offers it to the receiving one, which confirms it', async () => {
      const s = await scene();
      const target = await scene();
      const id = await as(s.branch, s.vice, [], async ({ post }) => {
        const made = await post(
          '/api/exemptions',
          body({ studentIds: [s.other], startDate: '2026-10-19', endDate: '2026-11-20' }),
        );
        return exemptionCreatedSchema.parse(made.body).exemptions[0]?.id ?? '';
      });
      await adminAt(MOMENT);
      const read = await t.get(`/api/people/students/${s.other}`, s.branch, t.admin);
      const released = await t.post(
        `/api/people/students/${s.other}/branch-move`,
        s.branch,
        {
          toBranchId: target.branch,
          from: '2026-10-27',
          version: (read.body as { version: number }).version,
        },
        t.admin,
      );
      expect(released.status, JSON.stringify(released.body)).toBe(200);
      const move = await t.database.migrator
        .selectFrom('student_branch_moves')
        .select('id')
        .where('student_id', '=', s.other)
        .executeTakeFirstOrThrow();
      const accepted = await t.post(
        `/api/people/branch-moves/${move.id}/accept`,
        target.branch,
        { classId: target.otherClass, groups: [] },
        t.admin,
      );
      await adminAt(START);
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      expect(await stateOf(id)).toMatchObject({ end: '2026-10-26', voided_at: null });
      const offers = await as(
        target.branch,
        target.vice,
        [],
        async ({ get }) =>
          (await get('/api/exemptions/move-offers')).body as {
            items: { id: string; startDate: string; endDate: string }[];
          },
      );
      expect(offers.items).toHaveLength(1);
      expect(offers.items[0]).toMatchObject({ startDate: '2026-10-27', endDate: '2026-11-20' });
      await as(target.branch, target.vice, [], async ({ post }) => {
        const confirmed = await post(
          `/api/exemptions/move-offers/${offers.items[0]?.id ?? ''}/confirm`,
          {
            choices: [],
          },
        );
        expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
        expect(exemptionSchema.parse(confirmed.body)).toMatchObject({
          startDate: '2026-10-27',
          endDate: '2026-11-20',
          movedFrom: true,
        });
        const again = await post(`/api/exemptions/move-offers/${offers.items[0]?.id ?? ''}/drop`);
        expect(codeOf(again)).toBe('exemption_offer_decided');
      });
    });
  });
});
