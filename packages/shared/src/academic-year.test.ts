import { describe, expect, it } from 'vitest';
import {
  academicYearDatesProblem,
  academicYearName,
  academicYearRecordSchema,
  goLiveRecordSchema,
  periodOn,
  quarterProblems,
  quartersFormSchema,
  quartersOfForm,
  quartersRecordSchema,
  schoolDateOf,
  schoolDateSchema,
  type PeriodYear,
  type Quarter,
} from './academic-year.js';

const YEAR_ID = '01900000-0000-7000-8000-000000000001';

function year(quarters: Quarter[], overrides: Partial<PeriodYear> = {}): PeriodYear {
  return {
    id: YEAR_ID,
    name: '2026–2027',
    status: 'current',
    startDate: '2026-09-02',
    endDate: '2027-06-30',
    quarters,
    ...overrides,
  };
}

const q = (number: number, startDate: string | null, endDate: string | null): Quarter => ({
  number,
  startDate,
  endDate,
});

const Q1 = q(1, '2026-09-02', '2026-10-31');
const Q2 = q(2, '2026-11-10', '2026-12-27');
const Q3 = q(3, '2027-01-12', '2027-03-20');
const Q4 = q(4, '2027-03-30', '2027-05-25');
const DATED = [Q1, Q2, Q3, Q4];

describe('a school date', () => {
  it('is a day of the calendar written YYYY-MM-DD', () => {
    expect(schoolDateSchema.safeParse('2026-09-02').success).toBe(true);
    expect(schoolDateSchema.safeParse('2028-02-29').success).toBe(true);
    for (const wrong of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-9-2', '02.09.2026', '']) {
      expect(schoolDateSchema.safeParse(wrong).success, wrong).toBe(false);
    }
  });

  // edge/00-definitions, Branch time: "Every date and time rule uses the
  // branch's local time and the server's clock."
  it('is the date of the branch, not of the server', () => {
    expect(schoolDateOf(new Date('2026-10-11T18:59:59Z'), 'Asia/Tashkent')).toBe('2026-10-11');
    expect(schoolDateOf(new Date('2026-10-11T19:00:00Z'), 'Asia/Tashkent')).toBe('2026-10-12');
    expect(schoolDateOf(new Date('2026-12-31T23:30:00Z'), 'Asia/Tashkent')).toBe('2027-01-01');
    expect(schoolDateOf(new Date('2026-12-31T23:30:00Z'), 'UTC')).toBe('2026-12-31');
  });
});

describe('the name of an academic year', () => {
  // Owner's answer 1: "The year's name is derived from its dates ("2026–2027")".
  it('names the two calendar years, with an en dash', () => {
    expect(academicYearName('2026-09-02', '2027-05-25')).toBe('2026–2027');
  });
});

// Decision 1 of pull request #44: a year starts in one calendar year, ends in
// the next, and lasts less than a year.
describe('the dates of an academic year', () => {
  it('end in the next calendar year, less than a year after the start', () => {
    expect(academicYearDatesProblem('2026-09-02', '2027-05-25')).toBeNull();
    expect(academicYearDatesProblem('2026-09-02', '2027-09-01')).toBeNull();
    expect(academicYearDatesProblem('2026-01-01', '2027-12-31')).toBe('too_long');
    expect(academicYearDatesProblem('2026-09-02', '2027-09-02')).toBe('too_long');
    expect(academicYearDatesProblem('2026-09-02', '2026-12-31')).toBe('end_year');
    expect(academicYearDatesProblem('2026-09-02', '2028-01-10')).toBe('end_year');
    expect(academicYearDatesProblem('2027-09-02', '2026-10-01')).toBe('end_year');
  });

  it('count a year from 29 February as PostgreSQL does: to 28 February', () => {
    expect(academicYearDatesProblem('2028-02-29', '2029-02-27')).toBeNull();
    expect(academicYearDatesProblem('2028-02-29', '2029-02-28')).toBe('too_long');
  });

  it('are refused by the schema beside the end date', () => {
    const result = academicYearRecordSchema.safeParse({
      startDate: '2026-09-02',
      endDate: '2026-12-25',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['endDate']]);
    expect(
      academicYearRecordSchema.safeParse({ startDate: '2026-09-02', endDate: '2027-05-25' })
        .success,
    ).toBe(true);
  });
});

