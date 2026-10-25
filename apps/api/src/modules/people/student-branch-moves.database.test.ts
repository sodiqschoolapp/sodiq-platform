import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { MembersKit } from '../../testing/members-kit.js';
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

/**
 * The tables whose key names the student with its branch go with the student
 * (decision 15 of pull request #67, decision 7 of pull request #97); the
 * class rows, group rows and moves keep the branch of their classes and
 * groups (decision 16 of pull request #89). A new table that references the
 * student fails the first test until it is named in one list.
 */
const CARRIED = [
  'student_accounts',
  'student_branch_moves',
  'student_contracts',
  'student_relatives',
  'student_statuses',
  'student_uids',
];
/**
 * Task 6.1a: a journal cell keeps the branch of its lesson, as a class row
 * keeps the branch of its class.
 */
const KEPT = [
  'class_memberships',
  // Task 8.5 (decision 3): an exemption stays in the branch of its lessons; the
  // receiving branch gets an offer, written in its own branch at the accept.
  'exemption_move_offers',
  'exemptions',
  'group_memberships',
  'journal_cells',
  // Task 8.2: a comment stays in the branch of its lesson, a rating entry in its journal's.
  'journal_comments',
  'journal_rating_entries',
  // Task 9.2a: a decision on a flagged result stays in the branch of its quarter.
  'quarter_result_decisions',
  // Task 6.3: a reason of absence stays in the branch of its date.
  'student_absence_reasons',
  'student_moves',
];
/**
 * The tables whose key names the student under another column follow the
 * record by that key: the merges kept on the record (`kept_id`, task 3.3d,
 * pull request #98).
 */
const FOLLOWING = ['student_merges'];

