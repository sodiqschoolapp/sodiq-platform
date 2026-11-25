import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemClock } from '../../clock/system-clock.js';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

const MOMENT = new Date('2026-11-25T09:00:00+05:00');

// Task 11.22, migration 0185 (review of the plan, correction 4; `CLAUDE.md`, Branch on every row;
// The database guards the rules): the files of the assistant and their links to messages are
// tables of a branch with the branch filter, insert-only for the application; a file belongs to
// one message, and a link never joins a file of one branch to a message of another.
describe('the files of the assistant in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let account: string;

  const codeOf = async (work: Promise<unknown>): Promise<string | undefined> => {
    try {
      await work;
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  };

  /** A question of a conversation of the branch, written by the migrator. */
  async function question(branch: string): Promise<string> {
    const conversation = await database.migrator
      .insertInto('assistant_conversations')
      .values({
        branch_id: branch,
        account_id: account,
        role: 'super_admin',
        title: 'Files.',
        created_at: MOMENT,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const message = await database.migrator
      .insertInto('assistant_messages')
      .values({
        conversation_id: conversation.id,
        branch_id: branch,
        account_id: account,
        seq: 1,
        kind: 'question',
        content: sql`'{"kind":"question","text":"Read it."}'::jsonb`,
        created_at: MOMENT,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return message.id;
  }

  /** A file of the branch, written as the application in that branch. */
  function file(branch: string, id = randomUUID()): Promise<string> {
    return transactions.run([branch], async (transaction) => {
      await transaction
        .insertInto('assistant_files')
        .values({
          id,
          branch_id: branch,
          account_id: account,
          kind: 'attachment',
          name: 'list.png',
          media_type: 'image/png',
          size_bytes: 64,
          store_key: `assistant/${id}`,
          created_at: MOMENT,
        })
        .execute();
      return id;
    });
  }

  const link = (branch: string, messageId: string, fileId: string, position = 1) =>
    transactions.run([branch], (transaction) =>
      transaction
        .insertInto('assistant_message_files')
        .values({ message_id: messageId, file_id: fileId, branch_id: branch, position })
        .execute(),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    account = await new ClassesKit(database.migrator).account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('keeps each branch’s files and links to that branch', async () => {
    const northFile = await file(north);
    const southFile = await file(south);
    await link(north, await question(north), northFile);
    const seen = await transactions.run([north], async (transaction) => ({
      files: (await transaction.selectFrom('assistant_files').select('id').execute()).map(
        (row) => row.id,
      ),
      links: (
        await transaction.selectFrom('assistant_message_files').select('file_id').execute()
      ).map((row) => row.file_id),
    }));
    expect(seen.files).toContain(northFile);
    expect(seen.files).not.toContain(southFile);
    expect(seen.links).toEqual([northFile]);
    // A row of another branch is refused by the filter's check.
    expect(
      await codeOf(
        file(south).then(() =>
          transactions.run([north], async (transaction) => {
            const id = randomUUID();
            await transaction
              .insertInto('assistant_files')
              .values({
                id,
                branch_id: south,
                account_id: account,
                kind: 'attachment',
                name: 'list.png',
                media_type: 'image/png',
                size_bytes: 64,
                store_key: `assistant/${id}`,
                created_at: MOMENT,
              })
              .execute();
          }),
        ),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('gives the application no update and no delete of either table', async () => {
    const fileId = await file(north);
    await link(north, await question(north), fileId);
    for (const statement of [
      `update assistant_files set name = 'other.png' where id = '${fileId}'`,
      `delete from assistant_files where id = '${fileId}'`,
      `update assistant_message_files set position = 2 where file_id = '${fileId}'`,
      `delete from assistant_message_files where file_id = '${fileId}'`,
    ]) {
      expect(
        await codeOf(
          transactions.run([north], (transaction) => sql.raw(statement).execute(transaction)),
        ),
        statement,
      ).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it('links a file to one message only', async () => {
    const fileId = await file(north);
    await link(north, await question(north), fileId);
    expect(await codeOf(link(north, await question(north), fileId))).toBe(UNIQUE_VIOLATION);
  });

  it('refuses a link between a file of one branch and a message of another (correction 4)', async () => {
    const southFile = await file(south);
    const northQuestion = await question(north);
    // Written past the filter, as a fault of the application could: the foreign key refuses it.
    expect(
      await codeOf(
        database.migrator
          .insertInto('assistant_message_files')
          .values({ message_id: northQuestion, file_id: southFile, branch_id: north, position: 1 })
          .execute(),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
    expect(
      await codeOf(
        database.migrator
          .insertInto('assistant_message_files')
          .values({ message_id: northQuestion, file_id: southFile, branch_id: south, position: 1 })
          .execute(),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('holds the key to the file’s id, the size to 10 MB and the type to the list', async () => {
    const id = randomUUID();
    const insert = (
      values: Partial<{ store_key: string; size_bytes: number; media_type: string }>,
    ) =>
      transactions.run([north], (transaction) =>
        transaction
          .insertInto('assistant_files')
          .values({
            id,
            branch_id: north,
            account_id: account,
            kind: 'attachment',
            name: 'list.png',
            media_type: 'image/png',
            size_bytes: 64,
            store_key: `assistant/${id}`,
            created_at: MOMENT,
            ...values,
          })
          .execute(),
      );
    expect(await codeOf(insert({ store_key: `assistant/${randomUUID()}` }))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert({ size_bytes: 10_000_001 }))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert({ media_type: 'text/csv' }))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert({ size_bytes: 10_000_000 }))).toBeUndefined();
  });
});
