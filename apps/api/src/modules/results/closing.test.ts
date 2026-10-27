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
import { journalFinalOf } from '../setup/closed-quarters.js';
import { storedShown } from './closing-versions.js';
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
import { rowsOfTables } from '../../testing/id-refusal-kit.js';
import { saveCells } from '../journal/cells.js';
import { quarterGrades, quarterRefOf } from './grade-changes.js';
import { DailyWork } from './daily/daily.service.js';
import { closeQuarter, reopenQuarter } from '../../testing/closing-kit.js';
import { openPlanWindows } from '../../testing/plan-windows-kit.js';
import { carryItem, lockPlansOf, notCoveredAt } from '../plans/plan-outcomes.js';

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

/**
 * Every table a closing route writes, also through shared functions (the close, its locks and
 * plan outcomes, a reopening, a recalculation, a reminder), and the request keys: what a
 * refused request must leave as it was, in every branch (.claude/rules/api.md, task 1.5;
 * task 10.3b). `rowsOfTables` adds nothing; `audit_log` is added where it is compared.
 */
const CLOSING_TABLES = [
  'quarter_result_decisions',
  'quarter_closings',
  'quarter_closing_journals',
  'quarter_final_results',
  'quarter_reopenings',
  'result_checks',
  'result_check_differences',
  'quarters',
  'journals',
  'journal_unlocks',
  'lessons',
  'lesson_plan_requests',
  'lesson_plan_windows',
  'lesson_plan_window_extensions',
  'lesson_plan_tray',
  'lesson_plan_outcomes',
  'lesson_plan_items',
  'notifications',
  'request_keys',
  'audit_log',
];

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

  /**
   * Two Super Admins for the whole file, each given the role once: with the kit's own, three
   * accounts hold it, the most there may be (MAX_SUPER_ADMINS).
   */
  const admins: Browser[] = [];
  const sharedAdmin = async (index: 0 | 1): Promise<Browser> => {
    while (admins.length <= index) {
      const made = await account();
      await t.kit.giveRole(made.account.id, {
        role: 'super_admin',
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      admins.push(made);
    }
    // The loop above filled the index.
    return admins[index] as Browser;
  };

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
    const tablesBefore = await rowsOfTables(t.database.migrator, CLOSING_TABLES);
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
      // Another branch's and an unknown student in a whole journal's list, beside an own
      // one: 404, never written (the body ids of .claude/rules/api.md; task 10.3b).
      for (const studentId of [other.bek, UNKNOWN]) {
        const whole = await post(
          b.s.branch,
          `/api/results/closing/${b.q1}/journals/${b.journal}/decisions`,
          { decision: 'keep', students: [b.bek, studentId] },
        );
        expect([whole.status, codeOf(whole)]).toEqual([404, 'not_found']);
      }
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
    expect(await rowsOfTables(t.database.migrator, CLOSING_TABLES)).toEqual(tablesBefore);
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
        // Task 9.2b (permission review must-fix 5): the close too.
        const closed = await post(
          b.s.branch,
          `/api/results/closing/${b.q1}/close`,
          { warnings: [], lockNow: true, startQuarter: null },
          randomUUID(),
        );
        expect([closed.status, codeOf(closed)]).toEqual([409, 'closing_not_open']);
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
    // The Principal reads the close too, and has no action (permission review should-fix 7).
    await as(await account(), [{ role: 'principal', branchId: b.s.branch }], async ({ get }) => {
      const read = checklistOf(await get(b.s.branch, path(b.q1)));
      expect([read.state, read.canEdit, read.closing?.version]).toEqual(['closed', false, 1]);
    });
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

  it("answers 404 for another branch's or an unknown quarter and journal, 403 to a role it refuses, and checks the key", async () => {
    const s = await publishedScene(t, load, { graded: true });
    const other = await publishedScene(t, load, { graded: true });
    const q1 = await quarterOf(s.year, 1);
    const otherQuarter = await quarterOf(other.year, 1);
    const foreignJournal = await journalOf(other.classId, other.subject);
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
    const tablesBefore = await rowsOfTables(t.database.migrator, CLOSING_TABLES);
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
        // A journal named by a warning of the body (code round 1, finding 1): another branch's
        // and an unknown one are 404, with a body the close otherwise takes (below, 200).
        for (const journalId of [foreignJournal, UNKNOWN]) {
          const refused = await post(
            s.branch,
            closePath(q1),
            {
              warnings: [...warnings, { kind: 'no_teacher', journalId }],
              lockNow: false,
              startQuarter: null,
            },
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
    expect(await rowsOfTables(t.database.migrator, CLOSING_TABLES)).toEqual(tablesBefore);
    const rowsBeforeRoles = await t.rowsOf(s.branch);
    const auditBeforeRoles = await t.auditCount();
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
    expect(await t.rowsOf(s.branch)).toEqual(rowsBeforeRoles);
    // The role given to each account writes its own entry; the close writes none.
    expect(
      await t.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('action', 'in', ['results.quarter_closed', 'plan.requests_voided'])
        .where('branch_id', '=', s.branch)
        .execute(),
    ).toEqual([]);
    expect(auditBeforeRoles).toBeGreaterThan(0);
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
        // The key repeated with a warning naming another branch's or an unknown journal:
        // 404, never the stored answer (task 10.3b).
        for (const journalId of [foreignJournal, UNKNOWN]) {
          const refused = await post(
            s.branch,
            closePath(q1),
            {
              warnings: [...warnings, { kind: 'no_teacher', journalId }],
              lockNow: false,
              startQuarter: null,
            },
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
    // The requests that wait on the held side's process (`.claude/rules/api.md`: a same-moment
    // test asserts that the request waited on the held transaction, `pg_blocking_pids`).
    const blockedBy = async (pid: number) => {
      const found = await sql<{ n: number }>`
        select count(*)::int as n from pg_stat_activity a
        where a.datname = current_database() and ${pid}::int = any(pg_blocking_pids(a.pid))
      `.execute(t.database.migrator);
      return found.rows[0]?.n ?? 0;
    };
    const untilWaiting = async (pid: number) => {
      for (let tries = 0; tries < 800; tries += 1) {
        if ((await blockedBy(pid)) >= 1) return;
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
      let ready: (pid: number) => void = () => undefined;
      const isReady = new Promise<number>((resolve) => {
        ready = resolve;
      });
      t.clock.set(moment);
      const done = t.app
        .get(Transactions)
        .run([branch], async (transaction) => {
          await work(transaction);
          const process = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
            transaction,
          );
          ready(process.rows[0]?.pid ?? 0);
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
      const pid = await held.isReady;
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
          await untilWaiting(pid);
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
      const pid = await held.isReady;
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
          await untilWaiting(pid);
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

    // Task 9.2c: the reopening and the journal's re-close against a correction, and a
    // recalculation applied against a journal's re-close (review must-fix 3; should-fix 9).
    const REOPEN_AT = '2026-11-02T09:00:00+05:00';
    const INSIDE_AT = '2026-11-03T10:00:00+05:00';

    /** The Academic Vice Principal's correction of Aziz on the 19th, present (was absent). */
    const correctAziz = (calls: Calls, b: Awaited<ReturnType<typeof base>>) =>
      calls.post(
        b.s.branch,
        `/api/journal/lessons/${b.lessons.l19.id}/attendance`,
        {
          saves: [{ studentId: b.aziz, mark: 1, version: 1 }],
          correction: { reason: 'The register shows him present' },
        },
        randomUUID(),
      );

    const reopenJournal = (b: Awaited<ReturnType<typeof base>>, accountId: string) =>
      reopenQuarter(t.database, {
        branchId: b.s.branch,
        quarterId: b.q1,
        journalId: b.journal,
        accountId,
        at: REOPEN_AT,
      });

    /** What a journal's re-close writes first: the quarter for update, its version. */
    const journalCloseRow =
      (b: Awaited<ReturnType<typeof base>>, by: string) => async (transaction: Transaction) => {
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
            version: 0,
            closed_at: new Date(0),
            closed_by: by,
            lock_now: false,
            start_quarter: null,
            warnings: '[]',
            cause: 'journal_close',
            journal_id: b.journal,
          })
          .execute();
      };

    it('a correction waits for a reopening held open and is taken once it commits', async () => {
      const b = await closed();
      const closer = await load.classes.account();
      const held = hold(b.s.branch, REOPEN_AT, async (transaction) => {
        const closing = await transaction
          .selectFrom('quarter_closings')
          .select('id')
          .where('quarter_id', '=', b.q1)
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('quarter_reopenings')
          .values({
            branch_id: b.s.branch,
            quarter_id: b.q1,
            closing_id: closing.id,
            journal_id: null,
            reason: 'A mark was typed in the wrong row',
            days: 3,
            reopened_at: new Date(0),
            open_until: new Date(0),
            reopened_by: closer,
          })
          .execute();
      });
      const pid = await held.isReady;
      const answer = await vice(
        b.s.branch,
        async (calls) => {
          const started = new Promise<Response>((resolve, reject) => {
            correctAziz(calls, b).then(resolve, reject);
          });
          await untilWaiting(pid);
          held.release();
          return started;
        },
        INSIDE_AT,
      );
      expect(await held.done).toBeUndefined();
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    });

    it('a correction in a reopened journal waits for its re-close held open and is refused', async () => {
      const b = await closed();
      const by = await load.classes.account();
      await reopenJournal(b, by);
      const held = hold(b.s.branch, INSIDE_AT, journalCloseRow(b, by));
      const pid = await held.isReady;
      const answer = await vice(
        b.s.branch,
        async (calls) => {
          const started = new Promise<Response>((resolve, reject) => {
            correctAziz(calls, b).then(resolve, reject);
          });
          await untilWaiting(pid);
          held.release();
          return started;
        },
        INSIDE_AT,
      );
      expect(await held.done).toBeUndefined();
      expect([answer.status, codeOf(answer)]).toEqual([409, 'quarter_closed']);
    });

    it('the re-close of a journal waits for a correction held open and stores the corrected result', async () => {
      const b = await closed();
      const by = await load.classes.account();
      await reopenJournal(b, by);
      const corrector = await account();
      await t.kit.giveRole(corrector.account.id, {
        role: 'academic_vice_principal',
        branchId: b.s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      const warnings = await vice(
        b.s.branch,
        async (calls) => {
          const list = checklistOf(await calls.get(b.s.branch, path(b.q1)));
          return warningsOf({ ...list, items: list.reopenedJournals[0]?.items ?? [] });
        },
        INSIDE_AT,
      );
      // The held side does what the correction does: the cell saved with its reason.
      const held = hold(b.s.branch, INSIDE_AT, async (transaction) => {
        await sql`select set_config('app.correction_reason', 'The register shows him present', true)`.execute(
          transaction,
        );
        await saveCells(transaction, t.app.get(Audit), { accountId: corrector.account.id }, [
          { lessonId: b.lessons.l19.id, studentId: b.aziz, workId: null, value: 1, version: 1 },
        ]);
      });
      const pid = await held.isReady;
      const answer = await vice(
        b.s.branch,
        async (calls) => {
          const started = new Promise<Response>((resolve, reject) => {
            calls
              .post(
                b.s.branch,
                `/api/results/closing/${b.q1}/journals/${b.journal}/close`,
                { warnings, lockNow: false },
                randomUUID(),
              )
              .then(resolve, reject);
          });
          await untilWaiting(pid);
          held.release();
          return started;
        },
        INSIDE_AT,
      );
      expect(await held.done).toBeUndefined();
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      const record = await t.database.migrator
        .selectFrom('quarter_final_results')
        .innerJoin('quarter_closings', 'quarter_closings.id', 'quarter_final_results.closing_id')
        .select('record')
        .where('quarter_closings.version', '=', 2)
        .where('quarter_final_results.quarter_id', '=', b.q1)
        .where('quarter_final_results.student_id', '=', b.aziz)
        .executeTakeFirstOrThrow();
      const lessons = (record.record as { inputs: { lessons: { mark: number | null }[] } }).inputs
        .lessons;
      // The 12th (1), the 19th corrected while the re-close waited (1), the 26th (none).
      expect(lessons.map((one) => one.mark)).toEqual([1, 1, null]);
    });

    /** A record the module would not make, of a student of the journal. */
    const corruptAziz = (b: Awaited<ReturnType<typeof base>>) =>
      t.database.migrator.transaction().execute(async (transaction) => {
        await sql`alter table quarter_final_results disable trigger quarter_final_results_merge_carry`.execute(
          transaction,
        );
        await transaction
          .updateTable('quarter_final_results')
          .set({ record: sql`jsonb_set(record, '{outcome,result,grade}', '2'::jsonb)` })
          .where('quarter_id', '=', b.q1)
          .where('student_id', '=', b.aziz)
          .execute();
        await sql`alter table quarter_final_results enable trigger quarter_final_results_merge_carry`.execute(
          transaction,
        );
      });
    const applyOf = (b: Awaited<ReturnType<typeof base>>) => ({
      reason: 'A rounding bug of an earlier release',
      students: [{ subjectId: b.s.subject, studentId: b.aziz }],
    });
    /** What an apply writes first: the quarter for update, its version `recalculation`. */
    const applyRow =
      (b: Awaited<ReturnType<typeof base>>, by: string) => async (transaction: Transaction) => {
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
            version: 0,
            closed_at: new Date(0),
            closed_by: by,
            lock_now: false,
            start_quarter: null,
            warnings: '[]',
            cause: 'recalculation',
            reason: 'A rounding bug of an earlier release',
          })
          .execute();
      };
    const versionsOf = (quarterId: string) =>
      t.database.migrator
        .selectFrom('quarter_closings')
        .select(['version', 'cause'])
        .where('quarter_id', '=', quarterId)
        .orderBy('version')
        .execute();

    it("a recalculation applied waits for a journal's re-close held open, and a journal's reopening waits for it", async () => {
      const b = await closed();
      const by = await load.classes.account();
      await reopenJournal(b, by);
      const admin = await sharedAdmin(0);
      await corruptAziz(b);
      const apply = applyOf(b);
      // The re-close held first: the apply waits on the quarter and stores the next version.
      const held = hold(b.s.branch, INSIDE_AT, journalCloseRow(b, by));
      const pid = await held.isReady;
      const answer = await as(
        admin,
        [],
        async ({ post }) => {
          const started = new Promise<Response>((resolve, reject) => {
            post(
              b.s.branch,
              `/api/results/closing/${b.q1}/recalculation/apply`,
              apply,
              randomUUID(),
            ).then(resolve, reject);
          });
          await untilWaiting(pid);
          held.release();
          return started;
        },
        INSIDE_AT,
      );
      expect(await held.done).toBeUndefined();
      expect([answer.status, answer.body]).toEqual([200, { version: 3, stored: 1 }]);
      // The other order: an apply held (the quarter for update, its version written) makes a
      // reopening of the journal wait, which then reads the close in force and is taken.
      const c = await closed();
      const held2 = hold(c.s.branch, REOPEN_AT, applyRow(c, by));
      const pid2 = await held2.isReady;
      const reopened = await vice(
        c.s.branch,
        async (calls) => {
          const started = new Promise<Response>((resolve, reject) => {
            calls
              .post(
                c.s.branch,
                `/api/results/closing/${c.q1}/reopen`,
                { journalId: c.journal, reason: 'A mark was typed in the wrong row', days: 3 },
                randomUUID(),
              )
              .then(resolve, reject);
          });
          await untilWaiting(pid2);
          held2.release();
          return started;
        },
        REOPEN_AT,
      );
      expect(await held2.done).toBeUndefined();
      expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
      expect(await versionsOf(c.q1)).toEqual([
        { version: 1, cause: 'close' },
        { version: 2, cause: 'recalculation' },
      ]);
    });

    // Spec review must-fix 1: the re-close of a reopened journal waits for an apply held open,
    // then reads the version it stored and is taken as the next one.
    it('the re-close of a journal waits for a recalculation applied held open and is taken after it', async () => {
      const b = await closed();
      const by = await load.classes.account();
      await reopenJournal(b, by);
      const warnings = await vice(
        b.s.branch,
        async (calls) => {
          const list = checklistOf(await calls.get(b.s.branch, path(b.q1)));
          return warningsOf({ ...list, items: list.reopenedJournals[0]?.items ?? [] });
        },
        INSIDE_AT,
      );
      const held = hold(b.s.branch, INSIDE_AT, applyRow(b, by));
      const pid = await held.isReady;
      const answer = await vice(
        b.s.branch,
        async (calls) => {
          const started = new Promise<Response>((resolve, reject) => {
            calls
              .post(
                b.s.branch,
                `/api/results/closing/${b.q1}/journals/${b.journal}/close`,
                { warnings, lockNow: false },
                randomUUID(),
              )
              .then(resolve, reject);
          });
          await untilWaiting(pid);
          held.release();
          return started;
        },
        INSIDE_AT,
      );
      expect(await held.done).toBeUndefined();
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect((answer.body as { version: number }).version).toBe(3);
      expect(await versionsOf(b.q1)).toEqual([
        { version: 1, cause: 'close' },
        { version: 2, cause: 'recalculation' },
        { version: 3, cause: 'journal_close' },
      ]);
    });

    // Spec review must-fix 1: an apply against a whole-branch reopening, in both orders. The
    // reopening held first: the apply waits on the quarter, then finds it no longer closed.
    it('a recalculation applied waits for a whole-branch reopening held open and is refused, and a reopening waits for it', async () => {
      const b = await closed();
      const by = await load.classes.account();
      await corruptAziz(b);
      const admin = await sharedAdmin(0);
      const held = hold(b.s.branch, REOPEN_AT, async (transaction) => {
        await transaction
          .selectFrom('quarters')
          .select('id')
          .where('id', '=', b.q1)
          .forUpdate()
          .execute();
        const closing = await transaction
          .selectFrom('quarter_closings')
          .select('id')
          .where('quarter_id', '=', b.q1)
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('quarter_reopenings')
          .values({
            branch_id: b.s.branch,
            quarter_id: b.q1,
            closing_id: closing.id,
            journal_id: null,
            reason: 'A mark was typed in the wrong row',
            days: 3,
            reopened_at: new Date(0),
            open_until: new Date(0),
            reopened_by: by,
          })
          .execute();
      });
      const pid = await held.isReady;
      const refused = await as(
        admin,
        [],
        async ({ post }) => {
          const started = new Promise<Response>((resolve, reject) => {
            post(
              b.s.branch,
              `/api/results/closing/${b.q1}/recalculation/apply`,
              applyOf(b),
              randomUUID(),
            ).then(resolve, reject);
          });
          await untilWaiting(pid);
          held.release();
          return started;
        },
        REOPEN_AT,
      );
      expect(await held.done).toBeUndefined();
      expect([refused.status, codeOf(refused)]).toEqual([409, 'quarter_not_closed']);
      expect(await versionsOf(b.q1)).toEqual([{ version: 1, cause: 'close' }]);
      // The apply held first: the whole-branch reopening waits, then reopens the close in force.
      const c = await closed();
      const held2 = hold(c.s.branch, REOPEN_AT, applyRow(c, by));
      const pid2 = await held2.isReady;
      const reopened = await vice(
        c.s.branch,
        async (calls) => {
          const started = new Promise<Response>((resolve, reject) => {
            calls
              .post(
                c.s.branch,
                `/api/results/closing/${c.q1}/reopen`,
                { journalId: null, reason: 'A mark was typed in the wrong row', days: 3 },
                randomUUID(),
              )
              .then(resolve, reject);
          });
          await untilWaiting(pid2);
          held2.release();
          return started;
        },
        REOPEN_AT,
      );
      expect(await held2.done).toBeUndefined();
      expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
      expect(await versionsOf(c.q1)).toEqual([
        { version: 1, cause: 'close' },
        { version: 2, cause: 'recalculation' },
      ]);
      const reopening = await t.database.migrator
        .selectFrom('quarter_reopenings')
        .innerJoin('quarter_closings', 'quarter_closings.id', 'quarter_reopenings.closing_id')
        .select(['quarter_closings.version', 'quarter_reopenings.journal_id'])
        .where('quarter_reopenings.quarter_id', '=', c.q1)
        .execute();
      expect(reopening).toEqual([{ version: 1, journal_id: null }]);
    });
  });

  // -------------------------------------------------------------------------
  // Task 9.2c (pull request #231): reopening and closing again, the versions of the results,
  // "recalculate and compare" (edge/journal, Closing and reopening: "Reopening is for one journal
  // or the whole branch, for a set number of days. Lessons stay locked; only corrections and
  // explicit unlocks apply. The earlier final results are kept as a version. Closing again lists
  // every result that changed"; edge/calculation, "A bug is found after results were closed and
  // exported"; edge/system-behaviour, "The nightly check").
  /** The base scene closed at CLOSE, every flag decided ("keep"), lock now. */
  const closed = async () => closeBase(await base());
  const closeBase = async (b: Awaited<ReturnType<typeof base>>) => {
    await vice(
      b.s.branch,
      async (calls) => {
        const list = await decideAll(calls, b.s.branch, b.q1);
        const done = await calls.post(
          b.s.branch,
          closePath(b.q1),
          { warnings: warningsOf(list), lockNow: true, startQuarter: null },
          randomUUID(),
        );
        expect(done.status, JSON.stringify(done.body)).toBe(200);
      },
      CLOSE,
    );
    return b;
  };

  describe('reopening (task 9.2c)', () => {
    /** Monday 2 November, 09:00: a reopening for 3 days is open until 00:00 of 6 November. */
    const REOPEN = '2026-11-02T09:00:00+05:00';
    const INSIDE = '2026-11-03T10:00:00+05:00';
    const AFTER_END = '2026-11-06T09:00:00+05:00';
    const reopenPath = (quarterId: string) => `/api/results/closing/${quarterId}/reopen`;
    const journalClosePath = (quarterId: string, journalId: string) =>
      `/api/results/closing/${quarterId}/journals/${journalId}/close`;
    const recalculationPath = (quarterId: string) =>
      `/api/results/closing/${quarterId}/recalculation`;

    /** Dilshod present on the 12th, as the Academic Vice Principal's correction. */
    const correctDilshod = (calls: Calls, b: Awaited<ReturnType<typeof base>>) =>
      calls.post(
        b.s.branch,
        `/api/journal/lessons/${b.lessons.l12.id}/attendance`,
        {
          saves: [{ studentId: b.dilshod, mark: 1, version: null }],
          correction: { reason: 'The register shows him present' },
        },
        randomUUID(),
      );

    /**
     * A used key repeated (.claude/rules/api.md): with another branch's and an unknown id 404, from
     * a role the route refuses 403, never the stored answer.
     */
    const repeatsRefused = async (
      repeat: (quarterId: string, journalId?: string) => Promise<Response>,
      ids: { other: string; otherJournal?: string; journal?: string; quarter: string },
    ) => {
      const answers = [await repeat(ids.other), await repeat(UNKNOWN)];
      if (ids.journal !== undefined && ids.otherJournal !== undefined) {
        answers.push(
          await repeat(ids.quarter, ids.otherJournal),
          await repeat(ids.quarter, UNKNOWN),
        );
      }
      for (const answer of answers) {
        expect([answer.status, codeOf(answer)]).toEqual([404, 'not_found']);
      }
    };

    const resultOf = async (calls: Calls, b: Awaited<ReturnType<typeof base>>, id: string) =>
      studentResultsSchema
        .parse((await calls.get(b.s.branch, `/api/results/students/${id}`)).body)
        .subjects.find((one) => one.subject.id === b.s.subject)?.quarters[0]?.outcome;

    const versionsOf = (quarter: string) =>
      t.database.migrator
        .selectFrom('quarter_closings')
        .select(['id', 'version', 'cause', 'journal_id', 'reopened_at', 'changes'])
        .where('quarter_id', '=', quarter)
        .orderBy('version')
        .execute();

    it('reopens the whole branch, takes a correction, lists the result that changed and closes again as version 2', async () => {
      const b = await closed();
      const other = await base();
      const key = randomUUID();
      const body = { journalId: null, reason: 'A mark was typed in the wrong row', days: 3 };
      const reopened = await vice(
        b.s.branch,
        async (calls) => {
          const done = await calls.post(b.s.branch, reopenPath(b.q1), body, key);
          expect(done.status, JSON.stringify(done.body)).toBe(200);
          // Repeat-safe: the stored answer.
          const repeat = await calls.post(b.s.branch, reopenPath(b.q1), body, key);
          expect([repeat.status, repeat.body]).toEqual([200, done.body]);
          await repeatsRefused(
            (quarter) => calls.post(b.s.branch, reopenPath(quarter), body, key),
            {
              other: other.q1,
              quarter: b.q1,
            },
          );
          for (const journalId of [other.journal, UNKNOWN]) {
            const answer = await calls.post(
              b.s.branch,
              reopenPath(b.q1),
              { ...body, journalId },
              key,
            );
            expect([answer.status, codeOf(answer)]).toEqual([404, 'not_found']);
          }
          return done.body as { id: string; openUntil: string };
        },
        REOPEN,
      );
      await as(
        await account(),
        [{ role: 'principal', branchId: b.s.branch }],
        async ({ post }) => {
          expect((await post(b.s.branch, reopenPath(b.q1), body, key)).status).toBe(403);
        },
        REOPEN,
      );
      expect(new Date(reopened.openUntil)).toEqual(new Date('2026-11-06T00:00:00+05:00'));
      // The same key from another account is refused (.claude/rules/api.md).
      await vice(
        b.s.branch,
        async (calls) => {
          const reused = await calls.post(b.s.branch, reopenPath(b.q1), body, key);
          expect([reused.status, codeOf(reused)]).toEqual([409, 'request_key_reused']);
        },
        REOPEN,
      );
      await vice(
        b.s.branch,
        async (calls) => {
          const open = checklistOf(await calls.get(b.s.branch, path(b.q1)));
          expect([open.state, open.closing, open.reopening?.id]).toEqual([
            'open',
            null,
            reopened.id,
          ]);
          expect(open.changes).toEqual([]);
          // edge/journal: "Lessons stay locked": a plain entry is refused by the guard during the
          // reopening ("takes a correction, refuses a plain entry" of
          // quarter-reopen.database.test.ts); the Academic Vice Principal enters corrections.
          const corrected = await correctDilshod(calls, b);
          expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
          const after = checklistOf(await calls.get(b.s.branch, path(b.q1)));
          expect(
            after.changes.map((one) => [one.student.id, one.before?.kind, one.after.kind]),
          ).toEqual([[b.dilshod, 'no_result', 'number']]);
          // The result is provisional while reopened: read live.
          expect((await resultOf(calls, b, b.dilshod))?.kind).toBe('number');
        },
        INSIDE,
      );
      // Review must-fix 1: the end of the reopening passed; the flag is still decided, then the
      // quarter is closed again.
      const answer = await vice(
        b.s.branch,
        async (calls) => {
          const late = await correctDilshod(calls, b);
          expect([late.status, codeOf(late)]).toEqual([409, 'quarter_closed']);
          const list = checklistOf(await calls.get(b.s.branch, path(b.q1)));
          expect(list.reopening?.ended).toBe(true);
          expect(studentIdsOf(itemsOf(list, 'undecided'))).toEqual([b.dilshod]);
          const decided = await decideAll(calls, b.s.branch, b.q1);
          expect(decided.closable).toBe(true);
          const done = await calls.post(
            b.s.branch,
            closePath(b.q1),
            { warnings: warningsOf(decided), lockNow: false, startQuarter: null },
            randomUUID(),
          );
          expect(done.status, JSON.stringify(done.body)).toBe(200);
          return closingClosedSchema.parse(done.body);
        },
        AFTER_END,
      );
      expect(answer.version).toBe(2);
      const versions = await versionsOf(b.q1);
      expect(versions.map((one) => [one.version, one.cause, one.reopened_at === null])).toEqual([
        [1, 'close', false],
        [2, 'close', true],
      ]);
      // "Closing again lists every result that changed": stored with the close.
      expect(
        (versions[1]?.changes as { studentId: string; before: { kind: string } }[]).map((one) => [
          one.studentId,
          one.before.kind,
        ]),
      ).toEqual([[b.dilshod, 'no_result']]);
      // "The earlier final results are kept as a version": both sets stored.
      const records = await t.database.migrator
        .selectFrom('quarter_final_results')
        .select(['closing_id', 'student_id', 'record'])
        .where('quarter_id', '=', b.q1)
        .where('student_id', '=', b.dilshod)
        .execute();
      const byClosing = new Map(
        records.map((one) => [one.closing_id, storedQuarterOutcome(one.record).kind]),
      );
      expect(byClosing).toEqual(
        new Map([
          [versions[0]?.id, 'no_result'],
          [versions[1]?.id, 'number'],
        ]),
      );
      // The readers read the version in force: version 2's number.
      await vice(
        b.s.branch,
        async (calls) => {
          expect((await resultOf(calls, b, b.dilshod))?.kind).toBe('number');
          const list = checklistOf(await calls.get(b.s.branch, path(b.q1)));
          expect([list.state, list.closing?.version]).toEqual(['closed', 2]);
          expect(list.reopenings.map((one) => one.closedAgainVersion)).toEqual([2]);
        },
        AFTER_END,
      );
      const entries = await t.database.migrator
        .selectFrom('audit_log')
        .select(['action', 'new_value'])
        .where('branch_id', '=', b.s.branch)
        .where('action', 'in', ['results.quarter_reopened', 'results.quarter_closed'])
        .orderBy('occurred_at')
        .execute();
      expect(entries.map((one) => one.action)).toEqual([
        'results.quarter_closed',
        'results.quarter_reopened',
        'results.quarter_closed',
      ]);
      expect(entries[1]?.new_value).toMatchObject({ days: 3, journalId: null, version: 1 });
    });

    it('reopens one journal: its correction, its own items and changes, closed again with its students only', async () => {
      const b = await closed();
      const otherJournal = await journalOf(b.s.otherClass, b.s.subject);
      const firstRecords = await t.database.migrator
        .selectFrom('quarter_final_results')
        .select(['journal_id', 'student_id', 'record'])
        .where('quarter_id', '=', b.q1)
        .orderBy('student_id')
        .execute();
      const other = await base();
      const key = randomUUID();
      const id = await vice(
        b.s.branch,
        async (calls) => {
          const done = await calls.post(
            b.s.branch,
            reopenPath(b.q1),
            { journalId: b.journal, reason: 'A mark was typed in the wrong row', days: 3 },
            randomUUID(),
          );
          expect(done.status, JSON.stringify(done.body)).toBe(200);
          return (done.body as { id: string }).id;
        },
        REOPEN,
      );
      await vice(
        b.s.branch,
        async (calls) => {
          const before = checklistOf(await calls.get(b.s.branch, path(b.q1)));
          expect(before.state).toBe('closed');
          expect(before.reopenedJournals.map((one) => one.reopening.id)).toEqual([id]);
          expect(before.closedJournals.map((one) => one.id)).toContain(b.journal);
          // The grid of the reopened journal reads live (not closed).
          const grid = journalGridSchema.parse(
            (await calls.get(b.s.branch, `/api/journal/journals/${b.journal}?quarterId=${b.q1}`))
              .body,
          );
          expect(grid.quarter.closed).toBe(false);
          expect((await correctDilshod(calls, b)).status).toBe(200);
          const after = checklistOf(await calls.get(b.s.branch, path(b.q1)));
          const panel = after.reopenedJournals[0];
          expect(panel?.changes.map((one) => one.student.id)).toEqual([b.dilshod]);
          expect(panel?.items.some((item) => item.kind === 'undecided')).toBe(true);
          expect(panel?.closable).toBe(false);
          const blocked = await calls.post(
            b.s.branch,
            journalClosePath(b.q1, b.journal),
            { warnings: [], lockNow: false },
            randomUUID(),
          );
          expect([blocked.status, codeOf(blocked)]).toEqual([409, 'closing_blocked']);
          const decided = await calls.put(b.s.branch, `/api/results/closing/${b.q1}/decisions`, {
            subjectId: b.s.subject,
            studentId: b.dilshod,
            decision: 'keep',
            version: null,
          });
          expect(decided.status, JSON.stringify(decided.body)).toBe(200);
          const ready = checklistOf(await calls.get(b.s.branch, path(b.q1)));
          const journal = ready.reopenedJournals[0];
          expect(journal?.closable).toBe(true);
          const closeBody = {
            warnings: warningsOf({ ...ready, items: journal?.items ?? [] }),
            lockNow: false,
          };
          // Permission review should-fix 9: a warning naming another journal of the branch is
          // none of this journal's (409); one of another branch or unknown is not found (404).
          const naming = (journalId: string) => ({
            ...closeBody,
            warnings: [...closeBody.warnings, { kind: 'no_teacher' as const, journalId }],
          });
          const stale = await calls.post(
            b.s.branch,
            journalClosePath(b.q1, b.journal),
            naming(otherJournal),
            randomUUID(),
          );
          expect([stale.status, codeOf(stale)]).toEqual([409, 'closing_warnings_changed']);
          for (const journalId of [other.journal, UNKNOWN]) {
            const unknown = await calls.post(
              b.s.branch,
              journalClosePath(b.q1, b.journal),
              naming(journalId),
              randomUUID(),
            );
            expect([unknown.status, codeOf(unknown)]).toEqual([404, 'not_found']);
          }
          const done = await calls.post(
            b.s.branch,
            journalClosePath(b.q1, b.journal),
            closeBody,
            key,
          );
          expect(done.status, JSON.stringify(done.body)).toBe(200);
          expect(closingClosedSchema.parse(done.body).version).toBe(2);
          const repeat = await calls.post(
            b.s.branch,
            journalClosePath(b.q1, b.journal),
            closeBody,
            key,
          );
          expect([repeat.status, repeat.body]).toEqual([200, done.body]);
          await repeatsRefused(
            (quarter, journalId = b.journal) =>
              calls.post(b.s.branch, journalClosePath(quarter, journalId), closeBody, key),
            { other: other.q1, quarter: b.q1, journal: b.journal, otherJournal: other.journal },
          );
          // The key repeated with a warning naming another branch's or an unknown journal:
          // 404, never the stored answer (task 10.3b).
          for (const journalId of [other.journal, UNKNOWN]) {
            const answer = await calls.post(
              b.s.branch,
              journalClosePath(b.q1, b.journal),
              naming(journalId),
              key,
            );
            expect([answer.status, codeOf(answer)]).toEqual([404, 'not_found']);
          }
          const final = checklistOf(await calls.get(b.s.branch, path(b.q1)));
          expect(final.reopenedJournals).toEqual([]);
          expect(final.reopenings.map((one) => one.closedAgainVersion)).toEqual([2]);
          expect((await resultOf(calls, b, b.dilshod))?.kind).toBe('number');
        },
        INSIDE,
      );
      // The same key from another account: 409; from a role the route refuses: 403.
      const closeAgain = journalClosePath(b.q1, b.journal);
      await vice(
        b.s.branch,
        async (calls) => {
          const reused = await calls.post(
            b.s.branch,
            closeAgain,
            { warnings: [], lockNow: false },
            key,
          );
          expect([reused.status, codeOf(reused)]).toEqual([409, 'request_key_reused']);
        },
        INSIDE,
      );
      await as(
        await account(),
        [{ role: 'principal', branchId: b.s.branch }],
        async ({ post }) => {
          const refused = await post(b.s.branch, closeAgain, { warnings: [], lockNow: false }, key);
          expect(refused.status).toBe(403);
        },
        INSIDE,
      );
      const versions = await versionsOf(b.q1);
      expect(
        versions.map((one) => [one.version, one.cause, one.journal_id, one.reopened_at]),
      ).toEqual([
        [1, 'close', null, null],
        [2, 'journal_close', b.journal, null],
      ]);
      // Version 2 holds the reopened journal's students only; version 1 is kept as it was.
      const recordsOf = (closingId: string) =>
        t.database.migrator
          .selectFrom('quarter_final_results')
          .select(['journal_id', 'student_id', 'record'])
          .where('closing_id', '=', closingId)
          .orderBy('student_id')
          .execute();
      const second = await recordsOf(versions[1]?.id ?? '');
      expect(second.map((one) => one.student_id)).toContain(b.dilshod);
      expect(new Set(second.map((one) => one.journal_id))).toEqual(new Set([b.journal]));
      expect(await recordsOf(versions[0]?.id ?? '')).toEqual(firstRecords);
      // Spec review must-fix 7: the readers of "closed" take the version in force, where
      // version 1 and 2 differ. The grid: Dilshod's result is version 2's (version 1: no result).
      const dilshodInGrid = await vice(
        b.s.branch,
        async (calls) =>
          journalGridSchema
            .parse(
              (await calls.get(b.s.branch, `/api/journal/journals/${b.journal}?quarterId=${b.q1}`))
                .body,
            )
            .students.find((one) => one.id === b.dilshod)?.quarter?.result,
        INSIDE,
      );
      expect(dilshodInGrid?.kind).toBe('number');
      const dilshodBefore = firstRecords.find((one) => one.student_id === b.dilshod);
      expect(storedShown(dilshodBefore?.record).kind).toBe('no_result');
      // The export's "Final" line: version 2 and its date for the journal closed again, version 1
      // for the other journal.
      const finals = await t.app
        .get(Transactions)
        .run([b.s.branch], async (transaction) => [
          await journalFinalOf(transaction, b.q1, b.journal),
          await journalFinalOf(transaction, b.q1, otherJournal),
        ]);
      expect(finals.map((one) => [one?.version, one?.closedAt.toISOString()])).toEqual([
        [2, new Date(INSIDE).toISOString()],
        [1, new Date(CLOSE).toISOString()],
      ]);
    });

    // .claude/rules/journal.md: a grant that opens one record is refused on another, at the route.
    it("refuses, while one journal is reopened, another journal's correction and decisions", async () => {
      const b = await base();
      const [o12, o19] = await lessonsOf(b.s.otherClass);
      if (o12 === undefined || o19 === undefined) throw new Error('Lessons of the other class.');
      const murod = await student(b.s.branch, { first: 'Murod', last: 'Aliyev' }, [
        { classId: b.s.otherClass, from: '2026-09-01' },
      ]);
      // One mark: his result is flagged, so the close stores a decision for him.
      await saveOn(b.s.branch, o12.date, [{ lessonId: o12.id, studentId: murod, value: 1 }]);
      const other = await journalOf(b.s.otherClass, b.s.subject);
      await closeBase(b);
      const stored = await t.database.migrator
        .selectFrom('quarter_result_decisions')
        .select('version')
        .where('quarter_id', '=', b.q1)
        .where('student_id', '=', murod)
        .executeTakeFirstOrThrow();
      await vice(
        b.s.branch,
        async (calls) => {
          const done = await calls.post(
            b.s.branch,
            reopenPath(b.q1),
            { journalId: b.journal, reason: 'A mark was typed in the wrong row', days: 3 },
            randomUUID(),
          );
          expect(done.status, JSON.stringify(done.body)).toBe(200);
        },
        REOPEN,
      );
      await vice(
        b.s.branch,
        async (calls) => {
          // The reopened journal takes its correction; the other journal of the quarter does not.
          expect((await correctDilshod(calls, b)).status).toBe(200);
          const correction = await calls.post(
            b.s.branch,
            `/api/journal/lessons/${o19.id}/attendance`,
            {
              saves: [{ studentId: murod, mark: 1, version: null }],
              correction: { reason: 'The register shows him present' },
            },
            randomUUID(),
          );
          expect([correction.status, codeOf(correction)]).toEqual([409, 'quarter_closed']);
          // Murod is flagged under the other journal, with his stored decision's version: only the
          // reopening decides the refusal.
          const list = checklistOf(await calls.get(b.s.branch, path(b.q1)));
          expect(list.closedJournals.map((one) => one.id)).toContain(other);
          const one = await calls.put(b.s.branch, `/api/results/closing/${b.q1}/decisions`, {
            subjectId: b.s.subject,
            studentId: murod,
            decision: 'keep',
            version: stored.version,
          });
          expect([one.status, codeOf(one)]).toEqual([409, 'quarter_closed']);
          const whole = await calls.post(
            b.s.branch,
            `/api/results/closing/${b.q1}/journals/${other}/decisions`,
            { decision: 'keep', students: [murod] },
          );
          expect([whole.status, codeOf(whole)]).toEqual([409, 'quarter_closed']);
        },
        INSIDE,
      );
    });

    it('refuses a reopening of an open quarter, twice, of the branch while a journal is, and in a closed year', async () => {
      const b = await base();
      const body = { journalId: null, reason: 'A mark was typed in the wrong row', days: 3 };
      await vice(b.s.branch, async (calls) => {
        const open = await calls.post(b.s.branch, reopenPath(b.q1), body, randomUUID());
        expect([open.status, codeOf(open)]).toEqual([409, 'quarter_not_closed']);
        const journal = await calls.post(
          b.s.branch,
          journalClosePath(b.q1, b.journal),
          { warnings: [], lockNow: false },
          randomUUID(),
        );
        expect([journal.status, codeOf(journal)]).toEqual([409, 'quarter_not_closed']);
        const recalculation = await calls.get(b.s.branch, recalculationPath(b.q1));
        expect([recalculation.status, codeOf(recalculation)]).toEqual([409, 'quarter_not_closed']);
      });
      const c = await closed();
      const lateClass = await load.classes.schoolClass(c.s.branch, c.s.year, { grade: 7 });
      const lateJournal = (
        await t.database.migrator
          .insertInto('journals')
          .values({
            branch_id: c.s.branch,
            academic_year_id: c.s.year,
            class_id: lateClass,
            group_id: null,
            subject_id: c.s.subject,
            runs: '{[2026-11-01,)}',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await vice(
        c.s.branch,
        async (calls) => {
          const notReopened = await calls.post(
            c.s.branch,
            journalClosePath(c.q1, c.journal),
            { warnings: [], lockNow: false },
            randomUUID(),
          );
          expect([notReopened.status, codeOf(notReopened)]).toEqual([
            409,
            'closing_journal_not_reopened',
          ]);
          const first = await calls.post(
            c.s.branch,
            reopenPath(c.q1),
            { ...body, journalId: c.journal },
            randomUUID(),
          );
          expect(first.status).toBe(200);
          const twice = await calls.post(
            c.s.branch,
            reopenPath(c.q1),
            { ...body, journalId: c.journal },
            randomUUID(),
          );
          expect([twice.status, codeOf(twice)]).toEqual([409, 'quarter_reopened']);
          const whole = await calls.post(c.s.branch, reopenPath(c.q1), body, randomUUID());
          expect([whole.status, codeOf(whole)]).toEqual([409, 'quarter_journal_reopened']);
          // A journal of the branch and year that the close did not store (opened after it):
          // the database's refusal, mapped by the route (.claude/rules/api.md).
          const notClosed = await calls.post(
            c.s.branch,
            reopenPath(c.q1),
            { ...body, journalId: lateJournal },
            randomUUID(),
          );
          expect([notClosed.status, codeOf(notClosed)]).toEqual([
            409,
            'closing_journal_not_closed',
          ]);
        },
        REOPEN,
      );
      const d = await closed();
      await t.database.migrator
        .updateTable('academic_years')
        .set({ status: 'closed' })
        .where('id', '=', d.s.year)
        .execute();
      await vice(
        d.s.branch,
        async (calls) => {
          const year = await calls.post(d.s.branch, reopenPath(d.q1), body, randomUUID());
          expect([year.status, codeOf(year)]).toEqual([409, 'year_closed']);
        },
        REOPEN,
      );
    });

    it("answers 404 for another branch's and an unknown quarter and journal, the rows and the audit log unchanged", async () => {
      const b = await closed();
      const other = await closed();
      const stateOf = async () => ({
        reopenings: await t.database.migrator
          .selectFrom('quarter_reopenings')
          .selectAll()
          .execute(),
        closings: await t.database.migrator.selectFrom('quarter_closings').select('id').execute(),
        audit: await t.database.migrator.selectFrom('audit_log').select('id').execute(),
      });
      // The roles are given first: giving one writes to the audit log.
      const viceBrowser = await account();
      const principal = await account();
      for (const [browser, role] of [
        [viceBrowser, 'academic_vice_principal'],
        [principal, 'principal'],
      ] as const) {
        await t.kit.giveRole(browser.account.id, {
          role,
          branchId: b.s.branch,
          validFrom: new Date('2026-09-01T00:00:00+05:00'),
        });
      }
      const before = await stateOf();
      const tablesBefore = await rowsOfTables(t.database.migrator, CLOSING_TABLES);
      const rowsBefore = {
        north: await t.rowsOf(b.s.branch),
        south: await t.rowsOf(other.s.branch),
      };
      const auditBefore = await t.auditCount();
      await as(
        viceBrowser,
        [],
        async (calls) => {
          const body = (journalId: string | null) => ({
            journalId,
            reason: 'A mark was typed in the wrong row',
            days: 3,
          });
          for (const answer of [
            await calls.post(b.s.branch, reopenPath(other.q1), body(null), randomUUID()),
            await calls.post(b.s.branch, reopenPath(UNKNOWN), body(null), randomUUID()),
            await calls.post(b.s.branch, reopenPath(b.q1), body(other.journal), randomUUID()),
            await calls.post(b.s.branch, reopenPath(b.q1), body(UNKNOWN), randomUUID()),
            await calls.post(
              b.s.branch,
              journalClosePath(b.q1, other.journal),
              { warnings: [], lockNow: false },
              randomUUID(),
            ),
            await calls.post(
              b.s.branch,
              journalClosePath(other.q1, b.journal),
              { warnings: [], lockNow: false },
              randomUUID(),
            ),
            await calls.post(
              b.s.branch,
              journalClosePath(b.q1, UNKNOWN),
              { warnings: [], lockNow: false },
              randomUUID(),
            ),
            await calls.post(
              b.s.branch,
              journalClosePath(UNKNOWN, b.journal),
              { warnings: [], lockNow: false },
              randomUUID(),
            ),
            await calls.get(b.s.branch, recalculationPath(other.q1)),
            await calls.get(b.s.branch, recalculationPath(UNKNOWN)),
          ]) {
            expect([answer.status, codeOf(answer)]).toEqual([404, 'not_found']);
          }
        },
        REOPEN,
      );
      // The Principal reads, and may not reopen.
      await as(
        principal,
        [],
        async ({ post }) => {
          const refused = await post(
            b.s.branch,
            reopenPath(b.q1),
            { journalId: null, reason: 'A mark was typed in the wrong row', days: 3 },
            randomUUID(),
          );
          expect(refused.status).toBe(403);
        },
        REOPEN,
      );
      const after = await stateOf();
      expect(after).toEqual(before);
      expect(await rowsOfTables(t.database.migrator, CLOSING_TABLES)).toEqual(tablesBefore);
      expect(await t.auditCount()).toBe(auditBefore);
      expect(await t.rowsOf(b.s.branch)).toEqual(rowsBefore.north);
      expect(await t.rowsOf(other.s.branch)).toEqual(rowsBefore.south);
    });

    // The Super Admin's "apply" holds the branch of the request only; its ids are still checked.
    it("answers 404 to the Super Admin's apply for another branch's and an unknown quarter, student and subject, changing no row", async () => {
      const b = await closed();
      const other = await closed();
      const rowsBefore = {
        north: await t.rowsOf(b.s.branch),
        south: await t.rowsOf(other.s.branch),
      };
      const tablesBefore = await rowsOfTables(t.database.migrator, CLOSING_TABLES);
      const auditBefore = await t.auditCount();
      const apply = {
        reason: 'A rounding bug of an earlier release',
        students: [{ subjectId: b.s.subject, studentId: b.aziz }],
      };
      await as(
        await sharedAdmin(1),
        [],
        async ({ post }) => {
          for (const quarter of [other.q1, UNKNOWN]) {
            const answer = await post(
              b.s.branch,
              `${recalculationPath(quarter)}/apply`,
              apply,
              randomUUID(),
            );
            expect([answer.status, codeOf(answer)]).toEqual([404, 'not_found']);
          }
          // A student of another branch or unknown, an unknown subject (task 10.3b).
          for (const row of [
            { subjectId: b.s.subject, studentId: other.aziz },
            { subjectId: b.s.subject, studentId: UNKNOWN },
            { subjectId: UNKNOWN, studentId: b.aziz },
          ]) {
            const answer = await post(
              b.s.branch,
              `${recalculationPath(b.q1)}/apply`,
              { ...apply, students: [row] },
              randomUUID(),
            );
            expect([answer.status, codeOf(answer)]).toEqual([404, 'not_found']);
          }
        },
        REOPEN,
      );
      expect(await t.auditCount()).toBe(auditBefore);
      expect(await t.rowsOf(b.s.branch)).toEqual(rowsBefore.north);
      expect(await t.rowsOf(other.s.branch)).toEqual(rowsBefore.south);
      expect(await rowsOfTables(t.database.migrator, CLOSING_TABLES)).toEqual(tablesBefore);
    });

    // edge/calculation, "A bug is found after results were closed and exported" (decision 10).
    it('lists a record the current module calculates otherwise, and applies it with a reason as a new version', async () => {
      const owner = await account();
      const b = await closeBase(await base({ teacher: owner.account.id }));
      // Permission review should-fix 8: the owner of the other class's journal, which has no
      // change, and a teacher of another branch's journal are told nothing.
      // The scene makes that teacher without an account; linked here as one made with it (the
      // link is fixed once made, so the migrator writes past that guard).
      const unchanged = await account();
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`alter table staff disable trigger user`.execute(transaction);
        await transaction
          .updateTable('staff')
          .set({ account_id: unchanged.account.id })
          .where('id', '=', b.s.otherTeacher.staffId)
          .execute();
        await sql`alter table staff enable trigger user`.execute(transaction);
      });
      const elsewhere = await account();
      const other = await base({ teacher: elsewhere.account.id });
      const admin = await sharedAdmin(0);
      const applyKey = randomUUID();
      await vice(
        b.s.branch,
        async (calls) => {
          const same = await calls.get(b.s.branch, recalculationPath(b.q1));
          expect(same.status, JSON.stringify(same.body)).toBe(200);
          expect((same.body as { rows: unknown[] }).rows).toEqual([]);
        },
        REOPEN,
      );
      // A stored outcome the module would not make (a bug in an earlier release, as the
      // migrator writes it): Aziz's shown result is off by one.
      const aziz = await t.database.migrator
        .selectFrom('quarter_final_results')
        .select(['id', 'record'])
        .where('quarter_id', '=', b.q1)
        .where('student_id', '=', b.aziz)
        .executeTakeFirstOrThrow();
      const shown = (aziz.record as { outcome: { result: { shown: string } } }).outcome.result
        .shown;
      // The record is append-only for everyone but its owner, which writes past its trigger.
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`alter table quarter_final_results disable trigger quarter_final_results_merge_carry`.execute(
          transaction,
        );
        await transaction
          .updateTable('quarter_final_results')
          .set({
            record: sql`jsonb_set(record, '{outcome,result,shown}', to_jsonb(${String(Number(shown) - 1)}::text))`,
          })
          .where('id', '=', aziz.id)
          .execute();
        await sql`alter table quarter_final_results enable trigger quarter_final_results_merge_carry`.execute(
          transaction,
        );
      });
      const listed = await vice(
        b.s.branch,
        async (calls) => {
          const answer = await calls.get(b.s.branch, recalculationPath(b.q1));
          expect(answer.status).toBe(200);
          return answer.body as {
            rows: { student: { id: string }; subject: { id: string }; differences: string[] }[];
          };
        },
        REOPEN,
      );
      expect(listed.rows.map((one) => [one.student.id, one.differences])).toEqual([
        [b.aziz, ['result.shown']],
      ]);
      // "Apply" is the Super Admin's (decision 10): the Academic Vice Principal is refused.
      const apply = {
        reason: 'A rounding bug of an earlier release',
        students: [{ subjectId: b.s.subject, studentId: b.aziz }],
      };
      await vice(
        b.s.branch,
        async (calls) => {
          const refused = await calls.post(
            b.s.branch,
            `${recalculationPath(b.q1)}/apply`,
            apply,
            randomUUID(),
          );
          expect(refused.status).toBe(403);
        },
        REOPEN,
      );
      await as(
        admin,
        [],
        async ({ post, get }) => {
          const changed = await post(
            b.s.branch,
            `${recalculationPath(b.q1)}/apply`,
            { ...apply, students: [{ subjectId: b.s.subject, studentId: b.bek }] },
            randomUUID(),
          );
          expect([changed.status, codeOf(changed)]).toEqual([409, 'recalculation_changed']);
          const done = await post(b.s.branch, `${recalculationPath(b.q1)}/apply`, apply, applyKey);
          expect(done.status, JSON.stringify(done.body)).toBe(200);
          expect(done.body).toEqual({ version: 2, stored: 1 });
          const repeat = await post(
            b.s.branch,
            `${recalculationPath(b.q1)}/apply`,
            apply,
            applyKey,
          );
          expect([repeat.status, repeat.body]).toEqual([200, done.body]);
          await repeatsRefused(
            (quarter) => post(b.s.branch, `${recalculationPath(quarter)}/apply`, apply, applyKey),
            { other: other.q1, quarter: b.q1 },
          );
          // The key repeated with a student of another branch or unknown, or an unknown
          // subject: 404, never the stored answer (task 10.3b).
          for (const row of [
            { subjectId: b.s.subject, studentId: other.aziz },
            { subjectId: b.s.subject, studentId: UNKNOWN },
            { subjectId: UNKNOWN, studentId: b.aziz },
          ]) {
            const answer = await post(
              b.s.branch,
              `${recalculationPath(b.q1)}/apply`,
              { ...apply, students: [row] },
              applyKey,
            );
            expect([answer.status, codeOf(answer)]).toEqual([404, 'not_found']);
          }
          const again = await get(b.s.branch, recalculationPath(b.q1));
          expect((again.body as { rows: unknown[] }).rows).toEqual([]);
          const nothing = await post(
            b.s.branch,
            `${recalculationPath(b.q1)}/apply`,
            apply,
            randomUUID(),
          );
          expect([nothing.status, codeOf(nothing)]).toEqual([409, 'recalculation_nothing']);
        },
        REOPEN,
      );
      // The same key from another Super Admin: 409; from the Academic Vice Principal: 403.
      await as(
        await sharedAdmin(1),
        [],
        async ({ post }) => {
          const reused = await post(
            b.s.branch,
            `${recalculationPath(b.q1)}/apply`,
            apply,
            applyKey,
          );
          expect([reused.status, codeOf(reused)]).toEqual([409, 'request_key_reused']);
        },
        REOPEN,
      );
      await vice(
        b.s.branch,
        async (calls) => {
          const refused = await calls.post(
            b.s.branch,
            `${recalculationPath(b.q1)}/apply`,
            apply,
            applyKey,
          );
          expect(refused.status).toBe(403);
        },
        REOPEN,
      );
      // The old record is kept; the new one is the module's.
      const kept = await t.database.migrator
        .selectFrom('quarter_final_results')
        .innerJoin('quarter_closings', 'quarter_closings.id', 'quarter_final_results.closing_id')
        .select(['quarter_closings.version', 'quarter_closings.cause', 'record'])
        .where('quarter_final_results.student_id', '=', b.aziz)
        .orderBy('quarter_closings.version')
        .execute();
      expect(kept.map((one) => [one.version, one.cause])).toEqual([
        [1, 'close'],
        [2, 'recalculation'],
      ]);
      expect(recalculateAndCompare(kept[1]?.record).same).toBe(true);
      // "The teachers concerned are told."
      const notices = await t.database.migrator
        .selectFrom('notifications')
        .select('data')
        .where('kind', '=', 'results.recalculated')
        .where('branch_id', '=', b.s.branch)
        .execute();
      expect(notices.map((one) => one.data)).toEqual([{ quarter: 1, version: 2 }]);
      const told = await t.database.migrator
        .selectFrom('notifications')
        .select('account_id')
        .where('kind', '=', 'results.recalculated')
        .where('account_id', 'in', [owner.account.id, unchanged.account.id, elsewhere.account.id])
        .execute();
      expect(told).toEqual([{ account_id: owner.account.id }]);
    });

    // edge/system-behaviour: "A difference ... blocks closing that journal" (review must-fix 6).
    it('refuses to close a reopened journal again while the latest check found a difference in it', async () => {
      const b = await closed();
      const reopened = await vice(
        b.s.branch,
        async (calls) =>
          (
            await calls.post(
              b.s.branch,
              reopenPath(b.q1),
              { journalId: b.journal, reason: 'A mark was typed in the wrong row', days: 3 },
              randomUUID(),
            )
          ).status,
        REOPEN,
      );
      expect(reopened).toBe(200);
      // A finished run of the check with a difference in the journal, as the check writes it.
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`select set_config('app.now', '2026-11-03T02:00:00+05:00', true)`.execute(
          transaction,
        );
        const run = await transaction
          .insertInto('result_checks')
          .values({ branch_id: b.s.branch, day: '2026-11-03', started_at: new Date(0) })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('result_check_differences')
          .values({
            branch_id: b.s.branch,
            check_id: run.id,
            quarter_id: b.q1,
            journal_id: b.journal,
            kind: 'cell_history',
            detail: '{}',
          })
          .execute();
        await transaction
          .updateTable('result_checks')
          .set({ finished_at: new Date(0), summary: '{}' })
          .where('id', '=', run.id)
          .execute();
      });
      await vice(
        b.s.branch,
        async (calls) => {
          const list = checklistOf(await calls.get(b.s.branch, path(b.q1)));
          expect(list.check?.journals).toEqual([{ journalId: b.journal, differences: 1 }]);
          const panel = list.reopenedJournals[0];
          expect(panel?.items.map((item) => item.kind)).toContain('check_difference');
          expect(panel?.closable).toBe(false);
          const refused = await calls.post(
            b.s.branch,
            journalClosePath(b.q1, b.journal),
            { warnings: warningsOf({ ...list, items: panel?.items ?? [] }), lockNow: false },
            randomUUID(),
          );
          expect([refused.status, codeOf(refused)]).toEqual([409, 'closing_blocked']);
        },
        INSIDE,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Task 9.2c: the nightly check and the daily work (edge/system-behaviour, "The nightly check":
  // "It recalculates open journals and stored final results. A difference alerts the developer
  // and blocks closing that journal. A check that did not run also raises an alert"; the "Done
  // when": "a deliberately corrupted stored result is caught by the check in a test").
  describe('the nightly check and the daily work (task 9.2c)', () => {
    const daily = () => t.app.get(DailyWork);

    /** The check of a branch at a moment, as the job runs it. */
    const check = async (branch: string, moment: string) => {
      t.clock.set(moment);
      try {
        await daily().check({ day: moment.slice(0, 10) }, [branch]);
      } finally {
        t.clock.set(START);
      }
      return t.database.migrator
        .selectFrom('result_check_differences')
        .innerJoin('result_checks', 'result_checks.id', 'result_check_differences.check_id')
        .select([
          'result_check_differences.kind',
          'result_check_differences.journal_id',
          'result_check_differences.student_id',
        ])
        .where('result_checks.branch_id', '=', branch)
        .where('result_checks.started_at', '=', new Date(moment))
        .execute();
    };

    /** A daily job of a branch in its transaction, as the runner runs it. */
    const job = async (
      branch: string,
      moment: string,
      work: (transaction: Transaction) => Promise<void>,
    ) => {
      t.clock.set(moment);
      try {
        await t.app.get(Transactions).run([branch], work);
      } finally {
        t.clock.set(START);
      }
    };

    /** Writes past the triggers of a table as its owner: a corruption the guards never allow. */
    const corrupt = (table: string, work: (transaction: Transaction) => Promise<unknown>) =>
      t.database.migrator.transaction().execute(async (transaction) => {
        await sql`alter table ${sql.table(table)} disable trigger user`.execute(transaction);
        await work(transaction);
        await sql`alter table ${sql.table(table)} enable trigger user`.execute(transaction);
      });

    const superAdmin = async () => (await sharedAdmin(0)).account.id;

    const noticesTo = (accountId: string, kind: string, branch?: string) => {
      let query = t.database.migrator
        .selectFrom('notifications')
        .select('data')
        .where('account_id', '=', accountId)
        .where('kind', '=', kind)
        .orderBy('id');
      if (branch !== undefined) query = query.where('branch_id', '=', branch);
      return query.execute();
    };

    it('finds nothing in a branch whose journals and stored results agree', async () => {
      const b = await closed();
      expect(await check(b.s.branch, '2026-11-03T02:00:00+05:00')).toEqual([]);
      const run = await t.database.migrator
        .selectFrom('result_checks')
        .select(['finished_at', 'summary'])
        .where('branch_id', '=', b.s.branch)
        .executeTakeFirstOrThrow();
      expect(run.finished_at).toEqual(new Date('2026-11-03T02:00:00+05:00'));
      expect(run.summary).toMatchObject({ differences: {} });
    });

    it('catches a deliberately corrupted stored result and tells the Super Admins', async () => {
      const b = await closed();
      const admin = await superAdmin();
      await corrupt('quarter_final_results', (transaction) =>
        transaction
          .updateTable('quarter_final_results')
          .set({ record: sql`jsonb_set(record, '{outcome,result,grade}', '2'::jsonb)` })
          .where('quarter_id', '=', b.q1)
          .where('student_id', '=', b.aziz)
          .execute(),
      );
      const found = await check(b.s.branch, '2026-11-03T02:00:00+05:00');
      expect(found).toEqual([{ kind: 'stored_module', journal_id: b.journal, student_id: b.aziz }]);
      expect(await noticesTo(admin, 'results.check_difference', b.s.branch)).toEqual([
        { data: { date: '2026-11-03', differences: 1, journals: 1 } },
      ]);
      // edge/system-behaviour: "Every job can be repeated safely": a retry of the finished day's
      // run stores no second run and sends no second notice (spec review note).
      await check(b.s.branch, '2026-11-03T02:30:00+05:00');
      const runs = await t.database.migrator
        .selectFrom('result_checks')
        .select('id')
        .where('branch_id', '=', b.s.branch)
        .where('day', '=', '2026-11-03')
        .execute();
      expect(runs).toHaveLength(1);
      expect(await noticesTo(admin, 'results.check_difference', b.s.branch)).toHaveLength(1);
    });

    it('catches an entry of a closed quarter changed past the guards', async () => {
      const b = await closed();
      await corrupt('journal_cells', (transaction) =>
        transaction
          .updateTable('journal_cells')
          .set({ mark: 0 })
          .where('lesson_id', '=', b.lessons.l12.id)
          .where('student_id', '=', b.aziz)
          .where('work_id', 'is', null)
          .execute(),
      );
      expect(await check(b.s.branch, '2026-11-03T02:00:00+05:00')).toEqual([
        { kind: 'stored_entries', journal_id: b.journal, student_id: b.aziz },
      ]);
    });

    it('catches a cell of an open journal that is not its history, blocks closing it, and clears once repaired', async () => {
      const b = await base();
      await corrupt('journal_cells', (transaction) =>
        transaction
          .updateTable('journal_cells')
          .set({ mark: 0 })
          .where('lesson_id', '=', b.lessons.l12.id)
          .where('student_id', '=', b.bek)
          .where('work_id', 'is', null)
          .execute(),
      );
      expect(await check(b.s.branch, '2026-10-28T02:00:00+05:00')).toEqual([
        { kind: 'cell_history', journal_id: b.journal, student_id: b.bek },
      ]);
      await vice(b.s.branch, async (calls) => {
        const list = checklistOf(await calls.get(b.s.branch, path(b.q1)));
        expect(itemsOf(list, 'check_difference', b.journal).map((one) => one.differences)).toEqual([
          1,
        ]);
      });
      // Repaired from the history; the next check finds nothing and the item is gone.
      await corrupt('journal_cells', (transaction) =>
        transaction
          .updateTable('journal_cells')
          .set({ mark: 1 })
          .where('lesson_id', '=', b.lessons.l12.id)
          .where('student_id', '=', b.bek)
          .where('work_id', 'is', null)
          .execute(),
      );
      expect(await check(b.s.branch, '2026-10-29T02:00:00+05:00')).toEqual([]);
      await vice(b.s.branch, async (calls) => {
        const list = checklistOf(await calls.get(b.s.branch, path(b.q1)));
        expect(itemsOf(list, 'check_difference')).toEqual([]);
      });
    });

    // Review must-fix 5: a correction in a reopened journal is no difference.
    it('finds no difference in a reopened journal that took a correction', async () => {
      const b = await closed();
      await vice(
        b.s.branch,
        async (calls) => {
          const reopened = await calls.post(
            b.s.branch,
            `/api/results/closing/${b.q1}/reopen`,
            { journalId: b.journal, reason: 'A mark was typed in the wrong row', days: 3 },
            randomUUID(),
          );
          expect(reopened.status).toBe(200);
        },
        '2026-11-02T09:00:00+05:00',
      );
      await vice(
        b.s.branch,
        async (calls) => {
          const corrected = await calls.post(
            b.s.branch,
            `/api/journal/lessons/${b.lessons.l12.id}/attendance`,
            {
              saves: [{ studentId: b.dilshod, mark: 1, version: null }],
              correction: { reason: 'The register shows him present' },
            },
            randomUUID(),
          );
          expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
        },
        '2026-11-03T10:00:00+05:00',
      );
      expect(await check(b.s.branch, '2026-11-04T02:00:00+05:00')).toEqual([]);
    });

    it('raises "did not run" once a day when no run of that day finished', async () => {
      const b = await base();
      const admin = await superAdmin();
      await job(b.s.branch, '2026-10-28T07:00:00+05:00', (transaction) =>
        daily().checkMissed(transaction, { day: '2026-10-28' }, b.s.branch),
      );
      expect(await noticesTo(admin, 'results.check_missed', b.s.branch)).toEqual([
        { data: { date: '2026-10-28' } },
      ]);
      await check(b.s.branch, '2026-10-29T02:00:00+05:00');
      await job(b.s.branch, '2026-10-29T07:00:00+05:00', (transaction) =>
        daily().checkMissed(transaction, { day: '2026-10-29' }, b.s.branch),
      );
      expect(await noticesTo(admin, 'results.check_missed', b.s.branch)).toHaveLength(1);
    });

    // Plan decision 9: the tick at 01:59 and 02:00 branch time, twice in a day.
    it('enqueues each daily kind once per branch and day, from its hour', async () => {
      const b = await base();
      const runs = () =>
        t.database.migrator
          .selectFrom('scheduled_runs')
          .select(['kind', sql<string>`day::text`.as('day')])
          .where('branch_id', '=', b.s.branch)
          .orderBy('kind')
          .execute();
      const tick = async (moment: string) => {
        t.clock.set(moment);
        try {
          await daily().tick();
        } finally {
          t.clock.set(START);
        }
      };
      await tick('2026-10-28T01:59:00+05:00');
      expect(await runs()).toEqual([]);
      await tick('2026-10-28T02:00:00+05:00');
      await tick('2026-10-28T02:15:00+05:00');
      expect(await runs()).toEqual([
        { kind: 'results.check', day: '2026-10-28' },
        { kind: 'timetable.forced_delete_purge', day: '2026-10-28' },
      ]);
      await tick('2026-10-28T07:00:00+05:00');
      expect((await runs()).map((one) => one.kind)).toEqual([
        'journal.about_to_lock',
        'plans.reminders',
        'results.check',
        'results.check_missed',
        'results.closing_overdue',
        'timetable.forced_delete_purge',
      ]);
      // Each run's job is in the queue, for the branch alone.
      const queued = await sql<{ name: string; data: { branchIds: string[] } }>`
        select name, data from pgboss.job
        where data -> 'branchIds' ->> 0 = ${b.s.branch}
        order by name
      `.execute(t.database.migrator);
      expect(queued.rows.map((one) => one.name)).toEqual((await runs()).map((one) => one.kind));
      // The worker down from 07:00 to 08:00 of the next day: the check is sent at 08:00 and "did
      // not run" one hour after it, never in the same tick (spec review note).
      const dayOf = async (day: string) =>
        (await runs()).filter((one) => one.day === day).map((one) => one.kind);
      await tick('2026-10-29T08:00:00+05:00');
      expect(await dayOf('2026-10-29')).toEqual([
        'journal.about_to_lock',
        'plans.reminders',
        'results.check',
        'results.closing_overdue',
        'timetable.forced_delete_purge',
      ]);
      await tick('2026-10-29T08:59:00+05:00');
      expect(await dayOf('2026-10-29')).not.toContain('results.check_missed');
      await tick('2026-10-29T09:00:00+05:00');
      expect(await dayOf('2026-10-29')).toContain('results.check_missed');
      // A tick late by a day: the day it missed is never sent, the new day once.
      await tick('2026-10-31T02:00:00+05:00');
      expect(await dayOf('2026-10-30')).toEqual([]);
      expect(await dayOf('2026-10-31')).toEqual(['results.check', 'timetable.forced_delete_purge']);
    });

    // 07: "After the last day the Academic Vice Principal is reminded until the quarter is closed."
    it('reminds the Academic Vice Principals of the branch of a quarter past its last day until it is closed', async () => {
      const b = await base();
      const own = await account();
      await t.kit.giveRole(own.account.id, {
        role: 'academic_vice_principal',
        branchId: b.s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      const other = await base();
      const elsewhere = await account();
      await t.kit.giveRole(elsewhere.account.id, {
        role: 'academic_vice_principal',
        branchId: other.s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      const overdue = (moment: string) =>
        job(b.s.branch, moment, (transaction) => daily().closingOverdue(transaction, b.s.branch));
      await overdue('2026-10-31T07:00:00+05:00');
      expect(await noticesTo(own.account.id, 'results.closing_overdue')).toEqual([]);
      await overdue('2026-11-01T07:00:00+05:00');
      expect(await noticesTo(own.account.id, 'results.closing_overdue')).toEqual([
        { data: { quarter: 1, lastDay: '2026-10-31' } },
      ]);
      expect(await noticesTo(elsewhere.account.id, 'results.closing_overdue')).toEqual([]);
      await closeQuarter(t.database, {
        branchId: b.s.branch,
        quarterId: b.q1,
        accountId: own.account.id,
      });
      await overdue('2026-11-02T07:00:00+05:00');
      expect(await noticesTo(own.account.id, 'results.closing_overdue')).toHaveLength(1);
    });

    // edge/people-roles-accounts: a task with no holder goes "to the Academic Vice Principal, then
    // to the Super Admin" (permission review should-fix 6).
    it('reminds the Super Admins when the branch has no Academic Vice Principal', async () => {
      const vacant = await base();
      const admin = await superAdmin();
      const elsewhere = await account();
      const other = await base();
      await t.kit.giveRole(elsewhere.account.id, {
        role: 'academic_vice_principal',
        branchId: other.s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      await job(vacant.s.branch, '2026-11-01T07:00:00+05:00', (transaction) =>
        daily().closingOverdue(transaction, vacant.s.branch),
      );
      expect(await noticesTo(admin, 'results.closing_overdue', vacant.s.branch)).toEqual([
        { data: { quarter: 1, lastDay: '2026-10-31' } },
      ]);
      expect(await noticesTo(elsewhere.account.id, 'results.closing_overdue')).toEqual([]);
    });

    // 10: "Lesson about to lock with data missing | Teacher" (From 8.7), once per lesson.
    it('tells the teacher of an incomplete lesson within 48 hours of its lock, once', async () => {
      const teacher = await account();
      const b = await base({ teacher: teacher.account.id });
      const aboutToLock = (moment: string) =>
        job(b.s.branch, moment, (transaction) => daily().aboutToLock(transaction, b.s.branch));
      // The 26th locks at 00:00 of 3 November (7 edit days): 65 hours before, nothing.
      await aboutToLock('2026-10-31T07:00:00+05:00');
      expect(await noticesTo(teacher.account.id, 'journal.lesson_about_to_lock')).toEqual([]);
      await aboutToLock('2026-11-01T07:00:00+05:00');
      await aboutToLock('2026-11-02T07:00:00+05:00');
      const notices = await noticesTo(teacher.account.id, 'journal.lesson_about_to_lock');
      expect(notices.map((one) => (one.data as { date: string }).date)).toEqual(['2026-10-26']);
    });

    // Spec review must-fix 8: "within 48 hours" holds at exactly 48 hours, not at 48 h 1 min.
    it('tells the teacher at exactly 48 hours before the lock, not a minute earlier', async () => {
      const teacher = await account();
      const b = await base({ teacher: teacher.account.id });
      const aboutToLock = (moment: string) =>
        job(b.s.branch, moment, (transaction) => daily().aboutToLock(transaction, b.s.branch));
      const dates = async () =>
        (await noticesTo(teacher.account.id, 'journal.lesson_about_to_lock')).map(
          (one) => (one.data as { date: string; locksAt: string }).date,
        );
      // The 26th locks at 00:00 of 3 November.
      await aboutToLock('2026-10-31T23:59:00+05:00');
      expect(await dates()).toEqual([]);
      await aboutToLock('2026-11-01T00:00:00+05:00');
      expect(await dates()).toEqual(['2026-10-26']);
    });

    it('reminds the Academic Vice Principals daily when no plan window is open 14 days before a quarter', async () => {
      const b = await base();
      const own = await account();
      await t.kit.giveRole(own.account.id, {
        role: 'academic_vice_principal',
        branchId: b.s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      const remind = (moment: string) =>
        job(b.s.branch, moment, (transaction) => daily().planReminders(transaction, b.s.branch));
      const quarter2 = await quarterOf(b.s.year, 2);
      const start = (
        await t.database.migrator
          .selectFrom('quarters')
          .select(sql<string>`start_date::text`.as('start'))
          .where('id', '=', quarter2)
          .executeTakeFirstOrThrow()
      ).start;
      const missing = () =>
        noticesTo(own.account.id, 'plans.window_missing').then((rows) =>
          rows.filter((one) => (one.data as { quarter: number }).quarter === 2),
        );
      // 15 days before: nothing; 14 days before and the next day: one each.
      const day = (offset: number) =>
        new Date(Date.parse(`${start}T07:00:00+05:00`) + offset * 86_400_000).toISOString();
      // Spec review must-fix 8 and permission review should-fix 7: never to the Academic Vice
      // Principal of another branch.
      const other = await base();
      const elsewhere = await account();
      await t.kit.giveRole(elsewhere.account.id, {
        role: 'academic_vice_principal',
        branchId: other.s.branch,
        validFrom: new Date('2026-09-01T00:00:00+05:00'),
      });
      await remind(day(-15));
      expect(await missing()).toEqual([]);
      await remind(day(-14));
      await remind(day(-13));
      expect(await missing()).toHaveLength(2);
      expect(await noticesTo(elsewhere.account.id, 'plans.window_missing')).toEqual([]);
    });

    /** The plan the base scene links to its journal in the first quarter. */
    const planOf = async (b: Awaited<ReturnType<typeof base>>) =>
      (
        await t.database.migrator
          .selectFrom('lesson_plan_journals')
          .select('plan_id')
          .where('journal_id', '=', b.journal)
          .where('quarter_id', '=', b.q1)
          .executeTakeFirstOrThrow()
      ).plan_id;

    // 09: "Teachers are reminded ... three days before it ends, and on the last day if the plan is
    // incomplete" (spec review must-fix 8: the two days exactly, nothing on the days around them).
    it('reminds the plan owner three days before the window ends and on its last day', async () => {
      const teacher = await account();
      const b = await base({ teacher: teacher.account.id });
      await planOf(b);
      const opener = await load.classes.account();
      // Open from 20 to 30 October: it ends at 00:00 of 31 October.
      await t.database.migrator
        .insertInto('lesson_plan_windows')
        .values({
          branch_id: b.s.branch,
          quarter_id: b.q1,
          start_date: '2026-10-20',
          end_date: '2026-10-30',
          starts_at: new Date('2026-10-20T00:00:00+05:00'),
          ends_at: new Date('2026-10-31T00:00:00+05:00'),
          opened_at: new Date('2026-10-19T09:00:00+05:00'),
          opened_by: opener,
        })
        .execute();
      const remind = (date: string) =>
        job(b.s.branch, `${date}T07:00:00+05:00`, (transaction) =>
          daily().planReminders(transaction, b.s.branch),
        );
      const kinds = ['plans.window_ending', 'plans.window_last_day'] as const;
      const sent = async () =>
        Object.fromEntries(
          await Promise.all(
            kinds.map(
              async (kind) => [kind, (await noticesTo(teacher.account.id, kind)).length] as const,
            ),
          ),
        );
      await remind('2026-10-26');
      expect(await sent()).toEqual({ 'plans.window_ending': 0, 'plans.window_last_day': 0 });
      await remind('2026-10-27');
      expect(await sent()).toEqual({ 'plans.window_ending': 1, 'plans.window_last_day': 0 });
      expect(await noticesTo(teacher.account.id, 'plans.window_ending')).toEqual([
        { data: { quarter: 1, endDate: '2026-10-30' } },
      ]);
      await remind('2026-10-28');
      await remind('2026-10-29');
      expect(await sent()).toEqual({ 'plans.window_ending': 1, 'plans.window_last_day': 0 });
      await remind('2026-10-30');
      expect(await sent()).toEqual({ 'plans.window_ending': 1, 'plans.window_last_day': 1 });
      await remind('2026-10-31');
      expect(await sent()).toEqual({ 'plans.window_ending': 1, 'plans.window_last_day': 1 });
    });

    // edge/lesson-plans: "The teacher is reminded on days 1, 3 and 7, then weekly" (spec review
    // must-fix 8: days 1, 3, 7 and 14, nothing between).
    it('reminds the owner of a prepared request not sent on days 1, 3, 7 and 14', async () => {
      const teacher = await account();
      const b = await base({ teacher: teacher.account.id });
      const plan = await planOf(b);
      await t.database.migrator
        .insertInto('lesson_plan_requests')
        .values({
          branch_id: b.s.branch,
          plan_id: plan,
          journal_id: b.journal,
          quarter_id: b.q1,
          kind: 'replan',
          status: 'prepared',
          from_date: '2026-10-26',
          prepared_at: new Date('2026-10-20T09:00:00+05:00'),
          updated_at: new Date('2026-10-20T09:00:00+05:00'),
        })
        .execute();
      for (let offset = 0; offset <= 15; offset += 1) {
        const moment = new Date(Date.parse('2026-10-20T07:00:00+05:00') + offset * 86_400_000);
        await job(b.s.branch, moment.toISOString(), (transaction) =>
          daily().planReminders(transaction, b.s.branch),
        );
      }
      const notices = await noticesTo(teacher.account.id, 'plans.request_unsent');
      expect(notices.map((one) => (one.data as { days: number }).days)).toEqual([1, 3, 7, 14]);
    });

    it('removes the kept rows of a forced delete past its restore time and keeps the store row with a summary', async () => {
      const b = await base();
      const deleter = await load.classes.account();
      const stored = await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`select set_config('app.now', '2026-09-25T10:00:00+05:00', true)`.execute(
          transaction,
        );
        return transaction
          .insertInto('forced_deletes')
          .values({
            branch_id: b.s.branch,
            record_type: 'lesson',
            record_id: b.lessons.l12.id,
            rows: JSON.stringify({ lessons: [{ id: 'kept' }], journal_cells: [{}, {}] }),
            reason: 'Entered by mistake',
            deleted_by: deleter,
            deleted_at: new Date(0),
            restore_until: new Date(0),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
      });
      const purge = (moment: string) =>
        job(b.s.branch, moment, (transaction) =>
          daily().forcedDeletePurge(transaction, b.s.branch),
        );
      // Restore until 25 October 10:00: a minute before, nothing.
      await purge('2026-10-25T09:59:00+05:00');
      const before = await t.database.migrator
        .selectFrom('forced_deletes')
        .select(['rows', 'purged_at'])
        .where('id', '=', stored.id)
        .executeTakeFirstOrThrow();
      expect(before.purged_at).toBeNull();
      // Spec review must-fix 8: at exactly the restore time, it is removed.
      await purge('2026-10-25T10:00:00+05:00');
      const after = await t.database.migrator
        .selectFrom('forced_deletes')
        .select(['rows', 'purged_at', 'reason'])
        .where('id', '=', stored.id)
        .executeTakeFirstOrThrow();
      expect(after).toEqual({
        rows: {},
        purged_at: new Date('2026-10-25T10:00:00+05:00'),
        reason: 'Entered by mistake',
      });
      const entry = await t.database.migrator
        .selectFrom('audit_log')
        .select(['actor_id', 'new_value'])
        .where('action', '=', 'forced_delete.purged')
        .where('branch_id', '=', b.s.branch)
        .executeTakeFirstOrThrow();
      expect(entry.actor_id).toBeNull();
      expect(entry.new_value).toEqual({
        forcedDeletes: [
          {
            id: stored.id,
            recordType: 'lesson',
            recordId: b.lessons.l12.id,
            rows: { lessons: 1, journal_cells: 2 },
          },
        ],
      });
    });
  });

  // Task 9.2d, pull request #233: docs/spec/edge-cases/lesson-plans.md, "Items are still 'not
  // covered' at the end of the quarter": "Items unresolved at closing are carried automatically.
  // In quarter 4 only merge or drop exist." Build line: "Both closes carry: the branch close and a
  // journal's re-close". Done when: "a close carries an unresolved item into the next quarter's
  // tray, and in quarter 4 refuses to close while one is left".
  describe('not-covered plan items at the close (task 9.2d)', () => {
    /** The rows of a journal's plan in a quarter: its lessons not cancelled. */
    const rowCount = async (s: PublishedScene, classId: string, from: string, to: string) =>
      (
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('class_id', '=', classId)
          .where('subject_id', '=', s.subject)
          .where('lesson_date', '>=', from)
          .where('lesson_date', '<=', to)
          .where('cancel_cause', 'is', null)
          .execute()
      ).length;

    /** An item past the last row of a journal's plan, as the follow leaves one (its plan made when missing). */
    const pastItem = async (
      branch: string,
      subject: string,
      journal: string,
      quarter: string,
      rows: number,
      topic: string,
    ) => {
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
      const taken = await t.database.migrator
        .selectFrom('lesson_plan_places')
        .select('position')
        .where('plan_id', '=', plan)
        .where('journal_id', '=', journal)
        .orderBy('position', 'desc')
        .executeTakeFirst();
      const item = await t.database.migrator
        .insertInto('lesson_plan_items')
        .values({ branch_id: branch, plan_id: plan, topic })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('lesson_plan_places')
        .values({
          branch_id: branch,
          plan_id: plan,
          journal_id: journal,
          item_id: item.id,
          position: Math.max(rows, taken?.position ?? 0) + 1,
        })
        .execute();
      return item.id;
    };

    const trayOf = (journal: string, quarter: string) =>
      t.database.migrator
        .selectFrom('lesson_plan_tray')
        .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_tray.item_id')
        .innerJoin('lesson_plan_outcomes', 'lesson_plan_outcomes.id', 'lesson_plan_tray.outcome_id')
        .select([
          'lesson_plan_items.topic',
          'lesson_plan_items.copied_from',
          'lesson_plan_outcomes.automatic',
          'lesson_plan_outcomes.item_id',
        ])
        .where('lesson_plan_tray.journal_id', '=', journal)
        .where('lesson_plan_tray.quarter_id', '=', quarter)
        .execute();

    /** A journal of the scene's class and a second graded subject whose runs end on `until`. */
    const endedJournal = async (b: Awaited<ReturnType<typeof base>>, until: string) => {
      const subject = await load.classes.subject({ grades: [7], journalType: 'graded' });
      const journal = (
        await t.database.migrator
          .insertInto('journals')
          .values({
            branch_id: b.s.branch,
            academic_year_id: b.s.year,
            class_id: b.s.classId,
            group_id: null,
            subject_id: subject,
            runs: `{[2026-09-07,${until})}`,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      return { subject, journal };
    };

    it("carries an unresolved item into the next quarter's tray at the branch close, once, and not from a journal closed with it", async () => {
      const b = await base();
      const q2 = await quarterOf(b.s.year, 2);
      const rows = await rowCount(b.s, b.s.classId, QUARTERS[0][0], QUARTERS[0][1]);
      const item = await pastItem(b.s.branch, b.s.subject, b.journal, b.q1, rows, 'Fractions');
      // `09`, "A subject is removed from a class": its plan is closed with the journal.
      const ended = await endedJournal(b, '2026-10-20');
      const endedItem = await pastItem(b.s.branch, ended.subject, ended.journal, b.q1, 0, 'Ratios');
      const answer = await vice(
        b.s.branch,
        async (calls) => {
          const list = await decideAll(calls, b.s.branch, b.q1);
          expect(itemsOf(list, 'plan_not_covered')).toEqual([]);
          const done = await calls.post(
            b.s.branch,
            closePath(b.q1),
            { warnings: warningsOf(list), lockNow: true, startQuarter: null },
            randomUUID(),
          );
          expect(done.status, JSON.stringify(done.body)).toBe(200);
          return closingClosedSchema.parse(done.body);
        },
        CLOSE,
      );
      expect(answer.carried).toBe(1);
      expect(await trayOf(b.journal, q2)).toEqual([
        { topic: 'Fractions', copied_from: item, automatic: true, item_id: item },
      ]);
      expect(await trayOf(ended.journal, q2)).toEqual([]);
      const outcomes = await t.database.migrator
        .selectFrom('lesson_plan_outcomes')
        .select(['item_id', 'kind', 'automatic'])
        .where('quarter_id', '=', b.q1)
        .execute();
      expect(outcomes).toEqual([{ item_id: item, kind: 'carried', automatic: true }]);
      expect(outcomes.some((one) => one.item_id === endedItem)).toBe(false);
      const entry = (await t.entries('plan.not_covered_carried')).at(-1);
      expect(entry?.new_value).toMatchObject({
        automatic: true,
        items: [{ journalId: b.journal, itemId: item }],
      });
    });

    it("carries the reopened journal's own unresolved items at its re-close", async () => {
      const b = await closed();
      const q2 = await quarterOf(b.s.year, 2);
      const REOPEN = '2026-11-02T09:00:00+05:00';
      await vice(
        b.s.branch,
        async (calls) => {
          const done = await calls.post(
            b.s.branch,
            `/api/results/closing/${b.q1}/reopen`,
            { journalId: b.journal, reason: 'A plan item was left behind', days: 3 },
            randomUUID(),
          );
          expect(done.status, JSON.stringify(done.body)).toBe(200);
        },
        REOPEN,
      );
      const rows = await rowCount(b.s, b.s.classId, QUARTERS[0][0], QUARTERS[0][1]);
      const item = await pastItem(b.s.branch, b.s.subject, b.journal, b.q1, rows, 'Decimals');
      const answer = await vice(
        b.s.branch,
        async (calls) => {
          const ready = checklistOf(await calls.get(b.s.branch, path(b.q1)));
          const journal = ready.reopenedJournals[0];
          const done = await calls.post(
            b.s.branch,
            `/api/results/closing/${b.q1}/journals/${b.journal}/close`,
            { warnings: warningsOf({ ...ready, items: journal?.items ?? [] }), lockNow: false },
            randomUUID(),
          );
          expect(done.status, JSON.stringify(done.body)).toBe(200);
          return closingClosedSchema.parse(done.body);
        },
        '2026-11-03T10:00:00+05:00',
      );
      expect(answer.carried).toBe(1);
      expect((await trayOf(b.journal, q2)).map((one) => [one.topic, one.item_id])).toEqual([
        ['Decimals', item],
      ]);
    });

    it('counts an unplaced tray item as not covered of its quarter and carries it again at its close', async () => {
      const b = await base();
      const q2 = await quarterOf(b.s.year, 2);
      const q3 = await quarterOf(b.s.year, 3);
      const rows = await rowCount(b.s, b.s.classId, QUARTERS[0][0], QUARTERS[0][1]);
      const item = await pastItem(b.s.branch, b.s.subject, b.journal, b.q1, rows, 'Fractions');
      await closeBase(b);
      const [tray] = await trayOf(b.journal, q2);
      expect(tray?.item_id).toBe(item);
      const AFTER_Q2 = '2026-12-29T18:00:00+05:00';
      const answer = await vice(
        b.s.branch,
        async (calls) => {
          const list = await decideAll(calls, b.s.branch, q2);
          // The tray is not covered of quarter 2 (decision 10): the checklist counts it.
          expect(itemsOf(list, 'plan_incomplete', b.journal).map((one) => one.notCovered)).toEqual([
            1,
          ]);
          const done = await calls.post(
            b.s.branch,
            closePath(q2),
            { warnings: warningsOf(list), lockNow: true, startQuarter: null },
            randomUUID(),
          );
          expect(done.status, JSON.stringify(done.body)).toBe(200);
          return closingClosedSchema.parse(done.body);
        },
        AFTER_Q2,
      );
      expect(answer.carried).toBe(1);
      expect((await trayOf(b.journal, q2)).length).toBe(0);
      expect((await trayOf(b.journal, q3)).map((one) => [one.topic, one.automatic])).toEqual([
        ['Fractions', true],
      ]);
    });

    it('blocks the re-close of a reopened journal while an item is left whose next quarter is closed', async () => {
      const b = await closed();
      const closer = await account();
      await closeQuarter(t.database, {
        branchId: b.s.branch,
        quarterId: await quarterOf(b.s.year, 2),
        accountId: closer.account.id,
      });
      await vice(
        b.s.branch,
        async (calls) => {
          const done = await calls.post(
            b.s.branch,
            `/api/results/closing/${b.q1}/reopen`,
            { journalId: b.journal, reason: 'A plan item was left behind', days: 3 },
            randomUUID(),
          );
          expect(done.status, JSON.stringify(done.body)).toBe(200);
        },
        '2026-11-02T09:00:00+05:00',
      );
      const rows = await rowCount(b.s, b.s.classId, QUARTERS[0][0], QUARTERS[0][1]);
      await pastItem(b.s.branch, b.s.subject, b.journal, b.q1, rows, 'Decimals');
      await vice(
        b.s.branch,
        async (calls) => {
          const list = checklistOf(await calls.get(b.s.branch, path(b.q1)));
          const panel = list.reopenedJournals[0];
          expect(
            (panel?.items ?? [])
              .filter((one) => one.kind === 'plan_not_covered')
              .map((one) => one.journal?.id),
          ).toEqual([b.journal]);
          expect(panel?.closable).toBe(false);
          const done = await calls.post(
            b.s.branch,
            `/api/results/closing/${b.q1}/journals/${b.journal}/close`,
            { warnings: warningsOf({ ...list, items: panel?.items ?? [] }), lockNow: false },
            randomUUID(),
          );
          expect([done.status, codeOf(done)]).toEqual([409, 'closing_blocked']);
        },
        '2026-11-03T10:00:00+05:00',
      );
    });

    // Plan review, must-fix 5: the close and a carry meet on the quarter and the journals.
    describe('closing against a carry', () => {
      const blockedBy = async (pid: number) => {
        const found = await sql<{ n: number }>`
          select count(*)::int as n from pg_stat_activity a
          where a.datname = current_database() and ${pid}::int = any(pg_blocking_pids(a.pid))
        `.execute(t.database.migrator);
        return found.rows[0]?.n ?? 0;
      };
      const untilWaiting = async (pid: number) => {
        for (let tries = 0; tries < 800; tries += 1) {
          if ((await blockedBy(pid)) >= 1) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('Nothing waited on the held side.');
      };
      const hold = (branch: string, work: (transaction: Transaction) => Promise<void>) => {
        let release: () => void = () => undefined;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        let ready: (pid: number) => void = () => undefined;
        const isReady = new Promise<number>((resolve) => {
          ready = resolve;
        });
        t.clock.set(CLOSE);
        const done = t.app
          .get(Transactions)
          .run([branch], async (transaction) => {
            await work(transaction);
            const process = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
              transaction,
            );
            ready(process.rows[0]?.pid ?? 0);
            await released;
          })
          .catch((error: unknown) => error);
        return { isReady, release, done };
      };

      /** The base scene with its owner signing in, the plan windows open, an item past the last row. */
      const carryScene = async () => {
        const teacher = await account();
        const b = await base({ teacher: teacher.account.id });
        await openPlanWindows(t.database.migrator, b.s.branch, b.s.year);
        const rows = await rowCount(b.s, b.s.classId, QUARTERS[0][0], QUARTERS[0][1]);
        const item = await pastItem(b.s.branch, b.s.subject, b.journal, b.q1, rows, 'Fractions');
        return { b, teacher, item, q2: await quarterOf(b.s.year, 2) };
      };

      it('a carry waits for a close held open and is refused once it is closed', async () => {
        const { b, teacher, item, q2 } = await carryScene();
        const closer = await account();
        // The held side does what the close does: the quarter for update, the closing row written.
        const held = hold(b.s.branch, async (transaction) => {
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
              closed_by: closer.account.id,
              lock_now: true,
              start_quarter: null,
              warnings: JSON.stringify([]),
            })
            .execute();
        });
        const pid = await held.isReady;
        const carried = await as(
          teacher,
          [{ role: 'teacher', branchId: b.s.branch }],
          async ({ post }) => {
            const started = new Promise<Response>((resolve, reject) => {
              post(b.s.branch, `/api/plans/journals/${b.journal}/not-covered/${item}/carry`, {
                quarterId: b.q1,
              }).then(resolve, reject);
            });
            await untilWaiting(pid);
            held.release();
            return started;
          },
          CLOSE,
        );
        expect(await held.done).toBeUndefined();
        expect([carried.status, codeOf(carried)]).toEqual([409, 'plan_quarter_closed']);
        expect(await trayOf(b.journal, q2)).toEqual([]);
      });

      it('the close waits for a carry held open and carries nothing twice', async () => {
        const { b, teacher, item, q2 } = await carryScene();
        const warnings = await vice(
          b.s.branch,
          async (calls) => warningsOf(await decideAll(calls, b.s.branch, b.q1)),
          CLOSE,
        );
        // The held side does what the carry route does: the journal locked, the carry written.
        const held = hold(b.s.branch, async (transaction) => {
          await lockPlansOf(transaction, [b.journal], [b.q1, q2]);
          const rows = await rowCount(b.s, b.s.classId, QUARTERS[0][0], QUARTERS[0][1]);
          const at = await notCoveredAt(transaction, b.journal, b.q1, item, rows);
          if (at === null) throw new Error('The item is not covered.');
          await carryItem(
            transaction,
            t.app.get(Audit),
            {
              branchId: b.s.branch,
              accountId: teacher.account.id,
              assignmentId: t.adminAssignment,
            },
            {
              journal: { id: b.journal, subjectId: b.s.subject },
              quarterId: b.q1,
              nextQuarterId: q2,
              itemId: item,
              at,
              automatic: false,
            },
          );
        });
        const pid = await held.isReady;
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
            await untilWaiting(pid);
            held.release();
            return started;
          },
          CLOSE,
        );
        expect(await held.done).toBeUndefined();
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(closingClosedSchema.parse(answer.body).carried).toBe(0);
        expect((await trayOf(b.journal, q2)).map((one) => [one.item_id, one.automatic])).toEqual([
          [item, false],
        ]);
      });
    });

    it('refuses to close the last quarter while an item is left, and closes once it is dropped', async () => {
      const b = await base();
      const q4 = await quarterOf(b.s.year, 4);
      const viceAccount = await account();
      for (const number of [1, 2, 3]) {
        await closeQuarter(t.database, {
          branchId: b.s.branch,
          quarterId: await quarterOf(b.s.year, number),
          accountId: viceAccount.account.id,
        });
      }
      const rows = await rowCount(b.s, b.s.classId, QUARTERS[3][0], QUARTERS[3][1]);
      const item = await pastItem(b.s.branch, b.s.subject, b.journal, q4, rows, 'Percentages');
      // Correction 2: a journal whose runs ended inside the quarter does not block.
      const ended = await endedJournal(b, '2027-04-15');
      const endedItem = await pastItem(
        b.s.branch,
        ended.subject,
        ended.journal,
        q4,
        0,
        'Proportions',
      );
      const AFTER_Q4 = '2027-06-01T12:00:00+05:00';
      await vice(
        b.s.branch,
        async (calls) => {
          const list = await decideAll(calls, b.s.branch, q4);
          const blocking = itemsOf(list, 'plan_not_covered');
          expect(blocking.map((one) => [one.journal?.id, one.notCovered])).toEqual([
            [b.journal, 1],
          ]);
          expect(list.closable).toBe(false);
          const body = { warnings: warningsOf(list), lockNow: true, startQuarter: null };
          const blocked = await calls.post(b.s.branch, closePath(q4), body, randomUUID());
          expect([blocked.status, codeOf(blocked)]).toEqual([409, 'closing_blocked']);
          // "Only merge or drop exist": the Academic Vice Principal, an approver, drops it.
          const dropped = await calls.post(
            b.s.branch,
            `/api/plans/journals/${b.journal}/not-covered/${item}/drop`,
            { quarterId: q4, reason: 'Covered in the revision lessons' },
          );
          expect(dropped.status, JSON.stringify(dropped.body)).toBe(200);
          const after = checklistOf(await calls.get(b.s.branch, path(q4)));
          expect(itemsOf(after, 'plan_not_covered')).toEqual([]);
          const done = await calls.post(
            b.s.branch,
            closePath(q4),
            { warnings: warningsOf(after), lockNow: true, startQuarter: null },
            randomUUID(),
          );
          expect(done.status, JSON.stringify(done.body)).toBe(200);
          expect(closingClosedSchema.parse(done.body).carried).toBe(0);
        },
        AFTER_Q4,
      );
      // Correction 2: the ended journal's item is neither carried nor dropped; it stays not covered.
      const kept = await t.database.migrator
        .selectFrom('lesson_plan_places')
        .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_places.item_id')
        .select(['lesson_plan_items.cleared_at'])
        .where('lesson_plan_places.item_id', '=', endedItem)
        .where('lesson_plan_places.journal_id', '=', ended.journal)
        .execute();
      expect(kept).toEqual([{ cleared_at: null }]);
      const endedOutcomes = await t.database.migrator
        .selectFrom('lesson_plan_outcomes')
        .select('id')
        .where('item_id', '=', endedItem)
        .execute();
      expect(endedOutcomes).toEqual([]);
    });

    // Code review round 1: the planned "journal re-close in the last quarter is refused
    // `closing_blocked` the same way", where `quarter_next` is null.
    it('refuses the re-close of a reopened journal of the last quarter while an item is left, and re-closes once it is dropped', async () => {
      const b = await base();
      const q4 = await quarterOf(b.s.year, 4);
      const closer = await account();
      for (const number of [1, 2, 3, 4]) {
        await closeQuarter(t.database, {
          branchId: b.s.branch,
          quarterId: await quarterOf(b.s.year, number),
          accountId: closer.account.id,
        });
      }
      await vice(
        b.s.branch,
        async (calls) => {
          const done = await calls.post(
            b.s.branch,
            `/api/results/closing/${q4}/reopen`,
            { journalId: b.journal, reason: 'A plan item was left behind', days: 3 },
            randomUUID(),
          );
          expect(done.status, JSON.stringify(done.body)).toBe(200);
        },
        '2027-06-01T09:00:00+05:00',
      );
      const rows = await rowCount(b.s, b.s.classId, QUARTERS[3][0], QUARTERS[3][1]);
      const item = await pastItem(b.s.branch, b.s.subject, b.journal, q4, rows, 'Percentages');
      await vice(
        b.s.branch,
        async (calls) => {
          const list = checklistOf(await calls.get(b.s.branch, path(q4)));
          const panel = list.reopenedJournals[0];
          expect(
            (panel?.items ?? [])
              .filter((one) => one.kind === 'plan_not_covered')
              .map((one) => [one.journal?.id, one.notCovered]),
          ).toEqual([[b.journal, 1]]);
          expect(panel?.closable).toBe(false);
          const closePanel = `/api/results/closing/${q4}/journals/${b.journal}/close`;
          const blocked = await calls.post(
            b.s.branch,
            closePanel,
            { warnings: warningsOf({ ...list, items: panel?.items ?? [] }), lockNow: false },
            randomUUID(),
          );
          expect([blocked.status, codeOf(blocked)]).toEqual([409, 'closing_blocked']);
          // "Only merge or drop exist": the Academic Vice Principal drops it in the reopened journal.
          const dropped = await calls.post(
            b.s.branch,
            `/api/plans/journals/${b.journal}/not-covered/${item}/drop`,
            { quarterId: q4, reason: 'Covered in the revision lessons' },
          );
          expect(dropped.status, JSON.stringify(dropped.body)).toBe(200);
          const after = checklistOf(await calls.get(b.s.branch, path(q4)));
          const cleared = after.reopenedJournals[0];
          expect((cleared?.items ?? []).filter((one) => one.kind === 'plan_not_covered')).toEqual(
            [],
          );
          const done = await calls.post(
            b.s.branch,
            closePanel,
            { warnings: warningsOf({ ...after, items: cleared?.items ?? [] }), lockNow: false },
            randomUUID(),
          );
          expect(done.status, JSON.stringify(done.body)).toBe(200);
          expect(closingClosedSchema.parse(done.body).carried).toBe(0);
          // Closed again, the journal refuses a drop as any closed quarter does.
          const again = await calls.post(
            b.s.branch,
            `/api/plans/journals/${b.journal}/not-covered/${item}/drop`,
            { quarterId: q4, reason: 'Covered in the revision lessons' },
          );
          expect([again.status, codeOf(again)]).toEqual([409, 'plan_quarter_closed']);
        },
        '2027-06-02T10:00:00+05:00',
      );
    });
  });
});
