import {
  WEEK_LESSONS_MAX,
  classDisplayName,
  type WeekChangeKind,
  type WeekLesson,
} from '@sodiq/shared';
import { addDays, mondayOf } from '@sodiq/timetable-rules';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import type { Notifications } from '../notifications/notifications.service.js';
import { storedLessonRows, type StoredLesson } from './stored-lessons.js';

/**
 * The notices and the "changed" mark of a publish and a withdraw (task
 * 5.5c-3a, pull request #158; `06`, How surprises are prevented, Everyone is
 * told: "Each affected teacher receives a notice showing before and after.
 * Changed lessons carry a 'changed' mark on every timetable view for a
 * week."; edge/timetable, After publishing: "One notice per person per
 * event, with the week before and after. A teacher whose week did not change
 * gets none.").
 *
 * The lessons stored in the branch over the event's dates are read before its
 * first write of lessons, locked as the writer locks them, and again after its
 * last; both sides as the impact preview reads them (`storedLessonRows`,
 * `cancelled: 'one_day'`: a lesson the expansion cancelled is on neither side,
 * a one-day cancel is a lesson held; spec review must-fix 1). The two sides
 * are compared by `weekChanges`.
 */

/**
 * What makes two lessons the same for a teacher's week (decision 3), and
 * whether a one-day cancel is on it (task 5.6a-1, decision 11): a lesson
 * cancelled on one side only is changed.
 */
const keyOf = (one: StoredLesson): string =>
  [
    one.cancelCause === null ? 'held' : 'cancelled',
    one.lesson.date,
    one.lesson.start,
    one.lesson.end,
    one.lesson.unitId,
    one.lesson.subjectId,
    one.lesson.teacherIds.join(','),
    one.lesson.roomId ?? '',
  ].join('|');

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The comparison of the two sides. */
export interface WeekChanges {
  /** Lessons after the event with no equal before it, in a week that had a lesson before (decisions 3 and 4). */
  readonly marked: readonly string[];
  /**
   * Lessons after the event equal to a lesson before it of another id (a
   * lesson re-created in another block) that had a mark: the mark goes on with
   * them.
   */
  readonly kept: readonly { readonly id: string; readonly changedAt: Date }[];
  /** Each affected teacher and the Monday of the week shown (decisions 5 and 7). */
  readonly teachers: ReadonlyMap<string, string>;
  /** The lessons before the event that nothing after it equals: shown as changed in a notice. */
  readonly beforeDiffers: ReadonlySet<string>;
  /** The lessons after the event that nothing before it equals: shown as changed in a notice. */
  readonly afterDiffers: ReadonlySet<string>;
}

/**
 * Pairs the two sides one to one by date, start, end, class or group,
 * subject, teacher, room and the cancel, a lesson with itself first, then in the order of
 * the ids. An unpaired lesson after the event is changed, and is marked in a
 * week (Monday to Sunday) where the branch had a lesson before, `unwritten`
 * days included (decision 4, read by the week: a lesson moved to a weekday
 * that had none is a change all the same). The teacher of an
 * unpaired lesson on either side is affected; the week shown is the Monday of
 * that teacher's earliest unpaired lesson.
 */
