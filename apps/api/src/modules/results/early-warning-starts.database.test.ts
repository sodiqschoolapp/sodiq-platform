import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { startsOf } from './early-warning.service.js';

// Task 10.1: the speed run at the school's size found the early-warning list
// failing (500) on a year of lessons: `startsOf` sent every student's lesson,
// one parameter each, and a statement holds at most 65,535 parameters
// ("bind message has 6503 parameter formats", 72,039 wrapped). The lessons of
// one class repeat once per student.
describe('startsOf', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let branch: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock('2027-05-20T10:00:00+05:00'));
    branch = await insertBranch(database.migrator, 'North');
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('reads more lessons than one statement holds parameters, each once', async () => {
    const lessons = Array.from({ length: 3000 }, () => randomUUID());
    // Every lesson named 24 times, as by the students of a class: 72,000 in all.
    const named = Array.from({ length: 24 }, () => lessons).flat();
    expect(named.length).toBeGreaterThan(65_535);
    const starts = await transactions.run([branch], (transaction) => startsOf(transaction, named));
    expect(starts.size).toBe(0);
  });
});
