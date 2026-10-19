import {
  addDays,
  checkCandidate,
  checkTeacherTime,
  type Facts,
  type Placement,
  type RuleResult,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { claimsElsewhere, datedLessonsOf, teacherStatesOf } from './dated-check.js';
import type { TimetablePattern } from './pattern.service.js';
import type { Timetable } from './timetable.service.js';

/**
 * The rule check of a stored lesson on its own date (task 5.6a-1, pull
 * request #160): what a one-day change runs before it writes (`06`, Changes
 * after publishing: "Every one-day change … passes the same rules";
 * edge/timetable, After publishing: "A cancelled lesson is restored after its
 * room went to another lesson. Every rule is checked again."). The parts of
 * 5.6a that follow (a room change, a move, a bulk cancel, a correction) run
 * the same check.
 *
 * The candidate is placed among the branch's stored lessons of the date that
 * are not cancelled (`mode: 'dated'`, real clock minutes), with the teachers'
 * claims in every other branch and the branch's own exams of the date as
 * fixed placements; the facts are those of the version the lesson comes
 * from, read as if it started on the date (`.claude/rules/timetable.md`): the
 * statuses, the members and the template of the date. `checkCandidate` gives
 * only the results that name the candidate. Decisions of the plan:
 * - every blocked result refuses, availability included; the warnings are
 *   returned and need no tick (decision 8);
 * - `teacher_week_load` is left out: one date cannot count a week (spec
 *   review should-fix 10);
 * - a lesson of a double lesson whose other half is not held (a one-day
 *   cancel of one half, decision 4) is checked as a single lesson;
 * - a Tutor lesson takes the class's Tutor in force at its start (`tutorAt`)
 *   (decision 9). The rows are read with the Tutor of the date
 *   (`withVersionTutors`), so that Tutor is the row's teacher and is checked
 *   with every rule, as a publish from that date checks it; a Tutor other
 *   than the row's (one who starts later that day) is checked by time and
 *   travel only (`checkTeacherTime`), as `followTutors` checks one, and a
 *   clash, or no Tutor, leaves the lesson with no teacher, "needs a teacher".
 */

/** A stored lesson as the check reads it. */
export interface StoredDayLesson {
  readonly id: string;
  readonly branchId: string;
  readonly blockId: string;
  readonly versionId: string;
  readonly doublePairId: string | null;
  readonly date: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
  readonly loadRowId: string;
  readonly teacherId: string | null;
  readonly roomId: string | null;
  readonly cancelCause: string | null;
  readonly cancelReason: string | null;
}

/** What the check found for the candidate. */
export interface StoredDayResult {
  readonly blocked: readonly RuleResult[];
  readonly warnings: readonly RuleResult[];
  /** The teacher the lesson is checked and written with: a Tutor lesson's Tutor at its start, else its own. */
  readonly teacherId: string | null;
  /**
   * The rooms of the branch in use in which the same check finds nothing
   * blocked for the lesson, the lesson's own room left out (decision 7).
   */
  readonly freeRooms: readonly string[];
}

const MINUTE = 60_000;

/** The stored lessons of a branch on a date, as the check and the routes read them. */
export async function storedLessonsOn(
  transaction: Transaction,
  branchId: string,
  date: string,
  options: { readonly lessonIds?: readonly string[] } = {},
): Promise<StoredDayLesson[]> {
  let query = transaction
    .selectFrom('lessons')
    .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
    .select([
      'lessons.id',
      'lessons.branch_id',
      'lessons.block_id',
      'lesson_blocks.version_id',
      'lesson_blocks.double_pair_id',
      sql<string>`lessons.lesson_date::text`.as('lesson_date'),
      'lessons.starts_at',
      'lessons.ends_at',
      'lessons.class_id',
      'lessons.group_id',
      'lessons.subject_id',
      'lessons.load_row_id',
      'lessons.teacher_id',
      'lessons.room_id',
      'lessons.cancel_cause',
      'lessons.cancel_reason',
    ])
    .where('lessons.branch_id', '=', branchId)
    .where('lessons.lesson_date', '=', date);
  if (options.lessonIds !== undefined) {
    if (options.lessonIds.length === 0) return [];
    query = query.where('lessons.id', 'in', options.lessonIds);
  }
  const rows = await query.orderBy('lessons.starts_at').orderBy('lessons.id').execute();
  return rows.map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    blockId: row.block_id,
    versionId: row.version_id,
    doublePairId: row.double_pair_id,
    date: row.lesson_date,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    classId: row.class_id,
    groupId: row.group_id,
    subjectId: row.subject_id,
    loadRowId: row.load_row_id,
    teacherId: row.teacher_id,
    roomId: row.room_id,
    cancelCause: row.cancel_cause,
    cancelReason: row.cancel_reason,
  }));
}