export function weekChanges(
  before: readonly StoredLesson[],
  after: readonly StoredLesson[],
  unwritten: readonly StoredLesson[] = [],
): WeekChanges {
  const waiting = new Map<string, StoredLesson[]>();
  for (const one of [...before].sort((a, b) => compare(a.id, b.id))) {
    const key = keyOf(one);
    const list = waiting.get(key);
    if (list === undefined) waiting.set(key, [one]);
    else list.push(one);
  }
  const unpaired: StoredLesson[] = [];
  const kept: { id: string; changedAt: Date }[] = [];
  const sorted = [...after].sort((a, b) => compare(a.id, b.id));
  // A lesson with itself first, so a kept lesson never takes another's pair.
  const pairedAfter = new Set<string>();
  for (const one of sorted) {
    const list = waiting.get(keyOf(one));
    const at = list?.findIndex((other) => other.id === one.id) ?? -1;
    if (list !== undefined && at >= 0) {
      list.splice(at, 1);
      pairedAfter.add(one.id);
    }
  }
  for (const one of sorted) {
    if (pairedAfter.has(one.id)) continue;
    const match = waiting.get(keyOf(one))?.shift();
    if (match === undefined) {
      unpaired.push(one);
    } else if (match.changedAt !== null) {
      kept.push({ id: one.id, changedAt: match.changedAt });
    }
  }
  const weeksBefore = new Set([...before, ...unwritten].map((one) => mondayOf(one.lesson.date)));
  const marked = unpaired
    .filter((one) => weeksBefore.has(mondayOf(one.lesson.date)))
    .map((one) => one.id)
    .sort(compare);
  const left = [...waiting.values()].flat();
  const teachers = new Map<string, string>();
  for (const one of [...unpaired, ...left]) {
    for (const teacherId of one.lesson.teacherIds) {
      const known = teachers.get(teacherId);
      if (known === undefined || one.lesson.date < known) teachers.set(teacherId, one.lesson.date);
    }
  }
  return {
    marked,
    kept: kept.sort((a, b) => compare(a.id, b.id)),
    teachers: new Map(
      [...teachers.entries()]
        .sort(([a], [b]) => compare(a, b))
        .map(([id, date]) => [id, mondayOf(date)]),
    ),
    beforeDiffers: new Set(left.map((one) => one.id)),
    afterDiffers: new Set(unpaired.map((one) => one.id)),
  };
}

/** The event's dates and the side read before its first write. */
export interface WeekSnapshot {
  readonly branchId: string;
  /** The Monday of the first written date's week. */
  readonly firstDate: string;
  /** The first date the event writes. */
  readonly fromDate: string;
  readonly lastDate: string;
  /** The lessons before the event, from `firstDate`; the days before the write are the same after it. */
  readonly before: readonly StoredLesson[];
  /**
   * The days of the weeks around the written dates that are not written: before
   * the first written date and after the last, to the Sunday of its week, read
   * once for both sides (spec review should-fix 5; code review should-fix 4: a
   * withdraw's run can end mid-week).
   */
  readonly unwritten: readonly StoredLesson[];
}

const noClasses = (): undefined => undefined;

/**
 * The side before an event that writes the branch's lessons from `fromDate`
 * to `lastDate`; read after the publish lock and before the first write. The
 * written dates are read `for update`, as the writer reads them; the days of
 * the first week before `fromDate` and of the last week after `lastDate` are
 * not written and not locked.
 */
export async function snapshotWeek(
  transaction: Transaction,
  branchId: string,
  fromDate: string,
  lastDate: string,
): Promise<WeekSnapshot> {
  const firstDate = mondayOf(fromDate);
  // The writer's order: the dated blocks of the written dates, then their
  // lessons, each in the order of the id (`writeDatedLessons`).
  await transaction
    .selectFrom('lesson_blocks')
    .select('id')
    .where('branch_id', '=', branchId)
    .where('lesson_date', '>=', fromDate)
    .where('lesson_date', '<=', lastDate)
    .orderBy('id')
    .forUpdate()
    .execute();
  const read = (from: string, to: string, lock: boolean) =>
    storedLessonRows(transaction, {
      branchId,
      firstDate: from,
      lastDate: to,
      classIdsOf: noClasses,
      cancelled: 'one_day',
      lock,
    });
  return {
    branchId,
    firstDate,
    fromDate,
    lastDate,
    before: await read(fromDate, lastDate, true),
    unwritten: [
      ...(await read(firstDate, addDays(fromDate, -1), false)),
      ...(await read(addDays(lastDate, 1), addDays(mondayOf(lastDate), 6), false)),
    ],
  };
}

