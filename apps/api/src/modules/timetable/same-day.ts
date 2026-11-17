/**
 * Task 5.17 (`06`, How surprises are prevented: The past is closed and Start
 * date; `04`, Availability; the owner's spec change of 18 November 2026):
 * whether today is open for a start today. Today is open when the branch has
 * no lesson dated today and the first lesson slot of today has not begun by
 * the branch's clock. Today in branch time and the minute of the day are both
 * read from the one transaction moment (the injected clock, `app.now`), so a
 * check inside a publish or an availability write is "checked again at the
 * moment of saving" (decision 9).
 */
import { dayOn, sameDayOpen } from '@sodiq/timetable-rules';
import { schoolDateOf } from '@sodiq/shared';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { loadCalendarSettings } from '../setup/calendar-state.js';
import { dayOf, loadStore } from '../setup/day-template-state.js';
import { dayBeginnings } from './dated-check.js';

const MINUTE = 60_000;

/**
 * Decision 4: the start minute of the earliest lesson slot (breaks never
 * count) of the days that the grades of the branch's classes have on the date:
 * the classes not archived, of a year whose dates hold the date, each day as
 * the dated-lesson writer reads it (`dayOn` of the calendar, `dayOf` of the
 * template version and lengths in force). `null` when no lesson slot falls on
 * the date (a weekend, a day off, no class).
 */
export async function firstLessonStartOn(
  transaction: Transaction,
  branchId: string,
  date: string,
): Promise<number | null> {
  const branch = await transaction
    .selectFrom('branches')
    .select('working_weekdays')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const grades = (
    await transaction
      .selectFrom('classes')
      .innerJoin('academic_years', 'academic_years.id', 'classes.academic_year_id')
      .select('classes.grade')
      .distinct()
      .where('classes.branch_id', '=', branchId)
      .where('classes.archived_at', 'is', null)
      .where('academic_years.start_date', '<=', date)
      .where('academic_years.end_date', '>=', date)
      .orderBy('classes.grade')
      .execute()
  ).map((row) => row.grade);
  if (grades.length === 0) return null;
  const [settings, store] = await Promise.all([
    loadCalendarSettings(transaction, branch.working_weekdays),
    loadStore(transaction),
  ]);
  let first: number | null = null;
  for (const grade of grades) {
    const found = dayOn(grade, date, settings);
    if (!found.lessons) continue;
    const timed = dayOf(store, found.dayTemplateId, date);
    if (timed === null) continue;
    for (const slot of timed.slots) {
      if (slot.lessonNumber !== null && (first === null || slot.start < first)) {
        first = slot.start;
      }
    }
  }
  return first;
}

export interface SameDayMoment {
  /** Today in branch time, from the transaction moment. */
  readonly today: string;
  /** Minutes since the start of today in branch time, from the same moment. */
  readonly nowMinutes: number;
}

/** Today and the minute of the day in the branch's time zone, both from the transaction moment. */
export async function sameDayMoment(
  transaction: Transaction,
  branchId: string,
): Promise<SameDayMoment> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const moment = await transactionMoment(transaction);
  const today = schoolDateOf(moment, branch.time_zone);
  const begins = await dayBeginnings(transaction, branch.time_zone, today, today);
  return {
    today,
    nowMinutes: Math.floor((moment.getTime() - begins(today).getTime()) / MINUTE),
  };
}

/**
 * Whether today is open for a version of the branch to start today
 * (decisions 2 and 3): closed by any lesson of the branch dated today,
 * cancelled ones included, and by a published version of the branch that
 * starts today (it has started, and a second publish could otherwise archive
 * it). The caller holds the branch's publish lock (`lockPublishChain`) when
 * the answer decides a write.
 */
export async function branchTodayOpen(
  transaction: Transaction,
  branchId: string,
  at: SameDayMoment,
): Promise<boolean> {
  const lesson = await transaction
    .selectFrom('lesson_blocks')
    .select('id')
    .where('branch_id', '=', branchId)
    .where('lesson_date', '=', at.today)
    .limit(1)
    .executeTakeFirst();
  const started = await transaction
    .selectFrom('timetable_versions')
    .select('id')
    .where('branch_id', '=', branchId)
    .where('status', '=', 'published')
    .where('starts_on', '=', at.today)
    .limit(1)
    .executeTakeFirst();
  return sameDayOpen({
    lessonsToday: lesson !== undefined || started !== undefined,
    nowMinutes: at.nowMinutes,
    firstLessonStart: await firstLessonStartOn(transaction, branchId, at.today),
  });
}

/**
 * Whether today is open for a person's availability entry in the branch to
 * start today (decision 8; `04`, Availability: "the person has no lesson
 * dated today in that branch (as teacher or substitute) and the branch's
 * first lesson of today has not begun"). Closed by a lesson of the branch
 * dated today, cancelled ones included, whose teacher is the person (a
 * substitute is written there), or on which the person is replaced by an
 * open substitution (a return gives the lesson back).
 */
export async function personTodayOpen(
  transaction: Transaction,
  branchId: string,
  staffId: string,
  at: SameDayMoment,
): Promise<boolean> {
  const taught = await transaction
    .selectFrom('lessons')
    .select('id')
    .where('branch_id', '=', branchId)
    .where('lesson_date', '=', at.today)
    .where('teacher_id', '=', staffId)
    .limit(1)
    .executeTakeFirst();
  const replaced = await transaction
    .selectFrom('substitution_lessons')
    .innerJoin('substitutions', 'substitutions.id', 'substitution_lessons.substitution_id')
    .select('substitution_lessons.id')
    .where('substitution_lessons.branch_id', '=', branchId)
    .where('substitution_lessons.lesson_date', '=', at.today)
    .where('substitution_lessons.ended_at', 'is', null)
    .where('substitutions.replaced_id', '=', staffId)
    .limit(1)
    .executeTakeFirst();
  return sameDayOpen({
    lessonsToday: taught !== undefined || replaced !== undefined,
    nowMinutes: at.nowMinutes,
    firstLessonStart: await firstLessonStartOn(transaction, branchId, at.today),
  });
}
