import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { exactNumeric } from './database.js';

// Task 11.25a (decision 9 of the plan review of pull request #395): a `numeric` arrives as a JS
// number, and a text a number cannot hold exactly is refused, never rounded (CLAUDE.md, Exact
// arithmetic). The scores and totals of `work_amount` (0188) are its first values.
describe('the reader of numeric', () => {
  it('reads a value as the number it names, without trailing zeros', () => {
    expect(exactNumeric('8')).toBe(8);
    expect(exactNumeric('7.50')).toBe(7.5);
    expect(exactNumeric('8.25')).toBe(8.25);
    expect(exactNumeric('1000.00')).toBe(1000);
    expect(exactNumeric('0.00')).toBe(0);
    expect(exactNumeric('0.05')).toBe(0.05);
    expect(exactNumeric('-1.5')).toBe(-1.5);
    expect(exactNumeric('1500')).toBe(1500);
  });

  it('refuses a value a number cannot hold exactly', () => {
    expect(() => exactNumeric('12345678901234567.1')).toThrow(/cannot be held exactly/);
    expect(() => exactNumeric('12345678901234567')).toThrow(/cannot be held exactly/);
    expect(() => exactNumeric('0.1234567890123456789')).toThrow(/cannot be held exactly/);
  });

  it('refuses what is not a plain decimal', () => {
    expect(() => exactNumeric('NaN')).toThrow(/not a plain decimal/);
    expect(() => exactNumeric('Infinity')).toThrow(/not a plain decimal/);
  });

  describe('through the driver', () => {
    let database: TestDatabase;

    beforeAll(async () => {
      database = await createTestDatabase();
    });

    afterAll(async () => {
      await database.destroy();
    });

    it('gives a work_amount and a numeric as numbers, as the application reads them', async () => {
      const { rows } = await sql<{ amount: number; plain: number; whole: number }>`
        select 7.50::work_amount as amount, 8.25::numeric as plain, 8::work_amount as whole
      `.execute(database.app);
      expect(rows).toEqual([{ amount: 7.5, plain: 8.25, whole: 8 }]);
    });

    it('refuses a numeric too long for a number in place of rounding it', async () => {
      await expect(
        sql`select 12345678901234567.1::numeric as value`.execute(database.app),
      ).rejects.toThrow(/cannot be held exactly/);
    });

    it('refuses a numeric array', async () => {
      await expect(
        sql`select array[1.5, 2]::numeric[] as value`.execute(database.app),
      ).rejects.toThrow(/numeric array is not supported/);
    });
  });
});
