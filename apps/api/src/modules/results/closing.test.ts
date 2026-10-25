import {
  closingChecklistSchema,
  journalGridSchema,
  REQUEST_KEY_HEADER,
  studentResultsSchema,
  type ClosingChecklist,
  type ClosingItem,
} from '@sodiq/shared';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
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
  ) => {
    const writer = await load.classes.account();
    await t.app.get(Transactions).run([scene.branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: scene.branch,
        actorId: writer,
        action: 'exemption.create',
      });
      await transaction
        .insertInto('exemptions')
        .values({
          branch_id: scene.branch,
          student_id: studentId,
          year_id: scene.year,
          batch_id: '019a0000-0000-7000-8000-0000000000a1',
          kind: 'temporary',
          all_subjects: true,
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
        .execute();
    });
  };

  /**
   * The graded maths scene (20 · 40 · 40, Mondays 12, 19 and 26 October): Aziz present on the
   * 12th with a classwork 9 of 10 and absent on the 19th; Bek present on the 12th and the
   * 19th with no number (attendance only); Dilshod with nothing; Zafar exempt all quarter; Lola
   * present on the 12th, who left the school on the 20th.
   */
  async function base() {
    const s = await publishedScene(t, load, { graded: true });
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
    return { s, aziz, bek, dilshod, zafar, lola, journal, q1, cw, lessons: { l12, l19, l26 } };
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
    await vice(b.s.branch, async ({ get, post }) => {
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
    expect((await t.entries('results.decision_cleared')).length).toBeGreaterThanOrEqual(1);
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
    await as(
      browser,
      [{ role: 'academic_vice_principal', branchId: b.s.branch }],
      async ({ post }) => {
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
      },
    );
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
    expect(await t.entries('results.closing_remind')).toEqual([]);
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
    const rowsBefore = {
      north: await t.rowsOf(b.s.branch),
      south: await t.rowsOf(other.s.branch),
    };
    const decisionsBefore = await t.database.migrator
      .selectFrom('quarter_result_decisions')
      .selectAll()
      .execute();
    const browser = await account();
    const auditBefore = await closingAudit();
    await as(
      browser,
      [{ role: 'academic_vice_principal', branchId: b.s.branch }],
      async ({ get, put, post }) => {
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
      },
    );
    expect(await closingAudit()).toBe(auditBefore);
    expect(
      await t.database.migrator.selectFrom('quarter_result_decisions').selectAll().execute(),
    ).toEqual(decisionsBefore);
    expect(await t.rowsOf(b.s.branch)).toEqual(rowsBefore.north);
    expect(await t.rowsOf(other.s.branch)).toEqual(rowsBefore.south);
  });
});
