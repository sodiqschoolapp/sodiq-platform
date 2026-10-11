import { describe, expect, it } from 'vitest';
import { dayOn, isSchoolDay, type CalendarEntry, type CalendarSettings } from './calendar.js';
import type { TemplateAssignment } from './templates.js';

const open = (from: string) => ({ validFrom: from, validUntil: null });

const defaultRow: TemplateAssignment = {
  level: 'default',
  weekday: null,
  gradeFrom: null,
  gradeTo: null,
  dayTemplateId: 'default',
  ...open('2026-09-01'),
};

const assignments: TemplateAssignment[] = [
  defaultRow,
  {
    level: 'weekday_grades',
    weekday: 2,
    gradeFrom: 1,
    gradeTo: 4,
    dayTemplateId: 'tuesday 1-4',
    ...open('2026-09-01'),
  },
];

const entry = (fields: Partial<CalendarEntry> & Pick<CalendarEntry, 'id' | 'kind'>) => ({
  firstDate: '2026-10-14',
  lastDate: '2026-10-14',
  gradeFrom: null,
  gradeTo: null,
  dayTemplateId: null,
  followsWeekday: null,
  examWeek: null,
  ...fields,
});

const settings = (entries: CalendarEntry[]): CalendarSettings => ({
  workingWeekdays: [1, 2, 3, 4, 5],
  assignments,
  entries,
});

// 12 to 18 October 2026: Monday to Sunday.
const monday = '2026-10-12';
const tuesday = '2026-10-13';
const wednesday = '2026-10-14';
const thursday = '2026-10-15';
const saturday = '2026-10-17';

