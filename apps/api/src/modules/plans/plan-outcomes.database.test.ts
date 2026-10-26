import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { closeQuarter, reopenQuarter } from '../../testing/closing-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';

const NOW = '2026-10-15T10:00:00+05:00';

async function refusal(
  work: Promise<unknown>,
): Promise<{ code?: string; constraint?: string; message?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string; message?: string };
  }
  throw new Error('The database did not refuse it.');
}

// The outcomes of "not covered" items and the "carried in" tray in the database (task 9.2d, pull
// request #233; db/migrations/0136): one outcome per item and journal, never changed, each kind
// with its own columns; nothing in a closed quarter ("Nothing is possible in a closed quarter");
// no carry from the last quarter of the year or into a closed one ("In quarter 4 only merge or
// drop exist"); the tray kept to its quarter. Invented names.
describe('the outcomes of not-covered items in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let south: string;
  let account: string;

  /** The branch of the latest scene: the one a test writes in. */
  let current = '';

  const inBranch = <T>(work: (transaction: Transaction) => Promise<T>, branch = current) =>
    transactions.run([branch], work);

  /** A new branch and its year with its four quarters, a graded journal, its plan of each quarter (0117). */
  let branches = 0;
  const scene = async () => {
    branches += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branches)}`);
    current = branch;
    const year = await classes.year(branch);
    const quarters = (
      await database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', year)
        .orderBy('number')
        .execute()
    ).map((one) => one.id);
    const subject = await classes.subject({ grades: [7], journalType: 'graded' });
    const classId = await classes.schoolClass(branch, year, { grade: 7 });
    const journal = (
      await database.migrator
        .insertInto('journals')
        .values({
          branch_id: branch,
          academic_year_id: year,
          class_id: classId,
          group_id: null,
          subject_id: subject,
          runs: '{[2026-09-07,)}',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const planOf = async (quarter: string) =>
      (
        await database.migrator
          .selectFrom('lesson_plan_journals')
          .select('plan_id')
          .where('journal_id', '=', journal)
          .where('quarter_id', '=', quarter)
          .executeTakeFirstOrThrow()
      ).plan_id;
    const item = async (quarter: string, topic = 'Fractions') =>
      (
        await database.migrator
          .insertInto('lesson_plan_items')
          .values({ branch_id: branch, plan_id: await planOf(quarter), topic })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    return {
      branch,
      journal,
      quarters,
      q1: quarters[0] ?? '',
      q2: quarters[1] ?? '',
      q4: quarters[3] ?? '',
      item,
    };
  };

  type Scene = Awaited<ReturnType<typeof scene>>;

  const outcome = (x: Scene, change: object) =>
    inBranch(
      (transaction) =>
        transaction
          .insertInto('lesson_plan_outcomes')
          .values({
            branch_id: x.branch,
            journal_id: x.journal,
            quarter_id: x.q1,
            item_id: '',
            kind: 'dropped',
            reason: 'Repeated topic',
            decided_by: account,
            decided_at: new Date(0),
            ...change,
          })
          .returning(['id', 'decided_at'])
          .executeTakeFirstOrThrow(),
      x.branch,
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    classes = new ClassesKit(database.migrator);
    south = await insertBranch(database.migrator, 'South');
    account = (
      await database.migrator
        .insertInto('accounts')
        .values({
          login: 'vice.outcomes',
          password_hash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA',
          must_change_password: false,
          created_at: new Date(NOW),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('holds each kind to its columns and writes the moment of the clock', async () => {
    const x = await scene();
    const item = await x.item(x.q1);
    for (const [change, constraint] of [
      [{ kind: 'merged', reason: '' }, 'lesson_plan_outcomes_merged_check'],
      [{ kind: 'dropped', reason: '  ' }, 'lesson_plan_outcomes_reason_check'],
      [{ kind: 'dropped', reason: 'R'.repeat(501) }, 'lesson_plan_outcomes_reason_check'],
      [
        { kind: 'merged', reason: 'Why', target_date: '2026-09-14' },
        'lesson_plan_outcomes_reason_check',
      ],
      [{ kind: 'carried', reason: '' }, 'lesson_plan_outcomes_carried_check'],
      [{ kind: 'dropped', automatic: true }, 'lesson_plan_outcomes_automatic_check'],
      [{ kind: 'dropped', carried_item_id: item }, 'lesson_plan_outcomes_carried_check'],
    ] as const) {
      const refused = await refusal(outcome(x, { item_id: item, ...change }));
      expect([refused.code, refused.constraint]).toEqual([CHECK_VIOLATION, constraint]);
    }
    const written = await outcome(x, { item_id: item });
    expect(written.decided_at).toEqual(new Date(NOW));
  });

  it('keeps every outcome, never changed or deleted', async () => {
    const x = await scene();
    const item = await x.item(x.q1);
    const written = await outcome(x, { item_id: item });
    for (const work of [
      inBranch((transaction) =>
        transaction
          .updateTable('lesson_plan_outcomes')
          .set({ reason: 'Changed' })
          .where('id', '=', written.id)
          .execute(),
      ),
      inBranch((transaction) =>
        transaction.deleteFrom('lesson_plan_outcomes').where('id', '=', written.id).execute(),
      ),
    ]) {
      expect((await refusal(work)).code).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it('refuses an outcome of an item of another quarter or journal', async () => {
    const x = await scene();
    const y = await scene();
    const ofQ2 = await x.item(x.q2);
    const ofOther = await y.item(y.q1);
    for (const item of [ofQ2, ofOther]) {
      const refused = await refusal(outcome(x, { item_id: item }));
      expect([refused.code, refused.constraint]).toEqual([
        CHECK_VIOLATION,
        'lesson_plan_outcome_item',
      ]);
    }
  });

  it('refuses a carry from the last quarter and into a closed next quarter', async () => {
    const x = await scene();
    const last = await x.item(x.q4);
    const copy = await x.item(x.q4, 'Copy');
    const fromLast = await refusal(
      outcome(x, {
        quarter_id: x.q4,
        item_id: last,
        kind: 'carried',
        reason: '',
        carried_item_id: copy,
      }),
    );
    expect([fromLast.code, fromLast.constraint]).toEqual([
      CHECK_VIOLATION,
      'lesson_plan_carry_refused',
    ]);
    const item = await x.item(x.q1);
    const next = await x.item(x.q2, 'Copy');
    await closeQuarter(database, { branchId: x.branch, quarterId: x.q2, accountId: account });
    const intoClosed = await refusal(
      outcome(x, { item_id: item, kind: 'carried', reason: '', carried_item_id: next }),
    );
    expect([intoClosed.code, intoClosed.constraint]).toEqual([
      CHECK_VIOLATION,
      'lesson_plan_carry_refused',
    ]);
  });

  it('refuses every outcome and tray write in a closed quarter', async () => {
    const x = await scene();
    const item = await x.item(x.q1);
    const copy = await x.item(x.q2, 'Copy');
    const carried = await outcome(x, {
      item_id: item,
      kind: 'carried',
      reason: '',
      carried_item_id: copy,
    });
    const tray = {
      branch_id: x.branch,
      journal_id: x.journal,
      quarter_id: x.q2,
      item_id: copy,
      outcome_id: carried.id,
    };
    await inBranch((transaction) =>
      transaction.insertInto('lesson_plan_tray').values(tray).execute(),
    );
    await closeQuarter(database, { branchId: x.branch, quarterId: x.q1, accountId: account });
    const other = await x.item(x.q1, 'Ratios');
    const secondCopy = await x.item(x.q2, 'Second copy');
    for (const change of [
      { item_id: other },
      { item_id: other, kind: 'merged', reason: '', target_date: '2026-09-14' },
      { item_id: other, kind: 'carried', reason: '', carried_item_id: secondCopy },
    ]) {
      const refused = await refusal(outcome(x, change));
      expect([refused.code, refused.constraint]).toEqual([CHECK_VIOLATION, 'quarters_closed']);
    }
    await closeQuarter(database, { branchId: x.branch, quarterId: x.q2, accountId: account });
    const taken = await refusal(
      inBranch((transaction) =>
        transaction.deleteFrom('lesson_plan_tray').where('item_id', '=', copy).execute(),
      ),
    );
    expect([taken.code, taken.constraint]).toEqual([CHECK_VIOLATION, 'quarters_closed']);
    const added = await refusal(
      inBranch((transaction) =>
        transaction
          .insertInto('lesson_plan_tray')
          .values({ ...tray, item_id: secondCopy })
          .execute(),
      ),
    );
    expect([added.code, added.constraint]).toEqual([CHECK_VIOLATION, 'quarters_closed']);
    const moved = await refusal(
      inBranch((transaction) =>
        transaction
          .updateTable('lesson_plan_tray')
          .set({ item_id: secondCopy })
          .where('item_id', '=', copy)
          .execute(),
      ),
    );
    expect([moved.code, moved.constraint]).toEqual([CHECK_VIOLATION, 'quarters_closed']);
  });

  it('takes an outcome in a journal reopened after the close (0135)', async () => {
    const x = await scene();
    const item = await x.item(x.q1);
    await closeQuarter(database, { branchId: x.branch, quarterId: x.q1, accountId: account });
    expect((await refusal(outcome(x, { item_id: item }))).constraint).toBe('quarters_closed');
    await reopenQuarter(database, {
      branchId: x.branch,
      quarterId: x.q1,
      journalId: x.journal,
      accountId: account,
      at: NOW,
      days: 3,
    });
    const written = await outcome(x, { item_id: item });
    expect(written.id).toBeTruthy();
  });

  it('keeps a tray row to its journal, quarter and a copy of a plan of that quarter', async () => {
    const x = await scene();
    const item = await x.item(x.q1);
    const copy = await x.item(x.q2, 'Copy');
    const elsewhere = await x.item(x.q1, 'Elsewhere');
    const carried = await outcome(x, {
      item_id: item,
      kind: 'carried',
      reason: '',
      carried_item_id: copy,
    });
    const row = {
      branch_id: x.branch,
      journal_id: x.journal,
      quarter_id: x.q2,
      outcome_id: carried.id,
    };
    const wrong = await refusal(
      inBranch((transaction) =>
        transaction
          .insertInto('lesson_plan_tray')
          .values({ ...row, item_id: elsewhere })
          .execute(),
      ),
    );
    expect([wrong.code, wrong.constraint]).toEqual([CHECK_VIOLATION, 'lesson_plan_tray_item']);
    await inBranch((transaction) =>
      transaction
        .insertInto('lesson_plan_tray')
        .values({ ...row, item_id: copy })
        .execute(),
    );
    const moved = await refusal(
      inBranch((transaction) =>
        transaction
          .updateTable('lesson_plan_tray')
          .set({ item_id: elsewhere })
          .where('item_id', '=', copy)
          .execute(),
      ),
    );
    expect([moved.code, moved.constraint]).toEqual([CHECK_VIOLATION, 'lesson_plan_tray_item']);
    // The row filter: another branch sees neither table's rows.
    const seen = await inBranch(
      async (transaction) => [
        (await transaction.selectFrom('lesson_plan_outcomes').select('id').execute()).length,
        (await transaction.selectFrom('lesson_plan_tray').select('item_id').execute()).length,
      ],
      south,
    );
    expect(seen).toEqual([0, 0]);
  });
});
