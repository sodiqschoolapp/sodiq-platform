import { describe, expect, it } from 'vitest';
import {
  assignmentRecordSchema,
  DAY_TEMPLATE_SLOTS_MAX,
  dayTemplateRecordSchema,
  minutesOf,
  nextDay,
  SLOT_LENGTH_MAX_MINUTES,
  SLOT_LENGTH_MIN_MINUTES,
  SLOT_TYPE_NAME_MAX_LENGTH,
  slotLengthChangeSchema,
  slotTypeRecordSchema,
  timeOfDaySchema,
  timeText,
} from './day-templates.js';

import {
  templateChangeSchema,
  templateDaysBodySchema,
  assignmentSaveSchema,
  slotLengthSaveSchema,
} from './template-changes.js';
const ID = '01928c3e-0000-7000-8000-000000000001';

const paths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((issue) => issue.path.join('.'));

// Owner's answer 9: "name unique per branch, kind lesson or break (lunch is a
// break named Lunch), length 5 to 180 whole minutes".
describe('slotTypeRecordSchema', () => {
  const lesson = { name: 'Lesson 45', kind: 'lesson', lengthMinutes: 45 };

  it('takes a name, a kind and a length, and trims the name', () => {
    expect(
      slotTypeRecordSchema.parse({ ...lesson, name: '  Lunch ', kind: 'break', lengthMinutes: 40 }),
    ).toEqual({
      name: 'Lunch',
      kind: 'break',
      lengthMinutes: 40,
    });
  });

  it('keeps the length between 5 and 180 whole minutes', () => {
    expect(
      slotTypeRecordSchema.safeParse({ ...lesson, lengthMinutes: SLOT_LENGTH_MIN_MINUTES }).success,
    ).toBe(true);
    expect(
      slotTypeRecordSchema.safeParse({ ...lesson, lengthMinutes: SLOT_LENGTH_MAX_MINUTES }).success,
    ).toBe(true);
    expect(paths(slotTypeRecordSchema.safeParse({ ...lesson, lengthMinutes: 4 }))).toEqual([
      'lengthMinutes',
    ]);
    expect(paths(slotTypeRecordSchema.safeParse({ ...lesson, lengthMinutes: 181 }))).toEqual([
      'lengthMinutes',
    ]);
    expect(paths(slotTypeRecordSchema.safeParse({ ...lesson, lengthMinutes: 45.5 }))).toEqual([
      'lengthMinutes',
    ]);
  });

  it('refuses another kind, an empty name and a name that is too long', () => {
    expect(paths(slotTypeRecordSchema.safeParse({ ...lesson, kind: 'lunch' }))).toEqual(['kind']);
    expect(paths(slotTypeRecordSchema.safeParse({ ...lesson, name: '   ' }))).toEqual(['name']);
    expect(
      paths(
        slotTypeRecordSchema.safeParse({
          ...lesson,
          name: 'x'.repeat(SLOT_TYPE_NAME_MAX_LENGTH + 1),
        }),
      ),
    ).toEqual(['name']);
  });
});

describe('slotLengthChangeSchema', () => {
  it('takes a length and a school date', () => {
    expect(
      slotLengthChangeSchema.safeParse({ lengthMinutes: 40, from: '2026-10-12' }).success,
    ).toBe(true);
    expect(
      paths(slotLengthChangeSchema.safeParse({ lengthMinutes: 40, from: '12.10.2026' })),
    ).toEqual(['from']);
  });
});

// Answer 10: "one typed start time (the only typed time), 1 to 20 ordered slots".
describe('dayTemplateRecordSchema', () => {
  const template = { name: 'Main', startTime: '08:30', slotTypeIds: [ID] };

  it('takes a name, a start time and 1 to 20 slots', () => {
    expect(dayTemplateRecordSchema.safeParse(template).success).toBe(true);
    expect(
      dayTemplateRecordSchema.safeParse({
        ...template,
        slotTypeIds: Array(DAY_TEMPLATE_SLOTS_MAX).fill(ID),
      }).success,
    ).toBe(true);
  });

  it('refuses no slot, 21 slots and an id that is not one', () => {
    expect(paths(dayTemplateRecordSchema.safeParse({ ...template, slotTypeIds: [] }))).toEqual([
      'slotTypeIds',
    ]);
    expect(
      paths(
        dayTemplateRecordSchema.safeParse({
          ...template,
          slotTypeIds: Array(DAY_TEMPLATE_SLOTS_MAX + 1).fill(ID),
        }),
      ),
    ).toEqual(['slotTypeIds']);
    expect(paths(dayTemplateRecordSchema.safeParse({ ...template, slotTypeIds: ['x'] }))).toEqual([
      'slotTypeIds.0',
    ]);
  });
});

