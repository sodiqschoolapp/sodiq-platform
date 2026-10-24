import {
  REQUEST_KEY_HEADER,
  attendanceSavedSchema,
  editExtensionSchema,
  journalGridSchema,
  journalUnlockSchema,
  journalUnlocksSchema,
  type JournalGrid,
} from '@sodiq/shared';
import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setEditDays } from '../../testing/branch-filter-sql.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12 and 19 October are locked, the 26th is open. */
const MOMENT = '2026-10-27T12:00:00+05:00';
/** With 7 edit days the lesson of 19 October is open through 23:59 of the 26th ... */
const LAST_MINUTE = '2026-10-26T23:59:00+05:00';
/** ... and locked from 00:00 of the 27th. */
const LOCKED = '2026-10-27T00:00:00+05:00';

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ?? `status ${response.status}`;

const ok = (response: Response, status = 200): Response => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response;
};

// All names are invented. Task 8.4, pull request #222: the edit period, unlock requests,
// corrections and the branch-wide extension through the routes (docs/spec/07-journal.md,
// Editing rules and locks; docs/spec/edge-cases/journal.md, Locks, unlocks and corrections;
// docs/spec/02-roles-and-access.md, Head Teachers and Senior Head Teachers;
// docs/spec/edge-cases/00-definitions.md, Lock moment; edge/system-behaviour, the outage row).
describe('the edit period through the routes', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Malika', `Rahimova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };
  interface Calls {
    get: (path: string) => Promise<Response>;
    post: (path: string, body?: object) => Promise<Response>;
    put: (path: string, body: object) => Promise<Response>;
  }

  const VALID_FROM = new Date('2026-09-01T00:00:00+05:00');

  /** Runs `work` as the browser in the scene's branch with the clock at `moment`. */
  async function as<T>(
    browser: Browser,
    branch: string,
    work: (calls: Calls) => Promise<T>,
    moment = MOMENT,
  ): Promise<T> {
    t.clock.set(moment);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
        .where('account_id', '=', browser.account.id)
        .execute();
      return await work({
        get: (path) => t.get(path, branch, browser.cookie),
        post: (path, body) =>
          t.post(path, branch, body ?? {}, browser.cookie).set(REQUEST_KEY_HEADER, randomUUID()),
        put: (path, body) => t.put(path, branch, body, browser.cookie),
      });
    } finally {
      t.clock.set(START);
    }
  }

  const give = (browser: Browser, held: Omit<Held, 'validFrom'>) =>
    t.kit.giveRole(browser.account.id, { ...held, validFrom: VALID_FROM });

  /** A student of the class from 1 September. */
  const student = async (branch: string, classId: string, last: string): Promise<string> => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: 'Ali', last_name: last })
      .where('id', '=', id)
      .execute();
    await members.member({ branch, classId, studentId: id, from: '2026-09-01' });
    return id;
  };

  /**
   * The graded scene of 6.2 with 7 edit days: maths of 7th grade on the Mondays 12, 19 and
   * 26 October at 08:00, owned by its teacher; the Head Teacher, the Senior Head Teacher and
   * the Academic Vice Principal of the subject, and a Head Teacher of another subject.
   */
  async function scene(options: { rating?: boolean } = {}) {
    const owner = await account();
    const spare = await account();
    const head = await account();
    const senior = await account();
    const vice = await account();
    const otherHead = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id, spare: spare.account.id },
    });
    await setEditDays(t.database.migrator, s.branch, 7);
    if (options.rating === true) {
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
    }
    const q1 = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    for (const browser of [owner, spare])
      await give(browser, { role: 'teacher', branchId: s.branch });
    await give(head, { role: 'head_teacher', branchId: s.branch, subjectIds: [s.subject] });
    await give(senior, { role: 'senior_head_teacher', subjectIds: [s.subject] });
    await give(vice, { role: 'academic_vice_principal', branchId: s.branch });
    await give(otherHead, {
      role: 'head_teacher',
      branchId: s.branch,
      subjectIds: [await load.classes.subject({ grades: [7] })],
    });
    const lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    const [first, second, third] = lessons;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('The scene has three lessons in October.');
    }
    const journal = await t.database.migrator
      .selectFrom('journals')
      .select('id')
      .where('class_id', '=', s.classId)
      .where('subject_id', '=', s.subject)
      .executeTakeFirstOrThrow();
    return {
      ...s,
      owner,
      spare,
      head,
      senior,
      vice,
      otherHead,
      first,
      second,
      third,
      journal: journal.id,
      q1,
      ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const save = (calls: Calls, lessonId: string, studentId: string, mark: number, extra = {}) =>
    calls.post(`/api/journal/lessons/${lessonId}/attendance`, {
      saves: [{ studentId, mark, version: null }],
      ...extra,
    });

  const cellOf = (lessonId: string, studentId: string) =>
    t.database.migrator
      .selectFrom('journal_cells')
      .select(['id', 'mark', 'version', 'changed_how'])
      .where('lesson_id', '=', lessonId)
      .where('student_id', '=', studentId)
      .where('work_id', 'is', null)
      .executeTakeFirst();

  const gridOf = async (calls: Calls, x: Scene): Promise<JournalGrid> =>
    journalGridSchema.parse(ok(await calls.get(`/api/journal/journals/${x.journal}`)).body);

  const noticesOf = async (accountId: string, kind: string) =>
    (
      await t.database.migrator
        .selectFrom('notifications')
        .select('data')
        .where('account_id', '=', accountId)
        .where('kind', '=', kind)
        .orderBy('created_at')
        .orderBy('id')
        .execute()
    ).map((row) => row.data);

  /** The owner's request on the lesson of 19 October, sent at MOMENT. */
  const requested = async (x: Scene, lessonId = x.second) =>
    journalUnlockSchema.parse(
      ok(
        await as(x.owner, x.branch, (calls) =>
          calls.post(`/api/journal/lessons/${lessonId}/unlocks`, { reason: 'I was ill that week' }),
        ),
        201,
      ).body,
    );

  const decide = (x: Scene, browser: Browser, unlockId: string, body: object) =>
    as(browser, x.branch, (calls) => calls.post(`/api/journal/unlocks/${unlockId}/decide`, body));

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the lock moment (the Done when)', () => {
    it('takes a mark at 23:59 of the last day and refuses one at 00:00 with the lock moment', async () => {
      const x = await scene();
      await as(
        x.owner,
        x.branch,
        async (calls) => {
          const saved = attendanceSavedSchema.parse(
            ok(await save(calls, x.second, x.ahmedov, 1)).body,
          );
          expect(saved.cells[0]?.mark).toBe(1);
        },
        LAST_MINUTE,
      );
      await as(
        x.owner,
        x.branch,
        async (calls) => {
          const refused = await calls.post(`/api/journal/lessons/${x.second}/attendance`, {
            saves: [{ studentId: x.ahmedov, mark: 0, version: 1 }],
          });
          expect(refused.status).toBe(409);
          expect(codeOf(refused)).toBe('journal_locked');
          expect(
            (refused.body as { error: { details: { locksAt?: string }[] } }).error.details[0]
              ?.locksAt,
          ).toBe(new Date(LOCKED).toISOString());
          // "All present" and the grid follow the same lock.
          expect(codeOf(await calls.post(`/api/journal/lessons/${x.second}/all-present`))).toBe(
            'journal_locked',
          );
          const grid = await gridOf(calls, x);
          const lesson = grid.lessons.find((one) => one.id === x.second);
          expect(lesson?.canEnter).toBe(false);
          expect(lesson?.lock).toMatchObject({
            window: 'locked',
            locksAt: new Date(LOCKED).toISOString(),
            canRequest: true,
          });
          expect(grid.lessons.find((one) => one.id === x.third)?.lock.window).toBe('open');
        },
        LOCKED,
      );
      expect((await cellOf(x.second, x.ahmedov))?.mark).toBe(1);
    });
  });

  describe('unlock requests', () => {
    it('goes to the Head Teacher of the subject; an approval of 2 days lets the teacher enter, marked with the approver', async () => {
      const x = await scene();
      const sent = await requested(x);
      expect(sent).toMatchObject({ status: 'sent', lessonId: x.second, canWithdraw: true });
      expect(await noticesOf(x.head.account.id, 'journal.unlock_requested')).toHaveLength(1);
      expect(await noticesOf(x.vice.account.id, 'journal.unlock_requested')).toHaveLength(0);
      // The Head Teacher of another subject neither sees nor decides it.
      await as(x.otherHead, x.branch, async (calls) => {
        const list = journalUnlocksSchema.parse(
          ok(await calls.get('/api/journal/unlocks?view=deciding')).body,
        );
        expect(list.requests.map((one) => one.id)).not.toContain(sent.id);
      });
      const refused = await decide(x, x.otherHead, sent.id, {
        decision: 'approve',
        days: 2,
        version: sent.version,
      });
      expect(refused.status).toBe(403);
      expect(codeOf(refused)).toBe('journal_unlock_scope');
      await as(x.head, x.branch, async (calls) => {
        const list = journalUnlocksSchema.parse(
          ok(await calls.get('/api/journal/unlocks?view=deciding')).body,
        );
        expect(list.requests.find((one) => one.id === sent.id)?.canDecide).toBe(true);
      });
      const approved = journalUnlockSchema.parse(
        ok(await decide(x, x.head, sent.id, { decision: 'approve', days: 2, version: 1 })).body,
      );
      // Decided on 27 October for 2 days: open through the 29th.
      expect(approved).toMatchObject({
        status: 'approved',
        days: 2,
        open: true,
        openUntil: new Date('2026-10-30T00:00:00+05:00').toISOString(),
      });
      expect(await noticesOf(x.owner.account.id, 'journal.unlock_approved')).toEqual([
        { unit: expect.any(String) as string, date: '2026-10-19', until: '2026-10-29' },
      ]);
      await as(x.owner, x.branch, async (calls) => {
        ok(await save(calls, x.second, x.ahmedov, 2));
        const grid = await gridOf(calls, x);
        const at = grid.lessons.findIndex((one) => one.id === x.second);
        expect(grid.lessons[at]?.lock.window).toBe('unlocked');
        expect(grid.lessons[at]?.canEnter).toBe(true);
        const cell = grid.students.find((one) => one.id === x.ahmedov)?.cells[at];
        expect(cell?.marker).toEqual({ kind: 'late', by: expect.any(String) as string });
        // The unlock covers that lesson only: the first is still locked.
        expect(codeOf(await save(calls, x.first, x.ahmedov, 1))).toBe('journal_locked');
      });
      const cell = await cellOf(x.second, x.ahmedov);
      expect(cell?.changed_how).toBe('late_entry');
      const line = await t.database.migrator
        .selectFrom('journal_cell_history')
        .select(['changed_how', 'unlock_id'])
        .where('cell_id', '=', cell?.id ?? '')
        .executeTakeFirstOrThrow();
      expect(line).toEqual({ changed_how: 'late_entry', unlock_id: sent.id });
      // It ends at its moment.
      await as(
        x.owner,
        x.branch,
        async (calls) => {
          const late = await calls.post(`/api/journal/lessons/${x.second}/attendance`, {
            saves: [{ studentId: x.ahmedov, mark: 3, version: cell?.version ?? 0 }],
          });
          expect(codeOf(late)).toBe('journal_locked');
        },
        '2026-10-30T00:00:00+05:00',
      );
    });

    it('is refused on an open lesson, twice, and decided once; a stale version and a withdraw by another are refused', async () => {
      const x = await scene();
      await as(x.owner, x.branch, async (calls) => {
        const open = await calls.post(`/api/journal/lessons/${x.third}/unlocks`, {
          reason: 'Not needed',
        });
        expect(codeOf(open)).toBe('journal_not_locked');
      });
      const sent = await requested(x);
      await as(x.owner, x.branch, async (calls) => {
        const again = await calls.post(`/api/journal/lessons/${x.second}/unlocks`, {
          reason: 'Again',
        });
        expect(codeOf(again)).toBe('journal_unlock_waiting');
      });
      await as(x.spare, x.branch, async (calls) => {
        const theirs = await calls.post(`/api/journal/unlocks/${sent.id}/withdraw`, { version: 1 });
        expect(codeOf(theirs)).toBe('journal_unlock_scope');
      });
      expect(
        codeOf(await decide(x, x.head, sent.id, { decision: 'approve', days: 2, version: 7 })),
      ).toBe('journal_unlock_stale');
      expect(
        codeOf(await decide(x, x.head, sent.id, { decision: 'approve', days: 8, version: 1 })),
      ).toBe('validation_failed');
      ok(await decide(x, x.vice, sent.id, { decision: 'refuse', reason: null, version: 1 }));
      expect(await noticesOf(x.owner.account.id, 'journal.unlock_refused')).toEqual([
        { unit: expect.any(String) as string, date: '2026-10-19', reason: '' },
      ]);
      expect(
        codeOf(await decide(x, x.senior, sent.id, { decision: 'approve', days: 1, version: 2 })),
      ).toBe('journal_unlock_decided');
      // A refusal changes nothing: the teacher may ask again, and withdraw it.
      const next = await requested(x);
      const withdrawn = await as(x.owner, x.branch, (calls) =>
        calls.post(`/api/journal/unlocks/${next.id}/withdraw`, { version: 1 }),
      );
      expect(journalUnlockSchema.parse(ok(withdrawn).body).status).toBe('withdrawn');
      expect(await t.entries('journal.unlock_withdraw', next.id)).toHaveLength(1);
    });

    it("routes a Head Teacher's own to the Senior Head Teacher or the Academic Vice Principal, never to themselves", async () => {
      const x = await scene();
      // The Head Teacher holds the lesson of 19 October as its teacher (a substitute).
      const headStaff = await load.classes.person(x.branch, ['uz'], {
        accountId: x.head.account.id,
      });
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: headStaff.staffId })
        .where('id', '=', x.second)
        .execute();
      const teacherOf = await t.database.migrator
        .selectFrom('lessons')
        .select('teacher_id')
        .where('id', '=', x.second)
        .executeTakeFirstOrThrow();
      expect(teacherOf.teacher_id).toBe(headStaff.staffId);
      const sent = journalUnlockSchema.parse(
        ok(
          await as(x.head, x.branch, (calls) =>
            calls.post(`/api/journal/lessons/${x.second}/unlocks`, { reason: 'Covered a class' }),
          ),
          201,
        ).body,
      );
      const own = await decide(x, x.head, sent.id, { decision: 'approve', days: 1, version: 1 });
      expect(own.status).toBe(403);
      expect(codeOf(own)).toBe('own_request');
      expect(await noticesOf(x.senior.account.id, 'journal.unlock_requested')).toHaveLength(1);
      ok(await decide(x, x.senior, sent.id, { decision: 'approve', days: 1, version: 1 }));
    });

    it('reads the branch only for its readers, and answers 404 for another branch and an unknown id', async () => {
      const x = await scene();
      const other = await scene();
      const sent = await requested(x);
      await as(x.owner, x.branch, async (calls) => {
        expect(codeOf(await calls.get('/api/journal/unlocks?view=branch'))).toBe(
          'journal_unlock_scope',
        );
        const own = journalUnlocksSchema.parse(
          ok(await calls.get('/api/journal/unlocks?view=own')).body,
        );
        expect(own.requests.map((one) => one.id)).toEqual([sent.id]);
        for (const lesson of [other.second, randomUUID()]) {
          const missing = await calls.post(`/api/journal/lessons/${lesson}/unlocks`, {
            reason: 'Elsewhere',
          });
          expect(missing.status).toBe(404);
        }
      });
      await as(x.head, x.branch, async (calls) => {
        expect(codeOf(await calls.get('/api/journal/unlocks?view=branch'))).toBe(
          'journal_unlock_scope',
        );
      });
      const before = await t.database.migrator
        .selectFrom('journal_unlocks')
        .selectAll()
        .orderBy('id')
        .execute();
      const audit = await t.auditCount();
      for (const id of [randomUUID()]) {
        expect(
          (await decide(x, x.head, id, { decision: 'approve', days: 1, version: 1 })).status,
        ).toBe(404);
      }
      const otherSent = await requested(other);
      expect(
        (await decide(x, x.head, otherSent.id, { decision: 'approve', days: 1, version: 1 }))
          .status,
      ).toBe(404);
      const withdraw = await as(x.owner, x.branch, (calls) =>
        calls.post(`/api/journal/unlocks/${otherSent.id}/withdraw`, { version: 1 }),
      );
      expect(withdraw.status).toBe(404);
      expect(
        await t.database.migrator
          .selectFrom('journal_unlocks')
          .selectAll()
          .where('id', '!=', otherSent.id)
          .orderBy('id')
          .execute(),
      ).toEqual(before);
      expect(await t.auditCount()).toBe(
        audit + (await t.entries('journal.unlock_request', otherSent.id)).length,
      );
    });
  });

  describe('corrections', () => {
    it('lets the Academic Vice Principal correct a locked mark with a reason, marked in the cell and told to the teacher', async () => {
      const x = await scene();
      await as(
        x.owner,
        x.branch,
        async (calls) => ok(await save(calls, x.second, x.ahmedov, 1)),
        LAST_MINUTE,
      );
      await as(x.vice, x.branch, async (calls) => {
        const corrected = await calls.post(`/api/journal/lessons/${x.second}/attendance`, {
          saves: [{ studentId: x.ahmedov, mark: 0, version: 1 }],
          correction: { reason: 'The register shows an absence' },
        });
        ok(corrected);
        const grid = await gridOf(calls, x);
        const at = grid.lessons.findIndex((one) => one.id === x.second);
        expect(grid.lessons[at]?.lock.canCorrect).toBe(true);
        expect(grid.students.find((one) => one.id === x.ahmedov)?.cells[at]?.marker?.kind).toBe(
          'correction',
        );
      });
      expect((await cellOf(x.second, x.ahmedov))?.changed_how).toBe('correction');
      expect(await noticesOf(x.owner.account.id, 'journal.correction')).toEqual([
        {
          unit: expect.any(String) as string,
          date: '2026-10-19',
          student: 'Ahmedov Ali',
          before: '1',
          after: '0',
          reason: 'The register shows an absence',
        },
      ]);
      const [entry] = await t.entries('journal.cells_save');
      expect(entry).toBeDefined();
      const last = (await t.entries('journal.cells_save')).at(-1);
      expect(last?.details).toMatchObject({
        how: 'correction',
        reason: 'The register shows an absence',
      });
    });

    it('refuses a correction by a teacher, one without a reason, and a correction of "all present"', async () => {
      const x = await scene();
      await as(x.owner, x.branch, async (calls) => {
        const teacher = await save(calls, x.third, x.ahmedov, 1, {
          correction: { reason: 'Mine' },
        });
        expect(teacher.status).toBe(403);
        expect(codeOf(teacher)).toBe('journal_correction_role');
      });
      await as(x.vice, x.branch, async (calls) => {
        expect(
          codeOf(await save(calls, x.second, x.ahmedov, 1, { correction: { reason: '  ' } })),
        ).toBe('validation_failed');
        // Without a correction the Academic Vice Principal does not enter a lesson of another.
        expect(codeOf(await save(calls, x.second, x.ahmedov, 1))).toBe('journal_entry_scope');
        const bulk = await calls.post(`/api/journal/lessons/${x.second}/all-present`, {
          correction: { reason: 'Everyone' },
        });
        // "All present" takes no correction (decision 9): it reads no body, and the lesson is not theirs.
        expect(codeOf(bulk)).toBe('journal_entry_scope');
      });
    });
  });

  describe('the branch-wide extension', () => {
    it('lengthens the edit period of the range from today, and is audited', async () => {
      const x = await scene();
      const extended = await as(x.vice, x.branch, (calls) =>
        calls.post('/api/journal/extensions', {
          fromDate: '2026-10-19',
          toDate: '2026-10-19',
          days: 2,
          reason: 'The server was down',
        }),
      );
      const saved = editExtensionSchema.parse(ok(extended, 201).body);
      expect(saved.openUntil).toBe(new Date('2026-10-30T00:00:00+05:00').toISOString());
      const [entry] = await t.entries('journal.edit_extension', saved.id);
      expect(entry).toMatchObject({ reason: 'The server was down' });
      await as(x.owner, x.branch, async (calls) => {
        ok(await save(calls, x.second, x.ahmedov, 1));
        expect(codeOf(await save(calls, x.first, x.ahmedov, 1))).toBe('journal_locked');
      });
    });

    it('refuses a range after today, outside the open year, days outside 1 to 7 and a first day after the last, and a teacher', async () => {
      const x = await scene();
      await as(x.vice, x.branch, async (calls) => {
        const body = { fromDate: '2026-10-19', toDate: '2026-10-19', days: 2, reason: 'Down' };
        expect(
          codeOf(await calls.post('/api/journal/extensions', { ...body, toDate: '2026-10-28' })),
        ).toBe('journal_extension_future');
        expect(
          codeOf(await calls.post('/api/journal/extensions', { ...body, fromDate: '2025-10-01' })),
        ).toBe('journal_extension_dates');
        expect(codeOf(await calls.post('/api/journal/extensions', { ...body, days: 8 }))).toBe(
          'validation_failed',
        );
        expect(
          codeOf(await calls.post('/api/journal/extensions', { ...body, fromDate: '2026-10-20' })),
        ).toBe('validation_failed');
      });
      await as(x.owner, x.branch, async (calls) => {
        const body = { fromDate: '2026-10-19', toDate: '2026-10-19', days: 2, reason: 'Down' };
        expect((await calls.post('/api/journal/extensions', body)).status).toBe(403);
      });
    });
  });
  describe('a person no longer active, the other writes, and the same moment', () => {
    /** The owner inactive from 27 October (edge/people-roles-accounts, row 25). */
    const outFrom27 = async (x: Scene) => {
      await t.database.migrator
        .updateTable('staff_statuses')
        .set({ valid_until: '2026-10-27' })
        .where('staff_id', '=', x.teacher.staffId)
        .where('valid_until', 'is', null)
        .execute();
      await t.database.migrator
        .insertInto('staff_statuses')
        .values({ staff_id: x.teacher.staffId, status: 'inactive', valid_from: '2026-10-27' })
        .execute();
    };

    it('reads the request of a person who left as cancelled, refuses to decide it, and lets an approved unlock give no entry', async () => {
      const x = await scene();
      const sent = await requested(x);
      const other = await requested(x, x.first);
      ok(await decide(x, x.head, other.id, { decision: 'approve', days: 3, version: 1 }));
      await outFrom27(x);
      await as(x.head, x.branch, async (calls) => {
        const list = journalUnlocksSchema.parse(
          ok(await calls.get('/api/journal/unlocks?view=deciding')).body,
        );
        expect(list.requests.map((one) => one.id)).not.toContain(sent.id);
      });
      await as(x.vice, x.branch, async (calls) => {
        const list = journalUnlocksSchema.parse(
          ok(await calls.get('/api/journal/unlocks?view=branch')).body,
        );
        expect(list.requests.find((one) => one.id === sent.id)?.status).toBe('cancelled');
        expect(list.requests.find((one) => one.id === other.id)?.open).toBe(false);
      });
      expect(
        codeOf(await decide(x, x.head, sent.id, { decision: 'approve', days: 1, version: 1 })),
      ).toBe('journal_unlock_cancelled');
      await as(x.owner, x.branch, async (calls) => {
        // The earlier teacher no longer active enters nothing, an open lesson included (must-fix 7):
        // the session of an inactive person ends.
        expect(codeOf(await save(calls, x.first, x.ahmedov, 1))).toBe('not_signed_in');
        expect(codeOf(await save(calls, x.third, x.ahmedov, 1))).toBe('not_signed_in');
      });
    });

    it('judges a work added, a note and an undo by the lock of their lesson', async () => {
      const x = await scene();
      await as(
        x.owner,
        x.branch,
        async (calls) => {
          ok(await calls.post(`/api/journal/lessons/${x.second}/works`, { kind: 'classwork' }));
          ok(await save(calls, x.second, x.ahmedov, 2));
        },
        LAST_MINUTE,
      );
      await as(
        x.owner,
        x.branch,
        async (calls) => {
          expect(
            codeOf(
              await calls.post(`/api/journal/lessons/${x.second}/works`, { kind: 'classwork' }),
            ),
          ).toBe('journal_locked');
          const note = await calls.put('/api/journal/comments', {
            on: { target: 'note', lessonId: x.second, studentId: x.ahmedov },
            body: 'Helped a classmate',
            visibility: 'staff',
            version: null,
          });
          expect(codeOf(note)).toBe('journal_locked');
          const undo = await calls.post(`/api/journal/lessons/${x.second}/undo`, {
            students: [{ studentId: x.ahmedov, cells: [{ workId: null, version: 1 }] }],
          });
          expect(codeOf(undo)).toBe('journal_locked');
        },
        LOCKED,
      );
      expect((await cellOf(x.second, x.ahmedov))?.mark).toBe(2);
    });

    it('makes a save wait for an approval held open, and takes it as late_entry; with a refusal held open it is locked', async () => {
      for (const decision of ['approved', 'refused'] as const) {
        const x = await scene();
        const sent = await requested(x);
        let release: () => void = () => undefined;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        let ready: () => void = () => undefined;
        const isReady = new Promise<void>((resolve) => {
          ready = resolve;
        });
        // The held side writes what the decide route writes: the decision of the row, at its moment.
        const held = t.database.migrator.transaction().execute(async (transaction) => {
          await sql`select set_config('app.now', ${MOMENT}, true)`.execute(transaction);
          await transaction
            .updateTable('journal_unlocks')
            .set({
              status: decision,
              days: decision === 'approved' ? 2 : null,
              decided_by: x.head.account.id,
            })
            .where('id', '=', sent.id)
            .execute();
          ready();
          await released;
        });
        await isReady;
        t.clock.set(MOMENT);
        await t.database.migrator
          .updateTable('sessions')
          .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
          .where('account_id', '=', x.owner.account.id)
          .execute();
        const saving = new Promise<Response>((resolve, reject) => {
          t.post(
            `/api/journal/lessons/${x.second}/attendance`,
            x.branch,
            { saves: [{ studentId: x.ahmedov, mark: 1, version: null }] },
            x.owner.cookie,
          )
            .set(REQUEST_KEY_HEADER, randomUUID())
            .then(resolve, reject);
        });
        let waited = false;
        for (let attempt = 0; attempt < 100 && !waited; attempt += 1) {
          const { rows } = await sql<{ waiting: number }>`
            select count(*)::int as waiting from pg_stat_activity a
            where a.datname = current_database() and cardinality(pg_blocking_pids(a.pid)) > 0
          `.execute(t.database.migrator);
          waited = (rows[0]?.waiting ?? 0) > 0;
          if (!waited) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(waited).toBe(true);
        release();
        await held;
        const answer = await saving;
        t.clock.set(START);
        if (decision === 'approved') {
          ok(answer);
          expect((await cellOf(x.second, x.ahmedov))?.changed_how).toBe('late_entry');
        } else {
          expect(codeOf(answer)).toBe('journal_locked');
          expect(await cellOf(x.second, x.ahmedov)).toBeUndefined();
        }
      }
    });
  });
  describe('the routing, the rating exam, corrections of other writes and the ids', () => {
    /** The one Super Admin of the file: the kit allows at most three. */
    let admin: Browser | null = null;
    const superAdmin = async (): Promise<Browser> => {
      admin ??= await holder({ role: 'super_admin' });
      return admin;
    };

    /** A new account holding the roles given from 1 September. */
    const holder = async (...held: Omit<Held, 'validFrom'>[]) => {
      const browser = await account();
      for (const one of held) await give(browser, one);
      return browser;
    };

    /** The lesson of 19 October held by the browser's person (a substitute recorded as its teacher). */
    const heldBy = async (x: Scene, browser: Browser) => {
      const person = await load.classes.person(x.branch, ['uz'], {
        accountId: browser.account.id,
      });
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: person.staffId })
        .where('id', '=', x.second)
        .execute();
      return person;
    };

    const requestAs = async (x: Scene, browser: Browser, lessonId = x.second) =>
      journalUnlockSchema.parse(
        ok(
          await as(browser, x.branch, (calls) =>
            calls.post(`/api/journal/lessons/${lessonId}/unlocks`, { reason: 'Covered a class' }),
          ),
          201,
        ).body,
      );

    it("sends a Senior Head Teacher's own to the Academic Vice Principal, and an Academic Vice Principal's own to the Super Admin alone", async () => {
      const x = await scene();
      await heldBy(x, x.senior);
      const senior = await requestAs(x, x.senior);
      expect(
        codeOf(await decide(x, x.head, senior.id, { decision: 'approve', days: 1, version: 1 })),
      ).toBe('journal_unlock_scope');
      ok(await decide(x, x.vice, senior.id, { decision: 'approve', days: 1, version: 1 }));

      const y = await scene();
      await heldBy(y, y.vice);
      const vice = await requestAs(y, y.vice);
      for (const browser of [y.head, y.senior]) {
        expect(
          codeOf(await decide(y, browser, vice.id, { decision: 'approve', days: 1, version: 1 })),
        ).toBe('journal_unlock_scope');
      }
      expect(
        codeOf(await decide(y, y.vice, vice.id, { decision: 'approve', days: 1, version: 1 })),
      ).toBe('own_request');
      const chief = await superAdmin();
      ok(await decide(y, chief, vice.id, { decision: 'approve', days: 1, version: 1 }));
    });

    it("sends a request on a Tutor's lesson past the Head Teacher to the Academic Vice Principal (decision 11)", async () => {
      const x = await scene();
      const tutors = await t.database.migrator
        .selectFrom('departments')
        .select('id')
        .where('tutors', '=', true)
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .updateTable('subjects')
        .set({ department_id: tutors.id })
        .where('id', '=', x.subject)
        .execute();
      const sent = await requested(x);
      expect(await noticesOf(x.head.account.id, 'journal.unlock_requested')).toHaveLength(0);
      expect(await noticesOf(x.vice.account.id, 'journal.unlock_requested')).toHaveLength(1);
      expect(
        codeOf(await decide(x, x.head, sent.id, { decision: 'approve', days: 1, version: 1 })),
      ).toBe('journal_unlock_scope');
      ok(await decide(x, x.vice, sent.id, { decision: 'approve', days: 1, version: 1 }));
    });

    it('refuses a request on a lesson the person does not enter', async () => {
      const x = await scene();
      await as(x.spare, x.branch, async (calls) => {
        const refused = await calls.post(`/api/journal/lessons/${x.second}/unlocks`, {
          reason: 'Not mine',
        });
        expect(refused.status).toBe(403);
        expect(codeOf(refused)).toBe('journal_entry_scope');
      });
    });

    it('answers 404 with every row and the audit unchanged, as the Super Admin too', async () => {
      const x = await scene();
      const other = await scene();
      const otherSent = await requested(other);
      const chief = await superAdmin();
      const rows = () =>
        Promise.all([
          t.database.migrator.selectFrom('journal_unlocks').selectAll().orderBy('id').execute(),
          t.database.migrator
            .selectFrom('lessons')
            .selectAll()
            .where('branch_id', 'in', [x.branch, other.branch])
            .orderBy('id')
            .execute(),
        ]);
      const before = await rows();
      const audit = await t.auditCount();
      for (const lesson of [other.second, randomUUID()]) {
        const missing = await as(x.owner, x.branch, (calls) =>
          calls.post(`/api/journal/lessons/${lesson}/unlocks`, { reason: 'Elsewhere' }),
        );
        expect(missing.status).toBe(404);
      }
      for (const id of [otherSent.id, randomUUID()]) {
        expect(
          (await decide(x, chief, id, { decision: 'approve', days: 1, version: 1 })).status,
        ).toBe(404);
        const withdraw = await as(x.owner, x.branch, (calls) =>
          calls.post(`/api/journal/unlocks/${id}/withdraw`, { version: 1 }),
        );
        expect(withdraw.status).toBe(404);
      }
      for (const [journal, quarter] of [
        [other.journal, other.q1],
        [randomUUID(), x.q1],
        [x.journal, randomUUID()],
        [x.journal, other.q1],
      ] as const) {
        const missing = await as(x.owner, x.branch, (calls) =>
          calls.post(`/api/journal/journals/${journal}/rating/${quarter}/unlocks`, {
            reason: 'Elsewhere',
          }),
        );
        expect(missing.status).toBe(404);
      }
      expect(await rows()).toEqual(before);
      expect(await t.auditCount()).toBe(audit);
    });

    it('locks the rating exam from its date, unlocks it on request, and lets the Academic Vice Principal correct an entry with its reason', async () => {
      const x = await scene({ rating: true });
      const ratingBase = `/api/journal/journals/${x.journal}/rating/${x.q1}`;
      await as(
        x.owner,
        x.branch,
        async (calls) => {
          ok(await calls.put(`${ratingBase}/date`, { date: '2026-10-19', version: null }));
          ok(
            await calls.post(`${ratingBase}/entries`, {
              studentId: x.ahmedov,
              entry: { kind: 'score', score: 70 },
              reason: null,
              version: null,
            }),
          );
        },
        LAST_MINUTE,
      );
      await as(x.owner, x.branch, async (calls) => {
        const locked = await calls.post(`${ratingBase}/entries`, {
          studentId: x.ahmedov,
          entry: { kind: 'score', score: 72 },
          reason: 'Retake',
          version: 1,
        });
        expect(codeOf(locked)).toBe('journal_locked');
        // The teacher's date waits for no unlock: it is refused once locked (decision 6).
        expect(
          codeOf(await calls.put(`${ratingBase}/date`, { date: '2026-10-20', version: 2 })),
        ).toBe('journal_locked');
        expect(
          codeOf(
            await calls.post(`${ratingBase}/entries`, {
              studentId: x.ahmedov,
              entry: { kind: 'score', score: 72 },
              reason: 'Mine',
              version: 1,
              correction: true,
            }),
          ),
        ).toBe('journal_correction_role');
      });
      await as(x.spare, x.branch, async (calls) => {
        expect(codeOf(await calls.post(`${ratingBase}/unlocks`, { reason: 'Not mine' }))).toBe(
          'rating_exam_scope',
        );
      });
      const sent = journalUnlockSchema.parse(
        ok(
          await as(x.owner, x.branch, (calls) =>
            calls.post(`${ratingBase}/unlocks`, { reason: 'Retake day' }),
          ),
          201,
        ).body,
      );
      expect(sent).toMatchObject({ target: 'rating', date: '2026-10-19', journalId: x.journal });
      ok(await decide(x, x.head, sent.id, { decision: 'approve', days: 1, version: 1 }));
      await as(x.owner, x.branch, async (calls) => {
        ok(
          await calls.post(`${ratingBase}/entries`, {
            studentId: x.ahmedov,
            entry: { kind: 'score', score: 72 },
            reason: 'Retake',
            version: 1,
          }),
        );
      });
      await as(x.vice, x.branch, async (calls) => {
        ok(
          await calls.post(`${ratingBase}/entries`, {
            studentId: x.ahmedov,
            entry: { kind: 'score', score: 75 },
            reason: 'Marked again',
            version: 2,
            correction: true,
          }),
        );
      });
      const lines = await t.database.migrator
        .selectFrom('journal_rating_history')
        .select(['changed_how', 'unlock_id', 'reason'])
        .where('journal_id', '=', x.journal)
        .where('student_id', '=', x.ahmedov)
        .orderBy('version')
        .execute();
      expect(lines).toEqual([
        { changed_how: 'entry', unlock_id: null, reason: null },
        { changed_how: 'late_entry', unlock_id: sent.id, reason: 'Retake' },
        { changed_how: 'correction', unlock_id: null, reason: 'Marked again' },
      ]);
      expect(await noticesOf(x.owner.account.id, 'journal.correction')).toEqual([
        expect.objectContaining({ before: '72', after: '75', reason: 'Marked again' }),
      ]);
    });

    it('takes a correction of a work, a total, a number and a note from the Academic Vice Principal and the Super Admin, never a teacher or an Academic Vice Principal of another branch', async () => {
      const x = await scene();
      const other = await scene();
      const chief = await superAdmin();
      const elsewhere = await holder(
        { role: 'academic_vice_principal', branchId: other.branch },
        { role: 'teacher', branchId: x.branch },
      );
      const correction = { reason: 'The register says so' };
      const work = await as(x.vice, x.branch, (calls) =>
        calls.post(`/api/journal/lessons/${x.second}/works`, { kind: 'classwork', correction }),
      );
      const added = ok(work).body as { id: string; version: number };
      await as(chief, x.branch, async (calls) => {
        ok(
          await calls.put(`/api/journal/lessons/${x.second}/works/total`, {
            column: { workId: added.id },
            total: 10,
            version: added.version,
            correction,
          }),
        );
        ok(
          await calls.post(`/api/journal/lessons/${x.second}/scores`, {
            saves: [
              { studentId: x.ahmedov, column: { workId: added.id }, score: 7, version: null },
            ],
            correction,
          }),
        );
      });
      await as(x.vice, x.branch, async (calls) => {
        ok(
          await calls.put('/api/journal/comments', {
            on: { target: 'note', lessonId: x.second, studentId: x.ahmedov },
            body: 'Worked well',
            visibility: 'staff',
            version: null,
            correction,
          }),
        );
      });
      for (const browser of [x.owner, elsewhere]) {
        await as(browser, x.branch, async (calls) => {
          const refused = await calls.put(`/api/journal/lessons/${x.second}/works/total`, {
            column: { workId: added.id },
            total: 12,
            version: 2,
            correction,
          });
          expect(refused.status).toBe(403);
          expect(codeOf(refused)).toBe('journal_correction_role');
        });
      }
      const how = await t.database.migrator
        .selectFrom('journal_work_history')
        .select(['changed_how', 'reason'])
        .where('work_id', '=', added.id)
        .orderBy('version')
        .execute();
      expect(how).toEqual([{ changed_how: 'correction', reason: 'The register says so' }]);
      expect(await noticesOf(x.owner.account.id, 'journal.correction')).toEqual([
        expect.objectContaining({ before: '—', after: '7' }),
      ]);
    });
  });
});
