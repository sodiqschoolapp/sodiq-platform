import {
  addDays,
  checkCandidates,
  type EngineDay,
  type Facts,
  type Placement,
  type RuleResult,
} from '@sodiq/timetable-rules';
import type { Transaction } from '../../database/transactions.js';
import { examPlacementOf, type StandingExam } from './calendar-exams.js';
import { closedSpansOn } from './rooms-out-read.js';
import { claimsElsewhere, teacherStatesOf } from './dated-check.js';
import { dayStateOf, examsOn, storedLessonsOn, type Services } from './stored-day.js';
import { versionOnDate } from './version-on-date.js';

export { versionOnDate };

/**
 * The rule check of an exam on its date before the exam save writes it
 * (task 5.6c-1, pull request #181; `06`, Exam: "over that time it is checked
 * as a lesson is for its invigilators, rooms and classes — an invigilator
 * cannot be in a lesson or another exam, a room cannot hold a lesson or
 * another exam unless shared, and a class cannot be in a lesson.
 * Availability and subject of an invigilator are always warnings with a
 * tick; room capacity is a warning against the students of the classes in
 * that room").
 *
 * The exam is placed among the branch's stored lessons of its date that are
 * held, but those it covers (`skipped`), with a class it keeps out of a
 * block taken out of that block only (`.claude/rules/timetable.md`: the
 * block stays in the check for its teacher and room); the branch's other
 * standing exams and every other branch's claims of its invigilators are
 * fixed placements. The facts are the published version's of the date, read
 * as if it started then, with every invigilator and every teacher of the
 * date's lessons linked to the branch as a teacher of the facts, so that a
 * person who teaches nothing in the version is checked too (spec review of
 * the plan, must-fix 7).
 */

const MINUTE = 60_000;

/** The exam as the check reads it: a standing exam's shape at its new time. */
export interface ExamCandidate {
  readonly exam: StandingExam;
  readonly time: { readonly start: number; readonly end: number };
  readonly subjectId: string | null;
  /** The classes and groups each room holds. */
  readonly rooms: readonly {
    readonly roomId: string;
    readonly classIds: readonly string[];
    readonly groupIds: readonly string[];
  }[];
}

/** The day of each grade on the date, and the moment it begins. */
export interface ExamDay {
  readonly begins: Date;
  readonly dayOf: (grade: number) => EngineDay;
}

/** The facts of the version on the date, with the people named added. */
async function stateOn(
  transaction: Transaction,
  services: Services,
  input: {
    readonly accountId: string;
    readonly branchId: string;
    readonly versionId: string;
    readonly date: string;
    readonly people: readonly string[];
  },
) {
  const linked =
    input.people.length === 0
      ? []
      : (
          await transaction
            .selectFrom('staff_branches')
            .select('staff_id')
            .where('staff_id', 'in', [...new Set(input.people)])
            .where('branch_id', '=', input.branchId)
            .execute()
        ).map((one) => one.staff_id);
  return dayStateOf(transaction, services, input.accountId, input.versionId, input.date, linked);
}

/** The day of the date for each grade, under the version in force. */
export async function examDayOf(
  transaction: Transaction,
  services: Services,
  input: {
    readonly accountId: string;
    readonly branchId: string;
    readonly versionId: string;
    readonly date: string;
  },
): Promise<ExamDay> {
  const { dated } = await stateOn(transaction, services, { ...input, people: [] });
  return {
    begins: dated.begins(input.date),
    dayOf: (grade) => dated.dayOfDate(grade, input.date).engine,
  };
}

