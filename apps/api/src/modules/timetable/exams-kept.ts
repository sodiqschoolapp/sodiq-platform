import { createHash } from 'node:crypto';
import {
  type DayChangeChoice,
  type DayDecisions,
  type ExamBlockAnswer,
  type ExamItemAnswer,
  type ExamLessonAnswer,
  type PublishRefusal,
} from '@sodiq/shared';
import {
  checkCandidates,
  type DatedLesson,
  type Placement,
  type RuleResult,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import {
  examBlocked,
  examLessonKeyOf,
  examLessonsOf,
  examPlacementsOn,
  examWeekLessonsOn,
  examWriteOf,
  findingsLessonsOn,
  standingExamsOn,
  storedChoicesOf,
  storedExamLessonsOn,
  type ExamAudit,
  type ExamBlockChoice,
  type ExamChoiceOf,
  type ExamDayLesson,
  type ExamSharedBlock,
  type ExamWrite,
  type SortedExam,
  type StandingExam,
} from './calendar-exams.js';
import type { DatedFindings } from './dated-check.js';
import { answerOf } from './day-changes-kept.js';
import type { PatternState } from './pattern.service.js';

/**
 * The standing exams of the dates a publish or a withdraw writes, kept
 * (task 5.6c-3a, pull request #183; `edge/timetable`, Exams: "An exam is
 * stored on its own like a one-day change and kept after a later publish: the
 * new version's lessons of its classes in its slots are cancelled with the
 * reason 'exam' as at creation, and a lesson of an invigilator or in an exam
 * room at that time is a 'needs a decision' item in the preview";
 * Versions and drafts: "One-day changes, absences, room closures and exams
 * are stored on their own and applied again after a publish. The preview
 * sorts them into kept, needs a decision and dropped. Publish waits until
 * every 'needs a decision' item is settled").
 *
 * A publish changes no day template, so an exam keeps its time (decision 4).
 * Its lessons are read on the run's findings by the calendar path's rules
 * (`examLessonsOf`): a sitting class's own blocks and a sitting group's own
 * lessons are cancelled "exam"; a block shared with classes that do not sit
 * takes the choice of the stored block of exactly the same lessons, else it
 * needs one (decision 3: pattern blocks belong to their version, so a choice
 * is carried by its lessons, as a bulk cancel's). An exam needs a decision
 * with a block without a choice, with a blocked result of its invigilators,
 * rooms or classes at its time (settled by `cancel` with a reason, which
 * cancels the new version's lessons named, both halves of a double; decision
 * 2), with a sitting group whose own lesson the new version moves (decision
 * 4) or with no timetable on its date after a withdraw (decision 6), the last
 * two settled only by `drop`. A `drop` cancels the exam and gives back its
 * lessons by the rule for a restored lesson: one that cannot come back stays
 * cancelled with the decision's reason (plan review correction 1). The
 * sorting never drops an exam by itself (decision 9).
 */

/**
 * The invigilators of the branch's standing exams from `firstDate` to
 * `lastDate` linked to the branch, and the substitutes in force there (task
 * 5.7b-3): the run's facts take them as extra
 * teachers, as the exam's own check does (`exam-check.ts`; task 5.6c-1,
 * decision 12), so that the engine knows a person who teaches no row.
 */
export async function invigilatorsOf(
  transaction: Transaction,
  branchId: string,
  firstDate: string,
  lastDate: string,
): Promise<string[]> {
  const rows = await transaction
    .selectFrom('exam_invigilators')
    .innerJoin('exams', 'exams.id', 'exam_invigilators.exam_id')
    .innerJoin('staff_branches', (join) =>
      join
        .onRef('staff_branches.staff_id', '=', 'exam_invigilators.staff_id')
        .on('staff_branches.branch_id', '=', branchId),
    )
    .select('exam_invigilators.staff_id')
    .distinct()
    .where('exams.branch_id', '=', branchId)
    .where('exams.exam_date', '>=', firstDate)
    .where('exams.exam_date', '<=', lastDate)
    .where('exams.cancel_cause', 'is', null)
    .orderBy('exam_invigilators.staff_id')
    .execute();
  // Task 5.7b-3: and the substitutes in force on the lessons of the dates,
  // so that the sorting of a kept substitution checks a person who teaches
  // no row (`substitutions-kept.ts`).
  const substitutes = await transaction
    .selectFrom('substitution_lessons')
    .innerJoin('substitutions', 'substitutions.id', 'substitution_lessons.substitution_id')
    .innerJoin('lessons', 'lessons.id', 'substitution_lessons.lesson_id')
    .innerJoin('staff_branches', (join) =>
      join
        .onRef('staff_branches.staff_id', '=', 'substitutions.substitute_id')
        .on('staff_branches.branch_id', '=', branchId),
    )
    .select('substitutions.substitute_id as staff_id')
    .distinct()
    .where('substitution_lessons.branch_id', '=', branchId)
    .where('substitution_lessons.ended_at', 'is', null)
    .whereRef('lessons.teacher_id', '=', 'substitutions.substitute_id')
    .where('lessons.lesson_date', '>=', firstDate)
    .where('lessons.lesson_date', '<=', lastDate)
    .execute();
  return [...new Set([...rows, ...substitutes].map((one) => one.staff_id))].sort();
}

/** A shared block of an exam as the sorting reads it, with the choice it carries. */
interface KeptBlock {
  readonly answer: ExamBlockAnswer;
  /** Its pattern blocks, sorted: how `ExamChoiceOf` names it. */
  readonly unitKey: string;
}

/** A standing exam as a publish or a withdraw sorts it. */
export interface KeptExam {
  readonly exam: StandingExam;
  readonly before: { readonly start: number; readonly end: number };
  readonly answer: ExamItemAnswer;
  readonly category: 'kept' | 'decide';
  readonly blocks: readonly KeptBlock[];
  /** The choice carried for a shared block, by its unit key. */
  readonly carried: ReadonlyMap<string, ExamBlockChoice>;
  /** The lessons a `cancel` cancels, by `examLessonKeyOf`. */
  readonly clashKeys: readonly string[];
  /** The lessons a `drop` cannot give back, by `examLessonKeyOf`. */
  readonly dropBlockedKeys: readonly string[];
  /** Whether `cancel` settles it: every blocked result names a lesson of the run. */
  readonly cancelOffered: boolean;
  /** The teachers of the lessons it covers, told when a `drop` gives them back (decision 7). */
  readonly teacherIds: readonly string[];
}

/** The exams of one run before its one-day changes are sorted: what `sortDayChanges` reads. */
export interface ExamsBefore {
  readonly sorted: readonly SortedExam[];
  readonly carried: ReadonlyMap<string, ReadonlyMap<string, ExamBlockChoice>>;
  /** As `sortDayChanges` takes them: the exams' placements and the lessons they cover. */
  readonly forSorting:
    | { readonly on: (date: string) => readonly Placement[]; readonly covered: ReadonlySet<string> }
    | undefined;
}

const NO_CHOICES: ReadonlyMap<string, ExamBlockChoice> = new Map();

const unitKeyOf = (patternBlockIds: readonly string[]) => [...patternBlockIds].sort().join(',');

/** The lessons of a date by unit (a block with its double partner), keyed by their pattern blocks. */
function unitsOf(lessons: readonly ExamDayLesson[]): Map<string, ExamDayLesson[]> {
  const byPair = new Map<string, ExamDayLesson[]>();
  for (const one of lessons) {
    const key = one.doublePairId ?? one.blockId;
    byPair.set(key, [...(byPair.get(key) ?? []), one]);
  }
  const units = new Map<string, ExamDayLesson[]>();
  for (const unit of byPair.values()) {
    units.set(unitKeyOf([...new Set(unit.map((one) => one.patternBlockId))]), unit);
  }
  return units;
}

/** What makes two blocks the same for a carried choice: their lessons' units, subjects, teachers and minutes. */
const signatureOf = (
  lessons: readonly {
    classId: string | null;
    groupId: string | null;
    subjectId: string;
    teacherId: string | null;
    start: number;
    end: number;
  }[],
) =>
  lessons
    .map((one) =>
      [
        one.classId ?? '',
        one.groupId ?? '',
        one.subjectId,
        one.teacherId ?? '',
        String(one.start),
        String(one.end),
      ].join('|'),
    )
    .sort()
    .join(';');

/**
 * The exams standing on the run's dates, locked as `standingExamsOn` locks
 * them, each at its stored time, with the choices its stored shared blocks
 * carry to a block of the run of the same lessons, and what the sorting of
 * the one-day changes reads of them (the calendar path's `{ on, covered }`,
 * a block without a choice read as cancelled whole).
 */
export async function examsBeforeOf(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly findings: DatedFindings;
    readonly firstDate: string;
    readonly lastDate: string;
  },
): Promise<ExamsBefore> {
  const { branchId, findings } = input;
  const dates = (
    await transaction
      .selectFrom('exams')
      .select(sql<string>`exam_date::text`.as('date'))
      .where('branch_id', '=', branchId)
      .where('exam_date', '>=', input.firstDate)
      .where('exam_date', '<=', input.lastDate)
      .where('cancel_cause', 'is', null)
      .execute()
  ).map((one) => one.date);
  const standing = await standingExamsOn(transaction, branchId, [...new Set(dates)].sort());
  if (standing.length === 0) return { sorted: [], carried: new Map(), forSorting: undefined };
  const sorted: SortedExam[] = standing.map((exam) => {
    const begins = findings.begins(exam.date).getTime();
    const before = {
      start: Math.round((exam.startsAt.getTime() - begins) / MINUTE),
      end: Math.round((exam.endsAt.getTime() - begins) / MINUTE),
    };
    return { exam, outcome: 'kept', code: null, before, after: before };
  });
  const carried = new Map<string, Map<string, ExamBlockChoice>>();
  for (const one of sorted) {
    const stored = await storedExamLessonsOn(
      transaction,
      branchId,
      one.exam.date,
      findings.begins(one.exam.date),
    );
    const choices = storedChoicesOf(one.exam, one.before, stored);
    if (choices.size === 0) continue;
    const staffed = new Map(
      (
        await transaction
          .selectFrom('lessons')
          .select(['id', 'subject_id', 'teacher_id'])
          .where(
            'id',
            'in',
            stored.map((lesson) => lesson.id),
          )
          .execute()
      ).map((row) => [row.id, row]),
    );
    const storedSignatures = new Map<string, ExamBlockChoice>();
    for (const unit of unitsOf(stored).values()) {
      const found = unit.flatMap((lesson) =>
        one.exam.classIds.flatMap((classId) => {
          const choice = choices.get(`${classId}|${lesson.patternBlockId}`);
          return choice === undefined ? [] : [choice];
        }),
      );
      if (found.length === 0) continue;
      const signature = signatureOf(
        unit.map((lesson) => ({
          classId: lesson.classId,
          groupId: lesson.groupId,
          subjectId: staffed.get(lesson.id)?.subject_id ?? '',
          teacherId: staffed.get(lesson.id)?.teacher_id ?? null,
          start: lesson.start,
          end: lesson.end,
        })),
      );
      storedSignatures.set(signature, found.includes('cancel') ? 'cancel' : 'keep');
    }
    const byUnit = new Map<string, ExamBlockChoice>();
    const placements = new Map(
      findings.dated.lessons
        .filter((lesson) => lesson.date === one.exam.date)
        .map((lesson) => [lesson.placement.id, lesson.placement]),
    );
    for (const [unitKey, unit] of unitsOf(findingsLessonsOn(findings, one.exam.date))) {
      const signature = signatureOf(
        unit.map((lesson) => {
          const placement = placements.get(lesson.id);
          return {
            classId: lesson.classId,
            groupId: lesson.groupId,
            subjectId: placement?.subjectId ?? '',
            teacherId: placement?.teacherIds[0] ?? null,
            start: lesson.start,
            end: lesson.end,
          };
        }),
      );
      const choice = storedSignatures.get(signature);
      if (choice !== undefined) byUnit.set(unitKey, choice);
    }
    carried.set(one.exam.id, byUnit);
  }
  const covered = new Set<string>();
  for (const one of sorted) {
    const found = examLessonsOf(
      one.exam,
      one.before,
      findingsLessonsOn(findings, one.exam.date),
      carriedChoiceOf(carried.get(one.exam.id) ?? NO_CHOICES, 'cancel'),
    );
    for (const id of found.covered) covered.add(id);
  }
  return {
    sorted,
    carried,
    forSorting: {
      on: (date: string) => fixedExamsOn(sorted, branchId, date),
      covered,
    },
  };
}

