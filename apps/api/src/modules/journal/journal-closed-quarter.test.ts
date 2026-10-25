import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import {
  APP_VERSION,
  APP_VERSION_HEADER,
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  absenceReasonSchema,
  journalUnlockSchema,
} from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setEditDays } from '../../testing/branch-filter-sql.js';
import { closeQuarter } from '../../testing/closing-kit.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { MemoryPhotoStore } from '../people/photo-store.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12 and 19 October are locked. */
const MOMENT = '2026-10-27T12:00:00+05:00';
/** With 7 edit days the lesson of 19 October is open through 23:59 of the 26th. */
const LAST_MINUTE = '2026-10-26T23:59:00+05:00';
/** Tuesday 10 November 2026, noon: quarter 1 (to 31 October) is closed, quarter 2 open. */
const AFTER_CLOSE = '2026-11-10T12:00:00+05:00';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ?? `status ${response.status}`;

const ok = (response: Response, status = 200): Response => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response;
};

const closed = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBe(409);
  expect(codeOf(response)).toBe('quarter_closed');
};

// All names are invented. Task 9.2b, closing a quarter (pull request #230), the refusals of
// the journal side in a closed quarter, through the routes:
// - From 6.3 (pull request #211, decision 11): docs/spec/edge-cases/journal.md, "A Tutor
//   records why a student was absent": "The class Tutor and the Academic Vice Principal can
//   edit it until the quarter closes." The set, the clear and the file of a reason of a date in
//   a closed quarter are refused; a date of the next, open quarter is still taken.
// - From 8.4 (pull request #222): a correction (of the cell, the work, the rating entry and the
//   comment) and an unlock request are refused in a closed quarter, and so is the approval of a
//   request sent before the close; its refusal still works.
// The closing row is written as the close writes it (`closing-kit.ts`); the close itself is
// tested in closing.test.ts.
describe('the journal of a closed quarter', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;
  const store = new MemoryPhotoStore();

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Malika', `Yusupova${'a'.repeat(names % 7)}`);
  };

  type Browser = { cookie: string; account: { id: string } };
  interface Calls {
    get: (path: string) => Promise<Response>;
    post: (path: string, body?: object) => Promise<Response>;
    put: (path: string, body: object) => Promise<Response>;
    del: (path: string) => Promise<Response>;
    upload: (path: string, type: string, bytes: Buffer) => Promise<Response>;
  }

  const VALID_FROM = new Date('2026-09-01T00:00:00+05:00');

  /** Runs `work` as the browser in the scene's branch with the clock at `moment`. */
  async function as<T>(
    browser: Browser,
    branch: string,
    work: (calls: Calls) => Promise<T>,
    moment = AFTER_CLOSE,
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
        del: (path) =>
          request(t.kit.server)
            .delete(path)
            .set('Cookie', browser.cookie)
            .set(BRANCH_HEADER, branch)
            .set(APP_VERSION_HEADER, String(APP_VERSION)),
        upload: (path, type, bytes) =>
          request(t.kit.server)
            .put(path)
            .set('Cookie', browser.cookie)
            .set(BRANCH_HEADER, branch)
            .set(APP_VERSION_HEADER, String(APP_VERSION))
            .set('Content-Type', type)
            .send(bytes),
      });
    } finally {
      t.clock.set(START);
    }
  }

  /**
   * The graded scene of 8.4 with 7 edit days and a rating exam: maths of 7th grade on the
   * Mondays from 12 October at 08:00, owned by its teacher; the Head Teacher and the Academic
   * Vice Principal of the subject; a student of the class from 1 September.
   */
  async function scene() {
    const owner = await account();
    const head = await account();
    const vice = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id },
    });
    await setEditDays(t.database.migrator, s.branch, 7);
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
    const q1 = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    await t.kit.giveRole(owner.account.id, {
      role: 'teacher',
      branchId: s.branch,
      validFrom: VALID_FROM,
    });
    await t.kit.giveRole(head.account.id, {
      role: 'head_teacher',
      branchId: s.branch,
      subjectIds: [s.subject],
      validFrom: VALID_FROM,
    });
    await t.kit.giveRole(vice.account.id, {
      role: 'academic_vice_principal',
      branchId: s.branch,
      validFrom: VALID_FROM,
    });
    const [first, second, third] = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('The scene has three lessons in October.');
    }
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .executeTakeFirstOrThrow()
    ).id;
    // Built before the close: a closed quarter takes no status row dated in it.
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const ahmedov = await members.student(s.branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: 'Ali', last_name: 'Ahmedov' })
      .where('id', '=', ahmedov)
      .execute();
    await members.member({
      branch: s.branch,
      classId: s.classId,
      studentId: ahmedov,
      from: '2026-09-01',
    });
    return { ...s, owner, head, vice, q1, first, second, third, journal, ahmedov };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const close = (x: Scene) =>
    closeQuarter(t.database, { branchId: x.branch, quarterId: x.q1, accountId: x.vice.account.id });

  /** Every row of the tables the refused routes write, in the scene's branch. */
  const rowsOf = async (branch: string) => {
    const found: Record<string, unknown[]> = {};
    for (const table of [
      'student_absence_reasons',
      'journal_cells',
      'journal_works',
      'journal_comments',
      'journal_rating_exams',
      'journal_rating_entries',
      'journal_unlocks',
      'notifications',
    ] as const) {
      found[table] = (
        await t.database.migrator
          .selectFrom(table)
          .selectAll()
          .where('branch_id', '=', branch)
          .execute()
      )
        .map((row) => JSON.stringify(row))
        .sort();
    }
    found.audit = (
      await t.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('branch_id', '=', branch)
        .execute()
    )
      .map((row) => row.id)
      .sort();
    return found;
  };

  const reasonPath = (x: Scene, date: string) =>
    `/api/journal/student-absences/${x.ahmedov}/${date}`;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true, photoStore: store });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('refuses the set, the clear and the file of a reason of absence in a closed quarter, and takes a date of the next quarter (From 6.3)', async () => {
    const x = await scene();
    await as(
      x.vice,
      x.branch,
      async (calls) => {
        ok(await calls.put(reasonPath(x, '2026-10-19'), { category: 'illness', note: 'Fever' }));
        ok(
          await calls.upload(
            `${reasonPath(x, '2026-10-19')}/file?name=Note.pdf`,
            'application/pdf',
            PDF,
          ),
        );
      },
      MOMENT,
    );
    await close(x);
    const before = await rowsOf(x.branch);
    const keys = store.keys().length;
    await as(x.vice, x.branch, async (calls) => {
      // A change, a clear, and a first reason of another day of the closed quarter.
      closed(await calls.put(reasonPath(x, '2026-10-19'), { category: 'family', note: '' }));
      closed(await calls.put(reasonPath(x, '2026-10-19'), { category: null, note: '' }));
      closed(await calls.put(reasonPath(x, '2026-10-20'), { category: 'illness', note: '' }));
      // The file is neither put nor removed; it is still opened.
      closed(
        await calls.upload(
          `${reasonPath(x, '2026-10-19')}/file?name=Other.pdf`,
          'application/pdf',
          PDF,
        ),
      );
      closed(await calls.del(`${reasonPath(x, '2026-10-19')}/file`));
    });
    expect(await rowsOf(x.branch)).toEqual(before);
    expect(store.keys()).toHaveLength(keys);
    await as(x.vice, x.branch, async (calls) => {
      ok(await calls.get(`${reasonPath(x, '2026-10-19')}/file`));
      // Monday 9 November is in quarter 2, open.
      const taken = absenceReasonSchema.parse(
        ok(await calls.put(reasonPath(x, '2026-11-09'), { category: 'illness', note: 'Cold' }))
          .body,
      );
      expect(taken).toMatchObject({ date: '2026-11-09', category: 'illness' });
    });
  });

  it('refuses a correction of a cell, a work, a comment and a rating entry in a closed quarter (From 8.4)', async () => {
    const x = await scene();
    const ratingBase = `/api/journal/journals/${x.journal}/rating/${x.q1}`;
    await as(
      x.owner,
      x.branch,
      async (calls) => {
        ok(
          await calls.post(`/api/journal/lessons/${x.second}/attendance`, {
            saves: [{ studentId: x.ahmedov, mark: 1, version: null }],
          }),
        );
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
    await close(x);
    const before = await rowsOf(x.branch);
    const correction = { reason: 'The register says so' };
    // The Academic Vice Principal does not teach the lesson: in an open quarter each is a
    // correction they make (journal-locks.test.ts, own_request test).
    await as(x.vice, x.branch, async (calls) => {
      closed(
        await calls.post(`/api/journal/lessons/${x.second}/attendance`, {
          saves: [{ studentId: x.ahmedov, mark: 0, version: 1 }],
          correction,
        }),
      );
      closed(
        await calls.post(`/api/journal/lessons/${x.second}/works`, {
          kind: 'classwork',
          correction,
        }),
      );
      closed(
        await calls.put('/api/journal/comments', {
          on: { target: 'note', lessonId: x.second, studentId: x.ahmedov },
          body: 'Worked well',
          visibility: 'staff',
          version: null,
          correction,
        }),
      );
      closed(
        await calls.post(`${ratingBase}/entries`, {
          studentId: x.ahmedov,
          entry: { kind: 'score', score: 75 },
          reason: 'Marked again',
          version: 1,
          correction: true,
        }),
      );
    });
    expect(await rowsOf(x.branch)).toEqual(before);
  });

  it('refuses an unlock request in a closed quarter and the approval of one sent before the close; its refusal still works (From 8.4)', async () => {
    const x = await scene();
    const ratingBase = `/api/journal/journals/${x.journal}/rating/${x.q1}`;
    await as(
      x.owner,
      x.branch,
      async (calls) => {
        ok(await calls.put(`${ratingBase}/date`, { date: '2026-10-19', version: null }));
      },
      LAST_MINUTE,
    );
    // Sent while the quarter is open: the lesson of 12 October is locked.
    const sent = journalUnlockSchema.parse(
      ok(
        await as(
          x.owner,
          x.branch,
          (calls) => calls.post(`/api/journal/lessons/${x.first}/unlocks`, { reason: 'I was ill' }),
          MOMENT,
        ),
        201,
      ).body,
    );
    await close(x);
    const before = await rowsOf(x.branch);
    await as(x.owner, x.branch, async (calls) => {
      closed(await calls.post(`/api/journal/lessons/${x.second}/unlocks`, { reason: 'I was ill' }));
      closed(await calls.post(`${ratingBase}/unlocks`, { reason: 'Retake day' }));
    });
    await as(x.head, x.branch, async (calls) => {
      closed(
        await calls.post(`/api/journal/unlocks/${sent.id}/decide`, {
          decision: 'approve',
          days: 1,
          version: 1,
        }),
      );
    });
    expect(await rowsOf(x.branch)).toEqual(before);
    const refusal = await as(x.head, x.branch, (calls) =>
      calls.post(`/api/journal/unlocks/${sent.id}/decide`, {
        decision: 'refuse',
        reason: 'The quarter is closed',
        version: 1,
      }),
    );
    expect(journalUnlockSchema.parse(ok(refusal).body).status).toBe('refused');
  });

  // Permission review of 9.2b, M4 (From 8.4; `edge/journal`, Closing and reopening): the
  // Academic Vice Principal's date, "not held" and "exempt" of the rating exam take no edit
  // period (no `decideWrite`); the route locks the quarter itself after its scope checks.
  it('refuses the rating exam date, "not held" and "exempt" of the Academic Vice Principal in a closed quarter (From 8.4)', async () => {
    const x = await scene();
    const ratingBase = `/api/journal/journals/${x.journal}/rating/${x.q1}`;
    await as(
      x.owner,
      x.branch,
      async (calls) => {
        ok(await calls.put(`${ratingBase}/date`, { date: '2026-10-19', version: null }));
      },
      LAST_MINUTE,
    );
    await close(x);
    const before = await rowsOf(x.branch);
    await as(x.vice, x.branch, async (calls) => {
      closed(await calls.put(`${ratingBase}/date`, { date: '2026-10-26', version: 1 }));
      closed(await calls.put(`${ratingBase}/not-held`, { notHeld: true, version: 1 }));
      closed(
        await calls.post(`${ratingBase}/entries`, {
          studentId: x.ahmedov,
          entry: { kind: 'exempt' },
          reason: null,
          version: null,
        }),
      );
    });
    expect(await rowsOf(x.branch)).toEqual(before);
  });

  // Permission review of 9.2b, S1: the scope is checked before the closed quarter, so a
  // refusal tells nothing of a record the reader may not write.
  it('answers the scope refusal before the closed quarter: attendance, a reason of absence and an unlock decision', async () => {
    const x = await scene();
    // A Teacher of the branch who does not teach the lesson.
    const stranger = await account();
    await t.kit.giveRole(stranger.account.id, {
      role: 'teacher',
      branchId: x.branch,
      validFrom: VALID_FROM,
    });
    // The Tutor of the other class.
    const tutor = await account();
    const tutorRole = await t.kit.giveRole(tutor.account.id, {
      role: 'tutor',
      branchId: x.branch,
      validFrom: VALID_FROM,
    });
    await load.classes.person(x.branch, ['uz'], { accountId: tutor.account.id });
    await load.classes.tutorRow(x.branch, x.otherClass, tutorRole.id);
    // A Head Teacher of another subject.
    const otherHead = await account();
    await t.kit.giveRole(otherHead.account.id, {
      role: 'head_teacher',
      branchId: x.branch,
      subjectIds: [await load.classes.subject({ grades: [7], journalType: 'graded' })],
      validFrom: VALID_FROM,
    });
    const sent = journalUnlockSchema.parse(
      ok(
        await as(
          x.owner,
          x.branch,
          (calls) => calls.post(`/api/journal/lessons/${x.first}/unlocks`, { reason: 'I was ill' }),
          MOMENT,
        ),
        201,
      ).body,
    );
    await close(x);
    const before = await rowsOf(x.branch);
    await as(stranger, x.branch, async (calls) => {
      const saved = await calls.post(`/api/journal/lessons/${x.second}/attendance`, {
        saves: [{ studentId: x.ahmedov, mark: 1, version: null }],
      });
      expect([saved.status, codeOf(saved)]).toEqual([403, 'journal_entry_scope']);
    });
    await as(tutor, x.branch, async (calls) => {
      const reason = await calls.put(reasonPath(x, '2026-10-19'), {
        category: 'illness',
        note: '',
      });
      expect([reason.status, codeOf(reason)]).toEqual([403, 'absence_scope']);
    });
    await as(otherHead, x.branch, async (calls) => {
      const decided = await calls.post(`/api/journal/unlocks/${sent.id}/decide`, {
        decision: 'approve',
        days: 1,
        version: 1,
      });
      expect([decided.status, codeOf(decided)]).toEqual([403, 'journal_unlock_scope']);
    });
    expect(await rowsOf(x.branch)).toEqual(before);
  });
});
