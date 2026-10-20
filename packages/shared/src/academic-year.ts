import { z } from 'zod';

/**
 * Academic years and quarters (docs/spec/03-school-setup.md, Academic year and
 * Quarters; task 1.3), the go-live date of a branch and the year and quarter of
 * the top bar. The owner's answers 1 to 8 for task 1.3 are in
 * docs/decisions.md ("Decided ahead for tasks 1.3 to 1.6"); the decisions of
 * the plan are on pull request #44. The database keeps the same rules
 * (db/migrations/0016); a test compares the two.
 */

/**
 * A school date, `YYYY-MM-DD` (CLAUDE.md: "school dates as dates"). The
 * database answers `date` columns as this text (`apps/api/src/database/database.ts`).
 * `z.iso.date()` takes days of the calendar only: 2026-02-30 and 2027-02-29 are refused.
 */
export const schoolDateSchema = z.iso.date();

export type SchoolDate = string;

const yearOf = (date: SchoolDate): number => Number(date.slice(0, 4));

/**
 * The name of a year, derived from its dates (owner's answer 1): "2026–2027",
 * with an en dash. Nothing is typed.
 */
export function academicYearName(startDate: SchoolDate, endDate: SchoolDate): string {
  return `${String(yearOf(startDate))}–${String(yearOf(endDate))}`;
}

/**
 * Why the dates of a year are refused, or `null`. A year ends in the calendar
 * year after the one it starts in, and lasts less than a year (decision 1 of
 * the plan): so the name always names two years, and with the no-overlap rule
 * two years of a branch never share a name. The same rule as
 * `academic_years_dates_check`; PostgreSQL's "start + 1 year" of 29 February
 * is 28 February.
 */
export function academicYearDatesProblem(
  startDate: SchoolDate,
  endDate: SchoolDate,
): 'end_year' | 'too_long' | null {
  if (yearOf(endDate) !== yearOf(startDate) + 1) {
    return 'end_year';
  }
  const startDay = startDate.slice(5);
  const yearLater = `${String(yearOf(endDate))}-${startDay === '02-29' ? '02-28' : startDay}`;
  return endDate < yearLater ? null : 'too_long';
}

export const ACADEMIC_YEAR_STATUSES = ['planned', 'current', 'closed'] as const;

export const academicYearStatusSchema = z.enum(ACADEMIC_YEAR_STATUSES);

export type AcademicYearStatus = z.infer<typeof academicYearStatusSchema>;

/** "Four per year." */
export const QUARTER_NUMBERS = [1, 2, 3, 4] as const;

/** What is typed for a year: its two dates. A new year is always planned. */
export const academicYearRecordSchema = z
  .object({ startDate: schoolDateSchema, endDate: schoolDateSchema })
  .superRefine((year, context) => {
    const problem = academicYearDatesProblem(year.startDate, year.endDate);
    if (problem === 'end_year') {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'A year ends in the calendar year after the one it starts in.',
        params: { reason: 'end_year' },
      });
    }
    if (problem === 'too_long') {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'A year lasts less than a year.',
        params: { reason: 'too_long' },
      });
    }
  });

export type AcademicYearRecord = z.infer<typeof academicYearRecordSchema>;

/** The dates of one quarter: both or neither (decision 2). */
export interface QuarterDates {
  startDate: SchoolDate | null;
  endDate: SchoolDate | null;
}

/** One rule a quarter breaks, with the field to show it beside. */
export interface QuarterProblem {
  /** 0 for quarter 1. */
  index: number;
  field: 'startDate' | 'endDate';
  reason: 'both_dates' | 'end_before_start' | 'order';
}

/**
 * The rules of the four quarters that need no year (owner's answer 5, decision
 * 2): a quarter has both dates or neither; it ends on or after its start; the
 * dated quarters follow in number order, each starting after the previous
 * dated one ends (the gaps are the vacations). "Inside the year" needs the
 * year's dates: the API and the database check it. The same rules as
 * `quarters_dates_check` and `quarters_order`.
 */
export function quarterProblems(quarters: readonly QuarterDates[]): QuarterProblem[] {
  const problems: QuarterProblem[] = [];
  let previousEnd: SchoolDate | null = null;
  quarters.forEach((quarter, index) => {
    // A field that is not a date has its own issue; the rules between dates
    // would only add noise beside it.
    const unread = [quarter.startDate, quarter.endDate].some(
      (date) => date !== null && !schoolDateSchema.safeParse(date).success,
    );
    if (unread) {
      return;
    }
    if ((quarter.startDate === null) !== (quarter.endDate === null)) {
      problems.push({
        index,
        field: quarter.startDate === null ? 'startDate' : 'endDate',
        reason: 'both_dates',
      });
      return;
    }
    if (quarter.startDate === null || quarter.endDate === null) {
      return;
    }
    if (quarter.endDate < quarter.startDate) {
      problems.push({ index, field: 'endDate', reason: 'end_before_start' });
      return;
    }
    if (previousEnd !== null && quarter.startDate <= previousEnd) {
      problems.push({ index, field: 'startDate', reason: 'order' });
    }
    previousEnd = quarter.endDate;
  });
  return problems;
}

