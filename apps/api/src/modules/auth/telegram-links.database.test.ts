import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { MembersKit } from '../../testing/members-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const AT = new Date('2026-11-07T10:00:00+05:00');

// Task 11.4 (pull request #298): the Telegram chat links of db/migrations/0160. "One account is
// linked to one chat, and one chat to one account" (`10`, Telegram) is held by the database; a
// link belongs to a Parent account only; the application may end a link, never delete or move
// one. Every name and Telegram id is invented.
describe('Telegram links in the database', () => {
  let database: TestDatabase;
  let count = 0;
  let chat = 7_400_000;
  let members: MembersKit;
  let branch: string;

  const nextChat = (): string => {
    chat += 1;
    return String(chat);
  };

  async function account(): Promise<string> {
    count += 1;
    const row = await database.migrator
      .insertInto('accounts')
      .values({
        login: `t.link${String(count)
          .padStart(3, '0')
          .replace(/\d/g, (d) => 'abcdefghij'.charAt(Number(d)))}`,
        password_hash: '$argon2id$v=19$m=19456,t=2,p=1$invented$invented',
        must_change_password: false,
        created_at: AT,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** A Parent account: the account of the relative of a student (`relative_accounts`, 0158). */
  async function parentAccount(): Promise<string> {
    const accountId = await account();
    const studentId = await members.student(branch);
    const link = await database.migrator
      .selectFrom('student_relatives')
      .select('relative_id')
      .where('student_id', '=', studentId)
      .executeTakeFirstOrThrow();
    await database.migrator
      .updateTable('relative_accounts')
      .set({ account_id: accountId, switched_on_at: AT })
      .where('relative_id', '=', link.relative_id)
      .execute();
    return accountId;
  }

  const insertLink = (accountId: string, telegramUserId: string) =>
    database.app
      .insertInto('telegram_links')
      .values({ account_id: accountId, telegram_user_id: telegramUserId, linked_at: AT })
      .returning('id')
      .executeTakeFirstOrThrow();

  const codeOf = async (
    work: Promise<unknown>,
  ): Promise<{ code?: string; constraint?: string }> => {
    try {
      await work;
    } catch (error) {
      return error as { code?: string; constraint?: string };
    }
    return {};
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    branch = await insertBranch(database.migrator, 'North');
    members = new MembersKit(database.migrator, await account());
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('holds one open link per account', async () => {
    const parent = await parentAccount();
    await insertLink(parent, nextChat());
    expect(await codeOf(insertLink(parent, nextChat()))).toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'telegram_links_open_account_key',
    });
  });

  it('holds one open link per chat', async () => {
    const shared = nextChat();
    await insertLink(await parentAccount(), shared);
    expect(await codeOf(insertLink(await parentAccount(), shared))).toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'telegram_links_open_chat_key',
    });
  });

  it('lets a new link in once the old one ended, for the account and for the chat', async () => {
    const parent = await parentAccount();
    const shared = nextChat();
    const first = await insertLink(parent, shared);
    await database.app
      .updateTable('telegram_links')
      .set({ ended_at: AT, end_reason: 'moved' })
      .where('id', '=', first.id)
      .execute();
    await insertLink(parent, shared);
  });

  it('refuses a link of a staff account', async () => {
    expect(await codeOf(insertLink(await account(), nextChat()))).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'telegram_link_not_parent',
    });
  });

  it('refuses an end without its reason, and an end reason the list does not hold', async () => {
    const link = await insertLink(await parentAccount(), nextChat());
    expect(
      await codeOf(
        database.app
          .updateTable('telegram_links')
          .set({ ended_at: AT })
          .where('id', '=', link.id)
          .execute(),
      ),
    ).toMatchObject({ code: CHECK_VIOLATION });
    expect(
      await codeOf(
        database.app
          .updateTable('telegram_links')
          .set({ ended_at: AT, end_reason: 'forgotten' })
          .where('id', '=', link.id)
          .execute(),
      ),
    ).toMatchObject({ code: CHECK_VIOLATION });
  });

  it('lets the application neither delete a link nor move it to another account or chat', async () => {
    const link = await insertLink(await parentAccount(), nextChat());
    const other = await parentAccount();
    for (const work of [
      () => database.app.deleteFrom('telegram_links').where('id', '=', link.id).execute(),
      () =>
        database.app
          .updateTable('telegram_links')
          .set({ account_id: other })
          .where('id', '=', link.id)
          .execute(),
      () =>
        database.app
          .updateTable('telegram_links')
          .set({ telegram_user_id: nextChat() })
          .where('id', '=', link.id)
          .execute(),
      () =>
        database.app
          .updateTable('telegram_links')
          .set({ linked_at: AT })
          .where('id', '=', link.id)
          .execute(),
    ]) {
      expect(await codeOf(work())).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    }
  });

  it('takes the new end reason of a session, and no other', async () => {
    const parent = await parentAccount();
    const session = await database.migrator
      .insertInto('sessions')
      .values({ account_id: parent, token_hash: 'a'.repeat(64), created_at: AT, last_used_at: AT })
      .returning('id')
      .executeTakeFirstOrThrow();
    await database.app
      .updateTable('sessions')
      .set({ ended_at: AT, end_reason: 'telegram_unlinked' })
      .where('id', '=', session.id)
      .execute();
    expect(
      await codeOf(
        database.migrator
          .updateTable('sessions')
          .set({ end_reason: 'telegram_gone' })
          .where('id', '=', session.id)
          .execute(),
      ),
    ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'sessions_end_reason_check' });
  });
});