/** The branch's own exams of the date as fixed placements, from their claims (0060). */
async function examsOn(
  transaction: Transaction,
  branchId: string,
  timeZone: string,
  date: string,
  from: Date,
  until: Date,
): Promise<Placement[]> {
  const { rows } = await sql<{
    exam_id: string;
    kind: string;
    teacher_id: string | null;
    room_id: string | null;
    class_id: string | null;
    start_minutes: number;
    end_minutes: number;
  }>`
    select c.exam_id, c.kind, c.teacher_id, c.room_id, c.class_id,
      (extract(epoch from (lower(c.during) at time zone ${timeZone})
        - (lower(c.during) at time zone ${timeZone})::date::timestamp) / 60)::int as start_minutes,
      (extract(epoch from (upper(c.during) at time zone ${timeZone})
        - (lower(c.during) at time zone ${timeZone})::date::timestamp) / 60)::int as end_minutes
    from time_claims c
    where c.branch_id = ${branchId}::uuid
      and c.kind in ('exam_room', 'exam_invigilator', 'exam_class')
      and c.during && tstzrange(${from}::timestamptz, ${until}::timestamptz)
    order by c.exam_id, c.id
  `.execute(transaction);
  const exams = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) exams.set(row.exam_id, [...(exams.get(row.exam_id) ?? []), row]);
  return [...exams.entries()].map(([id, claims]) => {
    const first = claims[0];
    const ids = (pick: (one: (typeof rows)[number]) => string | null) => [
      ...new Set(claims.flatMap((one) => (pick(one) === null ? [] : [pick(one) ?? '']))),
    ];
    return {
      id: `exam:${id}`,
      kind: 'exam',
      branchId,
      day: date,
      start: first?.start_minutes ?? 0,
      end: first?.end_minutes ?? 0,
      blockId: null,
      doublePairId: null,
      classId: null,
      groupId: null,
      classIds: ids((one) => one.class_id),
      studentIds: [],
      exemptStudentIds: [],
      subjectId: null,
      loadRowId: null,
      teacherIds: ids((one) => one.teacher_id),
      substitute: false,
      roomId: null,
      examRooms: ids((one) => one.room_id).map((roomId) => ({ roomId, students: 0 })),
      fixed: true,
    } satisfies Placement;
  });
}

/**
 * Checks `lesson` held on its date with `roomId` (its own room unless given),
 * among the branch's other stored lessons of the date (see the file's comment).
 */
