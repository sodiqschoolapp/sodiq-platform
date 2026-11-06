import { describe, expect, it } from 'vitest';
import {
  portalChildParamsSchema,
  portalFileParamsSchema,
  portalLessonSchema,
  portalWeekQuerySchema,
} from './portal.js';

const ID = '0190a000-0000-7000-8000-000000000001';

describe('the portal schemas (task 11.2)', () => {
  it('take a week by an optional school date and refuse anything else', () => {
    expect(portalWeekQuerySchema.parse({})).toEqual({});
    expect(portalWeekQuerySchema.parse({ date: '2026-11-09' })).toEqual({ date: '2026-11-09' });
    expect(portalWeekQuerySchema.safeParse({ date: '9.11.2026' }).success).toBe(false);
    // A misspelled field is refused, never dropped (`.claude/rules/api.md`, strict query).
    expect(portalWeekQuerySchema.safeParse({ dat: '2026-11-09' }).success).toBe(false);
    expect(portalWeekQuerySchema.safeParse({ date: '2026-11-09', classId: ID }).success).toBe(
      false,
    );
  });

  it('take a child and a file by uuid only', () => {
    expect(portalChildParamsSchema.safeParse({ studentId: ID }).success).toBe(true);
    expect(portalChildParamsSchema.safeParse({ studentId: '42' }).success).toBe(false);
    expect(portalFileParamsSchema.safeParse({ studentId: ID, fileId: 'x' }).success).toBe(false);
  });

  it('refuse a staff field in a lesson answer (a whitelist, not the staff view)', () => {
    const lesson = {
      date: '2026-11-09',
      start: 480,
      end: 525,
      lessonNumber: 1,
      subject: {
        id: ID,
        names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
        colour: 'blue',
      },
      teacher: 'Aziza Karimova',
      room: '101',
      state: 'planned',
      exam: false,
      changed: false,
    };
    expect(portalLessonSchema.safeParse(lesson).success).toBe(true);
    expect(portalLessonSchema.safeParse({ ...lesson, journalId: ID }).success).toBe(false);
    expect(portalLessonSchema.safeParse({ ...lesson, cancelReason: 'ill' }).success).toBe(false);
  });
});