/** What `sendWeekChanges` did, for the audit entry of the event (decision 10). */
export interface WeekNotices {
  readonly notified: number;
  readonly marked: number;
}

const ROWS = 500;

const clockOf = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Reads the side after the event (a publish, a withdraw, or a one-day change
 * of task 5.6a-1), marks the changed lessons and sends one
 * notice to each affected teacher with an account (never a vacancy;
 * 5.5a-2b-1 decision 7), labelled with the branch, in the event's
 * transaction.
 */
export async function sendWeekChanges(
  transaction: Transaction,
  notifications: Notifications,
  snapshot: WeekSnapshot,
  event:
    | { readonly kind: WeekChangeKind; readonly number: number }
    | { readonly kind: 'timetable.day_changed' },
): Promise<WeekNotices> {
  const after = await storedLessonRows(transaction, {
    branchId: snapshot.branchId,
    firstDate: snapshot.fromDate,
    lastDate: snapshot.lastDate,
    classIdsOf: noClasses,
    cancelled: 'one_day',
    lock: false,
  });
  const changes = weekChanges(snapshot.before, after, snapshot.unwritten);

  const moment = await transactionMoment(transaction);
  const marks = [...changes.marked.map((id) => ({ id, changedAt: moment })), ...changes.kept];
  for (let at = 0; at < marks.length; at += ROWS) {
    await transaction
      .insertInto('lesson_changes')
      .values(
        marks.slice(at, at + ROWS).map((one) => ({
          lesson_id: one.id,
          branch_id: snapshot.branchId,
          changed_at: one.changedAt,
        })),
      )
      .onConflict((conflict) =>
        conflict.column('lesson_id').doUpdateSet((update) => ({
          changed_at: update.ref('excluded.changed_at'),
        })),
      )
      .execute();
  }

  const notified = await sendTeacherWeeks(transaction, {
    branchId: snapshot.branchId,
    teachers: changes.teachers,
    before: [...snapshot.unwritten, ...snapshot.before],
    after: [...snapshot.unwritten, ...after],
    beforeDiffers: changes.beforeDiffers,
    afterDiffers: changes.afterDiffers,
    send: (accountId, week) =>
      event.kind === 'timetable.day_changed'
        ? notifications.send(transaction, {
            kind: event.kind,
            branchId: snapshot.branchId,
            accountIds: [accountId],
            data: week,
          })
        : notifications.send(transaction, {
            kind: event.kind,
            branchId: snapshot.branchId,
            accountIds: [accountId],
            data: { number: String(event.number), ...week },
          }),
  });
  return { notified, marked: changes.marked.length };
}

/** A teacher's week before and after an event, as a notice carries it. */
export interface TeacherWeek {
  readonly weekStart: string;
  readonly before: WeekLesson[];
  readonly after: WeekLesson[];
}

/**
 * Sends each affected teacher with an account (never a vacancy; 5.5a-2b-1
 * decision 7) the week shown (`teachers`: the teacher and the Monday) of the
 * lessons of the branch before and after an event, a lesson of `beforeDiffers`
 * or `afterDiffers` shown as changed; `send` writes the notice of the
 * event's kind. Shared by a publish and a withdraw (`sendWeekChanges`) and a
 * Tutor change (`sendTutorChanges`, task 5.5c-3b). Answers how many were
 * notified.
 */
