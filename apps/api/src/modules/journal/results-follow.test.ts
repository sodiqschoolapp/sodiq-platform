import { journalGridSchema, type JournalGrid, type JournalStudent } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRANCH_SETTING, MOMENT_SETTING, Transactions } from '../../database/transactions.js';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit, moveStudentBranch, type MemberRow } from '../../testing/members-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from './cells.js';

/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12, 19 and 26 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';
/** Tuesday 29 December 2026: the eight Mondays of the second quarter are held. */
const MOMENT_Q2 = '2026-12-29T12:00:00+05:00';

const gridOf = (response: Response): JournalGrid => {
  expect(response.status, JSON.stringify(response.body).slice(0, 500)).toBe(200);
  return journalGridSchema.parse(response.body);
};

const rowOf = (grid: JournalGrid, id: string): JournalStudent => {
  const found = grid.students.find((one) => one.id === id);
  if (found === undefined) throw new Error('The student is not in the grid.');
  return found;
};

// All names are invented. Task 8.6, pull request #224: the results follow the student
// (docs/spec/07-journal.md, Transfers, Layout; docs/spec/edge-cases/calculation.md, the
// few-lessons, at leaving, week 6, left the subject, between branches and left and came
// back rows; docs/spec/edge-cases/00-definitions.md).
describe('results that follow the student (07, Transfers)', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let names = 0;

  const account = async () => {
    names += 1;
    return t.kit.completeSession('Nodira', `Saidova${'a'.repeat(names % 5)}`);
  };

  type Held = Parameters<DayTemplatesKit['kit']['giveRole']>[1];
  type Browser = { cookie: string; account: { id: string } };

  /** Runs `work` with the clock at `moment` and the roles held from 1 September. */
  async function as<T>(
    browser: Browser,
    roles: readonly Omit<Held, 'validFrom'>[],
    work: (get: (branch: string, path: string) => Promise<Response>) => Promise<T>,
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
      return await work((branch, path) => t.get(path, branch, browser.cookie));
    } finally {
      t.clock.set(START);
    }
  }

  const members = async () => new MembersKit(t.database.migrator, await load.classes.account());

  /** A student of the branch named as given, with the class rows given. */
  const student = async (
    branch: string,
    name: { first: string; last: string },
    rows: readonly Omit<MemberRow, 'branch' | 'studentId'>[],
  ): Promise<string> => {
    const kit = await members();
    const id = await kit.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await t.database.migrator
      .updateTable('students')
      .set({ first_name: name.first, last_name: name.last })
      .where('id', '=', id)
      .execute();
    for (const row of rows) await kit.member({ branch, studentId: id, ...row });
    return id;
  };

  const lessonsOf = async (classId: string, from: string, to: string) =>
    (
      await t.database.migrator
        .selectFrom('lessons')
        .select(['id', sql<string>`lesson_date::text`.as('date')])
        .where('class_id', '=', classId)
        .where('lesson_date', '>=', from)
        .where('lesson_date', '<=', to)
        .orderBy('starts_at')
        .execute()
    ).map((one) => ({ id: one.id, date: one.date }));

  const journalOf = async (classId: string) =>
    (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', classId)
        .executeTakeFirstOrThrow()
    ).id;

  const quarterOf = async (scene: PublishedScene, number: number) =>
    (
      await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', scene.year)
        .where('number', '=', number)
        .executeTakeFirstOrThrow()
    ).id;

  /** Saves cells through `saveCells` with the clock at 18:00 of `date`, inside the edit period. */
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

  const work = async (branch: string, lessonId: string, total: number) =>
    (
      await t.database.migrator
        .insertInto('journal_works')
        .values({ branch_id: branch, lesson_id: lessonId, kind: 'classwork', total })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /** Marks the student present (1) at each lesson, saved on the lesson's day. */
  const present = async (
    branch: string,
    studentId: string,
    lessons: readonly { id: string; date: string }[],
  ) => {
    for (const lesson of lessons) {
      await saveOn(branch, lesson.date, [{ lessonId: lesson.id, studentId, value: 1 }]);
    }
  };

  const principal = async (branch: string) => {
    const browser = await account();
    await t.kit.giveRole(browser.account.id, {
      role: 'principal',
      branchId: branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    return browser;
  };

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('week 6 (edge/calculation: "A student moved from one group to another in week 6")', () => {
    it('uses both journals in both, folds the student in the old one and counts the student once in the new bottom row', async () => {
      const scene = await publishedScene(t, load, { graded: true });
      const [a12, a19, a26] = await lessonsOf(scene.classId, '2026-10-01', '2026-10-31');
      const [b12, b19, b26] = await lessonsOf(scene.otherClass, '2026-10-01', '2026-10-31');
      if (!a12 || !a19 || !a26 || !b12 || !b19 || !b26) throw new Error('Three lessons each.');
      const moved = await student(scene.branch, { first: 'Aziz', last: 'Karimov' }, [
        { classId: scene.classId, from: '2026-09-01', ownUntil: '2026-10-19' },
        { classId: scene.otherClass, from: '2026-10-19' },
      ]);
      const stayer = await student(scene.branch, { first: 'Dilshod', last: 'Ergashev' }, [
        { classId: scene.classId, from: '2026-09-01' },
      ]);
      await student(scene.branch, { first: 'Shoira', last: 'Nazarova' }, [
        { classId: scene.otherClass, from: '2026-09-01' },
      ]);
      const cwA = await work(scene.branch, a12.id, 10);
      const cwB = await work(scene.branch, b19.id, 10);
      await saveOn(scene.branch, a12.date, [
        { lessonId: a12.id, studentId: moved, value: 1 },
        { lessonId: a12.id, studentId: moved, workId: cwA, value: 8 },
        { lessonId: a12.id, studentId: stayer, value: 1 },
        { lessonId: a12.id, studentId: stayer, workId: cwA, value: 10 },
      ]);
      await saveOn(scene.branch, b19.date, [
        { lessonId: b19.id, studentId: moved, value: 1 },
        { lessonId: b19.id, studentId: moved, workId: cwB, value: 4 },
      ]);
      await saveOn(scene.branch, b26.date, [{ lessonId: b26.id, studentId: moved, value: 0 }]);
      const journalA = await journalOf(scene.classId);
      const journalB = await journalOf(scene.otherClass);
      const browser = await principal(scene.branch);
      await as(browser, [], async (get) => {
        const gridA = gridOf(await get(scene.branch, `/api/journal/journals/${journalA}`));
        const gridB = gridOf(await get(scene.branch, `/api/journal/journals/${journalB}`));
        const inA = rowOf(gridA, moved);
        const inB = rowOf(gridB, moved);
        // Attendance 100, 100, 0 (66.67) and classwork 80 and 40 (60), each work once:
        // (20 × 66.67 + 40 × 60) ÷ 60 = 62.2, homework left out.
        expect(inB.quarter).toEqual({
          attendance: 67,
          classwork: 60,
          homework: null,
          ratingExam: null,
          result: {
            kind: 'number',
            shown: 62,
            grade: 3,
            provisional: true,
            leftOut: ['homework'],
            basedOn: null,
          },
        });
        // The old journal keeps the student folded with the same full result.
        expect(inA.folded).toBe(true);
        expect(inA.quarter).toEqual(inB.quarter);
        expect(inA.months?.['2026-10']).toEqual(inB.months?.['2026-10']);
        expect(inB.folded).toBe(false);
        // The marker names the other journal and its days.
        expect(inB.carriedIn).toEqual([
          {
            journalId: journalA,
            unitName: gridA.journal.unit.name,
            from: '2026-09-01',
            until: '2026-10-18',
          },
        ]);
        expect(inA.carriedIn).toEqual([
          {
            journalId: journalB,
            unitName: gridB.journal.unit.name,
            from: '2026-10-19',
            until: '2026-10-31',
          },
        ]);
        expect([inA.leftSubjectOn, inA.atLeaving, inB.leftSubjectOn, inB.atLeaving]).toEqual([
          null,
          null,
          null,
          null,
        ]);
        // Attendance stays where it was entered.
        expect(inA.cells.map((cell) => [cell.closed, cell.mark])).toEqual([
          [false, 1],
          [true, null],
          [true, null],
        ]);
        expect(inB.cells.map((cell) => [cell.closed, cell.mark])).toEqual([
          [true, null],
          [false, 1],
          [false, 0],
        ]);
        // The old bottom row is the stayer's alone; the new one counts the student once
        // (the classmate there has no result).
        const stayerResult = rowOf(gridA, stayer).quarter?.result;
        expect(stayerResult?.kind).toBe('number');
        expect(gridA.bottom?.quarter.result).toBe(
          stayerResult?.kind === 'number' ? stayerResult.shown : -1,
        );
        expect(gridA.bottom?.quarter.result).not.toBe(62);
        expect(gridB.bottom?.quarter.result).toBe(62);
        // A student whose rows cover the quarter has nothing carried in.
        expect(rowOf(gridA, stayer).carriedIn).toEqual([]);
      });
    });
  });

  describe('few lessons (edge/calculation: "A student joined late, returned, or started the subject mid-quarter")', () => {
    it('counts N per school day across the journals: joined late, a gap in N only, and nothing after leaving the subject', async () => {
      const scene = await publishedScene(t, load, { graded: true });
      const quarter = await quarterOf(scene, 2);
      const lessons = await lessonsOf(scene.classId, '2026-11-09', '2026-12-28');
      expect(lessons.map((one) => one.date)).toEqual([
        '2026-11-09',
        '2026-11-16',
        '2026-11-23',
        '2026-11-30',
        '2026-12-07',
        '2026-12-14',
        '2026-12-21',
        '2026-12-28',
      ]);
      const [first, , , , , , last2, last] = lessons;
      if (!first || !last2 || !last) throw new Error('Eight lessons.');
      // A class of grade 7 with no maths journal: a move there leaves the subject.
      const noMaths = await load.classes.schoolClass(scene.branch, scene.year, { grade: 7 });
      const late = await student(scene.branch, { first: 'Javlon', last: 'Tursunov' }, [
        { classId: scene.classId, from: '2026-12-21' },
      ]);
      const gap = await student(scene.branch, { first: 'Gulnora', last: 'Xolmatova' }, [
        { classId: scene.classId, from: '2026-09-01', ownUntil: '2026-11-10' },
        { classId: scene.classId, from: '2026-12-28', cause: 'return' },
      ]);
      const left = await student(scene.branch, { first: 'Laziz', last: 'Umarov' }, [
        { classId: scene.classId, from: '2026-09-01', ownUntil: '2026-11-10' },
        { classId: noMaths, from: '2026-11-10' },
      ]);
      await present(scene.branch, late, [last2, last]);
      await present(scene.branch, gap, [first, last]);
      await present(scene.branch, left, [first]);
      const journal = await journalOf(scene.classId);
      const browser = await principal(scene.branch);
      await as(
        browser,
        [],
        async (get) => {
          const grid = gridOf(
            await get(scene.branch, `/api/journal/journals/${journal}?quarterId=${quarter}`),
          );
          // Joined late: the six lessons before the first membership count in N (the journal
          // of the next membership): 2 × 3 < 8.
          const lateRow = rowOf(grid, late);
          expect(lateRow.quarter?.result).toMatchObject({
            kind: 'number',
            shown: 100,
            basedOn: { expected: 2, held: 8 },
          });
          // A gap counts in N only, and its cells are closed (edge/calculation, left and came back).
          const gapRow = rowOf(grid, gap);
          expect(gapRow.quarter?.result).toMatchObject({ basedOn: { expected: 2, held: 8 } });
          expect(gapRow.cells.map((cell) => cell.closed)).toEqual([
            false,
            true,
            true,
            true,
            true,
            true,
            true,
            false,
          ]);
          // After leaving the subject nothing counts: 1 of 1, no flag ("left the subject on").
          const leftRow = rowOf(grid, left);
          expect(leftRow.folded).toBe(true);
          expect(leftRow.quarter?.result).toMatchObject({ kind: 'number', basedOn: null });
          expect(leftRow.leftSubjectOn).toBe('2026-11-09');
          expect(leftRow.atLeaving).toBeNull();
          expect(leftRow.carriedIn).toEqual([]);
          expect([lateRow.leftSubjectOn, gapRow.leftSubjectOn]).toEqual([null, null]);
        },
        MOMENT_Q2,
      );
    });
  });

  describe('left and came back (edge/calculation: "A student left and came back in the same quarter")', () => {
    it('counts the lessons before leaving, shows the gap closed and no result at leaving', async () => {
      const scene = await publishedScene(t, load, { graded: true });
      const [a12, a19, a26] = await lessonsOf(scene.classId, '2026-10-01', '2026-10-31');
      if (!a12 || !a19 || !a26) throw new Error('Three lessons.');
      const kit = await members();
      const back = await student(scene.branch, { first: 'Rustam', last: 'Qodirov' }, []);
      const leavingId = await kit.leaving(t.database.migrator, scene.branch, back, '2026-10-16');
      await t.database.migrator
        .updateTable('student_statuses')
        .set({ valid_until: '2026-10-22' })
        .where('id', '=', leavingId)
        .execute();
      await t.database.migrator
        .insertInto('student_statuses')
        .values({
          student_id: back,
          branch_id: scene.branch,
          status: 'active',
          valid_from: '2026-10-22',
          cause: 'return',
        })
        .execute();
      await kit.member({
        branch: scene.branch,
        studentId: back,
        classId: scene.classId,
        from: '2026-09-01',
        until: '2026-10-16',
        endedBy: 'leaving',
        leavingId,
      });
      await kit.member({
        branch: scene.branch,
        studentId: back,
        classId: scene.classId,
        from: '2026-10-22',
        cause: 'return',
      });
      await present(scene.branch, back, [a12, a26]);
      const journal = await journalOf(scene.classId);
      await as(await principal(scene.branch), [], async (get) => {
        const row = rowOf(
          gridOf(await get(scene.branch, `/api/journal/journals/${journal}`)),
          back,
        );
        expect(row.folded).toBe(false);
        expect(row.cells.map((cell) => [cell.closed, cell.mark])).toEqual([
          [false, 1],
          [true, null],
          [false, 1],
        ]);
        expect(row.quarter?.attendance).toBe(100);
        expect([row.atLeaving, row.leftSubjectOn, row.carriedIn]).toEqual([null, null, []]);
      });
    });
  });

  describe('between branches (edge/calculation: "A student moved between branches mid-quarter")', () => {
    it('keeps the student folded in the old journal with a result at leaving and counts the new branch alone', async () => {
      const north = await publishedScene(t, load, { graded: true });
      const south = await publishedScene(t, load, { graded: true });
      const quarterNorth = await quarterOf(north, 2);
      const quarterSouth = await quarterOf(south, 2);
      const northLessons = await lessonsOf(north.classId, '2026-11-09', '2026-12-28');
      const southLessons = await lessonsOf(south.classId, '2026-11-09', '2026-12-28');
      expect([northLessons.length, southLessons.length]).toEqual([8, 8]);
      const mover = await student(north.branch, { first: 'Botir', last: 'Aliyev' }, []);
      const kit = await members();
      const northRow = await kit.member({
        branch: north.branch,
        studentId: mover,
        classId: north.classId,
        from: '2026-09-01',
      });
      await present(north.branch, mover, northLessons.slice(0, 6));
      // The accept on 21 December, as `student_branch_moves` (0053) takes it.
      const moment = new Date('2026-12-21T07:00:00+05:00');
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`
          select set_config(${BRANCH_SETTING}, ${`{${north.branch},${south.branch}}`}, true),
            set_config(${MOMENT_SETTING}, ${moment.toISOString()}, true)
        `.execute(transaction);
        const release = await transaction
          .insertInto('student_branch_moves')
          .values({
            branch_id: north.branch,
            student_id: mover,
            from_branch_id: north.branch,
            to_branch_id: south.branch,
            effective_on: '2026-12-21',
            released_at: moment,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .updateTable('student_branch_moves')
          .set({ accepted_at: moment })
          .where('id', '=', release.id)
          .execute();
        await transaction
          .updateTable('class_memberships')
          .set({
            valid_until: '2026-12-21',
            ended_by: 'branch_move',
            ended_by_branch_move_id: release.id,
          })
          .where('id', '=', northRow)
          .execute();
        await transaction
          .updateTable('students')
          .set({ branch_id: south.branch })
          .where('id', '=', mover)
          .execute();
        await transaction
          .insertInto('class_memberships')
          .values({
            branch_id: south.branch,
            student_id: mover,
            class_id: south.classId,
            valid_from: '2026-12-21',
            valid_until: '2027-06-01',
            own_until: '2027-06-01',
            cause: 'branch_move',
          })
          .execute();
      });
      await present(south.branch, mover, southLessons.slice(6));
      const northJournal = await journalOf(north.classId);
      const southJournal = await journalOf(south.classId);
      await as(
        await principal(north.branch),
        [],
        async (get) => {
          const grid = gridOf(
            await get(
              north.branch,
              `/api/journal/journals/${northJournal}?quarterId=${quarterNorth}`,
            ),
          );
          // Names and UID only from `journal_former_member_names`; the figures from the old
          // branch's own cells: six of six lessons, a result at leaving labelled with them.
          const row = rowOf(grid, mover);
          expect([row.lastName, row.firstName, row.folded]).toEqual(['Aliyev', 'Botir', true]);
          expect(row.atLeaving).toBe('2026-12-20');
          expect(row.leftSubjectOn).toBeNull();
          expect(row.quarter?.result).toMatchObject({
            kind: 'number',
            shown: 100,
            basedOn: { expected: 6, held: 6 },
          });
          expect(row.cells.map((cell) => cell.closed)).toEqual([
            false,
            false,
            false,
            false,
            false,
            false,
            true,
            true,
          ]);
          expect(row.exemptions).toEqual([]);
          // Outside the old bottom row: nobody else is there.
          expect(grid.bottom?.quarter.result).toBeNull();
        },
        MOMENT_Q2,
      );
      await as(
        await principal(south.branch),
        [],
        async (get) => {
          const grid = gridOf(
            await get(
              south.branch,
              `/api/journal/journals/${southJournal}?quarterId=${quarterSouth}`,
            ),
          );
          // Nothing merged: the south's own two lessons, and its eight held lessons in N.
          const row = rowOf(grid, mover);
          expect(row.folded).toBe(false);
          expect(row.carriedIn).toEqual([]);
          expect(row.atLeaving).toBeNull();
          expect(row.quarter?.result).toMatchObject({
            kind: 'number',
            shown: 100,
            basedOn: { expected: 2, held: 8 },
          });
        },
        MOMENT_Q2,
      );
    });

    it('gives names and the UID only through journal_former_member_names, and nothing for a branch outside the transaction (database)', async () => {
      const north = await publishedScene(t, load, { graded: true });
      const south = await publishedScene(t, load, { graded: true });
      const mover = await student(north.branch, { first: 'Kamola', last: 'Yoqubova' }, [
        { classId: north.classId, from: '2026-09-01' },
      ]);
      await t.database.migrator
        .updateTable('students')
        .set({ paternal_name: 'Anvarovna' })
        .where('id', '=', mover)
        .execute();
      // The record moves to the South, its rows left as they were (`moveStudentBranch`).
      await moveStudentBranch(t.database.migrator, mover, north.branch, south.branch);
      const journal = await journalOf(north.classId);
      const uid = (
        await t.database.migrator
          .selectFrom('students')
          .select('uid')
          .where('id', '=', mover)
          .executeTakeFirstOrThrow()
      ).uid;
      const transactions = t.app.get(Transactions);
      const read = (branches: string[], branch: string) =>
        transactions.run(branches, async (transaction) => {
          const found = await sql<Record<string, unknown>>`
            select * from journal_former_member_names(${journal}::uuid, ${branch}::uuid)
          `.execute(transaction);
          return found.rows;
        });
      expect(await read([north.branch], north.branch)).toEqual([
        {
          id: mover,
          first_name: 'Kamola',
          last_name: 'Yoqubova',
          paternal_name: 'Anvarovna',
          uid,
        },
      ]);
      // The branch named is not one of the transaction's: nothing.
      expect(await read([south.branch], north.branch)).toEqual([]);
      // The new branch is named: the record is of that branch, so it is no former member.
      expect(await read([south.branch], south.branch)).toEqual([]);
      // Through the row filter the North reads no row of the record itself.
      const direct = await transactions.run([north.branch], (transaction) =>
        transaction.selectFrom('students').select('id').where('id', '=', mover).execute(),
      );
      expect(direct).toEqual([]);
    });
  });

  describe('optional cells (edge/students-classes-groups: "cells of lessons already held open as optional")', () => {
    it('marks a live optional cell "optional" until its end, and neither a withdrawn nor an ended one', async () => {
      const scene = await publishedScene(t, load, { graded: true });
      const [a12, a19, a26] = await lessonsOf(scene.classId, '2026-10-01', '2026-10-31');
      if (!a12 || !a19 || !a26) throw new Error('Three lessons.');
      const kit = await members();
      const moved = await student(scene.branch, { first: 'Oybek', last: 'Hasanov' }, [
        { classId: scene.otherClass, from: '2026-09-01', ownUntil: '2026-10-12' },
        { classId: scene.classId, from: '2026-10-12' },
      ]);
      const move = await kit.move({
        branch: scene.branch,
        studentId: moved,
        from: '2026-10-12',
        fromClassId: scene.otherClass,
        toClassId: scene.classId,
      });
      const until = new Date('2026-11-03T00:00:00+05:00');
      const optional = (lessonId: string, values: { open_until: Date; withdrawn_at?: Date }) =>
        t.database.migrator
          .insertInto('journal_optional_cells')
          .values({
            branch_id: scene.branch,
            move_id: move,
            lesson_id: lessonId,
            student_id: moved,
            opened_at: new Date('2026-10-26T10:00:00+05:00'),
            ...values,
          })
          .execute();
      await optional(a12.id, { open_until: until });
      await optional(a19.id, {
        open_until: until,
        withdrawn_at: new Date('2026-10-26T11:00:00+05:00'),
      });
      await optional(a26.id, { open_until: new Date('2026-10-27T00:00:00+05:00') });
      const journal = await journalOf(scene.classId);
      await as(await principal(scene.branch), [], async (get) => {
        const row = rowOf(
          gridOf(await get(scene.branch, `/api/journal/journals/${journal}`)),
          moved,
        );
        expect(row.cells.map((cell) => cell.marker)).toEqual([
          { kind: 'optional', until: until.toISOString() },
          null,
          null,
        ]);
        expect(row.cells[0]?.works.map((one) => one.marker)).toEqual([]);
      });
    });
  });
});