const QUARTER_PROBLEM_MESSAGES: Record<QuarterProblem['reason'], string> = {
  both_dates: 'A quarter has both dates or neither.',
  end_before_start: 'A quarter ends on or after its start.',
  order: 'A quarter starts after the previous one ends.',
};

/** The dates of one quarter as the routes take them. */
export const quarterDatesSchema = z.object({
  startDate: schoolDateSchema.nullable(),
  endDate: schoolDateSchema.nullable(),
});

/** The four quarters' dates, quarter 1 first. */
export const quarterListSchema = z.array(quarterDatesSchema).length(QUARTER_NUMBERS.length);

/** Adds an issue per problem of `quarterProblems`; shared with the save of task 5.6b-5a. */
export function refineQuarters(
  record: { readonly quarters: readonly QuarterDates[] },
  context: z.RefinementCtx,
): void {
  for (const problem of quarterProblems(record.quarters)) {
    context.addIssue({
      code: 'custom',
      path: ['quarters', problem.index, problem.field],
      message: QUARTER_PROBLEM_MESSAGES[problem.reason],
      params: { reason: problem.reason },
    });
  }
}

/** The four quarters of a year as the route takes them, quarter 1 first. */
export const quartersRecordSchema = z
  .object({ quarters: quarterListSchema })
  .superRefine(refineQuarters);

export type QuartersRecord = z.infer<typeof quartersRecordSchema>;

/** A class (with its grade) or a group (whose name carries its grade), as a line names it. */
const lineUnitSchema = z.object({
  kind: z.enum(['class', 'group']),
  name: z.string(),
  grade: z.int().nullable(),
});

/** A subject named in the three languages, as `previewNamesSchema` names one. */
const lineSubjectSchema = z.object({
  id: z.uuid(),
  names: z.object({ uz: z.string(), ru: z.string(), en: z.string() }),
});

/**
 * What stands in the way of a save of the quarters (decisions 3, 5 and 6):
 * a lesson of today or earlier on a date whose quarter would change
 * (`quarter_past_lessons`); a standing exam on a date that would leave every
 * quarter (`quarter_leaves_exam`); a stored one-day move whose two dates
 * would lie in two quarters (`quarter_splits_move`). Task 5.6b-5b: an exam
 * of the year that new year dates would leave out (`year_leaves_exam`),
 * cancelled ones too, marked; a lesson names its subject in the three
 * languages, so a refusal's lines need no second query.
 */
export const quarterItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('past_lesson'),
    date: schoolDateSchema,
    unit: lineUnitSchema,
    subject: lineSubjectSchema,
  }),
  z.object({
    kind: z.literal('exam'),
    date: schoolDateSchema,
    title: z.string(),
    cancelled: z.boolean(),
  }),
  z.object({
    kind: z.literal('split_move'),
    fromDate: schoolDateSchema,
    toDate: schoolDateSchema,
    unit: lineUnitSchema,
    subject: lineSubjectSchema,
  }),
  /**
   * Task 5.6c-3b (decision 2): a journal the new dates would give two
   * standing rating exams in one quarter, `date` the later one's.
   */
  z.object({
    kind: z.literal('rating_exams'),
    date: schoolDateSchema,
    unit: lineUnitSchema,
    subject: lineSubjectSchema,
    exams: z.array(z.object({ title: z.string(), date: schoolDateSchema })).min(2),
  }),
]);

export type QuarterItem = z.infer<typeof quarterItemSchema>;

/** The two fields of each quarter in the quarters form, quarter 1 first. */
const QUARTER_FIELD_PAIRS = [
  ['q1Start', 'q1End'],
  ['q2Start', 'q2End'],
  ['q3Start', 'q3End'],
  ['q4Start', 'q4End'],
] as const;

/** The fields of the quarters form: `q1Start`, `q1End` … `q4End`. */
export const QUARTER_FORM_FIELDS = QUARTER_FIELD_PAIRS.flat();

export type QuarterFormField = (typeof QUARTER_FORM_FIELDS)[number];

/** An empty field is no date. */
const optionalDate = z
  .string()
  .trim()
  .transform((text) => (text === '' ? null : text))
  .pipe(schoolDateSchema.nullable());

/**
 * The quarters form, flat (the form reads issues by the first path element),
 * with the same rules as `quartersRecordSchema`; `quartersOfForm` turns it into
 * the route's body.
 */
export const quartersFormSchema = z
  .object(
    Object.fromEntries(QUARTER_FORM_FIELDS.map((field) => [field, optionalDate])) as Record<
      QuarterFormField,
      typeof optionalDate
    >,
  )
  .superRefine((form, context) => {
    for (const problem of quarterProblems(quartersOfForm(form).quarters)) {
      const [start, end] = QUARTER_FIELD_PAIRS[problem.index] ?? QUARTER_FIELD_PAIRS[0];
      context.addIssue({
        code: 'custom',
        path: [problem.field === 'startDate' ? start : end],
        message: QUARTER_PROBLEM_MESSAGES[problem.reason],
        params: { reason: problem.reason },
      });
    }
  });