/**
 * The exams of a date as context of a check: fixed, as the stored claims
 * read them (`examsOn` of `stored-day.ts`), so the engine never asks for the
 * facts of a class that sits only in them.
 */
const fixedExamsOn = (sorted: readonly SortedExam[], branchId: string, date: string) =>
  examPlacementsOn(sorted, branchId, date).map((one) => ({ ...one, fixed: true }));

/** The choice of a shared block from the carried ones, else `fallback`. */
function carriedChoiceOf(
  carried: ReadonlyMap<string, ExamBlockChoice>,
  fallback: ExamBlockChoice | null,
): ExamChoiceOf {
  return (_classId, block) => carried.get(unitKeyOf(block.patternBlockIds)) ?? fallback;
}

/**
 * Each exam of the run sorted on the findings with the kept one-day changes
 * applied (`sorting`), as the preview shows it and the write applies it.
 * `noTimetable`: the run writes no lesson (a withdraw with no version to run
 * again, decision 6).
 */
export function sortExamsKept(input: {
  readonly branchId: string;
  readonly state: PatternState;
  readonly findings: DatedFindings;
  readonly before: ExamsBefore;
  readonly carriedVersionId: string | null;
  readonly noTimetable: boolean;
}): KeptExam[] {
  const { branchId, findings, before } = input;
  const groupOfRow = (loadRowId: string) =>
    input.state.rows.find((row) => row.id === loadRowId)?.group_id ?? null;
  const allCovered = new Set<string>();
  const thereOf = (date: string) => [
    ...findingsLessonsOn(findings, date),
    ...examWeekLessonsOn(findings, input.state.blocks, groupOfRow, date),
  ];
  for (const one of before.sorted) {
    const found = examLessonsOf(
      one.exam,
      one.before,
      thereOf(one.exam.date),
      carriedChoiceOf(before.carried.get(one.exam.id) ?? NO_CHOICES, 'cancel'),
    );
    for (const id of found.covered) allCovered.add(id);
  }
  return before.sorted.map((one): KeptExam => {
    const { exam } = one;
    const carried = before.carried.get(exam.id) ?? NO_CHOICES;
    const base = {
      key: exam.id,
      date: exam.date,
      title: exam.title,
      start: one.before.start,
      end: one.before.end,
      carriedVersionId: input.carriedVersionId,
    };
    if (input.noTimetable) {
      return {
        exam,
        before: one.before,
        category: 'decide',
        blocks: [],
        carried,
        clashKeys: [],
        dropBlockedKeys: [],
        cancelOffered: false,
        teacherIds: [],
        answer: {
          ...base,
          category: 'decide',
          cancelled: [],
          blocks: [],
          blocked: [],
          clashes: [],
          groupMisses: false,
          noTimetable: true,
          dropBlocked: [],
        },
      };
    }
    const there = thereOf(exam.date);
    const datedById = new Map(
      findings.dated.lessons
        .filter((lesson) => lesson.date === exam.date)
        .map((lesson) => [lesson.placement.id, lesson]),
    );
    const lessonAnswerOf = (lesson: ExamDayLesson): ExamLessonAnswer[] => {
      const dated = datedById.get(lesson.id);
      const unitId = lesson.classId ?? lesson.groupId;
      return dated === undefined || unitId === null
        ? []
        : [
            {
              unitId,
              subjectId: dated.placement.subjectId ?? '',
              start: lesson.start,
              end: lesson.end,
            },
          ];
    };
    // Every shared block of a sitting class at the exam's time, once per
    // block for all its sitting classes, with the choice it carries.
    const asked = new Map<string, ExamSharedBlock>();
    const fresh = examLessonsOf(exam, one.before, there, (classId, block) => {
      const unitKey = unitKeyOf(block.patternBlockIds);
      if (!asked.has(unitKey)) asked.set(unitKey, block);
      return carried.get(unitKey) ?? null;
    });
    const sitting = new Set(exam.classIds);
    const units = unitsOf(there);
    const others = fixedExamsOn(before.sorted, branchId, exam.date).filter(
      (placement) => placement.id !== `exam:${exam.id}`,
    );
    // Spec review of the code, must-fix 4 (`edge/timetable`, Exams: "a lesson of
    // an invigilator or in an exam room at that time is a 'needs a decision'
    // item"; `.claude/rules/timetable.md`: a lesson still held for other classes
    // stays in the check): an open block is checked kept for the other classes,
    // the others as carried or cancelled whole; `keep` is offered only when
    // none of its lessons then meets the exam.
    const keepOfferedOf = (unitKey: string, lessonIds: ReadonlySet<string>): boolean => {
      const kept = examLessonsOf(exam, one.before, there, (_classId, block) =>
        unitKeyOf(block.patternBlockIds) === unitKey
          ? 'keep'
          : (carried.get(unitKeyOf(block.patternBlockIds)) ?? 'cancel'),
      );
      const skippedHere = new Set(
        [...allCovered, ...kept.covered].filter((id) => !lessonIds.has(id) || kept.covered.has(id)),
      );
      return !examBlocked(one, branchId, findings, others, skippedHere, kept.outs).some((result) =>
        result.lessonIds.some((id) => lessonIds.has(id)),
      );
    };
    const blocks: KeptBlock[] = [...asked.entries()].map(([unitKey, block]) => {
      const lessons = (units.get(unitKey) ?? []).slice().sort((a, b) => a.start - b.start);
      const choice = carried.get(unitKey) ?? null;
      const first = lessons[0];
      const pair = lessons.find((lesson) => lesson.patternBlockId !== first?.patternBlockId);
      const classIds = [...new Set(lessons.flatMap((lesson) => lesson.classIds))].sort();
      return {
        unitKey,
        answer: {
          blockId: first?.patternBlockId ?? block.patternBlockIds[0] ?? '',
          blockDate: exam.date,
          pairBlockId: pair?.patternBlockId ?? null,
          start: Math.min(...lessons.map((lesson) => lesson.start)),
          end: Math.max(...lessons.map((lesson) => lesson.end)),
          lessons: lessons.flatMap(lessonAnswerOf),
          sittingClassIds: classIds.filter((id) => sitting.has(id)),
          otherClassIds: classIds.filter((id) => !sitting.has(id)),
          choice,
          keepOffered:
            choice !== null || keepOfferedOf(unitKey, new Set(lessons.map((lesson) => lesson.id))),
        },
      };
    });
    // The blocked results with each block cancelled whole unless it carries
    // `keep` (a block still asked is left out, as the calendar path does).
    const chosen = examLessonsOf(exam, one.before, there, carriedChoiceOf(carried, 'cancel'));
    const skipped = new Set([...allCovered, ...chosen.covered]);
    const blocked = examBlocked(one, branchId, findings, others, skipped, chosen.outs);
    const own = (id: string) => datedById.has(id);
    const clashed = new Set(blocked.flatMap((result) => result.lessonIds.filter(own)));
    const clashLessons = withPartnersOf(findings, exam.date, clashed);
    const cancelOffered =
      blocked.length > 0 &&
      !fresh.groupMisses &&
      blocked.every((result) => result.lessonIds.some(own));
    const dropBlocked = dropBlockedOf({
      exam,
      branchId,
      findings,
      covered: chosen.covered,
      allCovered,
      others,
    });
    const coveredLessons = there.filter(
      (lesson) => fresh.covered.has(lesson.id) && datedById.has(lesson.id),
    );
    const decide =
      blocks.some((block) => block.answer.choice === null) ||
      blocked.length > 0 ||
      fresh.groupMisses;
    const category = decide ? 'decide' : 'kept';
    const keyOf = (lesson: DatedLesson) =>
      examLessonKeyOf(lesson.entryId, lesson.date, lesson.placement.start);
    const answerLessonOf = (lesson: DatedLesson): ExamLessonAnswer => ({
      unitId: lesson.placement.classId ?? lesson.placement.groupId ?? '',
      subjectId: lesson.placement.subjectId ?? '',
      start: lesson.placement.start,
      end: lesson.placement.end,
    });
    return {
      exam,
      before: one.before,
      category,
      blocks,
      carried,
      clashKeys: clashLessons.map(keyOf),
      dropBlockedKeys: dropBlocked.map(keyOf),
      cancelOffered,
      teacherIds: [
        ...new Set(
          coveredLessons.flatMap((lesson) => datedById.get(lesson.id)?.placement.teacherIds ?? []),
        ),
      ].sort(),
      answer: {
        ...base,
        category,
        cancelled: coveredLessons.flatMap(lessonAnswerOf).sort(byLesson),
        blocks: blocks.map((block) => block.answer).sort((a, b) => a.start - b.start),
        blocked: blocked.map(answerOf),
        clashes: clashLessons.map(answerLessonOf).sort(byLesson),
        groupMisses: fresh.groupMisses,
        noTimetable: false,
        dropBlocked: dropBlocked.map(answerLessonOf).sort(byLesson),
      },
    };
  });
}

