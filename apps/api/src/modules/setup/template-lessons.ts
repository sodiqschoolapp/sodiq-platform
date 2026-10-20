import { Injectable } from '@nestjs/common';
import { GRADES, type ErrorDetail, type SlotInUse, type TemplateDaysBody } from '@sodiq/shared';
import {
  addDays,
  dayOn,
  firstOn,
  templateFor,
  usedSlotProblems,
  weekdayOf,
  type CalendarSettings,
  type Day,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { runsOf } from '../timetable/journals.js';
import { TimetableCalendarLessons, type CalendarRewrite } from '../timetable/calendar-lessons.js';
import { readVersionDays, weeklyKey } from '../timetable/version-days.js';
import { calendarSettings, loadEntries } from './calendar-state.js';
import { dayOf, loadStore, type TemplateStore } from './day-template-state.js';
import { isWithdrawn } from './dated-rows.js';

/**
 * What a change of the day templates from a date does to the published
 * timetable (task 5.6b-4a; `edge/time-dates-calendar`, "A slot type's length
 * or a day template is changed mid-year": "The change takes effect from a
 * chosen date, tomorrow at the earliest. Held lessons keep their times. Every
 * future date is rechecked with the new times, and the change is refused if
 * any teacher, room or student would overlap. A lesson slot used by the
 * published timetable cannot be removed or reordered without a new version";
 * `06`, What a change does to existing data, "Day template changed (lengths,
 * breaks, order)": lessons from the start date take the new times;
 * `edge/timetable`, Versions and drafts: "Publish, a calendar change and a
 * template change each test every affected date with the full rule set").
 *
 * The four writes of `day_templates` that change times from a date (a slot
 * length, a template's version, a template set, a setting ended) call
 * `lock` before they write and `follow` after: the lesson dates are the dates
 * after today, on or after the change's date, where some grade's day differs
 * before and after it in what makes its lessons: the slots (kind, slot type,
 * times), the weekday followed and the exam week (decision 2). A lesson slot
 * a published version uses on such a date that the change removes or
 * reorders refuses the save (`template_slot_in_use`, decision 4); then the
 * dates are written again from the published versions in force by the
 * calendar save's rewrite (`TimetableCalendarLessons.rewrite`): checked with
 * the full rule set, the stored one-day changes and bulk cancels sorted, the
 * shortened days' choices taken, the exams following their slots.
 */

/** The part of a grade's day on a date that makes its lessons, with its times (decision 2). */
function lessonPartOf(
  store: TemplateStore,
  settings: CalendarSettings,
  grade: number,
  date: string,
): string {
  const day = dayOn(grade, date, settings);
  if (!day.lessons) return 'none';
  const timed = dayOf(store, day.dayTemplateId, date);
  return JSON.stringify([
    day.followsWeekday,
    day.examWeek,
    timed?.slots.map((slot) => [slot.kind, slot.slotTypeId, slot.start, slot.end]) ?? null,
  ]);
}

/** A published version's run of dates. */
interface VersionRun {
  readonly id: string;
  readonly startsOn: string;
  readonly from: string;
  readonly until: string | null;
  readonly yearEnd: string;
}

/** A problem of one date, before it is joined into runs. */
interface DateProblem {
  readonly date: string;
  readonly grade: number;
  readonly weekday: number;
  readonly lessonNumber: number;
  readonly problem: SlotInUse['problem'];
}

@Injectable()
export class TemplateLessons {
  constructor(private readonly lessons: TimetableCalendarLessons) {}

  /** The planned and current years of the branch that end on or after the date. */
  private static yearsFrom(transaction: Transaction, branchId: string, from: string) {
    return transaction
      .selectFrom('academic_years')
      .select([
        'id',
        sql<string>`start_date::text`.as('start_date'),
        sql<string>`end_date::text`.as('end_date'),
      ])
      .where('branch_id', '=', branchId)
      .where('status', 'in', ['planned', 'current'])
      .where('end_date', '>=', from)
      .orderBy('start_date')
      .execute();
  }

  /**
   * The locks of a template change, taken before it writes (decision 7;
   * `.claude/rules/timetable.md`): the write already holds its branch row
   * `for no key update`; then the people of the branch, the classes of the
   * years it reaches and each year, as a calendar save takes them.
   */
  async lock(transaction: Transaction, branchId: string, from: string): Promise<void> {
    const years = await TemplateLessons.yearsFrom(transaction, branchId, from);
    await this.lessons.lock(
      transaction,
      branchId,
      years.map((year) => year.id),
    );
  }

  /**
   * Writes again the lesson dates of a change written in this transaction
   * (see the file's comment); `before` is the store read before the change.
   * The save refuses what the preview answers as lines.
   */
  async follow(
    transaction: Transaction,
    input: {
      readonly branchId: string;
      readonly accountId: string;
      readonly today: string;
      readonly from: string;
      readonly workingWeekdays: readonly number[];
      readonly before: TemplateStore;
      readonly preview: boolean;
      readonly days: TemplateDaysBody;
    },
  ): Promise<{ rewrite: CalendarRewrite; slotsInUse: SlotInUse[] }> {
    const { branchId, today } = input;
    const [after, entries, years] = await Promise.all([
      loadStore(transaction),
      loadEntries(transaction),
      TemplateLessons.yearsFrom(transaction, branchId, input.from),
    ]);
    const settingsBefore = calendarSettings(input.before, input.workingWeekdays, entries);
    const settingsAfter = calendarSettings(after, input.workingWeekdays, entries);
    const first = input.from > today ? input.from : addDays(today, 1);
    const last = years.at(-1)?.end_date ?? first;
    const dates: string[] = [];
    for (let date = first; date <= last; date = addDays(date, 1)) {
      if (
        GRADES.some(
          (grade) =>
            lessonPartOf(input.before, settingsBefore, grade, date) !==
            lessonPartOf(after, settingsAfter, grade, date),
        )
      ) {
        dates.push(date);
      }
    }

    const slotsInUse = await this.slotsInUse(transaction, {
      branchId,
      dates,
      years,
      before: { store: input.before, settings: settingsBefore },
      after: { store: after, settings: settingsAfter },
    });
    if (!input.preview && slotsInUse.length > 0) {
      throw new ApiException(
        'template_slot_in_use',
        409,
        undefined,
        slotsInUse.map((one): ErrorDetail => ({
          path: `slots.${String(one.grade)}.${String(one.weekday)}.${String(one.lessonNumber)}`,
          code: 'template_slot_in_use',
          message: `Lesson slot ${String(one.lessonNumber)} of grade ${String(one.grade)} is ${one.problem} from ${one.firstDate} to ${one.lastDate}.`,
          day: one.firstDate,
        })),
      );
    }

    const rewrite = await this.lessons.rewrite(transaction, {
      branchId,
      accountId: input.accountId,
      today,
      dates,
      event: { templateFrom: input.from },
      preview: input.preview,
      days: input.days,
      entryId: null,
    });
    return { rewrite, slotsInUse };
  }

  /**
   * The lesson slots the published versions use on the dates that the change
   * removes or reorders (decision 4): for each date in a published run and
   * each grade whose day before and after comes from the weekly settings (on
   * a special date the shortened-day row applies), the lesson numbers of the
   * version's blocks of that grade on the date's weekday, found by their
   * weekly times in the weekly days the version was published against
   * (decision 3), checked by `usedSlotProblems`. Joined into runs of the
   * dates of one weekday with the same grade, number and problem.
   */
  private async slotsInUse(
    transaction: Transaction,
    input: {
      readonly branchId: string;
      readonly dates: readonly string[];
      readonly years: readonly { id: string; end_date: string }[];
      readonly before: { readonly store: TemplateStore; readonly settings: CalendarSettings };
      readonly after: { readonly store: TemplateStore; readonly settings: CalendarSettings };
    },
  ): Promise<SlotInUse[]> {
    if (input.dates.length === 0) return [];
    const runs: VersionRun[] = (
      await Promise.all(
        input.years.map(async (year) => {
          const published = await transaction
            .selectFrom('timetable_versions')
            .select(['id', 'number', sql<string>`starts_on::text`.as('starts_on')])
            .where('branch_id', '=', input.branchId)
            .where('academic_year_id', '=', year.id)
            .where('status', '=', 'published')
            .orderBy('starts_on')
            .orderBy('number')
            .execute();
          const startOf = new Map(published.map((one) => [one.id, one.starts_on]));
          return runsOf(published).map((one) => ({
            id: one.id,
            startsOn: startOf.get(one.id) ?? one.run.from,
            from: one.run.from,
            until: one.run.until,
            yearEnd: year.end_date,
          }));
        }),
      )
    ).flat();
    const versionOn = (date: string) =>
      runs.find(
        (one) => one.from <= date && (one.until === null ? date <= one.yearEnd : date < one.until),
      );

    const usedOf = new Map<string, (grade: number, weekday: number) => number[]>();
    const usedIn = async (run: VersionRun) => {
      const known = usedOf.get(run.id);
      if (known !== undefined) return known;
      const used = await this.usedNumbers(transaction, run, input.before);
      usedOf.set(run.id, used);
      return used;
    };

    const lessonTypes = (store: TemplateStore, templateId: string, date: string) =>
      (dayOf(store, templateId, date)?.slots ?? []).flatMap((slot) =>
        slot.lessonNumber === null ? [] : [slot.slotTypeId],
      );
    const problems: DateProblem[] = [];
    for (const date of input.dates) {
      const run = versionOn(date);
      if (run === undefined) continue;
      const used = await usedIn(run);
      for (const grade of GRADES) {
        const was = dayOn(grade, date, input.before.settings);
        const now = dayOn(grade, date, input.after.settings);
        if (!was.lessons || !now.lessons || was.entryId !== null || now.entryId !== null) continue;
        const weekday = now.followsWeekday;
        for (const found of usedSlotProblems(
          lessonTypes(input.before.store, was.dayTemplateId, date),
          lessonTypes(input.after.store, now.dayTemplateId, date),
          used(grade, weekday),
        )) {
          problems.push({ date, grade, weekday, ...found });
        }
      }
    }
    return runsOfProblems(input.dates, problems);
  }

  /**
   * The lesson numbers a version's blocks take per grade and weekday, by
   * their weekly times in the weekly days it was published against; a
   * version published before 0091 is read from the templates before the
   * change on its start, as the expansion reads it.
   */
  private async usedNumbers(
    transaction: Transaction,
    run: VersionRun,
    before: { readonly store: TemplateStore; readonly settings: CalendarSettings },
  ): Promise<(grade: number, weekday: number) => number[]> {
    const stored = await readVersionDays(transaction, run.id);
    const weekly = (grade: number, weekday: number): Day | null => {
      if (stored !== null) return stored.get(weeklyKey(grade, weekday)) ?? null;
      const date = firstOn(run.startsOn, weekday);
      const templateId = templateFor(grade, date, {
        assignments: before.store.assignments.filter((row) => !isWithdrawn(row)),
      });
      return templateId === null ? null : (dayOf(before.store, templateId, date)?.day ?? null);
    };
    const byClass = await transaction
      .selectFrom('pattern_entries')
      .innerJoin('teaching_load_rows', 'teaching_load_rows.id', 'pattern_entries.load_row_id')
      .innerJoin('classes', 'classes.id', 'teaching_load_rows.class_id')
      .select([
        'pattern_entries.weekday',
        'pattern_entries.start_minutes',
        'pattern_entries.end_minutes',
        'classes.grade',
      ])
      .where('pattern_entries.version_id', '=', run.id)
      .execute();
    const byGroup = await transaction
      .selectFrom('pattern_entries')
      .innerJoin('teaching_load_rows', 'teaching_load_rows.id', 'pattern_entries.load_row_id')
      .innerJoin('group_classes', 'group_classes.group_id', 'teaching_load_rows.group_id')
      .innerJoin('classes', 'classes.id', 'group_classes.class_id')
      .select([
        'pattern_entries.weekday',
        'pattern_entries.start_minutes',
        'pattern_entries.end_minutes',
        'classes.grade',
      ])
      .where('pattern_entries.version_id', '=', run.id)
      .execute();
    const numbers = new Map<string, Set<number>>();
    for (const row of [...byClass, ...byGroup]) {
      const number = weekly(row.grade, row.weekday)?.slots.find(
        (slot) => slot.start === row.start_minutes && slot.end === row.end_minutes,
      )?.lessonNumber;
      if (number === null || number === undefined) continue;
      const key = weeklyKey(row.grade, row.weekday);
      numbers.set(key, (numbers.get(key) ?? new Set()).add(number));
    }
    return (grade, weekday) => [...(numbers.get(weeklyKey(grade, weekday)) ?? [])];
  }
}

/**
 * The problems of each grade, weekday, lesson number and kind joined into
 * runs: dates of that weekday among the lesson dates, one after another,
 * that all have it.
 */
function runsOfProblems(dates: readonly string[], problems: readonly DateProblem[]): SlotInUse[] {
  const keyOf = (one: Omit<DateProblem, 'date'>) =>
    `${String(one.grade)}|${String(one.weekday)}|${String(one.lessonNumber)}|${one.problem}`;
  const byKey = new Map<string, { sample: DateProblem; dates: Set<string> }>();
  for (const one of problems) {
    const key = keyOf(one);
    const held = byKey.get(key) ?? { sample: one, dates: new Set<string>() };
    held.dates.add(one.date);
    byKey.set(key, held);
  }
  const answer: SlotInUse[] = [];
  for (const { sample, dates: found } of byKey.values()) {
    let open: { firstDate: string; lastDate: string } | null = null;
    const close = () => {
      if (open === null) return;
      answer.push({
        ...open,
        grade: sample.grade,
        weekday: sample.weekday as SlotInUse['weekday'],
        lessonNumber: sample.lessonNumber,
        problem: sample.problem,
      });
      open = null;
    };
    for (const date of dates.filter((one) => weekdayOf(one) === sample.weekday)) {
      if (found.has(date)) {
        if (open === null) open = { firstDate: date, lastDate: date };
        else open.lastDate = date;
      } else {
        close();
      }
    }
    close();
  }
  return answer.sort(
    (a, b) =>
      a.firstDate.localeCompare(b.firstDate) ||
      a.grade - b.grade ||
      a.lessonNumber - b.lessonNumber,
  );
}
