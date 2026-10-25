import { randomUUID } from 'node:crypto';
import {
  REQUEST_KEY_HEADER,
  attendanceSavedSchema,
  journalGridSchema,
  journalSupportSchema,
  type JournalSupport,
  type SupportLine,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '../../database/transactions.js';
import { setEditDays } from '../../testing/branch-filter-sql.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { SaveRefusals } from './save-refusals.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): string =>
  (response.body as { error?: { code?: string } }).error?.code ?? `status ${response.status}`;

// All names are invented. Task 8.9, pull request #227: the refusals of saves and the support
// view of one student, journal and date (docs/spec/edge-cases/journal.md, "My grade
// disappeared": "History records who changed a value and how (teacher, late entry,
// correction, exemption, transfer, cancellation, 'not held', offline entry), and also what hid
// it. A support view for one student, journal and date shows every save, every refusal and
// every such event in order, with how the result was calculated").
describe('the support view', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Gulnora', `Nazarova${'a'.repeat(names % 7)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };

  const give = async (browser: Browser, roles: readonly Omit<Held, 'validFrom'>[]) => {
    for (const held of roles) {
      await t.kit.giveRole(browser.account.id, {
        ...held,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
    }
  };

  const at = async (browser: Browser, moment: string) => {
    t.clock.set(moment);
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
      .where('account_id', '=', browser.account.id)
      .execute();
  };

  const post = (browser: Browser, branch: string, path: string, body: object) =>
    t.post(path, branch, body, browser.cookie).set(REQUEST_KEY_HEADER, randomUUID());

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

  /** Writes as the migrator with the moment the triggers read. */
  const atMoment = <T>(moment: string, work: (transaction: Transaction) => Promise<T>) =>
    t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${moment}, true)`.execute(transaction);
      return work(transaction);
    });

  async function scene(teacher: string) {
    const s = await publishedScene(t, load, { graded: true, accounts: { teacher } });
    // The 12th locks at 23:59 on the 19th (07: "A teacher can change a lesson for 7 days").
    await setEditDays(t.database.migrator, s.branch, 7);
    const lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    const [first, second, third] = lessons;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('The scene has three lessons in October.');
    }
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .executeTakeFirstOrThrow()
    ).id;
    return {
      ...s,
      journal,
      first,
      second,
      third,
      ahmedov: await student(s.branch, s.classId, 'Ahmedov'),
      boboyev: await student(s.branch, s.classId, 'Boboyev'),
    };
  }

  const refusalsOf = (studentId: string) =>
    t.database.migrator
      .selectFrom('journal_save_refusals')
      .selectAll()
      .where('student_id', '=', studentId)
      .orderBy('refused_at')
      .execute();

  const supportOf = async (
    browser: Browser,
    branch: string,
    query: { studentId: string; journalId: string; date: string },
  ): Promise<JournalSupport> => {
    const answer = await t.get(
      `/api/journal/support?studentId=${query.studentId}&journalId=${query.journalId}&date=${query.date}`,
      branch,
      browser.cookie,
    );
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return journalSupportSchema.parse(answer.body);
  };

  const ofKind = <Kind extends SupportLine['kind']>(view: JournalSupport, kind: Kind) =>
    view.lines.filter((line): line is Extract<SupportLine, { kind: Kind }> => line.kind === kind);

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterEach(() => {
    t.clock.set(START);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('records a refused save', () => {
    it('one row per student, in a transaction of its own, with the code; the cells stay as they were', async () => {
      const owner = await account();
      const s = await scene(owner.account.id);
      await give(owner, [{ role: 'teacher', branchId: s.branch }]);
      await at(owner, MOMENT);
      const saved = attendanceSavedSchema.parse(
        (
          await post(owner, s.branch, `/api/journal/lessons/${s.third}/attendance`, {
            saves: [{ studentId: s.ahmedov, mark: 1, version: null }],
          })
        ).body,
      );
      expect(saved.cells[0]?.version).toBe(1);
      // A stale save: the version it was typed on is gone.
      const stale = await post(owner, s.branch, `/api/journal/lessons/${s.third}/attendance`, {
        saves: [
          { studentId: s.ahmedov, mark: 0, version: null },
          { studentId: s.boboyev, mark: 2, version: null },
        ],
      });
      expect(stale.status).toBe(409);
      // A locked lesson: the 12th locked at 23:59 on the 19th.
      const locked = await post(owner, s.branch, `/api/journal/lessons/${s.first}/attendance`, {
        saves: [{ studentId: s.boboyev, mark: 1, version: null }],
      });
      expect(codeOf(locked)).toBe('journal_locked');
      const ahmedov = await refusalsOf(s.ahmedov);
      expect(ahmedov.map((one) => [one.lesson_id, one.kind, one.value_sent, one.code])).toEqual([
        [s.third, 'attendance', 0, codeOf(stale)],
      ]);
      expect(ahmedov[0]).toMatchObject({
        account_id: owner.account.id,
        journal_id: s.journal,
        version_sent: null,
      });
      expect(ahmedov[0]?.refused_at.toISOString()).toBe(new Date(MOMENT).toISOString());
      const boboyev = await refusalsOf(s.boboyev);
      expect(boboyev.map((one) => [one.lesson_id, one.code])).toEqual([
        [s.third, codeOf(stale)],
        [s.first, 'journal_locked'],
      ]);
      // The refused saves changed no cell.
      const cells = await t.database.migrator
        .selectFrom('journal_cells')
        .select(['student_id', 'mark'])
        .where('lesson_id', 'in', [s.first, s.third])
        .execute();
      expect(cells).toEqual([{ student_id: s.ahmedov, mark: 1 }]);
    });

    it('writes nothing for an unknown lesson, another branch, a student of no branch of the reader, or a save that passes', async () => {
      const owner = await account();
      const s = await scene(owner.account.id);
      const elsewhere = await scene((await account()).account.id);
      await give(owner, [{ role: 'teacher', branchId: s.branch }]);
      await at(owner, MOMENT);
      const before = await t.database.migrator
        .selectFrom('journal_save_refusals')
        .select('id')
        .execute();
      expect(
        codeOf(
          await post(owner, s.branch, `/api/journal/lessons/${randomUUID()}/attendance`, {
            saves: [{ studentId: s.ahmedov, mark: 1, version: null }],
          }),
        ),
      ).toBe('not_found');
      expect(
        codeOf(
          await post(owner, s.branch, `/api/journal/lessons/${elsewhere.third}/attendance`, {
            saves: [{ studentId: elsewhere.ahmedov, mark: 1, version: null }],
          }),
        ),
      ).toBe('not_found');
      expect(
        (
          await post(owner, s.branch, `/api/journal/lessons/${s.third}/attendance`, {
            saves: [{ studentId: s.ahmedov, mark: 1, version: null }],
          })
        ).status,
      ).toBe(200);
      const after = await t.database.migrator
        .selectFrom('journal_save_refusals')
        .select('id')
        .execute();
      expect(after).toHaveLength(before.length);
    });

    it('records a refused number and a refused rating entry, and a failure to record changes no answer', async () => {
      const owner = await account();
      const s = await scene(owner.account.id);
      await give(owner, [{ role: 'teacher', branchId: s.branch }]);
      const work = (
        await t.database.migrator
          .insertInto('journal_works')
          .values({ branch_id: s.branch, lesson_id: s.first, kind: 'classwork', total: 20 })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await at(owner, MOMENT);
      const number = await post(owner, s.branch, `/api/journal/lessons/${s.first}/scores`, {
        saves: [{ studentId: s.ahmedov, column: { workId: work }, score: 15, version: null }],
      });
      expect(codeOf(number)).toBe('journal_locked');
      const quarter = (
        await t.database.migrator
          .selectFrom('quarters')
          .select('id')
          .where('academic_year_id', '=', s.year)
          .where('number', '=', 1)
          .executeTakeFirstOrThrow()
      ).id;
      const rating = await post(
        owner,
        s.branch,
        `/api/journal/journals/${s.journal}/rating/${quarter}/entries`,
        { studentId: s.ahmedov, entry: { kind: 'score', score: 77 }, reason: null, version: null },
      );
      expect(rating.status).toBeGreaterThanOrEqual(400);
      const rows = await refusalsOf(s.ahmedov);
      expect(rows.map((one) => [one.kind, one.work_id, one.value_sent, one.quarter_id])).toEqual([
        ['score', work, 15, null],
        ['rating', null, 77, quarter],
      ]);
      expect(rows[1]).toMatchObject({ entry_kind: 'score', lesson_id: null, code: codeOf(rating) });
      // A recorder that fails is logged; the refusal is answered as it came.
      // `record` is private: the test reaches it as the object it is at run time.
      const recorder = t.app.get<unknown, { record: (...args: unknown[]) => Promise<void> }>(
        SaveRefusals,
      );
      const original = recorder.record.bind(recorder);
      recorder.record = () => Promise.reject(new Error('The database is away.'));
      try {
        const again = await post(owner, s.branch, `/api/journal/lessons/${s.first}/scores`, {
          saves: [{ studentId: s.ahmedov, column: { workId: work }, score: 16, version: null }],
        });
        expect(codeOf(again)).toBe('journal_locked');
      } finally {
        recorder.record = original;
      }
      expect(await refusalsOf(s.ahmedov)).toHaveLength(2);
    });
  });

  describe('of a student, journal and date', () => {
    it("lists every save, refusal, correction, offline entry, undo, clear and give-back in time order, with the grid's figures, and writes one audit entry", async () => {
      const owner = await account();
      const vice = await account();
      const s = await scene(owner.account.id);
      await give(owner, [{ role: 'teacher', branchId: s.branch }]);
      await give(vice, [{ role: 'academic_vice_principal', branchId: s.branch }]);
      // The 26th: an entry, a refused stale save, an undo of the person's own last action.
      await at(owner, '2026-10-26T09:00:00+05:00');
      const typed = attendanceSavedSchema.parse(
        (
          await post(owner, s.branch, `/api/journal/lessons/${s.third}/attendance`, {
            saves: [{ studentId: s.ahmedov, mark: 2, version: null }],
          })
        ).body,
      );
      await at(owner, '2026-10-26T09:01:00+05:00');
      expect(
        (
          await post(owner, s.branch, `/api/journal/lessons/${s.third}/attendance`, {
            saves: [{ studentId: s.ahmedov, mark: 0, version: null }],
          })
        ).status,
      ).toBe(409);
      await at(owner, '2026-10-26T09:02:00+05:00');
      const undone = await post(owner, s.branch, `/api/journal/lessons/${s.third}/undo`, {
        students: [
          {
            studentId: s.ahmedov,
            cells: [{ workId: null, version: typed.cells[0]?.version ?? 1 }],
          },
        ],
      });
      expect(undone.status, JSON.stringify(undone.body)).toBe(200);
      // An offline entry (`changed_how` of 0108), written as the writer writes it.
      await atMoment('2026-10-26T09:03:00+05:00', (transaction) =>
        transaction
          .updateTable('journal_cells')
          .set({ mark: 1, changed_how: 'offline_entry', changed_by: owner.account.id })
          .where('lesson_id', '=', s.third)
          .where('student_id', '=', s.ahmedov)
          .execute(),
      );
      // A correction by the Academic Vice Principal, with a reason.
      await at(vice, '2026-10-27T10:00:00+05:00');
      const cell = await t.database.migrator
        .selectFrom('journal_cells')
        .select('version')
        .where('lesson_id', '=', s.third)
        .where('student_id', '=', s.ahmedov)
        .executeTakeFirstOrThrow();
      const corrected = await post(vice, s.branch, `/api/journal/lessons/${s.third}/attendance`, {
        saves: [{ studentId: s.ahmedov, mark: 3, version: cell.version }],
        correction: { reason: 'Seen in the corridor' },
      });
      expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
      // A refusal on another date of the journal is not this date's.
      await at(owner, MOMENT);
      expect(
        (
          await post(owner, s.branch, `/api/journal/lessons/${s.first}/attendance`, {
            saves: [{ studentId: s.ahmedov, mark: 1, version: null }],
          })
        ).status,
      ).toBe(409);
      await at(vice, MOMENT);
      const view = await supportOf(vice, s.branch, {
        studentId: s.ahmedov,
        journalId: s.journal,
        date: '2026-10-26',
      });
      expect(view.lessons.map((one) => one.lesson.id)).toEqual([s.third]);
      const cells = ofKind(view, 'cell');
      expect(cells.map((one) => [one.how, one.before, one.after])).toEqual([
        ['entry', null, 2],
        ['undo', 2, null],
        ['offline_entry', null, 1],
        ['correction', 1, 3],
      ]);
      expect(cells[3]?.reason).toBe('Seen in the corridor');
      expect(cells[3]?.by.accountId).toBe(vice.account.id);
      const refusals = ofKind(view, 'refusal');
      expect(refusals).toHaveLength(1);
      expect(refusals[0]).toMatchObject({ lessonId: s.third, valueSent: 0, field: 'attendance' });
      // In time order: the refusal between the entry and the undo.
      expect(view.lines.slice(0, 3).map((line) => line.kind)).toEqual(['cell', 'refusal', 'cell']);
      // "with how the result was calculated": the grid's figures, from packages/calc.
      const grid = journalGridSchema.parse(
        (await t.get(`/api/journal/journals/${s.journal}`, s.branch, vice.cookie)).body,
      );
      const row = grid.students.find((one) => one.id === s.ahmedov);
      expect(view.figures).toEqual(row?.quarter);
      expect(view.lessons[0]?.cell).toEqual(
        row?.cells[grid.lessons.findIndex((one) => one.id === s.third)],
      );
      expect(view.lessons[0]?.stored.mark).toBe(3);
      expect(view.legend).toEqual(grid.legend);
      const entries = await t.entries('journal.support_view', s.journal);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actor_id: vice.account.id,
        details: { studentId: s.ahmedov, date: '2026-10-26' },
      });
    });

    it('shows what hid a value: a clear by an exemption and its give-back, a mark the exemption hides, and a void with its give-back', async () => {
      const owner = await account();
      const vice = await account();
      const s = await scene(owner.account.id);
      await give(vice, [{ role: 'academic_vice_principal', branchId: s.branch }]);
      // Present on the 19th, absent on the 26th, typed by the teacher's account.
      for (const [lesson, studentId, mark, moment] of [
        [s.second, s.ahmedov, 1, '2026-10-19T09:00:00+05:00'],
        [s.third, s.boboyev, 0, '2026-10-26T09:00:00+05:00'],
      ] as const) {
        await atMoment(moment, (transaction) =>
          transaction
            .insertInto('journal_cells')
            .values({
              branch_id: s.branch,
              lesson_id: lesson,
              student_id: studentId,
              mark,
              version: 1,
              changed_by: owner.account.id,
              changed_how: 'entry',
              changed_at: new Date(0),
            })
            .execute(),
        );
      }
      await at(vice, MOMENT);
      const exemption = (from: string, until: string, studentId: string, lesson: string) =>
        post(vice, s.branch, '/api/exemptions', {
          studentIds: [studentId],
          kind: 'temporary',
          subjectIds: null,
          startDate: from,
          endDate: until,
          slots: null,
          category: 'illness',
          detail: 'A certificate from the clinic',
          choices:
            studentId === s.ahmedov ? [{ studentId, lessonId: lesson, choice: 'exempt' }] : [],
        });
      const cleared = await exemption('2026-10-19', '2026-10-19', s.ahmedov, s.second);
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
      const created = cleared.body as { exemptions: { id: string; version: number }[] };
      const hidden = await exemption('2026-10-26', '2026-10-26', s.boboyev, s.third);
      expect(hidden.status, JSON.stringify(hidden.body)).toBe(200);
      t.clock.set('2026-10-27T12:30:00+05:00');
      await at(vice, '2026-10-27T12:30:00+05:00');
      const voided = await post(
        vice,
        s.branch,
        `/api/exemptions/${created.exemptions[0]?.id ?? ''}/void`,
        {
          reason: 'Entered for the wrong student',
          version: created.exemptions[0]?.version ?? 1,
        },
      );
      expect(voided.status, JSON.stringify(voided.body)).toBe(200);
      const clear = ofKind(
        await supportOf(vice, s.branch, {
          studentId: s.ahmedov,
          journalId: s.journal,
          date: '2026-10-19',
        }),
        'exemption_clear',
      );
      expect(clear.map((one) => [one.lessonId, one.value, one.exemption.kind])).toEqual([
        [s.second, 1, 'temporary'],
      ]);
      const back = ofKind(
        await supportOf(vice, s.branch, {
          studentId: s.ahmedov,
          journalId: s.journal,
          date: '2026-10-19',
        }),
        'exemption_give_back',
      );
      expect(back.map((one) => [one.lessonId, one.value, one.at])).toEqual([
        [s.second, 1, new Date('2026-10-27T12:30:00+05:00').toISOString()],
      ]);
      // The 0 typed on the 26th, stored and hidden by the exemption: "also what hid it".
      const boboyev = await supportOf(vice, s.branch, {
        studentId: s.boboyev,
        journalId: s.journal,
        date: '2026-10-26',
      });
      const lesson = boboyev.lessons[0];
      expect(lesson?.cell.exempt).toBe('temporary');
      expect(lesson?.cell.mark).toBeNull();
      expect(lesson?.stored.mark).toBe(0);
      expect(lesson?.hiddenBy).toEqual({
        kind: 'temporary',
        startDate: '2026-10-26',
        endDate: '2026-10-26',
      });
      // A void of a leaving and its give-back (journal_voids, 0127).
      const cell = await t.database.migrator
        .selectFrom('journal_cells')
        .select(['id', 'version'])
        .where('lesson_id', '=', s.second)
        .where('student_id', '=', s.ahmedov)
        .executeTakeFirstOrThrow();
      const status = await t.database.migrator
        .selectFrom('student_statuses')
        .select('id')
        .where('student_id', '=', s.ahmedov)
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('journal_voids')
        .values({
          branch_id: s.branch,
          student_id: s.ahmedov,
          leaving_id: status.id,
          cell_id: cell.id,
          mark: 1,
          version: cell.version,
          reason: 'Left for another school',
          voided_by: vice.account.id,
          voided_at: new Date('2026-10-27T12:40:00+05:00'),
          given_back_at: new Date('2026-10-27T12:50:00+05:00'),
          given_back_by: vice.account.id,
        })
        .execute();
      const view = await supportOf(vice, s.branch, {
        studentId: s.ahmedov,
        journalId: s.journal,
        date: '2026-10-19',
      });
      expect(
        ofKind(view, 'void').map((one) => [one.source, one.reason, one.value, one.lessonId]),
      ).toEqual([['leaving', 'Left for another school', 1, s.second]]);
      expect(ofKind(view, 'void_give_back').map((one) => one.at)).toEqual([
        new Date('2026-10-27T12:50:00+05:00').toISOString(),
      ]);
      const times = view.lines.map((line) => line.at);
      expect([...times].sort()).toEqual(times);
    });

    it('lists a total and "not held" of the date\'s works, and refuses another branch\'s journal, a student with no membership and a date outside the year', async () => {
      const owner = await account();
      const vice = await account();
      const s = await scene(owner.account.id);
      const elsewhere = await scene((await account()).account.id);
      await give(vice, [{ role: 'academic_vice_principal', branchId: s.branch }]);
      // A work added by hand, its total set, then marked "not held", through the routes.
      await give(owner, [{ role: 'teacher', branchId: s.branch }]);
      await at(owner, '2026-10-26T09:00:00+05:00');
      const added = await post(owner, s.branch, `/api/journal/lessons/${s.third}/works`, {
        kind: 'classwork',
      });
      expect(added.status, JSON.stringify(added.body)).toBe(200);
      const work = added.body as { id: string; version: number };
      await at(owner, '2026-10-26T09:01:00+05:00');
      const total = await t.put(
        `/api/journal/lessons/${s.third}/works/total`,
        s.branch,
        { column: { workId: work.id }, total: 25, version: work.version },
        owner.cookie,
      );
      expect(total.status, JSON.stringify(total.body)).toBe(200);
      await at(owner, '2026-10-26T09:02:00+05:00');
      const notHeld = await t.put(
        `/api/journal/lessons/${s.third}/works/not-held`,
        s.branch,
        {
          column: { workId: work.id },
          notHeld: true,
          version: (total.body as { version: number }).version,
        },
        owner.cookie,
      );
      expect(notHeld.status, JSON.stringify(notHeld.body)).toBe(200);
      await at(vice, MOMENT);
      const view = await supportOf(vice, s.branch, {
        studentId: s.ahmedov,
        journalId: s.journal,
        date: '2026-10-26',
      });
      const lines = ofKind(view, 'work');
      expect(lines.every((one) => one.work.id === work.id)).toBe(true);
      expect(lines.map((one) => [one.totalAfter, one.notHeldAfter]).slice(-2)).toEqual([
        [25, false],
        [25, true],
      ]);
      const refused = (query: string) =>
        t.get(`/api/journal/support?${query}`, s.branch, vice.cookie).then(codeOf);
      expect(
        await refused(`studentId=${s.ahmedov}&journalId=${elsewhere.journal}&date=2026-10-26`),
      ).toBe('not_found');
      expect(
        await refused(`studentId=${elsewhere.ahmedov}&journalId=${s.journal}&date=2026-10-26`),
      ).toBe('not_found');
      expect(
        await refused(`studentId=${randomUUID()}&journalId=${s.journal}&date=2026-10-26`),
      ).toBe('not_found');
      expect(await refused(`studentId=${s.ahmedov}&journalId=${s.journal}&date=2026-11-02`)).toBe(
        'journal_no_quarter',
      );
      expect(await t.entries('journal.support_view', s.journal)).toHaveLength(1);
    });
  });
});