// Owner's answer 5: "every quarter inside its year; quarters in order; no
// overlap; gaps between quarters are allowed". Decision 2: both dates or
// neither, one day at the least, dated one at a time.
describe('the four quarters', () => {
  it('may be undated, partly dated, one day long, with gaps between them', () => {
    expect(
      quarterProblems([q(1, null, null), q(2, null, null), q(3, null, null), q(4, null, null)]),
    ).toEqual([]);
    expect(quarterProblems([q(1, null, null), Q2, q(3, null, null), Q4])).toEqual([]);
    expect(
      quarterProblems([q(1, '2026-09-02', '2026-09-02'), q(2, '2026-09-03', '2026-09-03')]),
    ).toEqual([]);
  });

  it('have both dates or neither', () => {
    expect(quarterProblems([q(1, '2026-09-02', null)])).toEqual([
      { index: 0, field: 'endDate', reason: 'both_dates' },
    ]);
    expect(quarterProblems([q(1, null, '2026-10-31')])).toEqual([
      { index: 0, field: 'startDate', reason: 'both_dates' },
    ]);
  });

  it('end on or after their start', () => {
    expect(quarterProblems([q(1, '2026-10-31', '2026-09-02')])).toEqual([
      { index: 0, field: 'endDate', reason: 'end_before_start' },
    ]);
  });

  it('follow in order without overlapping, an undated one between them too', () => {
    expect(quarterProblems([Q1, q(2, '2026-10-31', '2026-12-27')])).toEqual([
      { index: 1, field: 'startDate', reason: 'order' },
    ]);
    expect(quarterProblems([Q2, Q1])).toEqual([{ index: 1, field: 'startDate', reason: 'order' }]);
    expect(quarterProblems([Q1, q(2, null, null), q(3, '2026-10-15', '2026-12-01')])).toEqual([
      { index: 2, field: 'startDate', reason: 'order' },
    ]);
  });

  it('come to the route as exactly four, refused beside the field', () => {
    expect(quartersRecordSchema.safeParse({ quarters: DATED }).success).toBe(true);
    expect(quartersRecordSchema.safeParse({ quarters: DATED.slice(0, 3) }).success).toBe(false);
    const overlapping = quartersRecordSchema.safeParse({
      quarters: [Q1, { startDate: '2026-10-01', endDate: '2026-12-27' }, Q3, Q4],
    });

    expect(overlapping.error?.issues.map((issue) => issue.path)).toEqual([
      ['quarters', 1, 'startDate'],
    ]);
  });

  it('come from the form with the same rules, an empty field being no date', () => {
    const typed = {
      q1Start: '2026-09-02',
      q1End: '2026-10-31',
      q2Start: '',
      q2End: '',
      q3Start: '2027-01-12',
      q3End: '2027-03-20',
      q4Start: ' ',
      q4End: '',
    };
    const result = quartersFormSchema.safeParse(typed);

    expect(result.success).toBe(true);
    expect(result.data === undefined ? null : quartersOfForm(result.data)).toEqual({
      quarters: [
        { startDate: '2026-09-02', endDate: '2026-10-31' },
        { startDate: null, endDate: null },
        { startDate: '2027-01-12', endDate: '2027-03-20' },
        { startDate: null, endDate: null },
      ],
    });
    const wrong = quartersFormSchema.safeParse({
      ...typed,
      q3Start: '2026-10-01',
      q4Start: 'soon',
      q4End: '2027-05-25',
    });

    expect(wrong.error?.issues.map((issue) => issue.path[0]).sort()).toEqual([
      'q3Start',
      'q4Start',
    ]);
  });
});

describe('the go-live date', () => {
  it('is a date or nothing', () => {
    expect(goLiveRecordSchema.safeParse({ goLiveDate: '2026-11-10' }).success).toBe(true);
    expect(goLiveRecordSchema.safeParse({ goLiveDate: null }).success).toBe(true);
    expect(goLiveRecordSchema.safeParse({ goLiveDate: '10.11.2026' }).success).toBe(false);
  });
});

