import {
  checkCandidates,
  patternIdOf,
  type EngineDay,
  type EngineUnit,
  type PatternBlock,
  type Placement,
  type RuleResult,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { DatedFindings } from './dated-check.js';

/**
 * The exams standing on the dates a calendar save writes (task 5.6b-2c-1;
 * `edge/timetable`, Exams: "An exam room is closed, an invigilator falls ill,
 * the date becomes a day off. ... a day off removes the exam and tells the
 * Academic Vice Principal. ... A special template for its date moves the exam
 * with its slots and rechecks it; one that drops a slot of the exam is refused
 * and lists the exam, so the Academic Vice Principal changes the exam first.
 * In an exam week with 'no regular lessons' the lessons are already cancelled
 * and stay so whatever happens to the exam"; `06`, Exam: "It replaces the
 * regular lessons of its classes in its slots: those not already cancelled are
 * cancelled with the reason 'exam' in the same save, both halves of a double
 * lesson together, and cancelling the exam restores only the lessons it
 * cancelled").
 *
 * Each exam is sorted by the day after the save of the grades of its sitting
 * classes (`sortExams`, decisions 2 and 8): cancelled for a day off, refused
 * when its classes are on two templates or the day drops one of its slots,
 * else moved with its slots or kept. Its lessons are decided by
 * `examLessonsOf` over the lessons of its date, once on the findings (the
 * preview and the refusals) and once on the lessons written (the write):
 * a sitting group's own lessons and a sitting class's blocks of its own are
 * cancelled "exam"; a block shared with classes that do not sit keeps the
 * stored choice for that exam and class (an out row: kept for the others; a
 * lesson cancelled "exam": the whole block cancelled), or takes the save's
 * (decision 5). A lesson cancelled "exam" that no standing exam covers after
 * the save is held again (decision 2).
 *
 * The write (`ExamWrite`) runs inside the deferred span of
 * `writeDatedLessons`: the claims of 0058 are deferrable, initially
 * immediate, and an exam's new claims meet the lessons of its date before
 * they are written again (spec review of the plan, must-fix 1).
 */

/** An exam standing on a date written, with what the save reads of it. */
export interface StandingExam {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly firstSlot: number;
  readonly lastSlot: number;
  /** The classes that sit whole. */
  readonly classIds: readonly string[];
  /** The groups that sit in their own lessons, with their classes. */
  readonly groups: ReadonlyMap<string, readonly string[]>;
  /** The grades whose day decides the exam: its classes' and its groups' classes'. */
  readonly grades: readonly number[];
  /** Each of those classes as the rule engine names a class, for one the version has no row of. */
  readonly classUnits: readonly EngineUnit[];
  readonly roomIds: readonly string[];
  readonly invigilatorIds: readonly string[];
  /** The classes kept out of blocks (`lesson_block_class_outs`). */
  readonly outs: readonly { readonly blockId: string; readonly classId: string }[];
}

/**
 * Task 5.6c-3a: `dropped`, an exam a publish or a withdraw cancels by a
 * "needs a decision" choice (decision 5: the cause `cancelled`).
 */
export type ExamOutcome = 'cancelled_day_off' | 'dropped' | 'moved' | 'kept' | 'refused';
export type ExamRefusal = 'calendar_exam_slots' | 'calendar_exam_templates';
export type ExamBlockChoice = 'cancel' | 'keep';

/** An exam as the save leaves it. */
export interface SortedExam {
  readonly exam: StandingExam;
  outcome: ExamOutcome;
  code: ExamRefusal | null;
  /** Minutes of its date, before the save. */
  readonly before: { readonly start: number; readonly end: number };
  /** Minutes of its date after the save; `null` when cancelled or refused. */
  after: { readonly start: number; readonly end: number } | null;
}

const MINUTE = 60_000;

/** An id no lesson has, for an `in` over an empty list. */
const NO_LESSON = '00000000-0000-0000-0000-000000000000';

/**
 * The exams standing on `dates`, each locked as `exam_claims` locks it
 * first, in the order of their id.
 */
export async function standingExamsOn(
  transaction: Transaction,
  branchId: string,
  dates: readonly string[],
): Promise<StandingExam[]> {
  if (dates.length === 0) return [];
  const exams = await transaction
    .selectFrom('exams')
    .select([
      'id',
      'title',
      sql<string>`exam_date::text`.as('exam_date'),
      'starts_at',
      'ends_at',
      'first_slot',
      'last_slot',
    ])
    .where('branch_id', '=', branchId)
    .where('exam_date', 'in', [...dates])
    .where('cancel_cause', 'is', null)
    .orderBy('id')
    .forUpdate()
    .execute();
  if (exams.length === 0) return [];
  const ids = exams.map((one) => one.id);
  const seats = await transaction
    .selectFrom('exam_room_classes')
    .select(['exam_id', 'class_id', 'group_id'])
    .where('exam_id', 'in', ids)
    .execute();
  const rooms = await transaction
    .selectFrom('exam_rooms')
    .select(['exam_id', 'room_id'])
    .where('exam_id', 'in', ids)
    .execute();
  const invigilators = await transaction
    .selectFrom('exam_invigilators')
    .select(['exam_id', 'staff_id'])
    .where('exam_id', 'in', ids)
    .execute();
  const outs = await transaction
    .selectFrom('lesson_block_class_outs')
    .select(['exam_id', 'block_id', 'class_id'])
    .where('exam_id', 'in', ids)
    .orderBy('block_id')
    .orderBy('class_id')
    .execute();
  const groupIds = [
    ...new Set(seats.flatMap((one) => (one.group_id === null ? [] : [one.group_id]))),
  ];
  const groupClasses =
    groupIds.length === 0
      ? []
      : await transaction
          .selectFrom('group_classes')
          .select(['group_id', 'class_id'])
          .where('group_id', 'in', groupIds)
          .execute();
  const classIds = [
    ...new Set([
      ...seats.flatMap((one) => (one.class_id === null ? [] : [one.class_id])),
      ...groupClasses.map((one) => one.class_id),
    ]),
  ];
  const grades = new Map(
    (classIds.length === 0
      ? []
      : await transaction
          .selectFrom('classes')
          .select(['id', 'grade', 'language'])
          .where('id', 'in', classIds)
          .execute()
    ).map((one) => [one.id, one]),
  );
  return exams.map((exam) => {
    const own = seats.filter((one) => one.exam_id === exam.id);
    const sitting = own.flatMap((one) => (one.class_id === null ? [] : [one.class_id])).sort();
    const groups = new Map(
      own
        .flatMap((one) => (one.group_id === null ? [] : [one.group_id]))
        .sort()
        .map((groupId) => [
          groupId,
          groupClasses
            .filter((one) => one.group_id === groupId)
            .map((one) => one.class_id)
            .sort(),
        ]),
    );
    const deciding = [...sitting, ...[...groups.values()].flat()];
    return {
      id: exam.id,
      title: exam.title,
      date: exam.exam_date,
      startsAt: exam.starts_at,
      endsAt: exam.ends_at,
      firstSlot: exam.first_slot,
      lastSlot: exam.last_slot,
      classIds: sitting,
      groups,
      grades: [
        ...new Set(
          deciding.flatMap((id) => {
            const found = grades.get(id);
            return found === undefined ? [] : [found.grade];
          }),
        ),
      ].sort((a, b) => a - b),
      classUnits: [...new Set(deciding)].flatMap((id): EngineUnit[] => {
        const found = grades.get(id);
        return found === undefined
          ? []
          : [
              {
                id,
                kind: 'class',
                grades: [found.grade],
                language: found.language,
                tutorOnStart: null,
              },
            ];
      }),
      roomIds: [
        ...new Set(rooms.filter((one) => one.exam_id === exam.id).map((one) => one.room_id)),
      ],
      invigilatorIds: [
        ...new Set(
          invigilators.filter((one) => one.exam_id === exam.id).map((one) => one.staff_id),
        ),
      ],
      outs: outs
        .filter((one) => one.exam_id === exam.id)
        .map((one) => ({ blockId: one.block_id, classId: one.class_id })),
    };
  });
}

/** The times of a day's slots, to tell two templates apart by what they give (decision 8). */
const dayKeyOf = (day: EngineDay): string =>
  day.lessons
    ? day.day.slots
        .map((slot) => `${slot.kind}:${String(slot.start)}-${String(slot.end)}`)
        .join(',')
    : `none:${day.reason}`;

/**
 * Each exam by the day after the save of its grades (decisions 2 and 8): a
 * grade off for a day off or a working day taken back cancels it; two
 * templates refuse it `calendar_exam_templates`; a day with no lesson slot at
 * `first_slot` or `last_slot` (positions of the day's slots, as a pattern
 * block's `slot_position`) refuses it `calendar_exam_slots`; else it runs
 * from the start of its first slot to the end of its last, moved when that
 * differs from its stored time.
 */
export function sortExams(
  exams: readonly StandingExam[],
  findings: DatedFindings,
  branchId: string,
): SortedExam[] {
  return exams.map((exam): SortedExam => {
    const begins = findings.begins(exam.date).getTime();
    const before = {
      start: Math.round((exam.startsAt.getTime() - begins) / MINUTE),
      end: Math.round((exam.endsAt.getTime() - begins) / MINUTE),
    };
    const facts = findings.factsOn(exam.date);
    const days = exam.grades.map((grade) => facts.dayOf(branchId, grade, exam.date));
    const refused = (code: ExamRefusal): SortedExam => ({
      exam,
      outcome: 'refused',
      code,
      before,
      after: null,
    });
    if (days.some((day) => !day.lessons && day.reason !== 'no_template')) {
      return {
        exam,
        outcome: 'cancelled_day_off',
        code: null,
        before,
        after: null,
      };
    }
    if (new Set(days.map(dayKeyOf)).size > 1) return refused('calendar_exam_templates');
    const [day] = days;
    if (day === undefined || !day.lessons) return refused('calendar_exam_slots');
    const slotAt = (position: number) =>
      day.day.slots.find((slot) => slot.position === position && slot.kind === 'lesson');
    const first = slotAt(exam.firstSlot);
    const last = slotAt(exam.lastSlot);
    if (first === undefined || last === undefined) return refused('calendar_exam_slots');
    const after = { start: first.start, end: last.end };
    const moved = after.start !== before.start || after.end !== before.end;
    return {
      exam,
      outcome: moved ? 'moved' : 'kept',
      code: null,
      before,
      after,
    };
  });
}

/** A lesson of a date as `examLessonsOf` reads it: from the findings or as written. */
export interface ExamDayLesson {
  readonly id: string;
  readonly blockId: string;
  /** The pattern block it comes from: the same over the rewrite of its date. */
  readonly patternBlockId: string;
  readonly doublePairId: string | null;
  readonly start: number;
  readonly end: number;
  readonly classId: string | null;
  readonly groupId: string | null;
  /** The classes it occupies: the class, or the group's classes. */
  readonly classIds: readonly string[];
  readonly cancelCause: string | null;
  /** Task 5.6c-3a: its pattern entry, by which a publish's cancel names it (`examLessonKeyOf`). */
  readonly entryId?: string | null;
}

/**
 * Task 5.6c-3a: a lesson of a date named by its pattern entry, date and first
 * minute: the same before and after a publish writes it, and never two
 * lessons (a class or group is in one place at a time; `.claude/rules/timetable.md`,
 * a lesson moved onto a date of its own entry).
 */
export const examLessonKeyOf = (entryId: string, date: string, start: number): string =>
  `${entryId}@${date}@${String(start)}`;

/**
 * A shared block of a sitting class under an exam, with its double partner
 * (both halves of a double lesson together, `06`, Exam): its pattern blocks,
 * which a stored choice is read by, and its first minute after the save,
 * which a choice sent with the save names.
 */
export interface ExamSharedBlock {
  readonly patternBlockIds: readonly string[];
  readonly start: number;
}

/** The choice for a sitting class and a shared block under an exam, `null` when none. */
export type ExamChoiceOf = (classId: string, block: ExamSharedBlock) => ExamBlockChoice | null;

/** What a standing exam does to the lessons of its date. */
export interface ExamLessons {
  /** The lessons under the exam: cancelled "exam" by it (those not cancelled are written so). */
  readonly covered: ReadonlySet<string>;
  /** The classes kept out of a shared block for the exam, by block. */
  readonly outs: readonly { readonly blockId: string; readonly classId: string }[];
  /** The shared blocks of a sitting class with no choice, with their lessons. */
  readonly needs: readonly {
    readonly classId: string;
    readonly start: number;
    readonly lessons: readonly ExamDayLesson[];
  }[];
  /** The choices taken, per sitting class and shared block. */
  readonly chosen: readonly {
    readonly classId: string;
    readonly start: number;
    readonly choice: ExamBlockChoice;
  }[];
  /**
   * A sitting group whose own lessons are not one block (or a double pair)
   * at the exam's time, or whose double has a half outside it.
   */
  readonly groupMisses: boolean;
}

const overlaps = (lesson: ExamDayLesson, time: { start: number; end: number }) =>
  lesson.start < time.end && time.start < lesson.end;

/** The blocks of `blockIds` with their double partners, as groups of blocks. */
function withPartners(blockIds: readonly string[], lessons: readonly ExamDayLesson[]): string[][] {
  const units: string[][] = [];
  const seen = new Set<string>();
  for (const blockId of [...blockIds].sort()) {
    if (seen.has(blockId)) continue;
    const pair = lessons.find((one) => one.blockId === blockId)?.doublePairId ?? null;
    const unit =
      pair === null
        ? [blockId]
        : [
            ...new Set(
              lessons.filter((one) => one.doublePairId === pair).map((one) => one.blockId),
            ),
          ].sort();
    for (const id of unit) seen.add(id);
    units.push(unit);
  }
  return units;
}

/**
 * The lessons a standing exam covers on its date (`06`, Exam; `edge/timetable`,
 * Exams, "10 Brown sits the exam, but its lesson in slot 3 is a block shared
 * with classes that do not sit" and "A group sits an exam"): a sitting group's
 * own lessons at its time, which must be one block or the two of a double pair
 * at exactly its time, with no half of a double outside it (review correction
 * 1), the other groups of that block kept (correction 2); each block of a
 * sitting class at its time with its double partner (both halves together),
 * whole when every class of it sits, else by `choiceOf` for the class and
 * that block: `cancel` the whole block, `keep` it with the class out, `null`
 * none yet. The lessons of a sitting group are left to the group's rule.
 */
export function examLessonsOf(
  exam: StandingExam,
  time: { readonly start: number; readonly end: number },
  lessons: readonly ExamDayLesson[],
  choiceOf: ExamChoiceOf,
): ExamLessons {
  const covered = new Set<string>();
  const outs: { blockId: string; classId: string }[] = [];
  const needs: { classId: string; start: number; lessons: ExamDayLesson[] }[] = [];
  const chosen: { classId: string; start: number; choice: ExamBlockChoice }[] = [];
  let groupMisses = false;
  const byBlock = new Map<string, ExamDayLesson[]>();
  for (const lesson of lessons) {
    byBlock.set(lesson.blockId, [...(byBlock.get(lesson.blockId) ?? []), lesson]);
  }
  for (const groupId of exam.groups.keys()) {
    // A lesson cancelled "exam week" is the group's lesson all the same
    // (0060, `exam_group_problem`); it stays so (spec review of the code, must-fix 5).
    const ownAll = lessons.filter((one) => one.groupId === groupId);
    const own = ownAll.filter((one) => overlaps(one, time));
    const blocks = [...new Set(own.map((one) => one.blockId))];
    const pairs = new Set(own.map((one) => one.doublePairId));
    const start = Math.min(...own.map((one) => one.start));
    const end = Math.max(...own.map((one) => one.end));
    // A half of a double of the group outside the exam (0060, `exam_group_problem`).
    const halfOutside = ownAll.some(
      (one) => one.doublePairId !== null && pairs.has(one.doublePairId) && !overlaps(one, time),
    );
    const fits =
      own.length > 0 &&
      !halfOutside &&
      start === time.start &&
      end === time.end &&
      (blocks.length === 1 || (blocks.length === 2 && pairs.size === 1 && !pairs.has(null)));
    if (!fits) groupMisses = true;
    for (const one of own) covered.add(one.id);
  }
  const sitting = new Set(exam.classIds);
  for (const classId of exam.classIds) {
    const holds = (one: ExamDayLesson) =>
      one.classIds.includes(classId) && (one.groupId === null || !exam.groups.has(one.groupId));
    const blockIds = [
      ...new Set(
        lessons.filter((one) => holds(one) && overlaps(one, time)).map((one) => one.blockId),
      ),
    ];
    for (const unit of withPartners(blockIds, lessons)) {
      const block = unit.flatMap((id) => byBlock.get(id) ?? []);
      const shared = block.some((one) => one.classIds.some((id) => !sitting.has(id)));
      if (!shared) {
        for (const one of block) covered.add(one.id);
        continue;
      }
      const start = Math.min(...block.map((one) => one.start));
      const choice = choiceOf(classId, {
        patternBlockIds: [...new Set(block.map((one) => one.patternBlockId))].sort(),
        start,
      });
      if (choice === null) {
        needs.push({ classId, start, lessons: block });
        continue;
      }
      chosen.push({ classId, start, choice });
      if (choice === 'keep') {
        for (const blockId of unit) {
          if ((byBlock.get(blockId) ?? []).some(holds)) outs.push({ blockId, classId });
        }
      } else {
        for (const one of block) covered.add(one.id);
      }
    }
  }
  return { covered, outs, needs, chosen, groupMisses };
}

/**
 * The stored choices of an exam's sitting classes for the shared blocks at
 * its stored time, by class and pattern block (decisions 5 and 11; spec
 * review of the code, must-fix 6: "For each [block], the Academic Vice
 * Principal chooses"): `keep` for a block the class is kept out of, `cancel`
 * for a shared block cancelled "exam"; none for a block not under it before.
 * Keyed `<class>|<pattern block>`.
 */
export function storedChoicesOf(
  exam: StandingExam,
  before: { readonly start: number; readonly end: number },
  lessons: readonly ExamDayLesson[],
): Map<string, ExamBlockChoice> {
  const choices = new Map<string, ExamBlockChoice>();
  const patternOf = new Map(lessons.map((one) => [one.blockId, one.patternBlockId]));
  for (const out of exam.outs) {
    const pattern = patternOf.get(out.blockId);
    if (pattern !== undefined) choices.set(`${out.classId}|${pattern}`, 'keep');
  }
  const sitting = new Set(exam.classIds);
  for (const classId of exam.classIds) {
    const blockIds = [
      ...new Set(
        lessons
          .filter((one) => one.classIds.includes(classId) && overlaps(one, before))
          .map((one) => one.blockId),
      ),
    ];
    for (const unit of withPartners(blockIds, lessons)) {
      const block = lessons.filter((one) => unit.includes(one.blockId));
      const shared = block.some((one) => one.classIds.some((id) => !sitting.has(id)));
      if (!shared || !block.some((one) => one.cancelCause === 'exam')) continue;
      for (const one of block) {
        const key = `${classId}|${one.patternBlockId}`;
        if (!choices.has(key)) choices.set(key, 'cancel');
      }
    }
  }
  return choices;
}

/** The lessons of `findings` on a date, as `examLessonsOf` reads them. */
export function findingsLessonsOn(findings: DatedFindings, date: string): ExamDayLesson[] {
  return findings.dated.lessons
    .filter((one) => one.date === date)
    .map((one) => {
      const blockId = one.placement.blockId ?? one.placement.id;
      return {
        id: one.placement.id,
        blockId,
        patternBlockId: patternIdOf(blockId)?.id ?? blockId,
        doublePairId: one.placement.doublePairId,
        start: one.placement.start,
        end: one.placement.end,
        classId: one.placement.classId,
        groupId: one.placement.groupId,
        classIds: one.placement.classIds,
        cancelCause: null,
        entryId: one.entryId,
      };
    });
}

/**
 * The group lessons of a date that the write creates cancelled "exam week"
 * (an exam week with "no regular lessons"), at their pattern block's times as
 * the write creates them (`dated-lessons.ts`, decision 6 of 5.5b-1): the
 * findings leave them out, and a sitting group's rule reads them (spec review
 * of the code, must-fix 5). No classes: they take no part in a class's rule.
 */
export function examWeekLessonsOn(
  findings: DatedFindings,
  blocks: readonly PatternBlock[],
  groupOf: (loadRowId: string) => string | null,
  date: string,
): ExamDayLesson[] {
  const byId = new Map(blocks.map((one) => [one.id, one]));
  return findings.dated.cancelled
    .filter((one) => one.date === date && one.reason === 'exam_week')
    .flatMap((one) => {
      const block = byId.get(one.blockId);
      if (block === undefined) return [];
      return block.lessons.flatMap((lesson): ExamDayLesson[] => {
        const groupId = groupOf(lesson.loadRowId);
        return groupId === null
          ? []
          : [
              {
                id: `${lesson.id}@${date}`,
                blockId: `${block.id}@${date}`,
                patternBlockId: block.id,
                doublePairId: block.doublePairId === null ? null : `${block.doublePairId}@${date}`,
                start: block.start,
                end: block.end,
                classId: null,
                groupId,
                classIds: [],
                cancelCause: 'exam_week',
              },
            ];
      });
    });
}

/** The stored lessons of a date, their minutes from `begins`, with the classes of their groups. */
export async function storedExamLessonsOn(
  transaction: Transaction,
  branchId: string,
  date: string,
  begins: Date,
): Promise<ExamDayLesson[]> {
  const rows = await transaction
    .selectFrom('lessons')
    .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
    .select([
      'lessons.id',
      'lessons.block_id',
      'lesson_blocks.pattern_block_id',
      'lesson_blocks.double_pair_id',
      'lessons.starts_at',
      'lessons.ends_at',
      'lessons.class_id',
      'lessons.group_id',
      'lessons.cancel_cause',
      'lessons.pattern_entry_id',
    ])
    .where('lessons.branch_id', '=', branchId)
    .where('lessons.lesson_date', '=', date)
    .orderBy('lessons.id')
    .execute();
  const groupIds = [
    ...new Set(rows.flatMap((one) => (one.group_id === null ? [] : [one.group_id]))),
  ];
  const groupClasses =
    groupIds.length === 0
      ? []
      : await transaction
          .selectFrom('group_classes')
          .select(['group_id', 'class_id'])
          .where('group_id', 'in', groupIds)
          .execute();
  const minutesOf = (moment: Date) => Math.round((moment.getTime() - begins.getTime()) / MINUTE);
  return rows.map((row) => ({
    id: row.id,
    blockId: row.block_id,
    patternBlockId: row.pattern_block_id,
    doublePairId: row.double_pair_id,
    start: minutesOf(row.starts_at),
    end: minutesOf(row.ends_at),
    classId: row.class_id,
    groupId: row.group_id,
    classIds:
      row.class_id !== null
        ? [row.class_id]
        : groupClasses.filter((one) => one.group_id === row.group_id).map((one) => one.class_id),
    cancelCause: row.cancel_cause,
    entryId: row.pattern_entry_id,
  }));
}

/**
 * The exam as a placement of the rule engine at a time (task 5.2: kind
 * `exam`), its invigilators, rooms and classes, so that its recheck meets an
 * invigilator's lesson, a room's and a class's (`06`, Exam: "over that time it
 * is checked as a lesson is for its invigilators, rooms and classes").
 */
export function examPlacementOf(
  exam: StandingExam,
  branchId: string,
  time: { readonly start: number; readonly end: number },
  /**
   * The exam's subject and the students of each room, for the warnings of
   * the exam save (task 5.6c-1, spec review of the plan must-fix 6:
   * `invigilator_subject`, `room_capacity`); the calendar path keeps only
   * blocked results and passes none.
   */
  warned: {
    readonly subjectId: string | null;
    readonly students: ReadonlyMap<string, number>;
  } = { subjectId: null, students: new Map() },
): Placement {
  return {
    id: `exam:${exam.id}`,
    kind: 'exam',
    branchId,
    day: exam.date,
    start: time.start,
    end: time.end,
    blockId: null,
    doublePairId: null,
    classId: null,
    groupId: null,
    // A sitting group holds its classes through its own block, which the
    // exam replaces; the other groups of the block keep theirs (`06`, Exam).
    classIds: [...exam.classIds],
    studentIds: [],
    exemptStudentIds: [],
    subjectId: warned.subjectId,
    loadRowId: null,
    teacherIds: [...exam.invigilatorIds],
    substitute: false,
    roomId: null,
    examRooms: exam.roomIds.map((roomId) => ({
      roomId,
      students: warned.students.get(roomId) ?? 0,
    })),
    fixed: false,
  };
}

/**
 * Task 5.6b-2c-1: the branch's exams of a date as a save leaves them: a moved
 * or kept one at its time after the save, a refused one at its stored time,
 * none for one cancelled (task 5.6c-3a: or dropped).
 */
export function examPlacementsOn(
  sorted: readonly SortedExam[],
  branchId: string,
  date: string,
): Placement[] {
  return sorted
    .filter(
      (one) =>
        one.exam.date === date && one.outcome !== 'cancelled_day_off' && one.outcome !== 'dropped',
    )
    .map((one) => examPlacementOf(one.exam, branchId, one.after ?? one.before));
}

/**
 * The blocked results of a moved or kept exam on its date (decision 9): the
 * engine's check of the exam against the lessons of the date after the save
 * but those it covers (`skipped`: cancelled "exam" by it, or a block still
 * waiting for its choice), with a class kept out of a block taken out of it
 * (`outs`): the block stays held for the other classes, so its teacher and
 * room are checked against the exam's invigilators and rooms (spec review of
 * the code, must-fix 4); the other branches' claims and the branch's other
 * exams; warnings move nothing.
 */
export function examBlocked(
  sorted: SortedExam,
  branchId: string,
  findings: DatedFindings,
  others: readonly Placement[],
  skipped: ReadonlySet<string>,
  outs: readonly { readonly blockId: string; readonly classId: string }[],
): RuleResult[] {
  if (sorted.after === null) return [];
  const candidate = examPlacementOf(sorted.exam, branchId, sorted.after);
  const own = findings.dated.lessons
    .filter((one) => one.date === sorted.exam.date && !skipped.has(one.placement.id))
    .map((one) => (one.tutorFollowed ? { ...one.placement, teacherIds: [] } : one.placement))
    .map((placement) => {
      const blockId = placement.blockId ?? placement.id;
      const out = new Set(outs.filter((one) => one.blockId === blockId).map((one) => one.classId));
      return out.size === 0
        ? placement
        : { ...placement, classIds: placement.classIds.filter((id) => !out.has(id)) };
    });
  // A class that sits only in a group has no row of the version, so the
  // facts may not name it.
  const facts = findings.factsOn(sorted.exam.date);
  const units = new Map(facts.units);
  for (const unit of sorted.exam.classUnits) if (!units.has(unit.id)) units.set(unit.id, unit);
  return checkCandidates(
    [...own, ...findings.elsewhereOn(sorted.exam.date), ...others],
    { ...facts, units },
    [candidate],
    { availabilityFrom: sorted.exam.date },
  ).filter((one) => one.severity === 'blocked');
}

/**
 * What the write does with the exams of one stretch, inside the deferred span
 * of `writeDatedLessons` (must-fix 1): `start` before the lessons are written,
 * `beforeBlocksDeleted` before the emptied blocks go, `end` after the lessons
 * and blocks are written and before the checks run.
 */
export interface ExamWrite {
  start(transaction: Transaction): Promise<void>;
  beforeBlocksDeleted(transaction: Transaction, blockIds: readonly string[]): Promise<void>;
  end(transaction: Transaction): Promise<void>;
}

/** What the write did to the exams of a stretch, for the audit entry (decision 7). */
export interface ExamAudit {
  readonly id: string;
  readonly date: string;
  readonly outcome: Exclude<ExamOutcome, 'refused'>;
  readonly before: { readonly startsAt: string; readonly endsAt: string };
  readonly after: { readonly startsAt: string; readonly endsAt: string } | null;
  readonly cancelled: string[];
  readonly restored: string[];
  /** Task 5.6c-3a: the lessons of its date cancelled with a typed reason by the write. */
  readonly cancelledWithReason: string[];
  readonly outsAdded: { blockId: string; classId: string }[];
  readonly outsRemoved: { blockId: string; classId: string }[];
  readonly choices: { classId: string; start: number; choice: ExamBlockChoice }[];
}

/**
 * The write of the sorted exams of one stretch (none refused): the cancels
 * and new times first, then, after the lessons, the lessons each exam covers
 * cancelled "exam", the lessons no standing exam covers any longer held
 * again, the out rows set, and every standing exam's claims written again
 * over the new lessons (a group's are held by its block).
 */
export function examWriteOf(input: {
  readonly branchId: string;
  readonly sorted: readonly SortedExam[];
  readonly begins: (date: string) => Date;
  /** The stored choice for an exam, class and block, else the save's (`null`: none, a fault by then). */
  readonly choiceOf: (examId: string) => ExamChoiceOf;
  readonly audit: ExamAudit[];
  /**
   * Task 5.6c-3a: the lessons of the dates written that end the write
   * cancelled with cause `reason`, by `examLessonKeyOf`: the reason. A clash
   * a publish's `cancel` settles, and a lesson a `drop` cannot give back
   * (plan review correction 1), which is never held again.
   */
  readonly cancelWith?: ReadonlyMap<string, string>;
}): ExamWrite {
  const { branchId, sorted, begins } = input;
  const moment = (date: string, minutes: number) =>
    new Date(begins(date).getTime() + minutes * MINUTE);
  const removedOuts = new Map<string, { blockId: string; classId: string }[]>();
  /** The lessons whose link to an exam the write removed, by exam (task 5.6c-1). */
  const unlinkedOf = new Map<string, Set<string>>();
  const keyOf = (out: { blockId: string; classId: string }) => `${out.blockId}|${out.classId}`;
  return {
    async start(transaction) {
      for (const one of sorted) {
        if (one.outcome === 'cancelled_day_off' || one.outcome === 'dropped') {
          // Cancelled first: its claims go and its blocks take their classes
          // back; then its out rows, before the blocks of the day are deleted.
          await transaction
            .updateTable('exams')
            .set({ cancel_cause: one.outcome === 'dropped' ? 'cancelled' : 'day_off' })
            .where('id', '=', one.exam.id)
            .execute();
          // Its links go: a lesson no other standing exam keeps is held again
          // at `end` (0094, task 5.6c-1).
          const unlinked = await transaction
            .deleteFrom('lesson_exam_cancels')
            .where('exam_id', '=', one.exam.id)
            .returning('lesson_id')
            .execute();
          unlinkedOf.set(one.exam.id, new Set(unlinked.map((row) => row.lesson_id)));
          if (one.exam.outs.length > 0) {
            await transaction
              .deleteFrom('lesson_block_class_outs')
              .where('exam_id', '=', one.exam.id)
              .execute();
            removedOuts.set(one.exam.id, [...one.exam.outs]);
          }
        } else if (one.outcome === 'moved' && one.after !== null) {
          await transaction
            .updateTable('exams')
            .set({
              starts_at: moment(one.exam.date, one.after.start),
              ends_at: moment(one.exam.date, one.after.end),
            })
            .where('id', '=', one.exam.id)
            .execute();
        }
      }
    },
    async beforeBlocksDeleted(transaction, blockIds) {
      if (blockIds.length === 0) return;
      const gone = await transaction
        .deleteFrom('lesson_block_class_outs')
        .where('block_id', 'in', [...blockIds])
        .returning(['exam_id', 'block_id', 'class_id'])
        .execute();
      for (const one of gone) {
        removedOuts.set(one.exam_id, [
          ...(removedOuts.get(one.exam_id) ?? []),
          { blockId: one.block_id, classId: one.class_id },
        ]);
      }
    },
    async end(transaction) {
      const dates = [...new Set(sorted.map((one) => one.exam.date))].sort();
      for (const date of dates) {
        const own = sorted.filter((one) => one.exam.date === date);
        const lessons = await storedExamLessonsOn(transaction, branchId, date, begins(date));
        const coveredAll = new Set<string>();
        const perExam = new Map<string, ExamLessons>();
        for (const one of own) {
          if (one.after === null) continue;
          const found = examLessonsOf(one.exam, one.after, lessons, input.choiceOf(one.exam.id));
          perExam.set(one.exam.id, found);
          for (const id of found.covered) coveredAll.add(id);
        }
        const cancel = lessons.filter((one) => coveredAll.has(one.id) && one.cancelCause === null);
        if (cancel.length > 0) {
          await transaction
            .updateTable('lessons')
            .set({ cancel_cause: 'exam', cancel_reason: null })
            .where(
              'id',
              'in',
              cancel.map((one) => one.id),
            )
            .execute();
        }
        // Each lesson cancelled "exam" names the exams that cover it, and
        // only those (0094, task 5.6c-1): links of an exam of the date that no
        // longer covers the lesson go, those it covers are written; a lesson
        // cancelled by another cause gets none.
        for (const one of own) {
          const covers = perExam.get(one.exam.id)?.covered ?? new Set<string>();
          const linked = lessons.filter(
            (lesson) =>
              covers.has(lesson.id) &&
              (lesson.cancelCause === null || lesson.cancelCause === 'exam'),
          );
          const gone = await transaction
            .deleteFrom('lesson_exam_cancels')
            .where('exam_id', '=', one.exam.id)
            .where(
              'lesson_id',
              'not in',
              linked.length === 0 ? [NO_LESSON] : linked.map((lesson) => lesson.id),
            )
            .returning('lesson_id')
            .execute();
          const unlinked = unlinkedOf.get(one.exam.id) ?? new Set<string>();
          for (const row of gone) unlinked.add(row.lesson_id);
          unlinkedOf.set(one.exam.id, unlinked);
          if (linked.length > 0) {
            await transaction
              .insertInto('lesson_exam_cancels')
              .values(
                linked.map((lesson) => ({
                  branch_id: branchId,
                  lesson_id: lesson.id,
                  exam_id: one.exam.id,
                })),
              )
              .onConflict((conflict) => conflict.doNothing())
              .execute();
          }
        }
        // Decision 2 of 5.6b-2c-1, by the links (task 5.6c-1): a lesson
        // cancelled "exam" that no exam keeps after the save is held again.
        const keptIds = new Set(
          (
            await transaction
              .selectFrom('lesson_exam_cancels')
              .select('lesson_id')
              .where(
                'lesson_id',
                'in',
                lessons.length === 0 ? [NO_LESSON] : lessons.map((one) => one.id),
              )
              .execute()
          ).map((row) => row.lesson_id),
        );
        const cancelWith = input.cancelWith ?? new Map<string, string>();
        const reasonOf = (lesson: ExamDayLesson) =>
          lesson.entryId == null
            ? undefined
            : cancelWith.get(examLessonKeyOf(lesson.entryId, date, lesson.start));
        const restore = lessons.filter(
          (one) =>
            one.cancelCause === 'exam' &&
            !coveredAll.has(one.id) &&
            !keptIds.has(one.id) &&
            reasonOf(one) === undefined,
        );
        // Task 5.6c-3a: a clash settled by `cancel`, and a lesson a `drop`
        // cannot give back, cancelled with the typed reason; one under a
        // standing exam stays so.
        const withReason = lessons.filter(
          (one) =>
            reasonOf(one) !== undefined &&
            !coveredAll.has(one.id) &&
            !keptIds.has(one.id) &&
            (one.cancelCause === null || one.cancelCause === 'exam'),
        );
        for (const one of withReason) {
          await transaction
            .updateTable('lessons')
            .set({ cancel_cause: 'reason', cancel_reason: reasonOf(one) ?? null })
            .where('id', '=', one.id)
            .execute();
        }
        if (restore.length > 0) {
          await transaction
            .updateTable('lessons')
            .set({ cancel_cause: null, cancel_reason: null })
            .where(
              'id',
              'in',
              restore.map((one) => one.id),
            )
            .execute();
        }
        for (const one of own) {
          const found = perExam.get(one.exam.id);
          const removed = removedOuts.get(one.exam.id) ?? [];
          const held =
            one.after === null
              ? []
              : await transaction
                  .selectFrom('lesson_block_class_outs')
                  .select(['block_id', 'class_id'])
                  .where('exam_id', '=', one.exam.id)
                  .execute();
          const wanted = found?.outs ?? [];
          const wantedKeys = new Set(wanted.map(keyOf));
          const heldKeys = new Set(
            held.map((row) => keyOf({ blockId: row.block_id, classId: row.class_id })),
          );
          const drop = held
            .map((row) => ({ blockId: row.block_id, classId: row.class_id }))
            .filter((out) => !wantedKeys.has(keyOf(out)));
          for (const out of drop) {
            await transaction
              .deleteFrom('lesson_block_class_outs')
              .where('exam_id', '=', one.exam.id)
              .where('block_id', '=', out.blockId)
              .where('class_id', '=', out.classId)
              .execute();
          }
          const add = wanted.filter((out) => !heldKeys.has(keyOf(out)));
          if (add.length > 0) {
            await transaction
              .insertInto('lesson_block_class_outs')
              .values(
                add.map((out) => ({
                  branch_id: branchId,
                  block_id: out.blockId,
                  class_id: out.classId,
                  exam_id: one.exam.id,
                })),
              )
              .execute();
          }
          if (one.after !== null) {
            // The exam's claims again over the lessons written (a group's are
            // held by its block, which the write may have created anew).
            await transaction
              .updateTable('exams')
              .set({ title: sql<string>`title` })
              .where('id', '=', one.exam.id)
              .execute();
          }
          const ownCovered = found?.covered ?? new Set<string>();
          input.audit.push({
            id: one.exam.id,
            date,
            outcome: one.outcome === 'refused' ? 'kept' : one.outcome,
            before: {
              startsAt: one.exam.startsAt.toISOString(),
              endsAt: one.exam.endsAt.toISOString(),
            },
            after:
              one.after === null
                ? null
                : {
                    startsAt: moment(date, one.after.start).toISOString(),
                    endsAt: moment(date, one.after.end).toISOString(),
                  },
            cancelled: cancel.filter((lesson) => ownCovered.has(lesson.id)).map((l) => l.id),
            restored: restore
              .filter((lesson) => unlinkedOf.get(one.exam.id)?.has(lesson.id) === true)
              .map((lesson) => lesson.id),
            cancelledWithReason: withReason.map((lesson) => lesson.id),
            outsAdded: add,
            outsRemoved: [
              ...removed,
              ...drop.filter((out) => !removed.some((gone) => keyOf(gone) === keyOf(out))),
            ],
            choices: [...(found?.chosen ?? [])],
          });
        }
      }
    },
  };
}
