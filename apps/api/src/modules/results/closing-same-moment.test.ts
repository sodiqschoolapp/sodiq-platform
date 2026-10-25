import {
  CLOSING_WARNINGS,
  closingChecklistSchema,
  REQUEST_KEY_HEADER,
  studentDetailSchema,
  type ClosingChecklist,
  type ClosingItem,
} from '@sodiq/shared';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Response, Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit, type MemberRow } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

/** Saturday 31 October 2026, the last day of quarter 1, 18:00 in Tashkent. */
const CLOSE = '2026-10-31T18:00:00+05:00';

/** Tuesday 27 October 2026, noon: the checklist of quarter 1 is open, the results are decided. */
const MOMENT = '2026-10-27T12:00:00+05:00';

const VALID_FROM = new Date('2026-09-01T00:00:00+05:00');

const codeOf = (response: Response): unknown =>
  (response.body as { error?: { code?: string } }).error?.code;

const checklistOf = (response: Response): ClosingChecklist => {
  expect(response.status, JSON.stringify(response.body).slice(0, 800)).toBe(200);
  return closingChecklistSchema.parse(response.body);
};

type Kind = ClosingItem['kind'];

const itemsOf = <K extends Kind>(list: ClosingChecklist, kind: K) =>
  list.items.filter((item): item is Extract<ClosingItem, { kind: K }> => item.kind === kind);

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

const checklistPath = (quarterId: string) => `/api/results/closing?quarterId=${quarterId}`;
const closePath = (quarterId: string) => `/api/results/closing/${quarterId}/close`;

