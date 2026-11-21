import { INTEGRATION_KEY_NAME_MAX_LENGTH } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemClock } from '../../clock/system-clock.js';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA';
const MOMENT = new Date('2026-11-21T09:00:00+05:00');

// The rules of integration keys that the database keeps itself (db/migrations/0175; task 10.9),
// also when the application has a fault: only a hash is stored, a name is bounded and unique
// among the keys not revoked, a revoked key is never restored or changed, a removed person
// does not come back on the same row, and the application deletes nothing.
describe('integration keys in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let accountId: string;
  let staffA: string;
  let staffB: string;
  let hashes = 0;

  const hash = (): string => {
    hashes += 1;
    return hashes.toString(16).padStart(64, '0');
  };

  const asApp = (statement: string): Promise<unknown> =>
    transactions.run([], (transaction) => sql.raw(statement).execute(transaction));

  const codeOf = async (work: Promise<unknown>): Promise<string | undefined> => {
    try {
      await work;
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  };

  /** A key written as the application, ending on 31 December 2026. */
  function insertKey(name: string, secretHash = hash()): Promise<string> {
    return transactions.run([], async (transaction) => {
      const row = await transaction
        .insertInto('integration_keys')
        .values({
          name,
          secret_hash: secretHash,
          ends_on: '2026-12-31',
          ends_at: new Date('2026-12-31T19:00:00Z'),
          created_at: MOMENT,
          created_by: accountId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
  }

  const addPerson = (keyId: string, staffId: string): Promise<{ id: string }> =>
    transactions.run([], (transaction) =>
      transaction
        .insertInto('integration_key_people')
        .values({ key_id: keyId, staff_id: staffId, added_at: MOMENT, added_by: accountId })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );

  const revoke = (keyId: string): Promise<unknown> =>
    asApp(
      `update integration_keys set revoked_at = '2026-11-21T10:00:00+05', revoked_by = '${accountId}' where id = '${keyId}'`,
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    const account = await database.migrator
      .insertInto('accounts')
      .values({
        login: 'd.keyova',
        password_hash: HASH,
        must_change_password: false,
        created_at: MOMENT,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    accountId = account.id;
    const branch = await insertBranch(database.migrator, 'North');
    const people = new ClassesKit(database.migrator);
    const staff = [
      await people.person(branch, ['uz'], { last: 'Keyova' }),
      await people.person(branch, ['uz'], { last: 'Keyovb' }),
    ];
    [staffA, staffB] = staff.map((row) => row.staffId) as [string, string];
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('bounds the name as the shared constant does', async () => {
    expect(await codeOf(insertKey('x'.repeat(INTEGRATION_KEY_NAME_MAX_LENGTH)))).toBeUndefined();
    expect(await codeOf(insertKey('x'.repeat(INTEGRATION_KEY_NAME_MAX_LENGTH + 1)))).toBe(
      CHECK_VIOLATION,
    );
    expect(await codeOf(insertKey('   '))).toBe(CHECK_VIOLATION);
  });

  it('stores only a SHA-256 hash, each once', async () => {
    expect(await codeOf(insertKey('Secret platform', 'sodiq_ik_plain-secret'))).toBe(
      CHECK_VIOLATION,
    );
    const taken = hash();
    await insertKey('First hash', taken);
    expect(await codeOf(insertKey('Second hash', taken))).toBe(UNIQUE_VIOLATION);
  });

  it('keeps the end moment at the start of the next day in Tashkent', async () => {
    const work = transactions.run([], (transaction) =>
      transaction
        .insertInto('integration_keys')
        .values({
          name: 'Wrong end',
          secret_hash: hash(),
          ends_on: '2026-12-31',
          ends_at: new Date('2027-01-01T00:00:00Z'),
          created_at: MOMENT,
          created_by: accountId,
        })
        .execute(),
    );
    expect(await codeOf(work)).toBe(CHECK_VIOLATION);
  });

  it('refuses a name taken by a key not revoked, in another case or in Cyrillic, and frees it at the revoke', async () => {
    const first = await insertKey('English platform');
    expect(await codeOf(insertKey('ENGLISH PLATFORM '))).toBe(UNIQUE_VIOLATION);
    const cyrillic = await insertKey('Английская платформа');
    expect(await codeOf(insertKey('АНГЛИЙСКАЯ ПЛАТФОРМА'))).toBe(UNIQUE_VIOLATION);
    await revoke(first);
    await revoke(cyrillic);
    expect(await codeOf(insertKey('English platform'))).toBeUndefined();
  });

  it('never restores or changes a revoked key, but writes its last use', async () => {
    const key = await insertKey('Revoked platform');
    await revoke(key);
    expect(
      await codeOf(
        asApp(
          `update integration_keys set revoked_at = null, revoked_by = null where id = '${key}'`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await codeOf(
        asApp(
          `update integration_keys set revoked_at = '2026-11-22T10:00:00+05' where id = '${key}'`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await codeOf(
        asApp(
          `update integration_keys set ends_on = '2026-12-30', ends_at = '2026-12-30T19:00:00Z' where id = '${key}'`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await codeOf(
        asApp(
          `update integration_keys set last_used_at = '2026-11-21T11:00:00+05' where id = '${key}'`,
        ),
      ),
    ).toBeUndefined();
  });

  it('refuses a person put on or taken off a revoked key', async () => {
    const key = await insertKey('Closed platform');
    const row = await addPerson(key, staffA);
    await revoke(key);
    expect(await codeOf(addPerson(key, staffB))).toBe(CHECK_VIOLATION);
    expect(
      await codeOf(
        asApp(
          `update integration_key_people set removed_at = '2026-11-21T11:00:00+05', removed_by = '${accountId}' where id = '${row.id}'`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('puts a person on a key once at a time, and never brings a removed row back', async () => {
    const key = await insertKey('People platform');
    const row = await addPerson(key, staffA);
    expect(await codeOf(addPerson(key, staffA))).toBe(UNIQUE_VIOLATION);
    await asApp(
      `update integration_key_people set removed_at = '2026-11-21T11:00:00+05', removed_by = '${accountId}' where id = '${row.id}'`,
    );
    expect(
      await codeOf(
        asApp(
          `update integration_key_people set removed_at = null, removed_by = null where id = '${row.id}'`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
    // Put back on a new row.
    expect(await codeOf(addPerson(key, staffA))).toBeUndefined();
  });

  it('lets the application delete nothing and change no hash, name or creation', async () => {
    const key = await insertKey('Grant platform');
    await addPerson(key, staffB);
    for (const statement of [
      `delete from integration_keys where id = '${key}'`,
      `delete from integration_key_people where key_id = '${key}'`,
      `update integration_keys set secret_hash = '${hash()}' where id = '${key}'`,
      `update integration_keys set name = 'Other' where id = '${key}'`,
      `update integration_keys set created_at = now() where id = '${key}'`,
      `update integration_keys set created_by = '${accountId}' where id = '${key}'`,
      `update integration_key_people set staff_id = '${staffA}' where key_id = '${key}'`,
      `update integration_key_people set added_at = now() where key_id = '${key}'`,
    ]) {
      expect(await codeOf(asApp(statement)), statement).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });
});