// Owner's answer 8 and edge/time-dates-calendar, "A page is opened on a date
// that is in no quarter": "The top bar shows 'Vacation, quarter 2 starts on 10
// November'. 'Current quarter' then means the latest quarter that has started.
// Before quarter 1, pages show a plain 'quarter 1 starts on...' message."
// Decision 9 of pull request #44.
describe('the year and quarter of the top bar', () => {
  it('is nothing when the branch has no current year and no planned year to come', () => {
    expect(periodOn('2026-10-11', []).state).toBe('no_year');
    expect(periodOn('2027-07-01', [year(DATED, { status: 'planned' })]).state).toBe('no_year');
    expect(periodOn('2027-07-01', [year(DATED, { status: 'closed' })]).state).toBe('no_year');
  });

  it('shows the current year before a planned one', () => {
    const planned = year(DATED, {
      id: '01900000-0000-7000-8000-000000000002',
      name: '2027–2028',
      status: 'planned',
      startDate: '2027-09-02',
      endDate: '2028-05-25',
    });

    expect(periodOn('2026-10-11', [planned, year(DATED)]).year?.id).toBe(YEAR_ID);
  });

  it('shows the earliest planned year that has not ended when no year is current', () => {
    const later = year([], {
      id: '01900000-0000-7000-8000-000000000003',
      name: '2028–2029',
      status: 'planned',
      startDate: '2028-09-02',
      endDate: '2029-05-25',
    });
    const sooner = year([], {
      id: '01900000-0000-7000-8000-000000000002',
      name: '2027–2028',
      status: 'planned',
      startDate: '2027-09-02',
      endDate: '2028-05-25',
    });

    expect(periodOn('2027-08-01', [later, sooner]).year).toEqual({
      id: '01900000-0000-7000-8000-000000000002',
      name: '2027–2028',
      status: 'planned',
    });
  });

  it('says the quarters are not dated', () => {
    expect(
      periodOn('2026-10-11', [
        year([q(1, null, null), q(2, null, null), q(3, null, null), q(4, null, null)]),
      ]),
    ).toMatchObject({ state: 'not_dated', quarter: null, next: null });
  });

  it('names the quarter a date lies in, its first and last day included', () => {
    expect(periodOn('2026-09-02', [year(DATED)])).toMatchObject({
      state: 'in_quarter',
      quarter: Q1,
    });
    expect(periodOn('2026-10-31', [year(DATED)])).toMatchObject({
      state: 'in_quarter',
      quarter: Q1,
    });
    expect(periodOn('2026-12-01', [year(DATED)])).toMatchObject({
      state: 'in_quarter',
      quarter: Q2,
    });
  });

  it('says when quarter 1 starts, before it starts', () => {
    expect(periodOn('2026-08-20', [year(DATED)])).toMatchObject({
      state: 'before_first',
      quarter: null,
      next: Q1,
    });
  });

  it('says vacation and when the next quarter starts, between quarters', () => {
    expect(periodOn('2026-11-05', [year(DATED)])).toMatchObject({
      state: 'vacation',
      quarter: Q1,
      next: Q2,
    });
  });

  it('says vacation alone after the last quarter of the year', () => {
    expect(periodOn('2027-06-10', [year(DATED)])).toMatchObject({
      state: 'vacation',
      quarter: Q4,
      next: null,
    });
  });

  it('counts only dated quarters when some are undated', () => {
    const partly = [Q1, q(2, null, null), q(3, null, null), q(4, null, null)];

    expect(periodOn('2026-11-20', [year(partly)])).toMatchObject({
      state: 'vacation',
      quarter: Q1,
      next: null,
    });
    const laterOnly = [q(1, null, null), Q2, q(3, null, null), q(4, null, null)];

    expect(periodOn('2026-10-11', [year(laterOnly)])).toMatchObject({
      state: 'before_first',
      next: Q2,
    });
  });

  // In place of a property test (no property-testing library is installed, and
  // adding one is the owner's): every day from before the year to after it,
  // over several layouts of the quarters, keeps the rules of the states.
  it('keeps its rules on every day of the year, for every layout of the quarters', () => {
    const layouts: Quarter[][] = [
      DATED,
      [Q1, q(2, null, null), Q3, q(4, null, null)],
      [q(1, null, null), q(2, null, null), q(3, null, null), Q4],
      [q(1, '2026-09-02', '2026-09-02'), q(2, '2026-09-03', '2026-09-03'), Q3, Q4],
    ];
    for (const layout of layouts) {
      const dated = layout.filter((quarter) => quarter.startDate !== null);
      for (let day = Date.UTC(2026, 7, 1); day <= Date.UTC(2027, 6, 31); day += 86_400_000) {
        const today = new Date(day).toISOString().slice(0, 10);
        const period = periodOn(today, [year(layout)]);
        const containing = dated.find(
          (quarter) => (quarter.startDate ?? '') <= today && today <= (quarter.endDate ?? ''),
        );

        expect(period.state === 'in_quarter', today).toBe(containing !== undefined);
        if (period.state === 'in_quarter') {
          expect(period.quarter, today).toEqual(containing);
        }
        const next = period.next;
        if (next !== null) {
          expect((next.startDate ?? '') > today, today).toBe(true);
          const sooner = dated.filter(
            (quarter) => (quarter.startDate ?? '') > today && quarter.number < next.number,
          );
          expect(sooner, today).toEqual([]);
        }
        if (period.state === 'vacation') {
          expect((period.quarter?.endDate ?? '') < today, today).toBe(true);
        }
        if (period.state === 'before_first') {
          expect(
            dated.every((quarter) => (quarter.startDate ?? '') > today),
            today,
          ).toBe(true);
        }
      }
    }
  });
});
