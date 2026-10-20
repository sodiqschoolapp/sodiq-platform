import { Injectable } from '@nestjs/common';
import {
  QUARTER_ITEMS_LISTED,
  type ErrorCode,
  type ErrorDetail,
  type QuarterDates,
  type QuarterItem,
  type QuartersPreview,
  type TemplateDaysBody,
} from '@sodiq/shared';
import { addDays } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import {
  NO_LESSONS,
  TimetableCalendarLessons,
  type CalendarRewrite,
} from '../timetable/calendar-lessons.js';

/**
 * What a save of a year's quarters does to the published timetable (task
 * 5.6b-5a; `edge/time-dates-calendar`, "Quarter dates are edited after
 * lessons exist": "Every school day lies in exactly one quarter. ... A
 * boundary can move only over future dates, so a held lesson never changes
 * quarter"; "The academic year is extended or shortened": "Extending adds
 * lessons from the version in force. Shortening removes future empty lessons
 * and is refused, with the list of what is in the way"; `edge/00-definitions`,
 * Quarter of a lesson: "It is stored on the lesson").
 *
 * The dates of the year whose quarter changes (by number, or none) fall in
 * three kinds:
 * - a date of today or earlier: refused when it holds a lesson block
 *   (`quarter_past_lessons`, decision 3); its blocks cannot change quarter
 *   (`lesson_block_quarter_fixed`, 0059) and `quarters_lessons` (0093)
 *   refuses the save at the commit whatever the code does;
 * - a date after today that goes from one quarter to another: its blocks take
 *   the new quarter in place, same ids, nothing else changes (decision 4);
 * - a date after today that leaves or joins every quarter: written again by
 *   the calendar save's rewrite (`TimetableCalendarLessons.rewrite`), which
 *   gives nothing on a date in no quarter and lessons from the version in
 *   force on one in a quarter, checked with the full rule set.
 * A standing exam on a date after today that leaves every quarter refuses the
 * save (`quarter_leaves_exam`, decision 5), and so does a stored one-day move
 * whose two dates the save puts in two quarters (`quarter_splits_move`,
 * decision 6). The year's own dates move no lesson (decision 2): a dated
 * quarter stays inside its year (`outside_year`).
 */

/** A quarter's number and dates, as the save reads them before and after. */
interface Dated {
  readonly number: number;
  readonly startDate: string | null;
  readonly endDate: string | null;
}

/** A block moved to another quarter, as the audit entry keeps it. */
export interface MovedBlock {
  readonly id: string;
  readonly date: string;
  readonly from: number;
  readonly to: number;
}

/** What `follow` did, for the audit entry and the preview. */
export interface QuarterFollow {
  readonly rewrite: CalendarRewrite;
  readonly moved: readonly MovedBlock[];
  readonly preview: Omit<QuartersPreview, 'lessons'>;
  /** Whether a refusal was answered as lines (a preview only). */
  readonly refused: boolean;
}

type Items = QuartersPreview['pastLessons'];

/** The number of the quarter that holds the date, or `null` (a vacation). */
const quarterOn = (quarters: readonly Dated[], date: string): number | null =>
  quarters.find(
    (one) =>
      one.startDate !== null &&
      one.endDate !== null &&
      one.startDate <= date &&
      date <= one.endDate,
  )?.number ?? null;

const itemsOf = (items: readonly QuarterItem[]): Items => ({
  items: items.slice(0, QUARTER_ITEMS_LISTED),
  more: Math.max(0, items.length - QUARTER_ITEMS_LISTED),
});

/** The refusal of a list, one detail per item listed and a detail `more` with the count of the rest. */
function refusalOf(code: ErrorCode, list: Items): ApiException {
  const details: ErrorDetail[] = list.items.map((item, index) => ({
    path: `items.${String(index)}`,
    code,
    message: code,
    day: item.kind === 'split_move' ? item.toDate : item.date,
    quarterItem: item,
  }));
  if (list.more > 0) {
    details.push({ path: 'more', code, message: code, more: list.more });
  }
  return new ApiException(code, 409, undefined, details);
}

@Injectable()
export class QuarterLessons {
  constructor(private readonly lessons: TimetableCalendarLessons) {}

  /**
   * The locks of a quarter save after its branch row (decision 7;
   * `.claude/rules/timetable.md`): the people of the branch and the classes of
   * the year `for key share`, then the year `for no key update`, as a calendar
   * save and a template change take them.
   */
  lock(transaction: Transaction, branchId: string, yearId: string): Promise<void> {
    return this.lessons.lock(transaction, branchId, [yearId]);
  }

