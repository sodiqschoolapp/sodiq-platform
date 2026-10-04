import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ROLES } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { SecondStepKeyCheck, SecondStepKeyError } from './second-step-key-check.js';
import { SecondStepRule } from './second-step-rule.js';
import { SecondStepSecrets } from './second-step-secrets.js';

// Invented for the tests.
const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 8).toString('base64');
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA';
const SECRET = Buffer.from('12345678901234567890', 'ascii');

// Task 0.6c, asked for by the owner: when the API or the worker starts and a
// second step is stored, the oldest stored secret must decrypt with
// SECOND_STEP_KEY, or the start is refused.
describe('the check of the key of the second step at start', () => {
  let database: TestDatabase;
  let transactions: Transactions;

  const checkWith = (key: string) =>
    new SecondStepKeyCheck(transactions, new SecondStepSecrets({ secondStepKey: key }));

  /** An account with a stored secret that was encrypted with the given key. */
  async function storedSecret(login: string, key: string, createdAt: string): Promise<void> {
    const account = await sql<{ id: string }>`
      insert into accounts (login, password_hash, must_change_password, created_at)
      values (${login}, ${HASH}, false, ${createdAt}) returning id
    `.execute(database.migrator);
    const accountId = account.rows[0]?.id ?? '';
    const sealed = new SecondStepSecrets({ secondStepKey: key }).seal(accountId, SECRET);
    await sql`
      insert into account_second_steps (account_id, secret, created_at)
      values (${accountId}, ${sealed}, ${createdAt})
    `.execute(database.migrator);
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app);
  });

  beforeEach(async () => {
    await sql`delete from account_second_steps`.execute(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('passes while no second step is stored, whatever the key', async () => {
    await expect(checkWith(KEY).run()).resolves.toBeUndefined();
    await expect(checkWith(OTHER_KEY).run()).resolves.toBeUndefined();
  });

  it('passes with the key the stored secret was encrypted with', async () => {
    await storedSecret('a.karimov', KEY, '2026-10-05T09:00:00+05:00');

    await expect(checkWith(KEY).run()).resolves.toBeUndefined();
  });

  it('refuses another key, with a message that names the variable and holds no key', async () => {
    await storedSecret('b.karimova', KEY, '2026-10-05T09:00:00+05:00');

    const refused = checkWith(OTHER_KEY).run();

    await expect(refused).rejects.toBeInstanceOf(SecondStepKeyError);
    await expect(refused).rejects.toThrow(/SECOND_STEP_KEY/);
    await refused.catch((error: unknown) => {
      expect(String(error)).not.toContain(KEY);
      expect(String(error)).not.toContain(OTHER_KEY);
    });
  });

  // The rare single damaged row is left to the "set up required" path.
  it('looks at the oldest stored secret only', async () => {
    await storedSecret('c.karimov', KEY, '2026-10-05T09:00:00+05:00');
    await storedSecret('d.karimov', OTHER_KEY, '2026-10-06T09:00:00+05:00');

    await expect(checkWith(KEY).run()).resolves.toBeUndefined();
    await expect(checkWith(OTHER_KEY).run()).rejects.toBeInstanceOf(SecondStepKeyError);
  });

  // The check is a call of the entry points, not a start hook: `pnpm
  // api:client` builds the application without a database.
  describe('is run by', () => {
    const source = (file: string) =>
      readFileSync(path.resolve(import.meta.dirname, '../..', file), 'utf8');

    it.each(['main.ts', 'worker.ts'])('%s before it takes requests or jobs', (file) => {
      const text = source(file);
      const check = text.indexOf('app.get(SecondStepKeyCheck).run()');
      const open = text.search(/app\.listen\(|app\.get\(JobRunner\)\.start\(\)/);

      expect(check).toBeGreaterThan(-1);
      expect(open).toBeGreaterThan(check);
    });

    it('not by the command that writes the OpenAPI document', () => {
      expect(source('openapi/cli.ts')).not.toContain('SecondStepKeyCheck');
    });
  });
});

// docs/spec/02-roles-and-access.md, Rules: two-step verification is required
// for the Super Admin and Academic Vice Principal and optional for others. This
// pins what the application itself is wired with: the rule of the spec, by the
// roles of the account, and nothing that replaces it.
describe('the rule of the second step in the application as it runs', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // The application as `main.ts` builds it: nothing replaced.
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is the one of the spec: required with one of the two roles, optional otherwise', () => {
    const rule = app.get(SecondStepRule);

    expect(Object.getPrototypeOf(rule)).toBe(SecondStepRule.prototype);
    for (const role of ROLES) {
      expect(rule.required([role])).toBe(
        role === 'super_admin' || role === 'academic_vice_principal',
      );
    }
    expect(rule.required(['teacher', 'tutor', 'super_admin'])).toBe(true);
    expect(rule.required([])).toBe(false);
  });
});
