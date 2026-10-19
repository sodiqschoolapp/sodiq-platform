import {
  addDays,
  checkCandidates,
  checkTeacherTime,
  type Facts,
  type Placement,
  type RuleResult,
  weekdayOf,
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
 * - the two halves of a double lesson are restored together and checked
 *   together (`edge/timetable`, Structure, "Double lessons": "They are moved,
 *   cancelled and substituted together"; review of the code, change 1); a
 *   half whose other half stays cancelled by another cause (an exam) is
 *   checked as a single lesson;
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

/** What the check found for the candidates. */
export interface StoredDayResult {
  readonly blocked: readonly RuleResult[];
  readonly warnings: readonly RuleResult[];
  /**
   * The teacher each candidate is checked and written with, by lesson id: a
   * Tutor lesson's Tutor at its start, else its own.
   */
  readonly teacherIds: ReadonlyMap<string, string | null>;
  /**
   * When a rule of the room blocks: the rooms of the branch in use in which
   * the same check finds nothing blocked for the lessons, their own room left
   * out (decision 7); else none.
   */
  readonly freeRooms: readonly string[];
}

const MINUTE = 60_000;

/** The class or group of a stored lesson. */
const unitOf = (one: StoredDayLesson) => one.classId ?? one.groupId ?? '';

/**
 * The lessons of `lesson`'s double pair among `lessons` (the stored lessons
 * of its date): those of the same pair and class or group, `lesson` among
 * them, by start; `[lesson]` for a lesson of no pair.
 */
export function pairOf(
  lessons: readonly StoredDayLesson[],
  lesson: StoredDayLesson,
): StoredDayLesson[] {
  if (lesson.doublePairId === null) return [lesson];
  const pair = lessons.filter(
    (one) =>
      one.id !== lesson.id &&
      one.date === lesson.date &&
      one.doublePairId === lesson.doublePairId &&
      unitOf(one) === unitOf(lesson),
  );
  return [...pair, lesson].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id),
  );
}

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

type Services = { readonly timetable: Timetable; readonly pattern: TimetablePattern };

/**
 * The facts of a version read as if it started on `date`
 * (`.claude/rules/timetable.md`): its pattern state with the Tutors of the
 * date, and the dated facts of that one date.
 */
async function dayStateOf(
  transaction: Transaction,
  services: Services,
  accountId: string,
  versionId: string,
  date: string,
) {
  const stored = await services.timetable.versionRow(transaction, versionId);
  const row = { ...stored, starts_on: date };
  const rows = await services.timetable.withVersionTutors(
    transaction,
    await services.timetable.contextOf(transaction, row),
    await services.timetable.rowsOf(transaction, versionId),
  );
  const state = await services.pattern.stateOf(transaction, row, accountId, rows);
  return { state, dated: await datedLessonsOf(transaction, state, date, date) };
}

/**
 * The moments of lesson slots `lessonNumber`, `lessonNumber + 1`, … (`count`
 * of them, consecutive lesson slots) of `date` for `lesson`'s class or group
 * under its version (task 5.6a-2, decision 6): the slots of the date's day of
 * the unit's lowest grade; on a date without lessons (a day off, a vacation)
 * those of the weekday's day of the version, so that the rule check names why
 * the date is refused. `null` when neither has those slots.
 */
export async function slotMomentsOn(
  transaction: Transaction,
  services: Services,
  input: {
    readonly accountId: string;
    readonly lesson: StoredDayLesson;
    readonly date: string;
    readonly lessonNumber: number;
    readonly count: number;
  },
): Promise<{ readonly startsAt: Date; readonly endsAt: Date }[] | null> {
  const { state, dated } = await dayStateOf(
    transaction,
    services,
    input.accountId,
    input.lesson.versionId,
    input.date,
  );
  const { data } = state.pattern.model;
  const grades = data.units.find((unit) => unit.id === unitOf(input.lesson))?.grades ?? [];
  const grade = [...grades].sort((a, b) => a - b)[0];
  if (grade === undefined) return null;
  const ofDate = dated.dayOfDate(grade, input.date).engine;
  const weekday = weekdayOf(input.date);
  const weekly = data.days.find((one) => one.grade === grade && one.weekday === weekday)?.day;
  const day = ofDate.lessons ? ofDate.day : weekly?.lessons === true ? weekly.day : null;
  if (day === null) return null;
  const moments = [];
  for (let at = 0; at < input.count; at += 1) {
    const slot = day.slots.find((one) => one.lessonNumber === input.lessonNumber + at);
    if (slot === undefined) return null;
    const begins = dated.begins(input.date).getTime();
    moments.push({
      startsAt: new Date(begins + slot.start * MINUTE),
      endsAt: new Date(begins + slot.end * MINUTE),
    });
  }
  return moments;
}

