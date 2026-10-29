import {
  ATTENDANCE_MARKS,
  BRANCH_HEADER,
  ratingSubjectListSchema,
  type PreparedStamp,
  type RatingSubjectList,
} from '@sodiq/shared';
import { finalQuarterRecord } from '@sodiq/calc';
import fc from 'fast-check';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../../database/transactions.js';
import { setEditDays } from '../../../testing/branch-filter-sql.js';
import { closeQuarter } from '../../../testing/closing-kit.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../../testing/day-templates-kit.js';
import { LoadKit } from '../../../testing/load-kit.js';
import { MembersKit } from '../../../testing/members-kit.js';
import { prepareBranch, withoutStamp } from '../../../testing/prepared-kit.js';
import { ratingEntryAndNote } from '../../../testing/rating-kit.js';
import { publishedScene, type PublishedScene } from '../../../testing/published-scene.js';
import { Audit } from '../../audit/audit.service.js';
import { saveCells } from '../../journal/cells.js';
import { PreparedTotals, prepareUnit } from './prepare.job.js';
import {
  freshLessons,
  PREPARED_SHAPE,
  pruneSchoolChanges,
  SCHOOL_INPUTS,
} from './prepared.query.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

// All names are invented. Task 9.3b-1, the prepared report totals: `08`, Analytics in Release 1,
// "Totals are prepared in the background when journal data changes"; `edge/system-behaviour`,
// "Report totals are two minutes behind the journal ... A page that finds them behind calculates
// from source and shows 'updating'"; CLAUDE.md, the database guards the rules and state from
// stored moments.
describe('the prepared report totals (task 9.3b-1)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let principal: { cookie: string; account: { id: string } };

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    principal = await t.kit.completeSession('Nodira', 'Rahimova');
  });

  afterAll(async () => {
    await t.close();
  });

  const lessonsOf = async (classId: string) =>
    (
      await t.database.migrator
        .selectFrom('lessons')
        .select(['id', sql<string>`lesson_date::text`.as('date'), 'starts_at'])
        .where('class_id', '=', classId)
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute()
    ).map((one) => ({ id: one.id, date: one.date, startsAt: one.starts_at }));

  const changesOf = (branch: string) =>
    t.database.migrator
      .selectFrom('report_changes')
      .select(['journal_id', 'quarter_id', 'xid'])
      .where('branch_id', '=', branch)
      .orderBy('xid')
      .execute();

  /** A graded scene: one classwork of 10 on the 12th; Aziz 9 of 10, Bobur 8 of 10, both present. */
  async function scene() {
    const s = await publishedScene(t, load, { graded: true });
    const [l12, l19] = await lessonsOf(s.classId);
    if (l12 === undefined || l19 === undefined) throw new Error('The lessons of the class.');
    const kit = new MembersKit(t.database.migrator, await load.classes.account());
    const students: string[] = [];
    for (const [first, last] of [
      ['Aziz', 'Akbarov'],
      ['Bobur', 'Boboyev'],
    ] as const) {
      const id = await kit.student(s.branch, { startsOn: '2026-09-01', grade: 7 });
      await t.database.migrator
        .updateTable('students')
        .set({ first_name: first, last_name: last })
        .where('id', '=', id)
        .execute();
      await kit.member({ branch: s.branch, studentId: id, classId: s.classId, from: '2026-09-01' });
      students.push(id);
    }
    const [aziz = '', bobur = ''] = students;
    const work = (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: s.branch, lesson_id: l12.id, kind: 'classwork', total: 10 })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await saveOn(s, l12.date, [
      { lessonId: l12.id, studentId: aziz, value: 1 },
      { lessonId: l12.id, studentId: bobur, value: 1 },
      { lessonId: l12.id, studentId: aziz, workId: work, value: 9 },
      { lessonId: l12.id, studentId: bobur, workId: work, value: 8 },
    ]);
    const quarter = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    const journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .executeTakeFirstOrThrow()
    ).id;
    await t.kit.giveRole(principal.account.id, {
      role: 'principal',
      branchId: s.branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    return { s, l12, l19, aziz, bobur, work, quarter, journal };
  }

  type Cell = { lessonId: string; studentId: string; workId?: string; value: number };

  const versionOf = async (cell: Cell): Promise<number | null> =>
    (
      await t.database.migrator
        .selectFrom('journal_cells')
        .select('version')
        .where('lesson_id', '=', cell.lessonId)
        .where('student_id', '=', cell.studentId)
        .where((eb) =>
          cell.workId === undefined ? eb('work_id', 'is', null) : eb('work_id', '=', cell.workId),
        )
        .executeTakeFirst()
    )?.version ?? null;

  async function saveOn(s: PublishedScene, date: string, cells: Cell[], fail = false) {
    t.clock.set(`${date}T18:00:00+05:00`);
    try {
      const writer = await load.classes.account();
      // Each cell with the version stored, as the grid sends it.
      const versions = await Promise.all(cells.map((cell) => versionOf(cell)));
      await t.app.get(Transactions).run([s.branch], async (transaction) => {
        await saveCells(
          transaction,
          t.app.get(Audit),
          { accountId: writer },
          cells.map((cell, index) => ({
            lessonId: cell.lessonId,
            studentId: cell.studentId,
            workId: cell.workId ?? null,
            value: cell.value,
            version: versions[index] ?? null,
          })),
        );
        if (fail) throw new Error('Rolled back on purpose.');
      });
    } finally {
      t.clock.set(START);
    }
  }

  /** The rating of the class in the subject, as the Principal, at `moment`. */
  async function rating(
    c: Awaited<ReturnType<typeof scene>>,
    moment = MOMENT,
  ): Promise<RatingSubjectList> {
    t.clock.set(moment);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
        .where('account_id', '=', principal.account.id)
        .execute();
      const response = await request(t.kit.server)
        .get(`/api/results/rating/subject?quarterId=${c.quarter}&journalId=${c.journal}`)
        .set('Cookie', principal.cookie)
        .set(BRANCH_HEADER, c.s.branch);
      expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
      return ratingSubjectListSchema.parse(response.body);
    } finally {
      t.clock.set(START);
    }
  }

  /** Any read as the Principal at `moment`: its body. */
  async function read(c: Awaited<ReturnType<typeof scene>>, path: string, moment = MOMENT) {
    t.clock.set(moment);
    try {
      await t.database.migrator
        .updateTable('sessions')
        .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
        .where('account_id', '=', principal.account.id)
        .execute();
      const response = await request(t.kit.server)
        .get(path)
        .set('Cookie', principal.cookie)
        .set(BRANCH_HEADER, c.s.branch);
      expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
      return response.body as { prepared: PreparedStamp } & Record<string, unknown>;
    } finally {
      t.clock.set(START);
    }
  }

  async function prepare(branch: string, moment = MOMENT): Promise<number> {
    t.clock.set(moment);
    try {
      return await prepareBranch(t, branch);
    } finally {
      t.clock.set(START);
    }
  }

  const valueOf = (list: RatingSubjectList, studentId: string) =>
    list.rows.find((row) => row.student.id === studentId)?.value;

  it('shows "updating" with the figure from source while behind, then the same figure prepared, "updated at" and not updating (the Done when of 9.3b)', async () => {
    const c = await scene();
    const before = await rating(c);
    expect(before.prepared).toEqual<PreparedStamp>({ updatedAt: null, updating: true });
    // 20 · 100 and 40 · 90 over 60: 93.3; 80 gives 86.7.
    expect([valueOf(before, c.aziz), valueOf(before, c.bobur)]).toEqual([933, 867]);
    expect(await prepare(c.s.branch)).toBeGreaterThan(0);
    const prepared = await rating(c);
    expect(prepared.prepared).toEqual<PreparedStamp>({
      updatedAt: new Date(MOMENT).toISOString(),
      updating: false,
    });
    expect(withoutStamp(prepared)).toEqual(withoutStamp(before));
    // Nothing changed: a second run prepares nothing.
    expect(await prepare(c.s.branch)).toBe(0);

    // A save: behind at once, the new figure from source, then prepared.
    await saveOn(c.s, c.l12.date, [
      { lessonId: c.l12.id, studentId: c.bobur, workId: c.work, value: 10 },
    ]);
    const behind = await rating(c);
    expect(behind.prepared.updating).toBe(true);
    expect(valueOf(behind, c.bobur)).toBe(1000);
    expect(await prepare(c.s.branch)).toBeGreaterThan(0);
    const after = await rating(c);
    expect(after.prepared.updating).toBe(false);
    expect(valueOf(after, c.bobur)).toBe(1000);
  });

  it('writes one change row per journal and statement in the transaction of the change, with the quarter of the lesson; a rolled-back change leaves none', async () => {
    const c = await scene();
    await t.database.migrator
      .deleteFrom('report_changes')
      .where('branch_id', '=', c.s.branch)
      .execute();
    await saveOn(c.s, c.l12.date, [
      { lessonId: c.l12.id, studentId: c.aziz, workId: c.work, value: 7 },
      { lessonId: c.l12.id, studentId: c.bobur, workId: c.work, value: 6 },
    ]);
    const rows = await changesOf(c.s.branch);
    // The save, its history and its audit: only the tables of the journal write a row, and a
    // statement over two cells writes one.
    expect(rows.map((row) => [row.journal_id, row.quarter_id])).toContainEqual([
      c.journal,
      c.quarter,
    ]);
    expect(new Set(rows.map((row) => row.xid)).size).toBe(1);
    expect(rows.filter((row) => row.journal_id === null)).toEqual([]);

    await t.database.migrator
      .deleteFrom('report_changes')
      .where('branch_id', '=', c.s.branch)
      .execute();
    await expect(
      saveOn(
        c.s,
        c.l12.date,
        [{ lessonId: c.l12.id, studentId: c.aziz, workId: c.work, value: 5 }],
        true,
      ),
    ).rejects.toThrow('Rolled back on purpose.');
    expect(await changesOf(c.s.branch)).toEqual([]);
  });

  it('marks the whole branch for an input that touches many journals (an exemption), written as the application user under the branch filter', async () => {
    const c = await scene();
    await t.database.migrator
      .deleteFrom('report_changes')
      .where('branch_id', '=', c.s.branch)
      .execute();
    const writer = await load.classes.account();
    await t.app.get(Transactions).run([c.s.branch], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: c.s.branch,
        actorId: writer,
        action: 'exemption.create',
      });
      await transaction
        .insertInto('exemptions')
        .values({
          branch_id: c.s.branch,
          student_id: c.aziz,
          year_id: c.s.year,
          batch_id: '019a0000-0000-7000-8000-0000000000a1',
          kind: 'temporary',
          all_subjects: true,
          start_date: '2026-10-19',
          end_date: '2026-10-24',
          start_time: null,
          end_time: null,
          category: 'illness',
          detail: 'A certificate from the clinic',
          granted_by: writer,
          granted_at: new Date(0),
          version: 0,
          changed_at: new Date(0),
        })
        .execute();
    });
    const rows = await changesOf(c.s.branch);
    // The exemption and the spans its trigger writes: each statement a row for the whole branch.
    expect(rows.length).toBeGreaterThan(0);
    expect(
      new Set(rows.map((row) => `${String(row.journal_id)}|${String(row.quarter_id)}`)),
    ).toEqual(new Set(['null|null']));
  });

  it("keeps every branch's prepared rows and change rows from the other branches", async () => {
    const c = await scene();
    await prepare(c.s.branch);
    const other = await t.newBranch();
    const seen = await t.app.get(Transactions).run([other], async (transaction) => ({
      prepared: await sql<{
        n: string;
      }>`select count(*)::text as n from report_prepared where branch_id = ${c.s.branch}`.execute(
        transaction,
      ),
      lessons: await sql<{
        n: string;
      }>`select count(*)::text as n from report_prepared_lessons where branch_id = ${c.s.branch}`.execute(
        transaction,
      ),
      changes: await sql<{
        n: string;
      }>`select count(*)::text as n from report_changes where branch_id = ${c.s.branch}`.execute(
        transaction,
      ),
    }));
    expect([seen.prepared.rows[0]?.n, seen.lessons.rows[0]?.n, seen.changes.rows[0]?.n]).toEqual([
      '0',
      '0',
      '0',
    ]);
    const own = await t.database.migrator
      .selectFrom('report_prepared')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('branch_id', '=', c.s.branch)
      .executeTakeFirstOrThrow();
    expect(Number(own.n)).toBeGreaterThan(0);
  });

  it('leaves a unit behind when a change began before its preparation and committed after it', async () => {
    const c = await scene();
    await prepare(c.s.branch);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => undefined;
    const written = new Promise<void>((resolve) => {
      started = resolve;
    });
    t.clock.set(`${c.l12.date}T18:00:00+05:00`);
    const writer = await load.classes.account();
    const change = t.app.get(Transactions).run([c.s.branch], async (transaction) => {
      await saveCells(transaction, t.app.get(Audit), { accountId: writer }, [
        {
          lessonId: c.l12.id,
          studentId: c.aziz,
          workId: c.work,
          value: 2,
          version: await versionOf({
            lessonId: c.l12.id,
            studentId: c.aziz,
            workId: c.work,
            value: 2,
          }),
        },
      ]);
      started();
      await held;
    });
    await written;
    t.clock.set(MOMENT);
    // The unit prepared while the change is open: its snapshot cannot see it.
    const timeZone = 'Asia/Tashkent';
    await t.app.get(Transactions).run([c.s.branch], (transaction) =>
      prepareUnit(transaction, c.s.branch, timeZone, {
        kind: 'outcomes',
        quarterId: c.quarter,
        unitId: c.s.subject,
      }),
    );
    release();
    await change;
    t.clock.set(START);
    const list = await rating(c);
    expect(list.prepared.updating).toBe(true);
    // 20 · 100 and 40 · 20 over 60.
    expect(valueOf(list, c.aziz)).toBe(467);
  });

  it('lets two saves of one journal on two lessons go on at once: no shared row is written (review of the plan, finding 7)', async () => {
    const c = await scene();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => undefined;
    const written = new Promise<void>((resolve) => {
      started = resolve;
    });
    const writer = await load.classes.account();
    t.clock.set(`${c.l19.date}T18:00:00+05:00`);
    const first = t.app.get(Transactions).run([c.s.branch], async (transaction) => {
      await saveCells(transaction, t.app.get(Audit), { accountId: writer }, [
        { lessonId: c.l19.id, studentId: c.aziz, workId: null, value: 1, version: null },
      ]);
      started();
      await held;
    });
    await written;
    // The second finishes while the first is still open: had it waited on a row the first holds,
    // the first (released only below) would never end, and the test would time out.
    const version = await versionOf({
      lessonId: c.l12.id,
      studentId: c.bobur,
      workId: c.work,
      value: 5,
    });
    await t.app.get(Transactions).run([c.s.branch], (transaction) =>
      saveCells(transaction, t.app.get(Audit), { accountId: writer }, [
        {
          lessonId: c.l12.id,
          studentId: c.bobur,
          workId: c.work,
          value: 5,
          version,
        },
      ]),
    );
    release();
    await first;
    t.clock.set(START);
  });

  it('gives the same figures after a cell is set and set back as before', async () => {
    const c = await scene();
    await prepare(c.s.branch);
    const before = await rating(c);
    await saveOn(c.s, c.l12.date, [
      { lessonId: c.l12.id, studentId: c.aziz, workId: c.work, value: 3 },
    ]);
    await saveOn(c.s, c.l12.date, [
      { lessonId: c.l12.id, studentId: c.aziz, workId: c.work, value: 9 },
    ]);
    await prepare(c.s.branch);
    const after = await rating(c);
    expect(after.prepared.updating).toBe(false);
    expect(after.rows).toEqual(before.rows);
  });

  it('is behind once a lesson of the subject starts, with no change of data (CLAUDE.md, state from stored moments), and prepares it again', async () => {
    const c = await scene();
    // Monday 26 October, 07:00: the lesson of the 26th has not started.
    const early = '2026-10-26T07:00:00+05:00';
    await prepare(c.s.branch, early);
    expect((await rating(c, early)).prepared.updating).toBe(false);
    const next = await t.database.migrator
      .selectFrom('report_prepared')
      .select('next_change_at')
      .where('branch_id', '=', c.s.branch)
      .where('kind', '=', 'outcomes')
      .where('quarter_id', '=', c.quarter)
      .executeTakeFirstOrThrow();
    const lessons = await lessonsOf(c.s.classId);
    const startOf26 = lessons.find((one) => one.date === '2026-10-26')?.startsAt;
    expect(next.next_change_at).toEqual(startOf26);
    // Past the start of that lesson: behind until prepared again.
    const later = '2026-10-26T12:00:00+05:00';
    expect((await rating(c, later)).prepared.updating).toBe(true);
    expect(await prepare(c.s.branch, later)).toBeGreaterThan(0);
    expect((await rating(c, later)).prepared.updating).toBe(false);
  });

  it('moves with the date while the quarter runs, and no longer after its last day', async () => {
    const c = await scene();
    const lastDay = '2026-10-31T10:00:00+05:00';
    await prepare(c.s.branch, lastDay);
    const nextOf = async () =>
      (
        await t.database.migrator
          .selectFrom('report_prepared')
          .select('next_change_at')
          .where('branch_id', '=', c.s.branch)
          .where('kind', '=', 'figures')
          .where('quarter_id', '=', c.quarter)
          .executeTakeFirstOrThrow()
      ).next_change_at;
    // No lesson left on Saturday: the next midnight of the branch.
    expect(await nextOf()).toEqual(new Date('2026-11-01T00:00:00+05:00'));
    const after = '2026-11-02T10:00:00+05:00';
    await prepare(c.s.branch, after);
    expect(await nextOf()).toBeNull();
  });

  it('reads a closed quarter from its stored records, also when the cells now give another figure: closing makes it behind, and the prepared list gives the stored value (review of the plan, finding 6)', async () => {
    const c = await scene();
    await prepare(c.s.branch);
    const accountId = await load.classes.account();
    const closing = await closeQuarter(t.database, {
      branchId: c.s.branch,
      quarterId: c.quarter,
      accountId,
    });
    // The close writes a change row of the whole branch (`quarter_closings`, no journal).
    const changes = await changesOf(c.s.branch);
    expect(changes.some((row) => row.journal_id === null)).toBe(true);
    // Aziz's stored record: 10 of 10, a result of 100, where the cells give 93.3.
    const record = finalQuarterRecord(
      {
        weights: { attendance: 20, classwork: 40, homework: 40, ratingExam: null },
        attendanceValues: { lateValue: 50, skippedValue: 0 },
        lessons: [{ mark: 1, classworks: [{ score: 10, total: 10 }], homeworks: [] }],
        ratingExam: null,
        quarterClosed: true,
        heldInJournals: 1,
        countsFrom: null,
        leftSubjectOn: null,
        atLeaving: null,
        decision: null,
      },
      'closing',
    );
    await t.database.migrator
      .insertInto('quarter_final_results')
      .values({
        branch_id: c.s.branch,
        closing_id: closing,
        quarter_id: c.quarter,
        subject_id: c.s.subject,
        student_id: c.aziz,
        journal_id: c.journal,
        kind: 'closing',
        record: JSON.stringify(record),
      })
      .execute();
    const after = '2026-11-02T12:00:00+05:00';
    const fromSource = await rating(c, after);
    expect(fromSource.prepared.updating).toBe(true);
    expect(fromSource.quarter.closed).toBe(true);
    expect(valueOf(fromSource, c.aziz)).toBe(1000);
    await prepare(c.s.branch, after);
    const prepared = await rating(c, after);
    expect(prepared.prepared.updating).toBe(false);
    expect(valueOf(prepared, c.aziz)).toBe(1000);
    expect(withoutStamp(prepared)).toEqual(withoutStamp(fromSource));
  });

  it('replaces every lesson row of a journal when it is prepared again, so the row of a lesson that is gone goes with it (review of the plan, finding 5)', async () => {
    const c = await scene();
    await prepare(c.s.branch);
    const gone = '019a0000-0000-7000-8000-0000000000ff';
    await t.database.migrator
      .insertInto('report_prepared_lessons')
      .values({
        branch_id: c.s.branch,
        quarter_id: c.quarter,
        journal_id: c.journal,
        lesson_id: gone,
        value: JSON.stringify({ $o: {} }),
      })
      .execute();
    await saveOn(c.s, c.l12.date, [
      { lessonId: c.l12.id, studentId: c.aziz, workId: c.work, value: 8 },
    ]);
    await prepare(c.s.branch);
    const left = await t.database.migrator
      .selectFrom('report_prepared_lessons')
      .select('lesson_id')
      .where('lesson_id', '=', gone)
      .execute();
    expect(left).toEqual([]);
  });

  it('is behind when a school-wide input changes (a subject has no branch to write a change row in)', async () => {
    const c = await scene();
    await prepare(c.s.branch);
    expect((await rating(c)).prepared.updating).toBe(false);
    await t.database.migrator
      .updateTable('subjects')
      .set({ colour: 'green' })
      .where('id', '=', c.s.subject)
      .execute();
    expect((await rating(c)).prepared.updating).toBe(true);
  });

  // Task 10.1b, decision 3 (Look first): the school-wide inputs write change rows of their own
  // (0143) in place of the fingerprint read on each request.
  describe('the school-wide change rows (task 10.1b)', () => {
    const schoolChanges = async () =>
      (
        await t.database.migrator
          .selectFrom('report_school_changes')
          .select(['table_name'])
          .orderBy('xid')
          .execute()
      ).map((one) => one.table_name);

    it('watches every school-wide input on insert, update and delete', async () => {
      const found = await sql<{ table: string; event: string }>`
        select c.relname as table, substring(g.tgname from '_school_([a-z]+)$') as event
        from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_proc p on p.oid = g.tgfoid
        where p.proname = 'report_changed_school'
        order by 1, 2
      `.execute(t.database.migrator);
      expect(found.rows).toEqual(
        [...SCHOOL_INPUTS]
          .sort()
          .flatMap((table) => ['delete', 'insert', 'update'].map((event) => ({ table, event }))),
      );
    });

    it('makes every unit behind on an insert, an update or a delete of a school-wide input; a statement that changes no row writes none', async () => {
      const c = await scene();
      const path = '/api/results/early-warning';
      const m = t.database.migrator;
      const behindAfter = async (table: string, write: () => Promise<unknown>) => {
        await prepare(c.s.branch);
        expect((await read(c, path)).prepared.updating, table).toBe(false);
        await write();
        expect((await schoolChanges()).at(-1), table).toBe(table);
        expect((await read(c, path)).prepared.updating, table).toBe(true);
      };
      let subject = '';
      await behindAfter('subjects', async () => {
        subject = await load.classes.subject({ name: 'Astronomy', grades: [7] });
      });
      await behindAfter('subjects', () =>
        m.updateTable('subjects').set({ colour: 'red' }).where('id', '=', subject).execute(),
      );
      await behindAfter('staff', () =>
        sql`update staff set first_name = first_name where id = (select min(id::text)::uuid from staff)`.execute(
          m,
        ),
      );
      // A delete: the switches the new subject was created with.
      await behindAfter('subject_switches', () =>
        m.deleteFrom('subject_switches').where('subject_id', '=', subject).execute(),
      );
      // A statement that changes no row writes none, and the units stay fresh.
      await prepare(c.s.branch);
      const before = await schoolChanges();
      await m.updateTable('subjects').set({ colour: 'red' }).where('id', '=', UNKNOWN).execute();
      await m
        .deleteFrom('absences')
        .where(sql<boolean>`false`)
        .execute();
      expect(await schoolChanges()).toEqual(before);
      expect((await read(c, path)).prepared.updating).toBe(false);
    });

    it('lets two writers of two school-wide inputs go on at once: no shared row is written (review of the plan, finding 2)', async () => {
      const c = await scene();
      const first = await t.database.migrator.connection().execute(async (one) => {
        await sql`begin`.execute(one);
        try {
          await one
            .updateTable('subjects')
            .set({ colour: 'blue' })
            .where('id', '=', c.s.subject)
            .execute();
          // The other writer commits while this one is still open: it would wait on a shared row.
          await sql`update staff set first_name = first_name where id = (select min(id::text)::uuid from staff)`.execute(
            t.database.migrator,
          );
          return true;
        } finally {
          await sql`commit`.execute(one);
        }
      });
      expect(first).toBe(true);
      expect((await schoolChanges()).slice(-2)).toEqual(['subjects', 'staff']);
    });

    it('keeps a school change row until every branch has prepared after it (review correction 2)', async () => {
      const a = await scene();
      const b = await scene();
      await prepare(a.s.branch);
      await prepare(b.s.branch);
      const path = '/api/results/early-warning';
      await t.database.migrator
        .updateTable('subjects')
        .set({ colour: 'teal' })
        .where('id', '=', a.s.subject)
        .execute();
      // Branch A prepared again and the school rows pruned: B has not seen the change yet.
      await prepare(a.s.branch);
      // The pruning of a run over every branch, with a snapshot taken now.
      const all = await t.database.migrator.selectFrom('branches').select('id').execute();
      await t.app.get(Transactions).run(
        all.map((one) => one.id),
        async (every) => {
          const now = await sql<{ seen: string }>`
            select pg_current_snapshot()::text as seen
          `.execute(every);
          await pruneSchoolChanges(every, now.rows[0]?.seen ?? '');
        },
      );
      expect(await schoolChanges()).toContain('subjects');
      expect((await read(a, path)).prepared.updating).toBe(false);
      expect((await read(b, path)).prepared.updating).toBe(true);
      // Every branch prepared: the row goes, and both stay fresh.
      t.clock.set(MOMENT);
      try {
        await t.app.get(PreparedTotals).run(Number.POSITIVE_INFINITY);
      } finally {
        t.clock.set(START);
      }
      expect(await schoolChanges()).toEqual([]);
      expect((await read(a, path)).prepared.updating).toBe(false);
      expect((await read(b, path)).prepared.updating).toBe(false);
    });
  });

  // Task 10.1b: the freshness of the lessons' facts is decided once per unit (journal).
  it('makes the lessons of a journal behind for a change row of that journal only', async () => {
    const c = await scene();
    await prepare(c.s.branch);
    const fresh = async () => {
      t.clock.set(MOMENT);
      try {
        return await t.app.get(Transactions).run([c.s.branch], async (transaction) =>
          [
            ...(
              await freshLessons(transaction, {
                branchId: c.s.branch,
                lessonIds: [c.l12.id, c.l19.id],
                now: new Date(MOMENT),
                schoolInputs: PREPARED_SHAPE,
              })
            ).keys(),
          ].sort(),
        );
      } finally {
        t.clock.set(START);
      }
    };
    expect(await fresh()).toEqual([c.l12.id, c.l19.id].sort());
    const changed = (journalId: string) =>
      t.database.migrator
        .insertInto('report_changes')
        .values({ branch_id: c.s.branch, quarter_id: c.quarter, journal_id: journalId })
        .execute();
    // A change of another journal of the branch leaves these lessons fresh.
    await changed(UNKNOWN);
    expect(await fresh()).toEqual([c.l12.id, c.l19.id].sort());
    await changed(c.journal);
    expect(await fresh()).toEqual([]);
  });

  it('leaves a unit behind when a change commits between the snapshot of its preparation and its reads (review correction 2)', async () => {
    const c = await scene();
    await prepare(c.s.branch);
    t.clock.set(MOMENT);
    await t.app.get(Transactions).run([c.s.branch], (transaction) =>
      prepareUnit(
        transaction,
        c.s.branch,
        'Asia/Tashkent',
        { kind: 'outcomes', quarterId: c.quarter, unitId: c.s.subject },
        {
          // Committed after the snapshot, before the reads: the reads may see it, the snapshot not.
          afterSnapshot: () =>
            saveOn(c.s, c.l12.date, [
              { lessonId: c.l12.id, studentId: c.aziz, workId: c.work, value: 2 },
            ]),
        },
      ),
    );
    t.clock.set(START);
    const list = await rating(c);
    expect(list.prepared.updating).toBe(true);
    expect(valueOf(list, c.aziz)).toBe(467);
  });

  it('gives the right figure when two runs of the job overlap, and never leaves a change unseen (code review, must-fix 1)', async () => {
    const c = await scene();
    await prepare(c.s.branch);
    await saveOn(c.s, c.l12.date, [
      { lessonId: c.l12.id, studentId: c.bobur, workId: c.work, value: 4 },
    ]);
    t.clock.set(MOMENT);
    try {
      const [first, second] = await Promise.all([
        prepareBranch(t, c.s.branch),
        prepareBranch(t, c.s.branch),
      ]);
      // Each unit behind is prepared once: the second run waits on the unit's lock and finds it fresh.
      expect(first + second).toBeGreaterThan(0);
    } finally {
      t.clock.set(START);
    }
    const list = await rating(c);
    expect(list.prepared.updating).toBe(false);
    // 20 · 100 and 40 · 40 over 60.
    expect(valueOf(list, c.bobur)).toBe(600);
    expect(await prepare(c.s.branch)).toBe(0);
    expect(await changesOf(c.s.branch)).toEqual([]);
  });

  it("moves a lesson's prepared facts to the unit of its new quarter without a conflict (code review, must-fix 2)", async () => {
    const c = await scene();
    await prepare(c.s.branch);
    const second = (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', c.s.year)
        .where('number', '=', 2)
        .executeTakeFirstOrThrow()
    ).id;
    // As if the 12th had belonged to quarter 2 when last prepared.
    await t.database.migrator
      .updateTable('report_prepared_lessons')
      .set({ quarter_id: second })
      .where('lesson_id', '=', c.l12.id)
      .execute();
    await saveOn(c.s, c.l12.date, [
      { lessonId: c.l12.id, studentId: c.aziz, workId: c.work, value: 7 },
    ]);
    expect(await prepare(c.s.branch)).toBeGreaterThan(0);
    const row = await t.database.migrator
      .selectFrom('report_prepared_lessons')
      .select('quarter_id')
      .where('lesson_id', '=', c.l12.id)
      .executeTakeFirstOrThrow();
    expect(row.quarter_id).toBe(c.quarter);
  });

  it('decides the status of a prepared lesson with the clock of the request: past its lock it counts as locked with no new preparation (CLAUDE.md, state from stored moments; review of the plan, finding 1)', async () => {
    const c = await scene();
    // Monday 26 October, 13:00: the lessons of the 12th, 19th and 26th are held; the next start is
    // on 2 November. The 19th has nothing entered and locks at 23:59 on the 26th.
    const prepared = '2026-10-26T13:00:00+05:00';
    // The school's 7 edit days (test branches start with ten years).
    await setEditDays(t.database.migrator, c.s.branch, 7);
    // Aziz marked on the 19th, Bobur not: in progress until the lock.
    await saveOn(c.s, c.l19.date, [{ lessonId: c.l19.id, studentId: c.aziz, value: 1 }]);
    await prepare(c.s.branch, prepared);
    const path = '/api/journal/discipline?from=2026-10-01&to=2026-10-26';
    type Counts = { prepared: PreparedStamp; teachers: { lockedIncomplete: number }[] };
    const locked = (body: Counts) =>
      body.teachers.reduce((sum, one) => sum + one.lockedIncomplete, 0);
    const before = (await read(c, path, prepared)) as unknown as Counts;
    expect(before.prepared.updating).toBe(false);
    // An hour past the lock of the 19th, before the next lesson starts.
    const lock = (
      await sql<{
        lock: Date;
      }>`select journal_lock_moment(branch_id, lesson_date) as lock from lessons where id = ${c.l19.id}`.execute(
        t.database.migrator,
      )
    ).rows[0]?.lock;
    if (lock === undefined) throw new Error('The lock of the 19th.');
    const afterLock = new Date(new Date(lock).getTime() + 60 * 60_000);
    expect(afterLock.getTime()).toBeLessThan(new Date('2026-11-02T08:00:00+05:00').getTime());
    const later = (await read(c, path, afterLock.toISOString())) as unknown as Counts;
    expect(later.prepared.updating).toBe(false);
    expect(locked(later)).toBe(locked(before) + 1);
  });

  it('reads the early-warning figures of yesterday as behind: the date moved, nothing was entered', async () => {
    const c = await scene();
    await prepare(c.s.branch);
    const path = '/api/results/early-warning';
    expect((await read(c, path)).prepared.updating).toBe(false);
    expect((await read(c, path, '2026-10-28T07:00:00+05:00')).prepared.updating).toBe(true);
  });

  it('gives the same rating and early-warning list prepared as from source, whatever is entered (fast-check over marks and scores)', async () => {
    const c = await scene();
    const mark = fc.constantFrom(...ATTENDANCE_MARKS);
    const score = fc.integer({ min: 0, max: 10 });
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          aziz: mark,
          bobur: mark,
          azizScore: score,
          boburScore: score,
          laterAziz: mark,
        }),
        async (entered) => {
          await saveOn(c.s, c.l12.date, [
            { lessonId: c.l12.id, studentId: c.aziz, value: entered.aziz },
            { lessonId: c.l12.id, studentId: c.bobur, value: entered.bobur },
            { lessonId: c.l12.id, studentId: c.aziz, workId: c.work, value: entered.azizScore },
            { lessonId: c.l12.id, studentId: c.bobur, workId: c.work, value: entered.boburScore },
          ]);
          await saveOn(c.s, c.l19.date, [
            { lessonId: c.l19.id, studentId: c.aziz, value: entered.laterAziz },
          ]);
          const paths = [
            `/api/results/rating/subject?quarterId=${c.quarter}&journalId=${c.journal}`,
            '/api/results/early-warning',
            '/api/results/branch-summary',
            // Task 10.1b: the plan progress report on the `plan_progress` units.
            `/api/plans/reports/progress?quarterId=${c.quarter}`,
          ];
          const fromSource = [];
          for (const path of paths) {
            const body = await read(c, path);
            expect(body.prepared.updating, path).toBe(true);
            fromSource.push(withoutStamp(body));
          }
          await prepare(c.s.branch);
          for (const [index, path] of paths.entries()) {
            const body = await read(c, path);
            expect(body.prepared.updating, path).toBe(false);
            expect(withoutStamp(body), path).toEqual(fromSource[index]);
          }
        },
      ),
      { numRuns: 4 },
    );
  });

  it('writes a change row from every trigger of every watched table: the columns each kind reads exist, and an update of a row of the scene writes its row (review correction 3)', async () => {
    const c = await scene();
    await prepare(c.s.branch);
    // A rating exam and its entry, so the rating entry's kind runs too.
    await ratingEntryAndNote(t, load, {
      branch: c.s.branch,
      year: c.s.year,
      classId: c.s.classId,
      lessonId: c.l12.id,
      studentId: c.aziz,
      accountId: await load.classes.account(),
      at: '2026-10-20T12:00:00+05:00',
      examDate: '2026-10-20',
    });
    // The kit leaves its clock at the entry's moment.
    t.clock.set(START);
    // The entry's own write: a row of the exam's journal and quarter.
    const exam = await t.database.migrator
      .selectFrom('journal_rating_exams')
      .select(['journal_id', 'quarter_id'])
      .where('branch_id', '=', c.s.branch)
      .executeTakeFirstOrThrow();
    expect(
      (await changesOf(c.s.branch)).map((row) => [row.journal_id, row.quarter_id]),
    ).toContainEqual([exam.journal_id, exam.quarter_id]);
    const watched = await sql<{ name: string; fn: string }>`
      select c.relname as name, p.proname as fn
      from pg_trigger g join pg_class c on c.oid = g.tgrelid
      join pg_proc p on p.oid = g.tgfoid
      where g.tgname like '%\\_report\\_update'
      order by 1
    `.execute(t.database.migrator);
    expect(watched.rows.length).toBeGreaterThan(40);
    const needs: Record<string, string> = {
      report_changed_lesson: 'lesson_id',
      report_changed_lesson_self: 'lesson_date',
      report_changed_journal: 'journal_id',
      report_changed_plan: 'plan_id',
      report_changed_rating_entry: 'rating_exam_id',
      report_changed_branch: 'branch_id',
    };
    const exercised: string[] = [];
    for (const { name, fn } of watched.rows) {
      const column = needs[fn];
      expect(column, `${name}: ${fn}`).toBeDefined();
      const has = await sql<{ n: string }>`
        select count(*)::text as n from pg_attribute
        where attrelid = ${name}::regclass and attname in (${column ?? ''}, 'branch_id')
          and not attisdropped
      `.execute(t.database.migrator);
      expect(has.rows[0]?.n, `${name} has ${column ?? ''} and branch_id`).toBe(
        column === 'branch_id' ? '1' : '2',
      );
      const any = await sql<{ n: string }>`
        select count(*)::text as n from ${sql.table(name)} where branch_id = ${c.s.branch}
      `.execute(t.database.migrator);
      if (any.rows[0]?.n === '0') continue;
      await t.database.migrator
        .deleteFrom('report_changes')
        .where('branch_id', '=', c.s.branch)
        .execute();
      try {
        // With the moment of the transaction set, as `Transactions.run` sets it for the guards.
        await t.database.migrator.transaction().execute(async (transaction) => {
          await sql`select set_config('app.now', ${MOMENT}, true)`.execute(transaction);
          await sql`
            update ${sql.table(name)} set branch_id = branch_id
            where ctid = (select ctid from ${sql.table(name)} where branch_id = ${c.s.branch} limit 1)
          `.execute(transaction);
        });
      } catch (error) {
        // A guard of the table refused the write before the trigger: never one of 0140's.
        expect(String(error), name).not.toMatch(/report_/);
        continue;
      }
      const rows = await changesOf(c.s.branch);
      expect(rows.length, `${name}: a change row`).toBeGreaterThan(0);
      exercised.push(name);
    }
    // The tables of the journal's hot path are among those run.
    for (const name of [
      'journal_cells',
      'journal_works',
      'lessons',
      'journal_comments',
      'journal_rating_exams',
      'class_memberships',
      'journals',
    ]) {
      expect(exercised, name).toContain(name);
    }
  });

  it('stops between units when the process stops, keeping the change rows for the next run (the worker never waits on a long run)', async () => {
    const c = await scene();
    const totals = new PreparedTotals(t.app.get(Transactions));
    totals.beforeApplicationShutdown();
    t.clock.set(MOMENT);
    try {
      expect(await totals.prepareBranch(c.s.branch, 'Asia/Tashkent')).toBe(0);
    } finally {
      t.clock.set(START);
    }
    expect((await rating(c)).prepared.updating).toBe(true);
    expect((await changesOf(c.s.branch)).length).toBeGreaterThan(0);
    expect(await prepare(c.s.branch)).toBeGreaterThan(0);
  });

  it('works within the time of one run and leaves the rest, with its change rows, to the next (the job shares the database with the requests)', async () => {
    const c = await scene();
    const totals = new PreparedTotals(t.app.get(Transactions));
    t.clock.set(MOMENT);
    try {
      await totals.run(0);
    } finally {
      t.clock.set(START);
    }
    expect((await rating(c)).prepared.updating).toBe(true);
    t.clock.set(MOMENT);
    try {
      await totals.run(10 * 60_000);
    } finally {
      t.clock.set(START);
    }
    expect((await rating(c)).prepared.updating).toBe(false);
  });

  // Task 10.2b: the hidden Monitoring branch is in no school report, so its totals are never
  // prepared; a run still prepares every other branch.
  it('prepares nothing of the Monitoring branch, and still the other branches', async () => {
    const hidden = await scene();
    const real = await scene();
    await t.database.migrator
      .updateTable('branches')
      .set({ purpose: 'monitoring' })
      .where('id', '=', hidden.s.branch)
      .execute();
    try {
      const totals = new PreparedTotals(t.app.get(Transactions));
      t.clock.set(MOMENT);
      try {
        await totals.run(10 * 60_000);
      } finally {
        t.clock.set(START);
      }
      const preparedOf = (branch: string) =>
        t.database.migrator
          .selectFrom('report_prepared')
          .select('kind')
          .where('branch_id', '=', branch)
          .execute();
      expect(await preparedOf(hidden.s.branch)).toEqual([]);
      expect((await preparedOf(real.s.branch)).length).toBeGreaterThan(0);
      expect((await rating(real)).prepared.updating).toBe(false);
    } finally {
      await t.database.migrator
        .updateTable('branches')
        .set({ purpose: null })
        .where('id', '=', hidden.s.branch)
        .execute();
    }
  });
});