const byLesson = (a: ExamLessonAnswer, b: ExamLessonAnswer) =>
  a.start - b.start || compare(a.unitId, b.unitId) || compare(a.subjectId, b.subjectId);

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The lessons of the run on a date named by `ids`, with the other halves of their doubles. */
function withPartnersOf(
  findings: DatedFindings,
  date: string,
  ids: ReadonlySet<string>,
): DatedLesson[] {
  const onDate = findings.dated.lessons.filter((lesson) => lesson.date === date);
  const pairs = new Set(
    onDate
      .filter((lesson) => ids.has(lesson.placement.id) && lesson.placement.doublePairId !== null)
      .map((lesson) => lesson.placement.doublePairId),
  );
  return onDate
    .filter(
      (lesson) =>
        ids.has(lesson.placement.id) ||
        (lesson.placement.doublePairId !== null && pairs.has(lesson.placement.doublePairId)),
    )
    .sort((a, b) => a.placement.start - b.placement.start || compare(a.entryId, b.entryId));
}

/**
 * The lessons an exam covers that a `drop` cannot give back (plan review
 * correction 1; `06`, Exam: "cancelling the exam restores only the lessons
 * it cancelled, by the rule for a restored lesson"): each with its double
 * partner, checked by the engine against the run's lessons on the date that
 * no exam covers (a kept one-day move into the freed time among them), the
 * other branches' claims and the branch's other exams.
 */