/**
 * Checks `lessons` (one lesson, the halves of a double pair, or the lessons
 * of a block, of one date and version) held on their date with `roomId`
 * (their own rooms unless given), together, among the branch's other stored
 * lessons of the date (see the file's comment). A one-day move passes the
 * lessons at their new date and times (task 5.6a-2).
 */
export async function storedDayCheck(
  transaction: Transaction,
  services: Services,
  input: {
    readonly accountId: string;
    readonly lessons: readonly StoredDayLesson[];
    readonly roomId?: string | null;
  },
): Promise<StoredDayResult> {
  const [lesson] = input.lessons;
  if (lesson === undefined) throw new Error('No lesson to check.');
  const { date, branchId } = lesson;
  const ids = new Set(input.lessons.map((one) => one.id));
  const { state, dated } = await dayStateOf(
    transaction,
    services,
    input.accountId,
    lesson.versionId,
    date,
  );
  const { model } = state.pattern;
  const { data } = model;
  const { begins, classOn, studentsOn, tutorOn, dayOfDate, branch } = dated;
  const minutesOf = (moment: Date) =>
    Math.round((moment.getTime() - begins(date).getTime()) / MINUTE);

  const held = (await storedLessonsOn(transaction, branchId, date)).filter(
    (one) => one.cancelCause === null && !ids.has(one.id),
  );
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  // A half of a double is one of a pair only while its other half is held.
  const halves = new Map<string, number>();
  for (const one of [...held, ...input.lessons]) {
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
  const tutorSubjects = new Set(
    data.subjects.filter((one) => one.tutorSubject).map((one) => one.id),
  );
  const teacherIds = new Map<string, string | null>();
  const followed = new Set<string>();
  for (const one of input.lessons) {
    let teacherId = one.teacherId;
    if (tutorSubjects.has(one.subjectId) && one.classId !== null) {
      teacherId = tutorOn(one.classId, date, minutesOf(one.startsAt));
      if (teacherId !== null && teacherId !== model.rowOf(one.loadRowId).teacherId) {
        followed.add(one.id);
      }
    }
    teacherIds.set(one.id, teacherId);
  }
  const candidateTeachers = [...new Set([...teacherIds.values()].flatMap((one) => one ?? []))];

  // Only a teacher of the branch has claims elsewhere to read (`teacher_claims_elsewhere`
  // refuses another), as `datedCheck` reads them (permission review should-fix 6).
  const linked =
    candidateTeachers.length === 0
      ? []
      : await transaction
          .selectFrom('staff_branches')
          .select('staff_id')
          .where('staff_id', 'in', candidateTeachers)
          .where('branch_id', '=', branchId)
          .execute();
  const { elsewhere } = await claimsElsewhere(transaction, {
    branchId,
    timeZone: branch.time_zone,
    teacherIds: linked.map((one) => one.staff_id),
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

  // `undefined`: each lesson in its own room.
  const check = (roomId: string | null | undefined) => {
    const candidates = input.lessons.map((one) =>
      placementOf(
        one,
        followed.has(one.id) ? null : (teacherIds.get(one.id) ?? null),
        roomId === undefined ? one.roomId : roomId,
      ),
    );
    const results = checkCandidates(others, facts, candidates, { availabilityFrom: date }).filter(
      (one) => one.rule !== 'teacher_week_load',
    );
    return { candidates, results };
  };
  const roomId = input.roomId;
  const { candidates, results } = check(roomId);
  for (const id of followed) {
    const teacherId = teacherIds.get(id) ?? null;
    const candidate = candidates.find((one) => one.id === id);
    if (teacherId === null || candidate === undefined) continue;
    const timed = { ...candidate, teacherIds: [teacherId] };
    const rest = candidates.filter((one) => one.id !== id);
    if (checkTeacherTime([...others, ...rest], timed, facts.travelMinutes).length > 0) {
      teacherIds.set(id, null);
    }
  }
  const blocked = results.filter((one) => one.severity === 'blocked');
  // Rooms are offered only when a rule of the room blocks: when the teacher
  // or the class blocks, no room helps (code review should-fix 5).
  const ownRooms = new Set(
    input.lessons.map((one) => (roomId === undefined ? one.roomId : roomId)),
  );
  const freeRooms = !blocked.some((one) => one.rule.startsWith('room_'))
    ? []
    : [...facts.rooms.values()]
        .filter((room) => room.status === 'in_use' && !ownRooms.has(room.id))
        .map((room) => room.id)
        .sort()
        .filter((id) => !check(id).results.some((one) => one.severity === 'blocked'));
  return {
    blocked,
    warnings: results.filter((one) => one.severity === 'warning'),
    teacherIds,
    freeRooms,
  };
}
