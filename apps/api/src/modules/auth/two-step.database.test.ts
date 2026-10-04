import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { idleLimitMs } from './idle-limit.js';
import { secondStepRequired, SECOND_STEP_ROLES } from './second-step-rule.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA';
const SECRET = 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const NOBODY = '00000000-0000-7000-8000-000000000000';

// docs/spec/02-roles-and-access.md, Rules: two-step verification is required
// for the Super Admin and Academic Vice Principal and optional for others.
describe('for whom the second step is required', () => {
  it.each(['super_admin', 'academic_vice_principal'])('is required with the role %s', (role) => {
    expect(secondStepRequired([role])).toBe(true);
  });

  it('is required when one of several roles requires it', () => {
    expect(secondStepRequired(['teacher', 'tutor', 'academic_vice_principal'])).toBe(true);
  });

  it('is optional for every other role and for no role', () => {
    expect(secondStepRequired(['teacher', 'tutor', 'head_teacher', 'principal'])).toBe(false);
    expect(secondStepRequired([])).toBe(false);
  });

  // Task 0.7 renames the roles in one place for both rules.
  it('names the same roles as the short idle limit', () => {
    for (const role of SECOND_STEP_ROLES) {
      expect(idleLimitMs([role])).toBeLessThan(idleLimitMs([]));
    }
  });
});

// The rules of the second step that the database itself keeps
// (db/migrations/0007), also when the application has a fault.
describe('the second step in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let accountId: string;

  /** Runs one statement as the application user, in a school-wide transaction. */
  function asApp(statement: string): Promise<unknown> {
    return transactions.run([], (transaction) => sql.raw(statement).execute(transaction));
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app);
    const inserted = await transactions.run([], (transaction) =>
      transaction
        .insertInto('accounts')
        .values({
          login: 'a.karimov',
          password_hash: HASH,
          must_change_password: false,
          created_at: new Date('2026-10-05T09:00:00+05:00'),
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    accountId = inserted.id;
    await asApp(
      `insert into account_second_steps (account_id, secret, created_at)
       values ('${accountId}', '${SECRET}', '2026-10-05T09:00:00+05:00')`,
    );
    await asApp(
      `insert into sessions (account_id, token_hash, created_at, last_used_at)
       values ('${accountId}', '${'a'.repeat(64)}', '2026-10-05T09:00:00+05:00',
         '2026-10-05T09:00:00+05:00')`,
    );
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('holds one second step per account', async () => {
    await expect(
      asApp(
        `insert into account_second_steps (account_id, secret, created_at)
         values ('${accountId}', '${SECRET}', '2026-10-05T09:00:00+05:00')`,
      ),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('refuses a second step and a recovery code of an account that does not exist', async () => {
    await expect(
      asApp(
        `insert into account_second_steps (account_id, secret, created_at)
         values ('${NOBODY}', '${SECRET}', '2026-10-05T09:00:00+05:00')`,
      ),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    await expect(
      asApp(
        `insert into second_step_recovery_codes (account_id, code_hash)
         values ('${NOBODY}', '${'b'.repeat(64)}')`,
      ),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });

  // Decided by the owner: each stored secret carries the version of its key.
  it.each([
    ['a secret without the version of its key', 'AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAA'],
    ['a secret in plain base32', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'],
    ['a key version of zero', 'v0:AAAA:AAAA'],
    ['an empty secret', ''],
  ])('refuses %s', async (_name, secret) => {
    await expect(
      asApp(`update account_second_steps set secret = '${secret}'`),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it('does not let the application move a second step to another account', async () => {
    await expect(
      asApp(`update account_second_steps set account_id = '${NOBODY}'`),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it('refuses a count of wrong codes below zero', async () => {
    await expect(asApp('update account_second_steps set failures = -1')).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    });
  });

  describe('keeps of a recovery code its hash only', () => {
    it.each([
      ['a code as it is shown', 'abcd-efgh-jkmn-pqrs'],
      ['a hash in capital letters', 'B'.repeat(64)],
      ['a hash that is too short', 'b'.repeat(63)],
    ])('refuses %s', async (_name, stored) => {
      await expect(
        asApp(
          `insert into second_step_recovery_codes (account_id, code_hash)
           values ('${accountId}', '${stored}')`,
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('once per account, and lets the application mark it used but not change it', async () => {
      const insert = `insert into second_step_recovery_codes (account_id, code_hash)
        values ('${accountId}', '${'c'.repeat(64)}')`;
      await asApp(insert);

      await expect(asApp(insert)).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
      await expect(
        asApp(`update second_step_recovery_codes set code_hash = '${'d'.repeat(64)}'`),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      await asApp(`update second_step_recovery_codes set used_at = '2026-10-05T10:00:00+05:00'`);
    });
  });

  it('lets the application write the moment a session passed the second step', async () => {
    await asApp(`update sessions set second_step_passed_at = '2026-10-05T09:01:00+05:00'`);

    const found = await sql<{ second_step_passed_at: Date | null }>`
      select second_step_passed_at from sessions
    `.execute(database.migrator);
    expect(found.rows).toEqual([{ second_step_passed_at: new Date('2026-10-05T09:01:00+05:00') }]);
  });

  it('lets the application remove a second step and its recovery codes', async () => {
    await asApp('delete from second_step_recovery_codes');
    await asApp('delete from account_second_steps');

    const left = await sql<{ rows: number }>`
      select count(*)::int as rows from account_second_steps
    `.execute(database.migrator);
    expect(left.rows).toEqual([{ rows: 0 }]);
  });
});
