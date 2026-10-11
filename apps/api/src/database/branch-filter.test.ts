import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addBranchFilter, insertBranch } from '../testing/branch-filter-sql.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { createDatabase } from './database.js';
import { branchFilterValue, Transactions, type Transaction } from './transactions.js';

const ROW_SECURITY_VIOLATION = '42501';
const INVALID_TEXT = '22P02';

// docs/spec/edge-cases/developer-rules.md, "Branch filter": set per transaction,
// never on a pooled connection. CLAUDE.md, "Branch on every row": a query never
// returns another branch's rows. Everything here runs as sodiq_app; the
// migrator owns the tables and is not filtered.
describe('branch filter', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let east: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    east = await insertBranch(database.migrator, 'East');
    await sql`
      create table scratch_rows (
        id integer primary key,
        branch_id uuid not null references branches (id),
        label text not null
      )
    `.execute(database.migrator);
    await sql`grant select, insert, update, delete on scratch_rows to sodiq_app`.execute(
      database.migrator,
    );
    await addBranchFilter(database.migrator, 'scratch_rows');
    await sql`
      insert into scratch_rows (id, branch_id, label)
      values (1, ${north}, 'north row'), (2, ${south}, 'south row'), (3, ${east}, 'east row')
    `.execute(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  async function labels(connection: Transaction | TestDatabase['app']): Promise<string[]> {
    const found = await sql<{ label: string }>`select label from scratch_rows order by id`.execute(
      connection,
    );
    return found.rows.map((row) => row.label);
  }

  it('a row of another branch is invisible', async () => {
    expect(await transactions.run([north], labels)).toEqual(['north row']);
    expect(await transactions.run([south], labels)).toEqual(['south row']);
  });

  it('a list of branches shows the rows of each and of no other', async () => {
    expect(await transactions.run([north, east], labels)).toEqual(['north row', 'east row']);
  });

  it('nothing set shows no rows', async () => {
    expect(await transactions.run([], labels)).toEqual([]);
    // A query outside the helper, on a plain connection.
    expect(await labels(database.app)).toEqual([]);
    expect(await database.app.transaction().execute(labels)).toEqual([]);
  });

  it('a branch that does not exist shows no rows', async () => {
    expect(await transactions.run(['0199b2f4-6c1e-7a52-9d3b-4f8e2a1c7b60'], labels)).toEqual([]);
  });

  it('the owner of the tables is not filtered, which is why these tests run as sodiq_app', async () => {
    expect(await labels(database.migrator)).toHaveLength(3);
  });

  describe('writing', () => {
    it('a row can be written for the branch of the transaction', async () => {
      await transactions.run([north], async (transaction) => {
        await sql`insert into scratch_rows (id, branch_id, label) values (10, ${north}, 'new')`.execute(
          transaction,
        );
        await sql`delete from scratch_rows where id = 10`.execute(transaction);
      });
    });

    it('a row for another branch is refused by the database', async () => {
      await expect(
        transactions.run([north], (transaction) =>
          sql`insert into scratch_rows (id, branch_id, label) values (11, ${south}, 'x')`.execute(
            transaction,
          ),
        ),
      ).rejects.toMatchObject({ code: ROW_SECURITY_VIOLATION });
    });

    it('a row is refused when nothing is set', async () => {
      await expect(
        sql`insert into scratch_rows (id, branch_id, label) values (12, ${north}, 'x')`.execute(
          database.app,
        ),
      ).rejects.toMatchObject({ code: ROW_SECURITY_VIOLATION });
    });

    it('a row cannot be moved to another branch', async () => {
      await expect(
        transactions.run([north], (transaction) =>
          sql`update scratch_rows set branch_id = ${south} where id = 1`.execute(transaction),
        ),
      ).rejects.toMatchObject({ code: ROW_SECURITY_VIOLATION });
    });

    it('update and delete do not reach the rows of another branch', async () => {
      const changed = await transactions.run([north], async (transaction) => {
        const updated = await sql`update scratch_rows set label = 'changed'`.execute(transaction);
        const deleted = await sql`delete from scratch_rows where id = 2`.execute(transaction);
        // Undo the one row that was reached, so the other tests see the start state.
        await sql`update scratch_rows set label = 'north row'`.execute(transaction);
        return [updated.numAffectedRows, deleted.numAffectedRows];
      });

      expect(changed).toEqual([1n, 0n]);
      expect(await labels(database.migrator)).toEqual(['north row', 'south row', 'east row']);
    });
  });

  describe('on a pooled connection', () => {
    // One connection, so the query after a transaction is certain to get the
    // connection that the transaction used.
    async function onOneConnection(
      end: 'commit' | 'rollback',
    ): Promise<{ samePid: boolean; inside: string[]; after: string[]; setting: string | null }> {
      const single = createDatabase(database.appUrl, { max: 1 });
      const pid = async (connection: Transaction | typeof single) =>
        (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(connection)).rows[0]
          ?.pid;
      try {
        let inside: string[] = [];
        let pidInside: number | undefined;
        const run = new Transactions(single).run([north], async (transaction) => {
          inside = await labels(transaction);
          pidInside = await pid(transaction);
          if (end === 'rollback') {
            throw new Error('rolled back by the test');
          }
        });
        if (end === 'rollback') {
          await expect(run).rejects.toThrow('rolled back by the test');
        } else {
          await run;
        }
        const setting = await sql<{ value: string | null }>`
          select current_setting('app.branch_ids', true) as value
        `.execute(single);
        return {
          samePid: pidInside !== undefined && pidInside === (await pid(single)),
          inside,
          after: await labels(single),
          setting: setting.rows[0]?.value ?? null,
        };
      } finally {
        await single.destroy();
      }
    }

    it.each(['commit', 'rollback'] as const)('the filter does not stay after a %s', async (end) => {
      const seen = await onOneConnection(end);

      expect(seen.samePid).toBe(true);
      expect(seen.inside).toEqual(['north row']);
      expect(seen.after).toEqual([]);
      // PostgreSQL leaves an empty text behind, which the filter reads as "nothing set".
      expect(seen.setting ?? '').toBe('');
    });

    it('two transactions at once each see their own branch', async () => {
      // Each transaction reads only after both have begun, so they overlap.
      let begun = 0;
      let bothBegun: () => void = () => undefined;
      const overlap = new Promise<void>((resolve) => {
        bothBegun = resolve;
      });
      const read = async (transaction: Transaction) => {
        await sql`select 1`.execute(transaction);
        begun += 1;
        if (begun === 2) {
          bothBegun();
        }
        await overlap;
        return labels(transaction);
      };
      const [first, second] = await Promise.all([
        transactions.run([north], read),
        transactions.run([south], read),
      ]);

      expect(first).toEqual(['north row']);
      expect(second).toEqual(['south row']);
    });
  });

  describe('a value that is not a list of branch ids', () => {
    it('is refused by the helper before any query, without repeating it', () => {
      expect(() => branchFilterValue([north, 'everything'])).toThrow('not a branch id');
      expect(() => branchFilterValue([`${north}},{`])).toThrow('not a branch id');
      let message = '';
      try {
        branchFilterValue(['Typed-Value-4417']);
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain('not a branch id');
      expect(message).not.toContain('Typed-Value-4417');
    });

    it('is refused by the helper as a rejected promise', async () => {
      await expect(transactions.run(['everything'], labels)).rejects.toThrow('not a branch id');
    });

    it('set past the helper gives an error, never all rows', async () => {
      await expect(
        database.app.transaction().execute(async (transaction) => {
          await sql`select set_config('app.branch_ids', 'everything', true)`.execute(transaction);
          return labels(transaction);
        }),
      ).rejects.toMatchObject({ code: INVALID_TEXT });
    });
  });

  describe('the transaction helper', () => {
    // A superuser, a user with BYPASSRLS and the owner of the tables are not
    // filtered at all. The application must never run as one of them.
    it('gives no transaction to a database user that is not subject to the filter', async () => {
      const asOwner = new Transactions(database.migrator);

      await expect(asOwner.run([north], labels)).rejects.toThrow(
        'not subject to the branch filter',
      );
      await expect(asOwner.run([], () => Promise.resolve('ran'))).rejects.toThrow(
        'not subject to the branch filter',
      );
    });

    it('keeps the changes when the work returns', async () => {
      await transactions.run([east], (transaction) =>
        sql`insert into scratch_rows (id, branch_id, label) values (20, ${east}, 'kept')`.execute(
          transaction,
        ),
      );

      expect(await transactions.run([east], labels)).toEqual(['east row', 'kept']);
      await sql`delete from scratch_rows where id = 20`.execute(database.migrator);
    });

    it('drops the changes when the work throws', async () => {
      await expect(
        transactions.run([east], async (transaction) => {
          await sql`insert into scratch_rows (id, branch_id, label) values (21, ${east}, 'lost')`.execute(
            transaction,
          );
          throw new Error('stopped by the test');
        }),
      ).rejects.toThrow('stopped by the test');

      expect(await transactions.run([east], labels)).toEqual(['east row']);
    });
  });

  // Task 1.6, correction 2 of pull request #49: the branch create enters the
  // branch it inserted, for the rest of that one transaction, and nothing else.
  describe('entering a branch just created', () => {
    const insertNew = (transaction: Transaction, name: string) =>
      sql<{ id: string }>`insert into branches (name) values (${name}) returning id`
        .execute(transaction)
        .then((result) => result.rows[0]?.id ?? '');

    it('sees and writes the rows of the new branch for the rest of that transaction', async () => {
      const seen = await transactions.run([], async (transaction) => {
        const created = await insertNew(transaction, 'Entered');
        expect(await labels(transaction)).toEqual([]);
        await transactions.enterCreatedBranch(transaction, created);
        await sql`insert into scratch_rows (id, branch_id, label) values (30, ${created}, 'new branch row')`.execute(
          transaction,
        );
        return labels(transaction);
      });

      expect(seen).toEqual(['new branch row']);
      // The next transaction starts with the filter of its own request.
      expect(await transactions.run([], labels)).toEqual([]);
      expect(await transactions.run([north], labels)).toEqual(['north row']);
      await sql`delete from scratch_rows where id = 30`.execute(database.migrator);
    });

    it('refuses a branch this transaction did not insert', async () => {
      await expect(
        transactions.run([], (transaction) => transactions.enterCreatedBranch(transaction, north)),
      ).rejects.toThrow('Only a branch written by this transaction');
    });

    // The row cannot tell an insert from an update: a branch this transaction
    // updated is entered too. Only the branch create calls it, with the id its
    // insert returned, from a transaction that works for no branch.
    it('enters a branch this transaction updated, as it cannot tell it from one inserted', async () => {
      const entered = await transactions.run([], async (transaction) => {
        await sql`update branches set name = name where id = ${east}`.execute(transaction);
        await transactions.enterCreatedBranch(transaction, east);
        return labels(transaction);
      });
      expect(entered).toEqual(['east row']);
    });

    it('refuses a transaction that already works for a branch', async () => {
      await expect(
        transactions.run([south], async (transaction) => {
          const created = await insertNew(transaction, 'Widened');
          await transactions.enterCreatedBranch(transaction, created);
        }),
      ).rejects.toThrow('Only a branch written by this transaction');
    });

    it('refuses what is not a branch id', async () => {
      await expect(
        transactions.run([], (transaction) => transactions.enterCreatedBranch(transaction, "x'}")),
      ).rejects.toThrow('not a branch id');
    });
  });
});
