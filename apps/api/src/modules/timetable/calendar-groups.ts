import {
  calendarGroupChoiceSchema,
  groupBlockKeyOf,
  weekdaySchema,
  type CalendarGroupBlocks,
  type CalendarLessons,
} from '@sodiq/shared';
import type { DatedGroupChoice, DatedSplitGroup } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * The choices of a day-off entry for the blocks of two-grade groups it leaves
 * with one grade at school (task 5.6b-3; `edge/time-dates-calendar`, "A day
 * off for grade 9 only, and a group joins 9 Edinburgh and 10 Brown": "For
 * each block the Academic Vice Principal chooses once, for every date of the
 * entry: cancel its lessons on those dates with the reason 'day off', or keep
 * them and exempt the students of the grade that is off").
 *
 * A choice is sent once per block (its weekday, weekly start and groups) and
 * stored per date in `calendar_group_blocks` (0090), only for the dates the
 * save writes, all after today: the rows of today and the past never change,
 * so 8.5 reads the choice each lesson was held under. The dated expansion
 * reads the rows (`readGroupChoices` of `dated-check.ts`), so a publish, a
 * withdraw and a later calendar save apply them again.
 */

/** A choice written or removed by a save, as its audit entry keeps it. */
export interface GroupBlockAudit {
  readonly date: string;
  readonly weekday: number;
  readonly start: number;
  readonly groupIds: readonly string[];
  readonly before: DatedGroupChoice | null;
  readonly after: DatedGroupChoice | null;
}

interface StoredRow {
  readonly id: string;
  readonly date: string;
  readonly weekday: number;
  readonly start: number;
  readonly groupIds: string[];
  readonly choice: DatedGroupChoice;
}

/** The place of a stored or split block on a date: date, start and groups. */
const placeKeyOf = (date: string, start: number, groupIds: readonly string[]) =>
  [date, String(start), ...[...groupIds].sort()].join('|');

async function storedRowsOf(
  transaction: Transaction,
  entryId: string,
  dates: readonly string[],
): Promise<StoredRow[]> {
  if (dates.length === 0) return [];
  const rows = await transaction
    .selectFrom('calendar_group_blocks as b')
    .innerJoin('calendar_group_block_groups as g', 'g.block_id', 'b.id')
    .select([
      'b.id',
      sql<string>`b.lesson_date::text`.as('lesson_date'),
      'b.weekday',
      'b.start_minutes',
      'b.choice',
      'g.group_id',
    ])
    .where('b.calendar_entry_id', '=', entryId)
    .where('b.lesson_date', 'in', [...dates])
    .orderBy('b.id')
    .orderBy('g.group_id')
    .execute();
  const byId = new Map<string, StoredRow>();
  for (const row of rows) {
    const known = byId.get(row.id);
    if (known !== undefined) {
      known.groupIds.push(row.group_id);
      continue;
    }
    byId.set(row.id, {
      id: row.id,
      date: row.lesson_date,
      weekday: row.weekday,
      start: row.start_minutes,
      groupIds: [row.group_id],
      choice: calendarGroupChoiceSchema.parse(row.choice),
    });
  }
  return [...byId.values()];
}

/**
 * Stores the choices sent for the entry's split blocks of a stretch (the
 * splits as the findings found them, of the dates after today) and removes the
 * entry's rows of the stretch's dates whose block is no longer split there
 * (decision 6). Answers what changed, for the audit; the caller checks the
 * stretch again when anything did.
 */
export async function storeGroupChoices(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly entryId: string;
    /** The dates of the stretch after today. */
    readonly dates: readonly string[];
    readonly splits: readonly DatedSplitGroup[];
    readonly sent: CalendarGroupBlocks;
  },
): Promise<GroupBlockAudit[]> {
  const dates = new Set(input.dates);
  const sent = new Map(input.sent.map((one) => [groupBlockKeyOf(one), one.choice]));
  const stored = await storedRowsOf(transaction, input.entryId, input.dates);
  const storedAt = new Map(
    stored.map((row) => [placeKeyOf(row.date, row.start, row.groupIds), row]),
  );
  const audit: GroupBlockAudit[] = [];
  const removed: string[] = [];
  const splitKeys = new Set<string>();
  const inserts: { split: DatedSplitGroup; choice: DatedGroupChoice }[] = [];
  for (const split of input.splits) {
    if (split.entryId !== input.entryId || !dates.has(split.date)) continue;
    const place = placeKeyOf(split.date, split.start, split.groupIds);
    splitKeys.add(place);
    const choice = sent.get(groupBlockKeyOf(split));
    if (choice === undefined) continue;
    const row = storedAt.get(place);
    if (row?.choice === choice) continue;
    if (row !== undefined) removed.push(row.id);
    inserts.push({ split, choice });
    audit.push({
      date: split.date,
      weekday: split.weekday,
      start: split.start,
      groupIds: [...split.groupIds],
      before: row?.choice ?? null,
      after: choice,
    });
  }
  for (const row of stored) {
    if (splitKeys.has(placeKeyOf(row.date, row.start, row.groupIds))) continue;
    removed.push(row.id);
    audit.push({
      date: row.date,
      weekday: row.weekday,
      start: row.start,
      groupIds: [...row.groupIds].sort(),
      before: row.choice,
      after: null,
    });
  }
  if (removed.length > 0) {
    await transaction.deleteFrom('calendar_group_blocks').where('id', 'in', removed).execute();
  }
  for (const { split, choice } of inserts) {
    const row = await transaction
      .insertInto('calendar_group_blocks')
      .values({
        branch_id: input.branchId,
        calendar_entry_id: input.entryId,
        lesson_date: split.date,
        weekday: split.weekday,
        start_minutes: split.start,
        end_minutes: split.end,
        choice,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('calendar_group_block_groups')
      .values(
        split.groupIds.map((groupId) => ({
          branch_id: input.branchId,
          block_id: row.id,
          group_id: groupId,
          calendar_entry_id: input.entryId,
          lesson_date: split.date,
          start_minutes: split.start,
        })),
      )
      .execute();
  }
  return audit.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.start - b.start ||
      a.groupIds.join().localeCompare(b.groupIds.join()),
  );
}

type GroupBlockLine = CalendarLessons['groupBlocks'][number];

/**
 * The preview's lines (spec review 10): each split block of the entry once,
 * with its dates and the choice of its first date (the one sent, now stored,
 * or the stored one); the sent choices that name no listed block.
 */
export function groupBlockLines(
  entryId: string | null,
  splits: readonly DatedSplitGroup[],
  sent: CalendarGroupBlocks,
): {
  lines: GroupBlockLine[];
  unused: CalendarLessons['groupBlocksUnused'];
  missing: DatedSplitGroup[];
} {
  const byKey = new Map<string, GroupBlockLine>();
  const own = splits
    .filter((split) => split.entryId === entryId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  for (const split of own) {
    const key = groupBlockKeyOf(split);
    const known = byKey.get(key);
    if (known !== undefined) {
      if (!known.dates.includes(split.date)) known.dates.push(split.date);
      continue;
    }
    byKey.set(key, {
      weekday: weekdaySchema.parse(split.weekday),
      start: split.start,
      end: split.end,
      groupIds: [...split.groupIds],
      gradesAtSchool: [...split.gradesAtSchool],
      dates: [split.date],
      choice: split.choice,
    });
  }
  const lines = [...byKey.values()].sort(
    (a, b) =>
      a.weekday - b.weekday ||
      a.start - b.start ||
      a.groupIds.join().localeCompare(b.groupIds.join()),
  );
  const unused = sent
    .filter((one) => !byKey.has(groupBlockKeyOf(one)))
    .map((one) => ({ weekday: one.weekday, start: one.start, groupIds: [...one.groupIds] }));
  return { lines, unused, missing: own.filter((split) => split.choice === null) };
}