function dropBlockedOf(input: {
  readonly exam: StandingExam;
  readonly branchId: string;
  readonly findings: DatedFindings;
  readonly covered: ReadonlySet<string>;
  readonly allCovered: ReadonlySet<string>;
  readonly others: readonly Placement[];
}): DatedLesson[] {
  const { findings, exam } = input;
  const candidates = withPartnersOf(findings, exam.date, input.covered);
  if (candidates.length === 0) return [];
  const ids = new Set(candidates.map((lesson) => lesson.placement.id));
  const rest = findings.dated.lessons
    .filter(
      (lesson) =>
        lesson.date === exam.date &&
        !ids.has(lesson.placement.id) &&
        !input.allCovered.has(lesson.placement.id),
    )
    .map((lesson) => lesson.placement);
  const results: RuleResult[] = checkCandidates(
    [...rest, ...findings.elsewhereOn(exam.date), ...input.others],
    findings.factsOn(exam.date),
    candidates.map((lesson) => lesson.placement),
    { availabilityFrom: exam.date },
  ).filter((one) => one.severity === 'blocked');
  const hit = new Set(results.flatMap((one) => one.lessonIds.filter((id) => ids.has(id))));
  return withPartnersOf(findings, exam.date, hit);
}

/** The exam part of the sorting's key (`dayChangesKeyOf`): everything the preview shows of them. */
export function examKeyPartOf(items: readonly KeptExam[]): string | null {
  if (items.length === 0) return null;
  const shown = items.map((one) => JSON.stringify(one.answer)).sort(compare);
  return createHash('sha256').update(JSON.stringify(shown)).digest('hex');
}

