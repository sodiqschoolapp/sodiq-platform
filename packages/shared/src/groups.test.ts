import { describe, expect, it } from 'vitest';
import {
  GROUP_MAX_SIZE,
  groupCreateSchema,
  groupKindOf,
  groupNameSchema,
  groupSlotQuerySchema,
} from './groups.js';

const yearId = '01900000-0000-7000-8000-000000000001';
const subjectId = '01900000-0000-7000-8000-000000000002';
const classA = '01900000-0000-7000-8000-00000000000a';
const classB = '01900000-0000-7000-8000-00000000000b';

// All names are invented. Decision 6 of task 3.2a; the schema refuses every
// name `groups_name_check` (db/migrations/0046) refuses (correction 3 of the
// review of pull request #91), so the API answers a validation error, never
// the database's refusal.
describe('groupNameSchema', () => {
  it.each(['7-M-1', 'M', 'English 3', 'Gʻalaba-1', 'Группа 2'])('accepts %s', (name) => {
    expect(groupNameSchema.parse(name)).toBe(name);
  });

  it.each(['7-M-1²', '7-M-١', '-7', ' ', '7/M', 'a'.repeat(41)])('refuses %s', (name) => {
    expect(groupNameSchema.safeParse(name).success).toBe(false);
  });
});

describe('groupCreateSchema', () => {
  const valid = {
    academicYearId: yearId,
    subjectId,
    classIds: [classA, classB],
    name: '7-M-1',
    language: null,
    maxSize: 20,
  };

  it('takes a group and confirms nothing by default', () => {
    expect(groupCreateSchema.parse(valid).confirmMixedLanguage).toBe(false);
  });

  it('refuses no class, a class named twice and a size out of bounds', () => {
    expect(groupCreateSchema.safeParse({ ...valid, classIds: [] }).success).toBe(false);
    expect(groupCreateSchema.safeParse({ ...valid, classIds: [classA, classA] }).success).toBe(
      false,
    );
    expect(groupCreateSchema.safeParse({ ...valid, maxSize: 0 }).success).toBe(false);
    expect(groupCreateSchema.safeParse({ ...valid, maxSize: GROUP_MAX_SIZE + 1 }).success).toBe(
      false,
    );
  });
});

describe('groupSlotQuerySchema', () => {
  it('reads the classes from a comma-separated list', () => {
    expect(groupSlotQuerySchema.parse({ classIds: `${classA},${classB}` }).classIds).toEqual([
      classA,
      classB,
    ]);
  });

  it('refuses a list with a value that is not an id', () => {
    expect(groupSlotQuerySchema.safeParse({ classIds: `${classA},x` }).success).toBe(false);
  });
});

describe('groupKindOf (decision 3)', () => {
  it('names one class a split and several a group across classes', () => {
    expect(groupKindOf(1)).toBe('split');
    expect(groupKindOf(3)).toBe('across');
  });
});
