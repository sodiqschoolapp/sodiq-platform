import { describe, expect, it } from 'vitest';
import { studentMergeQuerySchema, studentMergeSchema } from './student-merges.js';

// Task 3.3d, pull request #98: the body of a merge (decisions 11 and 12,
// correction 3) and the preview's query.
describe('the merge of two student records', () => {
  const digest = 'ab'.repeat(32);

  it('takes a UID, a trimmed reason of 1 to 500 characters and the digest of the preview', () => {
    expect(
      studentMergeSchema.parse({ uid: ' 2607001 ', reason: '  Created twice ', digest }),
    ).toEqual({ uid: '2607001', reason: 'Created twice', digest });
    expect(studentMergeSchema.safeParse({ uid: '2607001', reason: '   ', digest }).success).toBe(
      false,
    );
    expect(
      studentMergeSchema.safeParse({ uid: '2607001', reason: 'x'.repeat(501), digest }).success,
    ).toBe(false);
    expect(
      studentMergeSchema.safeParse({ uid: '2607001', reason: 'x'.repeat(500), digest }).success,
    ).toBe(true);
  });

  it('refuses a digest that is not 64 hexadecimal digits, an empty or too long UID and any other field', () => {
    for (const body of [
      { uid: '2607001', reason: 'Twice', digest: 'AB'.repeat(32) },
      { uid: '2607001', reason: 'Twice', digest: 'ab'.repeat(31) },
      // Task 9.4c: a UID is 1 to 20 characters in any form.
      { uid: '', reason: 'Twice', digest },
      { uid: 'A'.repeat(21), reason: 'Twice', digest },
      { uid: '2607001', reason: 'Twice', digest, keptId: '0199f200-0000-7000-8000-000000000001' },
    ]) {
      expect(studentMergeSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(studentMergeQuerySchema.safeParse({ uid: ' ' }).success).toBe(false);
    expect(studentMergeQuerySchema.parse({ uid: ' si 26070A1' }).uid).toBe('si26070A1');
  });
});