/** The open blocks of the exam items, by `dayDecisionKeyOf`'s parts: `<exam>|<block>|<date>`. */
const blockKeyOf = (examId: string, blockId: string, blockDate: string) =>
  `${examId}|${blockId}|${blockDate}`;

/** The decisions sent for the exams of a sorting: of each exam and of each of its blocks. */
export function examDecisionsOf(
  items: readonly KeptExam[],
  sent: DayDecisions | undefined,
): {
  readonly whole: ReadonlyMap<string, { choice: DayChangeChoice; reason: string | null }>;
  readonly blocks: ReadonlyMap<string, DayChangeChoice>;
  /** The decisions that name an exam of the sorting, which the other sortings never read. */
  readonly named: ReadonlySet<DayDecisions[number]>;
} {
  const keys = new Set(items.map((one) => one.exam.id));
  const whole = new Map<string, { choice: DayChangeChoice; reason: string | null }>();
  const blocks = new Map<string, DayChangeChoice>();
  const named = new Set<DayDecisions[number]>();
  for (const one of sent ?? []) {
    if (!keys.has(one.key)) continue;
    named.add(one);
    if (one.blockId === undefined) {
      whole.set(one.key, { choice: one.choice, reason: one.reason ?? null });
    } else {
      blocks.set(blockKeyOf(one.key, one.blockId, one.blockDate ?? ''), one.choice);
    }
  }
  return { whole, blocks, named };
}

