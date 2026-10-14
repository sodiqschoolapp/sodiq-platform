import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { MembersKit, groupMemberValues, memberValues } from '../../testing/members-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

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

// The rules of moves that the database itself keeps (db/migrations/0050,
// task 3.3a, pull request #95): the move record (decision 7), its states
// written once (should-fix 7), the rows that name it (must-fix 2), the
// checks and triggers of 0045, 0048 and 0049 replaced with paths added and
// none taken away (decision 12, must-fixes 3 and 4), and a row inserted
// already cut by a scheduled move (correction 1). All names are invented.
describe('moves in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let members: MembersKit;
  let north: string;
  let south: string;
  let northYear: string;
  let southYear: string;
  let maths: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** A student in a new class of the North branch from 1 September. */
  async function pupil() {
    const oxford = await classes.schoolClass(north, northYear);
    const yale = await classes.schoolClass(north, northYear);
    const student = await members.student(north, { startsOn: '2026-09-01' });
    const row = await members.member({
      branch: north,
      classId: oxford,
      studentId: student,
      from: '2026-09-01',
    });
    return { oxford, yale, student, row };
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    classes = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    northYear = await classes.year(north);
    southYear = await classes.year(south);
    maths = await classes.subject({ grades: [7, 8] });
    members = new MembersKit(database.migrator, await classes.account());
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the move record', () => {
    it('keeps a move to its branch', async () => {
      const { oxford, yale, student } = await pupil();
      const move = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-20',
        fromClassId: oxford,
        toClassId: yale,
      });
      const seen = (branch: string) =>
        inBranch(branch, (transaction) =>
          transaction.selectFrom('student_moves').select('id').where('id', '=', move).execute(),
        );
      expect(await seen(north)).toHaveLength(1);
      expect(await seen(south)).toEqual([]);
    });

    it('refuses a move of another shape, of a student of another branch, or written cancelled', async () => {
      const { oxford, yale, student } = await pupil();
      expect(
        await refusal(
          members.move({
            branch: north,
            studentId: student,
            from: '2026-10-20',
            fromClassId: oxford,
          }),
        ),
      ).toMatchObject({ constraint: 'student_moves_shape_check' });
      expect(
        await refusal(
          members.move({
            branch: north,
            studentId: student,
            from: '2026-10-20',
            fromClassId: oxford,
            toClassId: oxford,
          }),
        ),
      ).toMatchObject({ constraint: 'student_moves_shape_check' });
      const southClass = await classes.schoolClass(south, southYear);
      const other = await classes.schoolClass(south, southYear);
      expect(
        await refusal(
          members.move({
            branch: south,
            studentId: student,
            from: '2026-10-20',
            fromClassId: southClass,
            toClassId: other,
          }),
        ),
      ).toMatchObject({ constraint: 'student_moves_student_branch' });
      expect(
        await refusal(
          database.migrator
            .insertInto('student_moves')
            .values({
              branch_id: north,
              student_id: student,
              kind: 'class',
              from_class_id: oxford,
              to_class_id: yale,
              effective_on: '2026-10-20',
              made_at: new Date(NOW),
              cancelled_at: new Date(NOW),
            })
            .execute(),
        ),
      ).toMatchObject({ constraint: 'student_moves_state' });
    });

    it('cancels only before the date and undoes only from it, each once', async () => {
      const { oxford, yale, student } = await pupil();
      const later = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-20',
        fromClassId: oxford,
        toClassId: yale,
      });
      const begun = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-14',
        fromClassId: yale,
        toClassId: oxford,
      });
      const set = (
        id: string,
        values: { cancelled_at?: Date; undone_at?: Date; reason?: string },
      ) =>
        inBranch(north, (transaction) =>
          transaction.updateTable('student_moves').set(values).where('id', '=', id).execute(),
        );
      // Today, 14 October, the date of `begun`: it has begun.
      expect(await refusal(set(begun, { cancelled_at: new Date(NOW) }))).toMatchObject({
        constraint: 'student_moves_not_scheduled',
      });
      expect(
        await refusal(set(later, { undone_at: new Date(NOW), reason: 'Typed by mistake' })),
      ).toMatchObject({ constraint: 'student_moves_not_begun' });
      // An undo needs a reason.
      expect(await refusal(set(begun, { undone_at: new Date(NOW) }))).toMatchObject({
        constraint: 'student_moves_undo_reason_check',
      });
      await set(later, { cancelled_at: new Date(NOW) });
      await set(begun, { undone_at: new Date(NOW), reason: 'Typed by mistake' });
      expect(
        await refusal(set(later, { cancelled_at: new Date('2026-10-15T09:00:00+05:00') })),
      ).toMatchObject({ constraint: 'student_moves_state' });
      expect(await refusal(set(begun, { reason: 'Another reason' }))).toMatchObject({
        constraint: 'student_moves_state',
      });
    });

    it('lets the application delete no move', async () => {
      const { oxford, yale, student } = await pupil();
      const move = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-20',
        fromClassId: oxford,
        toClassId: yale,
      });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction.deleteFrom('student_moves').where('id', '=', move).execute(),
          ),
        ),
      ).toMatchObject({ code: '42501' });
    });
  });

  describe('the rows that name a move', () => {
    it('refuses a row a move wrote without the move, and an end by a move without it', async () => {
      const { yale, student, row } = await pupil();
      expect(
        await refusal(
          members.member({
            branch: north,
            classId: yale,
            studentId: student,
            from: '2026-12-01',
            cause: 'transfer',
          }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_written_check' });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('class_memberships')
              .set({ valid_until: '2026-10-20', ended_by: 'transfer' })
              .where('id', '=', row)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'memberships_move_end' });
    });

    it('keeps both links of a chain of two moves', async () => {
      const { oxford, yale, student, row } = await pupil();
      const harvard = await classes.schoolClass(north, northYear);
      const first = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-20',
        fromClassId: oxford,
        toClassId: yale,
      });
      const second = await members.move({
        branch: north,
        studentId: student,
        from: '2026-11-02',
        fromClassId: yale,
        toClassId: harvard,
      });
      const target = await inBranch(north, async (transaction) => {
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-20', ended_by: 'transfer', ended_by_move_id: first })
          .where('id', '=', row)
          .execute();
        return members.member(
          {
            branch: north,
            classId: yale,
            studentId: student,
            from: '2026-10-20',
            cause: 'transfer',
            writtenByMoveId: first,
          },
          transaction,
        );
      });
      await inBranch(north, async (transaction) => {
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-11-02', ended_by: 'transfer', ended_by_move_id: second })
          .where('id', '=', target)
          .execute();
        await members.member(
          {
            branch: north,
            classId: harvard,
            studentId: student,
            from: '2026-11-02',
            cause: 'transfer',
            writtenByMoveId: second,
          },
          transaction,
        );
      });
      expect(
        await database.migrator
          .selectFrom('class_memberships')
          .select(['written_by_move_id', 'ended_by_move_id'])
          .where('id', '=', target)
          .executeTakeFirstOrThrow(),
      ).toEqual({ written_by_move_id: first, ended_by_move_id: second });
    });

    // Correction 1: a row written inside a class row a scheduled move cut is
    // inserted already cut by that move, as by a scheduled leaving.
    it('inserts a group row cut by a scheduled move of the student at its date, and no other', async () => {
      const { oxford, yale, student, row } = await pupil();
      const group = await classes.group(north, northYear, maths, [oxford]);
      const move = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-20',
        fromClassId: oxford,
        toClassId: yale,
      });
      await database.migrator
        .updateTable('class_memberships')
        .set({ valid_until: '2026-10-20', ended_by: 'transfer', ended_by_move_id: move })
        .where('id', '=', row)
        .execute();
      const values = (until: string, moveId: string) =>
        groupMemberValues({
          branch: north,
          groupId: group,
          subjectId: maths,
          studentId: student,
          from: '2026-10-14',
          until,
          endedBy: 'transfer',
          endedByMoveId: moveId,
        });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .insertInto('group_memberships')
              .values(values('2026-10-19', move))
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'group_memberships_move' });
      const written = await inBranch(north, (transaction) =>
        transaction
          .insertInto('group_memberships')
          .values(values('2026-10-20', move))
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
      expect(await members.groupRowOf(written.id)).toMatchObject({
        valid_until: '2026-10-20',
        ended_by: 'transfer',
      });
      // A cancelled move cuts nothing new.
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('student_moves')
          .set({ cancelled_at: new Date(NOW) })
          .where('id', '=', move)
          .execute(),
      );
      const english = await classes.subject({ grades: [7, 8], languageRule: false });
      const other = await classes.group(north, northYear, english, [oxford]);
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .insertInto('group_memberships')
              .values({ ...values('2026-10-20', move), group_id: other, subject_id: english })
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'group_memberships_move' });
    });

    // Must-fix 3 of the plan review: a group row a move cut keeps its days.
    it('lets a group row cut by a move keep days, and keeps an undone or withdrawn row empty', async () => {
      const { oxford, yale, student } = await pupil();
      const group = await classes.group(north, northYear, maths, [oxford]);
      const grouped = await members.groupMember({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-09-01',
      });
      const move = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-20',
        fromClassId: oxford,
        toClassId: yale,
      });
      await database.migrator
        .updateTable('group_memberships')
        .set({ valid_until: '2026-10-20', ended_by: 'transfer', ended_by_move_id: move })
        .where('id', '=', grouped)
        .execute();
      expect(await members.groupRowOf(grouped)).toMatchObject({
        valid_from: '2026-09-01',
        valid_until: '2026-10-20',
        ended_by: 'transfer',
      });
      // A planned row withdrawn with its class row, days left, is refused.
      const planned = await members.groupMember({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-10-25',
        until: '2026-12-01',
        ownUntil: '2026-12-01',
      });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('group_memberships')
              .set({ valid_until: '2026-11-01', ended_by: 'class_withdrawn' })
              .where('id', '=', planned)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'group_memberships_withdrawn_check' });
    });
  });

  describe('rows only shrink, with the paths of a move added', () => {
    it('lets a move cut a begun row back before today, and an undo empty the row its move wrote', async () => {
      const { oxford, yale, student, row } = await pupil();
      const move = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-07',
        fromClassId: oxford,
        toClassId: yale,
      });
      // "A transfer is recorded a week late" (edge): today is 14 October.
      const target = await inBranch(north, async (transaction) => {
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-07', ended_by: 'transfer', ended_by_move_id: move })
          .where('id', '=', row)
          .execute();
        return members.member(
          {
            branch: north,
            classId: yale,
            studentId: student,
            from: '2026-10-07',
            cause: 'transfer',
            writtenByMoveId: move,
          },
          transaction,
        );
      });
      // A withdraw stays for a planned row only.
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('class_memberships')
              .set({ valid_until: '2026-10-07', ended_by: 'withdrawn' })
              .where('id', '=', target)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'class_memberships_withdraw_planned' });
      // An undo empties only a row its own move wrote.
      const other = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-08',
        fromClassId: oxford,
        toClassId: yale,
      });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('class_memberships')
              .set({ valid_until: '2026-10-07', ended_by: 'undone', ended_by_move_id: other })
              .where('id', '=', target)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'memberships_move_end' });
      await inBranch(north, async (transaction) => {
        // 0051: the move is undone before its row.
        await transaction
          .updateTable('student_moves')
          .set({ undone_at: new Date(NOW), reason: 'Typed by mistake' })
          .where('id', '=', move)
          .execute();
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-07', ended_by: 'undone', ended_by_move_id: move })
          .where('id', '=', target)
          .execute();
        await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: student,
            from: '2026-10-07',
            cause: 'undo',
            writtenByMoveId: move,
          },
          transaction,
        );
      });
      expect(await members.rowOf(target)).toMatchObject({
        valid_from: '2026-10-07',
        valid_until: '2026-10-07',
        ended_by: 'undone',
      });
      // An undone row is final, and a row a move cut never gets its end back.
      expect(
        await refusal(
          database.migrator
            .updateTable('class_memberships')
            .set({ valid_until: '2027-06-01', ended_by: null, ended_by_move_id: null })
            .where('id', '=', row)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'class_memberships_only_shrink' });
    });

    // Must-fix 4 of the plan review: no path is taken away. A backdated
    // leaving still empties a row that began between its date and today, and
    // cuts a row a move cut.
    it('still lets a backdated leaving empty a begun row and cut a row a move cut', async () => {
      const { oxford, yale, student, row } = await pupil();
      const move = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-07',
        fromClassId: oxford,
        toClassId: yale,
      });
      const target = await inBranch(north, async (transaction) => {
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-07', ended_by: 'transfer', ended_by_move_id: move })
          .where('id', '=', row)
          .execute();
        return members.member(
          {
            branch: north,
            classId: yale,
            studentId: student,
            from: '2026-10-07',
            cause: 'transfer',
            writtenByMoveId: move,
          },
          transaction,
        );
      });
      await inBranch(north, async (transaction) => {
        const leaving = await members.leaving(transaction, north, student, '2026-10-01');
        await transaction
          .updateTable('class_memberships')
          .set({
            valid_until: '2026-10-01',
            ended_by: 'leaving',
            leaving_id: leaving,
            ended_by_move_id: null,
          })
          .where('id', '=', row)
          .execute();
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-07', ended_by: 'leaving', leaving_id: leaving })
          .where('id', '=', target)
          .execute();
      });
      expect(await members.rowOf(row)).toMatchObject({
        valid_until: '2026-10-01',
        ended_by: 'leaving',
      });
      expect(await members.rowOf(target)).toMatchObject({
        valid_from: '2026-10-07',
        valid_until: '2026-10-07',
        ended_by: 'leaving',
      });
    });

    it('refuses a row written into a full class by a move, as any placement', async () => {
      const { oxford, student } = await pupil();
      const small = await classes.schoolClass(north, northYear, { maxSize: 1 });
      const other = await members.student(north, { startsOn: '2026-09-01' });
      await members.member({ branch: north, classId: small, studentId: other, from: '2026-09-01' });
      const move = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-20',
        fromClassId: oxford,
        toClassId: small,
      });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .insertInto('class_memberships')
              .values(
                memberValues({
                  branch: north,
                  classId: small,
                  studentId: student,
                  from: '2026-10-20',
                  cause: 'transfer',
                  writtenByMoveId: move,
                }),
              )
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'class_memberships_full' });
    });
  });

  // Spec review of the build, must-fix 4 and should-fix 1: every branch of the
  // guards 0050 and 0051 added is reached by a test of its own.
  describe('every new branch of the guards', () => {
    async function moved() {
      const { oxford, yale, student, row } = await pupil();
      const move = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-20',
        fromClassId: oxford,
        toClassId: yale,
      });
      return { oxford, yale, student, row, move };
    }

    it('inserts a class row cut by a scheduled move only at its date and with a live move', async () => {
      const { yale, student, row, move } = await moved();
      await database.migrator
        .updateTable('class_memberships')
        .set({ valid_until: '2026-10-20', ended_by: 'transfer', ended_by_move_id: move })
        .where('id', '=', row)
        .execute();
      const harvard = await classes.schoolClass(north, northYear);
      const values = (until: string) =>
        memberValues({
          branch: north,
          classId: harvard,
          studentId: student,
          from: '2026-10-25',
          until,
          endedBy: 'transfer',
          endedByMoveId: move,
        });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction.insertInto('class_memberships').values(values('2026-10-30')).execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'class_memberships_move' });
      // An empty row is inserted cut only by a leaving or a move.
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .insertInto('class_memberships')
              .values({
                ...memberValues({
                  branch: north,
                  classId: yale,
                  studentId: student,
                  from: '2026-11-01',
                }),
                valid_until: '2026-11-01',
                ended_by: 'undone',
                ended_by_move_id: move,
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'class_memberships_insert_ended' });
    });

    it('refuses a row that names the move of another student', async () => {
      const { yale, move } = await moved();
      const other = await members.student(north, { startsOn: '2026-09-01' });
      expect(
        await refusal(
          members.member({
            branch: north,
            classId: yale,
            studentId: other,
            from: '2026-10-20',
            cause: 'transfer',
            writtenByMoveId: move,
          }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_move' });
      await members.member({ branch: north, classId: yale, studentId: other, from: '2026-09-01' });
      const group = await classes.group(north, northYear, maths, [yale]);
      expect(
        await refusal(
          members.groupMember({
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: other,
            from: '2026-10-20',
            cause: 'transfer',
            writtenByMoveId: move,
          }),
        ),
      ).toMatchObject({ constraint: 'group_memberships_move' });
      const grouped = await members.groupMember({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: other,
        from: '2026-10-25',
      });
      expect(
        await refusal(
          database.migrator
            .updateTable('group_memberships')
            .set({ ended_by_move_id: move })
            .where('id', '=', grouped)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'group_memberships_move' });
    });

    it('refuses an empty group row inserted undone, and an undo by a move that did not write the row', async () => {
      const { oxford, student, move } = await moved();
      const group = await classes.group(north, northYear, maths, [oxford]);
      expect(
        await refusal(
          members.groupMember({
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-10-25',
            until: '2026-10-25',
            endedBy: 'undone' as never,
            endedByMoveId: move,
          }),
        ),
      ).toMatchObject({ constraint: 'group_memberships_insert_ended' });
      const grouped = await members.groupMember({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-10-25',
      });
      // An undo of a move that is not undone is refused (0051); one of an
      // undone move that did not write the row too (0050).
      expect(
        await refusal(
          database.migrator
            .updateTable('group_memberships')
            .set({ valid_until: '2026-10-25', ended_by: 'undone', ended_by_move_id: move })
            .where('id', '=', grouped)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'memberships_move_end' });
      const past = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-07',
        fromClassId: oxford,
        toClassId: await classes.schoolClass(north, northYear),
      });
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('student_moves')
          .set({ undone_at: new Date(NOW), reason: 'Typed by mistake' })
          .where('id', '=', past)
          .execute(),
      );
      expect(
        await refusal(
          database.migrator
            .updateTable('group_memberships')
            .set({ valid_until: '2026-10-25', ended_by: 'undone', ended_by_move_id: past })
            .where('id', '=', grouped)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'group_memberships_move' });
    });

    it('keeps the checks of the move columns', async () => {
      const { oxford, yale, student, row, move } = await moved();
      // An undone row is empty: a student with no class, a past move undone.
      const loose = await members.student(north, { startsOn: '2026-09-01' });
      const past = await members.move({
        branch: north,
        studentId: loose,
        from: '2026-10-07',
        fromClassId: oxford,
        toClassId: yale,
      });
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('student_moves')
          .set({ undone_at: new Date(NOW), reason: 'Typed by mistake' })
          .where('id', '=', past)
          .execute(),
      );
      const written = await members.member({
        branch: north,
        classId: yale,
        studentId: loose,
        from: '2026-11-01',
        ownUntil: '2026-11-10',
        cause: 'transfer',
        writtenByMoveId: past,
      });
      expect(
        await refusal(
          database.migrator
            .updateTable('class_memberships')
            .set({ valid_until: '2026-11-05', ended_by: 'undone', ended_by_move_id: past })
            .where('id', '=', written)
            .execute(),
        ),
      ).toMatchObject({ code: '23514' });
      // A move named without an end by a move.
      expect(
        await refusal(
          database.migrator
            .updateTable('class_memberships')
            .set({ ended_by_move_id: move })
            .where('id', '=', row)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'class_memberships_move_check' });
      const group = await classes.group(north, northYear, maths, [oxford]);
      const grouped = await members.groupMember({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-11-01',
        until: '2026-11-10',
        ownUntil: '2026-11-10',
      });
      expect(
        await refusal(
          database.migrator
            .updateTable('group_memberships')
            .set({ ended_by_move_id: move })
            .where('id', '=', grouped)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'group_memberships_move_check' });
      expect(
        await refusal(
          members.groupMember({
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-12-01',
            cause: 'transfer',
          }),
        ),
      ).toMatchObject({ constraint: 'group_memberships_written_check' });
      // A leaving names a cancel; a reason belongs to an undo.
      const other = await moved();
      const leaving = await members.leaving(database.migrator, north, loose, '2027-01-04');
      expect(
        await refusal(
          database.migrator
            .updateTable('student_moves')
            .set({ cancelled_by_leaving_id: leaving })
            .where('id', '=', other.move)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'student_moves_leaving_check' });
      expect(
        await refusal(
          database.migrator
            .updateTable('student_moves')
            .set({ reason: 'Typed by mistake' })
            .where('id', '=', other.move)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'student_moves_reason_undo_check' });
    });

    // Should-fix 1: a move ends a row only on its date, and only while live.
    it('refuses an end by a move at another date, or by a cancelled move', async () => {
      const { row, move } = await moved();
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('class_memberships')
              .set({ valid_until: '2026-10-18', ended_by: 'transfer', ended_by_move_id: move })
              .where('id', '=', row)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'memberships_move_end' });
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('student_moves')
          .set({ cancelled_at: new Date(NOW) })
          .where('id', '=', move)
          .execute(),
      );
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('class_memberships')
              .set({ valid_until: '2026-10-20', ended_by: 'transfer', ended_by_move_id: move })
              .where('id', '=', row)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'memberships_move_end' });
    });
  });
});
