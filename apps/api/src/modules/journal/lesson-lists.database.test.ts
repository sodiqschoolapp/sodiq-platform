import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { deliveryMarksOf, storedWorks } from './journal-works.query.js';
import { lessonStatuses } from './lesson-status.query.js';

// The Speed run at three times the data (28 October 2026) found the closing
// checklist failing (500): it reads every lesson of a branch's quarter, and
// `storedWorks` sent each lesson twice, one parameter each ("bind message has
// 33166 parameter formats", 98,702 wrapped), `deliveryMarksOf` once (82,119).
// A statement holds at most 65,535 parameters.
describe('readers of a quarter of lessons', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let branch: string;
  const lessons = Array.from({ length: 70_000 }, () => randomUUID());

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock('2027-05-20T10:00:00+05:00'));
    branch = await insertBranch(database.migrator, 'North');
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('reads the works of more lessons than one statement holds parameters', async () => {
    const works = await transactions.run([branch], (transaction) =>
      storedWorks(transaction, lessons),
    );
    expect(works).toEqual([]);
  });

  it('reads the delivery marks of more lessons than one statement holds parameters', async () => {
    const marks = await transactions.run([branch], (transaction) =>
      deliveryMarksOf(transaction, lessons),
    );
    expect(marks.notGiven.size + marks.notDelivered.size).toBe(0);
  });

  it('reads the status of more lessons than one statement holds parameters', async () => {
    const statuses = await transactions.run([branch], (transaction) =>
      lessonStatuses(transaction, branch, lessons, new Date('2027-05-20T05:00:00Z')),
    );
    expect(statuses.size).toBe(0);
  });
});
