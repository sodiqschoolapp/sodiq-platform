import { ROOM_OUT_CAUSES, type DayChangesAnswer, type RoomOutCause } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';
import { dayBeginnings } from './dated-check.js';

/**
 * The rooms that cannot be used, as every reader of "needs a room" sees them
 * (task 5.7a-2b, pull request #187, decisions 1, 2 and 7): a live room
 * closure holding the moment, `[applies_from, applies_until)` (0098), or the
 * room's status `closed` or `under_repair`, read on each request. A closure
 * writes no lesson: the lesson keeps its room. A room and its lessons are of
 * one branch (`lessons_room_fkey`), so the branch filter is enough.
 */

const MINUTE = 60_000;

/** A live closure of a room, half-open. */
export interface ClosureSpan {
  readonly roomId: string;
  readonly closureId: string;
  readonly from: Date;
  readonly until: Date;
}

/** Why a room is out at a moment, with the closure of a `closure` cause. */
export interface RoomOut {
  readonly roomId: string;
  readonly cause: RoomOutCause;
  readonly closureId: string | null;
}

/** The live closures of the rooms that meet `[from, until)`, by room. */
export async function closureSpans(
  transaction: Transaction,
  roomIds: readonly string[],
  from: Date,
  until: Date,
): Promise<Map<string, ClosureSpan[]>> {
  const spans = new Map<string, ClosureSpan[]>();
  const ids = [...new Set(roomIds)];
  if (ids.length === 0) return spans;
  const rows = await transaction
    .selectFrom('room_closures')
    .select(['id', 'room_id', 'applies_from', 'applies_until'])
    .where('room_id', 'in', ids)
    .where('withdrawn_at', 'is', null)
    .where('applies_from', '<', until)
    .where('applies_until', '>', from)
    .orderBy('applies_from')
    .execute();
  for (const row of rows) {
    spans.set(row.room_id, [
      ...(spans.get(row.room_id) ?? []),
      { roomId: row.room_id, closureId: row.id, from: row.applies_from, until: row.applies_until },
    ]);
  }
  return spans;
}

/** The closure of the room holding `at`, or `null`. */
export function closureAt(
  spans: ReadonlyMap<string, readonly ClosureSpan[]>,
  roomId: string | null,
  at: Date,
): ClosureSpan | null {
  if (roomId === null) return null;
  return (
    spans
      .get(roomId)
      ?.find((one) => one.from.getTime() <= at.getTime() && at.getTime() < one.until.getTime()) ??
    null
  );
}

/** The rooms out at the moments asked, the status first (decision 7, in the order of `ROOM_OUT_CAUSES`). */
export interface RoomsOut {
  readonly at: (roomId: string | null, moment: Date) => RoomOut | null;
}

/** Reads the statuses and the closures of the rooms over `[from, until)`. */
export async function roomsOut(
  transaction: Transaction,
  roomIds: readonly string[],
  from: Date,
  until: Date,
): Promise<RoomsOut> {
  const ids = [...new Set(roomIds)];
  if (ids.length === 0) return { at: () => null };
  const statuses = new Map(
    (
      await transaction
        .selectFrom('rooms')
        .select(['id', 'status'])
        .where('id', 'in', ids)
        .execute()
    ).map((row) => [row.id, row.status]),
  );
  const spans = await closureSpans(transaction, ids, from, until);
  return {
    at: (roomId, moment) => {
      if (roomId === null) return null;
      const status = statuses.get(roomId);
      if (status === 'closed' || status === 'under_repair') {
        return { roomId, cause: status, closureId: null };
      }
      const span = closureAt(spans, roomId, moment);
      return span === null ? null : { roomId, cause: 'closure', closureId: span.closureId };
    },
  };
}

/** A stored lesson as the readers of "needs a room" name it. */
export interface RoomLesson {
  readonly id: string;
  readonly roomId: string | null;
  readonly startsAt: Date;
}

