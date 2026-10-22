import { describe, expect, it } from 'vitest';
import {
  ABSENCE_CATEGORIES,
  ABSENCE_REASON_NOTE_MAX,
  ATTENDANCE_SAVES_MAX,
  absenceReasonRecordSchema,
  attendanceSaveSchema,
  studentAbsencesQuerySchema,
} from './attendance.js';

const STUDENT = '0190f3a0-0000-7000-8000-000000000001';
const OTHER = '0190f3a0-0000-7000-8000-000000000002';

describe('attendance schemas (task 6.3)', () => {
  it('takes the marks 0 to 3 a person types, and a clear', () => {
    for (const mark of [0, 1, 2, 3, null]) {
      expect(
        attendanceSaveSchema.safeParse({ saves: [{ studentId: STUDENT, mark, version: null }] })
          .success,
        String(mark),
      ).toBe(true);
    }
  });

  it('refuses the exemption marks 4 and 5, decimals and other values (07, Entering data)', () => {
    for (const mark of [4, 5, -1, 1.5, '1']) {
      expect(
        attendanceSaveSchema.safeParse({ saves: [{ studentId: STUDENT, mark, version: null }] })
          .success,
        String(mark),
      ).toBe(false);
    }
  });

  it('saves each student once, 1 to 60 per call, with a version from 1', () => {
    expect(attendanceSaveSchema.safeParse({ saves: [] }).success).toBe(false);
    const twice = attendanceSaveSchema.safeParse({
      saves: [
        { studentId: STUDENT, mark: 1, version: null },
        { studentId: STUDENT.toUpperCase(), mark: 0, version: 1 },
      ],
    });
    expect(twice.success).toBe(false);
    expect(twice.error?.issues[0]?.path).toEqual(['saves', 1, 'studentId']);
    expect(
      attendanceSaveSchema.safeParse({ saves: [{ studentId: STUDENT, mark: 1, version: 0 }] })
        .success,
    ).toBe(false);
    const many = Array.from({ length: ATTENDANCE_SAVES_MAX + 1 }, (_, index) => ({
      studentId: `0190f3a0-0000-7000-8000-${String(index).padStart(12, '0')}`,
      mark: 1,
      version: null,
    }));
    expect(attendanceSaveSchema.safeParse({ saves: many }).success).toBe(false);
    expect(attendanceSaveSchema.safeParse({ saves: many.slice(1) }).success).toBe(true);
    expect(
      attendanceSaveSchema.safeParse({
        saves: [{ studentId: OTHER, mark: 1, version: null }],
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('names the five categories of edge/journal', () => {
    expect(ABSENCE_CATEGORIES).toEqual([
      'illness',
      'family',
      'school_permitted',
      'unexcused',
      'unknown',
    ]);
  });

  it('bounds the note and keeps it empty on a cleared reason (decision 8)', () => {
    expect(absenceReasonRecordSchema.safeParse({ category: 'illness', note: '' }).success).toBe(
      true,
    );
    expect(
      absenceReasonRecordSchema.safeParse({
        category: 'family',
        note: 'x'.repeat(ABSENCE_REASON_NOTE_MAX),
      }).success,
    ).toBe(true);
    expect(
      absenceReasonRecordSchema.safeParse({
        category: 'family',
        note: 'x'.repeat(ABSENCE_REASON_NOTE_MAX + 1),
      }).success,
    ).toBe(false);
    expect(absenceReasonRecordSchema.safeParse({ category: null, note: '' }).success).toBe(true);
    expect(absenceReasonRecordSchema.safeParse({ category: null, note: 'x' }).success).toBe(false);
    expect(absenceReasonRecordSchema.safeParse({ category: 'other', note: '' }).success).toBe(
      false,
    );
  });

  it('reads at most 31 days, both dates or none (decision 13)', () => {
    expect(studentAbsencesQuerySchema.safeParse({}).success).toBe(true);
    expect(
      studentAbsencesQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success,
    ).toBe(true);
    expect(
      studentAbsencesQuerySchema.safeParse({ from: '2026-10-01', to: '2026-11-01' }).success,
    ).toBe(false);
    expect(
      studentAbsencesQuerySchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success,
    ).toBe(false);
    expect(studentAbsencesQuerySchema.safeParse({ from: '2026-10-02' }).success).toBe(false);
  });
});
