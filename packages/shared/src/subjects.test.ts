import { describe, expect, it } from 'vitest';
import {
  dailyWeightsSchema,
  newSubjectRecordSchema,
  quarterWeightsSchema,
  SUBJECT_COLOURS,
  SUBJECT_GRADES,
  SUBJECT_NAME_MAX_LENGTH,
  subjectGradesSchema,
  subjectRecordSchema,
  WEIGHT_MIN,
} from './subjects.js';

const DEPARTMENT = '0199a000-0000-7000-8000-000000000001';

const SUBJECT = {
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  departmentId: DEPARTMENT,
  grades: [5, 6, 7],
  colour: 'blue',
  journalType: 'graded',
  ratingExam: true,
  groupSubject: false,
  languageRule: true,
  demanding: true,
  daily: { attendance: 10, classwork: 50, homework: 40 },
};

const paths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? [];

describe('the weights of a subject', () => {
  // `05`: "Each distribution must total 100. The form will not save otherwise."
  it('take a daily distribution that totals 100 and refuse 99 and 101', () => {
    expect(
      dailyWeightsSchema.safeParse({ attendance: 10, classwork: 50, homework: 40 }).success,
    ).toBe(true);
    for (const homework of [39, 41]) {
      const result = dailyWeightsSchema.safeParse({ attendance: 10, classwork: 50, homework });
      expect(paths(result)).toEqual(['total']);
    }
  });

  it('take a quarterly distribution of three or four parts that totals 100', () => {
    const three = { attendance: 10, classwork: 50, homework: 40, ratingExam: null };
    const four = { attendance: 10, classwork: 30, homework: 20, ratingExam: 40 };
    expect(quarterWeightsSchema.safeParse(three).success).toBe(true);
    expect(quarterWeightsSchema.safeParse(four).success).toBe(true);
    expect(paths(quarterWeightsSchema.safeParse({ ...three, homework: 39 }))).toEqual(['total']);
    expect(paths(quarterWeightsSchema.safeParse({ ...three, homework: 41 }))).toEqual(['total']);
    expect(paths(quarterWeightsSchema.safeParse({ ...four, ratingExam: 39 }))).toEqual(['total']);
    expect(paths(quarterWeightsSchema.safeParse({ ...four, ratingExam: 41 }))).toEqual(['total']);
  });

  // Decision 8: every present part weighs at least 1, in whole numbers.
  it('refuse a part of 0, a negative part and a decimal', () => {
    expect(WEIGHT_MIN).toBe(1);
    expect(
      paths(dailyWeightsSchema.safeParse({ attendance: 0, classwork: 60, homework: 40 })),
    ).toContain('attendance');
    expect(
      paths(dailyWeightsSchema.safeParse({ attendance: -10, classwork: 70, homework: 40 })),
    ).toContain('attendance');
    expect(
      paths(dailyWeightsSchema.safeParse({ attendance: 10.5, classwork: 49.5, homework: 40 })),
    ).toContain('attendance');
    expect(
      paths(
        quarterWeightsSchema.safeParse({
          attendance: 10,
          classwork: 50,
          homework: 40,
          ratingExam: 0,
        }),
      ),
    ).toContain('ratingExam');
  });
});

describe('a subject record', () => {
  it('is taken with its school-wide fields and the daily distribution', () => {
    expect(newSubjectRecordSchema.parse(SUBJECT)).toEqual(SUBJECT);
  });

  // The build plan's "done when": a graded subject cannot be saved without
  // weights that total 100 (answer 6).
  it('refuses a graded subject without a daily distribution, or with one of 99', () => {
    expect(paths(newSubjectRecordSchema.safeParse({ ...SUBJECT, daily: null }))).toEqual(['daily']);
    expect(
      paths(
        newSubjectRecordSchema.safeParse({
          ...SUBJECT,
          daily: { attendance: 10, classwork: 50, homework: 39 },
        }),
      ),
    ).toEqual(['daily.total']);
  });

  it('lets an edit leave the daily distribution out (it has its own route)', () => {
    expect(subjectRecordSchema.safeParse({ ...SUBJECT, daily: null }).success).toBe(true);
  });

  // `edge/calculation`: attendance-only subjects have no weights and no result.
  it('refuses weights and a rating exam on an attendance-only subject', () => {
    const attendanceOnly = { ...SUBJECT, journalType: 'attendance_only', ratingExam: false };
    expect(newSubjectRecordSchema.safeParse({ ...attendanceOnly, daily: null }).success).toBe(true);
    expect(paths(newSubjectRecordSchema.safeParse(attendanceOnly))).toEqual(['daily']);
    expect(
      paths(newSubjectRecordSchema.safeParse({ ...attendanceOnly, ratingExam: true, daily: null })),
    ).toEqual(['ratingExam']);
  });

  it('takes the 12 colours and nothing else', () => {
    expect(SUBJECT_COLOURS).toHaveLength(12);
    for (const colour of SUBJECT_COLOURS) {
      expect(newSubjectRecordSchema.safeParse({ ...SUBJECT, colour }).success).toBe(true);
    }
    expect(paths(newSubjectRecordSchema.safeParse({ ...SUBJECT, colour: 'black' }))).toEqual([
      'colour',
    ]);
  });

  it('bounds each name and trims it', () => {
    const long = 'a'.repeat(SUBJECT_NAME_MAX_LENGTH + 1);
    expect(
      paths(
        newSubjectRecordSchema.safeParse({ ...SUBJECT, names: { ...SUBJECT.names, ru: long } }),
      ),
    ).toEqual(['names.ru']);
    expect(
      paths(
        newSubjectRecordSchema.safeParse({ ...SUBJECT, names: { ...SUBJECT.names, en: '  ' } }),
      ),
    ).toEqual(['names.en']);
    expect(
      newSubjectRecordSchema.parse({ ...SUBJECT, names: { ...SUBJECT.names, en: ' Maths ' } }).names
        .en,
    ).toBe('Maths');
  });
});

describe('the grades of a subject', () => {
  // Answer 8: "any of 1 to 11, ticked".
  it('are 1 to 11, at least one, each once, in ascending order', () => {
    expect(SUBJECT_GRADES).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(subjectGradesSchema.parse([1, 9, 11])).toEqual([1, 9, 11]);
    expect(subjectGradesSchema.safeParse([9, 1, 11]).success).toBe(false);
    expect(subjectGradesSchema.safeParse([]).success).toBe(false);
    expect(subjectGradesSchema.safeParse([0]).success).toBe(false);
    expect(subjectGradesSchema.safeParse([12]).success).toBe(false);
    expect(subjectGradesSchema.safeParse([5, 5]).success).toBe(false);
    expect(subjectGradesSchema.safeParse([5.5]).success).toBe(false);
  });
});
