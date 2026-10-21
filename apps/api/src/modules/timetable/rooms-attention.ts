import { needsRoomOf, type AttentionExamRoom, type AttentionRoom } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { dayBeginnings } from './dated-check.js';
import { roomOutRank, roomsOut, roomsOutLessons } from './rooms-out-read.js';

/**
 * The home page's "Lessons that need a room" and "Exams that need a room"
 * (task 5.7a-2b, pull request #187, decisions 2, 7 and 10): the branch's
 * lessons and exams not started and not cancelled, in the years not closed,
 * whose room is out at their start. One row per closure, or per room by its
 * status; settled by "move all", a one-day room change, or changing the
 * exam's rooms (the Free now board is 5.7c).
 */
export async function lessonsNeedingRoom(
  transaction: Transaction,
  branchId: string,
  moment: Date,
): Promise<AttentionRoom[]> {
  const lessons = await transaction
    .selectFrom('lessons')
    .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
    .innerJoin('academic_years', 'academic_years.id', 'lesson_blocks.academic_year_id')
    .innerJoin('rooms', 'rooms.id', 'lessons.room_id')
    .select([
      'lessons.id',
      sql<string>`lessons.lesson_date::text`.as('date'),
      'lessons.starts_at',
      'lessons.room_id',
      'rooms.name as room_name',
    ])
    .where('lessons.branch_id', '=', branchId)
    .where('academic_years.status', '<>', 'closed')
    .where('lessons.cancel_cause', 'is', null)
    .where('lessons.starts_at', '>', moment)
    .where((eb) =>
      eb.or([
        eb('rooms.status', '<>', 'in_use'),
        eb.exists(
          eb
            .selectFrom('room_closures')
            .select('room_closures.id')
            .whereRef('room_closures.room_id', '=', 'lessons.room_id')
            .where('room_closures.withdrawn_at', 'is', null)
            .whereRef('room_closures.applies_from', '<=', 'lessons.starts_at')
            .whereRef('room_closures.applies_until', '>', 'lessons.starts_at'),
        ),
      ]),
    )
    .orderBy('lessons.starts_at')
    .orderBy('lessons.id')
    .execute();
  if (lessons.length === 0) return [];
  const out = await roomsOutLessons(
    transaction,
    lessons.map((one) => ({ id: one.id, roomId: one.room_id, startsAt: one.starts_at })),
  );
  const closureIds = [
    ...new Set([...out.values()].flatMap((one) => (one.closureId === null ? [] : [one.closureId]))),
  ];
  const closures = new Map(
    (closureIds.length === 0
      ? []
      : await transaction
          .selectFrom('room_closures')
          .select(['id', 'starts_on', 'ends_on'])
          .where('id', 'in', closureIds)
          .execute()
    ).map((row) => [row.id, row]),
  );
  const rows = new Map<string, AttentionRoom>();
  for (const one of lessons) {
    const found = out.get(one.id);
    // The one place of "needs a room" (decision 2).
    if (
      found === undefined ||
      !needsRoomOf({ startsAt: one.starts_at, cancelled: false, roomOut: found.cause }, moment)
    ) {
      continue;
    }
    const key = found.closureId ?? `${found.cause}:${found.roomId}`;
    const closure = found.closureId === null ? undefined : closures.get(found.closureId);
    const before = rows.get(key);
    rows.set(
      key,
      before === undefined
        ? {
            cause: found.cause,
            room: { id: found.roomId, name: one.room_name },
            closure:
              closure === undefined
                ? null
                : { id: closure.id, startsOn: closure.starts_on, endsOn: closure.ends_on },
            lessons: 1,
            firstDate: one.date,
            lastDate: one.date,
          }
        : { ...before, lessons: before.lessons + 1, lastDate: one.date },
    );
  }
  return [...rows.values()].sort(
    (a, b) =>
      a.firstDate.localeCompare(b.firstDate) ||
      roomOutRank(a.cause) - roomOutRank(b.cause) ||
      a.room.name.localeCompare(b.room.name),
  );
}

/** The exams of the branch not started and not cancelled with a room out at their start (decision 10). */
export async function examsNeedingRoom(
  transaction: Transaction,
  branchId: string,
  moment: Date,
): Promise<AttentionExamRoom[]> {
  const rows = await transaction
    .selectFrom('exams')
    .innerJoin('academic_years', 'academic_years.id', 'exams.academic_year_id')
    .innerJoin('exam_rooms', 'exam_rooms.exam_id', 'exams.id')
    .innerJoin('rooms', 'rooms.id', 'exam_rooms.room_id')
    .select([
      'exams.id',
      'exams.title',
      sql<string>`exams.exam_date::text`.as('date'),
      'exams.starts_at',
      'exams.ends_at',
      'exam_rooms.room_id',
      'rooms.name as room_name',
    ])
    .where('exams.branch_id', '=', branchId)
    .where('academic_years.status', '<>', 'closed')
    .where('exams.cancel_cause', 'is', null)
    .where('exams.starts_at', '>', moment)
    .orderBy('exams.starts_at')
    .orderBy('exams.id')
    .orderBy('rooms.name')
    .execute();
  if (rows.length === 0) return [];
  const times = rows.map((one) => one.starts_at.getTime());
  const rooms = await roomsOut(
    transaction,
    rows.map((one) => one.room_id),
    new Date(Math.min(...times)),
    new Date(Math.max(...times) + 1),
  );
  const outRows = rows.flatMap((one) => {
    const found = rooms.at(one.room_id, one.starts_at);
    return found === null ? [] : [{ ...one, cause: found.cause }];
  });
  if (outRows.length === 0) return [];
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const dates = outRows.map((one) => one.date).sort();
  const begins = await dayBeginnings(
    transaction,
    branch.time_zone,
    dates[0] ?? '',
    dates[dates.length - 1] ?? '',
  );
  const minutes = (date: string, at: Date) =>
    Math.round((at.getTime() - begins(date).getTime()) / 60_000);
  const exams = new Map<string, AttentionExamRoom>();
  for (const one of outRows) {
    const found = exams.get(one.id) ?? {
      examId: one.id,
      title: one.title,
      date: one.date,
      start: minutes(one.date, one.starts_at),
      end: minutes(one.date, one.ends_at),
      rooms: [],
    };
    exams.set(one.id, {
      ...found,
      rooms: [...found.rooms, { id: one.room_id, name: one.room_name, cause: one.cause }],
    });
  }
  return [...exams.values()];
}