// The rules of the move to another branch that the database itself keeps
// (db/migrations/0053, task 3.3c, pull request #97): the release record and
// its states (correction 2), the guarded branch of the student (decision 4),
// the cascade (decision 7, must-fix 5), the ends a branch move writes
// (decision 5, correction 1), the status guard (decision 12) and the three
// readers past the filter (decisions 1 to 3). All names are invented.
describe('branch moves in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let members: MembersKit;
  let north: string;
  let south: string;
  let east: string;
  let northYear: string;
  let southYear: string;
  let eastYear: string;
  let english: string;

  const inBranches = <T>(branches: string[], work: (transaction: Transaction) => Promise<T>) =>
    transactions.run(branches, work);

  /**
   * A student of 7 Oxford of the North branch from 1 September with a group
   * of English, and a 7 Yale of the South branch with a group of English.
   */
  async function pupil() {
    const oxford = await classes.schoolClass(north, northYear);
    const northGroup = await classes.group(north, northYear, english, [oxford]);
    const yale = await classes.schoolClass(south, southYear);
    const southGroup = await classes.group(south, southYear, english, [yale]);
    const student = await members.student(north, { startsOn: '2026-09-01' });
    // The class row and its group row in one transaction (0049, at the commit).
    const { row, groupRow } = await database.migrator
      .transaction()
      .execute(async (transaction) => ({
        row: await members.member(
          { branch: north, classId: oxford, studentId: student, from: '2026-09-01' },
          transaction,
        ),
        groupRow: await members.groupMember(
          {
            branch: north,
            groupId: northGroup,
            subjectId: english,
            studentId: student,
            from: '2026-09-01',
          },
          transaction,
        ),
      }));
    return { oxford, northGroup, yale, southGroup, student, row, groupRow };
  }

  /** A release written as the service writes it, in the sending branch's transaction. */
  function release(
    student: string,
    input: { from?: string; to?: string; db?: Transaction } = {},
  ): Promise<string> {
    const write = async (transaction: Transaction) => {
      const row = await transaction
        .insertInto('student_branch_moves')
        .values({
          branch_id: north,
          student_id: student,
          from_branch_id: north,
          to_branch_id: input.to ?? south,
          effective_on: input.from ?? '2026-10-14',
          released_at: new Date(NOW),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    };
    return input.db === undefined ? inBranches([north], write) : write(input.db);
  }

  /**
   * The writes of an accept, in the order of the service: the release
   * accepted, the old rows cut at the date, the branch changed, the new class
   * row and its group row from the date.
   */
  async function acceptWrites(
    transaction: Transaction,
    input: {
      move: string;
      student: string;
      row: string;
      groupRow: string;
      yale: string;
      southGroup: string;
      from?: string;
    },
  ): Promise<void> {
    const from = input.from ?? '2026-10-14';
    await transaction
      .updateTable('student_branch_moves')
      .set({ accepted_at: new Date(NOW) })
      .where('id', '=', input.move)
      .execute();
    await transaction
      .updateTable('class_memberships')
      .set({ valid_until: from, ended_by: 'branch_move', ended_by_branch_move_id: input.move })
      .where('id', '=', input.row)
      .execute();
    await transaction
      .updateTable('group_memberships')
      .set({ valid_until: from, ended_by: 'branch_move', ended_by_branch_move_id: input.move })
      .where('id', '=', input.groupRow)
      .execute();
    await transaction
      .updateTable('students')
      .set({ branch_id: south })
      .where('id', '=', input.student)
      .execute();
    await transaction
      .insertInto('class_memberships')
      .values({
        branch_id: south,
        student_id: input.student,
        class_id: input.yale,
        valid_from: from,
        valid_until: '2027-06-01',
        own_until: '2027-06-01',
        cause: 'branch_move',
      })
      .execute();
    await transaction
      .insertInto('group_memberships')
      .values({
        branch_id: south,
        student_id: input.student,
        group_id: input.southGroup,
        subject_id: english,
        valid_from: from,
        valid_until: '2027-06-01',
        own_until: '2027-06-01',
        cause: 'branch_move',
      })
      .execute();
  }

  /** A pupil released and accepted by the receiving branch's transaction, joined to the sending one. */
  async function moved() {
    const facts = await pupil();
    const move = await release(facts.student);
    await inBranches([south, north], (transaction) =>
      acceptWrites(transaction, { ...facts, move }),
    );
    return { ...facts, move };
  }

  const branchOf = async (table: string, student: string): Promise<string[]> => {
    const found = await sql<{ branch_id: string }>`
      select distinct branch_id from ${sql.table(table)} where student_id = ${student}::uuid
    `.execute(database.migrator);
    return found.rows.map((row) => row.branch_id);
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    classes = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    east = await insertBranch(database.migrator, 'East');
    northYear = await classes.year(north);
    southYear = await classes.year(south);
    eastYear = await classes.year(east);
    english = await classes.subject({ grades: [7, 8] });
    members = new MembersKit(database.migrator, await classes.account());
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the accept', () => {
    it('names every table that references the student as carried or kept', async () => {
      const found = await sql<{ table: string }>`
        select distinct c.conrelid::regclass::text as table
        from pg_constraint c
        where c.contype = 'f' and c.confrelid = 'public.students'::regclass
        order by 1
      `.execute(database.migrator);
      expect(found.rows.map((row) => row.table)).toEqual(
        [...CARRIED, ...KEPT, ...FOLLOWING].sort(),
      );
    });

    it('keeps a reason of absence in the branch of its date (task 6.3, spec review of the plan, must-fix 6)', async () => {
      const facts = await pupil();
      await database.migrator.transaction().execute(async (transaction) => {
        await sql`select set_config('app.now', ${NOW}, true)`.execute(transaction);
        await transaction
          .insertInto('student_absence_reasons')
          .values({
            branch_id: north,
            student_id: facts.student,
            absence_date: '2026-10-12',
            category: 'illness',
            note: '',
            changed_by: await classes.account(),
            changed_at: new Date(NOW),
          })
          .execute();
      });
      const move = await release(facts.student);
      await inBranches([south, north], (transaction) =>
        acceptWrites(transaction, { ...facts, move }),
      );
      expect(await branchOf('student_absence_reasons', facts.student)).toEqual([north]);
    });

    it('keeps a journal cell in the branch of its lesson (task 6.1a)', async () => {
      const cells = await CellsKit.create(database.migrator);
      const facts = await pupil();
      const lesson = await cells.lesson(north, northYear, facts.oxford, '2026-10-12');
      await cells.cell(north, {
        lessonId: lesson,
        studentId: facts.student,
        mark: 1,
        by: await classes.account(),
        at: NOW,
      });
      const move = await release(facts.student);
      await inBranches([south, north], (transaction) =>
        acceptWrites(transaction, { ...facts, move }),
      );
      expect(await branchOf('journal_cells', facts.student)).toEqual([north]);
      const students = await database.migrator
        .selectFrom('students')
        .select('branch_id')
        .where('id', '=', facts.student)
        .executeTakeFirstOrThrow();
      expect(students.branch_id).toBe(south);
    });

    it('commits through every deferred check for the receiving branch joined to the sending one', async () => {
      const { student, row, groupRow, move } = await moved();
      for (const table of CARRIED) {
        expect((await branchOf(table, student)).filter((branch) => branch !== south)).toEqual([]);
      }
      // The kit writes no account; every other carried table holds rows.
      for (const table of CARRIED.filter((one) => one !== 'student_accounts')) {
        expect(await branchOf(table, student)).toEqual([south]);
      }
      const students = await database.migrator
        .selectFrom('students')
        .select('branch_id')
        .where('id', '=', student)
        .executeTakeFirstOrThrow();
      expect(students.branch_id).toBe(south);
      // The kit writes no move and no cell (the cell has its own test above); the
      // rows it writes are in both branches.
      for (const table of KEPT.filter(
        (one) =>
          one !== 'student_moves' &&
          one !== 'journal_cells' &&
          one !== 'journal_comments' &&
          one !== 'journal_rating_entries' &&
          one !== 'quarter_result_decisions' &&
          one !== 'student_absence_reasons' &&
          one !== 'exemptions' &&
          one !== 'exemption_move_offers',
      )) {
        expect((await branchOf(table, student)).sort()).toEqual([north, south].sort());
      }
      expect(await members.rowOf(row)).toMatchObject({
        valid_until: '2026-10-14',
        ended_by: 'branch_move',
        branch_id: north,
      });
      expect(await members.groupRowOf(groupRow)).toMatchObject({
        valid_until: '2026-10-14',
        ended_by: 'branch_move',
      });
      const stored = await database.migrator
        .selectFrom('student_branch_moves')
        .select(['branch_id', 'accepted_at'])
        .where('id', '=', move)
        .executeTakeFirstOrThrow();
      expect(stored.branch_id).toBe(south);
      expect(stored.accepted_at).not.toBeNull();
      // The new branch sees the record; the old one no longer does.
      const seen = (branch: string) =>
        inBranches([branch], (transaction) =>
          transaction.selectFrom('students').select('id').where('id', '=', student).execute(),
        );
      expect(await seen(south)).toHaveLength(1);
      expect(await seen(north)).toEqual([]);
    });

    it('cannot accept without the join: the receiving branch alone reaches no row, the sending one is refused', async () => {
      const facts = await pupil();
      const move = await release(facts.student);
      const changed = await inBranches([south], async (transaction) => {
        const accepted = await transaction
          .updateTable('student_branch_moves')
          .set({ accepted_at: new Date(NOW) })
          .where('id', '=', move)
          .executeTakeFirst();
        const branch = await transaction
          .updateTable('students')
          .set({ branch_id: south })
          .where('id', '=', facts.student)
          .executeTakeFirst();
        return [accepted.numUpdatedRows, branch.numUpdatedRows];
      });
      expect(changed).toEqual([0n, 0n]);
      expect(
        await refusal(
          inBranches([north], (transaction) =>
            transaction
              .updateTable('student_branch_moves')
              .set({ accepted_at: new Date(NOW) })
              .where('id', '=', move)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'student_branch_moves_side' });
      // Nothing changed.
      const stored = await database.migrator
        .selectFrom('students')
        .select('branch_id')
        .where('id', '=', facts.student)
        .executeTakeFirstOrThrow();
      expect(stored.branch_id).toBe(north);
    });

    it('refuses a new class row of the branch move with no move accepted in the transaction', async () => {
      const facts = await pupil();
      await release(facts.student);
      expect(
        await refusal(
          database.migrator
            .insertInto('class_memberships')
            .values({
              branch_id: north,
              student_id: facts.student,
              class_id: facts.oxford,
              valid_from: '2026-10-20',
              valid_until: '2027-06-01',
              own_until: '2027-06-01',
              cause: 'branch_move',
            })
            .execute(),
        ),
      ).toMatchObject({ constraint: 'memberships_branch_move' });
    });
  });

  describe('the branch of the student', () => {
    const setBranch = (db: Transaction | TestDatabase['migrator'], student: string, to: string) =>
      db.updateTable('students').set({ branch_id: to }).where('id', '=', student).execute();

    it('changes with no move, with an open one, or towards another branch than the target: refused', async () => {
      const { student, move } = await (async () => {
        const facts = await pupil();
        return { ...facts, move: await release(facts.student) };
      })();
      expect(await refusal(setBranch(database.migrator, student, south))).toMatchObject({
        constraint: 'students_branch_move',
      });
      expect(
        await refusal(
          inBranches([north, south, east], async (transaction) => {
            await transaction
              .updateTable('student_branch_moves')
              .set({ accepted_at: new Date(NOW) })
              .where('id', '=', move)
              .execute();
            await setBranch(transaction, student, east);
          }),
        ),
      ).toMatchObject({ constraint: 'students_branch_move' });
    });

    it('changes only in the transaction that accepted the move', async () => {
      const facts = await pupil();
      const move = await release(facts.student);
      // Accepted with nothing else written: the class rows stay, which the
      // later change of branch would leave in the old branch.
      await inBranches([north, south], (transaction) =>
        transaction
          .updateTable('student_branch_moves')
          .set({ accepted_at: new Date(NOW) })
          .where('id', '=', move)
          .execute(),
      );
      expect(
        await refusal(
          inBranches([north, south], (transaction) => setBranch(transaction, facts.student, south)),
        ),
      ).toMatchObject({ constraint: 'students_branch_move' });
    });

    it('carries a declined release and the moves of an earlier branch move with the student', async () => {
      const facts = await pupil();
      const declined = await release(facts.student);
      await inBranches([south, north], (transaction) =>
        transaction
          .updateTable('student_branch_moves')
          .set({ declined_at: new Date(NOW), decline_reason: 'No seat this term' })
          .where('id', '=', declined)
          .execute(),
      );
      const move = await release(facts.student);
      await inBranches([south, north], (transaction) =>
        acceptWrites(transaction, { ...facts, move }),
      );
      // A second move, South to East, carries both rows on.
      const eastClass = await classes.schoolClass(east, eastYear);
      const eastGroup = await classes.group(east, eastYear, english, [eastClass]);
      const second = await inBranches([south], async (transaction) => {
        const row = await transaction
          .insertInto('student_branch_moves')
          .values({
            branch_id: south,
            student_id: facts.student,
            from_branch_id: south,
            to_branch_id: east,
            effective_on: '2026-10-14',
            released_at: new Date(NOW),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return row.id;
      });
      // The rows of the first move begin on the same day and are emptied.
      const southRows = await database.migrator
        .selectFrom('class_memberships')
        .select('id')
        .where('student_id', '=', facts.student)
        .where('branch_id', '=', south)
        .execute();
      const southGroupRows = await database.migrator
        .selectFrom('group_memberships')
        .select('id')
        .where('student_id', '=', facts.student)
        .where('branch_id', '=', south)
        .execute();
      await inBranches([east, south], async (transaction) => {
        await transaction
          .updateTable('student_branch_moves')
          .set({ accepted_at: new Date(NOW) })
          .where('id', '=', second)
          .execute();
        for (const one of southRows) {
          await transaction
            .updateTable('class_memberships')
            .set({
              valid_until: '2026-10-14',
              ended_by: 'branch_move',
              ended_by_branch_move_id: second,
            })
            .where('id', '=', one.id)
            .execute();
        }
        for (const one of southGroupRows) {
          await transaction
            .updateTable('group_memberships')
            .set({
              valid_until: '2026-10-14',
              ended_by: 'branch_move',
              ended_by_branch_move_id: second,
            })
            .where('id', '=', one.id)
            .execute();
        }
        await setBranch(transaction, facts.student, east);
        await transaction
          .insertInto('class_memberships')
          .values({
            branch_id: east,
            student_id: facts.student,
            class_id: eastClass,
            valid_from: '2026-10-14',
            valid_until: '2027-06-01',
            own_until: '2027-06-01',
            cause: 'branch_move',
          })
          .execute();
        await transaction
          .insertInto('group_memberships')
          .values({
            branch_id: east,
            student_id: facts.student,
            group_id: eastGroup,
            subject_id: english,
            valid_from: '2026-10-14',
            valid_until: '2027-06-01',
            own_until: '2027-06-01',
            cause: 'branch_move',
          })
          .execute();
      });
      const rows = await database.migrator
        .selectFrom('student_branch_moves')
        .select(['id', 'branch_id'])
        .where('student_id', '=', facts.student)
        .execute();
      expect(rows.map((one) => one.branch_id)).toEqual([east, east, east]);
      expect(rows.map((one) => one.id).sort()).toEqual([declined, move, second].sort());
    });
  });

  describe('the release', () => {
    it('is written from its own branch, for a student of it, open, at the moment of the transaction', async () => {
      const facts = await pupil();
      expect(
        await refusal(
          inBranches([north, south], (transaction) =>
            transaction
              .insertInto('student_branch_moves')
              .values({
                branch_id: north,
                student_id: facts.student,
                from_branch_id: south,
                to_branch_id: east,
                effective_on: '2026-10-14',
                released_at: new Date(NOW),
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'student_branch_moves_student_branch' });
      expect(
        await refusal(
          inBranches([north], (transaction) =>
            transaction
              .insertInto('student_branch_moves')
              .values({
                branch_id: north,
                student_id: facts.student,
                from_branch_id: north,
                to_branch_id: south,
                effective_on: '2026-10-14',
                released_at: new Date('2026-10-13T10:00:00+05:00'),
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'student_branch_moves_state' });
      expect(
        await refusal(
          inBranches([north], (transaction) =>
            transaction
              .insertInto('student_branch_moves')
              .values({
                branch_id: north,
                student_id: facts.student,
                from_branch_id: north,
                to_branch_id: north,
                effective_on: '2026-10-14',
                released_at: new Date(NOW),
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'student_branch_moves_branches_check' });
    });

    it('is open once per student', async () => {
      const facts = await pupil();
      await release(facts.student);
      expect(await refusal(release(facts.student, { to: east }))).toMatchObject({
        constraint: 'student_branch_moves_open_idx',
      });
    });

    it('is closed once, by its own side, and accepted only from its date', async () => {
      const facts = await pupil();
      const later = await release(facts.student, { from: '2026-10-20' });
      const set = (
        branches: string[],
        values: {
          cancelled_at?: Date;
          declined_at?: Date;
          accepted_at?: Date;
          decline_reason?: string;
        },
        id = later,
      ) =>
        inBranches(branches, (transaction) =>
          transaction
            .updateTable('student_branch_moves')
            .set(values)
            .where('id', '=', id)
            .execute(),
        );
      expect(await refusal(set([south, north], { accepted_at: new Date(NOW) }))).toMatchObject({
        constraint: 'student_branch_moves_not_yet',
      });
      // Correction 2: a decline by the sending side, a cancel by the receiving side.
      expect(
        await refusal(set([north], { declined_at: new Date(NOW), decline_reason: 'No seat' })),
      ).toMatchObject({ constraint: 'student_branch_moves_side' });
      // The receiving branch's own transaction reaches no row of the sending one.
      const reached = await inBranches([south], async (transaction) => {
        const done = await transaction
          .updateTable('student_branch_moves')
          .set({ cancelled_at: new Date(NOW) })
          .where('id', '=', later)
          .executeTakeFirst();
        return done.numUpdatedRows;
      });
      expect(reached).toBe(0n);
      expect(
        await refusal(set([north], { cancelled_at: new Date('2026-10-13T10:00:00+05:00') })),
      ).toMatchObject({ constraint: 'student_branch_moves_state' });
      expect(await refusal(set([south, north], { declined_at: new Date(NOW) }))).toMatchObject({
        constraint: 'student_branch_moves_decline_check',
      });
      await set([north], { cancelled_at: new Date(NOW) });
      expect(
        await refusal(
          set([south, north], { declined_at: new Date(NOW), decline_reason: 'No seat' }),
        ),
      ).toMatchObject({ constraint: 'student_branch_moves_state' });
      expect(await refusal(set([north], { cancelled_at: new Date(NOW) }))).toMatchObject({
        constraint: 'student_branch_moves_state',
      });
    });

    it('lets the application delete no release', async () => {
      const facts = await pupil();
      const move = await release(facts.student);
      expect(
        await refusal(
          inBranches([north], (transaction) =>
            transaction.deleteFrom('student_branch_moves').where('id', '=', move).execute(),
          ),
        ),
      ).toMatchObject({ code: '42501' });
    });
  });

  describe('the ends a branch move writes', () => {
    const cut = (
      db: Transaction,
      table: 'class_memberships' | 'group_memberships',
      id: string,
      until: string,
      move: string,
    ) =>
      db
        .updateTable(table)
        .set({ valid_until: until, ended_by: 'branch_move', ended_by_branch_move_id: move })
        .where('id', '=', id)
        .execute();

    it('cuts a row only for a move accepted in the transaction, on its date', async () => {
      const facts = await pupil();
      const move = await release(facts.student);
      expect(
        await refusal(
          inBranches([north], (transaction) =>
            cut(transaction, 'class_memberships', facts.row, '2026-10-14', move),
          ),
        ),
      ).toMatchObject({ constraint: 'memberships_branch_move' });
      expect(
        await refusal(
          inBranches([north, south], async (transaction) => {
            await transaction
              .updateTable('student_branch_moves')
              .set({ accepted_at: new Date(NOW) })
              .where('id', '=', move)
              .execute();
            await cut(transaction, 'group_memberships', facts.groupRow, '2026-10-13', move);
          }),
        ),
      ).toMatchObject({ constraint: 'memberships_branch_move' });
    });

    it('empties a planned row that starts after the date', async () => {
      // 7 Oxford with its group until 20 October, then a planned 7 Cambridge.
      const oxford = await classes.schoolClass(north, northYear);
      const northGroup = await classes.group(north, northYear, english, [oxford]);
      const cambridge = await classes.schoolClass(north, northYear);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const facts = await database.migrator.transaction().execute(async (transaction) => ({
        student,
        row: await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: student,
            from: '2026-09-01',
            ownUntil: '2026-10-20',
          },
          transaction,
        ),
        groupRow: await members.groupMember(
          {
            branch: north,
            groupId: northGroup,
            subjectId: english,
            studentId: student,
            from: '2026-09-01',
            ownUntil: '2026-10-20',
          },
          transaction,
        ),
      }));
      const planned = await members.member({
        branch: north,
        classId: cambridge,
        studentId: student,
        from: '2026-10-20',
      });
      const move = await release(facts.student);
      // Written, then rolled back: the accept's other writes are not the point here.
      expect(
        await refusal(
          inBranches([north, south], async (transaction) => {
            await transaction
              .updateTable('student_branch_moves')
              .set({ accepted_at: new Date(NOW) })
              .where('id', '=', move)
              .execute();
            await cut(transaction, 'class_memberships', facts.row, '2026-10-14', move);
            await cut(transaction, 'group_memberships', facts.groupRow, '2026-10-14', move);
            await cut(transaction, 'class_memberships', planned, '2026-10-20', move);
            const emptied = await transaction
              .selectFrom('class_memberships')
              .select(['valid_from', 'valid_until'])
              .where('id', '=', planned)
              .executeTakeFirstOrThrow();
            expect(emptied).toEqual({ valid_from: '2026-10-20', valid_until: '2026-10-20' });
            throw Object.assign(new Error('rolled back'), { constraint: 'rolled_back' });
          }),
        ),
      ).toMatchObject({ constraint: 'rolled_back' });
    });

    it('never inserts a row ended by a branch move, and never ends such a row again or gives it back', async () => {
      const { row, groupRow } = await moved();
      expect(
        await refusal(
          database.migrator
            .updateTable('class_memberships')
            .set({ valid_until: '2026-10-10' })
            .where('id', '=', row)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'memberships_branch_move' });
      expect(
        await refusal(
          database.migrator
            .updateTable('group_memberships')
            .set({ ended_by: null, ended_by_branch_move_id: null })
            .where('id', '=', groupRow)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'group_memberships_only_shrink' });
      const facts = await pupil();
      const move = await release(facts.student);
      expect(
        await refusal(
          database.migrator
            .insertInto('class_memberships')
            .values({
              branch_id: north,
              student_id: facts.student,
              class_id: facts.oxford,
              valid_from: '2026-06-01',
              valid_until: '2026-06-01',
              own_until: '2026-06-02',
              cause: 'placement',
              ended_by: 'branch_move',
              ended_by_branch_move_id: move,
            })
            .execute(),
        ),
      ).toMatchObject({ constraint: 'memberships_branch_move' });
    });
  });

  describe('the status rows after a move', () => {
    it('refuses a status that begins or ends before the date of an accepted move', async () => {
      const facts = await pupil();
      const move = await release(facts.student, { from: '2026-10-12' });
      await inBranches([south, north], (transaction) =>
        acceptWrites(transaction, { ...facts, move, from: '2026-10-12' }),
      );
      expect(
        await refusal(
          inBranches([south], (transaction) =>
            members.leaving(transaction, south, facts.student, '2026-10-05'),
          ),
        ),
      ).toMatchObject({ constraint: 'student_statuses_before_branch_move' });
      // On the date, a leaving of the new branch is written (rolled back here).
      expect(
        await refusal(
          inBranches([south], async (transaction) => {
            await members.leaving(transaction, south, facts.student, '2026-10-12');
            throw Object.assign(new Error('rolled back'), { constraint: 'rolled_back' });
          }),
        ),
      ).toMatchObject({ constraint: 'rolled_back' });
    });
  });

  // The spec review of the build, must-fix 2: each refused branch of the
  // guards of 0053, reached with nothing earlier that refuses it.
  describe('every refusal of the guards, on its own', () => {
    const accepting = (transaction: Transaction, move: string) =>
      transaction
        .updateTable('student_branch_moves')
        .set({ accepted_at: new Date(NOW) })
        .where('id', '=', move)
        .execute();

    it('keeps a row a branch move ended from being ended another way', async () => {
      const { student, row } = await moved();
      const status = await database.migrator
        .selectFrom('student_statuses')
        .select('id')
        .where('student_id', '=', student)
        .executeTakeFirstOrThrow();
      expect(
        await refusal(
          database.migrator
            .updateTable('class_memberships')
            .set({
              ended_by: 'leaving',
              ended_by_branch_move_id: null,
              leaving_id: status.id,
            })
            .where('id', '=', row)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'class_memberships_only_shrink' });
    });

    it('writes a class row of a branch move only from the date of the move accepted, into its target', async () => {
      const facts = await pupil();
      const move = await release(facts.student);
      const insert = (transaction: Transaction, branch: string, classId: string, from: string) =>
        transaction
          .insertInto('class_memberships')
          .values({
            branch_id: branch,
            student_id: facts.student,
            class_id: classId,
            valid_from: from,
            valid_until: '2027-06-01',
            own_until: '2027-06-01',
            cause: 'branch_move',
          })
          .execute();
      expect(
        await refusal(
          inBranches([south, north], async (transaction) => {
            await accepting(transaction, move);
            await insert(transaction, south, facts.yale, '2026-10-20');
          }),
        ),
      ).toMatchObject({ constraint: 'memberships_branch_move' });
      expect(
        await refusal(
          inBranches([south, north], async (transaction) => {
            await accepting(transaction, move);
            await insert(transaction, north, facts.oxford, '2026-10-14');
          }),
        ),
      ).toMatchObject({ constraint: 'memberships_branch_move' });
    });

    it('cuts a row only for a move of its own student from its own branch, and empties only a row from the date on', async () => {
      const one = await pupil();
      const other = await pupil();
      const move = await release(one.student);
      const otherMove = await release(other.student);
      const cut = (transaction: Transaction, id: string, until: string, by: string) =>
        transaction
          .updateTable('class_memberships')
          .set({ valid_until: until, ended_by: 'branch_move', ended_by_branch_move_id: by })
          .where('id', '=', id)
          .execute();
      expect(
        await refusal(
          inBranches([south, north], async (transaction) => {
            await accepting(transaction, otherMove);
            await cut(transaction, one.row, '2026-10-14', otherMove);
          }),
        ),
      ).toMatchObject({ constraint: 'memberships_branch_move' });
      // The row starts on 1 September: emptied, it would end before the date.
      expect(
        await refusal(
          inBranches([south, north], async (transaction) => {
            await accepting(transaction, move);
            await cut(transaction, one.row, '2026-09-01', move);
          }),
        ),
      ).toMatchObject({ constraint: 'memberships_branch_move' });
    });

    it('refuses a status inserted, or a status end moved, before the date of an accepted move', async () => {
      const facts = await moved();
      expect(
        await refusal(
          database.migrator
            .insertInto('student_statuses')
            .values({
              student_id: facts.student,
              branch_id: south,
              status: 'inactive',
              valid_from: '2026-10-05',
              valid_until: '2026-10-05',
              cause: 'cancel',
            })
            .execute(),
        ),
      ).toMatchObject({ constraint: 'student_statuses_before_branch_move' });
      expect(
        await refusal(
          database.migrator
            .updateTable('student_statuses')
            .set({ valid_until: '2026-10-05' })
            .where('student_id', '=', facts.student)
            .where('valid_until', 'is', null)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'student_statuses_before_branch_move' });
    });

    it('writes an accept and a decline only at the moment of the transaction', async () => {
      const facts = await pupil();
      const move = await release(facts.student);
      const yesterday = new Date('2026-10-13T10:00:00+05:00');
      for (const values of [
        { accepted_at: yesterday },
        { declined_at: yesterday, decline_reason: 'No seat' },
      ]) {
        expect(
          await refusal(
            inBranches([south, north], (transaction) =>
              transaction
                .updateTable('student_branch_moves')
                .set(values)
                .where('id', '=', move)
                .execute(),
            ),
          ),
        ).toMatchObject({ constraint: 'student_branch_moves_state' });
      }
    });

    it('refuses a release from a branch the student is not of', async () => {
      const facts = await pupil();
      expect(
        await refusal(
          inBranches([south], (transaction) =>
            transaction
              .insertInto('student_branch_moves')
              .values({
                branch_id: south,
                student_id: facts.student,
                from_branch_id: south,
                to_branch_id: east,
                effective_on: '2026-10-14',
                released_at: new Date(NOW),
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'student_branch_moves_student_branch' });
    });

    it('refuses the other writes of an accept without the join, as the receiving branch alone', async () => {
      const facts = await pupil();
      await release(facts.student);
      const changed = await inBranches([south], async (transaction) => {
        const cut = await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-14' })
          .where('id', '=', facts.row)
          .executeTakeFirst();
        return cut.numUpdatedRows;
      });
      expect(changed).toBe(0n);
      expect(
        await refusal(
          inBranches([south], (transaction) =>
            transaction
              .insertInto('class_memberships')
              .values({
                branch_id: south,
                student_id: facts.student,
                class_id: facts.yale,
                valid_from: '2026-10-14',
                valid_until: '2027-06-01',
                own_until: '2027-06-01',
                cause: 'branch_move',
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'memberships_branch_move' });
    });
  });

  describe('the readers past the filter', () => {
    it('lists the open releases to the branch named, only when the transaction holds it', async () => {
      const facts = await pupil();
      const move = await release(facts.student);
      const incoming = (branches: string[], branch: string) =>
        inBranches(branches, async (transaction) => {
          const found = await sql<{ id: string; uid: string }>`
            select id, uid from branch_moves_incoming(${branch}::uuid)
          `.execute(transaction);
          return found.rows.map((row) => row.id);
        });
      expect(await incoming([south], south)).toContain(move);
      expect(await incoming([north], south)).toEqual([]);
      // The Super Admin's transaction holds every branch: the branch named decides.
      expect(await incoming([north, south, east], east)).not.toContain(move);
      expect(await incoming([north, south, east], south)).toContain(move);
    });

    it('answers the sending branch of an open release to the branch named only', async () => {
      const facts = await pupil();
      const move = await release(facts.student);
      const sending = (branches: string[], branch: string, id = move) =>
        inBranches(branches, async (transaction) => {
          const found = await sql<{ student_id: string; from_branch_id: string }>`
            select student_id, from_branch_id from branch_move_sending(${id}::uuid, ${branch}::uuid)
          `.execute(transaction);
          return found.rows;
        });
      expect(await sending([south], south)).toEqual([
        { student_id: facts.student, from_branch_id: north },
      ]);
      expect(await sending([south], east)).toEqual([]);
      expect(await sending([north, south, east], east)).toEqual([]);
      await inBranches([north], (transaction) =>
        transaction
          .updateTable('student_branch_moves')
          .set({ cancelled_at: new Date(NOW) })
          .where('id', '=', move)
          .execute(),
      );
      expect(await sending([south], south)).toEqual([]);
    });

    it('answers the rows of other branches for a student of the branch named only', async () => {
      const { student, row, groupRow } = await moved();
      const elsewhere = (branches: string[], branch: string) =>
        inBranches(branches, async (transaction) => {
          const found = await sql<{ kind: string; data: { id: string; name: string } }>`
            select kind, data from student_rows_elsewhere(${student}::uuid, ${branch}::uuid)
          `.execute(transaction);
          return found.rows.map((one) => `${one.kind}:${one.data.id}`).sort();
        });
      const expected = [`class:${row}`, `group:${groupRow}`].sort();
      expect(await elsewhere([south], south)).toEqual(expected);
      expect(await elsewhere([north, south, east], south)).toEqual(expected);
      // The student is not of these branches.
      expect(await elsewhere([north], north)).toEqual([]);
      expect(await elsewhere([north, south, east], east)).toEqual([]);
    });

    // Permission review of task 3.5c, should-fix 4: the keys each kind
    // answers are pinned, so that a field added later is read for personal
    // data before it reaches another branch.
    it('answers ids, names, dates, causes, ends and links only', async () => {
      const facts = await pupil();
      const other = await classes.schoolClass(north, northYear);
      await members.move({
        branch: north,
        studentId: facts.student,
        from: '2026-10-20',
        fromClassId: facts.oxford,
        toClassId: other,
      });
      const move = await release(facts.student);
      await inBranches([south, north], (transaction) =>
        acceptWrites(transaction, { ...facts, move }),
      );
      const keys = await inBranches([south], async (transaction) => {
        const found = await sql<{ kind: string; data: Record<string, unknown> }>`
          select kind, data from student_rows_elsewhere(${facts.student}::uuid, ${south}::uuid)
        `.execute(transaction);
        return Object.fromEntries(
          found.rows.map((one) => [one.kind, Object.keys(one.data).sort()]),
        );
      });
      expect(keys).toEqual({
        class: [
          'branchId',
          'cause',
          'classId',
          'endedBy',
          'grade',
          'id',
          'name',
          'validFrom',
          'validUntil',
          'writtenByMoveId',
        ],
        group: [
          'branchId',
          'cause',
          'endedBy',
          'groupId',
          'id',
          'name',
          'subjectId',
          'validFrom',
          'validUntil',
          'writtenByMoveId',
        ],
        move: [
          'branchId',
          'cancelled',
          'cancelledByLeaving',
          'effectiveOn',
          'fromClass',
          'fromGroup',
          'id',
          'kind',
          'madeAt',
          'replacesMoveId',
          'subjectId',
          'toClass',
          'toGroup',
          'undone',
        ],
      });
    });
  });
});