export async function storedDayCheck(
  transaction: Transaction,
  services: { readonly timetable: Timetable; readonly pattern: TimetablePattern },
  input: {
    readonly accountId: string;
    readonly lesson: StoredDayLesson;
    readonly roomId?: string | null;
  },
): Promise<StoredDayResult> {
  const { lesson } = input;
  const { date, branchId } = lesson;
  // Read as if the version started on the date (`.claude/rules/timetable.md`).
  const stored = await services.timetable.versionRow(transaction, lesson.versionId);
  const row = { ...stored, starts_on: date };
  const rows = await services.timetable.withVersionTutors(
    transaction,
    await services.timetable.contextOf(transaction, row),
    await services.timetable.rowsOf(transaction, lesson.versionId),
  );
  const state = await services.pattern.stateOf(transaction, row, input.accountId, rows);
  const { model } = state.pattern;
  const { data } = model;
  const { begins, classOn, studentsOn, tutorOn, dayOfDate, branch } = await datedLessonsOf(
    transaction,
    state,
    date,
    date,
  );
  const minutesOf = (moment: Date) =>
    Math.round((moment.getTime() - begins(date).getTime()) / MINUTE);

  const held = (await storedLessonsOn(transaction, branchId, date)).filter(
    (one) => one.cancelCause === null && one.id !== lesson.id,
  );
  const unitOf = (one: StoredDayLesson) => one.classId ?? one.groupId ?? '';
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  // A half of a double is one of a pair only while its other half is held.
  const halves = new Map<string, number>();
  for (const one of [...held, lesson]) {
    if (one.doublePairId === null) continue;
    const key = `${one.doublePairId}|${unitOf(one)}`;
    halves.set(key, (halves.get(key) ?? 0) + 1);
  }
  const placementOf = (one: StoredDayLesson, teacherId: string | null, roomId: string | null) => {
    const unitId = unitOf(one);
    const pair =
      one.doublePairId !== null && (halves.get(`${one.doublePairId}|${unitId}`) ?? 0) >= 2
        ? one.doublePairId
        : null;
    return {
      id: one.id,
      kind: 'lesson',
      branchId,
      day: date,
      start: minutesOf(one.startsAt),
      end: minutesOf(one.endsAt),
      blockId: one.blockId,
      doublePairId: pair,
      classId: one.classId,
      groupId: one.groupId,
      classIds: units.get(unitId)?.classIds ?? (one.classId === null ? [] : [one.classId]),
      studentIds: studentsOn(unitId, date),
      exemptStudentIds: [],
      subjectId: one.subjectId,
      loadRowId: one.loadRowId,
      teacherIds: teacherId === null ? [] : [teacherId],
      substitute: false,
      roomId,
      examRooms: [],
      fixed: false,
    } satisfies Placement;
  };

  // A Tutor lesson takes the class's Tutor at its start (decision 9).
  const tutorSubject = data.subjects.some((one) => one.id === lesson.subjectId && one.tutorSubject);
  const tutorLesson = tutorSubject && lesson.classId !== null;
  const rowTeacher = model.rowOf(lesson.loadRowId).teacherId;
  let teacherId = lesson.teacherId;
  if (tutorLesson && lesson.classId !== null) {
    teacherId = tutorOn(lesson.classId, date, minutesOf(lesson.startsAt));
  }
  const followed = tutorLesson && teacherId !== null && teacherId !== rowTeacher;

  const { elsewhere } = await claimsElsewhere(transaction, {
    branchId,
    timeZone: branch.time_zone,
    teacherIds: teacherId === null ? [] : [teacherId],
    from: begins(date),
    until: begins(addDays(date, 1)),
  });
  const { teachersOn } = await teacherStatesOf(transaction, data.teachers, branchId);
  const exams = await examsOn(
    transaction,
    branchId,
    branch.time_zone,
    date,
    begins(date),
    begins(addDays(date, 1)),
  );
  const fixed = [...(elsewhere.get(date) ?? []), ...exams];
  const others = [...held.map((one) => placementOf(one, one.teacherId, one.roomId)), ...fixed];
  const facts: Facts = {
    ...model.facts,
    mode: 'dated',
    teachers: teachersOn(date),
    classStudents: (classId) => classOn(classId, date),
    dayOf: (_branch, grade) => dayOfDate(grade, date).engine,
    otherDrafts: [],
  };

  const check = (roomId: string | null) => {
    const candidate = placementOf(lesson, followed ? null : teacherId, roomId);
    const results = checkCandidate(others, facts, candidate, { availabilityFrom: date }).filter(
      (one) => one.rule !== 'teacher_week_load',
    );
    return { candidate, results };
  };
  const roomId = input.roomId === undefined ? lesson.roomId : input.roomId;
  const { candidate, results } = check(roomId);
  if (followed && teacherId !== null) {
    const timed = { ...candidate, teacherIds: [teacherId] };
    if (checkTeacherTime(others, timed, facts.travelMinutes).length > 0) {
      teacherId = null;
    }
  }
  const blocked = results.filter((one) => one.severity === 'blocked');
  const freeRooms =
    blocked.length === 0
      ? []
      : [...facts.rooms.values()]
          .filter((room) => room.status === 'in_use' && room.id !== roomId)
          .map((room) => room.id)
          .sort()
          .filter((id) => !check(id).results.some((one) => one.severity === 'blocked'));
  return {
    blocked,
    warnings: results.filter((one) => one.severity === 'warning'),
    teacherId,
    freeRooms,
  };
}