// All names are invented. Task 9.2b, pull request #230: the close of a quarter at the same moment
// as three writers of the quarter, each in both orders (the plan: "The same pair for a one-day
// cancel and for a plan request sent, against the close"; review correction 3: "add to the
// same-moment tests a leaving dated in the quarter against the close, in both orders"). Each
// writer writes many tables, so both real routes run in a fixed order (`.claude/rules/api.md`): a
// third transaction holds the quarter row `for update`, the first route starts and waits on it,
// the second starts and waits, the hold is released, and the asserts depend on which committed
// first (`edge/journal`, Closing and reopening: the close "refuses new entries from that instant";
// `edge/timetable`: "Not possible in a closed quarter."; `edge/lesson-plans`: "Nothing is possible
// in a closed quarter", "Waiting requests become void"; `edge/students-classes-groups` and From
// 8.6: the result at leaving stored at the close).
describe('the close of a quarter against a writer of the quarter at the same moment', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Malika', `Yusupova${'a'.repeat(names % 5)}`);
  };

  /** Runs `work` with the clock and every session at `moment`, then sets them back. */
  async function at<T>(moment: string, work: () => Promise<T>): Promise<T> {
    const fresh = (when: string) =>
      t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(when), last_used_at: new Date(when) })
        .execute();
    t.clock.set(moment);
    await fresh(moment);
    try {
      return await work();
    } finally {
      t.clock.set(START);
      await fresh(START);
    }
  }

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
  ): Promise<string> => {
    const kit = new MembersKit(t.database.migrator, await load.classes.account());
    const id = await kit.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: name.first, last_name: name.last })
      .where('id', '=', id)
      .execute();
    for (const row of rows) {
      await kit.member({ branch, studentId: id, ...row });
    }
    return id;
  };

  /**
   * The graded maths scene of closing.test.ts, smaller (Mondays 12, 19 and 26 October): Aziz
   * present on the 12th with a classwork 9 of 10 and absent on the 19th, Bek present on the 12th
   * and the 19th, Dilshod with nothing; the 26th holds nothing. The class's teacher is an account
   * with the Teacher role, the Academic Vice Principal another; every undecided result is decided
   * at MOMENT, and the warnings are read then, as the screen sends them.
   */
  async function base() {
    const teacher = await account();
    const vice = await account();
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: teacher.account.id },
    });
    await t.kit.giveRole(teacher.account.id, {
      role: 'teacher',
      branchId: s.branch,
      validFrom: VALID_FROM,
    });
    await t.kit.giveRole(vice.account.id, {
      role: 'academic_vice_principal',
      branchId: s.branch,
      validFrom: VALID_FROM,
    });
    const lessons = await t.database.migrator
      .selectFrom('lessons')
      .select(['id', sql<string>`lesson_date::text`.as('date')])
      .where('class_id', '=', s.classId)
      .where('lesson_date', '<=', '2026-10-31')
      .orderBy('starts_at')
      .execute();
    const [l12, l19, l26] = lessons;
    if (l12 === undefined || l19 === undefined || l26 === undefined || lessons.length !== 3) {
      throw new Error('Three lessons.');
    }
    const whole = [{ classId: s.classId, from: '2026-09-01' }];
    const aziz = await student(s.branch, { first: 'Aziz', last: 'Karimov' }, whole);
    const bek = await student(s.branch, { first: 'Bek', last: 'Toshev' }, whole);
    const dilshod = await student(s.branch, { first: 'Dilshod', last: 'Ergashev' }, whole);
    const cw = (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: s.branch, lesson_id: l12.id, kind: 'classwork', total: 10 })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await saveOn(s.branch, l12.date, [
      { lessonId: l12.id, studentId: aziz, value: 1 },
      { lessonId: l12.id, studentId: aziz, workId: cw, value: 9 },
      { lessonId: l12.id, studentId: bek, value: 1 },
    ]);
    await saveOn(s.branch, l19.date, [
      { lessonId: l19.id, studentId: aziz, value: 0 },
      { lessonId: l19.id, studentId: bek, value: 1 },
    ]);
    // The edit period of closing.test.ts: 7 days, so the 26th is still open at the close.
    await t.database.migrator
      .updateTable('branch_edit_days')
      .set({ edit_days: 7 })
      .where('branch_id', '=', s.branch)
      .execute();
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .executeTakeFirstOrThrow()
    ).id;
    const q1 = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    const warnings = await at(MOMENT, async () => {
      const list = checklistOf(await t.get(checklistPath(q1), s.branch, vice.cookie));
      for (const item of itemsOf(list, 'undecided')) {
        for (const one of item.students) {
          const decided = await t.put(
            `/api/results/closing/${q1}/decisions`,
            s.branch,
            {
              subjectId: item.journal?.subject.id,
              studentId: one.student.id,
              decision: one.allowed.includes('keep') ? 'keep' : one.allowed[0],
              version: one.version,
            },
            vice.cookie,
          );
          expect(decided.status, JSON.stringify(decided.body)).toBe(200);
        }
      }
      return warningsOf(checklistOf(await t.get(checklistPath(q1), s.branch, vice.cookie)));
    });
    return {
      s,
      teacher,
      vice,
      aziz,
      bek,
      dilshod,
      journal,
      q1,
      warnings,
      lessons: { l12, l19, l26 },
    };
  }

  type Base = Awaited<ReturnType<typeof base>>;

  /** The close as the screen sends it: "lock now" and the warnings read at MOMENT. */
  const close = (b: Base): Test =>
    t
      .post(
        closePath(b.q1),
        b.s.branch,
        { warnings: b.warnings, lockNow: true, startQuarter: null },
        b.vice.cookie,
      )
      .set(REQUEST_KEY_HEADER, randomUUID());

  /** The waits of this test database on a lock not granted (`.claude/rules/database.md`). */
  const waiters = async () => {
    const found = await sql<{ n: number }>`
      select count(distinct l.pid)::int as n
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.n ?? 0;
  };

  const untilWaiting = async (count: number) => {
    for (let tries = 0; tries < 800; tries += 1) {
      if ((await waiters()) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Fewer than ${String(count)} waited on the held side.`);
  };

  /** Those the held transaction blocks (`pg_blocking_pids`). */
  const blockedBy = async (pid: number) => {
    const found = await sql<{ n: number }>`
      select count(*)::int as n from pg_stat_activity a
      where a.datname = current_database() and ${pid}::int = any(pg_blocking_pids(a.pid))
    `.execute(t.database.migrator);
    return found.rows[0]?.n ?? 0;
  };

  /** Starts a request now: a supertest request is sent only once it is awaited. */
  const start = (request: () => Test) =>
    new Promise<Response>((resolve, reject) => {
      request().then(resolve, reject);
    });

  /**
   * Both real routes in a fixed order at CLOSE: a transaction of the branch holds the quarter row
   * `for update`, the first route starts and waits on it, then the second starts and waits, and
   * the hold is released. Answers both responses, the first's first.
   */
  async function inOrder(
    b: Base,
    first: () => Test,
    second: () => Test,
  ): Promise<[Response, Response]> {
    return at(CLOSE, async () => {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: (pid: number) => void = () => undefined;
      const isReady = new Promise<number>((resolve) => {
        ready = resolve;
      });
      const held = t.app
        .get(Transactions)
        .run([b.s.branch], async (transaction) => {
          await transaction
            .selectFrom('quarters')
            .select('id')
            .where('id', '=', b.q1)
            .forUpdate()
            .execute();
          const own = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
            transaction,
          );
          ready(own.rows[0]?.pid ?? 0);
          await released;
        })
        .catch((error: unknown) => error);
      const pid = await isReady;
      expect(await waiters()).toBe(0);
      const one = start(first);
      await untilWaiting(1);
      const two = start(second);
      await untilWaiting(2);
      // The first waits on the held quarter row; the second waits behind it.
      expect(await blockedBy(pid)).toBeGreaterThanOrEqual(1);
      release();
      expect(await held).toBeUndefined();
      return [await one, await two];
    });
  }

  const ok = (response: Response) => {
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  };

  const refused = (response: Response, code: string) => {
    expect([response.status, codeOf(response)], JSON.stringify(response.body)).toEqual([409, code]);
  };

  const closingsOf = (quarter: string) =>
    t.database.migrator
      .selectFrom('quarter_closings')
      .select('id')
      .where('quarter_id', '=', quarter)
      .execute();

  const finalRecordsOf = (quarter: string) =>
    t.database.migrator
      .selectFrom('quarter_final_results')
      .select(['student_id', 'kind', 'record'])
      .where('quarter_id', '=', quarter)
      .execute();

  /** The marks of Aziz's stored record, one per lesson the close counted. */
  const azizLessons = async (b: Base) => {
    const record = (await finalRecordsOf(b.q1)).find((one) => one.student_id === b.aziz);
    if (record === undefined) throw new Error('No record of Aziz.');
    return (record.record as { inputs: { lessons: { mark: number | null }[] } }).inputs.lessons.map(
      (one) => one.mark,
    );
  };

  const auditOf = (branch: string, action: string) =>
    t.database.migrator
      .selectFrom('audit_log')
      .select('id')
      .where('branch_id', '=', branch)
      .where('action', '=', action)
      .execute();

  // -------------------------------------------------------------------------
  // 1. A cancel of a past lesson (the correction, From 5.6a-1 and 5.6a-4).

  const cancelOf = (b: Base) => () =>
    t
      .post(
        `/api/timetable/lessons/${b.lessons.l26.id}/correction`,
        b.s.branch,
        { kind: 'cancel', reason: 'The class was on an excursion' },
        b.vice.cookie,
      )
      .set(REQUEST_KEY_HEADER, randomUUID());

  const cancelCauseOf = async (lessonId: string) =>
    (
      await t.database.migrator
        .selectFrom('lessons')
        .select('cancel_cause')
        .where('id', '=', lessonId)
        .executeTakeFirstOrThrow()
    ).cancel_cause;

  it('a cancel of a lesson of the quarter first: both answer 200 and the close leaves the lesson out', async () => {
    const b = await base();
    const [cancelled, closed] = await inOrder(b, cancelOf(b), () => close(b));
    ok(cancelled);
    ok(closed);
    expect(await cancelCauseOf(b.lessons.l26.id)).toBe('reason');
    expect(await closingsOf(b.q1)).toHaveLength(1);
    // The 12th (1) and the 19th (0): the 26th, cancelled before the close, is not counted.
    expect(await azizLessons(b)).toEqual([1, 0]);
  });

  it('the close first: the close answers 200 and the cancel quarter_closed, the lesson held', async () => {
    const b = await base();
    const audit = (await auditOf(b.s.branch, 'lesson.correct')).length;
    const [closed, cancelled] = await inOrder(b, () => close(b), cancelOf(b));
    ok(closed);
    refused(cancelled, 'quarter_closed');
    expect(await cancelCauseOf(b.lessons.l26.id)).toBeNull();
    expect(await auditOf(b.s.branch, 'lesson.correct')).toHaveLength(audit);
    // The 26th counted by the close, with no mark.
    expect(await azizLessons(b)).toEqual([1, 0, null]);
  });

  // -------------------------------------------------------------------------
  // 2. A plan request sent by the teacher (From 7.2).

  const askOf = (b: Base) => () =>
    t.post(
      `/api/plans/journals/${b.journal}/requests`,
      b.s.branch,
      { quarterId: b.q1, kind: 'text', lessonIds: [b.lessons.l12.id], reason: 'Typo' },
      b.teacher.cookie,
    );

  const requestsOf = (b: Base) =>
    t.database.migrator
      .selectFrom('lesson_plan_requests')
      .select(['id', 'status'])
      .where('branch_id', '=', b.s.branch)
      .where('quarter_id', '=', b.q1)
      .execute();

  it('a plan request sent first: both answer 200 and the close makes the request void', async () => {
    const b = await base();
    const [asked, closed] = await inOrder(b, askOf(b), () => close(b));
    expect(asked.status, JSON.stringify(asked.body)).toBe(201);
    ok(closed);
    expect((closed.body as { voided: number }).voided).toBe(1);
    const requests = await requestsOf(b);
    expect(requests.map((one) => [one.id, one.status])).toEqual([
      [(asked.body as { id: string }).id, 'void'],
    ]);
    expect(await auditOf(b.s.branch, 'plan.requests_voided')).toHaveLength(1);
  });

  it('the close first: the close answers 200 and the plan request plan_quarter_closed, nothing stored', async () => {
    const b = await base();
    const [closed, asked] = await inOrder(b, () => close(b), askOf(b));
    ok(closed);
    expect((closed.body as { voided: number }).voided).toBe(0);
    refused(asked, 'plan_quarter_closed');
    expect(await requestsOf(b)).toEqual([]);
    expect(await auditOf(b.s.branch, 'plan.requests_voided')).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 3. A leaving of a student dated in the quarter (From 3.1b and 8.6).

  /** The leaving of Dilshod with the last day 30 October, with the version read before. */
  const leavingOf = async (b: Base) => {
    const version = await at(CLOSE, async () => {
      const read = await t.get(`/api/people/students/${b.dilshod}`, b.s.branch, b.vice.cookie);
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      return studentDetailSchema.parse(read.body).version;
    });
    return () =>
      t.post(
        `/api/people/students/${b.dilshod}/leaving`,
        b.s.branch,
        { lastDay: '2026-10-30', reason: 'The family moved to another city.', version },
        b.vice.cookie,
      );
  };

  const statusesOf = async (studentId: string) =>
    (
      await t.database.migrator
        .selectFrom('student_statuses')
        .select(['status', sql<string>`valid_from::text`.as('from')])
        .where('student_id', '=', studentId)
        .orderBy('valid_from')
        .execute()
    ).map((one) => [one.status, one.from]);

  it('a leaving dated in the quarter first: both answer 200 and the close stores the result at leaving', async () => {
    const b = await base();
    const leave = await leavingOf(b);
    const [left, closed] = await inOrder(b, leave, () => close(b));
    ok(left);
    ok(closed);
    expect(await statusesOf(b.dilshod)).toEqual([
      ['active', '2026-09-01'],
      ['inactive', '2026-10-31'],
    ]);
    const kinds = new Map((await finalRecordsOf(b.q1)).map((one) => [one.student_id, one.kind]));
    expect(kinds.get(b.dilshod)).toBe('at_leaving');
    expect(kinds.get(b.aziz)).toBe('closing');
  });

  it('the close first: the close answers 200 and the leaving date_in_closed_quarter, nothing stored', async () => {
    const b = await base();
    const leave = await leavingOf(b);
    const before = await statusesOf(b.dilshod);
    const audit = (await auditOf(b.s.branch, 'student.leave')).length;
    const [closed, left] = await inOrder(b, () => close(b), leave);
    ok(closed);
    refused(left, 'date_in_closed_quarter');
    expect(await statusesOf(b.dilshod)).toEqual(before);
    expect(before).toEqual([['active', '2026-09-01']]);
    expect(await auditOf(b.s.branch, 'student.leave')).toHaveLength(audit);
    const kinds = new Map((await finalRecordsOf(b.q1)).map((one) => [one.student_id, one.kind]));
    expect(kinds.get(b.dilshod)).toBe('closing');
  });
});