export async function sendTeacherWeeks(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly teachers: ReadonlyMap<string, string>;
    readonly before: readonly StoredLesson[];
    readonly after: readonly StoredLesson[];
    readonly beforeDiffers: ReadonlySet<string>;
    readonly afterDiffers: ReadonlySet<string>;
    readonly send: (accountId: string, week: TeacherWeek) => Promise<unknown>;
  },
): Promise<number> {
  const teacherIds = [...input.teachers.keys()];
  const staff =
    teacherIds.length === 0
      ? []
      : await transaction
          .selectFrom('staff')
          .select(['id', 'kind', 'account_id'])
          .where('id', 'in', teacherIds)
          .orderBy('id')
          .execute();
  const notified = staff.flatMap((one) =>
    one.kind === 'vacancy' || one.account_id === null
      ? []
      : [{ teacherId: one.id, accountId: one.account_id }],
  );
  if (notified.length === 0) {
    return 0;
  }

  const names = await namesOf(transaction, [...input.before, ...input.after]);
  const weekLessonOf = (one: StoredLesson, differs: ReadonlySet<string>): WeekLesson => ({
    date: one.lesson.date,
    start: clockOf(one.lesson.start),
    end: clockOf(one.lesson.end),
    unit: named(names.units, one.lesson.unitId),
    subject: named(names.subjects, one.lesson.subjectId),
    room: one.lesson.roomId === null ? null : named(names.rooms, one.lesson.roomId),
    cancelled: one.cancelCause !== null,
    changed: differs.has(one.id),
  });
  const weekOf = (
    lessons: readonly StoredLesson[],
    differs: ReadonlySet<string>,
    teacherId: string,
    monday: string,
  ) => {
    const sunday = addDays(monday, 6);
    return lessons
      .filter(
        (one) =>
          one.lesson.teacherIds.includes(teacherId) &&
          one.lesson.date >= monday &&
          one.lesson.date <= sunday,
      )
      .map((one) => weekLessonOf(one, differs))
      .sort(
        (a, b) =>
          compare(a.date, b.date) ||
          compare(a.start, b.start) ||
          compare(a.unit, b.unit) ||
          compare(a.subject.en, b.subject.en),
      )
      .slice(0, WEEK_LESSONS_MAX);
  };
  let count = 0;
  for (const one of notified) {
    const monday = input.teachers.get(one.teacherId);
    if (monday === undefined) continue;
    await input.send(one.accountId, {
      weekStart: monday,
      before: weekOf(input.before, input.beforeDiffers, one.teacherId, monday),
      after: weekOf(input.after, input.afterDiffers, one.teacherId, monday),
    });
    count += 1;
  }
  return count;
}

/** A name read by `namesOf`; a lesson's class, group, subject and room always exist (foreign keys). */
function named<Value>(found: ReadonlyMap<string, Value>, id: string): Value {
  const value = found.get(id);
  if (value === undefined) throw new Error('A stored lesson names a record that was not read.');
  return value;
}

/** The names a notice shows, as the event saw them. */
async function namesOf(transaction: Transaction, lessons: readonly StoredLesson[]) {
  const ids = (pick: (one: StoredLesson) => string | null) =>
    [...new Set(lessons.flatMap((one) => (pick(one) === null ? [] : [pick(one) ?? ''])))].sort();
  const unitIds = ids((one) => one.lesson.unitId);
  const subjectIds = ids((one) => one.lesson.subjectId);
  const roomIds = ids((one) => one.lesson.roomId);
  const [classes, groups, subjects, rooms] = await Promise.all([
    unitIds.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('classes')
          .select(['id', 'grade', 'name'])
          .where('id', 'in', unitIds)
          .execute(),
    unitIds.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('groups')
          .select(['id', 'name'])
          .where('id', 'in', unitIds)
          .execute(),
    subjectIds.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('subjects')
          .select(['id', 'name_uz', 'name_ru', 'name_en'])
          .where('id', 'in', subjectIds)
          .execute(),
    roomIds.length === 0
      ? Promise.resolve([])
      : transaction.selectFrom('rooms').select(['id', 'name']).where('id', 'in', roomIds).execute(),
  ]);
  return {
    units: new Map([
      ...classes.map((one): [string, string] => [one.id, classDisplayName(one.grade, one.name)]),
      ...groups.map((one): [string, string] => [one.id, one.name]),
    ]),
    subjects: new Map(
      subjects.map((one) => [one.id, { uz: one.name_uz, ru: one.name_ru, en: one.name_en }]),
    ),
    rooms: new Map(rooms.map((one) => [one.id, one.name])),
  };
}
