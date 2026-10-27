import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { MembersKit, moveStudentBranch } from '../../testing/members-kit.js';
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
 * What a merge does with each table that references the student (task 3.3d,
 * pull request #98): carried to the kept record (or left behind on the merge
 * row), or following the kept record. A later table that references the
 * student (8.5, the journal) fails the first test until it is named here and
 * the merge carries it.
 */
const MERGE_DOES: Readonly<
  Record<string, 'carried' | 'left behind' | 'follows' | 'released' | 'refused'>
> = {
  class_memberships: 'carried',
  // Task 8.5: exemptions and their move offers go to the kept record, each staying
  // in the branch of its lessons; two that overlap refuse the merge by their exclusion.
  exemption_move_offers: 'carried',
  exemptions: 'carried',
  group_memberships: 'carried',
  // Task 8.6 (decision 8): the journal data goes to the kept record, each row staying in the
  // branch of its lesson; data of both records on one key refuses the merge.
  journal_cells: 'carried',
  journal_comments: 'carried',
  journal_rating_entries: 'carried',
  // Task 9.4a: the early-warning entries marked handled go to the kept record.
  early_warning_handled: 'carried',
  // Task 9.2a: the decisions on flagged results go to the kept record; two of one quarter
  // and subject refuse the merge by their key.
  quarter_result_decisions: 'carried',
  // Task 9.2b: the final results of closed quarters go to the kept record; two of one close
  // and subject refuse the merge by their key.
  quarter_final_results: 'carried',
  // Task 6.3, correction 2: the reasons of absence go to the kept record.
  student_absence_reasons: 'carried',
  student_accounts: 'left behind',
  student_branch_moves: 'carried',
  student_contracts: 'carried',
  student_merges: 'follows',
  student_moves: 'carried',
  student_relatives: 'carried',
  student_statuses: 'carried',
  student_uids: 'released',
};

