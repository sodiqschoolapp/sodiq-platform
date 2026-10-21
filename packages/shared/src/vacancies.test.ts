import { describe, expect, it } from 'vitest';
import {
  VACANCY_NAME_MAX_LENGTH,
  vacancyDetailSchema,
  vacancyListItemSchema,
  vacancyRecordSchema,
} from './vacancies.js';
import { vacancyFillCheckSchema, vacancyFillUnitSchema } from './vacancy-fills.js';

// Task 2.2b: what is typed for a vacancy (04, Vacancy): a name, a department,
// subjects with grades, languages and the contract load, nothing personal.
describe('vacancies', () => {
  const record = {
    name: 'English vacancy 2',
    departmentId: '0190f0c4-0000-7000-8000-000000000001',
    subjects: [{ subjectId: '0190f0c4-0000-7000-8000-000000000002', grades: [7, 8] }],
    languages: ['uz'],
    weeklyLessons: 18,
    dailyLessons: 6,
  };

  it('takes a vacancy and trims its name', () => {
    expect(vacancyRecordSchema.parse({ ...record, name: '  English vacancy 2 ' }).name).toBe(
      'English vacancy 2',
    );
  });

  it('refuses an empty or long name, a subject without a language and personal fields', () => {
    expect(vacancyRecordSchema.safeParse({ ...record, name: '  ' }).success).toBe(false);
    expect(
      vacancyRecordSchema.safeParse({ ...record, name: 'a'.repeat(VACANCY_NAME_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(vacancyRecordSchema.safeParse({ ...record, languages: [] }).success).toBe(false);
    expect(vacancyRecordSchema.safeParse({ ...record, weeklyLessons: 0 }).success).toBe(false);
    const parsed = vacancyRecordSchema.parse({ ...record, firstName: 'Akmal', phone: '+998' });
    expect(parsed).not.toHaveProperty('firstName');
    expect(parsed).not.toHaveProperty('phone');
  });
});

// Task 5.7a-3b: the planned close and the names of the fills' classes and groups.
describe('vacancy answers', () => {
  const id = '0190f0c4-0000-7000-8000-000000000003';
  const item = {
    id,
    name: 'English vacancy 2',
    departmentId: '0190f0c4-0000-7000-8000-000000000001',
    subjects: [],
    languages: ['uz'],
    weeklyLessons: null,
    dailyLessons: null,
    status: 'open',
  };

  it('takes a planned close as a date or null, and refuses a list item without it', () => {
    expect(vacancyListItemSchema.parse({ ...item, closesOn: '2026-11-02' }).closesOn).toBe(
      '2026-11-02',
    );
    expect(vacancyListItemSchema.parse({ ...item, closesOn: null }).closesOn).toBeNull();
    expect(vacancyListItemSchema.safeParse(item).success).toBe(false);
    expect(vacancyListItemSchema.safeParse({ ...item, closesOn: '2 November' }).success).toBe(
      false,
    );
  });

  it('names the units of the fills, and refuses a unit of another kind', () => {
    const detail = {
      ...item,
      closesOn: null,
      statuses: [],
      fills: [],
      today: '2026-10-21',
    };
    const unit = { id, kind: 'group', name: 'English A', grades: [7, 8] };
    expect(vacancyDetailSchema.parse({ ...detail, fillUnits: [unit] }).fillUnits).toEqual([unit]);
    expect(vacancyDetailSchema.safeParse(detail).success).toBe(false);
    expect(vacancyFillUnitSchema.safeParse({ ...unit, kind: 'room' }).success).toBe(false);
  });

  it('takes a fill check with the units of its rows, and refuses one without them', () => {
    const check = {
      rows: [],
      rowsKey: 'a'.repeat(64),
      inPlace: false,
      publish: null,
      closes: false,
      holders: [],
    };
    const unit = { id, kind: 'class', name: 'Oxford', grades: [7] };
    expect(vacancyFillCheckSchema.parse({ ...check, units: [unit] }).units).toEqual([unit]);
    expect(vacancyFillCheckSchema.safeParse(check).success).toBe(false);
  });
});
