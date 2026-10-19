import { describe, expect, it } from 'vitest';
import { bulkCancelBodySchema, bulkCancelCheckBodySchema } from './bulk-cancels.js';

const OXFORD = '0199a000-0000-7000-8000-000000000001';
const PRINCETON = '0199a000-0000-7000-8000-000000000002';
const BLOCK = '0199a000-0000-7000-8000-000000000003';

const scope = { date: '2026-10-19', classIds: [OXFORD], lessonNumbers: [1, 2] };
const full = { ...scope, reason: 'Excursion to the museum', blocks: [], lessonIds: [] };

// The input of a bulk cancel (task 5.6a-3, pull request #162): classes, a
// date and lesson numbers (decision 2), a reason, one choice per shared
// block (decision 7) and the lessons the check listed (decision 12).
describe('the input of a bulk cancel', () => {
  it('takes classes, a date and lesson numbers sorted and distinct from 1 to 20', () => {
    expect(bulkCancelCheckBodySchema.safeParse(scope).success).toBe(true);
    expect(bulkCancelCheckBodySchema.safeParse({ ...scope, lessonNumbers: [1, 20] }).success).toBe(
      true,
    );
    for (const lessonNumbers of [[], [2, 1], [1, 1], [0], [21]]) {
      expect(bulkCancelCheckBodySchema.safeParse({ ...scope, lessonNumbers }).success).toBe(false);
    }
  });

  it('takes at least one class, each once', () => {
    expect(
      bulkCancelCheckBodySchema.safeParse({ ...scope, classIds: [OXFORD, PRINCETON] }).success,
    ).toBe(true);
    expect(bulkCancelCheckBodySchema.safeParse({ ...scope, classIds: [] }).success).toBe(false);
    expect(
      bulkCancelCheckBodySchema.safeParse({ ...scope, classIds: [OXFORD, OXFORD] }).success,
    ).toBe(false);
  });

  it('takes a trimmed reason of 1 to 500 characters, one choice per block and each lesson once', () => {
    const parsed = bulkCancelBodySchema.parse({ ...full, reason: '  Excursion  ' });
    expect(parsed.reason).toBe('Excursion');
    for (const reason of ['', '   ', 'a'.repeat(501)]) {
      expect(bulkCancelBodySchema.safeParse({ ...full, reason }).success).toBe(false);
    }
    expect(
      bulkCancelBodySchema.safeParse({ ...full, blocks: [{ blockId: BLOCK, choice: 'keep' }] })
        .success,
    ).toBe(true);
    expect(
      bulkCancelBodySchema.safeParse({
        ...full,
        blocks: [
          { blockId: BLOCK, choice: 'keep' },
          { blockId: BLOCK, choice: 'cancel' },
        ],
      }).success,
    ).toBe(false);
    expect(
      bulkCancelBodySchema.safeParse({ ...full, blocks: [{ blockId: BLOCK, choice: 'move' }] })
        .success,
    ).toBe(false);
    expect(bulkCancelBodySchema.safeParse({ ...full, lessonIds: [BLOCK, BLOCK] }).success).toBe(
      false,
    );
    expect(bulkCancelBodySchema.safeParse({ ...full, extra: true }).success).toBe(false);
  });
});
