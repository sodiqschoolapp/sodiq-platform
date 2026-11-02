import { describe, expect, it } from 'vitest';
import { CLASS_GRADES, classDisplayName, classGradeSchema } from './classes.js';
import {
  FIRST_GRADE,
  GRADES,
  gradeRanges,
  LAST_GRADE,
  schoolGradeQuerySchema,
  schoolGradeSchema,
  schoolGradeTextSchema,
} from './grades.js';
import { studentGradeSchema } from './students.js';
import { SUBJECT_GRADES } from './subjects.js';

/** The grades a range text names, read back. */
function expand(text: string): number[] {
  if (text === '') {
    return [];
  }
  return text.split(', ').flatMap((run) => {
    const [from, to] = run.split('–').map(Number);
    const last = to ?? from ?? 0;
    const grades: number[] = [];
    for (let grade = from ?? 0; grade <= last; grade += 1) {
      grades.push(grade);
    }
    return grades;
  });
}

describe('gradeRanges (finding 19)', () => {
  it('joins runs and keeps single grades', () => {
    expect(gradeRanges([1, 2, 3, 4, 7, 9, 10, 11])).toBe('1–4, 7, 9–11');
    expect(gradeRanges([5, 6])).toBe('5–6');
    expect(gradeRanges([7])).toBe('7');
    expect(gradeRanges([])).toBe('');
    expect(gradeRanges([0, 1, 2, 4])).toBe('0–2, 4');
  });

  it('sorts and drops repeats', () => {
    expect(gradeRanges([11, 5, 6, 5, 7, 8, 9, 10])).toBe('5–11');
  });

  it('reads back as the sorted set for every set of grades 0 to 11', () => {
    for (let mask = 0; mask < 2 ** 12; mask += 1) {
      const grades: number[] = [];
      for (let grade = 0; grade <= 11; grade += 1) {
        if ((mask & (1 << grade)) !== 0) {
          grades.push(grade);
        }
      }
      const text = gradeRanges([...grades].reverse());
      expect(expand(text)).toEqual(grades);
      // Each run is as long as it can be: the next run starts at least two grades later.
      const runs = text === '' ? [] : text.split(', ');
      runs.forEach((run, at) => {
        const next = runs[at + 1];
        if (next !== undefined) {
          expect(Number(next.split('–')[0])).toBeGreaterThan(Number(run.split('–').at(-1)) + 1);
        }
      });
    }
  });
});

// Task 9.4d: grade 0 to 11 everywhere a grade is typed, checked or chosen
// (05, Class: "Grade (0–11) … 0 London"; the spec change of 1 November 2026, item 3).
describe('the grades of the school', () => {
  it('are 0 to 11, in order, in every list', () => {
    const all = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    expect([FIRST_GRADE, LAST_GRADE]).toEqual([0, 11]);
    expect(GRADES).toEqual(all);
    expect(CLASS_GRADES).toEqual(all);
    expect(SUBJECT_GRADES).toEqual(all);
  });

  it('take 0 and 11 and refuse -1, 12 and a fraction in every grade schema', () => {
    for (const schema of [schoolGradeSchema, classGradeSchema, studentGradeSchema]) {
      expect(schema.safeParse(0).success).toBe(true);
      expect(schema.safeParse(11).success).toBe(true);
      for (const wrong of [-1, 12, 1.5]) expect(schema.safeParse(wrong).success).toBe(false);
    }
    expect(schoolGradeQuerySchema.parse('0')).toBe(0);
    expect(schoolGradeQuerySchema.parse(0)).toBe(0);
    // An empty `?grade=` is refused, never read as 0 (z.coerce would read it as 0).
    for (const text of ['', ' ', '07', '1.5']) {
      expect(schoolGradeQuerySchema.safeParse(text).success, text).toBe(false);
    }
    expect(schoolGradeQuerySchema.safeParse('-1').success).toBe(false);
    expect(schoolGradeQuerySchema.safeParse('12').success).toBe(false);
    for (const text of ['0', '7', '11'])
      expect(schoolGradeTextSchema.safeParse(text).success).toBe(true);
    for (const text of ['', '-1', '12', '07', ' 1', '1.5']) {
      expect(schoolGradeTextSchema.safeParse(text).success).toBe(false);
    }
  });

  it('shows grade 0 as any other grade', () => {
    expect(classDisplayName(0, 'London')).toBe('0 London');
  });
});
