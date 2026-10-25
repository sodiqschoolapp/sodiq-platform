import { recalculateAndCompare, storedQuarterOutcome } from '@sodiq/calc';
import {
  CLOSING_WARNINGS,
  closingChecklistSchema,
  closingClosedSchema,
  journalGridSchema,
  REQUEST_KEY_HEADER,
  studentResultsSchema,
  type ClosingChecklist,
  type ClosingItem,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ActingKit } from '../../testing/acting-kit.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit, type MemberRow } from '../../testing/members-kit.js';
import { publishedScene, QUARTERS, type PublishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { binary } from '../../testing/xlsx-kit.js';
import { saveCells } from '../journal/cells.js';
import { quarterGrades, quarterRefOf } from './grade-changes.js';

/** Tuesday 27 October 2026, noon in Tashkent: the checklist of quarter 1 (to 31 October) is open. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const codeOf = (response: Response): unknown =>
  (response.body as { error?: { code?: string } }).error?.code;

const checklistOf = (response: Response): ClosingChecklist => {
  expect(response.status, JSON.stringify(response.body).slice(0, 800)).toBe(200);
  return closingChecklistSchema.parse(response.body);
};

type Kind = ClosingItem['kind'];

const itemsOf = <K extends Kind>(
  list: ClosingChecklist,
  kind: K,
  journalId?: string,
): Extract<ClosingItem, { kind: K }>[] =>
  list.items.filter(
    (item): item is Extract<ClosingItem, { kind: K }> =>
      item.kind === kind && (journalId === undefined || item.journal?.id === journalId),
  );

const studentIdsOf = (items: readonly { students: readonly unknown[] }[]): string[] =>
  items
    .flatMap((item) =>
      item.students.map((one) =>
        typeof one === 'object' && one !== null && 'student' in one
          ? (one as { student: { id: string } }).student.id
          : (one as { id: string }).id,
      ),
    )
    .sort();

// All names are invented. Task 9.2a: the closing checklist (docs/spec/07-journal.md, Closing a
// quarter and Exemptions, Effect on totals; docs/spec/edge-cases/journal.md, Closing and
// reopening; docs/spec/edge-cases/calculation.md; the From lines of 4.3, 5.7a-3c, 7.2, 8.2, 8.4,
// 8.5, 8.6 and 8.8; the review's decisions and corrections).
describe('the closing checklist (07, Closing a quarter)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Nodira', `Saidova${'a'.repeat(names % 5)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };

  interface Calls {
    get: (branch: string, path: string) => Promise<Response>;
    put: (branch: string, path: string, body: object) => Promise<Response>;
    post: (branch: string, path: string, body?: object, key?: string) => Promise<Response>;
  }

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
        put: (branch, path, body) => t.put(path, branch, body, browser.cookie),
        post: (branch, path, body = {}, key) => {
          const call = t.post(path, branch, body, browser.cookie);
          return key === undefined ? call : call.set(REQUEST_KEY_HEADER, key);
        },
      });
    } finally {
      t.clock.set(START);
    }
  }

  /** The Academic Vice Principal of the branch, a fresh account. */
  const vice = async <T>(branch: string, work: (calls: Calls) => Promise<T>, moment = MOMENT) =>
    as(await account(), [{ role: 'academic_vice_principal', branchId: branch }], work, moment);

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

  const student = async (
    branch: string,
    name: { first: string; last: string },
    rows: readonly Omit<MemberRow, 'branch' | 'studentId'>[],
    leavesOn?: string,
  ): Promise<string> => {
    const kit = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await kit.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: name.first, last_name: name.last })
      .where('id', '=', id)
      .execute();
    // A leaving written as the service writes it (leaving-results.test.ts).
    const leavingId =
      leavesOn === undefined ? null : await kit.leaving(t.database.migrator, branch, id, leavesOn);
    for (const row of rows) {
      await kit.member({
        branch,
        studentId: id,
        ...row,
        ...(leavingId === null ? {} : { endedBy: 'leaving' as const, leavingId }),
      });
    }
    return id;
  };

  const lessonsOf = async (classId: string) =>
    (
      await t.database.migrator
        .selectFrom('lessons')
        .select([
          'id',
          sql<string>`lesson_date::text`.as('date'),
          sql<string>`to_char(starts_at at time zone 'Asia/Tashkent', 'HH24:MI')`.as('start'),
          sql<string>`to_char(ends_at at time zone 'Asia/Tashkent', 'HH24:MI')`.as('end'),
        ])
        .where('class_id', '=', classId)
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute()
    ).map((one) => ({ id: one.id, date: one.date, start: one.start, end: one.end }));

  const quarterOf = async (year: string, number: number) =>
    (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', year)
        .where('number', '=', number)
        .executeTakeFirstOrThrow()
    ).id;

  const journalOf = async (classId: string, subject: string) =>
    (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', classId)
        .where('subject_id', '=', subject)
        .executeTakeFirstOrThrow()
    ).id;

  const work = async (branch: string, lessonId: string, total = 10) =>
    (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: branch, lesson_id: lessonId, kind: 'classwork', total })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /** An all-subjects exemption written as the application writes it (8.5's table). */
  const exempt = async (
    scene: PublishedScene,
    studentId: string,
    from: string,
    until: string,
    times: readonly [string, string] | null = null,
    subject: string | null = null,
  ) => {
    const writer = await load.classes.account();
    await t.app.get(Transactions).run([scene.branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: scene.branch,
        actorId: writer,
        action: 'exemption.create',
      });
      const made = await transaction
        .insertInto('exemptions')
        .values({
          branch_id: scene.branch,
          student_id: studentId,
          year_id: scene.year,
          batch_id: '019a0000-0000-7000-8000-0000000000a1',
          kind: 'temporary',
          all_subjects: subject === null,
          start_date: from,
          end_date: until,
          start_time: times?.[0] ?? null,
          end_time: times?.[1] ?? null,
          category: 'illness',
          detail: 'A certificate from the clinic',
          granted_by: writer,
          granted_at: new Date(0),
          version: 0,
          changed_at: new Date(0),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (subject !== null) {
        await transaction
          .insertInto('exemption_subjects')
          .values({ branch_id: scene.branch, exemption_id: made.id, subject_id: subject })
          .execute();
      }
    });
  };

  /**
   * The graded maths scene (20 · 40 · 40, Mondays 12, 19 and 26 October): Aziz present on the
   * 12th with a classwork 9 of 10 and absent on the 19th; Bek present on the 12th and the
   * 19th with no number (attendance only); Dilshod with nothing; Zafar exempt all quarter; Lola
   * present on the 12th, who left the school on the 20th.
   */
  async function base(accounts?: { readonly teacher?: string }) {
    const s = await publishedScene(t, load, {
      graded: true,
      ...(accounts === undefined ? {} : { accounts }),
    });
    const [l12, l19, l26] = await lessonsOf(s.classId);
    if (l12 === undefined || l19 === undefined || l26 === undefined) {
      throw new Error('Three lessons.');
    }
    const whole = [{ classId: s.classId, from: '2026-09-01' }];
    const aziz = await student(s.branch, { first: 'Aziz', last: 'Karimov' }, whole);
    const bek = await student(s.branch, { first: 'Bek', last: 'Toshev' }, whole);
    const dilshod = await student(s.branch, { first: 'Dilshod', last: 'Ergashev' }, whole);
    const zafar = await student(s.branch, { first: 'Zafar', last: 'Nazarov' }, whole);
    const lola = await student(
      s.branch,
      { first: 'Lola', last: 'Rahimova' },
      [{ classId: s.classId, from: '2026-09-01', until: '2026-10-20' }],
      '2026-10-20',
    );
    await exempt(s, zafar, '2026-09-01', '2026-10-31');
    // Nothing entered, each with an exemption of one day: all subjects, and this subject only.
    const yulduz = await student(s.branch, { first: 'Yulduz', last: 'Sobirova' }, whole);
    const komil = await student(s.branch, { first: 'Komil', last: 'Valiyev' }, whole);
    await exempt(s, yulduz, '2026-10-12', '2026-10-12');
    await exempt(s, komil, '2026-10-19', '2026-10-19', null, s.subject);
    const cw = await work(s.branch, l12.id);
    await saveOn(s.branch, l12.date, [
      { lessonId: l12.id, studentId: aziz, value: 1 },
      { lessonId: l12.id, studentId: aziz, workId: cw, value: 9 },
      { lessonId: l12.id, studentId: bek, value: 1 },
      { lessonId: l12.id, studentId: lola, value: 1 },
    ]);
    await saveOn(s.branch, l19.date, [
      { lessonId: l19.id, studentId: aziz, value: 0 },
      { lessonId: l19.id, studentId: bek, value: 1 },
    ]);
    // The edit period of the scene: 7 days (07: "A teacher can change a lesson for 7 days").
    await t.database.migrator
      .updateTable('branch_edit_days')
      .set({ edit_days: 7 })
      .where('branch_id', '=', s.branch)
      .execute();
    const journal = await journalOf(s.classId, s.subject);
    const q1 = await quarterOf(s.year, 1);
    return {
      s,
      aziz,
      bek,
      dilshod,
      zafar,
      lola,
      yulduz,
      komil,
      journal,
      q1,
      cw,
      lessons: { l12, l19, l26 },
    };
  }

  /** The entries of the closing routes (a role given in a test writes entries of its own). */
  const closingAudit = async () =>
    (
      await t.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('action', 'in', [
          'results.decision_set',
          'results.decision_cleared',
          'plan.periods_ended',
        ])
        .execute()
    ).length;

  /** An approved plan period of a journal, open until 29 October (7.2), written as 0117 stores it. */
  const openPlanPeriod = async (
    branch: string,
    subject: string,
    journal: string,
    quarter: string,
  ) => {
    const decider = await load.classes.account();
    const link = await t.database.migrator
      .selectFrom('lesson_plan_journals')
      .select('plan_id')
      .where('journal_id', '=', journal)
      .where('quarter_id', '=', quarter)
      .executeTakeFirst();
    const plan =
      link?.plan_id ??
      (
        await t.database.migrator
          .insertInto('lesson_plans')
          .values({ branch_id: branch, quarter_id: quarter, subject_id: subject })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    if (link === undefined) {
      await t.database.migrator
        .insertInto('lesson_plan_journals')
        .values({ branch_id: branch, plan_id: plan, journal_id: journal, quarter_id: quarter })
        .execute();
    }
    return (
      await t.database.migrator
        .insertInto('lesson_plan_requests')
        .values({
          branch_id: branch,
          plan_id: plan,
          journal_id: journal,
          quarter_id: quarter,
          kind: 'text',
          status: 'approved',
          prepared_at: new Date('2026-10-26T09:00:00+05:00'),
          updated_at: new Date('2026-10-26T10:00:00+05:00'),
          sent_at: new Date('2026-10-26T09:00:00+05:00'),
          requested_by: decider,
          decided_by: decider,
          decided_at: new Date('2026-10-26T10:00:00+05:00'),
          days: 3,
          open_until: new Date('2026-10-29T00:00:00+05:00'),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  };

  const notificationsOf = (branch: string) =>
    t.database.migrator
      .selectFrom('notifications')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('id')
      .execute();

  const path = (quarterId?: string) =>
    quarterId === undefined
      ? '/api/results/closing'
      : `/api/results/closing?quarterId=${quarterId}`;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  it('lists every item of the scene by its row, and leaves a student at leaving and an "Exempt" result out', async () => {
    const b = await base();
    const list = await vice(b.s.branch, async ({ get }) =>
      checklistOf(await get(b.s.branch, path())),
    );
    expect(list.quarterId).toBe(b.q1);
    expect(list.state).toBe('open');
    expect(list.opensOn).toBe('2026-10-17');
    expect(list.lastDay).toBe('2026-10-31');
    expect(list.canEdit).toBe(true);
    // A result flagged "attendance only" is undecided: blocks closing (edge/calculation).
    const undecided = itemsOf(list, 'undecided', b.journal);
    expect(undecided).toHaveLength(1);
    expect(undecided[0]?.students.map((one) => [one.student.id, one.flags, one.allowed])).toEqual([
      [b.bek, ['attendance_only'], ['keep', 'not_assessed']],
    ]);
    expect(undecided[0]?.teacher?.id).toBe(b.s.teacher.staffId);
    // "Students with no result in a subject and no exemption" (07): Dilshod, not Zafar, whose
    // result is "Exempt" (no lesson remains), and not Lola, who left the school.
    expect(studentIdsOf(itemsOf(list, 'no_result', b.journal))).toEqual([b.dilshod]);
    // `edge/calculation`: "a part has a weight but no data in a whole journal": homework.
    expect(itemsOf(list, 'part_without_data', b.journal).map((one) => one.parts)).toEqual([
      ['homework'],
    ]);
    // edge/journal: the 26th is inside the edit period, incomplete; the 12th and 19th locked.
    expect(
      itemsOf(list, 'edit_period', b.journal).map((one) => [one.lessons, one.incomplete]),
    ).toEqual([[1, 1]]);
    // 07: "Lessons with no attendance": Dilshod's 12th and 19th, the 26th.
    expect(
      itemsOf(list, 'no_attendance', b.journal).flatMap((one) => one.lessons.map((l) => l.date)),
    ).toEqual(['2026-10-12', '2026-10-19', '2026-10-26']);
    // 07: "Planned works with numbers missing": Bek was present on the 12th with no number.
    expect(
      itemsOf(list, 'numbers_missing', b.journal).flatMap((one) => one.lessons.map((l) => l.id)),
    ).toEqual([b.lessons.l12.id]);
    // Lola (at leaving) is on no item at all.
    const everyone = JSON.stringify(list.items);
    expect(everyone).not.toContain(b.lola);
    expect(everyone).not.toContain(b.zafar);
    expect(itemsOf(list, 'rating_missing')).toEqual([]);
    expect(itemsOf(list, 'weights_missing')).toEqual([]);
    // Blocking: the undecided result and the lesson in the edit period, at least.
    expect(list.blocking).toBeGreaterThanOrEqual(2);
    expect(list.closable).toBe(false);
  });

  it('opens two weeks before the last day and is closable only from the last day with no blocking item', async () => {
    const s = await publishedScene(t, load, { graded: true });
    const q1 = await quarterOf(s.year, 1);
    // No student: nothing blocks once the lessons have locked (the 26th locks on 3 November).
    await vice(
      s.branch,
      async ({ get, put }) => {
        const before = checklistOf(await get(s.branch, path(q1)));
        expect([before.state, before.items, before.closable]).toEqual(['not_open', [], false]);
        const refused = await put(s.branch, `/api/results/closing/${q1}/decisions`, {
          subjectId: s.subject,
          studentId: randomUUID(),
          decision: 'keep',
          version: null,
        });
        // An unknown student is told first (the reading before any refusal).
        expect([refused.status, codeOf(refused)]).toEqual([404, 'not_found']);
      },
      '2026-10-16T12:00:00+05:00',
    );
    await vice(
      s.branch,
      async ({ get }) => {
        const opened = checklistOf(await get(s.branch, path(q1)));
        expect(opened.state).toBe('open');
      },
      '2026-10-17T09:00:00+05:00',
    );
    // The edit period of the 26th lesson keeps it blocked on the last day; the plans warn only.
    const lastDay = await vice(
      s.branch,
      async ({ get }) => checklistOf(await get(s.branch, path(q1))),
      '2026-10-30T12:00:00+05:00',
    );
    expect(lastDay.closable).toBe(false);
    // Remove the lessons' edit period: the day before the last day is still not closable, the
    // last day is (`07`: "A quarter cannot be closed before its last day").
    await t.database.migrator
      .updateTable('branch_edit_days')
      .set({ edit_days: 1 })
      .where('branch_id', '=', s.branch)
      .execute();
    const dayBefore = await vice(
      s.branch,
      async ({ get }) => checklistOf(await get(s.branch, path(q1))),
      '2026-10-30T12:00:00+05:00',
    );
    expect(itemsOf(dayBefore, 'edit_period')).toEqual([]);
    expect([dayBefore.blocking, dayBefore.closable]).toEqual([0, false]);
    const onLastDay = await vice(
      s.branch,
      async ({ get }) => checklistOf(await get(s.branch, path(q1))),
      '2026-10-31T12:00:00+05:00',
    );
    expect([onLastDay.blocking, onLastDay.closable]).toEqual([0, true]);
  });

  it('stores a decision that every reader applies: kept, Not assessed out of the averages, Exempt refused', async () => {
    const b = await base();
    const decisions = `/api/results/closing/${b.q1}/decisions`;
    const body = (decision: string | null, version: number | null, studentId = b.bek) => ({
      subjectId: b.s.subject,
      studentId,
      decision,
      version,
    });
    const browser = await account();
    await as(
      browser,
      [{ role: 'academic_vice_principal', branchId: b.s.branch }],
      async (calls) => {
        // Exempt is not offered for "attendance only" (4.3 decision 3): refused, nothing stored.
        const exemptAnswer = await calls.put(b.s.branch, decisions, body('exempt', null));
        expect([exemptAnswer.status, codeOf(exemptAnswer)]).toEqual([
          409,
          'closing_decision_not_allowed',
        ]);
        // Aziz has no flag: nothing to decide.
        const aziz = await calls.put(b.s.branch, decisions, body('keep', null, b.aziz));
        expect([aziz.status, codeOf(aziz)]).toEqual([409, 'closing_not_flagged']);
        // Lola is at leaving: not on the checklist (From 8.6).
        const lola = await calls.put(b.s.branch, decisions, body('keep', null, b.lola));
        expect([lola.status, codeOf(lola)]).toEqual([409, 'closing_not_flagged']);

        const kept = await calls.put(b.s.branch, decisions, body('keep', null));
        expect([kept.status, kept.body]).toEqual([200, { decision: 'keep', version: 1 }]);
        const grid = journalGridSchema.parse(
          (await calls.get(b.s.branch, `/api/journal/journals/${b.journal}?quarterId=${b.q1}`))
            .body,
        );
        const bekRow = grid.students.find((one) => one.id === b.bek);
        expect(bekRow?.quarter?.result).toMatchObject({ kind: 'number', kept: true });
        const keptList = checklistOf(await calls.get(b.s.branch, path(b.q1)));
        expect(itemsOf(keptList, 'undecided')).toEqual([]);

        // An old version is refused, the stored decision kept.
        const stale = await calls.put(b.s.branch, decisions, body('not_assessed', null));
        expect([stale.status, codeOf(stale)]).toEqual([409, 'closing_decision_changed']);

        const notAssessed = await calls.put(b.s.branch, decisions, body('not_assessed', 1));
        expect([notAssessed.status, notAssessed.body]).toEqual([
          200,
          { decision: 'not_assessed', version: 2 },
        ]);
        const after = journalGridSchema.parse(
          (await calls.get(b.s.branch, `/api/journal/journals/${b.journal}?quarterId=${b.q1}`))
            .body,
        );
        expect(after.students.find((one) => one.id === b.bek)?.quarter?.result).toEqual({
          kind: 'not_assessed',
        });
        // Only a number is averaged: the bottom row's result is Aziz's alone.
        const azizResult = after.students.find((one) => one.id === b.aziz)?.quarter?.result;
        expect(azizResult?.kind).toBe('number');
        expect(after.bottom?.quarter.result).toBe(
          azizResult?.kind === 'number' ? azizResult.shown : -1,
        );
        // The student results show the same state.
        const results = studentResultsSchema.parse(
          (await calls.get(b.s.branch, `/api/results/students/${b.bek}`)).body,
        );
        expect(results.subjects[0]?.quarters[0]?.outcome).toEqual({ kind: 'not_assessed' });
        // The grade preview of a weights change (9.1) counts the same state.
        t.clock.set(MOMENT);
        const grades = await t.app.get(Transactions).run([b.s.branch], async (transaction) => {
          const quarter = await quarterRefOf(transaction, b.q1);
          if (quarter === undefined) throw new Error('A dated quarter.');
          return quarterGrades(transaction, {
            branchId: b.s.branch,
            timeZone: 'Asia/Tashkent',
            now: new Date(MOMENT),
            quarter,
            subjectIds: [b.s.subject],
          });
        });
        expect(grades.states.get(b.journal)?.get(b.bek)).toEqual({
          grade: 'not_assessed',
          result: 'not_assessed',
        });
      },
    );
    // The audit log holds both decisions, with the assignment and the old value.
    const entries = await t.entries('results.decision_set');
    const own = entries.filter(
      (entry) => (entry.new_value as { studentId?: string } | null)?.studentId === b.bek,
    );
    expect(
      own.map((entry) => [entry.old_value, (entry.new_value as { decision: string }).decision]),
    ).toEqual([
      [{ decision: null }, 'keep'],
      [{ decision: 'keep' }, 'not_assessed'],
    ]);
    expect(own.every((entry) => entry.assignment_id !== null && entry.request_id !== null)).toBe(
      true,
    );
  });

  it('shows a decision the data no longer allows as outdated, and clears it for a whole journal', async () => {
    const b = await base();
    await vice(b.s.branch, async ({ put }) => {
      const set = await put(b.s.branch, `/api/results/closing/${b.q1}/decisions`, {
        subjectId: b.s.subject,
        studentId: b.bek,
        decision: 'not_assessed',
        version: null,
      });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
    });
    // A number arrives for Bek: no flag any more, the stored decision is not applied.
    await saveOn(b.s.branch, b.lessons.l12.date, [
      { lessonId: b.lessons.l12.id, studentId: b.bek, workId: b.cw, value: 7 },
    ]);
    await vice(b.s.branch, async ({ get, post, put }) => {
      const list = checklistOf(await get(b.s.branch, path(b.q1)));
      const outdated = itemsOf(list, 'decision_outdated', b.journal);
      expect(
        outdated.flatMap((one) => one.students.map((s) => [s.student.id, s.decision])),
      ).toEqual([[b.bek, 'not_assessed']]);
      const grid = journalGridSchema.parse(
        (await get(b.s.branch, `/api/journal/journals/${b.journal}?quarterId=${b.q1}`)).body,
      );
      expect(grid.students.find((one) => one.id === b.bek)?.quarter?.result?.kind).toBe('number');
      // The list was read before the number came: a decision sent now names Bek as no longer
      // flagged, one by one and for the whole journal; nothing is overwritten silently.
      const late = await post(
        b.s.branch,
        `/api/results/closing/${b.q1}/journals/${b.journal}/decisions`,
        { decision: 'keep', students: [b.bek] },
      );
      expect(late.body).toEqual({
        decided: [],
        refused: [{ studentId: b.bek, code: 'closing_not_flagged' }],
      });
      const lateOne = await put(b.s.branch, `/api/results/closing/${b.q1}/decisions`, {
        subjectId: b.s.subject,
        studentId: b.bek,
        decision: 'keep',
        version: 1,
      });
      expect([lateOne.status, codeOf(lateOne)]).toEqual([409, 'closing_not_flagged']);
      // A whole journal: the outdated one cleared, a student not listed is named as refused.
      const cleared = await post(
        b.s.branch,
        `/api/results/closing/${b.q1}/journals/${b.journal}/decisions`,
        { decision: null, students: [b.bek, b.aziz] },
      );
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
      expect(cleared.body).toEqual({
        decided: [b.bek],
        refused: [{ studentId: b.aziz, code: 'closing_not_flagged' }],
      });
      const again = checklistOf(await get(b.s.branch, path(b.q1)));
      expect(itemsOf(again, 'decision_outdated')).toEqual([]);
      // A repeated id is refused by the schema (journal rule: one to one by id).
      const repeated = await post(
        b.s.branch,
        `/api/results/closing/${b.q1}/journals/${b.journal}/decisions`,
        { decision: 'keep', students: [b.bek, b.bek.toUpperCase()] },
      );
      expect([repeated.status, codeOf(repeated)]).toEqual([400, 'validation_failed']);
    });
    const cleared = (await t.entries('results.decision_cleared')).filter(
      (entry) => (entry.new_value as { studentId?: string } | null)?.studentId === b.bek,
    );
    expect(cleared.map((entry) => [entry.old_value, entry.new_value])).toEqual([
      [
        { decision: 'not_assessed' },
        { quarterId: b.q1, subjectId: b.s.subject, studentId: b.bek, decision: null },
      ],
    ]);
  });

  it('matches a whole journal against the row it is sent from: the undecided for a decision, the outdated for a clear', async () => {
    const b = await base();
    // Bek decided "Not assessed", then a number arrives: his decision is outdated.
    await vice(b.s.branch, async ({ put }) => {
      const set = await put(b.s.branch, `/api/results/closing/${b.q1}/decisions`, {
        subjectId: b.s.subject,
        studentId: b.bek,
        decision: 'not_assessed',
        version: null,
      });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
    });
    await saveOn(b.s.branch, b.lessons.l12.date, [
      { lessonId: b.lessons.l12.id, studentId: b.bek, workId: b.cw, value: 7 },
    ]);
    // Ravshan, present twice with no number: undecided (attendance only).
    const ravshan = await student(b.s.branch, { first: 'Ravshan', last: 'Qosimov' }, [
      { classId: b.s.classId, from: '2026-09-01' },
    ]);
    await saveOn(b.s.branch, b.lessons.l12.date, [
      { lessonId: b.lessons.l12.id, studentId: ravshan, value: 1 },
    ]);
    await saveOn(b.s.branch, b.lessons.l19.date, [
      { lessonId: b.lessons.l19.id, studentId: ravshan, value: 1 },
    ]);
    const decisions = `/api/results/closing/${b.q1}/journals/${b.journal}/decisions`;
    await vice(b.s.branch, async ({ get, post }) => {
      const list = checklistOf(await get(b.s.branch, path(b.q1)));
      expect(studentIdsOf(itemsOf(list, 'undecided', b.journal))).toEqual([ravshan]);
      expect(studentIdsOf(itemsOf(list, 'decision_outdated', b.journal))).toEqual([b.bek]);
      // From the undecided row: the outdated one is not named.
      const kept = await post(b.s.branch, decisions, { decision: 'keep', students: [ravshan] });
      expect(kept.body).toEqual({ decided: [ravshan], refused: [] });
      // From the outdated row: the clear.
      const cleared = await post(b.s.branch, decisions, { decision: null, students: [b.bek] });
      expect(cleared.body).toEqual({ decided: [b.bek], refused: [] });
    });
  });

  it('allows "Exempt" only when few lessons is the one flag, and decides a whole journal naming the others', async () => {
    const s = await publishedScene(t, load, { graded: true, double: true });
    const lessons = await lessonsOf(s.classId);
    expect(lessons.map((one) => one.date)).toEqual([
      '2026-10-12',
      '2026-10-12',
      '2026-10-19',
      '2026-10-19',
      '2026-10-26',
      '2026-10-26',
    ]);
    const [, , , , first26, second26] = lessons;
    if (first26 === undefined || second26 === undefined) throw new Error('Six lessons.');
    const cw = await work(s.branch, second26.id);
    const third = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
    const whole = [{ classId: s.classId, from: '2026-09-01' }];
    // Each exempt on the 12th and the 19th and in the first lesson of the 26th: n = 1, e = 5,
    // N = 6: 1 × 3 < 6 raises few lessons, (1 + 5) × 3 ≥ 6 lets "Exempt" explain it.
    const few = await student(s.branch, { first: 'Farrux', last: 'Olimov' }, whole);
    const fewAttendance = await student(s.branch, { first: 'Gulnora', last: 'Sobirova' }, whole);
    const fewLeft = await student(s.branch, { first: 'Hasan', last: 'Qodirov' }, [
      { classId: s.classId, from: '2026-09-01', until: '2026-10-27', ownUntil: '2026-10-27' },
      { classId: third, from: '2026-10-27' },
    ]);
    for (const id of [few, fewAttendance, fewLeft]) {
      await exempt(s, id, '2026-10-12', '2026-10-19');
      await exempt(s, id, '2026-10-26', '2026-10-26', [first26.start, first26.end]);
    }
    await saveOn(s.branch, '2026-10-26', [
      { lessonId: second26.id, studentId: few, value: 1 },
      { lessonId: second26.id, studentId: few, workId: cw, value: 8 },
      { lessonId: second26.id, studentId: fewAttendance, value: 1 },
      { lessonId: second26.id, studentId: fewLeft, value: 1 },
      { lessonId: second26.id, studentId: fewLeft, workId: cw, value: 6 },
    ]);
    const journal = await journalOf(s.classId, s.subject);
    const q1 = await quarterOf(s.year, 1);
    await vice(s.branch, async ({ get, put, post }) => {
      const list = checklistOf(await get(s.branch, path(q1)));
      const flagged = itemsOf(list, 'undecided', journal).flatMap((one) => one.students);
      const byId = new Map(flagged.map((one) => [one.student.id, one]));
      expect(byId.get(few)?.flags).toEqual(['few_lessons']);
      expect(byId.get(few)?.allowed).toEqual(['keep', 'exempt', 'not_assessed']);
      expect(byId.get(fewAttendance)?.flags).toEqual(['few_lessons', 'attendance_only']);
      expect(byId.get(fewAttendance)?.allowed).toEqual(['keep', 'not_assessed']);
      expect(byId.get(fewLeft)?.flags).toEqual(['few_lessons', 'left_subject']);
      expect(byId.get(fewLeft)?.allowed).toEqual(['keep', 'not_assessed']);
      expect(byId.get(few)?.basedOn).toEqual({ expected: 1, held: 6 });

      // One by one: Exempt refused with two flags raised together.
      for (const id of [fewAttendance, fewLeft]) {
        const refused = await put(s.branch, `/api/results/closing/${q1}/decisions`, {
          subjectId: s.subject,
          studentId: id,
          decision: 'exempt',
          version: null,
        });
        expect([refused.status, codeOf(refused)]).toEqual([409, 'closing_decision_not_allowed']);
      }
      // The whole journal: Exempt for the one it fits, the others named.
      const whole = await post(
        s.branch,
        `/api/results/closing/${q1}/journals/${journal}/decisions`,
        {
          decision: 'exempt',
          students: [few, fewAttendance, fewLeft],
        },
      );
      expect(whole.status, JSON.stringify(whole.body)).toBe(200);
      expect(whole.body).toEqual({
        decided: [few],
        refused: [fewAttendance, fewLeft]
          .sort()
          .map((studentId) => ({ studentId, code: 'closing_decision_not_allowed' })),
      });
      // Keep and Not assessed are accepted for the two flags together.
      const keep = await put(s.branch, `/api/results/closing/${q1}/decisions`, {
        subjectId: s.subject,
        studentId: fewAttendance,
        decision: 'keep',
        version: null,
      });
      expect(keep.status, JSON.stringify(keep.body)).toBe(200);
      const notAssessed = await put(s.branch, `/api/results/closing/${q1}/decisions`, {
        subjectId: s.subject,
        studentId: fewLeft,
        decision: 'not_assessed',
        version: null,
      });
      expect(notAssessed.status, JSON.stringify(notAssessed.body)).toBe(200);
      // The grid: "Exempt" for the decided one, and out of the bottom row with Not assessed.
      const grid = journalGridSchema.parse(
        (await get(s.branch, `/api/journal/journals/${journal}?quarterId=${q1}`)).body,
      );
      expect(grid.students.find((one) => one.id === few)?.quarter?.result).toEqual({
        kind: 'exempt',
      });
      const keptRow = grid.students.find((one) => one.id === fewAttendance)?.quarter?.result;
      expect(keptRow).toMatchObject({ kind: 'number', kept: true });
      // fewLeft is no member on the reference date; the bottom row is the kept one's alone.
      expect(grid.bottom?.quarter.result).toBe(keptRow?.kind === 'number' ? keptRow.shown : -1);
      const done = checklistOf(await get(s.branch, path(q1)));
      expect(itemsOf(done, 'undecided')).toEqual([]);
    });
  });

  it('lists a student who moved between journals once, under the latest; a whole journal of the old one does not reach them', async () => {
    const s = await publishedScene(t, load, { graded: true });
    const [l12] = await lessonsOf(s.classId);
    const [, , o26] = await lessonsOf(s.otherClass);
    if (l12 === undefined || o26 === undefined) throw new Error('Lessons.');
    const moved = await student(s.branch, { first: 'Murod', last: 'Aliyev' }, [
      { classId: s.classId, from: '2026-09-01', until: '2026-10-20', ownUntil: '2026-10-20' },
      { classId: s.otherClass, from: '2026-10-20' },
    ]);
    await saveOn(s.branch, l12.date, [{ lessonId: l12.id, studentId: moved, value: 1 }]);
    await saveOn(s.branch, o26.date, [{ lessonId: o26.id, studentId: moved, value: 1 }]);
    const oldJournal = await journalOf(s.classId, s.subject);
    const newJournal = await journalOf(s.otherClass, s.subject);
    const q1 = await quarterOf(s.year, 1);
    await vice(s.branch, async ({ get, post }) => {
      const list = checklistOf(await get(s.branch, path(q1)));
      expect(studentIdsOf(itemsOf(list, 'undecided', newJournal))).toEqual([moved]);
      expect(studentIdsOf(itemsOf(list, 'undecided', oldJournal))).toEqual([]);
      const old = await post(
        s.branch,
        `/api/results/closing/${q1}/journals/${oldJournal}/decisions`,
        {
          decision: 'keep',
          students: [moved],
        },
      );
      expect(old.body).toEqual({
        decided: [],
        refused: [{ studentId: moved, code: 'closing_not_flagged' }],
      });
      const done = await post(
        s.branch,
        `/api/results/closing/${q1}/journals/${newJournal}/decisions`,
        {
          decision: 'keep',
          students: [moved],
        },
      );
      expect(done.body).toEqual({ decided: [moved], refused: [] });
    });
  });

  it('lists the rating entries missing and pending, the unlocks, the extension, the open plan periods and ends them all', async () => {
    const b = await base();
    const { s } = b;
    // The rating exam in quarter 1 (8.2): dated the 26th; Aziz has an entry; Bek is exempt that day.
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
    await exempt(s, b.bek, '2026-10-26', '2026-10-26');
    const writer = await load.classes.account();
    t.clock.set('2026-10-26T18:00:00+05:00');
    try {
      await t.app.get(Transactions).run([s.branch], async (transaction) => {
        await t.app.get(Audit).record(transaction, {
          branchId: s.branch,
          actorId: writer,
          action: 'journal.rating_entry',
        });
        const exam = await transaction
          .insertInto('journal_rating_exams')
          .values({
            branch_id: s.branch,
            journal_id: b.journal,
            quarter_id: b.q1,
            exam_date: '2026-10-26',
            version: 1,
            changed_by: writer,
            changed_at: new Date('2026-10-26T18:00:00+05:00'),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('journal_rating_entries')
          .values({
            branch_id: s.branch,
            rating_exam_id: exam.id,
            student_id: b.aziz,
            kind: 'score',
            score: 77,
            version: 1,
            changed_by: writer,
            changed_how: 'entry',
            changed_at: new Date('2026-10-26T18:00:00+05:00'),
          })
          .execute();
      });
    } finally {
      t.clock.set(START);
    }
    // An approved unlock of the 12th open until 30 October (8.4).
    const deciderAccount = await load.classes.account();
    const teacherAccount = (
      await t.database.migrator
        .selectFrom('staff')
        .select('account_id')
        .where('id', '=', s.teacher.staffId)
        .executeTakeFirstOrThrow()
    ).account_id;
    if (teacherAccount === null) throw new Error('The teacher has an account.');
    const atMoment = async (
      moment: string,
      work: (transaction: Parameters<Parameters<Transactions['run']>[1]>[0]) => Promise<void>,
    ) => {
      t.clock.set(moment);
      try {
        await t.app.get(Transactions).run([s.branch], async (transaction) => {
          await t.app.get(Audit).record(transaction, {
            branchId: s.branch,
            actorId: deciderAccount,
            action: 'journal.unlock_decide',
          });
          await work(transaction);
        });
      } finally {
        t.clock.set(START);
      }
    };
    // Sent by the teacher on the 26th, approved for 3 days: open until 30 October 00:00.
    const unlockId = { id: '' };
    await atMoment('2026-10-26T09:00:00+05:00', async (transaction) => {
      unlockId.id = (
        await transaction
          .insertInto('journal_unlocks')
          .values({
            branch_id: s.branch,
            target: 'lesson',
            lesson_id: b.lessons.l12.id,
            staff_id: s.teacher.staffId,
            requested_by: teacherAccount,
            reason: 'A mark was typed in the wrong row',
            requested_at: new Date(0),
            status: 'sent',
            version: 0,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    });
    await atMoment('2026-10-26T10:00:00+05:00', async (transaction) => {
      await transaction
        .updateTable('journal_unlocks')
        .set({ status: 'approved', days: 3, decided_by: deciderAccount })
        .where('id', '=', unlockId.id)
        .execute();
    });
    // A branch-wide extension made on the 27th (open until 30 October).
    t.clock.set('2026-10-27T09:00:00+05:00');
    try {
      await t.app.get(Transactions).run([s.branch], async (transaction) => {
        await t.app.get(Audit).record(transaction, {
          branchId: s.branch,
          actorId: deciderAccount,
          action: 'journal.edit_extension',
        });
        await transaction
          .insertInto('journal_edit_extensions')
          .values({
            branch_id: s.branch,
            from_date: '2026-10-12',
            to_date: '2026-10-19',
            days: 2,
            open_until: new Date(0),
            reason: 'Internet outage at the school',
            created_by: deciderAccount,
            created_at: new Date(0),
          })
          .execute();
      });
    } finally {
      t.clock.set(START);
    }
    // An approved plan period of the journal open until 29 October (7.2).
    const link = await t.database.migrator
      .selectFrom('lesson_plan_journals')
      .select('plan_id')
      .where('journal_id', '=', b.journal)
      .where('quarter_id', '=', b.q1)
      .executeTakeFirst();
    const plan =
      link?.plan_id ??
      (
        await t.database.migrator
          .insertInto('lesson_plans')
          .values({ branch_id: s.branch, quarter_id: b.q1, subject_id: s.subject })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    if (link === undefined) {
      await t.database.migrator
        .insertInto('lesson_plan_journals')
        .values({ branch_id: s.branch, plan_id: plan, journal_id: b.journal, quarter_id: b.q1 })
        .execute();
    }
    const request = await t.database.migrator
      .insertInto('lesson_plan_requests')
      .values({
        branch_id: s.branch,
        plan_id: plan,
        journal_id: b.journal,
        quarter_id: b.q1,
        kind: 'text',
        status: 'approved',
        prepared_at: new Date('2026-10-26T09:00:00+05:00'),
        updated_at: new Date('2026-10-26T10:00:00+05:00'),
        sent_at: new Date('2026-10-26T09:00:00+05:00'),
        requested_by: deciderAccount,
        decided_by: deciderAccount,
        decided_at: new Date('2026-10-26T10:00:00+05:00'),
        days: 3,
        open_until: new Date('2026-10-29T00:00:00+05:00'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await vice(s.branch, async ({ get, post }) => {
      const list = checklistOf(await get(s.branch, path(b.q1)));
      // 07: "A rating exam entry is missing"; From 8.5: Bek's is pending (exempt that day).
      const rating = itemsOf(list, 'rating_missing', b.journal).flatMap((one) =>
        one.students.map((x) => [x.student.id, x.pending]),
      );
      expect(rating.sort()).toEqual(
        [
          [b.bek, true],
          [b.dilshod, false],
          // Zafar is exempt all quarter, so on the exam day too: pending.
          [b.zafar, true],
          [b.yulduz, false],
          [b.komil, false],
        ].sort(),
      );
      // 07: "A lesson is temporarily unlocked for editing" (the person it covers).
      const unlocked = itemsOf(list, 'unlocked', b.journal);
      expect(
        unlocked.map((one) => [one.teacher?.id, one.lessons.map((l) => l.id), one.rating]),
      ).toEqual([[s.teacher.staffId, [b.lessons.l12.id], false]]);
      expect(itemsOf(list, 'extension_open').map((one) => [one.fromDate, one.toDate])).toEqual([
        ['2026-10-12', '2026-10-19'],
      ]);
      // The extension puts the 12th and 19th back inside the edit period.
      expect(itemsOf(list, 'edit_period', b.journal).map((one) => one.lessons)).toEqual([3]);
      expect(itemsOf(list, 'plan_periods', b.journal).map((one) => one.requests)).toEqual([1]);

      // "End them all" (From 7.2): the period ends at the transaction's moment, audited.
      const ended = await post(s.branch, `/api/results/closing/${b.q1}/plan-periods/end`);
      expect([ended.status, ended.body]).toEqual([200, { ended: 1 }]);
      const again = checklistOf(await get(s.branch, path(b.q1)));
      expect(itemsOf(again, 'plan_periods')).toEqual([]);
    });
    const finished = await t.database.migrator
      .selectFrom('lesson_plan_requests')
      .select('finished_at')
      .where('id', '=', request.id)
      .executeTakeFirstOrThrow();
    expect(finished.finished_at).toEqual(new Date(MOMENT));
    const audited = await t.entries('plan.periods_ended', b.q1);
    expect(audited).toHaveLength(1);
    // Once the unlock's moment passes, the item is gone (a stored moment, no job).
    await vice(
      s.branch,
      async ({ get }) => {
        const later = checklistOf(await get(s.branch, path(b.q1)));
        expect(itemsOf(later, 'unlocked')).toEqual([]);
        expect(itemsOf(later, 'extension_open')).toEqual([]);
      },
      '2026-10-30T12:00:00+05:00',
    );
  });

  it('warns of a graded subject without weights and of a journal with no teacher', async () => {
    const s = await publishedScene(t, load, { graded: true });
    const q1 = await quarterOf(s.year, 1);
    await t.database.migrator
      .deleteFrom('subject_quarter_weights')
      .where('subject_id', '=', s.subject)
      .where('branch_id', '=', s.branch)
      .where('quarter_id', '=', q1)
      .execute();
    const journal = await journalOf(s.classId, s.subject);
    const list = await vice(s.branch, async ({ get }) =>
      checklistOf(await get(s.branch, path(q1))),
    );
    const missing = itemsOf(list, 'weights_missing', journal);
    expect(missing.map((one) => one.teacher)).toEqual([null]);

    // 5.7a-3c: a vacancy's journal with no acting teacher.
    const acting = new ActingKit(t.database.migrator);
    const branch = await t.newBranch();
    const scene = await acting.scene(branch);
    for (const [index, [start, end]] of QUARTERS.entries()) {
      await t.database.migrator
        .updateTable('quarters')
        .set({ start_date: start, end_date: end })
        .where('academic_year_id', '=', scene.year)
        .where('number', '=', index + 1)
        .execute();
    }
    const vacancyList = await vice(branch, async ({ get }) =>
      checklistOf(await get(branch, path())),
    );
    const noTeacher = itemsOf(vacancyList, 'no_teacher', scene.journal);
    expect(noTeacher).toHaveLength(1);
    expect(noTeacher[0]?.teacher).toBeNull();
    expect(noTeacher[0]?.days[0]?.from).toBe('2026-09-07');
  });

  it('reminds each teacher of their own items once per key, and checks the key', async () => {
    const b = await base();
    const teacherAccount = (
      await t.database.migrator
        .selectFrom('staff')
        .select('account_id')
        .where('id', '=', b.s.teacher.staffId)
        .executeTakeFirstOrThrow()
    ).account_id;
    const remind = `/api/results/closing/${b.q1}/remind`;
    const other = await publishedScene(t, load, { graded: true });
    const otherQuarter = await quarterOf(other.year, 1);
    const key = randomUUID();
    const browser = await account();
    await t.kit.giveRole(browser.account.id, {
      role: 'academic_vice_principal',
      branchId: b.s.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    // A reminder changes no data: no audit entry (review decision 12).
    const auditBefore = await t.auditCount();
    await as(browser, [], async ({ post }) => {
      const sent = await post(b.s.branch, remind, {}, key);
      // The class's teacher and the other class's teacher, each with their own items.
      expect([sent.status, sent.body]).toEqual([200, { sent: 2 }]);
      const repeat = await post(b.s.branch, remind, {}, key);
      expect([repeat.status, repeat.body]).toEqual([200, { sent: 2 }]);
      // A repeat of the key with another branch's or an unknown quarter is 404.
      for (const id of [otherQuarter, UNKNOWN]) {
        const refused = await post(b.s.branch, `/api/results/closing/${id}/remind`, {}, key);
        expect([refused.status, codeOf(refused)]).toEqual([404, 'not_found']);
      }
    });
    expect(await t.auditCount()).toBe(auditBefore);
    const notices = await t.database.migrator
      .selectFrom('notifications')
      .select(['kind', 'data', 'account_id'])
      .where('kind', '=', 'results.closing_reminder')
      .where('branch_id', '=', b.s.branch)
      .execute();
    expect(notices).toHaveLength(2);
    const own = notices.filter((one) => one.account_id === teacherAccount);
    expect(own).toHaveLength(1);
    const data = own[0]?.data as { quarter: number; items: { kind: string; count: number }[] };
    expect(data.quarter).toBe(1);
    expect(data.items.map((one) => one.kind).sort()).toEqual(
      [
        'edit_period',
        'no_attendance',
        'no_result',
        'numbers_missing',
        'part_without_data',
        'undecided',
      ]
        .concat(data.items.some((one) => one.kind === 'plan_incomplete') ? ['plan_incomplete'] : [])
        .sort(),
    );
    // The same key from another account: 409; from a role the route refuses: 403.
    await as(
      await account(),
      [{ role: 'academic_vice_principal', branchId: b.s.branch }],
      async ({ post }) => {
        const reused = await post(b.s.branch, remind, {}, key);
        expect([reused.status, codeOf(reused)]).toEqual([409, 'request_key_reused']);
      },
    );
    await as(await account(), [{ role: 'principal', branchId: b.s.branch }], async ({ post }) => {
      const refused = await post(b.s.branch, remind, {}, key);
      expect(refused.status).toBe(403);
    });
    // No audit entry for a reminder (no data changes).
  });

  it('lets the Principal read and refuses every write to the Principal and a Teacher, changing nothing', async () => {
    const b = await base();
    const writes = (calls: Calls) => [
      calls.put(b.s.branch, `/api/results/closing/${b.q1}/decisions`, {
        subjectId: b.s.subject,
        studentId: b.bek,
        decision: 'keep',
        version: null,
      }),
      calls.post(b.s.branch, `/api/results/closing/${b.q1}/journals/${b.journal}/decisions`, {
        decision: 'keep',
        students: [b.bek],
      }),
      calls.post(b.s.branch, `/api/results/closing/${b.q1}/plan-periods/end`),
      calls.post(b.s.branch, `/api/results/closing/${b.q1}/remind`, {}, randomUUID()),
    ];
    const principal = await account();
    const teacher = await account();
    const before = await closingAudit();
    await as(principal, [{ role: 'principal', branchId: b.s.branch }], async (calls) => {
      const list = checklistOf(await calls.get(b.s.branch, path(b.q1)));
      expect(list.canEdit).toBe(false);
      for (const response of await Promise.all(writes(calls))) expect(response.status).toBe(403);
    });
    await as(teacher, [{ role: 'teacher', branchId: b.s.branch }], async (calls) => {
      expect((await calls.get(b.s.branch, path(b.q1))).status).toBe(403);
      for (const response of await Promise.all(writes(calls))) expect(response.status).toBe(403);
    });
    expect(await closingAudit()).toBe(before);
    const stored = await t.database.migrator
      .selectFrom('quarter_result_decisions')
      .select('id')
      .where('student_id', '=', b.bek)
      .execute();
    expect(stored).toEqual([]);
  });

  it("answers 404 for another branch's or an unknown quarter, journal, subject and student, changing no row", async () => {
    const b = await base();
    const other = await base();
    // Rows the plan-period route would change, in both branches (.claude/rules/api.md).
    await openPlanPeriod(b.s.branch, b.s.subject, b.journal, b.q1);
    await openPlanPeriod(other.s.branch, other.s.subject, other.journal, other.q1);
    const browser = await account();
    await t.kit.giveRole(browser.account.id, {
      role: 'academic_vice_principal',
      branchId: b.s.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    const key = randomUUID();
    const rowsBefore = {
      north: await t.rowsOf(b.s.branch),
      south: await t.rowsOf(other.s.branch),
    };
    const decisionsBefore = await t.database.migrator
      .selectFrom('quarter_result_decisions')
      .selectAll()
      .execute();
    const auditBefore = await t.auditCount();
    const noticesBefore = [
      await notificationsOf(b.s.branch),
      await notificationsOf(other.s.branch),
    ];
    await as(browser, [], async ({ get, put, post }) => {
      for (const quarter of [other.q1, UNKNOWN]) {
        const read = await get(b.s.branch, path(quarter));
        expect([read.status, codeOf(read)]).toEqual([404, 'not_found']);
        const decided = await put(b.s.branch, `/api/results/closing/${quarter}/decisions`, {
          subjectId: b.s.subject,
          studentId: b.bek,
          decision: 'keep',
          version: null,
        });
        expect([decided.status, codeOf(decided)]).toEqual([404, 'not_found']);
        for (const tail of ['plan-periods/end', `journals/${b.journal}/decisions`]) {
          const body = tail.startsWith('journals') ? { decision: 'keep', students: [b.bek] } : {};
          const refused = await post(b.s.branch, `/api/results/closing/${quarter}/${tail}`, body);
          expect([refused.status, codeOf(refused)]).toEqual([404, 'not_found']);
        }
        const reminded = await post(b.s.branch, `/api/results/closing/${quarter}/remind`, {}, key);
        expect([reminded.status, codeOf(reminded)]).toEqual([404, 'not_found']);
      }
      for (const journal of [other.journal, UNKNOWN]) {
        const refused = await post(
          b.s.branch,
          `/api/results/closing/${b.q1}/journals/${journal}/decisions`,
          { decision: 'keep', students: [b.bek] },
        );
        expect([refused.status, codeOf(refused)]).toEqual([404, 'not_found']);
      }
      for (const [subjectId, studentId] of [
        [UNKNOWN, b.bek],
        [b.s.subject, other.bek],
        [b.s.subject, UNKNOWN],
      ] as const) {
        const refused = await put(b.s.branch, `/api/results/closing/${b.q1}/decisions`, {
          subjectId,
          studentId,
          decision: 'keep',
          version: null,
        });
        expect([refused.status, codeOf(refused)]).toEqual([404, 'not_found']);
      }
      // Another branch's and an unknown student in a whole journal's list: named, never
      // written (the body ids of .claude/rules/api.md).
      const whole = await post(
        b.s.branch,
        `/api/results/closing/${b.q1}/journals/${b.journal}/decisions`,
        { decision: 'keep', students: [other.bek, UNKNOWN] },
      );
      expect(whole.status, JSON.stringify(whole.body)).toBe(200);
      expect(whole.body).toEqual({
        decided: [],
        refused: [
          ...[other.bek, UNKNOWN]
            .sort()
            .map((studentId) => ({ studentId, code: 'closing_not_flagged' })),
          { studentId: b.bek, code: 'closing_list_changed' },
        ],
      });
    });
    expect(await t.auditCount()).toBe(auditBefore);
    expect([await notificationsOf(b.s.branch), await notificationsOf(other.s.branch)]).toEqual(
      noticesBefore,
    );
    expect(
      await t.database.migrator.selectFrom('quarter_result_decisions').selectAll().execute(),
    ).toEqual(decisionsBefore);
    expect(await t.rowsOf(b.s.branch)).toEqual(rowsBefore.north);
    expect(await t.rowsOf(other.s.branch)).toEqual(rowsBefore.south);
  });

  it('refuses every write before the checklist opens, and a clear with nothing stored', async () => {
    const b = await base();
    const decisions = `/api/results/closing/${b.q1}/decisions`;
    const before = await closingAudit();
    await vice(
      b.s.branch,
      async ({ put, post }) => {
        const one = await put(b.s.branch, decisions, {
          subjectId: b.s.subject,
          studentId: b.bek,
          decision: 'keep',
          version: null,
        });
        expect([one.status, codeOf(one)]).toEqual([409, 'closing_not_open']);
        const whole = await post(
          b.s.branch,
          `/api/results/closing/${b.q1}/journals/${b.journal}/decisions`,
          { decision: 'keep', students: [b.bek] },
        );
        expect([whole.status, codeOf(whole)]).toEqual([409, 'closing_not_open']);
        const ended = await post(b.s.branch, `/api/results/closing/${b.q1}/plan-periods/end`);
        expect([ended.status, codeOf(ended)]).toEqual([409, 'closing_not_open']);
      },
      '2026-10-16T12:00:00+05:00',
    );
    expect(await closingAudit()).toBe(before);
    await vice(b.s.branch, async ({ put }) => {
      const clear = await put(b.s.branch, decisions, {
        subjectId: b.s.subject,
        studentId: b.bek,
        decision: null,
        version: null,
      });
      expect([clear.status, codeOf(clear)]).toEqual([409, 'closing_nothing_to_clear']);
    });
    expect(await closingAudit()).toBe(before);
  });

  it('leaves homework given at the last lesson of the quarter out of the open items', async () => {
    const b = await base();
    // 07: "Homework given at the last lesson of the quarter is not an open item; it belongs to
    // the next quarter." A homework given by hand on the 26th (stored where it is given).
    await t.database.migrator
      .insertInto('journal_works')
      .values({
        branch_id: b.s.branch,
        lesson_id: b.lessons.l26.id,
        source_lesson_id: b.lessons.l26.id,
        kind: 'homework',
        total: 10,
      })
      .execute();
    await saveOn(b.s.branch, b.lessons.l26.date, [
      { lessonId: b.lessons.l26.id, studentId: b.aziz, value: 1 },
    ]);
    const lessonsWith = (list: ClosingChecklist) =>
      itemsOf(list, 'numbers_missing', b.journal).flatMap((one) => one.lessons.map((l) => l.id));
    const list = await vice(b.s.branch, async ({ get }) =>
      checklistOf(await get(b.s.branch, path(b.q1))),
    );
    expect(lessonsWith(list)).toEqual([b.lessons.l12.id]);
    // A classwork of the 26th with no number for Aziz is an open item: the check can fail.
    await work(b.s.branch, b.lessons.l26.id);
    const after = await vice(b.s.branch, async ({ get }) =>
      checklistOf(await get(b.s.branch, path(b.q1))),
    );
    expect(lessonsWith(after)).toEqual([b.lessons.l12.id, b.lessons.l26.id]);
  });

  it('warns of a lesson plan that is not complete (07; From 8.8)', async () => {
    const b = await base();
    const list = await vice(b.s.branch, async ({ get }) =>
      checklistOf(await get(b.s.branch, path(b.q1))),
    );
    const plans = itemsOf(list, 'plan_incomplete', b.journal);
    expect(plans.map((one) => [one.state, one.empty, one.notCovered, one.belowMinimum])).toEqual([
      ['not_started', 3, 0, false],
    ]);
    expect(plans[0]?.teacher?.id).toBe(b.s.teacher.staffId);
  });

  it('lists an unlocked rating exam under its journal', async () => {
    const b = await base();
    const { s } = b;
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
    const teacherAccount = (
      await t.database.migrator
        .selectFrom('staff')
        .select('account_id')
        .where('id', '=', s.teacher.staffId)
        .executeTakeFirstOrThrow()
    ).account_id;
    if (teacherAccount === null) throw new Error('The teacher has an account.');
    const decider = await load.classes.account();
    const unlock = { id: '' };
    for (const [moment, write] of [
      [
        '2026-10-26T09:00:00+05:00',
        async (transaction: Parameters<Parameters<Transactions['run']>[1]>[0]) => {
          unlock.id = (
            await transaction
              .insertInto('journal_unlocks')
              .values({
                branch_id: s.branch,
                target: 'rating',
                journal_id: b.journal,
                quarter_id: b.q1,
                staff_id: s.teacher.staffId,
                requested_by: teacherAccount,
                reason: 'The exam scores were typed late',
                requested_at: new Date(0),
                status: 'sent',
                version: 0,
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        },
      ],
      [
        '2026-10-26T10:00:00+05:00',
        async (transaction: Parameters<Parameters<Transactions['run']>[1]>[0]) => {
          await transaction
            .updateTable('journal_unlocks')
            .set({ status: 'approved', days: 3, decided_by: decider })
            .where('id', '=', unlock.id)
            .execute();
        },
      ],
    ] as const) {
      t.clock.set(moment);
      try {
        await t.app.get(Transactions).run([s.branch], async (transaction) => {
          await t.app.get(Audit).record(transaction, {
            branchId: s.branch,
            actorId: decider,
            action: 'journal.unlock_decide',
          });
          await write(transaction);
        });
      } finally {
        t.clock.set(START);
      }
    }
    const list = await vice(s.branch, async ({ get }) =>
      checklistOf(await get(s.branch, path(b.q1))),
    );
    expect(itemsOf(list, 'unlocked', b.journal).map((one) => [one.lessons, one.rating])).toEqual([
      [[], true],
    ]);
  });

  it('answers a decision in a closed year with year_closed, storing nothing', async () => {
    const b = await base();
    await t.database.migrator
      .updateTable('academic_years')
      .set({ status: 'closed' })
      .where('id', '=', b.s.year)
      .execute();
    await vice(b.s.branch, async ({ put }) => {
      const refused = await put(b.s.branch, `/api/results/closing/${b.q1}/decisions`, {
        subjectId: b.s.subject,
        studentId: b.bek,
        decision: 'keep',
        version: null,
      });
      expect([refused.status, codeOf(refused)]).toEqual([409, 'year_closed']);
    });
    const stored = await t.database.migrator
      .selectFrom('quarter_result_decisions')
      .select('id')
      .where('student_id', '=', b.bek)
      .execute();
    expect(stored).toEqual([]);
  });

  it('gives the Super Admin the writes and canEdit, and a Principal here who is a Vice Principal elsewhere none', async () => {
    const b = await base();
    const other = await publishedScene(t, load, { graded: true });
    // The kit's Super Admin, its sessions moved to the moment and back afterwards.
    const admins = await t.database.migrator
      .selectFrom('sessions')
      .innerJoin('assignments', 'assignments.account_id', 'sessions.account_id')
      .select(['sessions.id', 'sessions.created_at', 'sessions.last_used_at'])
      .where('assignments.role', '=', 'super_admin')
      .execute();
    const setAdmins = (moment: Date | null) =>
      Promise.all(
        admins.map((one) =>
          t.database.migrator
            .updateTable('sessions')
            .set({
              created_at: moment ?? one.created_at,
              last_used_at: moment ?? one.last_used_at,
            })
            .where('id', '=', one.id)
            .execute(),
        ),
      );
    await setAdmins(new Date(MOMENT));
    t.clock.set(MOMENT);
    try {
      const list = checklistOf(await t.get(path(b.q1), b.s.branch));
      expect(list.canEdit).toBe(true);
      const decided = await t.put(`/api/results/closing/${b.q1}/decisions`, b.s.branch, {
        subjectId: b.s.subject,
        studentId: b.bek,
        decision: 'keep',
        version: null,
      });
      expect([decided.status, decided.body]).toEqual([200, { decision: 'keep', version: 1 }]);
    } finally {
      t.clock.set(START);
      await setAdmins(null);
    }
    await as(
      await account(),
      [
        { role: 'principal', branchId: b.s.branch },
        { role: 'academic_vice_principal', branchId: other.branch },
      ],
      async ({ get, put }) => {
        expect(checklistOf(await get(b.s.branch, path(b.q1))).canEdit).toBe(false);
        const refused = await put(b.s.branch, `/api/results/closing/${b.q1}/decisions`, {
          subjectId: b.s.subject,
          studentId: b.bek,
          decision: 'not_assessed',
          version: 1,
        });
        expect(refused.status).toBe(403);
      },
    );
  });

  it('shows the decided state to every reader of the result: the teacher, the Head Teacher and the file', async () => {
    const teacher = await account();
    const b = await base({ teacher: teacher.account.id });
    await vice(b.s.branch, async ({ put }) => {
      const set = await put(b.s.branch, `/api/results/closing/${b.q1}/decisions`, {
        subjectId: b.s.subject,
        studentId: b.bek,
        decision: 'not_assessed',
        version: null,
      });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
    });
    const gridPath = `/api/journal/journals/${b.journal}?quarterId=${b.q1}`;
    const resultOf = (response: Response) =>
      journalGridSchema.parse(response.body).students.find((one) => one.id === b.bek)?.quarter
        ?.result;
    await as(teacher, [{ role: 'teacher', branchId: b.s.branch }], async ({ get }) => {
      expect(resultOf(await get(b.s.branch, gridPath))).toEqual({ kind: 'not_assessed' });
      // The file of the journal says so too (07, last paragraph; journal-export.ts).
      const file = await t
        .post(
          `/api/journal/journals/${b.journal}/export`,
          b.s.branch,
          { format: 'xlsx', quarterId: b.q1 },
          teacher.cookie,
        )
        .buffer(true)
        .parse(binary);
      expect(file.status).toBe(200);
      // Every cell of the sheet, row by row (the file's heading rows are narrower than its table).
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.body as ArrayBuffer);
      const lines: unknown[][] = [];
      workbook.worksheets[0]?.eachRow((row) => {
        lines.push((row.values as unknown[]).slice(1));
      });
      const bekRow = lines.find((row) =>
        row.some((cell) => typeof cell === 'string' && cell.includes('Toshev')),
      );
      // The teacher's language is Uzbek: "Baholanmagan" (Not assessed).
      expect(bekRow).toContain('Baholanmagan');
    });
    await as(
      await account(),
      [{ role: 'head_teacher', branchId: b.s.branch, subjectIds: [b.s.subject] }],
      async ({ get }) => {
        expect(resultOf(await get(b.s.branch, gridPath))).toEqual({ kind: 'not_assessed' });
      },
    );
  });
  // -------------------------------------------------------------------------
  // Task 9.2b: the close (07, Closing a quarter; edge/journal, Closing and reopening; the From
  // lines of 4.3, 7.2, 8.4, 8.6 and 9.2a; the plan's decisions and the review's corrections).

  /** Saturday 31 October 2026, the last day of quarter 1, 18:00 in Tashkent. */
  const CLOSE = '2026-10-31T18:00:00+05:00';

  const closePath = (quarterId: string) => `/api/results/closing/${quarterId}/close`;

  /** The warnings of a checklist, each kind and journal once, as the screen sends them. */
  const warningsOf = (list: ClosingChecklist) => {
    const seen = new Map<string, { kind: string; journalId: string | null }>();
    for (const item of list.items) {
      if (!(CLOSING_WARNINGS as readonly string[]).includes(item.kind)) continue;
      const journalId = item.journal?.id ?? null;
      seen.set(`${item.kind}|${journalId ?? ''}`, { kind: item.kind, journalId });
    }
    return [...seen.values()];
  };

  /** Decides every undecided result of the checklist ("keep" where allowed). */
  const decideAll = async (calls: Calls, branch: string, quarter: string) => {
    const list = checklistOf(await calls.get(branch, path(quarter)));
    for (const item of itemsOf(list, 'undecided')) {
      for (const one of item.students) {
        const decided = await calls.put(branch, `/api/results/closing/${quarter}/decisions`, {
          subjectId: item.journal?.subject.id,
          studentId: one.student.id,
          decision: one.allowed.includes('keep') ? 'keep' : one.allowed[0],
          version: one.version,
        });
        expect(decided.status, JSON.stringify(decided.body)).toBe(200);
      }
    }
    return checklistOf(await calls.get(branch, path(quarter)));
  };

  const finalRecordsOf = (quarter: string) =>
    t.database.migrator
      .selectFrom('quarter_final_results')
      .select(['student_id', 'subject_id', 'journal_id', 'kind', 'record'])
      .where('quarter_id', '=', quarter)
      .orderBy('student_id')
      .execute();

  it('closes the quarter for the whole branch: decisions, lock now, warnings acknowledged, every result stored', async () => {
    const teacher = await account();
    const b = await base({ teacher: teacher.account.id });
    const key = randomUUID();
    const body = (over: object = {}) => ({
      warnings: [],
      lockNow: false,
      startQuarter: null,
      ...over,
    });
    const closed = await vice(
      b.s.branch,
      async (calls) => {
        const first = checklistOf(await calls.get(b.s.branch, path(b.q1)));
        expect(first.closable).toBe(false);
        const blocked = await calls.post(b.s.branch, closePath(b.q1), body(), randomUUID());
        expect([blocked.status, codeOf(blocked)]).toEqual([409, 'closing_blocked']);
        const list = await decideAll(calls, b.s.branch, b.q1);
        // Review correction 1: the 26th's edit period does not keep the close away.
        expect(itemsOf(list, 'edit_period').length).toBeGreaterThan(0);
        expect([list.closable, list.lockNowNeeded, list.startQuarter]).toEqual([true, true, false]);
        const noLockNow = await calls.post(b.s.branch, closePath(b.q1), body(), randomUUID());
        expect([noLockNow.status, codeOf(noLockNow)]).toEqual([409, 'closing_lock_now_needed']);
        expect(list.warnings).toBeGreaterThan(0);
        const unseen = await calls.post(
          b.s.branch,
          closePath(b.q1),
          body({ lockNow: true, warnings: warningsOf(list).slice(1) }),
          randomUUID(),
        );
        expect([unseen.status, codeOf(unseen)]).toEqual([409, 'closing_warnings_changed']);
        const done = await calls.post(
          b.s.branch,
          closePath(b.q1),
          body({ lockNow: true, warnings: warningsOf(list) }),
          key,
        );
        expect(done.status, JSON.stringify(done.body)).toBe(200);
        const answer = closingClosedSchema.parse(done.body);
        // Repeat-safe: the stored answer, nothing written twice.
        const repeat = await calls.post(
          b.s.branch,
          closePath(b.q1),
          body({ lockNow: true, warnings: warningsOf(list) }),
          key,
        );
        expect([repeat.status, repeat.body]).toEqual([200, done.body]);
        // The checklist of a closed quarter: the close, its warnings, and no item.
        const after = checklistOf(await calls.get(b.s.branch, path(b.q1)));
        expect(after.state).toBe('closed');
        expect(after.items).toEqual([]);
        expect(after.closing).toMatchObject({ version: 1, lockNow: true, startQuarter: null });
        expect(after.closing?.warnings).toHaveLength(list.warnings);
        expect(after.closing?.closedBy).not.toBe('');
        // The journal of a closed quarter: read only, and no figure "provisional" (07 rule 8).
        const grid = journalGridSchema.parse(
          (await calls.get(b.s.branch, `/api/journal/journals/${b.journal}?quarterId=${b.q1}`))
            .body,
        );
        expect(grid.quarter.closed).toBe(true);
        expect(
          grid.students.some(
            (one) => one.quarter?.result?.kind === 'number' && one.quarter.result.provisional,
          ),
        ).toBe(false);
        // Every write of the checklist is refused now.
        const writes = [
          await calls.put(b.s.branch, `/api/results/closing/${b.q1}/decisions`, {
            subjectId: b.s.subject,
            studentId: b.bek,
            decision: null,
            version: 1,
          }),
          await calls.post(
            b.s.branch,
            `/api/results/closing/${b.q1}/journals/${b.journal}/decisions`,
            {
              decision: 'keep',
              students: [b.bek],
            },
          ),
          await calls.post(b.s.branch, `/api/results/closing/${b.q1}/plan-periods/end`),
          await calls.post(b.s.branch, `/api/results/closing/${b.q1}/remind`, {}, randomUUID()),
          await calls.post(
            b.s.branch,
            closePath(b.q1),
            body({ lockNow: true, warnings: warningsOf(list) }),
            randomUUID(),
          ),
        ];
        expect(writes.map((one) => [one.status, codeOf(one)])).toEqual(
          writes.map(() => [409, 'quarter_closed']),
        );
        return answer;
      },
      CLOSE,
    );
    expect(closed.version).toBe(1);
    expect(
      await t.database.migrator
        .selectFrom('quarter_closings')
        .select('id')
        .where('quarter_id', '=', b.q1)
        .execute(),
    ).toHaveLength(1);

    // Every result of the quarter stored as final (edge/developer-rules, Calculation): the
    // record the module made with the quarter closed, the same when recalculated.
    const records = await finalRecordsOf(b.q1);
    expect(records).toHaveLength(closed.stored);
    expect(records.map((one) => one.student_id).sort()).toEqual(
      [b.aziz, b.bek, b.dilshod, b.zafar, b.lola, b.yulduz, b.komil].sort(),
    );
    for (const one of records) {
      const compared = recalculateAndCompare(one.record);
      expect(compared.same, JSON.stringify(compared.differences)).toBe(true);
      expect((one.record as { inputs: { quarterClosed: boolean } }).inputs.quarterClosed).toBe(
        true,
      );
      expect(one.journal_id).toBe(b.journal);
    }
    // From 8.6: the result at leaving of Lola, stored at the close.
    const kinds = new Map(records.map((one) => [one.student_id, one.kind]));
    expect(kinds.get(b.lola)).toBe('at_leaving');
    expect(kinds.get(b.aziz)).toBe('closing');
    const outcomes = new Map(
      records.map((one) => [one.student_id, storedQuarterOutcome(one.record).kind]),
    );
    expect(outcomes.get(b.zafar)).toBe('exempt');
    expect(outcomes.get(b.dilshod)).toBe('no_result');
    // The names as they were (edge/academic-year; review must-fix 4).
    const names = await t.database.migrator
      .selectFrom('quarter_closing_journals')
      .select(['journal_id', 'unit_name', 'teacher_name'])
      .where('journal_id', '=', b.journal)
      .execute();
    expect(names).toHaveLength(1);
    expect(names[0]?.unit_name).not.toBe('');
    // "Lock now": the 26th is locked from the close, and its teacher is told.
    const lock = await sql<{
      lock: Date;
    }>`select journal_lesson_lock(${b.lessons.l26.id}::uuid) as lock`.execute(t.database.migrator);
    expect(lock.rows[0]?.lock).toEqual(new Date(CLOSE));
    const notices = await t.database.migrator
      .selectFrom('notifications')
      .select(['account_id', 'data'])
      .where('kind', '=', 'results.quarter_locked_now')
      .where('branch_id', '=', b.s.branch)
      .execute();
    // One notice per teacher whose lessons the close locked, the class's teacher among them.
    expect(notices.map((one) => one.account_id)).toContain(teacher.account.id);
    expect(new Set(notices.map((one) => one.account_id)).size).toBe(notices.length);
    expect(notices.every((one) => JSON.stringify(one.data) === '{"quarter":1}')).toBe(true);
    const entry = await t.database.migrator
      .selectFrom('audit_log')
      .select(['new_value'])
      .where('action', '=', 'results.quarter_closed')
      .where('branch_id', '=', b.s.branch)
      .execute();
    expect(entry).toHaveLength(1);
    expect(entry[0]?.new_value).toMatchObject({ version: 1, lockNow: true, stored: closed.stored });
  });

  it('refuses the close before the last day (23:59 and 00:00), out of order, and without the start-quarter choice', async () => {
    const b = await base();
    const body = { warnings: [], lockNow: true, startQuarter: null };
    await vice(
      b.s.branch,
      async ({ post }) => {
        const early = await post(b.s.branch, closePath(b.q1), body, randomUUID());
        expect([early.status, codeOf(early)]).toEqual([409, 'closing_before_last_day']);
      },
      '2026-10-30T23:59:00+05:00',
    );
    await vice(
      b.s.branch,
      async ({ post }) => {
        // At 00:00 of the last day the date passes; the undecided results block.
        const blocked = await post(b.s.branch, closePath(b.q1), body, randomUUID());
        expect([blocked.status, codeOf(blocked)]).toEqual([409, 'closing_blocked']);
        // A choice sent for a quarter that is not the start quarter (correction 2).
        const choice = await post(
          b.s.branch,
          closePath(b.q1),
          { ...body, startQuarter: 'keep' },
          randomUUID(),
        );
        expect([choice.status, codeOf(choice)]).toEqual([409, 'closing_not_start_quarter']);
      },
      '2026-10-31T00:00:00+05:00',
    );
    // edge/journal: "Quarters are closed in order".
    const q2 = await quarterOf(b.s.year, 2);
    await vice(
      b.s.branch,
      async ({ get, post }) => {
        const list = checklistOf(await get(b.s.branch, path(q2)));
        expect([list.earlierOpen, list.closable]).toEqual([true, false]);
        const out = await post(b.s.branch, closePath(q2), body, randomUUID());
        expect([out.status, codeOf(out)]).toEqual([409, 'closing_earlier_open']);
      },
      '2026-12-28T12:00:00+05:00',
    );
    // edge/academic-year, "Closing the start quarter": a branch live from 14 September.
    await t.database.migrator
      .updateTable('branches')
      .set({ go_live_date: '2026-09-14' })
      .where('id', '=', b.s.branch)
      .execute();
    await vice(
      b.s.branch,
      async ({ get, post }) => {
        expect(checklistOf(await get(b.s.branch, path(b.q1))).startQuarter).toBe(true);
        const needed = await post(b.s.branch, closePath(b.q1), body, randomUUID());
        expect([needed.status, codeOf(needed)]).toEqual([409, 'closing_start_quarter_needed']);
      },
      CLOSE,
    );
    expect(
      await t.database.migrator
        .selectFrom('quarter_closings')
        .select('id')
        .where('quarter_id', '=', b.q1)
        .execute(),
    ).toEqual([]);
  });

  it('closes a start quarter "not official", voids the waiting plan requests, and returns to open when it fails half-way', async () => {
    const s = await publishedScene(t, load, { graded: true });
    const q1 = await quarterOf(s.year, 1);
    const journal = await journalOf(s.classId, s.subject);
    await t.database.migrator
      .updateTable('branch_edit_days')
      .set({ edit_days: 1 })
      .where('branch_id', '=', s.branch)
      .execute();
    await t.database.migrator
      .updateTable('branches')
      .set({ go_live_date: '2026-09-14' })
      .where('id', '=', s.branch)
      .execute();
    const request = await openPlanPeriod(s.branch, s.subject, journal, q1);
    // A waiting request: sent, not yet decided (0117).
    await t.database.migrator
      .updateTable('lesson_plan_requests')
      .set({
        status: 'sent',
        decided_by: null,
        decided_at: null,
        days: null,
        open_until: null,
      })
      .where('id', '=', request)
      .execute();
    const send = (calls: Calls, list: ClosingChecklist) =>
      calls.post(
        s.branch,
        closePath(q1),
        { warnings: warningsOf(list), lockNow: false, startQuarter: 'not_official' },
        randomUUID(),
      );
    // A failure after the records are written: the quarter is open and nothing is stored.
    const audit = t.app.get(Audit);
    const original = audit.record.bind(audit);
    const spy = vi.spyOn(audit, 'record').mockImplementation((transaction, entry) => {
      if (entry.action === 'results.quarter_closed') throw new Error('The audit log failed.');
      return original(transaction, entry);
    });
    try {
      await vice(
        s.branch,
        async (calls) => {
          const list = checklistOf(await calls.get(s.branch, path(q1)));
          const failed = await send(calls, list);
          expect(failed.status).toBe(500);
        },
        CLOSE,
      );
    } finally {
      spy.mockRestore();
    }
    expect(await finalRecordsOf(q1)).toEqual([]);
    expect(
      await t.database.migrator
        .selectFrom('quarter_closings')
        .select('id')
        .where('quarter_id', '=', q1)
        .execute(),
    ).toEqual([]);
    const waiting = await t.database.migrator
      .selectFrom('lesson_plan_requests')
      .select('status')
      .where('id', '=', request)
      .executeTakeFirstOrThrow();
    expect(waiting.status).toBe('sent');
    await vice(
      s.branch,
      async (calls) => {
        const list = checklistOf(await calls.get(s.branch, path(q1)));
        expect(list.state).toBe('open');
        const done = await send(calls, list);
        expect(done.status, JSON.stringify(done.body)).toBe(200);
        expect(closingClosedSchema.parse(done.body).voided).toBe(1);
        const after = checklistOf(await calls.get(s.branch, path(q1)));
        expect(after.closing?.startQuarter).toBe('not_official');
      },
      CLOSE,
    );
    const voided = await t.database.migrator
      .selectFrom('lesson_plan_requests')
      .select('status')
      .where('id', '=', request)
      .executeTakeFirstOrThrow();
    expect(voided.status).toBe('void');
    const entries = await t.database.migrator
      .selectFrom('audit_log')
      .select('new_value')
      .where('action', '=', 'plan.requests_voided')
      .where('branch_id', '=', s.branch)
      .execute();
    expect(entries).toHaveLength(1);
  });

  it("answers 404 for another branch's or an unknown quarter, 403 to a role it refuses, and checks the key", async () => {
    const s = await publishedScene(t, load, { graded: true });
    const other = await publishedScene(t, load, { graded: true });
    const q1 = await quarterOf(s.year, 1);
    const otherQuarter = await quarterOf(other.year, 1);
    await t.database.migrator
      .updateTable('branch_edit_days')
      .set({ edit_days: 1 })
      .where('branch_id', 'in', [s.branch, other.branch])
      .execute();
    const browser = await account();
    await t.kit.giveRole(browser.account.id, {
      role: 'academic_vice_principal',
      branchId: s.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    const rowsBefore = { north: await t.rowsOf(s.branch), south: await t.rowsOf(other.branch) };
    const auditBefore = await t.auditCount();
    const key = randomUUID();
    let warnings: { kind: string; journalId: string | null }[] = [];
    await as(
      browser,
      [],
      async ({ get, post }) => {
        warnings = warningsOf(checklistOf(await get(s.branch, path(q1))));
        for (const id of [otherQuarter, UNKNOWN]) {
          const refused = await post(
            s.branch,
            closePath(id),
            { warnings, lockNow: false, startQuarter: null },
            randomUUID(),
          );
          expect([refused.status, codeOf(refused)]).toEqual([404, 'not_found']);
        }
      },
      CLOSE,
    );
    expect(await t.auditCount()).toBe(auditBefore);
    expect(await t.rowsOf(s.branch)).toEqual(rowsBefore.north);
    expect(await t.rowsOf(other.branch)).toEqual(rowsBefore.south);
    for (const role of ['principal', 'teacher', 'head_teacher'] as const) {
      await as(
        await account(),
        [{ role, branchId: s.branch }],
        async ({ post }) => {
          const refused = await post(
            s.branch,
            closePath(q1),
            { warnings, lockNow: false, startQuarter: null },
            randomUUID(),
          );
          expect(refused.status).toBe(403);
        },
        CLOSE,
      );
    }
    // The key: used once, then a repeat with another branch's or an unknown quarter is 404,
    // another account's use is 409, and a refused role is 403, never the stored answer.
    await as(
      browser,
      [],
      async ({ post }) => {
        const done = await post(
          s.branch,
          closePath(q1),
          { warnings, lockNow: false, startQuarter: null },
          key,
        );
        expect(done.status, JSON.stringify(done.body)).toBe(200);
        for (const id of [otherQuarter, UNKNOWN]) {
          const refused = await post(
            s.branch,
            closePath(id),
            { warnings, lockNow: false, startQuarter: null },
            key,
          );
          expect([refused.status, codeOf(refused)]).toEqual([404, 'not_found']);
        }
      },
      CLOSE,
    );
    await as(
      await account(),
      [{ role: 'academic_vice_principal', branchId: s.branch }],
      async ({ post }) => {
        const reused = await post(
          s.branch,
          closePath(q1),
          { warnings, lockNow: false, startQuarter: null },
          key,
        );
        expect([reused.status, codeOf(reused)]).toEqual([409, 'request_key_reused']);
      },
      CLOSE,
    );
    await as(
      await account(),
      [{ role: 'principal', branchId: s.branch }],
      async ({ post }) => {
        const refused = await post(
          s.branch,
          closePath(q1),
          { warnings, lockNow: false, startQuarter: null },
          key,
        );
        expect(refused.status).toBe(403);
      },
      CLOSE,
    );
  });
  // edge/system-behaviour, required tests: "closing against a cell save"; edge/journal, "Close is
  // pressed while saves are still arriving" (the task's Done when; plan decision 2).
  describe('closing against a cell save', () => {
    const waiters = async () => {
      const found = await sql<{ n: number }>`
        select count(distinct l.pid)::int as n
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
      `.execute(t.database.migrator);
      return found.rows[0]?.n ?? 0;
    };
    const untilWaiting = async () => {
      for (let tries = 0; tries < 800; tries += 1) {
        if ((await waiters()) >= 1) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('Nothing waited on the held side.');
    };

    /** Runs `work` in a transaction of the branch held open until `release` is called. */
    const hold = (
      branch: string,
      moment: string,
      work: (transaction: Transaction) => Promise<void>,
    ) => {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      t.clock.set(moment);
      const done = t.app
        .get(Transactions)
        .run([branch], async (transaction) => {
          await work(transaction);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      return { isReady, release, done };
    };

    it('the close waits for a save held open and stores the value it saved', async () => {
      const b = await base();
      const warnings = await vice(
        b.s.branch,
        async (calls) => warningsOf(await decideAll(calls, b.s.branch, b.q1)),
        CLOSE,
      );
      const writer = await load.classes.account();
      // The held side does what a cell save does: the cell written, its guard holding the quarter.
      const held = hold(b.s.branch, '2026-10-31T17:00:00+05:00', async (transaction) => {
        await saveCells(transaction, t.app.get(Audit), { accountId: writer }, [
          { lessonId: b.lessons.l26.id, studentId: b.aziz, workId: null, value: 2, version: null },
        ]);
      });
      await held.isReady;
      const answer = await vice(
        b.s.branch,
        async ({ post }) => {
          const started = new Promise<Response>((resolve, reject) => {
            post(
              b.s.branch,
              closePath(b.q1),
              { warnings, lockNow: true, startQuarter: null },
              randomUUID(),
            ).then(resolve, reject);
          });
          await untilWaiting();
          held.release();
          return started;
        },
        CLOSE,
      );
      expect(await held.done).toBeUndefined();
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      const record = (await finalRecordsOf(b.q1)).find((one) => one.student_id === b.aziz);
      const lessons = (record?.record as { inputs: { lessons: { mark: number | null }[] } }).inputs
        .lessons;
      // The 12th (1), the 19th (0) and the 26th saved while the close waited (2).
      expect(lessons.map((one) => one.mark)).toEqual([1, 0, 2]);
    });

    it('a save waits for a close held open and is refused once it is closed', async () => {
      const teacher = await account();
      const b = await base({ teacher: teacher.account.id });
      // The held side does what the close does: the quarter for update, the closing row written.
      const held = hold(b.s.branch, CLOSE, async (transaction) => {
        await transaction
          .selectFrom('quarters')
          .select('id')
          .where('id', '=', b.q1)
          .forUpdate()
          .execute();
        await transaction
          .insertInto('quarter_closings')
          .values({
            branch_id: b.s.branch,
            quarter_id: b.q1,
            version: 1,
            closed_at: new Date(CLOSE),
            closed_by: teacher.account.id,
            lock_now: true,
            start_quarter: null,
            warnings: JSON.stringify([]),
          })
          .execute();
      });
      await held.isReady;
      const saved = await as(
        teacher,
        [{ role: 'teacher', branchId: b.s.branch }],
        async ({ post }) => {
          const started = new Promise<Response>((resolve, reject) => {
            post(
              b.s.branch,
              `/api/journal/lessons/${b.lessons.l26.id}/attendance`,
              { saves: [{ studentId: b.bek, mark: 1, version: null }] },
              randomUUID(),
            ).then(resolve, reject);
          });
          await untilWaiting();
          held.release();
          return started;
        },
        '2026-10-31T18:30:00+05:00',
      );
      expect(await held.done).toBeUndefined();
      expect([saved.status, codeOf(saved)]).toEqual([409, 'quarter_closed']);
      const cell = await t.database.migrator
        .selectFrom('journal_cells')
        .select('id')
        .where('lesson_id', '=', b.lessons.l26.id)
        .where('student_id', '=', b.bek)
        .execute();
      expect(cell).toEqual([]);
    });
  });
});
