import { apiErrorSchema, studentDetailSchema, type StudentDetail } from '@sodiq/shared';
import { sql } from 'kysely';
import { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { Audit } from '../audit/audit.service.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { heldEntry } from '../../testing/held-entry.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { saveCells } from './cells.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const ok = (response: Response): StudentDetail => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return studentDetailSchema.parse(response.body);
};

/** The entries a refusal names, by id, with their version and whether they can be voided. */
function entriesOf(response: Response): { id: string; version: number; voidable: boolean }[] {
  const details = apiErrorSchema.parse(response.body).error.details ?? [];
  return details.flatMap((detail) =>
    detail.journalEntry === undefined || detail.recordId === undefined
      ? []
      : [
          {
            id: detail.recordId,
            version: detail.journalEntry.version,
            voidable: detail.journalEntry.voidable,
          },
        ],
  );
}

const changedOf = (response: Response): boolean =>
  (apiErrorSchema.parse(response.body).error.details ?? []).some((one) => one.changed === true);

// All names are invented. Task 8.6, pull request #224:
// docs/spec/edge-cases/students-classes-groups.md, the 11:00 row ("'Today' is
// allowed only if the student has no entries today in the old journals"), "a
// week late" ("Entries in the old journals on or after the date are listed;
// he either moves the date past them or voids them with a reason. They are
// never copied. In the new journal, cells of lessons already held open as
// optional ... can be filled for 7 days"), "a mistake" ("only while the new
// journals hold no entries for the student"), "1 October" ("Absences and
// zeros entered after it are voided: kept in history and removed from every
// figure. A 'present' mark or a real score after the date blocks the save
// until someone checks it"); docs/spec/edge-cases/system-behaviour.md: "a
// transfer against a cell save". The clock stands at 23:55 on Saturday 10
// October 2026 in Tashkent.
describe('transfers and leaving inside the journal', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let count = 0;

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  /** A branch of its own, its year, two classes of grade 7 and a teacher for the lessons. */
  async function scene(name: string) {
    count += 1;
    const cells = await CellsKit.create(t.database.migrator);
    const branch = await insertBranch(t.database.migrator, `${name} ${String(count)}`);
    const year = await classes.year(branch);
    const oxford = await classes.schoolClass(branch, year, { grade: 7 });
    const yale = await classes.schoolClass(branch, year, { grade: 7 });
    const teacher = await classes.person(branch, ['uz']);
    /** A held lesson of the class on the date, with its teacher. */
    const lesson = async (classId: string, date: string) => {
      const id = await cells.lesson(branch, year, classId, date);
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`select set_config('app.now', ${t.clock.now().toISOString()}, true)`.execute(
          transaction,
        );
        await heldEntry(transaction, branch);
        await transaction
          .updateTable('lessons')
          .set({ teacher_id: teacher.staffId })
          .where('id', '=', id)
          .execute();
      });
      return id;
    };
    const by = await classes.account();
    /** A mark of the student, written at the clock's moment. */
    const mark = (lessonId: string, studentId: string, value: number) =>
      cells.cell(branch, { lessonId, studentId, mark: value, by, at: t.clock.now().toISOString() });
    return { cells, branch, year, oxford, yale, lesson, mark, by };
  }

  /** A student of grade 7 in the class from 2 September. */
  async function pupil(branch: string, classId: string): Promise<StudentDetail> {
    count += 1;
    const response = await t.post('/api/people/students', branch, {
      uid: String(2608600 + count),
      confirmUidSet: true,
      firstName: 'Malika',
      lastName: `Tursunova${'t'.repeat(count % 9)}${String.fromCharCode(97 + (count % 26))}`,
      paternalName: null,
      sex: 'female',
      birthDate: '2013-05-12',
      grade: 7,
      startsOn: '2026-09-02',
      documentType: null,
      documentNumber: null,
      jshshir: null,
      phone: null,
      email: null,
      address: null,
      region: null,
      previousSchool: null,
      diagnosticScore: null,
      scholarship: { type: 'none', coverage: null, amount: null },
      consentSignedOn: null,
      contract: { number: `JT-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      classId,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  const fresh = async (branch: string, id: string): Promise<StudentDetail> =>
    studentDetailSchema.parse((await t.get(`/api/people/students/${id}`, branch)).body);

  const transfer = async (
    branch: string,
    studentId: string,
    toClassId: string,
    from: string,
    extra: Record<string, unknown> = {},
  ) =>
    t.post('/api/classes/transfers', branch, {
      studentId,
      version: (await fresh(branch, studentId)).version,
      toClassId,
      from,
      ...extra,
    });

  const cellOf = (id: string) =>
    t.database.migrator
      .selectFrom('journal_cells')
      .select(['student_id', 'mark', 'score', 'changed_how', 'version'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  const lastLine = (id: string) =>
    t.database.migrator
      .selectFrom('journal_cell_history')
      .select(['mark_before', 'mark_after', 'changed_how', 'reason'])
      .where('cell_id', '=', id)
      .orderBy('version', 'desc')
      .executeTakeFirstOrThrow();

  /** Every row of the tables the journal side writes, in every branch, and the log. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('journal_cells').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('journal_comments').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('journal_rating_entries').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('journal_voids').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('journal_optional_cells').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('class_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('group_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_moves').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_branch_moves').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_statuses').selectAll().orderBy('id').execute(),
      t.auditCount(),
    ]);

  describe('a move dated today (edge, the 11:00 row)', () => {
    it('refuses it while the old journals hold an entry of the student today, which it cannot void', async () => {
      const s = await scene('East today');
      const student = await pupil(s.branch, s.oxford);
      const today = await s.lesson(s.oxford, '2026-10-10');
      const cell = await s.mark(today, student.id, 1);
      const before = await rowsOf();
      const refused = await transfer(s.branch, student.id, s.yale, '2026-10-10');
      refusedWith(refused, 409, 'journal_entries');
      expect(entriesOf(refused)).toEqual([{ id: cell, version: 1, voidable: false }]);
      expect(await rowsOf()).toEqual(before);
      // A choice cannot void it either: the date is moved to tomorrow.
      refusedWith(
        await transfer(s.branch, student.id, s.yale, '2026-10-10', {
          journalEntries: { reason: 'Moved today', seen: [{ id: cell, version: 1 }] },
        }),
        409,
        'journal_entries',
      );
      ok(await transfer(s.branch, student.id, s.yale, '2026-10-11'));
      expect((await cellOf(cell)).mark).toBe(1);
    });

    it('allows it with no entry today, and with an entry of yesterday only', async () => {
      const s = await scene('East no entry');
      const student = await pupil(s.branch, s.oxford);
      const yesterday = await s.lesson(s.oxford, '2026-10-09');
      const cell = await s.mark(yesterday, student.id, 1);
      await s.lesson(s.oxford, '2026-10-10');
      ok(await transfer(s.branch, student.id, s.yale, '2026-10-10'));
      expect((await cellOf(cell)).mark).toBe(1);
    });

    it('allows it with an entry today in a group journal the move keeps', async () => {
      const s = await scene('East kept group');
      const group = await classes.group(s.branch, s.year, s.cells.subject, [s.oxford, s.yale]);
      const student = await pupil(s.branch, s.oxford);
      const lesson = await s.cells.groupLesson(s.branch, s.year, group, '2026-10-10');
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`select set_config('app.now', ${t.clock.now().toISOString()}, true)`.execute(
          transaction,
        );
        await heldEntry(transaction, s.branch);
        await transaction
          .updateTable('lessons')
          .set({ teacher_id: (await classes.person(s.branch, ['uz'])).staffId })
          .where('id', '=', lesson)
          .execute();
      });
      const cell = await s.mark(lesson, student.id, 1);
      ok(await transfer(s.branch, student.id, s.yale, '2026-10-10'));
      expect((await cellOf(cell)).mark).toBe(1);
    });
  });

  describe('a move recorded a week late (edge, the "a week late" row)', () => {
    it('lists the entries on or after its date, the date itself included, and saves with the date moved past them', async () => {
      const s = await scene('East late');
      const student = await pupil(s.branch, s.oxford);
      const before = await s.lesson(s.oxford, '2026-10-02');
      const onDate = await s.lesson(s.oxford, '2026-10-05');
      const after = await s.lesson(s.oxford, '2026-10-06');
      await s.mark(before, student.id, 1);
      const first = await s.mark(onDate, student.id, 1);
      const second = await s.mark(after, student.id, 0);
      const refused = await transfer(s.branch, student.id, s.yale, '2026-10-05');
      refusedWith(refused, 409, 'journal_entries');
      expect(entriesOf(refused)).toEqual([
        { id: first, version: 1, voidable: true },
        { id: second, version: 1, voidable: true },
      ]);
      ok(await transfer(s.branch, student.id, s.yale, '2026-10-07'));
      expect((await cellOf(first)).mark).toBe(1);
      expect((await cellOf(second)).mark).toBe(0);
    });

    it('voids them with the reason given, kept in the history and in journal_voids', async () => {
      const s = await scene('East void');
      const student = await pupil(s.branch, s.oxford);
      const lesson = await s.lesson(s.oxford, '2026-10-06');
      const cell = await s.mark(lesson, student.id, 2);
      const refused = await transfer(s.branch, student.id, s.yale, '2026-10-05');
      const seen = entriesOf(refused).map(({ id, version }) => ({ id, version }));
      ok(
        await transfer(s.branch, student.id, s.yale, '2026-10-05', {
          journalEntries: { reason: 'Recorded in the old class by mistake', seen },
        }),
      );
      expect(await cellOf(cell)).toMatchObject({ mark: null, changed_how: 'transfer', version: 2 });
      expect(await lastLine(cell)).toEqual({
        mark_before: 2,
        mark_after: null,
        changed_how: 'transfer',
        reason: 'Recorded in the old class by mistake',
      });
      const voids = await t.database.migrator
        .selectFrom('journal_voids')
        .select(['cell_id', 'mark', 'reason', 'version', 'given_back_at'])
        .where('student_id', '=', student.id)
        .execute();
      expect(voids).toEqual([
        {
          cell_id: cell,
          mark: 2,
          reason: 'Recorded in the old class by mistake',
          version: 2,
          given_back_at: null,
        },
      ]);
      const [entry] = await t.entries('student.class_transferred', student.id);
      expect(
        (entry?.new_value as { journal: { journalVoids: { entryId: string }[] } }).journal
          .journalVoids,
      ).toEqual([{ kind: 'cell', entryId: cell, reason: 'Recorded in the old class by mistake' }]);
    });

    it('answers the list again with "changed" when an entry was saved since it was read', async () => {
      const s = await scene('East stale');
      const student = await pupil(s.branch, s.oxford);
      const lesson = await s.lesson(s.oxford, '2026-10-06');
      const other = await s.lesson(s.oxford, '2026-10-07');
      const cell = await s.mark(lesson, student.id, 1);
      const seen = entriesOf(await transfer(s.branch, student.id, s.yale, '2026-10-05')).map(
        ({ id, version }) => ({ id, version }),
      );
      const late = await s.mark(other, student.id, 1);
      const before = await rowsOf();
      const refused = await transfer(s.branch, student.id, s.yale, '2026-10-05', {
        journalEntries: { reason: 'Old class', seen },
      });
      refusedWith(refused, 409, 'journal_entries');
      expect(changedOf(refused)).toBe(true);
      expect(entriesOf(refused).map((one) => one.id)).toEqual([cell, late]);
      expect(await rowsOf()).toEqual(before);
    });

    it('answers 404 for a seen entry of another branch or an unknown one, and changes nothing', async () => {
      const s = await scene('East seen');
      const elsewhere = await scene('West seen');
      const student = await pupil(s.branch, s.oxford);
      const lesson = await s.lesson(s.oxford, '2026-10-06');
      const cell = await s.mark(lesson, student.id, 1);
      const foreignStudent = await pupil(elsewhere.branch, elsewhere.oxford);
      const foreign = await elsewhere.mark(
        await elsewhere.lesson(elsewhere.oxford, '2026-10-06'),
        foreignStudent.id,
        1,
      );
      for (const id of [foreign, UNKNOWN]) {
        const before = await rowsOf();
        refusedWith(
          await transfer(s.branch, student.id, s.yale, '2026-10-05', {
            journalEntries: {
              reason: 'Old class',
              seen: [
                { id: cell, version: 1 },
                { id, version: 1 },
              ],
            },
          }),
          404,
          'not_found',
        );
        expect(await rowsOf()).toEqual(before);
      }
    });

    it('opens the held lessons of the new class as optional cells until 00:00 after the seventh day', async () => {
      const s = await scene('East optional');
      const student = await pupil(s.branch, s.oxford);
      const held = await s.lesson(s.yale, '2026-10-06');
      const today = await s.lesson(s.yale, '2026-10-10');
      ok(await transfer(s.branch, student.id, s.yale, '2026-10-05'));
      const rows = await t.database.migrator
        .selectFrom('journal_optional_cells')
        .select(['lesson_id', 'open_until', 'move_id', 'withdrawn_at'])
        .where('student_id', '=', student.id)
        .orderBy('lesson_id')
        .execute();
      expect(rows.map((row) => [row.lesson_id, row.open_until.toISOString()])).toEqual(
        [held, today].sort().map((id) => [id, new Date('2026-10-18T00:00:00+05:00').toISOString()]),
      );
    });
  });

  describe('a move taken back (edge, the "a mistake" row)', () => {
    it('refuses the undo while the new journal holds an entry of the student, and gives the voided values back after', async () => {
      const s = await scene('East undo');
      const student = await pupil(s.branch, s.oxford);
      const old = await s.lesson(s.oxford, '2026-10-06');
      const oldCell = await s.mark(old, student.id, 1);
      const fresher = await s.lesson(s.yale, '2026-10-08');
      const refused = await transfer(s.branch, student.id, s.yale, '2026-10-05');
      ok(
        await transfer(s.branch, student.id, s.yale, '2026-10-05', {
          journalEntries: {
            reason: 'Old class',
            seen: entriesOf(refused).map(({ id, version }) => ({ id, version })),
          },
        }),
      );
      const moveId = (
        await t.database.migrator
          .selectFrom('student_moves')
          .select('id')
          .where('student_id', '=', student.id)
          .executeTakeFirstOrThrow()
      ).id;
      const newCell = await s.mark(fresher, student.id, 1);
      const undo = async () =>
        t.post(`/api/classes/transfers/${moveId}/undo`, s.branch, {
          version: (await fresh(s.branch, student.id)).version,
          reason: 'Moved by mistake',
        });
      const before = await rowsOf();
      const blocked = await undo();
      refusedWith(blocked, 409, 'move_has_entries');
      expect(entriesOf(blocked).map((one) => one.id)).toEqual([newCell]);
      expect(await rowsOf()).toEqual(before);
      // The entry of the new journal cleared, the undo goes through and the
      // old journal's mark comes back.
      await s.cells.clear(newCell, s.by, t.clock.now().toISOString());
      ok(await undo());
      expect(await cellOf(oldCell)).toMatchObject({ mark: 1, changed_how: 'transfer', version: 3 });
      const voids = await t.database.migrator
        .selectFrom('journal_voids')
        .select('given_back_at')
        .where('cell_id', '=', oldCell)
        .execute();
      expect(voids.map((one) => one.given_back_at === null)).toEqual([false]);
      const optional = await t.database.migrator
        .selectFrom('journal_optional_cells')
        .select('withdrawn_at')
        .where('move_id', '=', moveId)
        .execute();
      expect(optional.length).toBeGreaterThan(0);
      expect(optional.every((one) => one.withdrawn_at !== null)).toBe(true);
    });

    it('keeps a voided value voided when the cell was written since, and marks it given back', async () => {
      const s = await scene('East keep voided');
      const student = await pupil(s.branch, s.oxford);
      const old = await s.lesson(s.oxford, '2026-10-06');
      const oldCell = await s.mark(old, student.id, 1);
      const refused = await transfer(s.branch, student.id, s.yale, '2026-10-05');
      ok(
        await transfer(s.branch, student.id, s.yale, '2026-10-05', {
          journalEntries: {
            reason: 'Old class',
            seen: entriesOf(refused).map(({ id, version }) => ({ id, version })),
          },
        }),
      );
      const moveId = (
        await t.database.migrator
          .selectFrom('student_moves')
          .select('id')
          .where('student_id', '=', student.id)
          .executeTakeFirstOrThrow()
      ).id;
      // The voided cell cleared again by someone: its version moves on.
      await s.cells.clear(oldCell, s.by, t.clock.now().toISOString());
      ok(
        await t.post(`/api/classes/transfers/${moveId}/undo`, s.branch, {
          version: (await fresh(s.branch, student.id)).version,
          reason: 'Moved by mistake',
        }),
      );
      expect((await cellOf(oldCell)).mark).toBeNull();
      const [entry] = await t.entries('student.class_transfer_undone', student.id);
      expect(
        (entry?.new_value as { journal: { journalGivenBack: unknown[] } }).journal.journalGivenBack,
      ).toEqual([{ kind: 'cell', entryId: oldCell, written: false }]);
    });
  });

  describe('a leaving (edge, the "1 October" row)', () => {
    const leave = async (branch: string, id: string, lastDay: string, extra: object = {}) =>
      t.post(`/api/people/students/${id}/leaving`, branch, {
        lastDay,
        reason: 'The family moved',
        version: (await fresh(branch, id)).version,
        ...extra,
      });

    it('voids absences and zeros after the last day by itself, and leaves the last day alone', async () => {
      const s = await scene('East leaving');
      const student = await pupil(s.branch, s.oxford);
      const onLastDay = await s.mark(await s.lesson(s.oxford, '2026-10-01'), student.id, 0);
      const absent = await s.mark(await s.lesson(s.oxford, '2026-10-02'), student.id, 0);
      ok(await leave(s.branch, student.id, '2026-10-01'));
      expect((await cellOf(onLastDay)).mark).toBe(0);
      expect(await cellOf(absent)).toMatchObject({ mark: null, changed_how: 'leaving' });
      expect(await lastLine(absent)).toEqual({
        mark_before: 0,
        mark_after: null,
        changed_how: 'leaving',
        reason: null,
      });
    });

    it('blocks the save on a present, late or skipped mark after the last day until it is voided with a reason', async () => {
      const s = await scene('East leaving blocks');
      const student = await pupil(s.branch, s.oxford);
      const absent = await s.mark(await s.lesson(s.oxford, '2026-10-02'), student.id, 0);
      const marks: string[] = [];
      for (const [date, value] of [
        ['2026-10-05', 1],
        ['2026-10-06', 2],
        ['2026-10-07', 3],
      ] as const) {
        marks.push(await s.mark(await s.lesson(s.oxford, date), student.id, value));
      }
      const before = await rowsOf();
      const refused = await leave(s.branch, student.id, '2026-10-01');
      refusedWith(refused, 409, 'journal_entries');
      expect(entriesOf(refused)).toEqual(marks.map((id) => ({ id, version: 1, voidable: true })));
      expect(await rowsOf()).toEqual(before);
      ok(
        await leave(s.branch, student.id, '2026-10-01', {
          journalEntries: {
            reason: 'Checked with the Tutor: not at school',
            seen: marks.map((id) => ({ id, version: 1 })),
          },
        }),
      );
      for (const id of [absent, ...marks]) {
        expect((await cellOf(id)).mark).toBeNull();
      }
      const voids = await t.database.migrator
        .selectFrom('journal_voids')
        .select(['cell_id', 'reason'])
        .where('student_id', '=', student.id)
        .orderBy('cell_id')
        .execute();
      expect(voids).toEqual(
        [
          { cell_id: absent, reason: null },
          ...marks.map((id) => ({ cell_id: id, reason: 'Checked with the Tutor: not at school' })),
        ].sort((a, b) => a.cell_id.localeCompare(b.cell_id)),
      );
    });

    it('gives the voided values back on the undo of the leaving', async () => {
      const s = await scene('East leaving undo');
      const student = await pupil(s.branch, s.oxford);
      const absent = await s.mark(await s.lesson(s.oxford, '2026-10-02'), student.id, 0);
      ok(await leave(s.branch, student.id, '2026-10-01'));
      expect((await cellOf(absent)).mark).toBeNull();
      ok(
        await t.post(`/api/people/students/${student.id}/leaving/undo`, s.branch, {
          reason: 'Entered by mistake',
          version: (await fresh(s.branch, student.id)).version,
        }),
      );
      expect(await cellOf(absent)).toMatchObject({ mark: 0, changed_how: 'leaving' });
    });
  });

  describe('a group move, a return and a move to another branch', () => {
    it("voids the old group journal's entries of a group move recorded late", async () => {
      const s = await scene('East group late');
      const first = await classes.group(s.branch, s.year, s.cells.subject, [s.oxford]);
      const second = await classes.group(s.branch, s.year, s.cells.subject, [s.oxford]);
      const student = await pupil(s.branch, s.oxford);
      const row = await t.database.migrator
        .selectFrom('group_memberships')
        .select(['id', 'group_id'])
        .where('student_id', '=', student.id)
        .executeTakeFirstOrThrow();
      const from = row.group_id === first ? first : second;
      const to = from === first ? second : first;
      const lesson = await s.cells.groupLesson(s.branch, s.year, from, '2026-10-06');
      const cell = await s.mark(lesson, student.id, 1);
      const move = (extra: object = {}) =>
        t.post('/api/groups/transfers', s.branch, {
          studentId: student.id,
          memberId: row.id,
          toGroupId: to,
          from: '2026-10-05',
          ...extra,
        });
      const refused = await move();
      refusedWith(refused, 409, 'journal_entries');
      expect(entriesOf(refused)).toEqual([{ id: cell, version: 1, voidable: true }]);
      ok(await move({ journalEntries: { reason: 'Old group', seen: [{ id: cell, version: 1 }] } }));
      expect(await cellOf(cell)).toMatchObject({ mark: null, changed_how: 'transfer' });
    });

    it('opens the held lessons of the class of a return dated in the past as optional cells', async () => {
      const s = await scene('East return');
      const student = await pupil(s.branch, s.oxford);
      ok(
        await t.post(`/api/people/students/${student.id}/leaving`, s.branch, {
          lastDay: '2026-09-30',
          reason: 'The family moved',
          version: (await fresh(s.branch, student.id)).version,
        }),
      );
      const held = await s.lesson(s.yale, '2026-10-07');
      ok(
        await t.post(`/api/people/students/${student.id}/return`, s.branch, {
          from: '2026-10-05',
          grade: 7,
          classId: s.yale,
          contract: { number: `JR-2026/${String(count)}`, signedOn: '2026-10-05' },
          reason: null,
          version: (await fresh(s.branch, student.id)).version,
        }),
      );
      const rows = await t.database.migrator
        .selectFrom('journal_optional_cells')
        .select(['lesson_id', 'return_status_id'])
        .where('student_id', '=', student.id)
        .execute();
      expect(rows.map((row) => row.lesson_id)).toEqual([held]);
      expect(rows[0]?.return_status_id).not.toBeNull();
    });

    it("lists and voids the sending branch's entries on a late accept, also on the date itself", async () => {
      const s = await scene('East sending');
      const west = await insertBranch(t.database.migrator, `West receiving ${String(count)}`);
      const westYear = await classes.year(west);
      const westClass = await classes.schoolClass(west, westYear, { grade: 7 });
      const student = await pupil(s.branch, s.oxford);
      const onDate = await s.mark(await s.lesson(s.oxford, '2026-10-05'), student.id, 1);
      const release = await t.post(`/api/people/students/${student.id}/branch-move`, s.branch, {
        toBranchId: west,
        from: '2026-10-05',
        version: (await fresh(s.branch, student.id)).version,
      });
      const moveId = ok(release).branchMove?.id ?? '';
      // The receiving branch's Academic Vice Principal accepts (decision 15, Look first).
      const receiving = await t.kit.completeSession(
        'Nodira',
        `Saidova${String.fromCharCode(97 + (count % 26))}`,
      );
      await t.kit.giveRole(receiving.account.id, {
        role: 'academic_vice_principal',
        branchId: west,
      });
      const accept = (extra: object = {}) =>
        t.post(
          `/api/people/branch-moves/${moveId}/accept`,
          west,
          { classId: westClass, groups: [], ...extra },
          receiving.cookie,
        );
      const before = await rowsOf();
      const refused = await accept();
      refusedWith(refused, 409, 'journal_entries');
      expect(entriesOf(refused)).toEqual([{ id: onDate, version: 1, voidable: true }]);
      expect(await rowsOf()).toEqual(before);
      ok(
        await accept({
          journalEntries: { reason: 'Moved to West', seen: [{ id: onDate, version: 1 }] },
        }),
      );
      expect(await cellOf(onDate)).toMatchObject({ mark: null, changed_how: 'transfer' });
      const voids = await t.database.migrator
        .selectFrom('journal_voids')
        .select(['branch_id', 'branch_move_id'])
        .where('cell_id', '=', onDate)
        .execute();
      expect(voids).toEqual([{ branch_id: s.branch, branch_move_id: moveId }]);
    });
  });

  // .claude/rules/api.md: one 404 test per body id, for another branch's and an unknown one, with
  // the rows of both branches and the audit log unchanged (permission review of the code, must-fix 1).
  describe('the entries named in journalEntries.seen', () => {
    /** A student with an entry after the date, and an entry of another branch's student. */
    async function both(name: string, groups = false) {
      const s = await scene(`East ${name}`);
      const elsewhere = await scene(`West ${name}`);
      // Groups of the class before the student, who is placed into one of them.
      const made = groups
        ? [
            await classes.group(s.branch, s.year, s.cells.subject, [s.oxford]),
            await classes.group(s.branch, s.year, s.cells.subject, [s.oxford]),
          ]
        : [];
      const student = await pupil(s.branch, s.oxford);
      const own = await s.mark(await s.lesson(s.oxford, '2026-10-06'), student.id, 1);
      const foreignStudent = await pupil(elsewhere.branch, elsewhere.oxford);
      const foreign = await elsewhere.mark(
        await elsewhere.lesson(elsewhere.oxford, '2026-10-06'),
        foreignStudent.id,
        1,
      );
      return { s, elsewhere, student, own, foreign, first: made[0] ?? '', second: made[1] ?? '' };
    }

    const choice = (own: string, other: string) => ({
      journalEntries: {
        reason: 'Old class',
        seen: [
          { id: own, version: 1 },
          { id: other, version: 1 },
        ],
      },
    });

    /** Each id refused 404, every row of both branches and the log unchanged. */
    async function refusesEach(
      ids: readonly string[],
      send: (id: string) => Promise<Response>,
    ): Promise<void> {
      for (const id of ids) {
        const before = await rowsOf();
        refusedWith(await send(id), 404, 'not_found');
        expect(await rowsOf()).toEqual(before);
      }
    }

    it('on the change of a scheduled class move', async () => {
      const { s, student, own, foreign } = await both('change');
      ok(await transfer(s.branch, student.id, s.yale, '2026-10-12'));
      const moveId = (await fresh(s.branch, student.id)).scheduledMoves[0]?.id ?? '';
      await refusesEach([foreign, UNKNOWN], async (id) =>
        t.post(`/api/classes/transfers/${moveId}/change`, s.branch, {
          version: (await fresh(s.branch, student.id)).version,
          toClassId: s.yale,
          from: '2026-10-05',
          ...choice(own, id),
        }),
      );
    });

    it('on a group move and the change of a scheduled one', async () => {
      const { s, student, own, foreign, first, second } = await both('group', true);
      const row = await t.database.migrator
        .selectFrom('group_memberships')
        .select(['id', 'group_id'])
        .where('student_id', '=', student.id)
        .executeTakeFirstOrThrow();
      const to = row.group_id === first ? second : first;
      await refusesEach([foreign, UNKNOWN], (id) =>
        t.post('/api/groups/transfers', s.branch, {
          studentId: student.id,
          memberId: row.id,
          toGroupId: to,
          from: '2026-10-05',
          ...choice(own, id),
        }),
      );
      ok(
        await t.post('/api/groups/transfers', s.branch, {
          studentId: student.id,
          memberId: row.id,
          toGroupId: to,
          from: '2026-10-12',
        }),
      );
      const moveId = (await fresh(s.branch, student.id)).scheduledMoves[0]?.id ?? '';
      await refusesEach([foreign, UNKNOWN], (id) =>
        t.post(`/api/groups/transfers/${moveId}/change`, s.branch, {
          toGroupId: to,
          from: '2026-10-05',
          ...choice(own, id),
        }),
      );
    });

    it('on a leaving and a return', async () => {
      const { s, student, own, foreign } = await both('leaving');
      await refusesEach([foreign, UNKNOWN], async (id) =>
        t.post(`/api/people/students/${student.id}/leaving`, s.branch, {
          lastDay: '2026-10-05',
          reason: 'The family moved',
          version: (await fresh(s.branch, student.id)).version,
          ...choice(own, id),
        }),
      );
      ok(
        await t.post(`/api/people/students/${student.id}/leaving`, s.branch, {
          lastDay: '2026-09-30',
          reason: 'The family moved',
          version: (await fresh(s.branch, student.id)).version,
          journalEntries: { reason: 'Not at school', seen: [{ id: own, version: 1 }] },
        }),
      );
      await refusesEach([foreign, UNKNOWN], async (id) =>
        t.post(`/api/people/students/${student.id}/return`, s.branch, {
          from: '2026-10-05',
          grade: 7,
          classId: s.yale,
          contract: { number: `JS-2026/${String(count)}`, signedOn: '2026-10-05' },
          reason: null,
          version: (await fresh(s.branch, student.id)).version,
          ...choice(own, id),
        }),
      );
    });

    it("on a late accept, for a third branch's entry and an unknown one", async () => {
      const { s, student, own, foreign } = await both('accept');
      const west = await insertBranch(t.database.migrator, `West seen accept ${String(count)}`);
      const westYear = await classes.year(west);
      const westClass = await classes.schoolClass(west, westYear, { grade: 7 });
      const release = await t.post(`/api/people/students/${student.id}/branch-move`, s.branch, {
        toBranchId: west,
        from: '2026-10-05',
        version: (await fresh(s.branch, student.id)).version,
      });
      const moveId = ok(release).branchMove?.id ?? '';
      await refusesEach([foreign, UNKNOWN], (id) =>
        t.post(`/api/people/branch-moves/${moveId}/accept`, west, {
          classId: westClass,
          groups: [],
          ...choice(own, id),
        }),
      );
    });

    it('on a merge, for an unknown entry', async () => {
      const s = await scene('East seen merge');
      const kept = await pupil(s.branch, s.oxford);
      const later = await pupil(s.branch, s.yale);
      const own = await s.mark(await s.lesson(s.yale, '2026-10-06'), later.id, 1);
      const preview = await t.get(
        `/api/people/students/${kept.id}/merge?uid=${later.uid}`,
        s.branch,
      );
      const digest = (preview.body as { digest: string }).digest;
      await refusesEach([UNKNOWN], (id) =>
        t.post(`/api/people/students/${kept.id}/merge`, s.branch, {
          uid: later.uid,
          reason: 'Created twice by mistake',
          digest,
          ...choice(own, id),
        }),
      );
    });

    it('refuses a Head Teacher of another subject a group move with 403, telling no entry', async () => {
      const { s, student, first, second } = await both('scope', true);
      const lesson = await s.cells.groupLesson(s.branch, s.year, first, '2026-10-07');
      const row = await t.database.migrator
        .selectFrom('group_memberships')
        .select(['id', 'group_id'])
        .where('student_id', '=', student.id)
        .executeTakeFirstOrThrow();
      await s.mark(lesson, student.id, 1);
      const other = await classes.subject({ grades: [7] });
      const head = await t.kit.completeSession(
        'Botir',
        `Karimov${String.fromCharCode(97 + (count % 26))}`,
      );
      await t.kit.giveRole(head.account.id, {
        role: 'head_teacher',
        branchId: s.branch,
        subjectIds: [other],
      });
      const before = await rowsOf();
      const refused = await t.post(
        '/api/groups/transfers',
        s.branch,
        {
          studentId: student.id,
          memberId: row.id,
          toGroupId: row.group_id === first ? second : first,
          from: '2026-10-05',
        },
        head.cookie,
      );
      expect(refused.status, JSON.stringify(refused.body)).toBe(403);
      expect(entriesOf(refused)).toEqual([]);
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('at the same moment (edge/system-behaviour: "a transfer against a cell save")', () => {
    async function waitedOn(pid: number): Promise<boolean> {
      for (let tries = 0; tries < 800; tries += 1) {
        const found = await sql<{ n: number }>`
          select count(*)::int as n from pg_stat_activity a
          where a.datname = current_database() and ${pid}::int = any (pg_blocking_pids(a.pid))
        `.execute(t.database.migrator);
        if ((found.rows[0]?.n ?? 0) >= 1) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    }

    /** Holds `hold` open for the branch, starts `run`, waits until it waits on the hold, commits. */
    async function heldThen<T>(
      branch: string,
      hold: (transaction: Transaction) => Promise<void>,
      run: () => Promise<T>,
      then?: () => Promise<void>,
    ): Promise<T> {
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
        .run([branch], async (transaction) => {
          await hold(transaction);
          const pid = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
            transaction,
          );
          ready(pid.rows[0]?.pid ?? 0);
          await released;
        })
        .catch((error: unknown) => error);
      const heldPid = await isReady;
      const answer = new Promise<T>((resolve, reject) => {
        run().then(resolve, reject);
      });
      expect(await waitedOn(heldPid), 'the route waited on the held transaction').toBe(true);
      await then?.();
      release();
      const heldError = await held;
      if (heldError !== undefined) {
        throw heldError instanceof Error ? heldError : new Error('The hold failed.');
      }
      return answer;
    }

    it('a save of today held first: the move dated today waits and is refused by it', async () => {
      const s = await scene('East moment save');
      const student = await pupil(s.branch, s.oxford);
      const today = await s.lesson(s.oxford, '2026-10-10');
      const version = (await fresh(s.branch, student.id)).version;
      const answer = await heldThen(
        s.branch,
        async (transaction) => {
          // The save, held before its commit: the writer the attendance route calls.
          await saveCells(transaction, t.app.get(Audit), { accountId: s.by }, [
            { lessonId: today, studentId: student.id, workId: null, value: 1, version: null },
          ]);
        },
        () =>
          t.post('/api/classes/transfers', s.branch, {
            studentId: student.id,
            version,
            toClassId: s.yale,
            from: '2026-10-10',
          }),
      );
      refusedWith(answer, 409, 'journal_entries');
      expect(entriesOf(answer).map((one) => one.voidable)).toEqual([false]);
    });

    it('the move first: a save of the old class waiting behind it is refused as a closed cell', async () => {
      const s = await scene('East moment move');
      const student = await pupil(s.branch, s.oxford);
      const today = await s.lesson(s.oxford, '2026-10-10');
      // An empty cell, as a cleared mark leaves it: the save updates it.
      const cell = await s.mark(today, student.id, 1);
      await s.cells.clear(cell, s.by, t.clock.now().toISOString());
      const version = (await fresh(s.branch, student.id)).version;
      let saved: Promise<unknown> = Promise.resolve();
      const moved = await heldThen(
        s.branch,
        async (transaction) => {
          // A third transaction holds the cell; the move queues on it first.
          await transaction
            .selectFrom('journal_cells')
            .select('id')
            .where('id', '=', cell)
            .forUpdate()
            .execute();
        },
        () =>
          t.post('/api/classes/transfers', s.branch, {
            studentId: student.id,
            version,
            toClassId: s.yale,
            from: '2026-10-10',
          }),
        async () => {
          // The save starts once the move waits, and queues behind it.
          saved = t.app
            .get(Transactions)
            .run([s.branch], (transaction) =>
              saveCells(transaction, t.app.get(Audit), { accountId: s.by }, [
                { lessonId: today, studentId: student.id, workId: null, value: 1, version: 2 },
              ]),
            )
            .catch((error: unknown) => error);
          await new Promise((resolve) => setTimeout(resolve, 200));
        },
      );
      ok(moved);
      const error = await saved;
      expect(error).toBeInstanceOf(Error);
      expect((error as { code?: string }).code).toBe('cell_closed');
      expect((await cellOf(cell)).mark).toBeNull();
    });

    /** The two orders of a change against a save of the student's cell in `lessonId`. */
    async function bothOrders(input: {
      branch: string;
      lessonId: string;
      studentId: string;
      by: string;
      cell: string;
      change: () => Promise<Response>;
    }) {
      const save = (version: number | null) =>
        t.app
          .get(Transactions)
          .run([input.branch], (transaction) =>
            saveCells(transaction, t.app.get(Audit), { accountId: input.by }, [
              {
                lessonId: input.lessonId,
                studentId: input.studentId,
                workId: null,
                value: 1,
                version,
              },
            ]),
          )
          .catch((error: unknown) => error);
      let saved: Promise<unknown> = Promise.resolve();
      const answer = await heldThen(
        input.branch,
        async (transaction) => {
          await transaction
            .selectFrom('journal_cells')
            .select('id')
            .where('id', '=', input.cell)
            .forUpdate()
            .execute();
        },
        input.change,
        async () => {
          saved = save(2);
          await new Promise((resolve) => setTimeout(resolve, 200));
        },
      );
      return { answer, saved: await saved };
    }

    it('a leaving and a save after its last day: the save held first refuses the leaving, the leaving first closes the save', async () => {
      const s = await scene('East moment leaving');
      const student = await pupil(s.branch, s.oxford);
      const after = await s.lesson(s.oxford, '2026-10-06');
      const version = (await fresh(s.branch, student.id)).version;
      const leaving = () =>
        t.post(`/api/people/students/${student.id}/leaving`, s.branch, {
          lastDay: '2026-10-05',
          reason: 'The family moved',
          version,
        });
      const refused = await heldThen(
        s.branch,
        async (transaction) => {
          await saveCells(transaction, t.app.get(Audit), { accountId: s.by }, [
            { lessonId: after, studentId: student.id, workId: null, value: 1, version: null },
          ]);
        },
        leaving,
      );
      refusedWith(refused, 409, 'journal_entries');
      // The other order: the mark cleared, the leaving queues first on the cell.
      const cell = (
        await t.database.migrator
          .selectFrom('journal_cells')
          .select('id')
          .where('lesson_id', '=', after)
          .where('student_id', '=', student.id)
          .executeTakeFirstOrThrow()
      ).id;
      await s.cells.clear(cell, s.by, t.clock.now().toISOString());
      const { answer, saved } = await bothOrders({
        branch: s.branch,
        lessonId: after,
        studentId: student.id,
        by: s.by,
        cell,
        change: leaving,
      });
      ok(answer);
      expect((saved as { code?: string }).code).toBe('cell_closed');
    });

    it('an undo and a save in the new journal: the save held first refuses the undo, the undo first closes the save', async () => {
      const s = await scene('East moment undo');
      const student = await pupil(s.branch, s.oxford);
      const fresher = await s.lesson(s.yale, '2026-10-06');
      ok(await transfer(s.branch, student.id, s.yale, '2026-10-05'));
      const moveId = (
        await t.database.migrator
          .selectFrom('student_moves')
          .select('id')
          .where('student_id', '=', student.id)
          .executeTakeFirstOrThrow()
      ).id;
      const version = (await fresh(s.branch, student.id)).version;
      const undo = () =>
        t.post(`/api/classes/transfers/${moveId}/undo`, s.branch, {
          version,
          reason: 'Moved by mistake',
        });
      const refused = await heldThen(
        s.branch,
        async (transaction) => {
          await saveCells(transaction, t.app.get(Audit), { accountId: s.by }, [
            { lessonId: fresher, studentId: student.id, workId: null, value: 1, version: null },
          ]);
        },
        undo,
      );
      refusedWith(refused, 409, 'move_has_entries');
      const cell = (
        await t.database.migrator
          .selectFrom('journal_cells')
          .select('id')
          .where('lesson_id', '=', fresher)
          .where('student_id', '=', student.id)
          .executeTakeFirstOrThrow()
      ).id;
      await s.cells.clear(cell, s.by, t.clock.now().toISOString());
      const { answer, saved } = await bothOrders({
        branch: s.branch,
        lessonId: fresher,
        studentId: student.id,
        by: s.by,
        cell,
        change: undo,
      });
      ok(answer);
      expect((saved as { code?: string }).code).toBe('cell_closed');
    });

    it('a late transfer and a save on or after its date: the save held first is listed, the transfer first closes the save', async () => {
      const s = await scene('East moment late');
      const student = await pupil(s.branch, s.oxford);
      const old = await s.lesson(s.oxford, '2026-10-06');
      const version = (await fresh(s.branch, student.id)).version;
      const late = () =>
        t.post('/api/classes/transfers', s.branch, {
          studentId: student.id,
          version,
          toClassId: s.yale,
          from: '2026-10-05',
        });
      const listed = await heldThen(
        s.branch,
        async (transaction) => {
          await saveCells(transaction, t.app.get(Audit), { accountId: s.by }, [
            { lessonId: old, studentId: student.id, workId: null, value: 1, version: null },
          ]);
        },
        late,
      );
      refusedWith(listed, 409, 'journal_entries');
      const cell = (
        await t.database.migrator
          .selectFrom('journal_cells')
          .select('id')
          .where('lesson_id', '=', old)
          .where('student_id', '=', student.id)
          .executeTakeFirstOrThrow()
      ).id;
      expect(entriesOf(listed)).toEqual([{ id: cell, version: 1, voidable: true }]);
      await s.cells.clear(cell, s.by, t.clock.now().toISOString());
      const { answer, saved } = await bothOrders({
        branch: s.branch,
        lessonId: old,
        studentId: student.id,
        by: s.by,
        cell,
        change: late,
      });
      ok(answer);
      expect((saved as { code?: string }).code).toBe('cell_closed');
    });

    it('a merge and a save of the merged record on a cut day: the save held first is listed, the merge first closes the save', async () => {
      const s = await scene('East moment merge');
      const kept = await pupil(s.branch, s.oxford);
      // A record created second, in Yale: the merge keeps the kept record's Oxford rows.
      const later = await pupil(s.branch, s.yale);
      const lesson = await s.lesson(s.yale, '2026-10-06');
      const preview = await t.get(
        `/api/people/students/${kept.id}/merge?uid=${later.uid}`,
        s.branch,
      );
      const digest = (preview.body as { digest: string }).digest;
      const merge = () =>
        t.post(`/api/people/students/${kept.id}/merge`, s.branch, {
          uid: later.uid,
          reason: 'Created twice by mistake',
          digest,
        });
      const listed = await heldThen(
        s.branch,
        async (transaction) => {
          await saveCells(transaction, t.app.get(Audit), { accountId: s.by }, [
            { lessonId: lesson, studentId: later.id, workId: null, value: 1, version: null },
          ]);
        },
        merge,
      );
      // The kept record is in Oxford on 6 October: the merged record's mark
      // in Yale that day is on a day the merge leaves behind.
      refusedWith(listed, 409, 'student_merge_journal_cut');
      const cell = (
        await t.database.migrator
          .selectFrom('journal_cells')
          .select('id')
          .where('lesson_id', '=', lesson)
          .where('student_id', '=', later.id)
          .executeTakeFirstOrThrow()
      ).id;
      await s.cells.clear(cell, s.by, t.clock.now().toISOString());
      const { answer, saved } = await bothOrders({
        branch: s.branch,
        lessonId: lesson,
        studentId: later.id,
        by: s.by,
        cell,
        change: merge,
      });
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      // The merged record is gone with its empty cell: the waiting save finds no member.
      expect(saved).toBeInstanceOf(Error);
    });
  });
});
