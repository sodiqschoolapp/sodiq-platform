import { describe, expect, it } from 'vitest';
import {
  attendanceValuesRecordSchema,
  CHECKLIST_ITEMS,
  EARLY_WARNING_BOUNDS,
  earlyWarningRecordSchema,
  EDIT_DAYS_DEFAULT,
  editDaysRecordSchema,
  INSTRUCTION_LANGUAGES,
  LATE_VALUE_DEFAULT,
  SKIPPED_VALUE_DEFAULT,
  travelTimeRecordSchema,
} from './settings.js';

const thresholds = { lowResult: 50, resultDrop: 15, attendancePercent: 80, absencesInRow: 3 };

describe('the settings of a branch', () => {
  // Answer 19 and `16` questions 2 and 42: the defaults.
  it('has the defaults of the spec', () => {
    expect(EDIT_DAYS_DEFAULT).toBe(7);
    expect(EARLY_WARNING_BOUNDS.lowResult.default).toBe(50);
    expect(EARLY_WARNING_BOUNDS.resultDrop.default).toBe(15);
    expect(EARLY_WARNING_BOUNDS.attendancePercent.default).toBe(80);
    expect(EARLY_WARNING_BOUNDS.absencesInRow.default).toBe(3);
    expect(LATE_VALUE_DEFAULT).toBe(50);
    expect(SKIPPED_VALUE_DEFAULT).toBe(0);
  });

  it('takes edit days from 1 to 30 whole days', () => {
    expect(editDaysRecordSchema.safeParse({ editDays: 1 }).success).toBe(true);
    expect(editDaysRecordSchema.safeParse({ editDays: 30 }).success).toBe(true);
    for (const editDays of [0, 31, 7.5, '7', null]) {
      expect(editDaysRecordSchema.safeParse({ editDays }).success, String(editDays)).toBe(false);
    }
  });

  it('takes each threshold inside its bounds only', () => {
    expect(earlyWarningRecordSchema.safeParse(thresholds).success).toBe(true);
    for (const [field, bounds] of Object.entries(EARLY_WARNING_BOUNDS)) {
      for (const value of [bounds.min, bounds.max]) {
        expect(earlyWarningRecordSchema.safeParse({ ...thresholds, [field]: value }).success).toBe(
          true,
        );
      }
      for (const value of [bounds.min - 1, bounds.max + 1, 10.5]) {
        expect(
          earlyWarningRecordSchema.safeParse({ ...thresholds, [field]: value }).success,
          `${field} ${value}`,
        ).toBe(false);
      }
    }
    expect(earlyWarningRecordSchema.safeParse({ ...thresholds, absencesInRow: 31 }).success).toBe(
      false,
    );
  });

  it('takes late and skipped from 0 to 100 whole percent', () => {
    expect(
      attendanceValuesRecordSchema.safeParse({ lateValue: 0, skippedValue: 100 }).success,
    ).toBe(true);
    for (const value of [-1, 101, 50.5]) {
      expect(
        attendanceValuesRecordSchema.safeParse({ lateValue: value, skippedValue: 0 }).success,
      ).toBe(false);
      expect(
        attendanceValuesRecordSchema.safeParse({ lateValue: 50, skippedValue: value }).success,
      ).toBe(false);
    }
  });

  it('takes a travel time from 0 to 180 minutes to a branch id', () => {
    const otherBranchId = '0199a3c4-0000-7000-8000-000000000002';
    expect(travelTimeRecordSchema.safeParse({ otherBranchId, minutes: 0 }).success).toBe(true);
    expect(travelTimeRecordSchema.safeParse({ otherBranchId, minutes: 180 }).success).toBe(true);
    for (const minutes of [-1, 181, 12.5]) {
      expect(travelTimeRecordSchema.safeParse({ otherBranchId, minutes }).success).toBe(false);
    }
    expect(travelTimeRecordSchema.safeParse({ otherBranchId: 'north', minutes: 30 }).success).toBe(
      false,
    );
  });

  // `05`: "The languages are Uzbek and Russian".
  it('has Uzbek and Russian as the languages of instruction', () => {
    expect(INSTRUCTION_LANGUAGES).toEqual(['uz', 'ru']);
  });

  // `edge/academic-year`: the fixed order of the checklist; "subjects and weights" from task 2.1, "classes" from task 3.1a.
  it('keeps the checklist in the order of the spec', () => {
    expect(CHECKLIST_ITEMS).toEqual([
      'branch',
      'rooms',
      'departments',
      'year',
      'quarters',
      'slotTypes',
      'defaultTemplate',
      'calendar',
      'subjects',
      // Task 3.1a, decision 12.
      'classes',
      // Task 3.2a, decision 14.
      'groups',
      // Task 3.4a, decision 14: after the groups, before the timetable.
      'teachingLoad',
    ]);
  });
});
