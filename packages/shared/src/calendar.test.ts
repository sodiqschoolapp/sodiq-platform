import { describe, expect, it } from 'vitest';
import {
  CALENDAR_ENTRY_NAME_MAX_LENGTH,
  calendarChangeSchema,
  calendarEntryRecordSchema,
} from './calendar.js';

const dayOff = {
  kind: 'day_off',
  name: 'Navruz',
  firstDate: '2027-03-21',
  lastDate: '2027-03-21',
  gradeFrom: null,
  gradeTo: null,
  dayTemplateId: null,
  followsWeekday: null,
  examWeek: null,
};

const template = '0199a3c4-0000-7000-8000-000000000001';

const specialDay = {
  ...dayOff,
  kind: 'special_day',
  name: 'Working Saturday',
  firstDate: '2027-03-27',
  lastDate: '2027-03-27',
  dayTemplateId: template,
  followsWeekday: 1,
};

const pathsOf = (input: unknown) => {
  const result = calendarEntryRecordSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

// The owner's answer 15 (docs/decisions.md, "Decided ahead for tasks 1.3 to
// 1.6") and decisions 1 and 10 of pull request #47.
describe('calendarEntryRecordSchema', () => {
  it('takes a day off and a special day', () => {
    expect(pathsOf(dayOff)).toEqual([]);
    expect(pathsOf(specialDay)).toEqual([]);
    expect(
      pathsOf({ ...specialDay, gradeFrom: 9, gradeTo: 11, examWeek: 'no_regular_lessons' }),
    ).toEqual([]);
  });

  it('keeps the name to 1 to 60 characters, trimmed', () => {
    expect(pathsOf({ ...dayOff, name: 'x'.repeat(CALENDAR_ENTRY_NAME_MAX_LENGTH) })).toEqual([]);
    expect(pathsOf({ ...dayOff, name: 'x'.repeat(CALENDAR_ENTRY_NAME_MAX_LENGTH + 1) })).toEqual([
      'name',
    ]);
    expect(pathsOf({ ...dayOff, name: '   ' })).toEqual(['name']);
  });

  it('takes one date (both dates count) and refuses a last date before the first', () => {
    expect(pathsOf({ ...dayOff, lastDate: '2027-03-20' })).toEqual(['lastDate']);
    expect(pathsOf({ ...dayOff, firstDate: '2027-02-30' })).toContain('firstDate');
  });

  it('takes both grades or neither, 1 to 11, upwards', () => {
    expect(pathsOf({ ...dayOff, gradeFrom: 1, gradeTo: 11 })).toEqual([]);
    expect(pathsOf({ ...dayOff, gradeFrom: 9 })).toEqual(['gradeTo']);
    expect(pathsOf({ ...dayOff, gradeTo: 9 })).toEqual(['gradeFrom']);
    expect(pathsOf({ ...dayOff, gradeFrom: 9, gradeTo: 8 })).toEqual(['gradeTo']);
    expect(pathsOf({ ...dayOff, gradeFrom: 0, gradeTo: 12 })).toEqual(['gradeFrom', 'gradeTo']);
  });

  it('asks a special day for a template and a day off for none of its fields', () => {
    expect(pathsOf({ ...specialDay, dayTemplateId: null })).toEqual(['dayTemplateId']);
    expect(
      pathsOf({
        ...dayOff,
        dayTemplateId: template,
        followsWeekday: 1,
        examWeek: 'regular_lessons',
      }),
    ).toEqual(['dayTemplateId', 'followsWeekday', 'examWeek']);
  });

  it('refuses an unknown kind, weekday or exam week', () => {
    expect(pathsOf({ ...dayOff, kind: 'holiday' })).toEqual(['kind']);
    expect(pathsOf({ ...specialDay, followsWeekday: 8 })).toEqual(['followsWeekday']);
    expect(pathsOf({ ...specialDay, examWeek: 'exams' })).toEqual(['examWeek']);
  });
});

describe('calendarChangeSchema', () => {
  it('takes the four saves the preview shows', () => {
    const id = '0199a3c4-0000-7000-8000-000000000002';
    for (const change of [
      { action: 'create', record: dayOff },
      { action: 'edit', id, record: dayOff },
      { action: 'archive', id },
      { action: 'restore', id },
    ]) {
      expect(calendarChangeSchema.safeParse(change).success, change.action).toBe(true);
    }
    expect(calendarChangeSchema.safeParse({ action: 'delete', id }).success).toBe(false);
  });
});