// The rules of the merge of two student records that the database itself
// keeps (db/migrations/0054, task 3.3d, pull request #98): the merge row and
// its chain, the merge paths of the guards (decision 2), the end `merge`,
// the removal of the merged record and the holder of a merged UID
// (decision 6). All names are invented.
describe('student merges in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let members: MembersKit;
  let account: string;
  let north: string;
  let south: string;
  let northYear: string;
  let english: string;

  const inBranches = <T>(branches: string[], work: (transaction: Transaction) => Promise<T>) =>
    transactions.run(branches, work);
  const everywhere = <T>(work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([north, south], work);

  /** The merge row as the service writes it first: `merged` into `kept`. */
  async function mergeRow(transaction: Transaction, kept: string, merged: string): Promise<string> {
    const pair = await transaction
      .selectFrom('students')
      .select(['id', 'uid', 'branch_id'])
      .where('id', 'in', [kept, merged])
      .execute();
    const of = (id: string) => {
      const found = pair.find((one) => one.id === id);
      if (found === undefined) {
        throw new Error('A record of the pair is not found.');
      }
      return found;
    };
    // Every row the merged record holds now, archived as the service does.
    const tables = [
      'student_statuses',
      'class_memberships',
      'group_memberships',
      'student_moves',
      'student_relatives',
      'student_accounts',
    ];
    const archive: Record<string, unknown[]> = {};
    for (const table of tables) {
      const found = await sql<{ row: unknown }>`
        select to_jsonb(r) as row from ${sql.table(table)} r where r.student_id = ${merged}::uuid
      `.execute(transaction);
      archive[table] = found.rows.map((one) => one.row);
    }
    const row = await transaction
      .insertInto('student_merges')
      .values({
        branch_id: of(kept).branch_id,
        kept_id: kept,
        merged_id: merged,
        merged_branch_id: of(merged).branch_id,
        kept_uid: of(kept).uid,
        merged_uid: of(merged).uid,
        merged_uids: [of(merged).uid],
        merged_record: JSON.stringify({ id: merged }),
        left_rows: JSON.stringify(archive),
        reason: 'Created twice by mistake',
        merged_by: account,
        merged_at: new Date(NOW),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /**
   * The removal of the merged record as the service does it last: its
   * contracts carried to the kept record (never left behind), then the delete.
   */
  async function removeMerged(transaction: Transaction, kept: string, merged: string) {
    const keptBranch = await transaction
      .selectFrom('students')
      .select('branch_id')
      .where('id', '=', kept)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable('student_contracts')
      .set({ student_id: kept, branch_id: keptBranch.branch_id })
      .where('student_id', '=', merged)
      .execute();
    await transaction.deleteFrom('students').where('id', '=', merged).execute();
  }

  const rowCount = async (table: string, column: string, value: string): Promise<number> => {
    const found = await sql<{ count: string }>`
      select count(*)::text as count from ${sql.table(table)} where ${sql.ref(column)} = ${value}::uuid
    `.execute(database.migrator);
    return Number(found.rows[0]?.count ?? 0);
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    classes = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    northYear = await classes.year(north);
    await classes.year(south);
    english = await classes.subject({ grades: [7, 8] });
    account = await classes.account();
    members = new MembersKit(database.migrator, account);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('names what the merge does with every table that references the student', async () => {
    const found = await sql<{ table: string }>`
      select distinct c.conrelid::regclass::text as table
      from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'public.students'::regclass
      order by 1
    `.execute(database.migrator);
    expect(found.rows.map((row) => row.table)).toEqual(Object.keys(MERGE_DOES).sort());
  });

  // Task 8.5 (From 3.3d): the exemptions go to the kept record, or two that overlap refuse the merge.
  describe('the exemptions', () => {
    const exemption = (transaction: Transaction, student: string, from: string, until: string) =>
      transaction
        .insertInto('exemptions')
        .values({
          branch_id: north,
          student_id: student,
          year_id: northYear,
          batch_id: '019a0000-0000-7000-8000-000000000009',
          kind: 'temporary',
          all_subjects: true,
          start_date: from,
          end_date: until,
          category: 'illness',
          detail: 'A certificate',
          granted_by: account,
          granted_at: new Date(0),
          version: 0,
          changed_at: new Date(0),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    const carry = (transaction: Transaction, kept: string, merged: string) =>
      transaction
        .updateTable('exemptions')
        .set({ student_id: kept })
        .where('student_id', '=', merged)
        .execute();

    it('carries an exemption to the kept record only with a merge of the two', async () => {
      const kept = await members.student(north);
      const merged = await members.student(north);
      const row = await inBranches([north], (transaction) =>
        exemption(transaction, merged, '2026-11-10', '2026-11-12'),
      );
      expect(
        await refusal(inBranches([north], (transaction) => carry(transaction, kept, merged))),
      ).toMatchObject({
        constraint: 'exemption_student',
      });
      await everywhere(async (transaction) => {
        await mergeRow(transaction, kept, merged);
        await carry(transaction, kept, merged);
      });
      const stored = await database.migrator
        .selectFrom('exemption_spans')
        .select('student_id')
        .where('exemption_id', '=', row.id)
        .execute();
      expect(stored.map((one) => one.student_id)).toEqual([kept]);
    });

    it('refuses a merge that would leave two overlapping exemptions', async () => {
      const kept = await members.student(north);
      const merged = await members.student(north);
      await inBranches([north], async (transaction) => {
        await exemption(transaction, kept, '2026-11-16', '2026-11-18');
        await exemption(transaction, merged, '2026-11-18', '2026-11-20');
      });
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, kept, merged);
            await carry(transaction, kept, merged);
          }),
        ),
      ).toMatchObject({ constraint: 'exemption_spans_no_overlap' });
    });
  });

  describe('the merge row', () => {
    it('is written for two records with their current UIDs at the moment of the transaction', async () => {
      const kept = await members.student(north);
      const merged = await members.student(south);
      expect(
        await refusal(
          everywhere((transaction) =>
            transaction
              .insertInto('student_merges')
              .values({
                branch_id: north,
                kept_id: kept,
                merged_id: merged,
                merged_branch_id: north,
                kept_uid: '2600000',
                merged_uid: '2600001',
                merged_uids: ['2600001'],
                merged_record: '{}',
                left_rows: '{}',
                reason: 'Created twice by mistake',
                merged_by: account,
                merged_at: new Date(NOW),
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'student_merges_state' });
      await everywhere((transaction) => mergeRow(transaction, kept, merged));
    });

    it('is final: no other column changes and it is never deleted', async () => {
      const kept = await members.student(north);
      const merged = await members.student(north);
      const id = await everywhere((transaction) => mergeRow(transaction, kept, merged));
      expect(
        await refusal(
          everywhere((transaction) =>
            transaction
              .updateTable('student_merges')
              .set({ kept_id: merged })
              .where('id', '=', id)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'student_merges_state' });
      expect(
        await refusal(
          everywhere((transaction) =>
            transaction.deleteFrom('student_merges').where('id', '=', id).execute(),
          ),
        ),
      ).toMatchObject({ code: '42501' });
    });

    it('names the latest kept record of a chain only through a merge of that record', async () => {
      const first = await members.student(north);
      const second = await members.student(north);
      const third = await members.student(north);
      const earlier = await everywhere((transaction) => mergeRow(transaction, second, first));
      // B merged into C: the merge of A into B now names C.
      await everywhere(async (transaction) => {
        await mergeRow(transaction, third, second);
        await transaction
          .updateTable('student_merges')
          .set({ kept_id: third })
          .where('id', '=', earlier)
          .execute();
      });
      const stored = await database.migrator
        .selectFrom('student_merges')
        .select('kept_id')
        .where('id', '=', earlier)
        .executeTakeFirstOrThrow();
      expect(stored.kept_id).toBe(third);
      // A merge of another pair does not open it.
      const fourth = await members.student(north);
      const fifth = await members.student(north);
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, fifth, fourth);
            await transaction
              .updateTable('student_merges')
              .set({ kept_id: fifth })
              .where('id', '=', earlier)
              .execute();
          }),
        ),
      ).toMatchObject({ constraint: 'student_merges_state' });
    });
  });

  describe('the guards with their merge path', () => {
    /** Two records of the North branch with a class row, a group row and a move each. */
    async function pair() {
      const oxford = await classes.schoolClass(north, northYear);
      const yale = await classes.schoolClass(north, northYear);
      const group = await classes.group(north, northYear, english, [oxford, yale]);
      const kept = await members.student(north, { startsOn: '2026-10-01' });
      const merged = await members.student(north, { startsOn: '2026-09-01' });
      const other = await members.student(north, { startsOn: '2026-09-01' });
      const move = await members.move({
        branch: north,
        studentId: merged,
        from: '2026-11-01',
        fromClassId: oxford,
        toClassId: yale,
      });
      const { row, groupRow } = await database.migrator
        .transaction()
        .execute(async (transaction) => ({
          row: await members.member(
            { branch: north, classId: oxford, studentId: merged, from: '2026-09-01' },
            transaction,
          ),
          groupRow: await members.groupMember(
            {
              branch: north,
              groupId: group,
              subjectId: english,
              studentId: merged,
              from: '2026-09-01',
            },
            transaction,
          ),
        }));
      const status = await database.migrator
        .selectFrom('student_statuses')
        .select('id')
        .where('student_id', '=', merged)
        .executeTakeFirstOrThrow();
      const contract = await database.migrator
        .selectFrom('student_contracts')
        .select('id')
        .where('student_id', '=', merged)
        .executeTakeFirstOrThrow();
      return { kept, merged, other, move, row, groupRow, status: status.id, contract: contract.id };
    }

    const CHANGES = [
      { table: 'student_statuses', key: 'status', constraint: 'dated_rows_only_shrink' },
      { table: 'student_contracts', key: 'contract', constraint: 'student_contracts_student' },
      { table: 'class_memberships', key: 'row', constraint: 'memberships_merge' },
      { table: 'group_memberships', key: 'groupRow', constraint: 'memberships_merge' },
      { table: 'student_moves', key: 'move', constraint: 'student_moves_state' },
    ] as const;

    for (const change of CHANGES) {
      it(`moves a row of ${change.table} to the other record only with a merge of that pair`, async () => {
        const facts = await pair();
        const carry = (transaction: Transaction) =>
          sql`
            update ${sql.table(change.table)} set student_id = ${facts.kept}::uuid
            where id = ${facts[change.key]}::uuid
          `.execute(transaction);
        expect(await refusal(everywhere(carry))).toMatchObject({
          constraint: change.constraint,
        });
        expect(
          await refusal(
            everywhere(async (transaction) => {
              await mergeRow(transaction, facts.other, facts.merged);
              await carry(transaction);
            }),
          ),
        ).toMatchObject({ constraint: change.constraint });
        // The pair's merge carries it. The rest of a merge (the cuts of the
        // other rows, the removal) is not written here: the transaction is
        // taken back once the row is carried, before the deferred checks.
        const carried = await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, facts.kept, facts.merged);
            if (change.table === 'student_statuses') {
              // The merged record's row ends where the kept record's begins.
              await transaction
                .updateTable('student_statuses')
                .set({ valid_until: '2026-10-01' })
                .where('id', '=', facts.status)
                .execute();
            }
            await carry(transaction);
            const found = await sql<{ student_id: string }>`
              select student_id from ${sql.table(change.table)} where id = ${facts[change.key]}::uuid
            `.execute(transaction);
            expect(found.rows).toEqual([{ student_id: facts.kept }]);
            throw new Error('carried');
          }),
        );
        expect(carried).toMatchObject({ message: 'carried' });
      });
    }

    it('moves a branch move to the other record only with a merge of that pair', async () => {
      const kept = await members.student(north);
      const merged = await members.student(north);
      const other = await members.student(north);
      const move = await inBranches([north], async (transaction) => {
        const row = await transaction
          .insertInto('student_branch_moves')
          .values({
            branch_id: north,
            student_id: merged,
            from_branch_id: north,
            to_branch_id: south,
            effective_on: '2026-11-01',
            released_at: new Date(NOW),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .updateTable('student_branch_moves')
          .set({ cancelled_at: new Date(NOW) })
          .where('id', '=', row.id)
          .execute();
        return row.id;
      });
      const carry = (transaction: Transaction) =>
        transaction
          .updateTable('student_branch_moves')
          .set({ student_id: kept })
          .where('id', '=', move)
          .execute();
      expect(await refusal(everywhere(carry))).toMatchObject({
        constraint: 'student_branch_moves_state',
      });
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, other, merged);
            await carry(transaction);
          }),
        ),
      ).toMatchObject({ constraint: 'student_branch_moves_state' });
      await everywhere(async (transaction) => {
        await mergeRow(transaction, kept, merged);
        await carry(transaction);
      });
      expect(await rowCount('student_branch_moves', 'student_id', kept)).toBe(1);
    });

    it('gives the kept record the merged record’s branch only, and only with its merge', async () => {
      const kept = await members.student(north);
      const merged = await members.student(south);
      const other = await members.student(north);
      const toSouth = (transaction: Transaction, id: string) =>
        transaction
          .updateTable('students')
          .set({ branch_id: south })
          .where('id', '=', id)
          .execute();
      expect(await refusal(everywhere((transaction) => toSouth(transaction, kept)))).toMatchObject({
        constraint: 'students_branch_move',
      });
      // A merge of the pair does not move the other record of the North branch.
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, kept, merged);
            await toSouth(transaction, other);
          }),
        ),
      ).toMatchObject({ constraint: 'students_branch_move' });
      // The merge row and every row of the kept record follow it to the South branch.
      await everywhere(async (transaction) => {
        await mergeRow(transaction, kept, merged);
        await toSouth(transaction, kept);
      });
      for (const table of ['student_statuses', 'student_contracts', 'student_uids']) {
        const found = await sql<{ branch_id: string }>`
          select distinct branch_id from ${sql.table(table)} where student_id = ${kept}::uuid
        `.execute(database.migrator);
        expect(found.rows.map((one) => one.branch_id)).toEqual([south]);
      }
      const merges = await database.migrator
        .selectFrom('student_merges')
        .select('branch_id')
        .where('kept_id', '=', kept)
        .execute();
      expect(merges.map((one) => one.branch_id)).toEqual([south]);
    });

    it('changes the start of a life only for the kept record of a merge', async () => {
      const kept = await members.student(north, { startsOn: '2026-09-15' });
      const merged = await members.student(north, { startsOn: '2026-09-01' });
      const start = (transaction: Transaction, id: string, day = '2026-09-01') =>
        transaction.updateTable('students').set({ starts_on: day }).where('id', '=', id).execute();
      expect(await refusal(everywhere((transaction) => start(transaction, kept)))).toMatchObject({
        constraint: 'students_starts_on',
      });
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, kept, merged);
            await start(transaction, merged, '2026-08-25');
          }),
        ),
      ).toMatchObject({ constraint: 'students_starts_on' });
      // Only to the first day of the joined life: the kept record's rows once
      // the merged record's are carried (its row cut where the kept one starts).
      const carry = async (transaction: Transaction) => {
        await mergeRow(transaction, kept, merged);
        await transaction
          .updateTable('student_statuses')
          .set({ valid_until: '2026-09-15' })
          .where('student_id', '=', merged)
          .execute();
        await transaction
          .updateTable('student_statuses')
          .set({ student_id: kept })
          .where('student_id', '=', merged)
          .execute();
      };
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await carry(transaction);
            await start(transaction, kept, '2026-09-05');
          }),
        ),
      ).toMatchObject({ constraint: 'students_starts_on' });
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, kept, merged);
            await start(transaction, kept);
          }),
        ),
      ).toMatchObject({ constraint: 'students_starts_on' });
      await everywhere(async (transaction) => {
        await carry(transaction);
        await start(transaction, kept);
        await removeMerged(transaction, kept, merged);
      });
      const stored = await database.migrator
        .selectFrom('students')
        .select('starts_on')
        .where('id', '=', kept)
        .executeTakeFirstOrThrow();
      expect(stored.starts_on).toBe('2026-09-01');
    });

    it('refuses the end `merge` on a row with an end, or naming a leaving or a move, even with a merge of its student', async () => {
      const facts = await pair();
      // The leaving and its cuts in one transaction (the deferred checks).
      const leaving = await database.migrator.transaction().execute(async (transaction) => {
        const id = await members.leaving(transaction, north, facts.merged, '2026-10-01');
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-01', ended_by: 'leaving', leaving_id: id })
          .where('id', '=', facts.row)
          .execute();
        await transaction
          .updateTable('group_memberships')
          .set({ valid_until: '2026-10-01', ended_by: 'leaving', leaving_id: id })
          .where('id', '=', facts.groupRow)
          .execute();
        return id;
      });
      for (const [table, id] of [
        ['class_memberships', facts.row],
        ['group_memberships', facts.groupRow],
      ] as const) {
        // A row ended by the leaving is not ended again by a merge.
        expect(
          await refusal(
            everywhere(async (transaction) => {
              await mergeRow(transaction, facts.kept, facts.merged);
              await transaction
                .updateTable(table)
                .set({ valid_until: '2026-09-20', ended_by: 'merge', leaving_id: null })
                .where('id', '=', id)
                .execute();
            }),
          ),
        ).toMatchObject({ constraint: 'memberships_merge' });
      }
      const other = await pair();
      // An end `merge` on a row with no end that names a leaving.
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, other.kept, other.merged);
            await transaction
              .updateTable('class_memberships')
              .set({ valid_until: '2026-10-01', ended_by: 'merge', leaving_id: leaving })
              .where('id', '=', other.row)
              .execute();
          }),
        ),
      ).toMatchObject({ constraint: 'memberships_merge' });
    });

    it('lets a merge cut a status row before an accepted branch move, and nothing else', async () => {
      const kept = await members.student(north, { startsOn: '2026-09-01' });
      const merged = await members.student(south, { startsOn: '2026-09-01' });
      const other = await members.student(north);
      const otherMerged = await members.student(north);
      // The kept record moved to the South branch on 14 October.
      await moveStudentBranch(database.migrator, kept, north, south);
      const cut = (transaction: Transaction) =>
        transaction
          .updateTable('student_statuses')
          .set({ valid_until: '2026-10-01' })
          .where('student_id', '=', kept)
          .execute();
      expect(await refusal(everywhere(cut))).toMatchObject({
        constraint: 'student_statuses_before_branch_move',
      });
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, other, otherMerged);
            await cut(transaction);
          }),
        ),
      ).toMatchObject({ constraint: 'student_statuses_before_branch_move' });
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, kept, merged);
            await cut(transaction);
            throw new Error('cut');
          }),
        ),
      ).toMatchObject({ message: 'cut' });
    });

    it('lets the kept record’s own branch move follow it into the merged record’s branch, and nothing else', async () => {
      const kept = await members.student(north, { startsOn: '2026-09-01' });
      const merged = await members.student(north, { startsOn: '2026-09-01' });
      const other = await members.student(south);
      const otherMerged = await members.student(south);
      await moveStudentBranch(database.migrator, kept, north, south);
      const move = await database.migrator
        .selectFrom('student_branch_moves')
        .select('id')
        .where('student_id', '=', kept)
        .executeTakeFirstOrThrow();
      // The move row itself to the North branch: a merge of another pair does not open it.
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, other, otherMerged);
            await transaction
              .updateTable('student_branch_moves')
              .set({ branch_id: north })
              .where('id', '=', move.id)
              .execute();
          }),
        ),
      ).toMatchObject({ constraint: 'student_branch_moves_state' });
      // The kept record of the pair goes to the merged record's branch; its
      // branch move follows by the cascade.
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, kept, merged);
            await transaction
              .updateTable('students')
              .set({ branch_id: north })
              .where('id', '=', kept)
              .execute();
            const followed = await transaction
              .selectFrom('student_branch_moves')
              .select('branch_id')
              .where('id', '=', move.id)
              .executeTakeFirstOrThrow();
            expect(followed.branch_id).toBe(north);
            throw new Error('followed');
          }),
        ),
      ).toMatchObject({ message: 'followed' });
    });

    it('ends a class or group row by a merge only from no end, and never at its insert', async () => {
      const facts = await pair();
      const end = (transaction: Transaction) =>
        transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-01', ended_by: 'merge' })
          .where('id', '=', facts.row)
          .execute();
      expect(await refusal(everywhere(end))).toMatchObject({ constraint: 'memberships_merge' });
      const oxford = await classes.schoolClass(north, northYear);
      expect(
        await refusal(
          everywhere((transaction) =>
            transaction
              .insertInto('class_memberships')
              .values({
                branch_id: north,
                student_id: facts.other,
                class_id: oxford,
                valid_from: '2026-09-01',
                valid_until: '2026-10-01',
                own_until: '2027-06-01',
                cause: 'placement',
                ended_by: 'merge',
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'memberships_merge' });
    });
  });

  describe('the rules a merge meets like any change', () => {
    it('refuses a carried status row that overlaps the kept record’s, and a class row outside its active days', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      const kept = await members.student(north, { startsOn: '2026-09-01' });
      const merged = await members.student(north, { startsOn: '2026-09-01' });
      const row = await database.migrator
        .transaction()
        .execute((transaction) =>
          members.member(
            { branch: north, classId: oxford, studentId: merged, from: '2026-09-01' },
            transaction,
          ),
        );
      // Two active rows of one record on the same days.
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, kept, merged);
            await transaction
              .updateTable('student_statuses')
              .set({ student_id: kept })
              .where('student_id', '=', merged)
              .execute();
          }),
        ),
      ).toMatchObject({ constraint: 'student_statuses_no_overlap' });
      // A class row carried to a record that is not active on its days: the
      // deferred check refuses it at the commit.
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, kept, merged);
            await transaction
              .updateTable('student_statuses')
              .set({ valid_until: '2026-09-02' })
              .where('student_id', '=', kept)
              .execute();
            await transaction
              .updateTable('class_memberships')
              .set({ student_id: kept })
              .where('id', '=', row)
              .execute();
          }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_active' });
    });
  });

  describe('the merged record', () => {
    it('is removed with data only by its own merge, its UID kept used for good', async () => {
      const kept = await members.student(north);
      const merged = await members.student(north);
      const other = await members.student(north);
      await database.migrator
        .transaction()
        .execute((transaction) => members.leaving(transaction, north, merged, '2026-10-01'));
      const remove = (transaction: Transaction, id: string) =>
        transaction.deleteFrom('students').where('id', '=', id).execute();
      expect(await refusal(everywhere((transaction) => remove(transaction, merged)))).toMatchObject(
        { constraint: 'students_delete_guard' },
      );
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, kept, other);
            await remove(transaction, merged);
          }),
        ),
      ).toMatchObject({ constraint: 'students_delete_guard' });
      const uid = (
        await database.migrator
          .selectFrom('students')
          .select('uid')
          .where('id', '=', merged)
          .executeTakeFirstOrThrow()
      ).uid;
      // `student_relatives_guard` skips the removed record (0036); the kept
      // record still has its main contact.
      // A row the archive does not name refuses the removal.
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, kept, merged);
            await removeMerged(transaction, kept, merged);
            throw new Error('removed');
          }).then(() => undefined),
        ),
      ).toMatchObject({ message: 'removed' });
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, kept, merged);
            await transaction
              .insertInto('student_statuses')
              .values({
                student_id: merged,
                branch_id: north,
                status: 'inactive',
                valid_from: '2027-01-01',
                valid_until: '2027-01-01',
                cause: 'start',
              })
              .execute();
            await removeMerged(transaction, kept, merged);
          }),
        ),
      ).toMatchObject({ constraint: 'students_merge_archive' });
      // A contract left on it refuses too: contracts are always carried.
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, kept, merged);
            await remove(transaction, merged);
          }),
        ),
      ).toMatchObject({ constraint: 'students_merge_archive' });
      await everywhere(async (transaction) => {
        await mergeRow(transaction, kept, merged);
        await removeMerged(transaction, kept, merged);
      });
      const held = await database.migrator
        .selectFrom('student_uids')
        .select(['student_id', 'released_at'])
        .where('uid', '=', uid)
        .executeTakeFirstOrThrow();
      expect(held).toEqual({ student_id: null, released_at: new Date(NOW) });
      expect(await rowCount('students', 'id', merged)).toBe(0);
      // A new student with the merged UID is refused by the reservation.
      const taken = await refusal(
        inBranches([north], (transaction) =>
          transaction
            .insertInto('student_uids')
            .values({
              uid,
              student_id: kept,
              branch_id: north,
              held_from: new Date(NOW),
            })
            .execute(),
        ),
      );
      expect(taken).toMatchObject({ code: '23505', constraint: 'student_uids_pkey' });
    });

    it('still refuses a kept record left without a main contact', async () => {
      const kept = await members.student(north);
      const merged = await members.student(north);
      expect(
        await refusal(
          everywhere(async (transaction) => {
            await mergeRow(transaction, kept, merged);
            await transaction
              .updateTable('student_relatives')
              .set({ unlinked_at: new Date(NOW) })
              .where('student_id', '=', kept)
              .execute();
            await removeMerged(transaction, kept, merged);
          }),
        ),
      ).toMatchObject({ constraint: 'student_needs_relative' });
    });
  });

  describe('student_merged_uid_holder', () => {
    it('names the kept record only for its own branch, and only for a branch of the transaction', async () => {
      const kept = await members.student(north);
      const merged = await members.student(south);
      const uid = (
        await database.migrator
          .selectFrom('students')
          .select('uid')
          .where('id', '=', merged)
          .executeTakeFirstOrThrow()
      ).uid;
      await everywhere(async (transaction) => {
        await mergeRow(transaction, kept, merged);
        await removeMerged(transaction, kept, merged);
      });
      const holder = (branches: string[], branch: string) =>
        inBranches(branches, async (transaction) => {
          const found = await sql<{ student_id: string | null }>`
            select student_id from student_merged_uid_holder(${uid}, ${branch}::uuid)
          `.execute(transaction);
          return found.rows;
        });
      expect(await holder([north], north)).toEqual([{ student_id: kept }]);
      expect(await holder([south], south)).toEqual([{ student_id: null }]);
      // A branch the request does not hold answers nothing.
      expect(await holder([south], north)).toEqual([]);
      expect(
        await inBranches([north], async (transaction) => {
          const found = await sql<{ student_id: string | null }>`
            select student_id from student_merged_uid_holder('2699999', ${north}::uuid)
          `.execute(transaction);
          return found.rows;
        }),
      ).toEqual([]);
    });

    it('finds a merged UID of letters asked in another case, for its own branch only (task 9.4c)', async () => {
      const kept = await members.student(north);
      const merged = await members.student(south);
      await everywhere(async (transaction) => {
        // The merged record's UID corrected to letters, as the correction writes it.
        await transaction
          .insertInto('student_uids')
          .values({
            uid: 'Mg2607001',
            student_id: merged,
            branch_id: south,
            held_from: new Date(NOW),
          })
          .execute();
        await transaction
          .updateTable('students')
          .set({ uid: 'Mg2607001' })
          .where('id', '=', merged)
          .execute();
      });
      // The checks of the merge row take a UID of letters (0138 replaced the seven digits).
      await everywhere(async (transaction) => {
        await mergeRow(transaction, kept, merged);
        await removeMerged(transaction, kept, merged);
      });
      const stored = await database.migrator
        .selectFrom('student_merges')
        .select(['merged_uid', 'merged_uids'])
        .where('merged_id', '=', merged)
        .executeTakeFirstOrThrow();
      expect(stored).toEqual({ merged_uid: 'Mg2607001', merged_uids: ['Mg2607001'] });
      const found = await inBranches([north], async (transaction) => {
        const rows = await sql<{ student_id: string | null }>`
          select student_id from student_merged_uid_holder('MG2607001', ${north}::uuid)
        `.execute(transaction);
        return rows.rows;
      });
      expect(found).toEqual([{ student_id: kept }]);
      // Asked for the merged record's branch: the kept record is of another.
      const elsewhere = await inBranches([south], async (transaction) => {
        const rows = await sql<{ student_id: string | null }>`
          select student_id from student_merged_uid_holder('mg2607001', ${south}::uuid)
        `.execute(transaction);
        return rows.rows;
      });
      expect(elsewhere).toEqual([{ student_id: null }]);
    });

    it('refuses a merge row whose UID breaks the rule of every UID (task 9.4c)', async () => {
      const kept = await members.student(north);
      const merged = await members.student(south);
      // The insert guard compares both UIDs with the records' own, which the
      // checks of the records already hold to the rule; it is switched off in
      // a transaction rolled back, so the merge row's own checks are reached.
      const insert = (keptUid: string, mergedUid: string) =>
        database.migrator.transaction().execute(async (transaction) => {
          await sql`alter table student_merges disable trigger student_merges_insert_guard`.execute(
            transaction,
          );
          await transaction
            .insertInto('student_merges')
            .values({
              branch_id: north,
              kept_id: kept,
              merged_id: merged,
              merged_branch_id: south,
              kept_uid: keptUid,
              merged_uid: mergedUid,
              merged_uids: [mergedUid],
              merged_record: '{}',
              left_rows: '{}',
              reason: 'Created twice by mistake',
              merged_by: account,
              merged_at: new Date(NOW),
            })
            .execute();
          throw new Error('rolled back');
        });
      for (const [keptUid, mergedUid, constraint] of [
        ['A'.repeat(21), 'Mg1', 'student_merges_kept_uid_check'],
        ['Kp 1', 'Mg1', 'student_merges_kept_uid_check'],
        ['Kp1', 'B'.repeat(21), 'student_merges_merged_uid_check'],
        ['Kp1', 'Mg 1', 'student_merges_merged_uid_check'],
      ] as const) {
        await expect(insert(keptUid, mergedUid), `${keptUid} ${mergedUid}`).rejects.toMatchObject({
          code: '23514',
          constraint,
        });
      }
      // Letters and 20 characters pass the checks; the guard's rollback ends the write.
      await expect(insert('Kp1', 'M'.repeat(20))).rejects.toThrow('rolled back');
    });
  });
});
