import { describe, expect, it } from 'vitest';
import { VACANCY_NAME_MAX_LENGTH, vacancyRecordSchema } from './vacancies.js';

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
