import type { Day, DaySlot } from '@sodiq/timetable-rules';
import type { Transaction } from '../../database/transactions.js';
import type { PatternState } from './pattern.service.js';

/**
 * The weekly days a published version was checked against (task 5.6b-4a,
 * decision 3; `timetable_version_days`, 0091): the lesson slots of the
 * weekly day of each grade and weekday on the version's start, as the
 * publish read them (`dayFor` of `pattern-facts.ts`). A pattern block keeps
 * those times, and the dated expansion finds its lesson number by them
 * (`weeklyNumber` of `dated.ts`); after a template change from a date the
 * templates give other times, so every expansion of a published version
 * reads its weekly days here (docs/spec/06-timetable.md, "Day template
 * changed": "lessons from the start date take the new times").
 */
export type WeeklyDays = ReadonlyMap<string, Day>;

export const weeklyKey = (grade: number, weekday: number) => `${grade}|${weekday}`;

/** The weekly days of the version's own check, with lessons, by grade and weekday. */
export function weeklyDaysOf(state: PatternState): Map<string, Day> {
  const days = new Map<string, Day>();
  for (const one of state.pattern.model.data.days) {
    if (one.day.lessons) days.set(weeklyKey(one.grade, one.weekday), one.day.day);
  }
  return days;
}

/**
 * Stores the weekly days of the version being published, while it is still
 * a draft (`pattern_rows_draft`): its lesson slots only, the only slots a
 * block takes.
 */
export async function storeVersionDays(
  transaction: Transaction,
  state: PatternState,
): Promise<void> {
  const rows = [...weeklyDaysOf(state)].flatMap(([key, day]) => {
    const [grade, weekday] = key.split('|').map(Number);
    return day.slots.flatMap((slot) =>
      slot.lessonNumber === null || grade === undefined || weekday === undefined
        ? []
        : [
            {
              branch_id: state.version.branch_id,
              version_id: state.version.id,
              grade,
              weekday,
              lesson_number: slot.lessonNumber,
              start_minutes: slot.start,
              end_minutes: slot.end,
            },
          ],
    );
  });
  if (rows.length > 0) {
    await transaction.insertInto('timetable_version_days').values(rows).execute();
  }
}

/**
 * The stored weekly days of a version, `null` when it has none (a draft, or
 * a version published before 0091, read from the templates as before).
 */
export async function readVersionDays(
  transaction: Transaction,
  versionId: string,
): Promise<WeeklyDays | null> {
  const rows = await transaction
    .selectFrom('timetable_version_days')
    .select(['grade', 'weekday', 'lesson_number', 'start_minutes', 'end_minutes'])
    .where('version_id', '=', versionId)
    .orderBy('grade')
    .orderBy('weekday')
    .orderBy('lesson_number')
    .execute();
  if (rows.length === 0) return null;
  const slots = new Map<string, DaySlot[]>();
  for (const row of rows) {
    const key = weeklyKey(row.grade, row.weekday);
    const list = slots.get(key) ?? [];
    list.push({
      position: list.length + 1,
      kind: 'lesson',
      start: row.start_minutes,
      end: row.end_minutes,
      lessonNumber: row.lesson_number,
    });
    slots.set(key, list);
  }
  return new Map(
    [...slots].map(([key, list]) => [
      key,
      { start: list[0]?.start ?? 0, slots: list, end: list.at(-1)?.end ?? 0 },
    ]),
  );
}
