import { describe, expect, it } from 'vitest';
import { searchWords } from './names.js';
import {
  limited,
  SEARCH_LIMIT,
  SEARCH_QUERY_MAX_LENGTH,
  searchQuerySchema,
  studentSearchSchema,
} from './search.js';

// Task 3.2d (pull request #94): the query of the search routes and their answers.
describe('the query of a search route', () => {
  it('takes the typed text trimmed', () => {
    expect(searchQuerySchema.parse({ q: '  Oxford ' })).toEqual({ q: 'Oxford' });
  });

  it('refuses an empty text, one of spaces only and one that is too long', () => {
    for (const q of ['', '   ', 'a'.repeat(SEARCH_QUERY_MAX_LENGTH + 1)]) {
      expect(searchQuerySchema.safeParse({ q }).success).toBe(false);
    }
    expect(searchQuerySchema.safeParse({ q: 'a'.repeat(SEARCH_QUERY_MAX_LENGTH) }).success).toBe(
      true,
    );
  });

  it('refuses a missing text and anything else in the query', () => {
    expect(searchQuerySchema.safeParse({}).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: 'Oxford', limit: '50' }).success).toBe(false);
  });
});

describe('the answer of a search route', () => {
  it('holds at most the limit', () => {
    const student = {
      id: '0190a5f0-0000-7000-8000-000000000001',
      uid: '2600001',
      firstName: 'Malika',
      lastName: 'Rahimova',
      paternalName: null,
      class: null,
      status: 'active',
      startsOn: '2026-09-02',
    };
    const items = Array.from({ length: SEARCH_LIMIT + 1 }, () => student);
    expect(studentSearchSchema.safeParse({ items, more: true, today: '2026-10-10' }).success).toBe(
      false,
    );
    expect(
      studentSearchSchema.safeParse({
        items: items.slice(0, SEARCH_LIMIT),
        more: true,
        today: '2026-10-10',
      }).success,
    ).toBe(true);
  });

  it('says more only when a further row matched', () => {
    const rows = (count: number) => Array.from({ length: count }, (_, index) => index);
    expect(limited(rows(SEARCH_LIMIT))).toEqual({ items: rows(SEARCH_LIMIT), more: false });
    expect(limited(rows(SEARCH_LIMIT + 1))).toEqual({ items: rows(SEARCH_LIMIT), more: true });
    expect(limited([])).toEqual({ items: [], more: false });
  });
});

// Moved from the web's list state (should-fix 12 of the plan review): one split for both sides.
describe('searchWords', () => {
  it('is null when nothing is typed', () => {
    expect(searchWords(undefined)).toBeNull();
    expect(searchWords('   ')).toBeNull();
  });

  it('folds each word as the search compares it (answer 18)', () => {
    expect(searchWords("  O'tkir   Rahimov ")).toEqual(['otkir', 'raximov']);
    expect(searchWords('Ўткир')).toEqual(['otkir']);
  });
});
