import type { INestApplication } from '@nestjs/common';
import type { LogEvent } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../database/database.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { ProbeController, signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

// Task 10.1c (code review round 1, finding 1): the reads of one page come at once with one
// session. The use of the session (the update of `last_used_at`) holds the session's row to the
// end of its transaction, so it comes after every other read of the session's transaction: the
// reads of a page queue only on the use itself, never on the reads of another request. All
// names are invented.
describe('the use of a session', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  const queries: string[] = [];
  const clock = new FixedClock('2026-10-05T09:00:00+05:00');

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      database: createDatabase(database.appUrl, {
        log: (event: LogEvent) => {
          queries.push(event.query.sql.replace(/\s+/g, ' '));
        },
      }),
      clock,
      controllers: [ProbeController],
    });
    kit = signInKit(app);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('comes after the reads of the account, the staff status and the second step', async () => {
    const { cookie } = await kit.completeSession('Kamol', 'Latipov');
    queries.length = 0;
    expect((await kit.probe(cookie)).status).toBe(200);
    const use = queries.findIndex((one) => one.startsWith('update "sessions" set "last_used_at"'));
    expect(use).toBeGreaterThan(0);
    const before = queries.slice(0, use);
    expect(before.some((one) => one.includes('from "accounts"'))).toBe(true);
    expect(before.some((one) => one.includes('staff_account_blocked'))).toBe(true);
    expect(before.some((one) => one.includes('"second_step_passed_at" from "sessions"'))).toBe(
      true,
    );
    // After the use, the transaction of the session reads nothing more of the account: the next
    // statements are its commit and its checks.
    const after = queries.slice(
      use + 1,
      queries.findIndex((one, index) => index > use && one === 'commit'),
    );
    expect(after.some((one) => one.includes('from "accounts"'))).toBe(false);
  });
});
