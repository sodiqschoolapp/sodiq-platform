import {
  allPresentSchema,
  attendanceSavedSchema,
  cellHistorySchema,
  journalGridSchema,
  type JournalGrid,
} from '@sodiq/shared';
import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ActingKit } from '../../testing/acting-kit.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from './cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ?? `status ${response.status}`;

// All names are invented. Task 6.3, pull request #211: attendance entry, "all present" and
// the history of a cell (docs/spec/07-journal.md, Entering data, Editing rules and locks,
// Who can do what; docs/spec/edge-cases/journal.md, Entering, Saving and working together;
// docs/spec/edge-cases/00-definitions.md, Held lesson, Expected student).
describe('attendance entry', () => {
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
    get: (branch: string, path: string) => Promise<Response>;
    post: (branch: string, path: string, body?: object) => Promise<Response>;
  }

  /** Runs `work` with the clock at `moment` and the roles given from 1 September. */
  async function as<T>(
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
        get: (branch, path) => t.get(path, branch, browser.cookie),
        post: (branch, path, body) => t.post(path, branch, body ?? {}, browser.cookie),
      });
    } finally {
      t.clock.set(START);
    }
  }

  /** A student of the class from `from` (until `until`), named as given. */
  const student = async (
    branch: string,
    classId: string,
    last: string,
    from = '2026-09-01',
    until?: string,
  ): Promise<string> => {
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: 'Ali', last_name: last })
      .where('id', '=', id)
      .execute();
    await members.member({
      branch,
      classId,
      studentId: id,
      from,
      ...(until === undefined ? {} : { ownUntil: until }),
    });
    return id;
  };

  /** The scene's class lessons up to 31 October, in order. */
  const lessonsOf = async (classId: string) =>
    (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', classId)
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);

  /**
   * The graded scene of 6.2 with three students: maths of 7th grade on the Mondays
   * 12, 19 and 26 October at 08:00, owned by the scene's teacher; Valiyev left on
   * 18 October.
   */
  async function scene(accounts: { teacher?: string; spare?: string } = {}) {
    const s = await publishedScene(t, load, { graded: true, accounts });
    const lessons = await lessonsOf(s.classId);
    const [first, second, third] = lessons;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('The scene has three lessons in October.');
    }
    return {
      ...s,
      first,
      second,
      third,
      ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
      boboyev: await student(s.branch, s.classId, 'Boboyev'),
      valiyev: await student(s.branch, s.classId, 'Valiyev', '2026-09-01', '2026-10-18'),
    };
  }

  const cellOf = (lessonId: string, studentId: string) =>
    t.database.migrator
      .selectFrom('journal_cells')
      .select(['id', 'mark', 'version', 'changed_by'])
      .where('lesson_id', '=', lessonId)
      .where('student_id', '=', studentId)
      .where('work_id', 'is', null)
      .executeTakeFirst();

  const historyCount = async (lessonId: string) =>
    Number(
      (
        await t.database.migrator
          .selectFrom('journal_cell_history')
          .select((select) => select.fn.countAll().as('count'))
          .where('lesson_id', '=', lessonId)
          .executeTakeFirstOrThrow()
      ).count,
    );

  /** The audit entries of journal writes (giving a role writes entries of its own). */
  const journalEntries = async () =>
    Number(
      (
        await t.database.migrator
          .selectFrom('audit_log')
          .select((select) => select.fn.countAll().as('count'))
          .where((eb) =>
            eb.or([eb('action', 'like', 'journal.%'), eb('action', 'like', 'absence_reason.%')]),
          )
          .executeTakeFirstOrThrow()
      ).count,
    );

  /** Writes as the migrator with the moment the triggers read. */
  const atMoment = <T>(work: (transaction: Transaction) => Promise<T>) =>
    t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${MOMENT}, true)`.execute(transaction);
      return work(transaction);
    });

  /** Every row the entry routes write in a branch: the cells and their history (0108). */
  const cellsOfBranch = (branch: string) =>
    Promise.all([
      t.database.migrator
        .selectFrom('journal_cells')
        .selectAll()
        .where('branch_id', '=', branch)
        .orderBy('id')
        .execute(),
      t.database.migrator
        .selectFrom('journal_cell_history')
        .selectAll()
        .where('branch_id', '=', branch)
        .orderBy('id')
        .execute(),
    ]);

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('all present', () => {
    it('fills every empty cell of the expected students in one request, one audit entry and one history line per cell (the Done when)', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        // Boboyev typed 0 a second before (edge/journal: "fill only the cells that are empty").
        const typed = await post(s.branch, `/api/journal/lessons/${s.second}/attendance`, {
          saves: [{ studentId: s.boboyev, mark: 0, version: null }],
        });
        expect(typed.status, JSON.stringify(typed.body)).toBe(200);
        const entriesBefore = (await t.entries('journal.all_present')).length;
        const linesBefore = await historyCount(s.second);
        const answer = await post(s.branch, `/api/journal/lessons/${s.second}/all-present`);
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        const filled = allPresentSchema.parse(answer.body);
        // Valiyev left on the 18th: not expected on the 19th, never filled.
        expect(filled.filled.map((one) => one.studentId)).toEqual([s.ahmedov]);
        expect(filled.skipped).toEqual([{ studentId: s.boboyev, mark: 0 }]);
        expect((await cellOf(s.second, s.ahmedov))?.mark).toBe(1);
        expect((await cellOf(s.second, s.boboyev))?.mark).toBe(0);
        expect(await cellOf(s.second, s.valiyev)).toBeUndefined();
        expect(await historyCount(s.second)).toBe(linesBefore + 1);
        const entries = await t.entries('journal.all_present');
        expect(entries).toHaveLength(entriesBefore + 1);
        expect(entries.at(-1)).toMatchObject({
          record_id: s.second,
          details: { filled: 1, skipped: 1 },
        });
        // A second press fills nothing.
        const again = allPresentSchema.parse(
          (await post(s.branch, `/api/journal/lessons/${s.second}/all-present`)).body,
        );
        expect(again.filled).toEqual([]);
        expect(again.skipped.map((one) => one.studentId)).toEqual([s.ahmedov, s.boboyev]);
        expect(await historyCount(s.second)).toBe(linesBefore + 1);
      });
    });

    it('fills a cleared cell, and writes one history line for each of many students', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const more = [
        await student(s.branch, s.classId, 'Davronov'),
        await student(s.branch, s.classId, 'Ergashev'),
      ];
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        const typed = attendanceSavedSchema.parse(
          (
            await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
              saves: [{ studentId: s.ahmedov, mark: 2, version: null }],
            })
          ).body,
        );
        const cleared = await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: null, version: typed.cells[0]?.version ?? 0 }],
        });
        expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
        const linesBefore = await historyCount(s.first);
        const filled = allPresentSchema.parse(
          (await post(s.branch, `/api/journal/lessons/${s.first}/all-present`)).body,
        );
        // Valiyev was a member on the 12th.
        expect(filled.filled.map((one) => one.studentId)).toEqual([
          s.ahmedov,
          s.boboyev,
          ...more,
          s.valiyev,
        ]);
        expect(await historyCount(s.first)).toBe(linesBefore + 5);
        expect((await cellOf(s.first, s.ahmedov))?.version).toBe(3);
      });
    });

    it('is refused before the start, on a cancelled lesson, on a lesson with no teacher recorded, outside the scope and for another branch', async () => {
      const owner = await account();
      const other = await account();
      const s = await scene({ teacher: owner.account.id, spare: other.account.id });
      const elsewhere = await scene();
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'School trip' })
        .where('id', '=', s.third)
        .execute();
      const auditBefore = await journalEntries();
      const rowsBefore = [await cellsOfBranch(s.branch), await cellsOfBranch(elsewhere.branch)];
      await as(
        owner,
        [{ role: 'teacher', branchId: s.branch }],
        async ({ post }) => {
          const early = await post(s.branch, `/api/journal/lessons/${s.first}/all-present`);
          expect(early.status).toBe(409);
          expect(codeOf(early)).toBe('entry_not_started');
        },
        '2026-10-12T07:59:00+05:00',
      );
      await as(owner, [], async ({ post }) => {
        const cancelled = await post(s.branch, `/api/journal/lessons/${s.third}/all-present`);
        expect(codeOf(cancelled)).toBe('lesson_cancelled_cell');
        for (const lesson of [elsewhere.first, randomUUID()]) {
          const missing = await post(s.branch, `/api/journal/lessons/${lesson}/all-present`);
          expect(missing.status).toBe(404);
        }
      });
      await as(other, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        const refused = await post(s.branch, `/api/journal/lessons/${s.first}/all-present`);
        expect(refused.status).toBe(403);
        expect(codeOf(refused)).toBe('journal_entry_scope');
      });
      expect(await journalEntries()).toBe(auditBefore);
      expect([await cellsOfBranch(s.branch), await cellsOfBranch(elsewhere.branch)]).toEqual(
        rowsBefore,
      );
      // No teacher recorded after the start: unresolved, not held (edge/00-definitions).
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: null })
        .where('id', '=', s.second)
        .execute();
      await as(owner, [], async ({ post }) => {
        const unresolved = await post(s.branch, `/api/journal/lessons/${s.second}/all-present`);
        expect(unresolved.status).toBe(409);
        expect(codeOf(unresolved)).toBe('lesson_not_held');
      });
    });
  });

  describe('a typed mark', () => {
    it('saves 0 to 3 with a history line from the start of the lesson, and refuses it a minute before', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(
        owner,
        [{ role: 'teacher', branchId: s.branch }],
        async ({ post }) => {
          const early = await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
            saves: [{ studentId: s.ahmedov, mark: 1, version: null }],
          });
          expect(early.status).toBe(409);
          expect(codeOf(early)).toBe('entry_not_started');
        },
        '2026-10-12T07:59:00+05:00',
      );
      await as(
        owner,
        [],
        async ({ post }) => {
          const saved = await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
            saves: [
              { studentId: s.boboyev, mark: 3, version: null },
              { studentId: s.ahmedov, mark: 2, version: null },
            ],
          });
          expect(saved.status, JSON.stringify(saved.body)).toBe(200);
          expect(attendanceSavedSchema.parse(saved.body).cells).toEqual([
            { studentId: s.ahmedov, mark: 2, version: 1 },
            { studentId: s.boboyev, mark: 3, version: 1 },
          ]);
          const changed = await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
            saves: [{ studentId: s.ahmedov, mark: 0, version: 1 }],
          });
          expect(attendanceSavedSchema.parse(changed.body).cells).toEqual([
            { studentId: s.ahmedov, mark: 0, version: 2 },
          ]);
        },
        '2026-10-12T08:00:00+05:00',
      );
      const lines = await t.database.migrator
        .selectFrom('journal_cell_history')
        .select(['mark_before', 'mark_after', 'changed_how'])
        .where('lesson_id', '=', s.first)
        .where('student_id', '=', s.ahmedov)
        .orderBy('version')
        .execute();
      expect(lines).toEqual([
        { mark_before: null, mark_after: 2, changed_how: 'entry' },
        { mark_before: 2, mark_after: 0, changed_how: 'entry' },
      ]);
    });

    it('refuses marks 4 and 5, a stale version, a student not expected and a student of another branch', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      const elsewhere = await scene();
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        for (const mark of [4, 5]) {
          const refused = await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
            saves: [{ studentId: s.ahmedov, mark, version: null }],
          });
          expect(refused.status).toBe(400);
        }
        await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: 1, version: null }],
        });
        const stale = await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: 0, version: null }],
        });
        expect(stale.status).toBe(409);
        expect(codeOf(stale)).toBe('cell_stale');
        expect(
          (stale.body as { error: { details: { storedCell?: { value: number } }[] } }).error
            .details[0]?.storedCell?.value,
        ).toBe(1);
        // Valiyev left on the 18th: closed on the 19th.
        const closed = await post(s.branch, `/api/journal/lessons/${s.second}/attendance`, {
          saves: [{ studentId: s.valiyev, mark: 1, version: null }],
        });
        expect(codeOf(closed)).toBe('cell_closed');
        const before = [await cellsOfBranch(s.branch), await cellsOfBranch(elsewhere.branch)];
        const auditBefore = await journalEntries();
        const foreign = await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [
            { studentId: s.boboyev, mark: 1, version: null },
            { studentId: elsewhere.ahmedov, mark: 1, version: null },
          ],
        });
        expect(foreign.status).toBe(404);
        const unknown = await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [{ studentId: randomUUID(), mark: 1, version: null }],
        });
        expect(unknown.status).toBe(404);
        for (const lesson of [elsewhere.first, randomUUID()]) {
          const missing = await post(s.branch, `/api/journal/lessons/${lesson}/attendance`, {
            saves: [{ studentId: s.boboyev, mark: 1, version: null }],
          });
          expect(missing.status).toBe(404);
        }
        expect([await cellsOfBranch(s.branch), await cellsOfBranch(elsewhere.branch)]).toEqual(
          before,
        );
        expect(await journalEntries()).toBe(auditBefore);
      });
    });

    it('answers the students saved with 0 who were at school at an earlier lesson that day (decision 9)', async () => {
      const owner = await account();
      const s = await publishedScene(t, load, {
        graded: true,
        double: true,
        accounts: { teacher: owner.account.id },
      });
      const [early, late] = await lessonsOf(s.classId);
      const [one, two, three] = [
        await student(s.branch, s.classId, 'Ahmedov'),
        await student(s.branch, s.classId, 'Boboyev'),
        await student(s.branch, s.classId, 'Valiyev'),
      ];
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        await post(s.branch, `/api/journal/lessons/${early ?? ''}/attendance`, {
          saves: [
            { studentId: one, mark: 1, version: null },
            { studentId: two, mark: 3, version: null },
            { studentId: three, mark: 0, version: null },
          ],
        });
        const later = attendanceSavedSchema.parse(
          (
            await post(s.branch, `/api/journal/lessons/${late ?? ''}/attendance`, {
              saves: [
                { studentId: one, mark: 0, version: null },
                { studentId: two, mark: 0, version: null },
                { studentId: three, mark: 0, version: null },
              ],
            })
          ).body,
        );
        expect(later.presentEarlier).toEqual([one, two]);
        // A 1 in a later lesson does not count for a 0 typed in an earlier one.
        const back = attendanceSavedSchema.parse(
          (
            await post(s.branch, `/api/journal/lessons/${late ?? ''}/attendance`, {
              saves: [{ studentId: three, mark: 1, version: 1 }],
            })
          ).body,
        );
        expect(back.presentEarlier).toEqual([]);
        const first = attendanceSavedSchema.parse(
          (
            await post(s.branch, `/api/journal/lessons/${early ?? ''}/attendance`, {
              saves: [{ studentId: three, mark: 0, version: 1 }],
            })
          ).body,
        );
        expect(first.presentEarlier).toEqual([]);
      });
    });
  });

  describe('who enters (decision 3, correction 1)', () => {
    const typeOne = (calls: Calls, branch: string, lesson: string, studentId: string) =>
      calls.post(branch, `/api/journal/lessons/${lesson}/attendance`, {
        saves: [{ studentId, mark: 1, version: null }],
      });

    it('lets a substitute enter the substituted lesson only, also one whose only role is Tutor, and refuses a Head Tutor substitute by the table', async () => {
      const owner = await account();
      const substitute = await account();
      const s = await scene({ teacher: owner.account.id, spare: substitute.account.id });
      // The substitute (or the teacher of a correction of kind `teacher`) is the lesson's teacher.
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: s.spareTeacher.staffId })
        .where('id', '=', s.second)
        .execute();
      await as(substitute, [{ role: 'teacher', branchId: s.branch }], async (calls) => {
        expect((await typeOne(calls, s.branch, s.second, s.ahmedov)).status).toBe(200);
        const next = await typeOne(calls, s.branch, s.third, s.ahmedov);
        expect(next.status).toBe(403);
        expect(codeOf(next)).toBe('journal_entry_scope');
        expect(codeOf(await typeOne(calls, s.branch, s.first, s.ahmedov))).toBe(
          'journal_entry_scope',
        );
      });
      // The journal's own teacher can also enter it (edge/timetable).
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async (calls) => {
        expect((await typeOne(calls, s.branch, s.second, s.boboyev)).status).toBe(200);
      });

      const tutorOnly = await account();
      const tutorStaff = await load.teacher(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
        accountId: tutorOnly.account.id,
      });
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: tutorStaff.staffId })
        .where('id', '=', s.first)
        .execute();
      await as(tutorOnly, [{ role: 'tutor', branchId: s.branch }], async (calls) => {
        expect((await typeOne(calls, s.branch, s.first, s.ahmedov)).status).toBe(200);
        expect(codeOf(await typeOne(calls, s.branch, s.second, s.valiyev))).toBe(
          'journal_entry_scope',
        );
        // "All present" too (permission review of the code, should-fix 2).
        expect(
          (await calls.post(s.branch, `/api/journal/lessons/${s.first}/all-present`)).status,
        ).toBe(200);
        expect(
          codeOf(await calls.post(s.branch, `/api/journal/lessons/${s.second}/all-present`)),
        ).toBe('journal_entry_scope');
      });

      const headTutor = await account();
      const headStaff = await load.teacher(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
        accountId: headTutor.account.id,
      });
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: headStaff.staffId })
        .where('id', '=', s.third)
        .execute();
      const auditBefore = await journalEntries();
      await as(headTutor, [{ role: 'head_tutor', branchId: s.branch }], async (calls) => {
        expect((await typeOne(calls, s.branch, s.third, s.ahmedov)).status).toBe(403);
        expect(
          (await calls.post(s.branch, `/api/journal/lessons/${s.third}/all-present`)).status,
        ).toBe(403);
      });
      expect(await journalEntries()).toBe(auditBefore);
    });

    it('lets the owner today enter an earlier owner’s lesson, and the earlier owner keep their own (edge/journal, "A teacher is replaced from Monday")', async () => {
      const cells = await CellsKit.create(t.database.migrator);
      const acting = new ActingKit(t.database.migrator);
      const branch = await t.newBranch();
      const { year } = await cells.lessons.year(branch);
      const classId = await load.classes.schoolClass(branch, year, { grade: 7 });
      const before = await account();
      const after = await account();
      const earlier = await load.teacher(branch, {
        subjects: [{ subject: cells.subject, grades: [7] }],
        accountId: before.account.id,
      });
      const later = await load.teacher(branch, {
        subjects: [{ subject: cells.subject, grades: [7] }],
        accountId: after.account.id,
      });
      const scene = { branch, year, classId, subject: cells.subject };
      const owned = await cells.lesson(branch, year, classId, '2026-10-12');
      const notOwned = await cells.lesson(branch, year, classId, '2026-10-26');
      await acting.published(scene, '2026-09-07', earlier.staffId);
      await acting.published(scene, '2026-10-19', later.staffId);
      await acting.journal(branch, year, classId, cells.subject);
      for (const [lesson, staff] of [
        [owned, earlier.staffId],
        [notOwned, later.staffId],
      ] as const) {
        await t.database.migrator
          .updateTable('lessons')
          .set({ teacher_id: staff })
          .where('id', '=', lesson)
          .execute();
      }
      const ahmedov = await student(branch, classId, 'Ahmedov');
      await as(after, [{ role: 'teacher', branchId: branch }], async (calls) => {
        const saved = await typeOne(calls, branch, owned, ahmedov);
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      });
      await as(before, [{ role: 'teacher', branchId: branch }], async (calls) => {
        const own = await calls.post(branch, `/api/journal/lessons/${owned}/attendance`, {
          saves: [{ studentId: ahmedov, mark: 2, version: 1 }],
        });
        expect(own.status, JSON.stringify(own.body)).toBe(200);
        expect(codeOf(await typeOne(calls, branch, notOwned, ahmedov))).toBe('journal_entry_scope');
      });
    });

    it('lets the acting teacher of a vacancy enter a held lesson of the journal (journalOwnerOn)', async () => {
      const cells = await CellsKit.create(t.database.migrator);
      const acting = new ActingKit(t.database.migrator);
      const branch = await t.newBranch();
      const { year } = await cells.lessons.year(branch);
      const classId = await load.classes.schoolClass(branch, year, { grade: 7 });
      const vacancy = await load.vacancy(branch, {
        languages: ['uz'],
        subjects: [{ subject: cells.subject, grades: [7] }],
      });
      const actingBrowser = await account();
      const person = await load.teacher(branch, {
        subjects: [{ subject: cells.subject, grades: [7] }],
        accountId: actingBrowser.account.id,
      });
      const substitute = await load.teacher(branch, {
        subjects: [{ subject: cells.subject, grades: [7] }],
      });
      const lesson = await cells.lesson(branch, year, classId, '2026-10-26');
      const scene = { branch, year, classId, subject: cells.subject };
      await acting.published(scene, '2026-10-19', vacancy);
      const journal = await acting.journal(branch, year, classId, cells.subject);
      await acting.period(
        {
          ...scene,
          vacancy,
          person: person.staffId,
          personAccount: actingBrowser.account.id,
          version: '',
          journal,
        },
        '2026-10-19',
      );
      // Held by a substitute (the lesson's teacher); the acting teacher owns the journal.
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: substitute.staffId })
        .where('id', '=', lesson)
        .execute();
      const ahmedov = await student(branch, classId, 'Ahmedov');
      await as(actingBrowser, [{ role: 'teacher', branchId: branch }], async (calls) => {
        const saved = await typeOne(calls, branch, lesson, ahmedov);
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      });
    });

    it('refuses the Principal, a Head Teacher and the Head Tutor by the table, and the Academic Vice Principal and the Super Admin with no lesson of theirs by the scope', async () => {
      const s = await scene();
      const auditBefore = await journalEntries();
      const before = await cellsOfBranch(s.branch);
      for (const role of ['principal', 'head_tutor'] as const) {
        const browser = await account();
        await as(browser, [{ role, branchId: s.branch }], async (calls) => {
          const refused = await typeOne(calls, s.branch, s.first, s.ahmedov);
          expect(refused.status, role).toBe(403);
          expect(codeOf(refused), role).not.toBe('journal_entry_scope');
        });
      }
      const head = await account();
      await as(
        head,
        [{ role: 'head_teacher', branchId: s.branch, subjectIds: [s.subject] }],
        async (calls) => {
          const refused = await typeOne(calls, s.branch, s.first, s.ahmedov);
          expect(refused.status).toBe(403);
          expect(codeOf(refused)).not.toBe('journal_entry_scope');
        },
      );
      const vice = await account();
      await as(vice, [{ role: 'academic_vice_principal', branchId: s.branch }], async (calls) => {
        const refused = await typeOne(calls, s.branch, s.first, s.ahmedov);
        expect(codeOf(refused)).toBe('journal_entry_scope');
        expect(
          codeOf(await calls.post(s.branch, `/api/journal/lessons/${s.first}/all-present`)),
        ).toBe('journal_entry_scope');
      });
      const admin = await account();
      await as(admin, [{ role: 'super_admin' }], async (calls) => {
        expect(codeOf(await typeOne(calls, s.branch, s.first, s.ahmedov))).toBe(
          'journal_entry_scope',
        );
      });
      expect(await journalEntries()).toBe(auditBefore);
      expect(await cellsOfBranch(s.branch)).toEqual(before);
      // Through the scope: an Academic Vice Principal or a Super Admin who teaches the lesson
      // enters it (permission review of the code, should-fix 1).
      for (const [browser, lesson] of [
        [vice, s.second],
        [admin, s.third],
      ] as const) {
        const staff = await load.teacher(s.branch, {
          subjects: [{ subject: s.subject, grades: [7] }],
          accountId: browser.account.id,
        });
        await t.database.migrator
          .updateTable('lessons')
          .set({ teacher_id: staff.staffId })
          .where('id', '=', lesson)
          .execute();
        await as(browser, [], async (calls) => {
          expect((await typeOne(calls, s.branch, lesson, s.ahmedov)).status).toBe(200);
          expect(
            (await calls.post(s.branch, `/api/journal/lessons/${lesson}/all-present`)).status,
          ).toBe(200);
        });
      }
    });
  });

  describe('at the same moment', () => {
    /**
     * Holds `hold` open in a transaction of the application for the branch, starts
     * `run` once the hold has written, waits until `run` waits on a lock, then commits.
     */
    async function heldThen(
      branch: string,
      hold: (transaction: Transaction) => Promise<void>,
      run: () => Promise<Response>,
    ): Promise<Response> {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const held = t.app
        .get(Transactions)
        .run([branch], async (transaction) => {
          await hold(transaction);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await isReady;
      const answer = run();
      for (let tries = 0; tries < 800; tries += 1) {
        const found = await sql<{ n: number }>`
          select count(distinct l.pid)::int as n
          from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where a.datname = current_database() and not l.granted
        `.execute(t.database.migrator);
        if ((found.rows[0]?.n ?? 0) >= 1) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      release();
      const heldError = await held;
      if (heldError !== undefined) {
        throw heldError instanceof Error ? heldError : new Error('The hold failed.');
      }
      return answer;
    }

    it('lets "all present" skip a 0 typed a moment before (edge/journal, "All present is pressed a second after someone typed a 0")', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        t.clock.set(MOMENT);
        const all = await heldThen(
          s.branch,
          async (transaction) => {
            // The typed save, held before its commit: the same writer the route calls.
            await saveCells(transaction, t.app.get(Audit), { accountId: owner.account.id }, [
              { lessonId: s.first, studentId: s.ahmedov, workId: null, value: 0, version: null },
            ]);
          },
          () => post(s.branch, `/api/journal/lessons/${s.first}/all-present`),
        );
        expect(all.status, JSON.stringify(all.body)).toBe(200);
        const answer = allPresentSchema.parse(all.body);
        expect(answer.skipped).toEqual([{ studentId: s.ahmedov, mark: 0 }]);
        expect(answer.filled.map((one) => one.studentId)).toEqual([s.boboyev, s.valiyev]);
        expect((await cellOf(s.first, s.ahmedov))?.mark).toBe(0);
      });
    });

    it('refuses a 0 typed on the version read before "all present" filled the cell, and saves it on the new version', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        t.clock.set(MOMENT);
        const late = await heldThen(
          s.branch,
          async (transaction) => {
            // "All present" held before its commit: the insert the route writes.
            await transaction
              .insertInto('journal_cells')
              .values(
                [s.ahmedov, s.boboyev].map((studentId) => ({
                  branch_id: s.branch,
                  lesson_id: s.second,
                  student_id: studentId,
                  mark: 1,
                  version: 1,
                  changed_by: owner.account.id,
                  changed_how: 'entry',
                  changed_at: new Date(0),
                })),
              )
              .execute();
            await t.app.get(Audit).record(transaction, {
              branchId: s.branch,
              actorId: owner.account.id,
              action: 'journal.all_present',
              record: { type: 'lesson', id: s.second },
            });
          },
          () =>
            post(s.branch, `/api/journal/lessons/${s.second}/attendance`, {
              saves: [{ studentId: s.ahmedov, mark: 0, version: null }],
            }),
        );
        expect(late.status).toBe(409);
        expect(codeOf(late)).toBe('cell_stale');
        expect((await cellOf(s.second, s.ahmedov))?.mark).toBe(1);
        const retyped = await post(s.branch, `/api/journal/lessons/${s.second}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: 0, version: 1 }],
        });
        expect(retyped.status).toBe(200);
      });
    });
  });

  describe('the history of a cell (decision 16)', () => {
    it('answers the lines of the cells the reader’s grid shows, attendance only for a Head Tutor, and refuses a substitute outside their lesson', async () => {
      const owner = await account();
      const substitute = await account();
      const s = await scene({ teacher: owner.account.id, spare: substitute.account.id });
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: s.spareTeacher.staffId })
        .where('id', '=', s.second)
        .execute();
      const work = (
        await t.database.migrator
          .insertInto('journal_works')
          .values({ branch_id: s.branch, lesson_id: s.first, kind: 'classwork', total: 10 })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post, get }) => {
        await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: 2, version: null }],
        });
        await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: 1, version: 1 }],
        });
        await atMoment((transaction) =>
          transaction
            .insertInto('journal_cells')
            .values({
              branch_id: s.branch,
              lesson_id: s.first,
              student_id: s.ahmedov,
              work_id: work,
              score: 7,
              version: 1,
              changed_by: owner.account.id,
              changed_how: 'entry',
              changed_at: new Date(MOMENT),
            })
            .execute(),
        );
        const answer = await get(
          s.branch,
          `/api/journal/lessons/${s.first}/students/${s.ahmedov}/history`,
        );
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        const history = cellHistorySchema.parse(answer.body);
        const attendance = history.lines.filter((line) => line.work === null);
        expect(attendance.map((line) => [line.before, line.after, line.changedHow])).toEqual([
          [null, 2, 'entry'],
          [2, 1, 'entry'],
        ]);
        expect(attendance[0]?.changedBy.accountId).toBe(owner.account.id);
        expect(history.lines.some((line) => line.work?.id === work)).toBe(true);
      });
      const headTutor = await account();
      await as(headTutor, [{ role: 'head_tutor', branchId: s.branch }], async ({ get }) => {
        const history = cellHistorySchema.parse(
          (await get(s.branch, `/api/journal/lessons/${s.first}/students/${s.ahmedov}/history`))
            .body,
        );
        expect(history.lines).toHaveLength(2);
        expect(history.lines.every((line) => line.work === null)).toBe(true);
      });
      await as(substitute, [{ role: 'teacher', branchId: s.branch }], async ({ get }) => {
        const other = await get(
          s.branch,
          `/api/journal/lessons/${s.first}/students/${s.ahmedov}/history`,
        );
        expect(other.status).toBe(403);
        expect(codeOf(other)).toBe('journal_scope');
        // Valiyev left on the 18th: not a student of the substituted lesson of the 19th.
        const outside = await get(
          s.branch,
          `/api/journal/lessons/${s.second}/students/${s.valiyev}/history`,
        );
        expect(codeOf(outside)).toBe('journal_scope');
        expect(
          (await get(s.branch, `/api/journal/lessons/${s.second}/students/${s.ahmedov}/history`))
            .status,
        ).toBe(200);
      });
      const elsewhere = await scene();
      await as(owner, [], async ({ get }) => {
        for (const path of [
          `/api/journal/lessons/${elsewhere.first}/students/${s.ahmedov}/history`,
          `/api/journal/lessons/${randomUUID()}/students/${s.ahmedov}/history`,
          `/api/journal/lessons/${s.first}/students/${elsewhere.ahmedov}/history`,
          `/api/journal/lessons/${s.first}/students/${randomUUID()}/history`,
        ]) {
          expect((await get(s.branch, path)).status, path).toBe(404);
        }
      });
    });
  });

  describe('the history of a cell, by role (permission review, must-fix 2)', () => {
    /** A Tutor of the class: the role from 1 September, a staff record and a Tutor row. */
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

    it('answers every reader whose grid shows the cell, and refuses a Tutor of another class and a Head Teacher of another subject', async () => {
      const owner = await account();
      const s = await scene({ teacher: owner.account.id });
      await as(owner, [{ role: 'teacher', branchId: s.branch }], async ({ post }) => {
        await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: 3, version: null }],
        });
      });
      const path = `/api/journal/lessons/${s.first}/students/${s.ahmedov}/history`;
      const lines = (response: Response) => {
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        return cellHistorySchema.parse(response.body).lines.map((line) => line.after);
      };
      for (const role of [
        'principal',
        'academic_vice_principal',
        'spiritual_vice_principal',
      ] as const) {
        const browser = await account();
        await as(browser, [{ role, branchId: s.branch }], async ({ get }) => {
          expect(lines(await get(s.branch, path)), role).toEqual([3]);
        });
      }
      const admin = await account();
      await as(admin, [{ role: 'super_admin' }], async ({ get }) => {
        expect(lines(await get(s.branch, path))).toEqual([3]);
      });
      const head = await account();
      await as(
        head,
        [{ role: 'head_teacher', branchId: s.branch, subjectIds: [s.subject] }],
        async ({ get }) => {
          expect(lines(await get(s.branch, path))).toEqual([3]);
        },
      );
      // A Senior Head Teacher of the subject holds no assignment of the branch.
      const senior = await account();
      await as(
        senior,
        [{ role: 'senior_head_teacher', subjectIds: [s.subject] }],
        async ({ get }) => {
          expect(lines(await get(s.branch, path))).toEqual([3]);
        },
      );
      const otherSubject = await load.classes.subject({ grades: [7] });
      const otherHead = await account();
      await as(
        otherHead,
        [{ role: 'head_teacher', branchId: s.branch, subjectIds: [otherSubject] }],
        async ({ get }) => {
          const refused = await get(s.branch, path);
          expect(refused.status).toBe(403);
          expect(codeOf(refused)).toBe('journal_scope');
        },
      );
      const ownTutor = await tutorOf(s.branch, s.classId);
      await as(ownTutor, [], async ({ get }) => {
        expect(lines(await get(s.branch, path))).toEqual([3]);
      });
      const otherTutor = await tutorOf(s.branch, s.otherClass);
      await as(otherTutor, [], async ({ get }) => {
        const refused = await get(s.branch, path);
        expect(refused.status).toBe(403);
        expect(codeOf(refused)).toBe('journal_scope');
      });
    });
  });

  describe('the grid', () => {
    const gridOf = (response: Response): JournalGrid => {
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return journalGridSchema.parse(response.body);
    };

    it('answers canEnter, the version and who typed a cell, and the category of a reason, never its note', async () => {
      const owner = await account();
      const substitute = await account();
      const s = await scene({ teacher: owner.account.id, spare: substitute.account.id });
      const journal = (
        await t.database.migrator
          .selectFrom('journals')
          .select('id')
          .where('class_id', '=', s.classId)
          .executeTakeFirstOrThrow()
      ).id;
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: s.spareTeacher.staffId })
        .where('id', '=', s.second)
        .execute();
      for (const [studentId, date] of [
        [s.ahmedov, '2026-10-12'],
        [s.boboyev, '2026-10-19'],
        // A day with no lesson of the journal: not answered (should-fix 4).
        [s.ahmedov, '2026-10-14'],
      ] as const) {
        await atMoment((transaction) =>
          transaction
            .insertInto('student_absence_reasons')
            .values({
              branch_id: s.branch,
              student_id: studentId,
              absence_date: date,
              category: 'illness',
              note: 'A note for the Tutor',
              changed_by: owner.account.id,
              changed_at: new Date(MOMENT),
            })
            .execute(),
        );
      }
      await as(
        owner,
        [{ role: 'teacher', branchId: s.branch }],
        async ({ get }) => {
          const grid = gridOf(await get(s.branch, `/api/journal/journals/${journal}`));
          expect(grid.lessons.map((lesson) => lesson.canEnter)).toEqual([false, false, false]);
        },
        '2026-10-12T07:59:00+05:00',
      );
      await as(owner, [], async ({ get, post }) => {
        await post(s.branch, `/api/journal/lessons/${s.first}/attendance`, {
          saves: [{ studentId: s.ahmedov, mark: 0, version: null }],
        });
        const response = await get(s.branch, `/api/journal/journals/${journal}`);
        const grid = gridOf(response);
        expect(grid.lessons.map((lesson) => lesson.canEnter)).toEqual([true, true, true]);
        const row = grid.students.find((one) => one.id === s.ahmedov);
        expect(row?.cells[0]).toMatchObject({ mark: 0, version: 1 });
        expect(row?.cells[0]?.typedBy).toBeTruthy();
        expect(grid.absences).toEqual([
          { studentId: s.ahmedov, date: '2026-10-12', category: 'illness' },
          { studentId: s.boboyev, date: '2026-10-19', category: 'illness' },
        ]);
        expect(JSON.stringify(response.body)).not.toContain('A note for the Tutor');
      });
      // The Academic Vice Principal reads every lesson and enters none of them (should-fix 5).
      const vice = await account();
      await as(vice, [{ role: 'academic_vice_principal', branchId: s.branch }], async ({ get }) => {
        const grid = gridOf(await get(s.branch, `/api/journal/journals/${journal}`));
        expect(grid.lessons.map((lesson) => lesson.canEnter)).toEqual([false, false, false]);
      });
      // A substitute: the lesson of the 19th only, and the reasons of its date only.
      await as(substitute, [{ role: 'teacher', branchId: s.branch }], async ({ get }) => {
        const grid = gridOf(await get(s.branch, `/api/journal/journals/${journal}`));
        expect(grid.lessons.map((lesson) => [lesson.id, lesson.canEnter])).toEqual([
          [s.second, true],
        ]);
        expect(grid.absences).toEqual([
          { studentId: s.boboyev, date: '2026-10-19', category: 'illness' },
        ]);
      });
      const head = await account();
      await as(
        head,
        [{ role: 'head_teacher', branchId: s.branch, subjectIds: [s.subject] }],
        async ({ get }) => {
          const grid = gridOf(await get(s.branch, `/api/journal/journals/${journal}`));
          expect(grid.lessons.every((lesson) => !lesson.canEnter)).toBe(true);
        },
      );
    });
  });
});
