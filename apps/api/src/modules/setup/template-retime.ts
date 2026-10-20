import { dayOn, type CalendarSettings } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { dayBeginnings } from '../timetable/dated-check.js';
import type { StoredLessonTimes, StoredRetime } from '../timetable/day-changes-kept.js';
import { dayOf, type TemplateStore } from './day-template-state.js';

/**
 * The stored one-day changes and bulk cancels of a template change follow
 * their lessons (task 5.6b-4b; the From line of 5.6b-4a: "a cancel stays a
 * cancel, a room change stays, a move goes to the new times of its lesson
 * number"; `06`, What a change does to existing data, "Day template changed":
 * lessons from the start date take the new times).
 *
 * On each date the change writes, a lesson's old times give its lesson number
 * in the day of its grade before the change, and that number gives its times
 * in the day after (5.6b-4a decision 4: lesson slots are matched by their
 * number in the day). A group takes the days of its classes' grades, which
 * must agree; a two-grade group whose grades come apart has no new times, and
 * its lesson is cancelled "not in the day's template" by the rewrite (5.6b-4a
 * decision 5). The stored rows are moved to the new times before the sorting
 * reads them (0092; the preview's transaction is rolled back), so the sorting
 * of this change and of every later publish or calendar save matches them to
 * the lessons at their new times; the stored lessons are read through the same
 * map until the write moves them.
 */

const MINUTE = 60_000;

/** A side of a stored row moved, for the change's audit entry (decision 1). */
// A type, not an interface: it goes into the JSON of the audit entry.
export type MovedTimes = {
  readonly table: 'lesson_day_changes' | 'bulk_cancel_spans' | 'bulk_cancel_blocks';
  /** The change row, or the bulk cancel. */
  readonly id: string;
  /** `from` or `to` of a change; the class and lesson number of a span; the block of a choice. */
  readonly part: string;
  readonly date: string;
  readonly before: { readonly startsAt: string; readonly endsAt: string };
  readonly after: { readonly startsAt: string; readonly endsAt: string };
};

interface Side {
  readonly store: TemplateStore;
  readonly settings: CalendarSettings;
}

interface Slot {
  readonly number: number;
  readonly start: number;
  readonly end: number;
}

/** The new times of the stored lessons, and the stored rows moved to them. */
export interface TemplateRetime {
  readonly retime: StoredRetime;
  readonly moved: readonly MovedTimes[];
}

/**
 * Builds the map of the dates `dates` and moves the stored changes and bulk
 * cancels of those dates to the new times; `before` and `after` are the
 * templates and settings before and after the change.
 */
