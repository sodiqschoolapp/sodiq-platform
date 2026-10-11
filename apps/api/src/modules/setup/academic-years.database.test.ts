import { academicYearDatesProblem } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../database/database.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';
const FOREIGN_KEY_VIOLATION = '23503';
const NOT_NULL_VIOLATION = '23502';
const UNIQUE_VIOLATION = '23505';

type Dates = readonly [string | null, string | null];

const UNDATED: Dates[] = [
  [null, null],
  [null, null],
  [null, null],
  [null, null],
];

const DATED: Dates[] = [
  ['2026-09-02', '2026-10-31'],
  ['2026-11-10', '2026-12-27'],
  ['2027-01-12', '2027-03-20'],
  ['2027-03-30', '2027-05-25'],
];

/** The SQLSTATE and the constraint of a refusal; what a promise that was not refused gives. */
async function refusal(work: Promise<unknown>): Promise<{ code: unknown; constraint: unknown }> {
  try {
    await work;
  } catch (error) {
    const failure = error as { code?: unknown; constraint?: unknown };
    return { code: failure.code, constraint: failure.constraint };
  }
  return { code: 'none', constraint: 'none' };
}

// The rules of academic years and quarters that the database itself keeps
// (db/migrations/0016), also when the application has a fault: one current
// year per branch (docs/spec/edge-cases/developer-rules.md, One current year;
// the build plan's "done when"); years of a branch without overlap and in
// order; four quarters per year, inside it, in order, without overlap (the
// "done when"); statuses planned -> current -> closed; a closed year frozen;
// the application writes only the columns it may.
describe('academic years and quarters in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** A year with its four quarters in one transaction, so that the check at commit passes. */
  async function addYearWith(
    connection: Database | Transaction,
    branch: string,
    start: string,
    end: string,
    quarters: readonly Dates[],
    status?: string,
  ): Promise<string> {
    const year = await connection
      .insertInto('academic_years')
      .values({
        branch_id: branch,
        start_date: start,
        end_date: end,
        ...(status === undefined ? {} : { status }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (quarters.length > 0) {
      await connection
        .insertInto('quarters')
        .values(
          quarters.map(([startDate, endDate], index) => ({
            branch_id: branch,
            academic_year_id: year.id,
            number: index + 1,
            start_date: startDate,
            end_date: endDate,
          })),
        )
        .execute();
    }
    return year.id;
  }

  /** A planned year written by the application, as the route does. */
  const addYear = (
    branch: string,
    start: string,
    end: string,
    quarters: readonly Dates[] = UNDATED,
  ) => inBranch(branch, (transaction) => addYearWith(transaction, branch, start, end, quarters));

  /**
   * A year of any status, written by the migrator (the application cannot
   * insert a status): created planned with its quarters, then moved through
   * current to closed as the statuses go. `unguarded` turns the trigger of
   * the order of the years off for the transaction, to reach a state that the
   * trigger would refuse and show what another guard does with it.
   */
  const addYearAs = (
    status: 'planned' | 'current' | 'closed',
    branch: string,
    start: string,
    end: string,
    {
      quarters = UNDATED,
      unguarded = false,
    }: { quarters?: readonly Dates[]; unguarded?: boolean } = {},
  ) =>
    database.migrator.transaction().execute(async (transaction) => {
      if (unguarded) {
        await sql`alter table academic_years disable trigger academic_years_guard`.execute(
          transaction,
        );
      }
      const year = await addYearWith(transaction, branch, start, end, quarters);
      for (const next of status === 'planned'
        ? []
        : status === 'current'
          ? ['current']
          : ['current', 'closed']) {
        await transaction
          .updateTable('academic_years')
          .set({ status: next })
          .where('id', '=', year)
          .execute();
      }
      if (unguarded) {
        // The deferred checks run now: a table with pending trigger events cannot be altered.
        await sql`set constraints all immediate`.execute(transaction);
        await sql`alter table academic_years enable trigger academic_years_guard`.execute(
          transaction,
        );
      }
      return year;
    });

  const setStatus = (branch: string, year: string, status: string) =>
    inBranch(branch, (transaction) =>
      transaction.updateTable('academic_years').set({ status }).where('id', '=', year).execute(),
    );

  const setQuarters = (branch: string, year: string, quarters: readonly Dates[]) =>
    inBranch(branch, async (transaction) => {
      for (const [index, [startDate, endDate]] of quarters.entries()) {
        await transaction
          .updateTable('quarters')
          .set({ start_date: startDate, end_date: endDate })
          .where('academic_year_id', '=', year)
          .where('number', '=', index + 1)
          .execute();
      }
    });

  const setYearDates = (branch: string, year: string, start: string, end: string) =>
    inBranch(branch, (transaction) =>
      transaction
        .updateTable('academic_years')
        .set({ start_date: start, end_date: end })
        .where('id', '=', year)
        .execute(),
    );

  let branchCount = 0;
  const newBranch = () => {
    branchCount += 1;
    return insertBranch(database.migrator, `Branch ${String(branchCount)}`);
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app);
  });

  afterAll(async () => {
    await database.destroy();
  });

  // docs/spec/edge-cases/developer-rules.md, Branch filter.
  it('keep years and quarters behind the branch filter', async () => {
    const north = await newBranch();
    const south = await newBranch();
    await addYear(north, '2026-09-02', '2027-05-25');

    const seen = await inBranch(south, async (transaction) => ({
      years: await transaction.selectFrom('academic_years').select('id').execute(),
      quarters: await transaction.selectFrom('quarters').select('id').execute(),
    }));

    expect(seen).toEqual({ years: [], quarters: [] });
  });

  // "A partial unique index on (branch) where status is current." The build
  // plan's "done when": the database refuses a second current year.
  describe('keep one current year per branch', () => {
    it('by refusing a second current year in the branch', async () => {
      const branch = await newBranch();
      await addYearAs('current', branch, '2026-09-02', '2027-05-25');
      const later = await addYear(branch, '2027-09-02', '2028-05-25');

      // The trigger of the order refuses first: the current year is earlier and open.
      expect(await refusal(setStatus(branch, later, 'current'))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'academic_years_earlier_open',
      });
      // Without it, the index alone still refuses.
      expect(
        await refusal(
          addYearAs('current', branch, '2028-09-02', '2029-05-25', { unguarded: true }),
        ),
      ).toEqual({ code: UNIQUE_VIOLATION, constraint: 'academic_years_one_current_idx' });
    });

    it('also for the migrator, a year before the current one included', async () => {
      const branch = await newBranch();
      await addYearAs('current', branch, '2026-09-02', '2027-05-25');

      expect(
        await refusal(
          addYearAs('current', branch, '2025-09-02', '2026-05-25', { unguarded: true }),
        ),
      ).toEqual({ code: UNIQUE_VIOLATION, constraint: 'academic_years_one_current_idx' });
    });

    it('while another branch has its own current year', async () => {
      const north = await newBranch();
      const south = await newBranch();
      await addYearAs('current', north, '2026-09-02', '2027-05-25');

      expect(await refusal(addYearAs('current', south, '2026-09-02', '2027-05-25'))).toEqual({
        code: 'none',
        constraint: 'none',
      });
    });
  });

  // Owner's answer 6: "The years of a branch do not overlap."
  describe('keep the years of a branch apart', () => {
    it('by refusing a year that shares a day with another', async () => {
      const branch = await newBranch();
      await addYear(branch, '2026-09-02', '2027-05-25');

      expect(await refusal(addYear(branch, '2027-05-25', '2028-05-20'))).toEqual({
        code: EXCLUSION_VIOLATION,
        constraint: 'academic_years_no_overlap',
      });
      expect(await refusal(addYear(branch, '2025-09-03', '2026-09-02'))).toEqual({
        code: EXCLUSION_VIOLATION,
        constraint: 'academic_years_no_overlap',
      });
    });

    it('while the next day, or another branch, may begin one', async () => {
      const branch = await newBranch();
      const other = await newBranch();
      await addYear(branch, '2026-09-02', '2027-05-25');

      expect(await refusal(addYear(branch, '2027-05-26', '2028-05-20'))).toEqual({
        code: 'none',
        constraint: 'none',
      });
      expect(await refusal(addYear(other, '2026-09-02', '2027-05-25'))).toEqual({
        code: 'none',
        constraint: 'none',
      });
    });
  });

  // Decision 1 of pull request #44, the same rule as academicYearDatesProblem.
  describe('keep the dates of a year', () => {
    it('as the shared rule does: the next calendar year, less than a year', async () => {
      const branch = await newBranch();
      const pairs: [string, string][] = [
        ['2030-09-02', '2031-05-25'],
        ['2032-09-02', '2033-09-01'],
        ['2034-09-02', '2035-09-02'],
        ['2036-09-02', '2036-12-31'],
        ['2038-01-01', '2039-12-31'],
        ['2040-09-02', '2042-01-10'],
        ['2044-02-29', '2045-02-27'],
        ['2048-02-29', '2049-02-28'],
      ];
      for (const [start, end] of pairs) {
        const found = await refusal(addYear(branch, start, end));
        const shared = academicYearDatesProblem(start, end);

        expect(found, `${start} to ${end}`).toEqual(
          shared === null
            ? { code: 'none', constraint: 'none' }
            : { code: CHECK_VIOLATION, constraint: 'academic_years_dates_check' },
        );
      }
    });

    it('and never leave one empty', async () => {
      const branch = await newBranch();

      expect(
        (
          await refusal(
            sql`insert into academic_years (branch_id, start_date, end_date) values (${branch}, null, '2027-05-25')`.execute(
              database.migrator,
            ),
          )
        ).code,
      ).toBe(NOT_NULL_VIOLATION);
    });
  });

  // Owner's answer 4: "A new year is created with four quarters"; answer 5:
  // "every quarter inside its year; quarters in order; no overlap; gaps
  // between quarters are allowed". Decision 2: both dates or neither.
  describe('keep four quarters per year, inside it, in order and apart', () => {
    it('by refusing overlapping quarters (the "done when")', async () => {
      const branch = await newBranch();
      const year = await addYear(branch, '2026-09-02', '2027-05-25', DATED);

      const found = await refusal(
        setQuarters(branch, year, [['2026-09-02', '2026-11-15'], DATED[1] ?? [null, null]]),
      );

      expect(found).toEqual({ code: EXCLUSION_VIOLATION, constraint: 'quarters_no_overlap' });
    });

    it('and still take a save of the four together whose end state is sound, in any order of the rows', async () => {
      const branch = await newBranch();
      const year = await addYear(branch, '2026-09-02', '2027-05-25', DATED);

      // Q1's end moves past Q2's old start before Q2 moves.
      await setQuarters(branch, year, [
        ['2026-09-02', '2026-11-15'],
        ['2026-11-20', '2026-12-30'],
      ]);
      // The other way: Q2's start moves before Q1's old end before Q1 moves.
      await inBranch(branch, async (transaction) => {
        await transaction
          .updateTable('quarters')
          .set({ start_date: '2026-10-20', end_date: '2026-12-30' })
          .where('academic_year_id', '=', year)
          .where('number', '=', 2)
          .execute();
        await transaction
          .updateTable('quarters')
          .set({ start_date: '2026-09-02', end_date: '2026-10-15' })
          .where('academic_year_id', '=', year)
          .where('number', '=', 1)
          .execute();
      });

      const quarters = await database.migrator
        .selectFrom('quarters')
        .select(['number', 'start_date', 'end_date'])
        .where('academic_year_id', '=', year)
        .orderBy('number')
        .execute();
      expect(quarters.slice(0, 2)).toEqual([
        { number: 1, start_date: '2026-09-02', end_date: '2026-10-15' },
        { number: 2, start_date: '2026-10-20', end_date: '2026-12-30' },
      ]);
    });

    it('by refusing quarters out of number order', async () => {
      const branch = await newBranch();
      const year = await addYear(branch, '2026-09-02', '2027-05-25');

      expect(
        await refusal(
          setQuarters(branch, year, [
            ['2026-11-10', '2026-12-27'],
            ['2026-09-02', '2026-10-31'],
          ]),
        ),
      ).toEqual({ code: CHECK_VIOLATION, constraint: 'quarters_order' });
    });

    it('with gaps between quarters, and some quarters undated', async () => {
      const branch = await newBranch();
      const year = await addYear(branch, '2026-09-02', '2027-05-25');

      expect(
        await refusal(
          setQuarters(branch, year, [
            ['2026-09-02', '2026-10-31'],
            [null, null],
            ['2027-01-12', '2027-03-20'],
          ]),
        ),
      ).toEqual({ code: 'none', constraint: 'none' });
    });

    it('by refusing a quarter outside its year, and a year shortened past its quarter', async () => {
      const branch = await newBranch();
      const year = await addYear(branch, '2026-09-02', '2027-05-25', DATED);

      expect(await refusal(setQuarters(branch, year, [['2026-09-01', '2026-10-31']]))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'quarters_outside_year',
      });
      expect(await refusal(setYearDates(branch, year, '2026-09-02', '2027-05-24'))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'quarters_outside_year',
      });
      expect(await refusal(setYearDates(branch, year, '2026-09-02', '2027-05-30'))).toEqual({
        code: 'none',
        constraint: 'none',
      });
    });

    it('by refusing a year with three quarters, a fifth quarter and a quarter twice', async () => {
      const branch = await newBranch();

      expect(
        await refusal(
          inBranch(branch, (transaction) =>
            addYearWith(transaction, branch, '2026-09-02', '2027-05-25', UNDATED.slice(0, 3)),
          ),
        ),
      ).toEqual({ code: CHECK_VIOLATION, constraint: 'academic_year_quarters_count' });
      const year = await addYear(branch, '2026-09-02', '2027-05-25');
      const another = (number: number) =>
        inBranch(branch, (transaction) =>
          transaction
            .insertInto('quarters')
            .values({ branch_id: branch, academic_year_id: year, number })
            .execute(),
        );

      expect(await refusal(another(5))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'quarters_number_check',
      });
      expect(await refusal(another(2))).toEqual({
        code: UNIQUE_VIOLATION,
        constraint: 'quarters_number_key',
      });
    });

    it('by refusing a quarter with one date, or ending before it starts', async () => {
      const branch = await newBranch();
      const year = await addYear(branch, '2026-09-02', '2027-05-25');

      expect(await refusal(setQuarters(branch, year, [['2026-09-02', null]]))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'quarters_dates_check',
      });
      expect(await refusal(setQuarters(branch, year, [['2026-10-31', '2026-09-02']]))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'quarters_dates_check',
      });
    });

    it('by refusing a quarter on a year of another branch', async () => {
      const north = await newBranch();
      const south = await newBranch();
      const year = await addYear(north, '2026-09-02', '2027-05-25');

      expect(
        (
          await refusal(
            database.migrator
              .insertInto('quarters')
              .values({ branch_id: south, academic_year_id: year, number: 1 })
              .execute(),
          )
        ).code,
      ).toBe(FOREIGN_KEY_VIOLATION);
    });
  });

  // Owner's answer 6: "Statuses: planned → current → closed. 'Start year'
  // works for a branch's first year or when the previous year is closed."
  // Decision 13: no year before one already started.
  describe('keep the statuses in their order', () => {
    it('by refusing a move back or a skip', async () => {
      const branch = await newBranch();
      const current = await addYearAs('current', branch, '2026-09-02', '2027-05-25');
      const planned = await addYear(branch, '2027-09-02', '2028-05-25');

      expect(await refusal(setStatus(branch, current, 'planned'))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'academic_years_status_order',
      });
      expect(await refusal(setStatus(branch, planned, 'closed'))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'academic_years_status_order',
      });
      expect(await refusal(setStatus(branch, current, 'nearly'))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'academic_years_status_order',
      });
    });

    it('by starting a year only when every earlier year is closed', async () => {
      const branch = await newBranch();
      await addYear(branch, '2025-09-02', '2026-05-25');
      const later = await addYear(branch, '2026-09-02', '2027-05-25');

      expect(await refusal(setStatus(branch, later, 'current'))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'academic_years_earlier_open',
      });
      const fresh = await newBranch();
      await addYearAs('closed', fresh, '2025-09-02', '2026-05-25');
      const next = await addYear(fresh, '2026-09-02', '2027-05-25');

      expect(await refusal(setStatus(fresh, next, 'current'))).toEqual({
        code: 'none',
        constraint: 'none',
      });
    });

    it('by refusing a planned year before a year that has started, created or moved there', async () => {
      const branch = await newBranch();
      await addYearAs('current', branch, '2026-09-02', '2027-05-25');

      expect(await refusal(addYear(branch, '2025-09-02', '2026-05-25'))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'academic_years_out_of_order',
      });
      const planned = await addYear(branch, '2027-09-02', '2028-05-25');

      expect(await refusal(setYearDates(branch, planned, '2025-09-02', '2026-05-25'))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'academic_years_out_of_order',
      });
      const closedBranch = await newBranch();
      await addYearAs('closed', closedBranch, '2026-09-02', '2027-05-25');

      expect(await refusal(addYear(closedBranch, '2025-09-02', '2026-05-25'))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'academic_years_out_of_order',
      });
    });

    it('by refusing to start a year that lies before a closed one', async () => {
      const branch = await newBranch();
      const planned = await addYear(branch, '2025-09-02', '2026-05-25');
      // Only without the trigger can a closed year come after a planned one.
      await addYearAs('closed', branch, '2026-09-02', '2027-05-25', { unguarded: true });

      expect(await refusal(setStatus(branch, planned, 'current'))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'academic_years_out_of_order',
      });
    });

    it('by freezing a closed year and its quarters, for the migrator too', async () => {
      const branch = await newBranch();
      const closed = await addYearAs('closed', branch, '2025-09-02', '2026-05-25');

      expect(await refusal(setYearDates(branch, closed, '2025-09-01', '2026-05-25'))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'academic_years_closed',
      });
      expect(await refusal(setStatus(branch, closed, 'current'))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'academic_years_closed',
      });
      expect(await refusal(setQuarters(branch, closed, [['2025-09-03', '2025-10-31']]))).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'academic_years_closed',
      });
      expect(
        await refusal(
          database.migrator
            .updateTable('academic_years')
            .set({ end_date: '2026-05-26' })
            .where('id', '=', closed)
            .execute(),
        ),
      ).toEqual({ code: CHECK_VIOLATION, constraint: 'academic_years_closed' });
      expect(
        await refusal(
          database.migrator
            .updateTable('quarters')
            .set({ end_date: '2025-10-30' })
            .where('academic_year_id', '=', closed)
            .where('number', '=', 1)
            .execute(),
        ),
      ).toEqual({ code: CHECK_VIOLATION, constraint: 'academic_years_closed' });
    });
  });

  // The grants (docs/recipes/record-type.md; the spec review of the plan,
  // must-fix 3): a year always begins planned; nothing is removed; a quarter
  // never moves to another year or number.
  describe('let the application write only what it may', () => {
    it('so that it cannot insert a status', async () => {
      const branch = await newBranch();

      expect(
        (
          await refusal(
            inBranch(branch, (transaction) =>
              addYearWith(transaction, branch, '2026-09-02', '2027-05-25', UNDATED, 'current'),
            ),
          )
        ).code,
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it('so that it deletes nothing and moves no quarter', async () => {
      const branch = await newBranch();
      const other = await addYear(branch, '2027-09-02', '2028-05-25');
      const year = await addYear(branch, '2026-09-02', '2027-05-25');
      const attempts = [
        inBranch(branch, (transaction) =>
          transaction.deleteFrom('quarters').where('academic_year_id', '=', year).execute(),
        ),
        inBranch(branch, (transaction) =>
          transaction.deleteFrom('academic_years').where('id', '=', year).execute(),
        ),
        inBranch(branch, (transaction) =>
          transaction
            .updateTable('quarters')
            .set({ academic_year_id: other })
            .where('academic_year_id', '=', year)
            .execute(),
        ),
        inBranch(branch, (transaction) =>
          transaction
            .updateTable('quarters')
            .set({ number: 4 })
            .where('academic_year_id', '=', year)
            .where('number', '=', 1)
            .execute(),
        ),
        inBranch(branch, (transaction) =>
          transaction
            .updateTable('academic_years')
            .set({ branch_id: branch })
            .where('id', '=', year)
            .execute(),
        ),
      ];
      for (const attempt of attempts) {
        expect((await refusal(attempt)).code).toBe(INSUFFICIENT_PRIVILEGE);
      }
    });

    it('so that it sets the go-live date of a branch, and nothing new about the branch else', async () => {
      const branch = await newBranch();

      await inBranch(branch, (transaction) =>
        transaction
          .updateTable('branches')
          .set({ go_live_date: '2026-11-10' })
          .where('id', '=', branch)
          .execute(),
      );
      const row = await database.migrator
        .selectFrom('branches')
        .select('go_live_date')
        .where('id', '=', branch)
        .executeTakeFirstOrThrow();
      expect(row.go_live_date).toBe('2026-11-10');
    });
  });
});
