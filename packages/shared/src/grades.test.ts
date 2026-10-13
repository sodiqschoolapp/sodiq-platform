import { describe, expect, it } from 'vitest';
import { gradeRanges } from './grades.js';

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
  });

  it('sorts and drops repeats', () => {
    expect(gradeRanges([11, 5, 6, 5, 7, 8, 9, 10])).toBe('5–11');
  });

  it('reads back as the sorted set for every set of grades 1 to 11', () => {
    for (let mask = 0; mask < 2 ** 11; mask += 1) {
      const grades: number[] = [];
      for (let grade = 1; grade <= 11; grade += 1) {
        if ((mask & (1 << (grade - 1))) !== 0) {
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
