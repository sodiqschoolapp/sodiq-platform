import {
  addDays,
  checkTeacherTime,
  checkTimetable,
  datedId,
  datedPattern,
  datedPublishResults,
  patternIdOf,
  dayOn,
  tutorAt,
  weekdayOf,
  type DatedBlock,
  type DatedDay,
  type DatedGroupChoice,
  type DatedLesson,
  type DatedPattern,
  type EngineDay,
  type EngineTeacher,
  type Facts,
  type NeedsTeacher,
  type Placement,
  type RuleResult,
} from '@sodiq/timetable-rules';
import {
  calendarGroupChoiceSchema,
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
import { weeklyDaysOf, weeklyKey } from './version-days.js';

/** What the dated check of a publish found (task 5.5a-2a), as the answer names it. */
export interface DatedFindings {
  /** Blocked results only a date shows (`date_blocked`). */
  readonly blocked: RuleResultAnswer[];
  /** `teacher_unavailable_later` by date (decision 6). */
  readonly warnings: RuleResultAnswer[];
  readonly needsTeacher: NeedsTeacherAnswer[];
  readonly cancelled: CancelledLesson[];
  /** The lessons of the dates, for the impact preview (task 5.5a-2b-1). */
  readonly dated: DatedPattern;
  /** The first moment of each date in branch time, for the lessons written (task 5.5b-1). */
  readonly begins: (date: string) => Date;
  /**
   * The teacher of a lesson of a pattern block created cancelled on a date
   * (review of #152, finding 2): for a Tutor row, the class's Tutor of the
   * date at the block's start, `null` with none (edge/timetable, Structure:
   * "Their teacher is always the class's Tutor in force on the lesson's
   * date"); for any other row, the entry's teacher or vacancy.
   */
  readonly cancelledTeacher: (blockId: string, entryId: string, date: string) => string | null;
  /**
   * The facts each date was checked with, the other branches' claims of
   * that date and the members of a class or group on a date (task 5.6a-5a):
   * a stored one-day change applied again is checked with them.
   */
  readonly factsOn: (date: string) => Facts;
  readonly elsewhereOn: (date: string) => readonly Placement[];
  readonly studentsOn: (unitId: string, date: string) => string[];
  readonly timeZone: string;
}

/**
 * The first moment of each date from `firstDate` to `lastDate` in the time
 * zone, as a lookup that throws for a date outside them; the dated check, the
 * lessons written and the preview read stored moments with it (task 5.5b-2).
 */
export async function dayBeginnings(
  transaction: Transaction,
  timeZone: string,
  firstDate: string,
  lastDate: string,
): Promise<(date: string) => Date> {
  const { rows } = await sql<{ day: string; begins: Date }>`
    select d::date::text as day, (d::date::timestamp at time zone ${timeZone}) as begins
    from generate_series(${firstDate}::date, ${lastDate}::date, interval '1 day') d
  `.execute(transaction);
  const beginsOf = new Map(rows.map((row) => [row.day, row.begins]));
  return (date: string): Date => {
    const found = beginsOf.get(date);
    if (found === undefined) throw new Error(`No start of ${date}.`);
    return found;
  };
}

/** A dated row of a class or group, half-open. */
interface MemberRow {
  readonly unit_id: string;
  readonly student_id: string;
  readonly valid_from: string;
  readonly valid_until: string;
}

export const OUT_STATUSES = ['inactive', 'left', 'closed'];

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
 *
 * `outOnStart: false` (task 5.5c-2a, decision 5): a teacher out on the start
 * makes the lesson "needs a teacher", as on a later date, never a refusal; a
 * withdraw writes a published version, which cannot be edited.
 */
export async function datedCheck(
  transaction: Transaction,
  state: PatternState,
  startsOn: string,
  patternBlocked: readonly RuleResult[],
  options: { readonly outOnStart?: boolean } = {},
): Promise<DatedFindings> {
  const { model } = state.pattern;
  const { data } = model;
  const branchId = data.branchId;
  const lastDate = data.versionEnd;
  const { dated, begins, classOn, studentsOn, dayOfDate, branch, cancelledTeacher, alongsideOn } =
    await datedLessonsOf(transaction, state, startsOn, lastDate);
  const { outOn, teachersOn } = await teacherStatesOf(transaction, data.teachers, branchId);
  // Every other branch's claims of the teachers, on the branch's dates and minutes.
  const { elsewhere, fixedBranches } = await claimsElsewhere(transaction, {
    branchId,
    timeZone: branch.time_zone,
    teacherIds: data.teachers
      .filter((one) => one.branchIds.includes(branchId))
      .map((one) => one.id),
    from: begins(startsOn),
    until: begins(addDays(lastDate, 1)),
  });
  for (const busy of model.fixed) {
    fixedBranches.set(busy.id, busy.branchId);
  }

  const byDate = new Map<string, DatedLesson[]>();
  for (const lesson of dated.lessons) {
    byDate.set(lesson.date, [...(byDate.get(lesson.date) ?? []), lesson]);
  }
  const results: RuleResult[] = [];
  const tutorNeeds: NeedsTeacher[] = dated.noTutor.map((one) => ({
    ...one,
    reason: 'no_tutor',
  }));
  const factsOn = (date: string): Facts => ({
    ...model.facts,
    mode: 'dated',
    teachers: teachersOn(date),
    classStudents: (classId) => classOn(classId, date),
    dayOf: (_branch, grade) => dayOfDate(grade, date).engine,
    // Task 5.5b-1 (From 5.4c-3b): the rows, so that `checkBlocks` knows
    // one block of the load and a pairing by date too.
    loadRows: model.facts.loadRows,
    otherDrafts: [],
  });
  for (const [date, lessons] of byDate) {
    const facts = factsOn(date);
    const fixed = elsewhere.get(date) ?? [];
    // A Tutor other than the entry's teacher is checked by time and travel
    // only (decision 11); the rest of the date with every rule.
    const checked = lessons.map((lesson) =>
      lesson.tutorFollowed ? { ...lesson.placement, teacherIds: [] } : lesson.placement,
    );
    results.push(
      ...checkTimetable([...checked, ...alongsideOn(date), ...fixed], facts, {
        availabilityFrom: startsOn,
      }),
    );
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
    outOnStart: (teacherId) => options.outOnStart !== false && outOnStart.has(teacherId),
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
    dated,
    begins,
    cancelledTeacher,
    factsOn,
    elsewhereOn: (date) => elsewhere.get(date) ?? [],
    studentsOn,
    timeZone: branch.time_zone,
  };
}

/**
 * The lessons of a version's pattern from `firstDate` to `lastDate`
 * (`datedPattern`), with the facts of each date it read: the calendar and the
 * templates of the dates, the members of each class and group, the Tutors of
 * each class (task 5.5a-2a; the impact preview of task 5.5a-2b-1 expands the
 * earlier version with it), and the version's own choices of the lessons kept
 * on a shortened day (task 5.5a-2b-2, decision 9).
 */
export async function datedLessonsOf(
  transaction: Transaction,
  state: PatternState,
  startsOn: string,
  lastDate: string,
) {
  const { model } = state.pattern;
  const { data } = model;
  const branchId = data.branchId;
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
  const [classMembers, groupMembers, tutorRows, begins, classGrades, keeps, groupChoices] =
    await Promise.all([
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
      readTutorRows(
        transaction,
        rows.flatMap((row) => (row.classId === null ? [] : [row.classId])),
      ),
      dayBeginnings(transaction, branch.time_zone, startsOn, addDays(lastDate, 1)),
      classIds.length === 0
        ? Promise.resolve([] as { id: string; grade: number }[])
        : transaction
            .selectFrom('classes')
            .select(['id', 'grade'])
            .where('id', 'in', classIds)
            .execute(),
      readDayKeeps(transaction, state.version.id, startsOn, lastDate),
      readGroupChoices(transaction, startsOn, lastDate),
    ]);
  const gradeOfClass = new Map(classGrades.map((row) => [row.id, row.grade]));
  const keptOf = new Map<string, number[]>();
  for (const keep of keeps) {
    const key = `${keep.class_id}|${keep.kept_on}`;
    keptOf.set(key, [...(keptOf.get(key) ?? []), keep.slot_position]);
  }
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
      value = {
        engine: { lessons: false, reason: found.reason },
        // Task 5.6b-3: the day-off entry, whose choice decides a split group.
        dated:
          found.reason === 'day_off' && found.entryId !== null
            ? { lessons: false, dayOffEntryId: found.entryId }
            : { lessons: false },
      };
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

  // Task 5.6b-4a (decision 3): a block's lesson number is found by its weekly
  // times in the weekly days its version was published against, which the
  // pattern facts of a version no longer a draft carry (`readVersionDays`);
  // a draft, or a version published before 0091, has those of the templates
  // on its start.
  const weekly = weeklyDaysOf(state);
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
      slotPosition: block.slotPosition,
      start: block.start,
      end: block.end,
      doublePairId: block.doublePairId,
      grades,
      entries,
    };
  });

  const MINUTE = 60_000;
  const tutorOn = (classId: string, date: string, start: number) =>
    tutorAt(tutorRows.get(classId) ?? [], new Date(begins(date).getTime() + start * MINUTE));
  const entryOf = new Map(
    blocks.flatMap((block) =>
      block.entries.map((entry) => [`${block.id}|${entry.id}`, { block, entry }] as const),
    ),
  );
  const cancelledTeacher = (blockId: string, entryId: string, date: string): string | null => {
    const found = entryOf.get(`${blockId}|${entryId}`);
    if (found === undefined) throw new Error(`No entry ${entryId} in block ${blockId}.`);
    const { block, entry } = found;
    return entry.tutorRow && entry.classId !== null
      ? tutorOn(entry.classId, date, block.start)
      : entry.teacherId;
  };
  const dated = datedPattern({
    branchId,
    firstDate: startsOn,
    lastDate,
    blocks,
    quarters: data.year.quarters,
    weeklyDay: (grade, weekday) => weekly.get(weeklyKey(grade, weekday)) ?? null,
    dayOn: (grade, date) => dayOfDate(grade, date).dated,
    studentsOn,
    tutorOn,
    gradeOf: (classId) => {
      const grade = gradeOfClass.get(classId);
      if (grade === undefined) throw new Error(`No grade of class ${classId}.`);
      return grade;
    },
    keptOn: (classId, date) => keptOf.get(`${classId}|${date}`) ?? null,
    groupChoiceOn: (entryId, date, groups, start) =>
      groupChoices.get(groupChoiceKey(entryId, date, groups, start)) ?? null,
  });

  // Task 5.6b-3 (code review round 1): the parts of a kept block cancelled
  // "day off" (a group of the grade that is off alone) go with the block's
  // held lessons into the check, as the cancelled parts of a one-day change
  // do (`alongside` of `storedDayCheck`): no teacher, room, grade or
  // student, their students exempt, so the block is still whole.
  const heldBlocks = new Map(
    dated.lessons.map((lesson) => [lesson.placement.blockId, lesson.placement] as const),
  );
  const alongside = new Map<string, Placement[]>();
  for (const one of dated.cancelled) {
    const held = heldBlocks.get(datedId(one.blockId, one.date));
    if (one.reason !== 'day_off' || held === undefined) continue;
    const found = blocks.find((block) => block.id === one.blockId);
    for (const entry of found?.entries.filter((own) => one.entryIds.includes(own.id)) ?? []) {
      const list = alongside.get(one.date) ?? [];
      list.push({
        id: datedId(entry.id, one.date),
        kind: 'lesson',
        branchId,
        day: one.date,
        start: held.start,
        end: held.end,
        blockId: datedId(one.blockId, one.date),
        doublePairId: null,
        classId: null,
        groupId: null,
        classIds: [],
        studentIds: [],
        exemptStudentIds: studentsOn(entry.classId ?? entry.groupId ?? '', one.date),
        subjectId: null,
        loadRowId: entry.loadRowId,
        teacherIds: [],
        substitute: false,
        roomId: null,
        examRooms: [],
        fixed: false,
      });
      alongside.set(one.date, list);
    }
  }

  return {
    dated,
    begins,
    classOn,
    studentsOn,
    tutorOn,
    dayOfDate,
    branch,
    cancelledTeacher,
    alongsideOn: (date: string): readonly Placement[] => alongside.get(date) ?? [],
  };
}