/** The stored lessons whose room is out at their start, each with why. */
export async function roomsOutLessons(
  transaction: Transaction,
  lessons: readonly RoomLesson[],
): Promise<Map<string, RoomOut>> {
  const out = new Map<string, RoomOut>();
  const withRoom = lessons.filter((one) => one.roomId !== null);
  if (withRoom.length === 0) return out;
  const times = withRoom.map((one) => one.startsAt.getTime());
  const rooms = await roomsOut(
    transaction,
    withRoom.map((one) => one.roomId ?? ''),
    new Date(Math.min(...times)),
    new Date(Math.max(...times) + 1),
  );
  for (const one of withRoom) {
    const found = rooms.at(one.roomId, one.startsAt);
    if (found !== null) out.set(one.id, found);
  }
  return out;
}

/** The rank of a cause, for a list sorted by it. */
export const roomOutRank = (cause: RoomOutCause): number => ROOM_OUT_CAUSES.indexOf(cause);

/**
 * The closed spans of the rooms on `date` in clock minutes of the day, for
 * the rule `room_closed` of a dated call (decisions 5 and 7): each live
 * closure meeting the day, and the whole day for a room under repair.
 */
export async function closedSpansOn(
  transaction: Transaction,
  input: {
    readonly timeZone: string;
    readonly date: string;
    readonly rooms: readonly { readonly id: string; readonly status: string }[];
  },
): Promise<Map<string, { day: string; start: number; end: number }[]>> {
  const closed = new Map<string, { day: string; start: number; end: number }[]>();
  if (input.rooms.length === 0) return closed;
  const begins = await dayBeginnings(transaction, input.timeZone, input.date, input.date);
  const dayStart = begins(input.date);
  const dayEnd = new Date(dayStart.getTime() + 1440 * MINUTE);
  const spans = await closureSpans(
    transaction,
    input.rooms.map((one) => one.id),
    dayStart,
    dayEnd,
  );
  const minutesOf = (moment: Date) =>
    Math.min(1440, Math.max(0, Math.round((moment.getTime() - dayStart.getTime()) / MINUTE)));
  for (const room of input.rooms) {
    const own = (spans.get(room.id) ?? []).map((one) => ({
      day: input.date,
      start: minutesOf(one.from),
      end: minutesOf(one.until),
    }));
    if (room.status === 'under_repair') own.push({ day: input.date, start: 0, end: 1440 });
    if (own.length > 0) closed.set(room.id, own);
  }
  return closed;
}

/** A lesson a publish or a withdraw writes: its date, its start in minutes of the day, its room. */
export interface RunRoomLesson {
  readonly date: string;
  readonly start: number;
  readonly roomId: string | null;
}

/**
 * The live closures of the rooms of a run's new lessons that meet its dates,
 * each with the number of those lessons it puts under "needs a room"
 * (decision 9): always kept, nothing to settle, nothing written.
 */
export async function runClosures(
  transaction: Transaction,
  branchId: string,
  lessons: readonly RunRoomLesson[],
): Promise<DayChangesAnswer['closures']> {
  const withRoom = lessons.filter((one) => one.roomId !== null);
  if (withRoom.length === 0) return [];
  const dates = withRoom.map((one) => one.date).sort();
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const begins = await dayBeginnings(
    transaction,
    branch.time_zone,
    dates[0] ?? '',
    dates[dates.length - 1] ?? '',
  );
  const startOf = (one: RunRoomLesson) => new Date(begins(one.date).getTime() + one.start * MINUTE);
  const times = withRoom.map((one) => startOf(one).getTime());
  const spans = await closureSpans(
    transaction,
    withRoom.map((one) => one.roomId ?? ''),
    new Date(Math.min(...times)),
    new Date(Math.max(...times) + 1),
  );
  const counts = new Map<string, number>();
  for (const one of withRoom) {
    const span = closureAt(spans, one.roomId, startOf(one));
    if (span !== null) counts.set(span.closureId, (counts.get(span.closureId) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const rows = await transaction
    .selectFrom('room_closures')
    .innerJoin('rooms', 'rooms.id', 'room_closures.room_id')
    .select([
      'room_closures.id',
      'room_closures.starts_on',
      'room_closures.ends_on',
      'room_closures.applies_from',
      'rooms.name',
    ])
    .where('room_closures.id', 'in', [...counts.keys()])
    .execute();
  return rows
    .map((row) => ({
      id: row.id,
      room: row.name,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      lessons: counts.get(row.id) ?? 0,
    }))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.room.localeCompare(b.room));
}