  /**
   * Follows a save of the quarters written in this transaction (see the
   * file's comment). The save refuses what the preview answers as lines.
   */
  async follow(
    transaction: Transaction,
    input: {
      readonly branchId: string;
      readonly accountId: string;
      readonly yearId: string;
      readonly year: { readonly startDate: string; readonly endDate: string };
      readonly today: string;
      readonly before: readonly Dated[];
      readonly after: readonly QuarterDates[];
      readonly preview: boolean;
      readonly days: TemplateDaysBody;
    },
  ): Promise<QuarterFollow> {
    const { branchId, yearId, today } = input;
    const after: Dated[] = input.after.map((one, index) => ({ number: index + 1, ...one }));
    const pastDates: string[] = [];
    const moving = new Map<string, { from: number; to: number }>();
    const rewritten: string[] = [];
    const quarterAfter = new Map<string, number | null>();
    for (let date = input.year.startDate; date <= input.year.endDate; date = addDays(date, 1)) {
      const was = quarterOn(input.before, date);
      const now = quarterOn(after, date);
      quarterAfter.set(date, now);
      if (was === now) continue;
      if (date <= today) pastDates.push(date);
      else if (was !== null && now !== null) moving.set(date, { from: was, to: now });
      else rewritten.push(date);
    }

    const pastLessons = itemsOf(await this.pastLessons(transaction, yearId, pastDates));
    const exams = itemsOf(
      await this.examsLeaving(
        transaction,
        yearId,
        rewritten.filter((date) => quarterAfter.get(date) === null),
      ),
    );
    const splitMoves = itemsOf(
      await this.splitMoves(transaction, branchId, yearId, today, input.before, after),
    );
    for (const [code, list] of [
      ['quarter_past_lessons', pastLessons],
      ['quarter_leaves_exam', exams],
      ['quarter_splits_move', splitMoves],
    ] as const) {
      if (!input.preview && list.items.length > 0) throw refusalOf(code, list);
    }

    const moved = await this.moveBlocks(transaction, yearId, moving);
    const rewrite: CalendarRewrite =
      rewritten.length === 0
        ? { lessons: NO_LESSONS, audit: null }
        : await this.lessons.rewrite(transaction, {
            branchId,
            accountId: input.accountId,
            today,
            dates: rewritten,
            event: {
              quarterDates: {
                firstDate: rewritten[0] ?? input.year.startDate,
                lastDate: rewritten.at(-1) ?? input.year.endDate,
              },
            },
            preview: input.preview,
            days: input.days,
            entryId: null,
          });
    const perDate = new Map<string, number>();
    for (const one of moved) perDate.set(one.date, (perDate.get(one.date) ?? 0) + 1);
    return {
      rewrite,
      moved,
      preview: {
        movedBlocks: [...perDate].map(([date, blocks]) => ({ date, blocks })),
        pastLessons,
        exams,
        splitMoves,
      },
      refused: [pastLessons, exams, splitMoves].some((list) => list.items.length > 0),
    };
  }

  /** The lessons of the year on the given dates of today or earlier, by date, start and unit. */
  private async pastLessons(
    transaction: Transaction,
    yearId: string,
    dates: readonly string[],
  ): Promise<QuarterItem[]> {
    if (dates.length === 0) return [];
    const rows = await transaction
      .selectFrom('lessons')
      .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
      .leftJoin('classes', 'classes.id', 'lessons.class_id')
      .leftJoin('groups', 'groups.id', 'lessons.group_id')
      .select([
        sql<string>`lessons.lesson_date::text`.as('date'),
        'lessons.class_id',
        'classes.name as class_name',
        'classes.grade',
        'groups.name as group_name',
        'lessons.subject_id',
      ])
      .where('lesson_blocks.academic_year_id', '=', yearId)
      .where('lesson_blocks.lesson_date', 'in', dates)
      .orderBy('lessons.lesson_date')
      .orderBy('lessons.starts_at')
      .orderBy('lessons.id')
      .execute();
    return rows.map((row) => ({
      kind: 'past_lesson',
      date: row.date,
      unit:
        row.class_id === null
          ? { kind: 'group', name: row.group_name ?? '', grade: null }
          : { kind: 'class', name: row.class_name ?? '', grade: row.grade },
      subjectId: row.subject_id,
    }));
  }