/**
 * What refuses a write over the exams of its sorting (decisions 2 to 6 and
 * correction 1): an exam or an open block without a choice
 * (`day_change_undecided`), a choice for a kept exam or a block that is not
 * open (`day_decision_unknown`), and a choice the item does not offer
 * (`day_choice_not_offered`): `keep` on an exam, `drop` on a block, a block
 * choice beside a `drop`, `cancel` where no cancel settles it or without a
 * reason, a `drop` with a reason where it gives every lesson back, or
 * without one where it cannot, a reason on any other choice.
 */
export function examRefusalsOf(
  items: readonly KeptExam[],
  sent: DayDecisions | undefined,
): PublishRefusal[] {
  const refusals: PublishRefusal[] = [];
  const { whole, blocks } = examDecisionsOf(items, sent);
  const byId = new Map(items.map((one) => [one.exam.id, one]));
  for (const item of [...items].sort((a, b) => compare(a.exam.id, b.exam.id))) {
    if (item.category !== 'decide') continue;
    const decision = whole.get(item.exam.id);
    const needsWhole =
      item.answer.blocked.length > 0 || item.answer.groupMisses || item.answer.noTimetable;
    if (needsWhole && decision === undefined) {
      refusals.push({ code: 'day_change_undecided', key: item.exam.id });
    }
    if (decision?.choice === 'drop') continue;
    for (const block of item.blocks) {
      if (block.answer.choice !== null) continue;
      if (!blocks.has(blockKeyOf(item.exam.id, block.answer.blockId, block.answer.blockDate))) {
        refusals.push({
          code: 'day_change_undecided',
          key: item.exam.id,
          blockId: block.answer.blockId,
          blockDate: block.answer.blockDate,
        });
      }
    }
  }
  for (const [key, decision] of [...whole].sort(([a], [b]) => compare(a, b))) {
    const item = byId.get(key);
    if (item === undefined || item.category !== 'decide') {
      refusals.push({ code: 'day_decision_unknown', key });
      continue;
    }
    const offered =
      decision.choice === 'drop'
        ? (decision.reason !== null) === item.dropBlockedKeys.length > 0
        : decision.choice === 'cancel'
          ? item.cancelOffered && decision.reason !== null
          : false;
    if (!offered) refusals.push({ code: 'day_choice_not_offered', key });
  }
  for (const one of (sent ?? []).filter((decision) => decision.blockId !== undefined)) {
    const item = byId.get(one.key);
    if (item === undefined) continue;
    const at = { key: one.key, blockId: one.blockId, blockDate: one.blockDate };
    const open = item.blocks.some(
      (block) =>
        block.answer.choice === null &&
        block.answer.blockId === one.blockId &&
        block.answer.blockDate === one.blockDate,
    );
    const keepOffered = item.blocks.some(
      (block) =>
        block.answer.blockId === one.blockId &&
        block.answer.blockDate === one.blockDate &&
        block.answer.keepOffered,
    );
    if (item.category !== 'decide' || !open) {
      refusals.push({ code: 'day_decision_unknown', ...at });
    } else if (
      one.choice === 'drop' ||
      whole.get(one.key)?.choice === 'drop' ||
      (one.choice === 'keep' && !keepOffered)
    ) {
      refusals.push({ code: 'day_choice_not_offered', ...at });
    }
  }
  return refusals;
}

