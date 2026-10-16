import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../database/database.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import {
  MembersKit,
  memberValues,
  moveStudentBranch,
  type MemberRow,
} from '../../testing/members-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';

/** Wednesday 14 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-14T10:00:00+05:00';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

/** A transaction held open after `work` until `release` is called. */
function holding(
  run: (work: (transaction: Transaction) => Promise<void>) => Promise<void>,
  work: (transaction: Transaction) => Promise<void>,
): { ready: Promise<void>; release: () => void; done: Promise<void> } {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready: () => void = () => undefined;
  const isReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const done = run(async (transaction) => {
    await work(transaction);
    ready();
    await released;
  });
  // A held side that fails before it is ready must not leave the test waiting.
  return { ready: Promise.race([isReady, done]), release, done };
}

/** What a promise came to: `written`, or the constraint that refused it. */
const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => (error as { constraint?: string }).constraint,
  );

// The rules of class membership that the database itself keeps
// (db/migrations/0045), also when the application has a fault: one class per
// student per date across branches (developer rules, Membership; the
// done-when of task 3.1b); the maximum size on every date of a row, counting
// scheduled joins and leaves (edge, "A class is full"); the class inside the
// student's active time, checked at the commit from both sides; the archive,
// grade and size of a class against its members; the grade of a student
// against their class; the dates of a year against its members (decision 3,
// correction 4); rows that only shrink and keep their own end (decision 8,
// correction 1); the grants and the branch filter; the cascade of the delete
// (decision 12) and a student who moves branch (decision 16). All names are
// invented.
describe('class membership in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let members: MembersKit;
  let north: string;
  let south: string;
  let northYear: string;
  let southYear: string;
  let classCount = 0;

  const inBranch = <T>(branch: string | string[], work: (transaction: Transaction) => Promise<T>) =>
    transactions.run(Array.isArray(branch) ? branch : [branch], work);

  /** A row inserted as the application inserts it, in a transaction of its branch. */
  const place = (row: MemberRow) =>
    inBranch(row.branch, (transaction) => members.member(row, transaction));

  /** A class of the branch with a maximum size. */
  async function schoolClass(
    branch: string,
    year: string,
    input: { grade?: number; size?: number; language?: 'uz' | 'ru' } = {},
  ): Promise<string> {
    classCount += 1;
    const id = await classes.schoolClass(branch, year, {
      ...input,
      name: `Class ${String.fromCharCode(97 + (classCount % 26))}${'x'.repeat(Math.floor(classCount / 26))}`,
    });
    if (input.size !== undefined) {
      await database.migrator
        .updateTable('classes')
        .set({ max_size: input.size })
        .where('id', '=', id)
        .execute();
    }
    return id;
  }

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  const rowsOfStudent = (studentId: string) =>
    database.migrator
      .selectFrom('class_memberships')
      .select(['class_id', 'valid_from', 'valid_until'])
      .where('student_id', '=', studentId)
      .orderBy('valid_from')
      .execute();

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    classes = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    northYear = await classes.year(north);
    southYear = await classes.year(south);
    members = new MembersKit(database.migrator, await classes.account());
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('one class per student per date (developer rules, Membership)', () => {
    it('refuses a student in two classes on one date', async () => {
      const student = await members.student(north);
      const oxford = await schoolClass(north, northYear);
      const yale = await schoolClass(north, northYear);
      await place({ branch: north, classId: oxford, studentId: student, from: '2026-09-01' });
      const refused = await refusal(
        place({ branch: north, classId: yale, studentId: student, from: '2026-10-14' }),
      );
      expect(refused).toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'class_memberships_no_overlap',
      });
      // A planned row meets one in force too.
      const later = await members.student(north);
      await place({ branch: north, classId: oxford, studentId: later, from: '2026-11-02' });
      expect(
        await refusal(
          place({ branch: north, classId: yale, studentId: later, from: '2026-10-14' }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_no_overlap' });
      expect(await rowsOfStudent(later)).toHaveLength(1);
    });

    it('holds across branches: a row of another branch meets one of this branch', async () => {
      const student = await members.student(north);
      const oxford = await schoolClass(north, northYear);
      await place({ branch: north, classId: oxford, studentId: student, from: '2026-09-01' });
      // The student moves to the south with the row left uncut (3.3 cuts it):
      // the south does not see the row, and the constraint still refuses.
      // Task 3.3c: the branch changes only with an accepted move (0053).
      await moveStudentBranch(database.migrator, student, north, south);
      const southClass = await schoolClass(south, southYear);
      const refused = await refusal(
        place({ branch: south, classId: southClass, studentId: student, from: '2026-10-14' }),
      );
      expect(refused).toMatchObject({ constraint: 'class_memberships_no_overlap' });
    });

    it('lets half-open ends touch, and an empty row meets nothing', async () => {
      const student = await members.student(north);
      const oxford = await schoolClass(north, northYear);
      const yale = await schoolClass(north, northYear);
      const first = await place({
        branch: north,
        classId: oxford,
        studentId: student,
        from: '2026-09-01',
      });
      // A scheduled leaving cuts the row at its first inactive day, and a
      // planned row of another class written by a change of that leaving is
      // written empty: it overlaps nothing.
      const leaving = await inBranch(north, async (transaction) => {
        const id = await members.leaving(transaction, north, student, '2026-11-02');
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-11-02', ended_by: 'leaving', leaving_id: id })
          .where('id', '=', first)
          .execute();
        await members.member(
          {
            branch: north,
            classId: yale,
            studentId: student,
            from: '2026-12-01',
            until: '2026-12-01',
            endedBy: 'leaving',
            leavingId: id,
          },
          transaction,
        );
        return id;
      });
      expect(await rowsOfStudent(student)).toHaveLength(2);
      // The leaving taken back: the next class touches the first on 2 November.
      await inBranch(north, async (transaction) => {
        await transaction
          .updateTable('student_statuses')
          .set({ valid_until: '2026-11-02' })
          .where('id', '=', leaving)
          .execute();
        await transaction
          .insertInto('student_statuses')
          .values({
            student_id: student,
            branch_id: north,
            status: 'active',
            valid_from: '2026-11-02',
            cause: 'cancel',
          })
          .execute();
        await members.member(
          { branch: north, classId: yale, studentId: student, from: '2026-11-02', cause: 'cancel' },
          transaction,
        );
      });
      expect(await rowsOfStudent(student)).toHaveLength(3);
    });
  });

  describe('the maximum size (edge, "A class is full")', () => {
    it('counts a scheduled join on every date of the new row', async () => {
      const oxford = await schoolClass(north, northYear, { size: 2 });
      const one = await members.student(north);
      const planned = await members.student(north);
      const third = await members.student(north);
      await place({ branch: north, classId: oxford, studentId: one, from: '2026-09-01' });
      await place({ branch: north, classId: oxford, studentId: planned, from: '2026-11-02' });
      // Today two seats hold one member, but on 2 November the planned join fills the class.
      const refused = await refusal(
        place({ branch: north, classId: oxford, studentId: third, from: '2026-10-14' }),
      );
      expect(refused).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'class_memberships_full',
      });
    });

    it('counts a scheduled leaving: the seat is free from its date', async () => {
      const oxford = await schoolClass(north, northYear, { size: 1 });
      const leaver = await members.student(north);
      const next = await members.student(north);
      const leaving = await inBranch(north, async (transaction) => {
        const id = await members.leaving(transaction, north, leaver, '2026-11-02');
        await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: leaver,
            from: '2026-09-01',
            until: '2026-11-02',
            endedBy: 'leaving',
            leavingId: id,
          },
          transaction,
        );
        return id;
      });
      expect(leaving).toBeTypeOf('string');
      expect(
        await refusal(
          place({ branch: north, classId: oxford, studentId: next, from: '2026-10-14' }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_full' });
      await place({ branch: north, classId: oxford, studentId: next, from: '2026-11-02' });
    });

    it('seats one of two placements into the last seat at the same moment, whichever comes first', async () => {
      for (const ending of ['commits', 'rolls back'] as const) {
        const oxford = await schoolClass(north, northYear, { size: 1 });
        const one = await members.student(north);
        const two = await members.student(north);
        const held = holding(
          (work) =>
            inBranch(north, async (transaction) => {
              await work(transaction);
              if (ending === 'rolls back') {
                throw new Error('rolled back');
              }
            }),
          async (transaction) => {
            await members.member(
              { branch: north, classId: oxford, studentId: one, from: '2026-10-14' },
              transaction,
            );
          },
        );
        await held.ready;
        // The second waits on the lock of the class, then counts what the first left.
        const late = outcome(
          place({ branch: north, classId: oxford, studentId: two, from: '2026-10-14' }),
        );
        await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
        held.release();
        expect(await outcome(held.done)).toBe(ending === 'commits' ? 'written' : undefined);
        expect(await late).toBe(ending === 'commits' ? 'class_memberships_full' : 'written');
      }
    });

    it('refuses a lower maximum below the members of a date from today on, and allows one above', async () => {
      const oxford = await schoolClass(north, northYear, { size: 3 });
      const one = await members.student(north);
      const two = await members.student(north);
      await place({ branch: north, classId: oxford, studentId: one, from: '2026-09-01' });
      await place({ branch: north, classId: oxford, studentId: two, from: '2026-12-01' });
      const lower = (size: number) =>
        inBranch(north, (transaction) =>
          transaction
            .updateTable('classes')
            .set({ max_size: size })
            .where('id', '=', oxford)
            .execute(),
        );
      expect(await refusal(lower(1))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'classes_size_below_members',
      });
      await lower(2);
      // Raising is always allowed (edge: "The Academic Vice Principal can raise the maximum").
      await lower(5);
      // Without a moment every date counts: the migrator cannot lower it either.
      expect(
        await refusal(
          database.migrator
            .updateTable('classes')
            .set({ max_size: 1 })
            .where('id', '=', oxford)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'classes_size_below_members' });
    });
  });

  describe('the active time of the student (edge, "An active student with no class")', () => {
    it('refuses at the commit a class before the start date or past a leaving', async () => {
      const oxford = await schoolClass(north, northYear);
      const late = await members.student(north, { startsOn: '2026-11-02' });
      expect(
        await refusal(
          place({ branch: north, classId: oxford, studentId: late, from: '2026-10-14' }),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'class_memberships_active' });
      await place({ branch: north, classId: oxford, studentId: late, from: '2026-11-02' });

      // A class written past a leaving.
      const leaver = await members.student(north);
      const refused = await refusal(
        inBranch(north, async (transaction) => {
          await members.leaving(transaction, north, leaver, '2026-11-02');
          await members.member(
            { branch: north, classId: oxford, studentId: leaver, from: '2026-09-01' },
            transaction,
          );
        }),
      );
      expect(refused).toMatchObject({ constraint: 'class_memberships_active' });
    });

    it('refuses at the commit a leaving written without the cut of the class', async () => {
      const oxford = await schoolClass(north, northYear);
      const leaver = await members.student(north);
      await place({ branch: north, classId: oxford, studentId: leaver, from: '2026-09-01' });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            members.leaving(transaction, north, leaver, '2026-11-02'),
          ),
        ),
      ).toMatchObject({ constraint: 'class_memberships_active' });
      // With the cut in the same transaction, it passes.
      await inBranch(north, async (transaction) => {
        const leaving = await members.leaving(transaction, north, leaver, '2026-11-02');
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-11-02', ended_by: 'leaving', leaving_id: leaving })
          .where('student_id', '=', leaver)
          .execute();
      });
    });
  });

  describe('the class against its members', () => {
    it('refuses an archive with members in force or planned, and allows it with past members only', async () => {
      const archive = (id: string) =>
        inBranch(north, (transaction) =>
          transaction
            .updateTable('classes')
            .set({ archived_at: new Date(NOW) })
            .where('id', '=', id)
            .execute(),
        );
      const inForce = await schoolClass(north, northYear);
      await place({
        branch: north,
        classId: inForce,
        studentId: await members.student(north),
        from: '2026-09-01',
      });
      expect(await refusal(archive(inForce))).toMatchObject({ constraint: 'classes_has_members' });

      const planned = await schoolClass(north, northYear);
      await place({
        branch: north,
        classId: planned,
        studentId: await members.student(north),
        from: '2026-12-01',
      });
      expect(await refusal(archive(planned))).toMatchObject({ constraint: 'classes_has_members' });

      // A member who left yesterday holds no seat today.
      const past = await schoolClass(north, northYear);
      const leaver = await members.student(north);
      await inBranch(north, async (transaction) => {
        const leaving = await members.leaving(transaction, north, leaver, '2026-10-14');
        await members.member(
          {
            branch: north,
            classId: past,
            studentId: leaver,
            from: '2026-09-01',
            until: '2026-10-14',
            endedBy: 'leaving',
            leavingId: leaving,
          },
          transaction,
        );
      });
      await archive(past);
      // An archived class takes no one.
      expect(
        await refusal(
          place({
            branch: north,
            classId: past,
            studentId: await members.student(north),
            from: '2026-10-14',
          }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_class_archived' });
    });

    it('refuses a class of a closed year and a row outside the year', async () => {
      const branch = await insertBranch(database.migrator, 'Closed year');
      const year = await classes.year(branch, 'current', '2025-09-01', '2026-05-31');
      const next = await classes.year(branch, 'planned', '2026-09-01', '2027-05-31');
      const old = await schoolClass(branch, year);
      const student = await members.student(branch, { startsOn: '2025-09-01' });
      await classes.setYear(year, 'closed');
      expect(
        await refusal(
          place({
            branch,
            classId: old,
            studentId: student,
            from: '2025-09-01',
            ownUntil: '2026-06-01',
          }),
        ),
      ).toMatchObject({ constraint: 'class_year_closed' });
      const coming = await schoolClass(branch, next);
      expect(
        await refusal(place({ branch, classId: coming, studentId: student, from: '2026-08-31' })),
      ).toMatchObject({ constraint: 'class_memberships_outside_year' });
      expect(
        await refusal(
          place({
            branch,
            classId: coming,
            studentId: student,
            from: '2026-09-01',
            ownUntil: '2027-06-02',
          }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_outside_year' });
    });

    it('refuses a class of another grade, a grade edit of a class with members and of a student in a class', async () => {
      const eighth = await schoolClass(north, northYear, { grade: 8 });
      const student = await members.student(north, { grade: 7 });
      expect(
        await refusal(
          place({ branch: north, classId: eighth, studentId: student, from: '2026-10-14' }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_grade' });

      const seventh = await schoolClass(north, northYear, { grade: 7 });
      await place({ branch: north, classId: seventh, studentId: student, from: '2026-10-14' });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('classes')
              .set({ grade: 8 })
              .where('id', '=', seventh)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'classes_grade_members' });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('students')
              .set({ grade: 8 })
              .where('id', '=', student)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'students_grade_class' });
      // A class with no members changes its grade.
      const empty = await schoolClass(north, northYear, { grade: 7 });
      await inBranch(north, (transaction) =>
        transaction.updateTable('classes').set({ grade: 8 }).where('id', '=', empty).execute(),
      );
    });

    it('refuses a change of the dates of a year whose classes hold members, past rows included', async () => {
      const branch = await insertBranch(database.migrator, 'Year dates');
      const year = await classes.year(branch);
      const oxford = await schoolClass(branch, year);
      const student = await members.student(branch);
      const move = (start: string, end: string) =>
        inBranch(branch, (transaction) =>
          transaction
            .updateTable('academic_years')
            .set({ start_date: start, end_date: end })
            .where('id', '=', year)
            .execute(),
        );
      // Before any member the dates move.
      await move('2026-09-02', '2027-05-31');
      await move('2026-09-01', '2027-05-31');
      await inBranch(branch, async (transaction) => {
        const leaving = await members.leaving(transaction, branch, student, '2026-09-15');
        await members.member(
          {
            branch,
            classId: oxford,
            studentId: student,
            from: '2026-09-01',
            until: '2026-09-15',
            endedBy: 'leaving',
            leavingId: leaving,
          },
          transaction,
        );
      });
      // Only a past row is left, and the start still cannot move past it.
      expect(await refusal(move('2026-09-08', '2027-05-31'))).toMatchObject({
        constraint: 'academic_years_has_members',
      });
      expect(await refusal(move('2026-09-01', '2027-05-30'))).toMatchObject({
        constraint: 'academic_years_has_members',
      });
    });
  });

  describe('rows only shrink and keep their own end (decision 8, correction 1)', () => {
    it('refuses a later end, a change of any other column and a second cause', async () => {
      const oxford = await schoolClass(north, northYear);
      const student = await members.student(north);
      const id = await place({
        branch: north,
        classId: oxford,
        studentId: student,
        from: '2026-12-01',
      });
      const update = (values: Record<string, unknown>) =>
        inBranch(north, (transaction) =>
          transaction.updateTable('class_memberships').set(values).where('id', '=', id).execute(),
        );
      // Withdrawn before its date: an empty range with its cause, then final.
      await update({ valid_until: '2026-12-01', ended_by: 'withdrawn' });
      expect(await members.rowOf(id)).toMatchObject({
        valid_from: '2026-12-01',
        valid_until: '2026-12-01',
        own_until: '2027-06-01',
        ended_by: 'withdrawn',
      });
      expect(await refusal(update({ ended_by: null, valid_until: '2027-06-01' }))).toMatchObject({
        constraint: 'class_memberships_only_shrink',
      });
      // A withdrawn row stays withdrawn: no leaving takes it over.
      const leaving = await inBranch(north, (transaction) =>
        members.leaving(transaction, north, student, '2027-01-04'),
      );
      expect(await refusal(update({ ended_by: 'leaving', leaving_id: leaving }))).toMatchObject({
        constraint: 'class_memberships_only_shrink',
      });
    });

    it('lets a leaving cut a row and a later leaving re-cut it earlier, never later', async () => {
      const oxford = await schoolClass(north, northYear);
      const student = await members.student(north);
      const id = await place({
        branch: north,
        classId: oxford,
        studentId: student,
        from: '2026-09-01',
      });
      const first = await inBranch(north, async (transaction) => {
        const leaving = await members.leaving(transaction, north, student, '2026-12-01');
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-12-01', ended_by: 'leaving', leaving_id: leaving })
          .where('id', '=', id)
          .execute();
        return leaving;
      });
      expect(await members.rowOf(id)).toMatchObject({
        valid_until: '2026-12-01',
        own_until: '2027-06-01',
        leaving_id: first,
      });
      const later = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('class_memberships')
            .set({ valid_until: '2027-01-04' })
            .where('id', '=', id)
            .execute(),
        ),
      );
      expect(later).toMatchObject({ constraint: 'class_memberships_only_shrink' });
      // A leaving of another student is no leaving of this row.
      const other = await members.student(north);
      const foreign = await inBranch(north, (transaction) =>
        members.leaving(transaction, north, other, '2026-11-02'),
      ).catch(() => null);
      expect(foreign).not.toBeNull();
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('class_memberships')
              .set({ leaving_id: foreign ?? '' })
              .where('id', '=', id)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'class_memberships_leaving' });
    });

    it('refuses an empty insert that no leaving withdrew, a withdrawn insert and a leaving of another student', async () => {
      const oxford = await schoolClass(north, northYear);
      const student = await members.student(north);
      const insert = (values: Record<string, unknown>) =>
        inBranch(north, (transaction) =>
          transaction
            .insertInto('class_memberships')
            .values({
              ...memberValues({
                branch: north,
                classId: oxford,
                studentId: student,
                from: '2026-12-01',
              }),
              ...values,
            })
            .execute(),
        );
      expect(await refusal(insert({ valid_until: '2026-12-01' }))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'class_memberships_insert_ended',
      });
      expect(
        await refusal(insert({ valid_until: '2026-12-01', ended_by: 'withdrawn' })),
      ).toMatchObject({ constraint: 'class_memberships_insert_ended' });
      const other = await members.student(north);
      const foreign = await inBranch(north, (transaction) =>
        members.leaving(transaction, north, other, '2027-01-04'),
      );
      expect(
        await refusal(
          insert({ valid_until: '2027-01-04', ended_by: 'leaving', leaving_id: foreign }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_leaving' });
    });

    it('refuses to take back the cause of a leaving, and a change of the end in a closed year', async () => {
      const oxford = await schoolClass(north, northYear);
      const student = await members.student(north);
      const id = await inBranch(north, async (transaction) => {
        const leaving = await members.leaving(transaction, north, student, '2026-12-01');
        return members.member(
          {
            branch: north,
            classId: oxford,
            studentId: student,
            from: '2026-09-01',
            until: '2026-12-01',
            endedBy: 'leaving',
            leavingId: leaving,
          },
          transaction,
        );
      });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('class_memberships')
              .set({ ended_by: null, leaving_id: null })
              .where('id', '=', id)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'class_memberships_only_shrink' });

      const branch = await insertBranch(database.migrator, 'Closed shrink');
      const year = await classes.year(branch, 'current', '2025-09-01', '2026-05-31');
      const old = await schoolClass(branch, year);
      const pupil = await members.student(branch, { startsOn: '2025-09-01' });
      const row = await members.member({
        branch,
        classId: old,
        studentId: pupil,
        from: '2025-09-01',
        ownUntil: '2026-06-01',
      });
      await classes.setYear(year, 'closed');
      expect(
        await refusal(
          inBranch(branch, async (transaction) => {
            const leaving = await members.leaving(transaction, branch, pupil, '2026-06-01');
            await transaction
              .updateTable('class_memberships')
              .set({ valid_until: '2026-05-01', ended_by: 'leaving', leaving_id: leaving })
              .where('id', '=', row)
              .execute();
          }),
        ),
      ).toMatchObject({ constraint: 'class_year_closed' });
    });

    it('withdraws a placement only before its first day, and never without a moment', async () => {
      const oxford = await schoolClass(north, northYear);
      const student = await members.student(north);
      const inForce = await place({
        branch: north,
        classId: oxford,
        studentId: student,
        from: '2026-09-01',
      });
      const withdraw = (db: Database | Transaction, id: string, from: string) =>
        db
          .updateTable('class_memberships')
          .set({ valid_until: from, ended_by: 'withdrawn' })
          .where('id', '=', id)
          .execute();
      expect(
        await refusal(
          inBranch(north, (transaction) => withdraw(transaction, inForce, '2026-09-01')),
        ),
      ).toMatchObject({ constraint: 'class_memberships_withdraw_planned' });
      const later = await members.student(north);
      const planned = await place({
        branch: north,
        classId: oxford,
        studentId: later,
        from: '2026-12-01',
      });
      // The migrator has no moment: refused.
      expect(await refusal(withdraw(database.migrator, planned, '2026-12-01'))).toMatchObject({
        constraint: 'class_memberships_withdraw_planned',
      });
      await inBranch(north, (transaction) => withdraw(transaction, planned, '2026-12-01'));
    });
  });

  describe('the grants and the branch filter', () => {
    it('gives no delete and no write of the class, the student, the dates or the own end', async () => {
      const oxford = await schoolClass(north, northYear);
      const yale = await schoolClass(north, northYear);
      const student = await members.student(north);
      const id = await place({
        branch: north,
        classId: oxford,
        studentId: student,
        from: '2026-09-01',
      });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction.deleteFrom('class_memberships').where('id', '=', id).execute(),
          ),
        ),
      ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      // Task 3.3d (decision 2 of pull request #98, Look first): the student
      // has an update grant, guarded: never without a merge of the pair
      // written in the transaction (`memberships_merge`, 0054).
      const other = await members.student(north);
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('class_memberships')
              .set({ student_id: other })
              .where('id', '=', id)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'memberships_merge' });
      // Task 3.5c (decision 2, Look first): the own end has an update grant
      // for the join of two adjoining rows only; any other change of it is
      // refused by the shrink rule.
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('class_memberships')
              .set({ own_until: '2027-05-01' })
              .where('id', '=', id)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'class_memberships_only_shrink' });
      for (const values of [
        { class_id: yale },
        { valid_from: '2026-09-02' },
        { cause: 'undo' },
        { branch_id: south },
      ]) {
        expect(
          await refusal(
            inBranch(north, (transaction) =>
              transaction
                .updateTable('class_memberships')
                .set(values)
                .where('id', '=', id)
                .execute(),
            ),
          ),
        ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      }
    });

    it('shows a branch its own rows only and refuses a row of another branch or a student of another branch', async () => {
      const oxford = await schoolClass(north, northYear);
      const student = await members.student(north);
      await place({ branch: north, classId: oxford, studentId: student, from: '2026-09-01' });
      const seen = await inBranch(south, (transaction) =>
        transaction
          .selectFrom('class_memberships')
          .select('id')
          .where('student_id', '=', student)
          .execute(),
      );
      expect(seen).toEqual([]);
      // A transaction of the south writes no row of the north: its guard sees
      // no such student before the row filter would refuse the row.
      expect(
        await refusal(
          inBranch(south, (transaction) =>
            members.member(
              { branch: north, classId: oxford, studentId: student, from: '2026-12-01' },
              transaction,
            ),
          ),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'class_memberships_student_branch' });
      // A class of the south takes no student of the north.
      const southClass = await schoolClass(south, southYear);
      const northStudent = await members.student(north);
      expect(
        await refusal(
          inBranch([north, south], (transaction) =>
            members.member(
              { branch: south, classId: southClass, studentId: northStudent, from: '2026-10-14' },
              transaction,
            ),
          ),
        ),
      ).toMatchObject({ constraint: 'class_memberships_student_branch' });
    });

    it('keeps the old rows with their class when the student moves branch (decision 16)', async () => {
      const oxford = await schoolClass(north, northYear);
      const student = await members.student(north);
      const id = await inBranch(north, async (transaction) => {
        const leaving = await members.leaving(transaction, north, student, '2026-10-01');
        return members.member(
          {
            branch: north,
            classId: oxford,
            studentId: student,
            from: '2026-09-01',
            until: '2026-10-01',
            endedBy: 'leaving',
            leavingId: leaving,
          },
          transaction,
        );
      });
      // Task 3.3c: the branch changes only with an accepted move (0053).
      await moveStudentBranch(database.migrator, student, north, south);
      expect(await members.rowOf(id)).toMatchObject({ branch_id: north });
    });

    it('takes the rows with a student deleted as created twice (decision 12)', async () => {
      const oxford = await schoolClass(north, northYear);
      const student = await members.student(north);
      await place({ branch: north, classId: oxford, studentId: student, from: '2026-12-01' });
      await inBranch(north, (transaction) =>
        transaction.deleteFrom('students').where('id', '=', student).execute(),
      );
      expect(await rowsOfStudent(student)).toEqual([]);
    });
  });

  // Task 3.3b, decision 3: the class row of a return and of a graduate
  // restore, with every guard of an insert (edge: "A class is full ... on
  // every path").
  describe('the rows of a return and a restore (task 3.3b)', () => {
    it('lets in a row with the cause return and one with restore, and refuses an unknown cause', async () => {
      const oxford = await schoolClass(north, northYear);
      const back = await members.student(north);
      const restored = await members.student(north);
      const returned = await place({
        branch: north,
        classId: oxford,
        studentId: back,
        from: '2026-10-14',
        cause: 'return',
      });
      const restoredRow = await place({
        branch: north,
        classId: oxford,
        studentId: restored,
        from: '2026-10-14',
        cause: 'restore',
      });
      expect(await members.rowOf(returned)).toMatchObject({ cause: 'return' });
      expect(await members.rowOf(restoredRow)).toMatchObject({ cause: 'restore' });
      const other = await members.student(north);
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .insertInto('class_memberships')
              .values({
                ...memberValues({
                  branch: north,
                  classId: oxford,
                  studentId: other,
                  from: '2026-10-14',
                }),
                cause: 'graduate',
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'class_memberships_cause_check' });
    });

    it('refuses a return row into a full class, a class of another grade, an archived class and a class of a closed year', async () => {
      const full = await schoolClass(north, northYear, { size: 1 });
      await place({
        branch: north,
        classId: full,
        studentId: await members.student(north),
        from: '2026-11-02',
      });
      const student = await members.student(north, { grade: 7 });
      const returning = (classId: string) =>
        refusal(
          place({
            branch: north,
            classId,
            studentId: student,
            from: '2026-10-14',
            cause: 'return',
          }),
        );
      expect(await returning(full)).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'class_memberships_full',
      });
      const eighth = await schoolClass(north, northYear, { grade: 8 });
      expect(await returning(eighth)).toMatchObject({ constraint: 'class_memberships_grade' });
      const archived = await schoolClass(north, northYear);
      await database.migrator
        .updateTable('classes')
        .set({ archived_at: new Date(NOW) })
        .where('id', '=', archived)
        .execute();
      expect(await returning(archived)).toMatchObject({
        constraint: 'class_memberships_class_archived',
      });
      const branch = await insertBranch(database.migrator, 'Closed year of a return');
      const year = await classes.year(branch, 'current', '2025-09-01', '2026-05-31');
      const old = await schoolClass(branch, year);
      const graduate = await members.student(branch, { startsOn: '2025-09-01' });
      await classes.setYear(year, 'closed');
      expect(
        await refusal(
          place({
            branch,
            classId: old,
            studentId: graduate,
            from: '2025-09-01',
            ownUntil: '2026-06-01',
            cause: 'restore',
          }),
        ),
      ).toMatchObject({ constraint: 'class_year_closed' });
      expect(await rowsOfStudent(student)).toEqual([]);
    });
  });

  describe('two changes at the same moment (the lock order of the guard)', () => {
    /** A held transaction that does `work`, and a placement that meets it. */
    async function race(
      work: (transaction: Transaction) => Promise<void>,
      placement: MemberRow,
    ): Promise<{ held: Promise<string | undefined>; placed: Promise<string | undefined> }> {
      const held = holding((run) => inBranch(placement.branch, run), work);
      await held.ready;
      const placed = outcome(place(placement));
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      return { held: outcome(held.done), placed };
    }

    /** A placement held open, and a change that meets it. */
    async function placedFirst(
      placement: MemberRow,
      change: () => Promise<unknown>,
    ): Promise<{ held: Promise<string | undefined>; changed: Promise<string | undefined> }> {
      const held = holding(
        (run) => inBranch(placement.branch, run),
        async (transaction) => {
          await members.member(placement, transaction);
        },
      );
      await held.ready;
      const changed = outcome(change());
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      return { held: outcome(held.done), changed };
    }

    const archiveOf = (id: string) => (transaction: Transaction) =>
      transaction
        .updateTable('classes')
        .set({ archived_at: new Date(NOW) })
        .where('id', '=', id)
        .execute()
        .then(() => undefined);

    it('orders an archive and a placement, both directions', async () => {
      const first = await schoolClass(north, northYear);
      const one = await race(archiveOf(first), {
        branch: north,
        classId: first,
        studentId: await members.student(north),
        from: '2026-10-14',
      });
      expect(await one.held).toBe('written');
      expect(await one.placed).toBe('class_memberships_class_archived');

      const second = await schoolClass(north, northYear);
      const two = await placedFirst(
        {
          branch: north,
          classId: second,
          studentId: await members.student(north),
          from: '2026-10-14',
        },
        () => inBranch(north, archiveOf(second)),
      );
      expect(await two.held).toBe('written');
      expect(await two.changed).toBe('classes_has_members');
    });

    it('orders a grade edit of the class and a placement, both directions', async () => {
      const gradeOf = (id: string) => (transaction: Transaction) =>
        transaction
          .updateTable('classes')
          .set({ grade: 8 })
          .where('id', '=', id)
          .execute()
          .then(() => undefined);
      const first = await schoolClass(north, northYear);
      const one = await race(gradeOf(first), {
        branch: north,
        classId: first,
        studentId: await members.student(north),
        from: '2026-10-14',
      });
      expect(await one.held).toBe('written');
      expect(await one.placed).toBe('class_memberships_grade');

      const second = await schoolClass(north, northYear);
      const two = await placedFirst(
        {
          branch: north,
          classId: second,
          studentId: await members.student(north),
          from: '2026-10-14',
        },
        () => inBranch(north, gradeOf(second)),
      );
      expect(await two.held).toBe('written');
      expect(await two.changed).toBe('classes_grade_members');
    });

    it('orders a leaving held on the student and a placement, both directions', async () => {
      // A leaving holds the student FOR UPDATE: the placement waits and meets the active time.
      const oxford = await schoolClass(north, northYear);
      const leaver = await members.student(north);
      const one = await race(
        async (transaction) => {
          await transaction
            .selectFrom('students')
            .select('id')
            .where('id', '=', leaver)
            .forUpdate()
            .execute();
          await members.leaving(transaction, north, leaver, '2026-10-20');
        },
        { branch: north, classId: oxford, studentId: leaver, from: '2026-10-14' },
      );
      expect(await one.held).toBe('written');
      expect(await one.placed).toBe('class_memberships_active');

      // A placement holds the student FOR SHARE: the leaving waits and meets the class.
      const other = await members.student(north);
      const two = await placedFirst(
        { branch: north, classId: oxford, studentId: other, from: '2026-10-14' },
        () =>
          inBranch(north, async (transaction) => {
            await transaction
              .selectFrom('students')
              .select('id')
              .where('id', '=', other)
              .forUpdate()
              .execute();
            await members.leaving(transaction, north, other, '2026-10-20');
          }),
      );
      expect(await two.held).toBe('written');
      expect(await two.changed).toBe('class_memberships_active');
    });

    it('orders a grade edit of the student and a placement, both directions', async () => {
      const gradeOf = (id: string) => (transaction: Transaction) =>
        transaction
          .updateTable('students')
          .set({ grade: 8 })
          .where('id', '=', id)
          .execute()
          .then(() => undefined);
      const oxford = await schoolClass(north, northYear);
      const one = await members.student(north);
      const first = await race(gradeOf(one), {
        branch: north,
        classId: oxford,
        studentId: one,
        from: '2026-10-14',
      });
      expect(await first.held).toBe('written');
      expect(await first.placed).toBe('class_memberships_grade');

      const two = await members.student(north);
      const second = await placedFirst(
        { branch: north, classId: oxford, studentId: two, from: '2026-10-14' },
        () => inBranch(north, gradeOf(two)),
      );
      expect(await second.held).toBe('written');
      expect(await second.changed).toBe('students_grade_class');
    });
  });
});