export async function retimeStored(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly dates: readonly string[];
    readonly before: Side;
    readonly after: Side;
  },
): Promise<TemplateRetime> {
  const { branchId } = input;
  const written = new Set(input.dates);
  const sorted = [...written].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) {
    return { retime: { of: (lesson) => lesson, unplaced: new Set() }, moved: [] };
  }

  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const begins = await dayBeginnings(transaction, branch.time_zone, first, last);
  const [classes, groupClasses] = await Promise.all([
    transaction
      .selectFrom('classes')
      .select(['id', 'grade'])
      .where('branch_id', '=', branchId)
      .execute(),
    transaction
      .selectFrom('group_classes')
      .select(['group_id', 'class_id'])
      .where('branch_id', '=', branchId)
      .execute(),
  ]);
  const gradeOf = new Map(classes.map((one) => [one.id, one.grade]));
  const gradesOf = (unit: { class_id: string | null; group_id: string | null }): number[] => {
    if (unit.class_id !== null) {
      const grade = gradeOf.get(unit.class_id);
      return grade === undefined ? [] : [grade];
    }
    const grades = groupClasses
      .filter((one) => one.group_id === unit.group_id)
      .flatMap((one) => {
        const grade = gradeOf.get(one.class_id);
        return grade === undefined ? [] : [grade];
      });
    return [...new Set(grades)];
  };

  const slotCache = new Map<string, readonly Slot[]>();
  const slotsOf = (side: Side, which: string, grade: number, date: string): readonly Slot[] => {
    const key = `${which}|${String(grade)}|${date}`;
    const known = slotCache.get(key);
    if (known !== undefined) return known;
    const day = dayOn(grade, date, side.settings);
    const slots: Slot[] = [];
    if (day.lessons) {
      for (const slot of dayOf(side.store, day.dayTemplateId, date)?.slots ?? []) {
        if (slot.lessonNumber === null) continue;
        slots.push({ number: slot.lessonNumber, start: slot.start, end: slot.end });
      }
    }
    slotCache.set(key, slots);
    return slots;
  };
  const minutesOf = (date: string, moment: Date) =>
    Math.round((moment.getTime() - begins(date).getTime()) / MINUTE);
  const momentOf = (date: string, minutes: number) =>
    new Date(begins(date).getTime() + minutes * MINUTE);

  /** The new times of lesson `number` on `date` for every grade, when they agree. */
  const byNumber = (grades: readonly number[], date: string, number: number) => {
    let found: Slot | null = null;
    for (const grade of grades) {
      const slot = slotsOf(input.after, 'after', grade, date).find((one) => one.number === number);
      if (slot === undefined) return null;
      if (found !== null && (found.start !== slot.start || found.end !== slot.end)) return null;
      found = slot;
    }
    return found === null
      ? null
      : { starts_at: momentOf(date, found.start), ends_at: momentOf(date, found.end) };
  };
  /** The new times of a lesson at `starts`–`ends` on a written date; `null` when it has none. */
  const timesOf = (
    unit: { class_id: string | null; group_id: string | null },
    date: string,
    starts: Date,
    ends: Date,
  ) => {
    const grades = gradesOf(unit);
    const start = minutesOf(date, starts);
    const end = minutesOf(date, ends);
    let number: number | null = null;
    for (const grade of grades) {
      const slot = slotsOf(input.before, 'before', grade, date).find(
        (one) => one.start === start && one.end === end,
      );
      if (slot === undefined || (number !== null && number !== slot.number)) return null;
      number = slot.number;
    }
    return number === null ? null : byNumber(grades, date, number);
  };

  const iso = (moment: Date) => moment.toISOString();
  const moved: MovedTimes[] = [];
  const unplaced = new Set<string>();

  // The room changes and moves in force with a side on a written date.
  const changes = await transaction
    .selectFrom('lesson_day_changes')
    .select([
      'id',
      'class_id',
      'group_id',
      sql<string>`from_date::text`.as('from_date'),
      'from_starts_at',
      'from_ends_at',
      sql<string>`to_date::text`.as('to_date'),
      'to_starts_at',
      'to_ends_at',
    ])
    .where('branch_id', '=', branchId)
    .where('lesson_id', 'is not', null)
    .where((eb) => eb.or([eb('from_date', 'in', sorted), eb('to_date', 'in', sorted)]))
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('lesson_day_change_ends')
            .select('change_id')
            .whereRef('lesson_day_change_ends.change_id', '=', 'lesson_day_changes.id'),
        ),
      ),
    )
    .orderBy('id')
    .execute();
  for (const row of changes) {
    const set: {
      from_starts_at?: Date;
      from_ends_at?: Date;
      to_starts_at?: Date;
      to_ends_at?: Date;
    } = {};
    if (written.has(row.from_date)) {
      const times = timesOf(row, row.from_date, row.from_starts_at, row.from_ends_at);
      if (
        times !== null &&
        (times.starts_at.getTime() !== row.from_starts_at.getTime() ||
          times.ends_at.getTime() !== row.from_ends_at.getTime())
      ) {
        set.from_starts_at = times.starts_at;
        set.from_ends_at = times.ends_at;
      }
    }
    if (written.has(row.to_date)) {
      const times = timesOf(row, row.to_date, row.to_starts_at, row.to_ends_at);
      if (times === null) {
        unplaced.add(row.id);
      } else if (
        times.starts_at.getTime() !== row.to_starts_at.getTime() ||
        times.ends_at.getTime() !== row.to_ends_at.getTime()
      ) {
        set.to_starts_at = times.starts_at;
        set.to_ends_at = times.ends_at;
      }
    }
    if (set.from_starts_at !== undefined && set.from_ends_at !== undefined) {
      moved.push({
        table: 'lesson_day_changes',
        id: row.id,
        part: 'from',
        date: row.from_date,
        before: { startsAt: iso(row.from_starts_at), endsAt: iso(row.from_ends_at) },
        after: { startsAt: iso(set.from_starts_at), endsAt: iso(set.from_ends_at) },
      });
    }
    if (set.to_starts_at !== undefined && set.to_ends_at !== undefined) {
      moved.push({
        table: 'lesson_day_changes',
        id: row.id,
        part: 'to',
        date: row.to_date,
        before: { startsAt: iso(row.to_starts_at), endsAt: iso(row.to_ends_at) },
        after: { startsAt: iso(set.to_starts_at), endsAt: iso(set.to_ends_at) },
      });
    }
    if (Object.keys(set).length > 0) {
      await transaction
        .updateTable('lesson_day_changes')
        .set(set)
        .where('id', '=', row.id)
        .execute();
    }
  }

  // The bulk cancels of the written dates: each span by its own lesson number
  // (review correction 2), each block choice by its block's times.
  const cancels = await transaction
    .selectFrom('bulk_cancels')
    .select(['id', sql<string>`cancel_date::text`.as('cancel_date')])
    .where('branch_id', '=', branchId)
    .where('cancel_date', 'in', sorted)
    .orderBy('id')
    .execute();
  if (cancels.length > 0) {
    const ids = cancels.map((one) => one.id);
    const dateOf = new Map(cancels.map((one) => [one.id, one.cancel_date]));
    const [spans, choices, cancelClasses] = await Promise.all([
      transaction
        .selectFrom('bulk_cancel_spans')
        .select(['bulk_cancel_id', 'class_id', 'lesson_number', 'starts_at', 'ends_at'])
        .where('branch_id', '=', branchId)
        .where('bulk_cancel_id', 'in', ids)
        .orderBy('bulk_cancel_id')
        .orderBy('class_id')
        .orderBy('lesson_number')
        .execute(),
      transaction
        .selectFrom('bulk_cancel_blocks')
        .select([
          // The row itself: a choice whose block a publish removed has no
          // key of its own, and a moved time may meet another row's old one.
          sql<string>`ctid::text`.as('row_key'),
          'bulk_cancel_id',
          'block_id',
          sql<string>`lesson_date::text`.as('lesson_date'),
          'starts_at',
          'ends_at',
        ])
        .where('branch_id', '=', branchId)
        .where('bulk_cancel_id', 'in', ids)
        .orderBy('bulk_cancel_id')
        .orderBy('starts_at')
        .execute(),
      transaction
        .selectFrom('bulk_cancel_classes')
        .select(['bulk_cancel_id', 'class_id'])
        .where('branch_id', '=', branchId)
        .where('bulk_cancel_id', 'in', ids)
        .orderBy('class_id')
        .execute(),
    ]);
    for (const span of spans) {
      const date = dateOf.get(span.bulk_cancel_id);
      if (date === undefined) continue;
      const times = byNumber(
        gradesOf({ class_id: span.class_id, group_id: null }),
        date,
        span.lesson_number,
      );
      if (
        times === null ||
        (times.starts_at.getTime() === span.starts_at.getTime() &&
          times.ends_at.getTime() === span.ends_at.getTime())
      ) {
        continue;
      }
      moved.push({
        table: 'bulk_cancel_spans',
        id: span.bulk_cancel_id,
        part: `${span.class_id}|${String(span.lesson_number)}`,
        date,
        before: { startsAt: iso(span.starts_at), endsAt: iso(span.ends_at) },
        after: { startsAt: iso(times.starts_at), endsAt: iso(times.ends_at) },
      });
      await transaction
        .updateTable('bulk_cancel_spans')
        .set({ starts_at: times.starts_at, ends_at: times.ends_at })
        .where('branch_id', '=', branchId)
        .where('bulk_cancel_id', '=', span.bulk_cancel_id)
        .where('class_id', '=', span.class_id)
        .where('lesson_number', '=', span.lesson_number)
        .execute();
    }
    for (const choice of choices) {
      if (!written.has(choice.lesson_date)) continue;
      // The block is shared with a class of the cancel: its grade's day.
      let times: { starts_at: Date; ends_at: Date } | null = null;
      for (const one of cancelClasses) {
        if (one.bulk_cancel_id !== choice.bulk_cancel_id) continue;
        times = timesOf(
          { class_id: one.class_id, group_id: null },
          choice.lesson_date,
          choice.starts_at,
          choice.ends_at,
        );
        if (times !== null) break;
      }
      if (
        times === null ||
        (times.starts_at.getTime() === choice.starts_at.getTime() &&
          times.ends_at.getTime() === choice.ends_at.getTime())
      ) {
        continue;
      }
      moved.push({
        table: 'bulk_cancel_blocks',
        id: choice.bulk_cancel_id,
        part: choice.block_id ?? `${iso(choice.starts_at)}`,
        date: choice.lesson_date,
        before: { startsAt: iso(choice.starts_at), endsAt: iso(choice.ends_at) },
        after: { startsAt: iso(times.starts_at), endsAt: iso(times.ends_at) },
      });
      await transaction
        .updateTable('bulk_cancel_blocks')
        .set({ starts_at: times.starts_at, ends_at: times.ends_at })
        .where('branch_id', '=', branchId)
        .where('bulk_cancel_id', '=', choice.bulk_cancel_id)
        .where(sql<boolean>`ctid = ${choice.row_key}::tid`)
        .execute();
    }
  }

  const of = (lesson: StoredLessonTimes) => {
    if (!written.has(lesson.lesson_date)) return lesson;
    return timesOf(lesson, lesson.lesson_date, lesson.starts_at, lesson.ends_at) ?? lesson;
  };
  return { retime: { of, unplaced }, moved };
}
