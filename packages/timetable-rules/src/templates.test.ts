import { describe, expect, it } from 'vitest';
import { inForceOn, templateFor, type TemplateAssignment } from './templates.js';

const open = (from: string) => ({ validFrom: from, validUntil: null });

// docs/spec/edge-cases/developer-rules.md, Lesson times: "Ranges are half-open".
describe('inForceOn', () => {
  const rows = [
    { id: 'a', validFrom: '2026-09-01', validUntil: '2026-11-01' },
    { id: 'b', validFrom: '2026-11-01', validUntil: null },
    { id: 'withdrawn', validFrom: '2026-12-01', validUntil: '2026-12-01' },
  ];

  it('takes the row whose range holds the date, the first day in and the last day out', () => {
    expect(inForceOn(rows, '2026-09-01').map((row) => row.id)).toEqual(['a']);
    expect(inForceOn(rows, '2026-10-31').map((row) => row.id)).toEqual(['a']);
    expect(inForceOn(rows, '2026-11-01').map((row) => row.id)).toEqual(['b']);
    expect(inForceOn(rows, '2030-01-01').map((row) => row.id)).toEqual(['b']);
  });

  it('takes nothing before the first row', () => {
    expect(inForceOn(rows, '2026-08-31')).toEqual([]);
  });

  it('never takes a withdrawn row (an empty range)', () => {
    expect(inForceOn(rows, '2026-12-01').map((row) => row.id)).toEqual(['b']);
  });
});

// docs/spec/03-school-setup.md, Slot types and day templates: "For a class on
// a date, the first of these that applies wins: a special date for its grade
// range, then a special date for the branch, then weekday with grade range,
// then weekday, then grade range, then the default."
describe('templateFor', () => {
  const monday = '2026-10-12';
  const friday = '2026-10-16';

  const everyLevel: TemplateAssignment[] = [
    {
      level: 'default',
      weekday: null,
      gradeFrom: null,
      gradeTo: null,
      dayTemplateId: 'default',
      ...open('2026-09-01'),
    },
    {
      level: 'grades',
      weekday: null,
      gradeFrom: 9,
      gradeTo: 11,
      dayTemplateId: 'grades 9-11',
      ...open('2026-09-01'),
    },
    {
      level: 'weekday',
      weekday: 1,
      gradeFrom: null,
      gradeTo: null,
      dayTemplateId: 'monday',
      ...open('2026-09-01'),
    },
    {
      level: 'weekday_grades',
      weekday: 1,
      gradeFrom: 10,
      gradeTo: 11,
      dayTemplateId: 'monday 10-11',
      ...open('2026-09-01'),
    },
  ];
  const specialDates = [
    { date: monday, gradeFrom: null, gradeTo: null, dayTemplateId: 'special branch' },
    { date: monday, gradeFrom: 11, gradeTo: 11, dayTemplateId: 'special 11' },
  ];

  it('takes a special date for the grade range first', () => {
    expect(templateFor(11, monday, { assignments: everyLevel, specialDates })).toBe('special 11');
  });

  it('then a special date for the branch', () => {
    expect(templateFor(10, monday, { assignments: everyLevel, specialDates })).toBe(
      'special branch',
    );
  });

  it('then weekday with grade range, then weekday', () => {
    expect(templateFor(10, monday, { assignments: everyLevel, specialDates: [] })).toBe(
      'monday 10-11',
    );
    expect(templateFor(9, monday, { assignments: everyLevel, specialDates: [] })).toBe('monday');
  });

  it('then grade range, then the default', () => {
    const tuesday = '2026-10-13';
    expect(templateFor(9, tuesday, { assignments: everyLevel })).toBe('grades 9-11');
    expect(templateFor(8, tuesday, { assignments: everyLevel })).toBe('default');
  });

  it('gives no template when nothing applies', () => {
    expect(templateFor(5, monday, { assignments: [] })).toBeNull();
    // Before the default takes effect.
    expect(templateFor(5, '2026-08-31', { assignments: everyLevel })).toBeNull();
  });

  it('reads each setting on the date: a change from a date applies from it, not before', () => {
    const changing: TemplateAssignment[] = [
      {
        level: 'default',
        weekday: null,
        gradeFrom: null,
        gradeTo: null,
        dayTemplateId: 'old',
        validFrom: '2026-09-01',
        validUntil: '2026-10-14',
      },
      {
        level: 'default',
        weekday: null,
        gradeFrom: null,
        gradeTo: null,
        dayTemplateId: 'new',
        ...open('2026-10-14'),
      },
    ];
    expect(templateFor(5, '2026-10-13', { assignments: changing })).toBe('old');
    expect(templateFor(5, '2026-10-14', { assignments: changing })).toBe('new');
  });

  it('ignores a special date of another date', () => {
    expect(templateFor(11, friday, { assignments: everyLevel, specialDates })).toBe('grades 9-11');
  });

  // docs/spec/edge-cases/time-dates-calendar.md: "Friday is the same for every
  // grade, but Monday to Thursday grades 9–11 have lunch one slot later."
  it('settles the Friday example: the weekday wins on Friday, grades 9 to 11 take theirs on the other days', () => {
    const assignments: TemplateAssignment[] = [
      {
        level: 'default',
        weekday: null,
        gradeFrom: null,
        gradeTo: null,
        dayTemplateId: 'default',
        ...open('2026-09-01'),
      },
      {
        level: 'weekday',
        weekday: 5,
        gradeFrom: null,
        gradeTo: null,
        dayTemplateId: 'friday',
        ...open('2026-09-01'),
      },
      {
        level: 'grades',
        weekday: null,
        gradeFrom: 9,
        gradeTo: 11,
        dayTemplateId: 'senior',
        ...open('2026-09-01'),
      },
    ];
    for (const grade of [1, 5, 9, 11]) {
      expect(templateFor(grade, friday, { assignments })).toBe('friday');
    }
    expect(templateFor(9, monday, { assignments })).toBe('senior');
    expect(templateFor(11, monday, { assignments })).toBe('senior');
    expect(templateFor(8, monday, { assignments })).toBe('default');
  });

  it('reads the settings of the date for another weekday when one is given, as the table does', () => {
    // 2026-10-13 is a Tuesday; the Monday settings in force on it apply.
    expect(templateFor(10, '2026-10-13', { assignments: everyLevel }, 1)).toBe('monday 10-11');
    expect(templateFor(5, '2026-10-13', { assignments: everyLevel }, 1)).toBe('monday');
    expect(templateFor(5, '2026-10-13', { assignments: everyLevel }, 2)).toBe('default');
  });

  it('reads Sunday as weekday 7', () => {
    const assignments: TemplateAssignment[] = [
      {
        level: 'weekday',
        weekday: 7,
        gradeFrom: null,
        gradeTo: null,
        dayTemplateId: 'sunday',
        ...open('2026-09-01'),
      },
    ];
    expect(templateFor(1, '2026-10-18', { assignments })).toBe('sunday');
    expect(templateFor(1, '2026-10-17', { assignments })).toBeNull();
  });
});
