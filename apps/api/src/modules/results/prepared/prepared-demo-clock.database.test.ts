import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, transactionMoment } from '../../../database/transactions.js';
import { insertBranch } from '../../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../../testing/classes-kit.js';
import { createTestApp } from '../../../testing/create-test-app.js';
import { FixedClock } from '../../../testing/fixed-clock.js';
import { signInKit } from '../../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../../testing/test-database.js';
import { encode } from './codec.js';
import { freshUnits, PREPARED_BEHIND_MS, PREPARED_SHAPE } from './prepared.query.js';

// Task 10.1c (the plan's tests; code review, must-fix 1): with the demo clock on (task 10.5), a
// prepared total may be two minutes behind the journal in demo time. A change carries the
// moment of its transaction (`app.now`, demo time), and a reader compares it with the moment of
// its own transaction, never with the server's real time or the database's `now()`.
// `edge/system-behaviour`, "Report totals are two minutes behind the journal". All names are
// invented.

/** Wednesday 4 November 2026, 10:00 in Tashkent, real time. */
const REAL_START = '2026-11-04T10:00:00+05:00';
/** Thursday 12 November 2026, 09:00 in Tashkent: 8 days on, in demo time. */
const DEMO_TO = '2026-11-12T09:00:00+05:00';

describe('the two minutes of a prepared total under the demo clock', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let branch: string;
  let quarter: string;
  const real = new FixedClock(REAL_START);

  beforeAll(async () => {
    database = await createTestDatabase();
    branch = await insertBranch(database.migrator, 'North');
    const year = await new ClassesKit(database.migrator).year(branch);
    quarter = (
      await database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    app = await createTestApp({
      database: database.app,
      jobsDatabaseUrl: database.appUrl,
      demoClock: { real },
    });
    const kit = signInKit(app);
    const admin = await kit.completeSession('Dilnoza', 'Karimova');
    await kit.giveRole(admin.account.id, { role: 'super_admin' });
    const jumped = await kit
      .post('/api/setup/demo-clock/jumps', admin.cookie)
      .send({ to: DEMO_TO });
    expect(jumped.status, JSON.stringify(jumped.body)).toBe(200);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('reads a unit prepared until its change is two minutes old in demo time, then from source', async () => {
    const unit = randomUUID();
    const journal = randomUUID();
    // A preparation of the unit that has seen nothing after this moment.
    await sql`
      insert into report_prepared (
        branch_id, kind, quarter_id, unit_id, journal_ids, seen, school_inputs, prepared_at,
        next_change_at, value
      ) values (
        ${branch}, 'figures', ${quarter}, ${unit}, ${[journal]}::uuid[], pg_current_snapshot(),
        ${PREPARED_SHAPE}, ${new Date(DEMO_TO)}, null,
        ${JSON.stringify(encode({ figures: new Map(), work: new Map() }))}::jsonb
      )
    `.execute(database.migrator);
    // A change of the unit's journal, written in a transaction of the application.
    const changedAt = await app.get(Transactions).run([branch], async (transaction) => {
      await sql`
        select report_changed_rows(${JSON.stringify([
          { branch_id: branch, quarter_id: quarter, journal_id: journal },
        ])}::jsonb)
      `.execute(transaction);
      return transactionMoment(transaction);
    });
    const stored = await database.migrator
      .selectFrom('report_changes')
      .select('changed_at')
      .where('journal_id', '=', journal)
      .executeTakeFirstOrThrow();
    // The change carries demo time, 8 days ahead of real time.
    expect(stored.changed_at).toEqual(changedAt);
    expect(changedAt.getTime() - real.now().getTime()).toBeGreaterThan(7 * 24 * 3_600_000);

    const readable = () =>
      app.get(Transactions).run([branch], async (transaction) => {
        const fresh = await freshUnits(transaction, {
          branchId: branch,
          kind: 'figures',
          quarterId: quarter,
          unitIds: [unit],
          now: await transactionMoment(transaction),
          schoolInputs: PREPARED_SHAPE,
        });
        return fresh.has(unit);
      });
    // Real time moves the demo clock with it, the offset kept.
    real.advance(PREPARED_BEHIND_MS - 1_000);
    expect(await readable()).toBe(true);
    real.advance(2_000);
    expect(await readable()).toBe(false);
  });
});
