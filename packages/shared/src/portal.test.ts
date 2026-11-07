import { describe, expect, it } from 'vitest';
import {
  portalChildParamsSchema,
  portalAttendanceLessonSchema,
  portalFileParamsSchema,
  portalGradesQuerySchema,
  portalScoreSchema,
  portalSubjectGradesSchema,
  portalLessonSchema,
  portalRatingQuerySchema,
  portalRatingSchema,
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

describe('the portal schemas of grades and attendance (task 11.3)', () => {
  const subject = {
    id: ID,
    names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
    colour: 'blue',
  };

  it('take a quarter by an optional uuid and refuse anything else', () => {
    expect(portalGradesQuerySchema.parse({})).toEqual({});
    expect(portalGradesQuerySchema.safeParse({ quarter: ID }).success).toBe(true);
    expect(portalGradesQuerySchema.safeParse({ quarter: '1' }).success).toBe(false);
    expect(portalGradesQuerySchema.safeParse({ quarterId: ID }).success).toBe(false);
  });

  it('refuse a staff field in a score, a subject and a lesson of attendance', () => {
    const score = {
      date: '2026-10-12',
      kind: 'classwork',
      title: null,
      position: 1,
      score: 12,
      total: 30,
      percent: 40,
      comment: null,
    };
    expect(portalScoreSchema.safeParse(score).success).toBe(true);
    expect(portalScoreSchema.safeParse({ ...score, workId: ID }).success).toBe(false);
    expect(portalScoreSchema.safeParse({ ...score, visibility: 'staff' }).success).toBe(false);
    const grades = {
      subject,
      final: false,
      attendanceOnly: true,
      figures: null,
      attendance: 50,
      year: null,
      scores: [],
      rating: null,
      ratingComments: [],
    };
    expect(portalSubjectGradesSchema.safeParse(grades).success).toBe(true);
    expect(portalSubjectGradesSchema.safeParse({ ...grades, unit: { id: ID } }).success).toBe(
      false,
    );
    expect(portalSubjectGradesSchema.safeParse({ ...grades, earlyWarning: true }).success).toBe(
      false,
    );
    const lesson = {
      date: '2026-10-12',
      start: 480,
      end: 525,
      subject,
      mark: 'exempt',
      comment: null,
      note: null,
    };
    expect(portalAttendanceLessonSchema.safeParse(lesson).success).toBe(true);
    // Exempt has no kind, reason or category (decision 7); no number either.
    expect(portalAttendanceLessonSchema.safeParse({ ...lesson, mark: 4 }).success).toBe(false);
    expect(
      portalAttendanceLessonSchema.safeParse({ ...lesson, exemptionReason: 'illness' }).success,
    ).toBe(false);
  });
});

describe('the portal rating (task 11.6)', () => {
  const answer = {
    quarters: [
      { id: ID, number: 1, startDate: '2026-09-02', endDate: '2026-10-31', closed: false },
    ],
    quarterId: ID,
    provisional: true,
    notOfficial: false,
    class: {
      name: '7 Oxford',
      place: 3,
      value: 843,
      subjects: 9,
      fewerSubjects: false,
      average: 781,
    },
  };

  it('holds the child’s own place and figure and the class average, nothing of another student', () => {
    expect(portalRatingSchema.parse(answer)).toEqual(answer);
    // A list of students, a name or a count of the students ranked fails the parse
    // (review correction 1 of the plan).
    for (const extra of [{ rows: [] }, { firstName: 'Aziz' }, { ranked: 24 }, { students: 24 }]) {
      expect(portalRatingSchema.safeParse({ ...answer, ...extra }).success).toBe(false);
      expect(
        portalRatingSchema.safeParse({ ...answer, class: { ...answer.class, ...extra } }).success,
      ).toBe(false);
    }
  });

  it('takes an optional quarter and refuses a misspelled field', () => {
    expect(portalRatingQuerySchema.parse({})).toEqual({});
    expect(portalRatingQuerySchema.parse({ quarter: ID })).toEqual({ quarter: ID });
    expect(portalRatingQuerySchema.safeParse({ quarterId: ID }).success).toBe(false);
  });
});