/** The stored choices of the lessons kept on a shortened day of a version between two dates (task 5.5a-2b-2). */
export function readDayKeeps(
  transaction: Transaction,
  versionId: string,
  firstDate: string,
  lastDate: string,
) {
  return transaction
    .selectFrom('timetable_day_keeps')
    .select(['class_id', sql<string>`kept_on::text`.as('kept_on'), 'slot_position'])
    .where('version_id', '=', versionId)
    .where('kept_on', '>=', firstDate)
    .where('kept_on', '<=', lastDate)
    .orderBy('class_id')
    .orderBy('kept_on')
    .orderBy('slot_position')
    .execute();
}

/** The key of a split group's block on a date (task 5.6b-3): entry, date, weekly start, groups sorted. */
export const groupChoiceKey = (
  entryId: string,
  date: string,
  groupIds: readonly string[],
  start: number,
) => [entryId, date, String(start), ...[...groupIds].sort()].join('|');

/**
 * The stored choices of day-off entries for blocks of two-grade groups
 * between two dates (task 5.6b-3), by `groupChoiceKey`. A row's groups are
 * read with it, so a block is matched by its whole group set.
 */
export async function readGroupChoices(
  transaction: Transaction,
  firstDate: string,
  lastDate: string,
): Promise<Map<string, DatedGroupChoice>> {
  const rows = await transaction
    .selectFrom('calendar_group_blocks as b')
    .innerJoin('calendar_group_block_groups as g', 'g.block_id', 'b.id')
    .select([
      'b.id',
      'b.calendar_entry_id',
      sql<string>`b.lesson_date::text`.as('lesson_date'),
      'b.start_minutes',
      'b.choice',
      'g.group_id',
    ])
    .where('b.lesson_date', '>=', firstDate)
    .where('b.lesson_date', '<=', lastDate)
    .orderBy('b.id')
    .orderBy('g.group_id')
    .execute();
  const byBlock = new Map<string, { row: (typeof rows)[number]; groups: string[] }>();
  for (const row of rows) {
    const known = byBlock.get(row.id);
    if (known === undefined) byBlock.set(row.id, { row, groups: [row.group_id] });
    else known.groups.push(row.group_id);
  }
  return new Map(
    [...byBlock.values()].map(({ row, groups }) => [
      groupChoiceKey(row.calendar_entry_id, row.lesson_date, groups, row.start_minutes),
      calendarGroupChoiceSchema.parse(row.choice),
    ]),
  );
}

