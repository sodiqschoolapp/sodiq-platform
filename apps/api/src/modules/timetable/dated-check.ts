import {
  addDays,
  checkTeacherTime,
  checkTimetable,
  datedPattern,
  datedPublishResults,
  patternIdOf,
  dayOn,
  tutorAt,
  weekdayOf,
  type DatedBlock,
  type DatedDay,
  type DatedLesson,
  type EngineDay,
  type EngineTeacher,
  type Facts,
  type NeedsTeacher,
  type Placement,
  type RuleResult,
} from '@sodiq/timetable-rules';
import {
  weekdaySchema,
  type CancelledLesson,
  type NeedsTeacherAnswer,
  type RuleResultAnswer,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { loadCalendarSettings } from '../setup/calendar-state.js';
import { dayOf, loadStore } from '../setup/day-template-state.js';
import { readTutorRows } from './load-facts.js';
import type { PatternState } from './pattern.service.js';

/** What the dated check of a publish found (task 5.5a-2a), as the answer names it. */
export interface DatedFindings {
  /** Blocked results only a date shows (`date_blocked`). */
  readonly blocked: RuleResultAnswer[];
  /** `teacher_unavailable_later` by date (decision 6). */
  readonly warnings: RuleResultAnswer[];
  readonly needsTeacher: NeedsTeacherAnswer[];
  readonly cancelled: CancelledLesson[];
}

/** A dated row of a class or group, half-open. */
interface MemberRow {
  readonly unit_id: string;
  readonly student_id: string;
  readonly valid_from: string;
  readonly valid_until: string;
}

const OUT_STATUSES = ['inactive', 'left', 'closed'];

/**
 * The check of every date of a publish (task 5.5a-2a, pull request #140):
 * the pattern's lessons on each date from the start to the version's end
 * (`datedPattern`), each date checked by `checkTimetable` in dated mode with
 * the facts of that date (decision 3): the calendar, special days and their
 * templates (`dayOn`, `dayOf`), the status of each teacher, the members of
 * each class and group; and the teachers' stored claims in every other branch
 * (`teacher_claims_elsewhere`, 0067: dated lessons not cancelled and exams,
 * moments and branch only) as busy elsewhere (decision 2). The other facts
 * (profiles, availability entries, subjects, rooms, travel times) are the
 * pattern's (`readPatternFacts`), which reads them whole.
 *
 * A Tutor row's lesson takes the class's Tutor of its date (`tutorAt`); a
 * Tutor other than the entry's teacher is checked as `followTutors` checks
 * one, by time and travel only (`checkTeacherTime`), and a clash, or no
 * Tutor, makes the lesson "needs a teacher" (decision 11).
 *
 * The version runs to the year's end: a publish before a later published
 * version is refused until 5.5a-3 (5.5a-1, decision 3).
 */
export async function datedCheck(
  transaction: Transaction,
  state: PatternState,
  startsOn: string,
  patternBlocked: readonly RuleResult[],
): Promise<DatedFindings> {
  const { model } = state.pattern;
  const { data } = model;
  const branchId = data.branchId;
  const lastDate = data.versionEnd;
  const branch = await transaction
    .selectFrom('branches')
    .select(['working_weekdays', 'time_zone'])
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const [settings, store] = await Promise.all([
    loadCalendarSettings(transaction, branch.working_weekdays),
    loadStore(transaction),
  ]);

  const rows = data.rows;
  const classIds = [...new Set(data.units.flatMap((unit) => unit.classIds))].sort();
  const groupIds = data.units.filter((unit) => unit.kind === 'group').map((unit) => unit.id);
  const teacherIds = data.teachers.map((one) => one.id);
  const [classMembers, groupMembers, statuses, tutorRows, dayStarts] = await Promise.all([
    classIds.length === 0
      ? Promise.resolve([] as MemberRow[])
      : transaction
          .selectFrom('class_memberships')
          .select([
            'class_id as unit_id',
            'student_id',
            sql<string>`valid_from::text`.as('valid_from'),
            sql<string>`valid_until::text`.as('valid_until'),
          ])
          .where('class_id', 'in', classIds)
          .where('valid_from', '<=', lastDate)
          .where('valid_until', '>', startsOn)
          .orderBy('student_id')
          .execute(),
    groupIds.length === 0
      ? Promise.resolve([] as MemberRow[])
      : transaction
          .selectFrom('group_memberships')
          .select([
            'group_id as unit_id',
            'student_id',
            sql<string>`valid_from::text`.as('valid_from'),
            sql<string>`valid_until::text`.as('valid_until'),
          ])
          .where('group_id', 'in', groupIds)
          .where('valid_from', '<=', lastDate)
          .where('valid_until', '>', startsOn)
          .orderBy('student_id')
          .execute(),
    teacherIds.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('staff_statuses')
          .select([
            'staff_id',
            'status',
            sql<string>`valid_from::text`.as('valid_from'),
            sql<string | null>`valid_until::text`.as('valid_until'),
          ])
          .where('staff_id', 'in', teacherIds)
          .execute(),
    readTutorRows(
      transaction,
      rows.flatMap((row) => (row.classId === null ? [] : [row.classId])),
    ),
    // The first moment of each date in branch time.
    sql<{ day: string; begins: Date }>`
      select d::date::text as day, (d::date::timestamp at time zone ${branch.time_zone}) as begins
      from generate_series(${startsOn}::date, ${lastDate}::date + 1, interval '1 day') d
    `.execute(transaction),
  ]);
  const beginsOf = new Map(dayStarts.rows.map((row) => [row.day, row.begins]));
  const begins = (date: string): Date => {
    const found = beginsOf.get(date);
    if (found === undefined) throw new Error(`No start of ${date}.`);
    return found;
  };

  const membersOn = (list: readonly MemberRow[]) => {
    const byUnit = new Map<string, MemberRow[]>();
    for (const row of list) {
      byUnit.set(row.unit_id, [...(byUnit.get(row.unit_id) ?? []), row]);
    }
    return (unitId: string, date: string): string[] =>
      (byUnit.get(unitId) ?? [])
        .filter((row) => row.valid_from <= date && date < row.valid_until)
        .map((row) => row.student_id);
  };
  const classOn = membersOn(classMembers);
  const groupOn = membersOn(groupMembers);
  const kindOf = new Map(data.units.map((unit) => [unit.id, unit.kind]));
  const studentsOn = (unitId: string, date: string) =>
    kindOf.get(unitId) === 'group' ? groupOn(unitId, date) : classOn(unitId, date);

  const datedDays = new Map<string, { engine: EngineDay; dated: DatedDay }>();
  const dayOfDate = (grade: number, date: string) => {
    const key = `${grade}|${date}`;
    const known = datedDays.get(key);
    if (known !== undefined) return known;
    const found = dayOn(grade, date, settings);
    let value: { engine: EngineDay; dated: DatedDay };
    if (!found.lessons) {
      value = { engine: { lessons: false, reason: found.reason }, dated: { lessons: false } };
    } else {
      const timed = dayOf(store, found.dayTemplateId, date);
      const noRegularLessons = found.examWeek === 'no_regular_lessons';
      value =
        timed === null
          ? { engine: { lessons: false, reason: 'no_template' }, dated: { lessons: false } }
          : {
              engine: { lessons: true, day: timed.day, noRegularLessons },
              dated: {
                lessons: true,
                day: timed.day,
                followsWeekday: found.followsWeekday,
                noRegularLessons,
              },
            };
    }
    datedDays.set(key, value);
    return value;
  };

  const weekly = new Map(data.days.map((one) => [`${one.grade}|${one.weekday}`, one.day]));
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  const subjects = new Map(data.subjects.map((subject) => [subject.id, subject]));
  const blocks: DatedBlock[] = state.blocks.map((block) => {
    const entries = block.lessons.map((lesson) => {
      const row = model.rowOf(lesson.loadRowId);
      const unit = model.unitOf(row.classId ?? row.groupId ?? '');
      return {
        id: lesson.id,
        loadRowId: row.id,
        classId: row.classId,
        groupId: row.groupId,
        classIds: unit.classIds,
        subjectId: row.subjectId,
        teacherId: row.teacherId,
        roomId: lesson.roomId,
        tutorRow: row.classId !== null && subjects.get(row.subjectId)?.tutorSubject === true,
      };
    });
    const grades = [
      ...new Set(
        entries.flatMap((entry) => units.get(entry.classId ?? entry.groupId ?? '')?.grades ?? []),
      ),
    ].sort((a, b) => a - b);
    return {
      id: block.id,
      weekday: block.weekday,
      start: block.start,
      end: block.end,
      doublePairId: block.doublePairId,
      grades,
      entries,
    };
  });

  const MINUTE = 60_000;
  const dated = datedPattern({
    branchId,
    firstDate: startsOn,
    lastDate,
    blocks,
    quarters: data.year.quarters,
    weeklyDay: (grade, weekday) => {
      const day = weekly.get(`${grade}|${weekday}`);
      return day?.lessons === true ? day.day : null;
    },
    dayOn: (grade, date) => dayOfDate(grade, date).dated,
    studentsOn,
    tutorOn: (classId, date, start) =>
      tutorAt(tutorRows.get(classId) ?? [], new Date(begins(date).getTime() + start * MINUTE)),
  });

  // Every other branch's claims of the teachers, on the branch's dates and minutes.
  const elsewhere = new Map<string, Placement[]>();
  const fixedBranches = new Map<string, string>();
  for (const busy of model.fixed) {
    fixedBranches.set(busy.id, busy.branchId);
  }
  const linked = data.teachers.filter((one) => one.branchIds.includes(branchId));
  const from = begins(startsOn);
  const until = begins(addDays(lastDate, 1));
  for (const teacher of linked) {
    const { rows: claims } = await sql<{
      branch_id: string;
      day: string;
      start_minutes: number;
      end_minutes: number;
    }>`
      select c.branch_id,
        (c.starts_at at time zone ${branch.time_zone})::date::text as day,
        (extract(epoch from (c.starts_at at time zone ${branch.time_zone})
          - (c.starts_at at time zone ${branch.time_zone})::date::timestamp) / 60)::int as start_minutes,
        (extract(epoch from (c.ends_at at time zone ${branch.time_zone})
          - (c.starts_at at time zone ${branch.time_zone})::date::timestamp) / 60)::int as end_minutes
      from teacher_claims_elsewhere(${branchId}::uuid, ${teacher.id}::uuid, ${from}::timestamptz, ${until}::timestamptz) c
      where c.branch_id <> ${branchId}::uuid
      order by c.starts_at, c.ends_at, c.branch_id
    `.execute(transaction);
    claims.forEach((claim, index) => {
      const id = `elsewhere:${teacher.id}:${claim.day}:${String(index)}`;
      fixedBranches.set(id, claim.branch_id);
      const list = elsewhere.get(claim.day) ?? [];
      list.push(busyPlacement(id, teacher.id, claim));
      elsewhere.set(claim.day, list);
    });
  }

  // The status of each teacher on each date (decision 10).
  const outOn = (teacherId: string, date: string) =>
    statuses.some(
      (row) =>
        row.staff_id === teacherId &&
        OUT_STATUSES.includes(row.status) &&
        row.valid_from <= date &&
        (row.valid_until === null || date < row.valid_until),
    );
  const teachersOn = (date: string): Map<string, EngineTeacher> =>
    new Map(
      data.teachers.map((one) => [
        one.id,
        { ...one, out: one.branchIds.includes(branchId) ? outOn(one.id, date) : one.out },
      ]),
    );

  const byDate = new Map<string, DatedLesson[]>();
  for (const lesson of dated.lessons) {
    byDate.set(lesson.date, [...(byDate.get(lesson.date) ?? []), lesson]);
  }
  const results: RuleResult[] = [];
  const tutorNeeds: NeedsTeacher[] = dated.noTutor.map((one) => ({
    ...one,
    reason: 'no_tutor',
  }));
  for (const [date, lessons] of byDate) {
    const facts: Facts = {
      ...model.facts,
      mode: 'dated',
      teachers: teachersOn(date),
      classStudents: (classId) => classOn(classId, date),
      dayOf: (_branch, grade) => dayOfDate(grade, date).engine,
      loadRows: [],
      otherDrafts: [],
    };
    const fixed = elsewhere.get(date) ?? [];
    // A Tutor other than the entry's teacher is checked by time and travel
    // only (decision 11); the rest of the date with every rule.
    const checked = lessons.map((lesson) =>
      lesson.tutorFollowed ? { ...lesson.placement, teacherIds: [] } : lesson.placement,
    );
    results.push(...checkTimetable([...checked, ...fixed], facts, { availabilityFrom: startsOn }));
    const others = [...lessons.map((lesson) => ({ ...lesson.placement, fixed: true })), ...fixed];
    for (const lesson of lessons.filter((one) => one.tutorFollowed)) {
      if (checkTeacherTime(others, lesson.placement, facts.travelMinutes).length > 0) {
        tutorNeeds.push({ date, entryId: lesson.entryId, reason: 'tutor_clash' });
      }
    }
  }

  const outOnStart = new Set(
    data.teachers.filter((one) => one.out || outOn(one.id, startsOn)).map((one) => one.id),
  );
  const sorted = datedPublishResults({
    patternBlocked,
    dated: results,
    lessons: new Map(dated.lessons.map((lesson) => [lesson.placement.id, lesson])),
    tutorNeeds,
    fixedBranch: (id) => fixedBranches.get(id) ?? null,
    followsOther: (date) =>
      blocks.some((block) =>
        block.grades.some((grade) => {
          const day = dayOfDate(grade, date).dated;
          return day.lessons && day.followsWeekday !== weekdayOf(date);
        }),
      ),
    outOnStart: (teacherId) => outOnStart.has(teacherId),
  });
  const answerOf = (result: RuleResult): RuleResultAnswer => {
    const own = new Set<string>();
    const branches = new Set<string>();
    for (const id of result.lessonIds) {
      const other = fixedBranches.get(id);
      if (other !== undefined) {
        branches.add(other);
      } else {
        own.add(patternIdOf(id)?.id ?? id);
      }
    }
    // Another branch is named by its branch only (decision 8).
    const [elsewhereBranch] = [...branches].sort();
    const detail = {
      ...result.detail,
      ...(elsewhereBranch === undefined ? {} : { branchId: elsewhereBranch }),
    };
    return {
      rule: result.rule,
      severity: result.severity,
      weekday: weekdaySchema.parse(weekdayOf(result.day)),
      lessonIds: [...own],
      ...(Object.keys(detail).length === 0 ? {} : { detail }),
      date: result.day,
    };
  };
  return {
    blocked: sorted.blocked.map(answerOf),
    warnings: sorted.warnings.map(answerOf),
    needsTeacher: [...sorted.needsTeacher],
    cancelled: dated.cancelled.flatMap((one) =>
      one.reason === 'exam_week'
        ? []
        : [{ date: one.date, reason: one.reason, entryIds: [...one.entryIds] }],
    ),
  };
}

/** A teacher's claim in another branch as a fixed placement (busy elsewhere). */
function busyPlacement(
  id: string,
  teacherId: string,
  claim: { branch_id: string; day: string; start_minutes: number; end_minutes: number },
): Placement {
  return {
    id,
    kind: 'lesson',
    branchId: claim.branch_id,
    day: claim.day,
    start: claim.start_minutes,
    end: claim.end_minutes,
    blockId: id,
    doublePairId: null,
    classId: null,
    groupId: null,
    classIds: [],
    studentIds: [],
    exemptStudentIds: [],
    subjectId: null,
    loadRowId: null,
    teacherIds: [teacherId],
    substitute: false,
    roomId: null,
    examRooms: [],
    fixed: true,
  };
}
