import { describe, expect, it } from 'vitest';
import {
  CALENDAR_ENTRY_NAME_MAX_LENGTH,
  calendarChangeSchema,
  calendarDaysBodySchema,
  calendarEntryRecordSchema,
  calendarSaveSchema,
} from './calendar.js';
import { dayDecisionsBodySchema } from './timetable.js';

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

// Task 5.6b-2a: a create or an edit carries the key of the sorting shown and
// the choices; an archive or a restore takes them alone, or no body.
describe('calendarSaveSchema', () => {
  const key = 'a'.repeat(64);
  const change = '0199a3c4-0000-7000-8000-000000000003';

  it('takes the entry with or without the key and the choices, and keeps them', () => {
    expect(calendarSaveSchema.parse(dayOff)).toEqual(dayOff);
    const saved = calendarSaveSchema.parse({
      ...dayOff,
      dayChangesKey: key,
      dayDecisions: [{ key: change, choice: 'drop' }],
    });
    expect(saved.dayChangesKey).toBe(key);
    expect(saved.dayDecisions).toEqual([{ key: change, choice: 'drop' }]);
  });

  it('refuses a key of another shape, a choice not known, and the entry’s own refusals', () => {
    expect(calendarSaveSchema.safeParse({ ...dayOff, dayChangesKey: 'short' }).success).toBe(false);
    expect(calendarSaveSchema.safeParse({ ...dayOff, dayDecision: [] }).success).toBe(false);
    expect(
      calendarSaveSchema.safeParse({ ...dayOff, dayDecisions: [{ key: change, choice: 'later' }] })
        .success,
    ).toBe(false);
    expect(
      calendarSaveSchema.safeParse({ ...dayOff, lastDate: '2027-03-20', dayChangesKey: key })
        .success,
    ).toBe(false);
  });

  it('an archive or a restore: no body, {}, or the key and choices; nothing else', () => {
    expect(dayDecisionsBodySchema.parse(undefined)).toEqual({});
    expect(dayDecisionsBodySchema.parse({})).toEqual({});
    expect(dayDecisionsBodySchema.safeParse({ dayChangesKey: key }).success).toBe(true);
    expect(dayDecisionsBodySchema.safeParse({ name: 'Navruz' }).success).toBe(false);
  });
});

// Task 5.6b-2b (pull request #171): the shortened days' choices ride on a
// save, an archive or restore, and the preview; a date and class once each.
describe('the shortened days’ choices of a calendar save', () => {
  const classId = '0199a3c4-0000-7000-8000-000000000004';
  const other = '0199a3c4-0000-7000-8000-000000000005';
  const id = '0199a3c4-0000-7000-8000-000000000006';
  const keep = { classId, date: '2027-03-22', slotPositions: [2, 6] };

  it('takes them on a create or edit, an archive or restore, and each preview', () => {
    expect(calendarSaveSchema.parse({ ...dayOff, dayKeeps: [keep] }).dayKeeps).toEqual([keep]);
    expect(calendarDaysBodySchema.parse({ dayKeeps: [keep] })).toEqual({ dayKeeps: [keep] });
    expect(calendarDaysBodySchema.parse(undefined)).toEqual({});
    for (const change of [
      { action: 'create', record: dayOff },
      { action: 'edit', id, record: dayOff },
      { action: 'archive', id },
      { action: 'restore', id },
    ]) {
      expect(calendarChangeSchema.parse({ ...change, dayKeeps: [keep] }), change.action).toEqual({
        ...change,
        dayKeeps: [keep],
      });
    }
  });

  it('refuses a date and class twice, a slot twice, and a field not known', () => {
    const twice = [keep, { ...keep, slotPositions: [1] }];
    expect(calendarSaveSchema.safeParse({ ...dayOff, dayKeeps: twice }).success).toBe(false);
    expect(calendarDaysBodySchema.safeParse({ dayKeeps: twice }).success).toBe(false);
    expect(
      calendarChangeSchema.safeParse({ action: 'archive', id, dayKeeps: twice }).success,
    ).toBe(false);
    expect(
      calendarDaysBodySchema.safeParse({ dayKeeps: [{ ...keep, slotPositions: [2, 2] }] }).success,
    ).toBe(false);
    expect(calendarDaysBodySchema.safeParse({ dayKeep: [keep] }).success).toBe(false);
    // Another class on the same date, or the same class on another date, is no repeat.
    expect(
      calendarDaysBodySchema.safeParse({
        dayKeeps: [keep, { ...keep, classId: other }, { ...keep, date: '2027-03-23' }],
      }).success,
    ).toBe(true);
  });
});