export type QuartersForm = z.infer<typeof quartersFormSchema>;

/** The route's body from the checked form. */
export function quartersOfForm(form: Record<QuarterFormField, SchoolDate | null>): QuartersRecord {
  return {
    quarters: QUARTER_FIELD_PAIRS.map(([start, end]) => ({
      startDate: form[start],
      endDate: form[end],
    })),
  };
}

export const quarterSchema = z.object({
  number: z.int().min(1).max(4),
  startDate: schoolDateSchema.nullable(),
  endDate: schoolDateSchema.nullable(),
});

export type Quarter = z.infer<typeof quarterSchema>;

/** A year as the routes answer it, with its four quarters in number order. */
export const academicYearSchema = z.object({
  id: z.uuid(),
  /** Derived from the dates: "2026–2027". */
  name: z.string(),
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
  status: academicYearStatusSchema,
  quarters: z.array(quarterSchema),
});

export type AcademicYear = z.infer<typeof academicYearSchema>;

/** The years of a branch, newest first. */
export const academicYearListSchema = z.object({ years: z.array(academicYearSchema) });

export type AcademicYearList = z.infer<typeof academicYearListSchema>;

/**
 * The go-live start date of the branch of the request (owner's answer 7), or
 * `null` to clear it. It lies inside a planned or current year of the branch.
 */
export const goLiveRecordSchema = z.object({ goLiveDate: schoolDateSchema.nullable() });

export type GoLiveRecord = z.infer<typeof goLiveRecordSchema>;

/**
 * The date of a moment in a time zone (`edge/00-definitions`, Branch time:
 * "Every date and time rule uses the branch's local time and the server's
 * clock").
 */
export function schoolDateOf(moment: Date, timeZone: string): SchoolDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(moment);
  const part = (type: 'year' | 'month' | 'day'): string =>
    parts.find((one) => one.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Where a date stands in the year shown (decision 9 of the plan; owner's answer
 * 8; `edge/time-dates-calendar`, "A page is opened on a date that is in no
 * quarter"). Only dated quarters count.
 *
 * - `no_year`: the branch has no current year and no planned year that has not ended.
 * - `not_dated`: no quarter of the year is dated.
 * - `before_first`: before the first dated quarter starts; `next` is that quarter.
 * - `in_quarter`: the date lies in `quarter`.
 * - `vacation`: a dated quarter has started and the date lies in none; `quarter`
 *   is the latest that started ("Current quarter then means the latest quarter
 *   that has started") and `next` the next dated one, or `null`.
 */
export const PERIOD_STATES = [
  'no_year',
  'not_dated',
  'before_first',
  'in_quarter',
  'vacation',
] as const;

export type PeriodState = (typeof PERIOD_STATES)[number];

export const currentPeriodSchema = z.object({
  /** The date of the branch now, from the server's clock. */
  today: schoolDateSchema,
  year: z
    .object({
      id: z.uuid(),
      name: z.string(),
      status: academicYearStatusSchema,
    })
    .nullable(),
  state: z.enum(PERIOD_STATES),
  quarter: quarterSchema.nullable(),
  next: quarterSchema.nullable(),
});

export type CurrentPeriod = z.infer<typeof currentPeriodSchema>;

/** The parts of a year `periodOn` reads. */
export interface PeriodYear {
  id: string;
  name: string;
  status: AcademicYearStatus;
  startDate: SchoolDate;
  endDate: SchoolDate;
  quarters: readonly Quarter[];
}

/**
 * The year and quarter of the top bar on a date: the current year; when the
 * branch has none, the earliest planned year that has not ended (the top bar
 * labels it planned); else none.
 */
export function periodOn(today: SchoolDate, years: readonly PeriodYear[]): CurrentPeriod {
  const year =
    years.find((one) => one.status === 'current') ??
    [...years]
      .filter((one) => one.status === 'planned' && one.endDate >= today)
      .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0))[0];
  if (year === undefined) {
    return { today, year: null, state: 'no_year', quarter: null, next: null };
  }
  const shown = { id: year.id, name: year.name, status: year.status };
  const dated = [...year.quarters]
    .filter((quarter) => quarter.startDate !== null && quarter.endDate !== null)
    .sort((a, b) => a.number - b.number);
  const startOf = (quarter: Quarter): SchoolDate => quarter.startDate ?? '';
  const endOf = (quarter: Quarter): SchoolDate => quarter.endDate ?? '';
  if (dated.length === 0) {
    return { today, year: shown, state: 'not_dated', quarter: null, next: null };
  }
  const inside = dated.find((quarter) => startOf(quarter) <= today && today <= endOf(quarter));
  if (inside !== undefined) {
    return { today, year: shown, state: 'in_quarter', quarter: inside, next: null };
  }
  const started = dated.filter((quarter) => startOf(quarter) <= today);
  const next = dated.find((quarter) => startOf(quarter) > today) ?? null;
  const latest = started.at(-1);
  if (latest === undefined) {
    return { today, year: shown, state: 'before_first', quarter: null, next };
  }
  return { today, year: shown, state: 'vacation', quarter: latest, next };
}
