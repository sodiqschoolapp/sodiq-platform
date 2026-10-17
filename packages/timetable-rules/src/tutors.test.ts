import { describe, expect, it } from 'vitest';
import { tutorAt, type TutorRow } from './tutors.js';

// edge/timetable, Structure, the Homework slot row: "the class's Tutor in
// force on the lesson's date (the acting Tutor while one is set)"; task
// 3.6c-2, decision 3.
const at = (text: string) => new Date(text);

const main: TutorRow = {
  staffId: 'main',
  kind: 'tutor',
  validFrom: at('2026-09-01T00:00:00+05:00'),
  validUntil: at('2026-11-01T00:00:00+05:00'),
};
const next: TutorRow = {
  staffId: 'next',
  kind: 'tutor',
  validFrom: at('2026-11-01T00:00:00+05:00'),
  validUntil: null,
};
const acting: TutorRow = {
  staffId: 'acting',
  kind: 'acting',
  validFrom: at('2026-10-05T00:00:00+05:00'),
  validUntil: at('2026-10-10T00:00:00+05:00'),
};

describe('tutorAt', () => {
  it('gives the Tutor in force', () => {
    expect(tutorAt([main, next], at('2026-10-20T09:00:00+05:00'))).toBe('main');
    expect(tutorAt([main, next], at('2026-11-02T09:00:00+05:00'))).toBe('next');
  });

  it('gives the acting Tutor while one is set, and the Tutor again after', () => {
    const rows = [main, acting];
    expect(tutorAt(rows, at('2026-10-05T00:00:00+05:00'))).toBe('acting');
    expect(tutorAt(rows, at('2026-10-09T15:00:00+05:00'))).toBe('acting');
    expect(tutorAt(rows, at('2026-10-10T00:00:00+05:00'))).toBe('main');
  });

  it('reads ranges half-open: a row ending at the moment does not hold it', () => {
    expect(tutorAt([main, next], at('2026-11-01T00:00:00+05:00'))).toBe('next');
    expect(tutorAt([main], at('2026-11-01T00:00:00+05:00'))).toBeNull();
  });

  it('gives none before the first row, with no rows, and for a withdrawn row', () => {
    expect(tutorAt([main], at('2026-08-31T23:59:59+05:00'))).toBeNull();
    expect(tutorAt([], at('2026-10-01T09:00:00+05:00'))).toBeNull();
    const withdrawn = { ...next, validUntil: next.validFrom };
    expect(tutorAt([withdrawn], next.validFrom)).toBeNull();
  });

  // A version reads the last moment of its day: a give dated today begins at
  // the moment of the give (3.1a decision 9) and is seen; one from tomorrow
  // is not.
  it('sees at the end of a day a Tutor given during that day, not one from the next', () => {
    const givenToday: TutorRow = {
      staffId: 'today',
      kind: 'tutor',
      validFrom: at('2026-10-20T10:30:00+05:00'),
      validUntil: null,
    };
    const endOfDay = at('2026-10-20T23:59:59.999+05:00');
    expect(tutorAt([{ ...main, validUntil: givenToday.validFrom }, givenToday], endOfDay)).toBe(
      'today',
    );
    expect(tutorAt([main], at('2026-10-31T23:59:59.999+05:00'))).toBe('main');
    expect(tutorAt([next], at('2026-10-31T23:59:59.999+05:00'))).toBeNull();
  });
});
