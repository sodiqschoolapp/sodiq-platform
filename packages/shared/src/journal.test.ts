import { describe, expect, it } from 'vitest';
import { journalGridQuerySchema, journalListQuerySchema } from './journal.js';

// Task 6.2: the queries of the journal routes take only their own fields.
describe('the journal queries', () => {
  it('take an optional year or quarter id and nothing else', () => {
    expect(journalListQuerySchema.safeParse({}).success).toBe(true);
    expect(journalGridQuerySchema.safeParse({}).success).toBe(true);
    expect(journalGridQuerySchema.safeParse({ quarterId: 'not an id' }).success).toBe(false);
    expect(
      journalListQuerySchema.safeParse({ teacherId: '0199e000-0000-7000-8000-000000000001' })
        .success,
    ).toBe(false);
    expect(journalGridQuerySchema.safeParse({ month: '2026-10' }).success).toBe(false);
  });
});