/**
 * The status of each teacher on a date (decision 10 of 5.5a-2a): `outOn`,
 * and the teachers with `out` set on that date for one of the branch;
 * another branch's teacher keeps the `out` it was read with. Shared by the
 * publish's check and the stored-day check of a one-day change (task 5.6a-1).
 */
export async function teacherStatesOf(
  transaction: Transaction,
  teachers: readonly EngineTeacher[],
  branchId: string,
) {
  const teacherIds = teachers.map((one) => one.id);
  const statuses =
    teacherIds.length === 0
      ? []
      : await transaction
          .selectFrom('staff_statuses')
          .select([
            'staff_id',
            'status',
            sql<string>`valid_from::text`.as('valid_from'),
            sql<string | null>`valid_until::text`.as('valid_until'),
          ])
          .where('staff_id', 'in', teacherIds)
          .execute();
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
      teachers.map((one) => [
        one.id,
        { ...one, out: one.branchIds.includes(branchId) ? outOn(one.id, date) : one.out },
      ]),
    );
  return { outOn, teachersOn };
}

/**
 * The claims of the teachers in every other branch from `from` to `until`
 * (`teacher_claims_elsewhere`, 0067: dated lessons not cancelled and exams,
 * moments and branch only), as fixed placements by the branch's date, with
 * the branch of each (busy elsewhere, decision 2 of 5.5a-2a).
 */