/** The blocked results and the warnings of the exam on its date. */
export async function examCheck(
  transaction: Transaction,
  services: Services,
  input: {
    readonly accountId: string;
    readonly branchId: string;
    readonly versionId: string;
    readonly candidate: ExamCandidate;
    /** The lessons the exam covers: left out of the check. */
    readonly skipped: ReadonlySet<string>;
    readonly outs: readonly { readonly blockId: string; readonly classId: string }[];
  },
): Promise<{ readonly blocked: RuleResult[]; readonly warnings: RuleResult[] }> {
  const { candidate, branchId } = input;
  const { exam } = candidate;
  const date = exam.date;
  const stored = await storedLessonsOn(transaction, branchId, date);
  const held = stored.filter((one) => one.cancelCause === null && !input.skipped.has(one.id));
  const { state, dated } = await stateOn(transaction, services, {
    accountId: input.accountId,
    branchId,
    versionId: input.versionId,
    date,
    people: [
      ...exam.invigilatorIds,
      ...held.flatMap((one) => (one.teacherId === null ? [] : [one.teacherId])),
    ],
  });
  const { model } = state.pattern;
  const { data } = model;
  const { begins, classOn, studentsOn, dayOfDate, branch } = dated;
  const minutesOf = (moment: Date) =>
    Math.round((moment.getTime() - begins(date).getTime()) / MINUTE);
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  // A class that sits only in a group has no row of the version, so the
  // facts may not name it (as `examBlocked` adds it).
  const factUnits = new Map(model.facts.units);
  for (const unit of exam.classUnits) if (!factUnits.has(unit.id)) factUnits.set(unit.id, unit);

  // A held lesson is context: placed as stored, a class kept out of its
  // block taken out of it.
  const own = held.map((one): Placement => {
    const unitId = one.classId ?? one.groupId ?? '';
    const out = new Set(
      input.outs.filter((row) => row.blockId === one.blockId).map((row) => row.classId),
    );
    const classIds = units.get(unitId)?.classIds ?? (one.classId === null ? [] : [one.classId]);
    return {
      id: one.id,
      kind: 'lesson',
      branchId,
      day: date,
      start: minutesOf(one.startsAt),
      end: minutesOf(one.endsAt),
      blockId: one.blockId,
      doublePairId: null,
      classId: one.classId,
      groupId: one.groupId,
      classIds: classIds.filter((id) => !out.has(id)),
      studentIds: studentsOn(unitId, date),
      exemptStudentIds: [],
      subjectId: one.subjectId,
      loadRowId: one.loadRowId,
      teacherIds: one.teacherId === null ? [] : [one.teacherId],
      substitute: false,
      roomId: one.roomId,
      examRooms: [],
      fixed: true,
    };
  });
  const { elsewhere } = await claimsElsewhere(transaction, {
    branchId,
    timeZone: branch.time_zone,
    teacherIds: exam.invigilatorIds.filter((id) => data.teachers.some((one) => one.id === id)),
    from: begins(date),
    until: begins(addDays(date, 1)),
  });
  const exams = (
    await examsOn(
      transaction,
      branchId,
      branch.time_zone,
      date,
      begins(date),
      begins(addDays(date, 1)),
    )
  ).filter((one) => one.id !== `exam:${exam.id}`);
  const { teachersOn } = await teacherStatesOf(transaction, data.teachers, branchId);
  // Task 5.7a-2b (decision 5): an exam room closed at its time is refused.
  const closed = await closedSpansOn(transaction, {
    timeZone: branch.time_zone,
    date,
    rooms: [...model.facts.rooms.values()],
  });
  const facts: Facts = {
    ...model.facts,
    rooms: new Map(
      [...model.facts.rooms].map(([id, room]) => [
        id,
        closed.has(id) ? { ...room, closed: closed.get(id) ?? [] } : room,
      ]),
    ),
    units: factUnits,
    mode: 'dated',
    teachers: teachersOn(date),
    classStudents: (classId) => classOn(classId, date),
    dayOf: (_branch, grade) => dayOfDate(grade, date).engine,
    otherDrafts: [],
  };
  const students = new Map(
    candidate.rooms.map((room) => [
      room.roomId,
      new Set([
        ...room.classIds.flatMap((id) => classOn(id, date)),
        ...room.groupIds.flatMap((id) => studentsOn(id, date)),
      ]).size,
    ]),
  );
  const placed = examPlacementOf(exam, branchId, candidate.time, {
    subjectId: candidate.subjectId,
    students,
  });
  const results = checkCandidates(
    [...own, ...(elsewhere.get(date) ?? []), ...exams],
    facts,
    [placed],
    { availabilityFrom: date },
  ).filter((one) => one.rule !== 'teacher_week_load');
  return {
    blocked: results.filter((one) => one.severity === 'blocked'),
    warnings: results.filter((one) => one.severity !== 'blocked'),
  };
}