// docs/spec/03-school-setup.md, Academic calendar: "Each date resolves to 'no
// lessons' or to one day template."
describe('dayOn', () => {
  it('gives the regular template on a working weekday without an entry', () => {
    expect(dayOn(5, wednesday, settings([]))).toEqual({
      lessons: true,
      dayTemplateId: 'default',
      followsWeekday: 3,
      examWeek: null,
      entryId: null,
    });
    expect(dayOn(2, tuesday, settings([]))).toMatchObject({
      dayTemplateId: 'tuesday 1-4',
      followsWeekday: 2,
    });
  });

  it('gives no lessons on a weekday that is not a working weekday', () => {
    expect(dayOn(5, saturday, settings([]))).toEqual({
      lessons: false,
      reason: 'not_working_day',
      entryId: null,
    });
  });

  it('gives no lessons before any template is set', () => {
    expect(
      dayOn(5, wednesday, { workingWeekdays: [1, 2, 3, 4, 5], assignments: [], entries: [] }),
    ).toEqual({ lessons: false, reason: 'no_template', entryId: null });
  });

  // Done when: a holiday inside a week.
  it('gives a holiday inside a week no lessons and leaves the days around it', () => {
    const holiday = settings([entry({ id: 'holiday', kind: 'day_off' })]);
    for (let grade = 1; grade <= 11; grade += 1) {
      expect(dayOn(grade, wednesday, holiday)).toEqual({
        lessons: false,
        reason: 'day_off',
        entryId: 'holiday',
      });
    }
    expect(dayOn(2, tuesday, holiday)).toMatchObject({
      lessons: true,
      dayTemplateId: 'tuesday 1-4',
    });
    expect(dayOn(2, thursday, holiday)).toMatchObject({ lessons: true, dayTemplateId: 'default' });
  });

  it('counts the first and the last date of an entry', () => {
    const week = settings([
      entry({ id: 'off', kind: 'day_off', firstDate: tuesday, lastDate: thursday }),
    ]);
    expect(dayOn(5, monday, week).lessons).toBe(true);
    expect(dayOn(5, tuesday, week).lessons).toBe(false);
    expect(dayOn(5, thursday, week).lessons).toBe(false);
    expect(dayOn(5, '2026-10-16', week).lessons).toBe(true);
  });

  // Done when: a working Saturday. edge/time-dates-calendar: "A Saturday is
  // worked 'by Monday's timetable'."
  it('gives a working Saturday its template, following Monday', () => {
    const workingSaturday = settings([
      entry({
        id: 'saturday',
        kind: 'special_day',
        firstDate: saturday,
        lastDate: saturday,
        dayTemplateId: 'short',
        followsWeekday: 1,
      }),
    ]);
    expect(dayOn(7, saturday, workingSaturday)).toEqual({
      lessons: true,
      dayTemplateId: 'short',
      followsWeekday: 1,
      examWeek: null,
      entryId: 'saturday',
    });
    expect(dayOn(7, '2026-10-10', workingSaturday).lessons).toBe(false);
    expect(dayOn(7, '2026-10-24', workingSaturday).lessons).toBe(false);
  });

  // The review of the plan, correction 1: answer 15, "on a non-working
  // weekday, the weekday it follows".
  it('applies the followed weekday only to the dates on a non-working weekday', () => {
    const examWeek = settings([
      entry({
        id: 'exams',
        kind: 'special_day',
        firstDate: monday,
        lastDate: saturday,
        dayTemplateId: 'exam',
        followsWeekday: 1,
        examWeek: 'regular_lessons',
      }),
    ]);
    expect(dayOn(9, tuesday, examWeek)).toEqual({
      lessons: true,
      dayTemplateId: 'exam',
      followsWeekday: 2,
      examWeek: 'regular_lessons',
      entryId: 'exams',
    });
    expect(dayOn(9, saturday, examWeek)).toMatchObject({
      dayTemplateId: 'exam',
      followsWeekday: 1,
    });
  });

  // Done when: a grade-range entry.
  it('applies a grade-range day off to its grades only', () => {
    const seniorsOff = settings([
      entry({ id: 'seniors', kind: 'day_off', gradeFrom: 9, gradeTo: 11 }),
    ]);
    expect(dayOn(8, wednesday, seniorsOff)).toMatchObject({
      lessons: true,
      dayTemplateId: 'default',
    });
    expect(dayOn(9, wednesday, seniorsOff)).toMatchObject({ lessons: false, entryId: 'seniors' });
    expect(dayOn(11, wednesday, seniorsOff)).toMatchObject({ lessons: false, entryId: 'seniors' });
  });

  it('lets a grade-range special day win over a weekday-with-grades setting', () => {
    const juniors = settings([
      entry({
        id: 'juniors',
        kind: 'special_day',
        firstDate: tuesday,
        lastDate: tuesday,
        gradeFrom: 1,
        gradeTo: 4,
        dayTemplateId: 'open doors',
      }),
    ]);
    expect(dayOn(3, tuesday, juniors)).toMatchObject({
      dayTemplateId: 'open doors',
      followsWeekday: 2,
      entryId: 'juniors',
    });
    expect(dayOn(5, tuesday, juniors)).toMatchObject({ dayTemplateId: 'default', entryId: null });
  });

  // Owner's answer 17: "a day off beats a special day".
  it('lets a day off beat a special day on the same date', () => {
    const both = settings([
      entry({ id: 'special', kind: 'special_day', dayTemplateId: 'short' }),
      entry({ id: 'off', kind: 'day_off', gradeFrom: 1, gradeTo: 4 }),
    ]);
    expect(dayOn(2, wednesday, both)).toEqual({
      lessons: false,
      reason: 'day_off',
      entryId: 'off',
    });
    expect(dayOn(6, wednesday, both)).toMatchObject({ dayTemplateId: 'short', entryId: 'special' });
  });

  it('lets a whole-branch day off beat a grade-range special day', () => {
    const both = settings([
      entry({
        id: 'special',
        kind: 'special_day',
        gradeFrom: 1,
        gradeTo: 4,
        dayTemplateId: 'short',
      }),
      entry({ id: 'off', kind: 'day_off' }),
    ]);
    expect(dayOn(2, wednesday, both)).toMatchObject({ lessons: false, entryId: 'off' });
  });

  it('gives a special day on a working weekday without a followed weekday its own weekday', () => {
    const special = settings([entry({ id: 'short', kind: 'special_day', dayTemplateId: 'short' })]);
    expect(dayOn(5, wednesday, special)).toMatchObject({
      dayTemplateId: 'short',
      followsWeekday: 3,
    });
  });

  // Decision 14 of the plan: a template version withdrawn before it took
  // effect leaves no date without a version, so a special day keeps its
  // template; dayOn names the template, its times come from the version in
  // force (dayOf of the API).
  it('names the special day template whatever the settings in force', () => {
    const special = settings([entry({ id: 'short', kind: 'special_day', dayTemplateId: 'short' })]);
    const withdrawn: CalendarSettings = {
      ...special,
      assignments: [
        { ...defaultRow, validUntil: '2026-09-01' }, // withdrawn: an empty range
      ],
    };
    expect(dayOn(5, wednesday, withdrawn)).toMatchObject({ dayTemplateId: 'short' });
    expect(dayOn(5, thursday, withdrawn)).toEqual({
      lessons: false,
      reason: 'no_template',
      entryId: null,
    });
  });
});

// edge/academic-year: "Go-live can be on any school day."
describe('isSchoolDay', () => {
  it('is a school day when some grade has lessons', () => {
    expect(isSchoolDay(wednesday, settings([]))).toBe(true);
    expect(
      isSchoolDay(
        wednesday,
        settings([entry({ id: 'seniors', kind: 'day_off', gradeFrom: 9, gradeTo: 11 })]),
      ),
    ).toBe(true);
  });

  it('is a school day on a working weekday before any template is set', () => {
    const none: CalendarSettings = {
      workingWeekdays: [1, 2, 3, 4, 5],
      assignments: [],
      entries: [],
    };
    expect(isSchoolDay(wednesday, none)).toBe(true);
    expect(isSchoolDay(saturday, none)).toBe(false);
    expect(
      isSchoolDay(wednesday, { ...none, entries: [entry({ id: 'off', kind: 'day_off' })] }),
    ).toBe(false);
  });

  it('is no school day on a whole-branch day off or a non-working weekday', () => {
    expect(isSchoolDay(wednesday, settings([entry({ id: 'off', kind: 'day_off' })]))).toBe(false);
    expect(isSchoolDay(saturday, settings([]))).toBe(false);
  });

  it('is a school day on a working Saturday', () => {
    expect(
      isSchoolDay(
        saturday,
        settings([
          entry({
            id: 'saturday',
            kind: 'special_day',
            firstDate: saturday,
            lastDate: saturday,
            dayTemplateId: 'short',
            followsWeekday: 1,
          }),
        ]),
      ),
    ).toBe(true);
  });
});