  /** The standing exams of the year on the given dates, which the save takes out of every quarter. */
  private async examsLeaving(
    transaction: Transaction,
    yearId: string,
    dates: readonly string[],
  ): Promise<QuarterItem[]> {
    if (dates.length === 0) return [];
    const rows = await transaction
      .selectFrom('exams')
      .select([sql<string>`exam_date::text`.as('date'), 'title'])
      .where('academic_year_id', '=', yearId)
      .where('cancel_cause', 'is', null)
      .where('exam_date', 'in', dates)
      .orderBy('exam_date')
      .orderBy('starts_at')
      .orderBy('id')
      .execute();
    return rows.map((row) => ({ kind: 'exam', date: row.date, title: row.title }));
  }

  /**
   * The stored one-day moves of the year in force whose lesson's own date
   * (the first row of its changes in force) and the date it stands on now lie
   * in one quarter before the save and in two after it (decision 6). A move
   * with a side in no quarter after the save is the rewrite's: the date is
   * written again and the move sorted there.
   */
  private async splitMoves(
    transaction: Transaction,
    branchId: string,
    yearId: string,
    today: string,
    before: readonly Dated[],
    after: readonly Dated[],
  ): Promise<QuarterItem[]> {
    const rows = await sql<{
      from_date: string;
      to_date: string;
      class_id: string | null;
      class_name: string | null;
      grade: number | null;
      group_name: string | null;
      subject_id: string;
    }>`
      select distinct on (c.lesson_id)
        c.from_date::text as from_date, b.lesson_date::text as to_date,
        l.class_id, k.name as class_name, k.grade, g.name as group_name, l.subject_id
      from lesson_day_changes c
      join lessons l on l.id = c.lesson_id
      join lesson_blocks b on b.id = l.block_id
      left join classes k on k.id = l.class_id
      left join groups g on g.id = l.group_id
      where c.branch_id = ${branchId}
        and b.academic_year_id = ${yearId}
        and b.lesson_date > ${today}::date
        and not exists (select 1 from lesson_day_change_ends e where e.change_id = c.id)
        and exists (
          select 1 from lesson_day_changes m
          where m.lesson_id = c.lesson_id and m.kind = 'move'
            and not exists (select 1 from lesson_day_change_ends e where e.change_id = m.id)
        )
      order by c.lesson_id, c.changed_at, c.id
    `.execute(transaction);
    return rows.rows
      .filter((row) => {
        if (row.from_date === row.to_date) return false;
        const fromAfter = quarterOn(after, row.from_date);
        const toAfter = quarterOn(after, row.to_date);
        return (
          quarterOn(before, row.from_date) === quarterOn(before, row.to_date) &&
          fromAfter !== null &&
          toAfter !== null &&
          fromAfter !== toAfter
        );
      })
      .sort((a, b) => a.to_date.localeCompare(b.to_date) || a.from_date.localeCompare(b.from_date))
      .map((row) => ({
        kind: 'split_move',
        fromDate: row.from_date,
        toDate: row.to_date,
        unit:
          row.class_id === null
            ? { kind: 'group', name: row.group_name ?? '', grade: null }
            : { kind: 'class', name: row.class_name ?? '', grade: row.grade },
        subjectId: row.subject_id,
      }));
  }

  /** Every block of the year on a date that goes to another quarter takes that quarter (decision 4). */
  private async moveBlocks(
    transaction: Transaction,
    yearId: string,
    moving: ReadonlyMap<string, { from: number; to: number }>,
  ): Promise<MovedBlock[]> {
    if (moving.size === 0) return [];
    const quarters = await transaction
      .selectFrom('quarters')
      .select(['id', 'number'])
      .where('academic_year_id', '=', yearId)
      .execute();
    const idOf = new Map(quarters.map((one) => [one.number, one.id]));
    const blocks = await transaction
      .selectFrom('lesson_blocks')
      .select(['id', sql<string>`lesson_date::text`.as('date')])
      .where('academic_year_id', '=', yearId)
      .where('lesson_date', 'in', [...moving.keys()])
      .orderBy('lesson_date')
      .orderBy('id')
      .execute();
    const moved: MovedBlock[] = [];
    for (const block of blocks) {
      const change = moving.get(block.date);
      const to = change === undefined ? undefined : idOf.get(change.to);
      if (change === undefined || to === undefined) continue;
      moved.push({ id: block.id, date: block.date, from: change.from, to: change.to });
    }
    for (const [number, id] of idOf) {
      const ids = moved.filter((one) => one.to === number).map((one) => one.id);
      if (ids.length === 0) continue;
      await transaction
        .updateTable('lesson_blocks')
        .set({ quarter_id: id })
        .where('id', 'in', ids)
        .execute();
    }
    return moved;
  }
}