describe('the start time', () => {
  it('is typed as HH:MM, 00:00 to 23:59', () => {
    for (const time of ['00:00', '08:30', '23:59']) {
      expect(timeOfDaySchema.safeParse(time).success, time).toBe(true);
    }
    for (const time of ['24:00', '8:30', '08:60', '0830', '']) {
      expect(timeOfDaySchema.safeParse(time).success, time).toBe(false);
    }
  });

  it('gives the next school date, across a month and a year', () => {
    expect(nextDay('2026-10-10')).toBe('2026-10-11');
    expect(nextDay('2026-10-31')).toBe('2026-11-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
  });

  it('turns into minutes after midnight and back', () => {
    expect(minutesOf('08:30')).toBe(510);
    expect(minutesOf('00:00')).toBe(0);
    expect(timeText(510)).toBe('08:30');
    expect(timeText(1440)).toBe('24:00');
    expect(timeText(5)).toBe('00:05');
  });
});

// Answer 11: "the default; a grade range; a weekday; a weekday with a grade range".
describe('assignmentRecordSchema', () => {
  const base = { dayTemplateId: ID, from: '2026-10-12' };

  it('takes each level with exactly its own fields', () => {
    for (const record of [
      { level: 'default', weekday: null, gradeFrom: null, gradeTo: null },
      { level: 'grades', weekday: null, gradeFrom: 9, gradeTo: 11 },
      { level: 'weekday', weekday: 5, gradeFrom: null, gradeTo: null },
      { level: 'weekday_grades', weekday: 1, gradeFrom: 1, gradeTo: 4 },
    ]) {
      expect(assignmentRecordSchema.safeParse({ ...base, ...record }).success, record.level).toBe(
        true,
      );
    }
  });

  it('names the field a level lacks or should not have', () => {
    expect(
      paths(
        assignmentRecordSchema.safeParse({
          ...base,
          level: 'default',
          weekday: 1,
          gradeFrom: null,
          gradeTo: null,
        }),
      ),
    ).toEqual(['weekday']);
    expect(
      paths(
        assignmentRecordSchema.safeParse({
          ...base,
          level: 'grades',
          weekday: null,
          gradeFrom: 9,
          gradeTo: null,
        }),
      ),
    ).toEqual(['gradeTo']);
    expect(
      paths(
        assignmentRecordSchema.safeParse({
          ...base,
          level: 'weekday',
          weekday: null,
          gradeFrom: null,
          gradeTo: null,
        }),
      ),
    ).toEqual(['weekday']);
  });

  it('refuses a range that runs downwards, a grade outside 1 to 11 and weekday 8', () => {
    expect(
      paths(
        assignmentRecordSchema.safeParse({
          ...base,
          level: 'grades',
          weekday: null,
          gradeFrom: 9,
          gradeTo: 5,
        }),
      ),
    ).toEqual(['gradeTo']);
    expect(
      paths(
        assignmentRecordSchema.safeParse({
          ...base,
          level: 'grades',
          weekday: null,
          gradeFrom: 0,
          gradeTo: 12,
        }),
      ),
    ).toEqual(['gradeFrom', 'gradeTo']);
    expect(
      paths(
        assignmentRecordSchema.safeParse({
          ...base,
          level: 'weekday',
          weekday: 8,
          gradeFrom: null,
          gradeTo: null,
        }),
      ),
    ).toEqual(['weekday']);
  });
});

describe('templateChangeSchema', () => {
  it('takes the four saves that can change the table', () => {
    for (const change of [
      { kind: 'slot_length', slotTypeId: ID, change: { lengthMinutes: 40, from: '2026-10-12' } },
      {
        kind: 'template_version',
        dayTemplateId: ID,
        change: { from: '2026-10-12', startTime: '08:00', slotTypeIds: [ID] },
      },
      {
        kind: 'assignment_set',
        change: {
          level: 'default',
          weekday: null,
          gradeFrom: null,
          gradeTo: null,
          dayTemplateId: ID,
          from: '2026-10-12',
        },
      },
      { kind: 'assignment_end', assignmentId: ID, change: { from: '2026-10-12' } },
    ]) {
      expect(templateChangeSchema.safeParse(change).success, change.kind).toBe(true);
    }
    expect(templateChangeSchema.safeParse({ kind: 'rename', change: {} }).success).toBe(false);
  });
});

// Task 5.6b-4a (decision 8): a template change takes the calendar save's
// choices for the dated lessons it writes again, but never `groupBlocks`: a
// change leaves no grade off (.claude/rules/api.md, a field with no use on a
// path is refused, not dropped).
describe('templateDaysBodySchema', () => {
  const KEY = 'a'.repeat(64);

  it('takes the key, the decisions, the kept lessons and the exam blocks', () => {
    const days = {
      dayChangesKey: KEY,
      dayDecisions: [{ key: ID, choice: 'drop' }],
      dayKeeps: [{ date: '2026-10-19', classId: ID, slotPositions: [1, 2] }],
      examBlocks: [],
    };
    expect(templateDaysBodySchema.safeParse(days).success).toBe(true);
    expect(
      slotLengthSaveSchema.safeParse({ lengthMinutes: 40, from: '2026-10-12', days }).success,
    ).toBe(true);
  });

  it('refuses groupBlocks and any other field', () => {
    expect(templateDaysBodySchema.safeParse({ groupBlocks: [] }).success).toBe(false);
    expect(templateDaysBodySchema.safeParse({ entryId: ID }).success).toBe(false);
    expect(
      slotLengthSaveSchema.safeParse({
        lengthMinutes: 40,
        from: '2026-10-12',
        days: { groupBlocks: [] },
      }).success,
    ).toBe(false);
  });

  it('keeps the rules of a setting with the choices', () => {
    const setting = {
      level: 'weekday',
      weekday: null,
      gradeFrom: null,
      gradeTo: null,
      dayTemplateId: ID,
      from: '2026-10-12',
      days: {},
    };
    expect(paths(assignmentSaveSchema.safeParse(setting))).toEqual(['weekday']);
    expect(assignmentSaveSchema.safeParse({ ...setting, weekday: 5 }).success).toBe(true);
  });

  it('carries the choices in each kind of the preview', () => {
    expect(
      templateChangeSchema.safeParse({
        kind: 'assignment_end',
        assignmentId: ID,
        change: { from: '2026-10-12', days: { dayChangesKey: KEY } },
      }).success,
    ).toBe(true);
    expect(
      templateChangeSchema.safeParse({
        kind: 'assignment_end',
        assignmentId: ID,
        change: { from: '2026-10-12', days: { groupBlocks: [] } },
      }).success,
    ).toBe(false);
  });
});