/**
 * The write of the run's exams (`ExamWrite` of the calendar path) with the
 * decisions taken: a `drop` cancels the exam; each shared block takes its
 * carried or decided choice; a `cancel` cancels the clashing lessons with its
 * reason, a `drop` with a reason the lessons it cannot give back. `null` with
 * no exam on the run's dates.
 */
export function examsWriteOf(input: {
  readonly branchId: string;
  readonly items: readonly KeptExam[];
  readonly begins: (date: string) => Date;
  readonly sent: DayDecisions | undefined;
  readonly audit: ExamAudit[];
}): ExamWrite | null {
  if (input.items.length === 0) return null;
  const { whole, blocks } = examDecisionsOf(input.items, input.sent);
  const cancelWith = new Map<string, { readonly reason: string; readonly examId: string }>();
  const sorted: SortedExam[] = input.items.map((item) => {
    const decision = whole.get(item.exam.id);
    if (decision?.choice === 'cancel' && decision.reason !== null) {
      for (const key of item.clashKeys) {
        cancelWith.set(key, { reason: decision.reason, examId: item.exam.id });
      }
    }
    if (decision?.choice === 'drop') {
      if (decision.reason !== null) {
        for (const key of item.dropBlockedKeys) {
          cancelWith.set(key, { reason: decision.reason, examId: item.exam.id });
        }
      }
      return { exam: item.exam, outcome: 'dropped', code: null, before: item.before, after: null };
    }
    return {
      exam: item.exam,
      outcome: 'kept',
      code: null,
      before: item.before,
      after: item.before,
    };
  });
  const byId = new Map(input.items.map((item) => [item.exam.id, item]));
  return examWriteOf({
    branchId: input.branchId,
    sorted,
    begins: input.begins,
    choiceOf: (examId) => (_classId, block) => {
      const item = byId.get(examId);
      if (item === undefined) return null;
      const carried = item.carried.get(unitKeyOf(block.patternBlockIds));
      if (carried !== undefined) return carried;
      for (const patternBlockId of block.patternBlockIds) {
        const found = blocks.get(blockKeyOf(examId, patternBlockId, item.exam.date));
        if (found === 'cancel' || found === 'keep') return found;
      }
      return null;
    },
    audit: input.audit,
    cancelWith,
  });
}

