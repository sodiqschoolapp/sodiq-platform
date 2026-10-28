import {
  BRANCH_HEADER,
  ratingSubjectListSchema,
  type PreparedStamp,
  type RatingSubjectList,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../../database/transactions.js';
import { closeQuarter } from '../../../testing/closing-kit.js';
import {
  dayTemplatesKit,
  START,
  type DayTemplatesKit,
} from '../../../testing/day-templates-kit.js';
import { LoadKit } from '../../../testing/load-kit.js';
import { MembersKit } from '../../../testing/members-kit.js';
import { prepareBranch, withoutStamp } from '../../../testing/prepared-kit.js';
import { publishedScene, type PublishedScene } from '../../../testing/published-scene.js';
import { Audit } from '../../audit/audit.service.js';
import { saveCells } from '../../journal/cells.js';
import { prepareUnit } from './prepare.job.js';

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

  it('leaves a unit behind when a change began before its preparation and committed after it (review correction 2)', async () => {
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
    // The second finishes while the first is still open.
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

  it('reads a closed quarter as it was closed: closing makes it behind, and the prepared list says final', async () => {
    const c = await scene();
    await prepare(c.s.branch);
    const accountId = await load.classes.account();
    await closeQuarter(t.database, { branchId: c.s.branch, quarterId: c.quarter, accountId });
    const after = '2026-11-02T12:00:00+05:00';
    const fromSource = await rating(c, after);
    expect(fromSource.prepared.updating).toBe(true);
    expect(fromSource.quarter.closed).toBe(true);
    await prepare(c.s.branch, after);
    const prepared = await rating(c, after);
    expect(prepared.prepared.updating).toBe(false);
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
});
