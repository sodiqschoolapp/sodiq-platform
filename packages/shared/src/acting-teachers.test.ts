import { describe, expect, it } from 'vitest';
import { actingTeacherBodySchema, actingTeacherEndSchema } from './acting-teachers.js';

const ID = '0199a000-0000-7000-8000-000000000002';

// Task 5.7a-3c: the body of a naming (decision 4, review correction 1: an
// empty period is made only by the withdraw) and of an end.
describe('actingTeacherBodySchema', () => {
  const body = (fields: object) =>
    actingTeacherBodySchema.safeParse({
      vacancyId: ID,
      journalId: ID,
      personId: ID,
      from: '2026-10-19',
      ...fields,
    }).success;

  it('takes an open-ended period, one with a later end, and the language confirmed', () => {
    expect(body({})).toBe(true);
    expect(body({ until: '2026-10-20' })).toBe(true);
    expect(body({ confirmLanguage: true })).toBe(true);
  });

  it('refuses an end on or before the start, an unconfirmed language flag and an unknown field', () => {
    expect(body({ until: '2026-10-19' })).toBe(false);
    expect(body({ until: '2026-10-18' })).toBe(false);
    expect(body({ confirmLanguage: false })).toBe(false);
    expect(body({ other: 1 })).toBe(false);
    expect(body({ from: '2026-02-30' })).toBe(false);
  });
});

describe('actingTeacherEndSchema', () => {
  it('takes a day and nothing else', () => {
    expect(actingTeacherEndSchema.safeParse({ until: '2026-10-19' }).success).toBe(true);
    expect(actingTeacherEndSchema.safeParse({}).success).toBe(false);
    expect(
      actingTeacherEndSchema.safeParse({ until: '2026-10-19', from: '2026-10-01' }).success,
    ).toBe(false);
  });
});