/** The exams of a run for its audit entry: each kept or decided, with what the write did. */
export type ExamsAudit = {
  kept: string[];
  decided: { key: string; choice: DayChangeChoice | null; reason: string | null }[];
  written: {
    id: string;
    date: string;
    outcome: string;
    before: { startsAt: string; endsAt: string };
    after: { startsAt: string; endsAt: string } | null;
    cancelled: string[];
    restored: string[];
    cancelledWithReason: string[];
    outsAdded: { blockId: string; classId: string }[];
    outsRemoved: { blockId: string; classId: string }[];
    choices: { classId: string; start: number; choice: ExamBlockChoice }[];
  }[];
};

export function examAuditOf(
  items: readonly KeptExam[],
  sent: DayDecisions | undefined,
  written: readonly ExamAudit[],
): ExamsAudit {
  const { whole } = examDecisionsOf(items, sent);
  return {
    kept: items
      .filter((one) => one.category === 'kept')
      .map((one) => one.exam.id)
      .sort(compare),
    decided: items
      .filter((one) => one.category === 'decide')
      .map((one) => ({
        key: one.exam.id,
        choice: whole.get(one.exam.id)?.choice ?? null,
        reason: whole.get(one.exam.id)?.reason ?? null,
      }))
      .sort((a, b) => compare(a.key, b.key)),
    written: written.map((one) => ({
      id: one.id,
      date: one.date,
      outcome: one.outcome,
      before: { ...one.before },
      after: one.after === null ? null : { ...one.after },
      cancelled: [...one.cancelled],
      restored: [...one.restored],
      cancelledWithReason: [...one.cancelledWithReason],
      outsAdded: one.outsAdded.map((out) => ({ ...out })),
      outsRemoved: one.outsRemoved.map((out) => ({ ...out })),
      choices: one.choices.map((choice) => ({ ...choice })),
    })),
  };
}

const MINUTE = 60_000;

/**
 * The exams a write drops, by the account told (decision 7): each
 * invigilator and each teacher of a lesson it gives back, people with an
 * account only (never a vacancy). The event's own notice carries them.
 */
export async function examsCancelledOf(
  transaction: Transaction,
  items: readonly KeptExam[],
  sent: DayDecisions | undefined,
): Promise<Map<string, { title: string; date: string }[]>> {
  const { whole } = examDecisionsOf(items, sent);
  const dropped = items.filter((one) => whole.get(one.exam.id)?.choice === 'drop');
  const told = new Map<string, { title: string; date: string }[]>();
  if (dropped.length === 0) return told;
  const staffIds = [
    ...new Set(dropped.flatMap((one) => [...one.exam.invigilatorIds, ...one.teacherIds])),
  ];
  if (staffIds.length === 0) return told;
  const accounts = await transaction
    .selectFrom('staff')
    .select(['id', 'account_id'])
    .where('id', 'in', staffIds)
    .where('kind', '=', 'person')
    .where('account_id', 'is not', null)
    .orderBy('id')
    .execute();
  for (const one of dropped) {
    const people = new Set([...one.exam.invigilatorIds, ...one.teacherIds]);
    for (const account of accounts) {
      if (account.account_id === null || !people.has(account.id)) continue;
      told.set(account.account_id, [
        ...(told.get(account.account_id) ?? []),
        { title: one.exam.title, date: one.exam.date },
      ]);
    }
  }
  for (const list of told.values()) {
    list.sort((a, b) => compare(a.date, b.date) || compare(a.title, b.title));
  }
  return told;
}