export async function claimsElsewhere(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly timeZone: string;
    readonly teacherIds: readonly string[];
    readonly from: Date;
    readonly until: Date;
  },
) {
  const elsewhere = new Map<string, Placement[]>();
  const fixedBranches = new Map<string, string>();
  for (const teacherId of input.teacherIds) {
    const { rows: claims } = await sql<{
      branch_id: string;
      day: string;
      start_minutes: number;
      end_minutes: number;
    }>`
      select c.branch_id,
        (c.starts_at at time zone ${input.timeZone})::date::text as day,
        (extract(epoch from (c.starts_at at time zone ${input.timeZone})
          - (c.starts_at at time zone ${input.timeZone})::date::timestamp) / 60)::int as start_minutes,
        (extract(epoch from (c.ends_at at time zone ${input.timeZone})
          - (c.starts_at at time zone ${input.timeZone})::date::timestamp) / 60)::int as end_minutes
      from teacher_claims_elsewhere(${input.branchId}::uuid, ${teacherId}::uuid, ${input.from}::timestamptz, ${input.until}::timestamptz) c
      where c.branch_id <> ${input.branchId}::uuid
      order by c.starts_at, c.ends_at, c.branch_id
    `.execute(transaction);
    claims.forEach((claim, index) => {
      const id = `elsewhere:${teacherId}:${claim.day}:${String(index)}`;
      fixedBranches.set(id, claim.branch_id);
      const list = elsewhere.get(claim.day) ?? [];
      list.push(busyPlacement(id, teacherId, claim));
      elsewhere.set(claim.day, list);
    });
  }
  return { elsewhere, fixedBranches };
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
