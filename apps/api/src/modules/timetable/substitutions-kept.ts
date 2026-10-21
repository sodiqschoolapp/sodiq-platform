import { createHash } from 'node:crypto';
import {
  checkCandidates,
  type DatedLesson,
  type Placement,
  type RuleResult,
} from '@sodiq/timetable-rules';
import type {
  DayChangeChoice,
  DayDecisions,
  PublishRefusal,
  RuleResultAnswer,
  SubstitutionItemAnswer,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { awayAt, awaySpans } from './away-read.js';
import { examLessonKeyOf } from './calendar-exams.js';
import { patternDateOf, placeKeyOf } from './dated-lessons.js';
import {
  answerOf,
  retimed,
  type DayCategory,
  type DaySorting,
  type StoredRetime,
} from './day-changes-kept.js';
import type { KeptExam } from './exams-kept.js';
import { RETURN_RULES } from './substitution-returns.js';
import { lessonPlacesOf, placeOf } from './substitutions-read.js';

/**
 * The substitutions in force on the dates a write of dated lessons covers,
 * sorted (task 5.7b-3, pull request #193; `edge/timetable`, Versions and
 * drafts: "A substitution and a one-day move are already recorded for a date
 * after the new version starts. One-day changes, absences, room closures and
 * exams are stored on their own and applied again after a publish. The
 * preview sorts them into kept, needs a decision and dropped. Publish waits
 * until every 'needs a decision' item is settled.").
 *
 * The plan's rules (decisions 1 to 12):
 * - an item is one lesson, or a double whose halves carry rows of one record;
 * - its lesson is found in the run, with the kept one-day changes applied, by
 *   class or group, subject, date and minutes (a template change reads the
 *   stored times through `retime`); none, or a lesson the write or a kept exam
 *   cancels, is `dropped`; a new version that gives the lesson another teacher
 *   than the one replaced (or nobody, or the substitute) is `dropped` too
 *   (`06`, Filling a vacancy: "Lessons from the date go to the teacher");
 * - every other is a candidate: all candidates are put in place first (the
 *   replaced teacher off, the substitute on), so a teacher replaced on one
 *   lesson and substituting on another at that time counts once; each is then
 *   checked by the engine, oldest first, with the row's own `relaxed`
 *   (`noSubjectTeacherFree` for that placement only) and availability of a
 *   later entry a warning; a blocked result, or the substitute away at the
 *   lesson's start, makes it "needs a decision" and takes it out of the state;
 * - a "needs a decision" item is settled by `cancel` (the lesson cancelled
 *   that day with a reason, both halves) or, when the version's teacher passes
 *   the time rules against everything kept, `drop` (the version's teacher
 *   takes the lesson). `drop` is decided in the state where every other
 *   undecided item is dropped too, so no set of choices makes two teachers
 *   meet;
 * - a kept item whose lesson another "needs a decision" item may cancel (a
 *   one-day change or an exam) names it; that item's `cancel` drops it
 *   (5.6a-5b decision 13: "a cancel from any item wins").
 */

const MINUTE = 60_000;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A substitution row in force on a lesson of the run, as the sorting reads it. */
export interface StoredSubstitution {
  readonly rowId: string;
  readonly substitutionId: string;
  readonly lessonId: string;
  readonly relaxed: boolean;
  readonly replacedId: string | null;
  readonly substituteId: string;
  readonly reason: string;
  readonly absenceId: string | null;
  readonly madeAt: Date;
  readonly lesson_date: string;
  readonly class_id: string | null;
  readonly group_id: string | null;
  readonly subject_id: string;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly cancelled: boolean;
  readonly doublePairId: string | null;
}

/** A lesson of an item: the stored row and, while it may be kept, the new version's lesson. */
export interface SubstitutionLesson {
  readonly stored: StoredSubstitution;
  /** The new version's lesson at its place; `null` when it is dropped as gone or cancelled. */
  readonly matched: DatedLesson | null;
}

/** A stored substitution as sorted, with what the write needs. */
export interface SortedSubstitution {
  readonly answer: SubstitutionItemAnswer;
  readonly category: DayCategory;
  readonly lessons: readonly SubstitutionLesson[];
}

/** The rows in force on the stored lessons of `firstDate` to `lastDate`. */
export async function substitutionsBeforeOf(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly firstDate: string;
    readonly lastDate: string;
    /** Stored lessons the write leaves as they are (a kept move from outside the run). */
    readonly keptStoredIds: ReadonlySet<string>;
  },
): Promise<StoredSubstitution[]> {
  const rows = await transaction
    .selectFrom('substitution_lessons as r')
    .innerJoin('substitutions as s', 's.id', 'r.substitution_id')
    .innerJoin('lessons as l', 'l.id', 'r.lesson_id')
    .innerJoin('lesson_blocks as b', 'b.id', 'l.block_id')
    .select([
      'r.id as rowId',
      's.id as substitutionId',
      'l.id as lessonId',
      'r.relaxed',
      's.replaced_id as replacedId',
      's.substitute_id as substituteId',
      's.reason',
      's.absence_id as absenceId',
      's.made_at as madeAt',
      sql<string>`l.lesson_date::text`.as('lesson_date'),
      'l.class_id',
      'l.group_id',
      'l.subject_id',
      'l.starts_at',
      'l.ends_at',
      sql<boolean>`l.cancel_cause is not null`.as('cancelled'),
      'b.double_pair_id as doublePairId',
    ])
    .where('r.branch_id', '=', input.branchId)
    .where('r.ended_at', 'is', null)
    .whereRef('l.teacher_id', '=', 's.substitute_id')
    .where('l.lesson_date', '>=', input.firstDate)
    .where('l.lesson_date', '<=', input.lastDate)
    .orderBy('s.made_at')
    .orderBy('r.id')
    .execute();
  return rows.filter((one) => !input.keptStoredIds.has(one.lessonId));
}

const unitOf = (one: { class_id: string | null; group_id: string | null }) =>
  one.class_id ?? one.group_id ?? '';

const lessonKey = (unit: string, subject: string, date: string, start: number, end: number) =>
  `${unit}|${subject}|${date}|${String(start)}|${String(end)}`;

/** The version's teacher of a lesson of the run: its placement's, as the write gives it. */
const teacherOfLesson = (lesson: DatedLesson): string | null =>
  lesson.placement.teacherIds[0] ?? null;

/**
 * Sorts the stored substitutions of a run on its findings with the kept
 * one-day changes applied (`sorting.findings`), after its exams; answers the
 * sorting with the items and with the kept substitutes on its findings'
 * lessons, which the preview's "after" side and the write read.
 */
export async function sortSubstitutionsKept(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly sorting: DaySorting;
    readonly firstDate: string;
    readonly lastDate: string;
    readonly carriedVersionId: string | null;
    /** The run's standing exams as sorted (`sortExamsKept`). */
    readonly exams: readonly KeptExam[];
    /** The lessons the exams of the run cover (placement ids), cancelled by the write. */
    readonly examCovered?: ReadonlySet<string>;
    readonly retime?: StoredRetime;
  },
): Promise<DaySorting> {
  const { sorting } = input;
  const findings = sorting.findings;
  const before = await substitutionsBeforeOf(transaction, {
    branchId: input.branchId,
    firstDate: input.firstDate,
    lastDate: input.lastDate,
    keptStoredIds: sorting.keptStoredIds,
  });
  if (before.length === 0) return { ...sorting, substitutions: [] };

  const minutesOf = (date: string, moment: Date) =>
    Math.round((moment.getTime() - findings.begins(date).getTime()) / MINUTE);
  const lessonsBy = new Map<string, DatedLesson>();
  for (const lesson of findings.dated.lessons) {
    const { placement } = lesson;
    lessonsBy.set(
      lessonKey(
        placement.classId ?? placement.groupId ?? '',
        placement.subjectId ?? '',
        lesson.date,
        placement.start,
        placement.end,
      ),
      lesson,
    );
  }
  const covered = input.examCovered ?? new Set<string>();

  // The items: a lesson, or the halves of a double with rows of one record.
  const groups = new Map<string, StoredSubstitution[]>();
  for (const one of before) {
    const key =
      one.doublePairId === null
        ? one.rowId
        : `${one.substitutionId}|${one.doublePairId}|${one.lesson_date}`;
    groups.set(key, [...(groups.get(key) ?? []), one]);
  }

  // Whom a "needs a decision" day change or exam may cancel, by placement id.
  const mayCancel = new Map<string, string[]>();
  for (const item of sorting.items) {
    if (item.category !== 'decide') continue;
    for (const lesson of item.matched.values()) {
      const id = lesson.placement.id;
      mayCancel.set(id, [...(mayCancel.get(id) ?? []), item.answer.key]);
    }
  }
  const examClash = new Map<string, string[]>();
  for (const exam of input.exams) {
    if (exam.category !== 'decide') continue;
    for (const key of exam.clashKeys) {
      examClash.set(key, [...(examClash.get(key) ?? []), exam.exam.id]);
    }
  }
  const dependsOf = (lesson: DatedLesson): string[] => [
    ...(mayCancel.get(lesson.placement.id) ?? []),
    ...(examClash.get(examLessonKeyOf(lesson.entryId, lesson.date, lesson.placement.start)) ?? []),
  ];

  interface Draft {
    readonly key: string;
    readonly lessons: SubstitutionLesson[];
    category: DayCategory;
    dropCause: SubstitutionItemAnswer['dropCause'];
    blocked: RuleResultAnswer[];
    away: boolean;
    dropOffered: boolean;
  }
  const drafts: Draft[] = [];
  for (const rows of groups.values()) {
    const sorted = [...rows].sort((a, b) => compare(a.rowId, b.rowId));
    const lessons: SubstitutionLesson[] = [];
    let dropCause: SubstitutionItemAnswer['dropCause'] = null;
    for (const stored of sorted) {
      const times = retimed(stored, input.retime);
      const matched = lessonsBy.get(
        lessonKey(
          unitOf(stored),
          stored.subject_id,
          stored.lesson_date,
          minutesOf(stored.lesson_date, times.starts_at),
          minutesOf(stored.lesson_date, times.ends_at),
        ),
      );
      if (stored.cancelled || (matched !== undefined && covered.has(matched.placement.id))) {
        dropCause ??= 'cancelled';
        lessons.push({ stored, matched: null });
      } else if (matched === undefined) {
        dropCause ??= 'gone';
        lessons.push({ stored, matched: null });
      } else {
        if (teacherOfLesson(matched) !== stored.replacedId) dropCause ??= 'teacher';
        lessons.push({ stored, matched });
      }
    }
    const [head] = sorted;
    if (head === undefined) continue;
    drafts.push({
      key: head.rowId,
      lessons,
      category: dropCause === null ? 'kept' : 'dropped',
      dropCause,
      blocked: [],
      away: false,
      dropOffered: false,
    });
  }

  // The state with every candidate in place (spec review of the plan, must-fix 4).
  const substituted = (lesson: SubstitutionLesson): Placement | null =>
    lesson.matched === null
      ? null
      : {
          ...lesson.matched.placement,
          teacherIds: [lesson.stored.substituteId],
          substitute: true,
          relaxed: lesson.stored.relaxed,
        };
  const inPlace = new Map<string, Placement>();
  for (const draft of drafts) {
    if (draft.category !== 'kept') continue;
    for (const lesson of draft.lessons) {
      const placement = substituted(lesson);
      if (placement !== null) inPlace.set(placement.id, placement);
    }
  }
  const othersCache = new Map<string, readonly Placement[]>();
  const othersOn = async (date: string): Promise<Placement[]> => {
    let found = othersCache.get(date);
    if (found === undefined) {
      found = await sorting.othersOn(date);
      othersCache.set(date, found);
    }
    return found.map((one) => inPlace.get(one.id) ?? one);
  };
  const spans = await awaySpans(
    transaction,
    drafts.flatMap((draft) => draft.lessons.map((one) => one.stored.substituteId)),
    findings.begins(input.firstDate),
    null,
  );

  for (const draft of drafts) {
    if (draft.category !== 'kept') continue;
    const blocked: RuleResult[] = [];
    let away = false;
    for (const lesson of draft.lessons) {
      const candidate = substituted(lesson);
      if (candidate === null) continue;
      const date = lesson.stored.lesson_date;
      blocked.push(
        ...checkCandidates(await othersOn(date), findings.factsOn(date), [candidate], {
          availabilityFrom: input.firstDate,
          ...(lesson.stored.relaxed ? { noSubjectTeacherFree: true } : {}),
        }).filter((one) => one.severity === 'blocked'),
      );
      const startsAt = new Date(findings.begins(date).getTime() + candidate.start * MINUTE);
      if (awayAt(spans, lesson.stored.substituteId, startsAt) !== null) away = true;
    }
    if (blocked.length > 0 || away) {
      draft.category = 'decide';
      draft.blocked = blocked.map(answerOf);
      draft.away = away;
      for (const lesson of draft.lessons) {
        if (lesson.matched !== null) inPlace.delete(lesson.matched.placement.id);
      }
    }
  }

  // `drop` is offered when the version's teacher passes the time rules
  // against everything kept, every other undecided item dropped too.
  for (const draft of drafts) {
    if (draft.category !== 'decide') continue;
    let passes = true;
    for (const lesson of draft.lessons) {
      if (lesson.matched === null) continue;
      const date = lesson.stored.lesson_date;
      const results = checkCandidates(
        await othersOn(date),
        findings.factsOn(date),
        [lesson.matched.placement],
        { availabilityFrom: input.firstDate },
      );
      if (results.some((one) => one.severity === 'blocked' && RETURN_RULES.includes(one.rule))) {
        passes = false;
      }
    }
    draft.dropOffered = passes;
  }

  const items: SortedSubstitution[] = drafts.map((draft) => {
    const [first] = draft.lessons;
    if (first === undefined) throw new Error('An item has a lesson.');
    const { stored } = first;
    const dependsOn =
      draft.category === 'kept'
        ? [
            ...new Set(
              draft.lessons.flatMap((one) => (one.matched === null ? [] : dependsOf(one.matched))),
            ),
          ].sort(compare)
        : [];
    return {
      answer: {
        key: draft.key,
        category: draft.category,
        unitId: unitOf(stored),
        subjectId: stored.subject_id,
        lessons: draft.lessons.map((one) => {
          const times = retimed(one.stored, input.retime);
          return {
            date: one.stored.lesson_date,
            start: minutesOf(one.stored.lesson_date, times.starts_at),
            end: minutesOf(one.stored.lesson_date, times.ends_at),
          };
        }),
        replacedId: stored.replacedId,
        substituteId: stored.substituteId,
        reason: stored.reason,
        absenceId: stored.absenceId,
        carriedVersionId: input.carriedVersionId,
        blocked: draft.blocked,
        away: draft.away,
        dropOffered: draft.category === 'decide' && draft.dropOffered,
        dropCause: draft.dropCause,
        dependsOn,
      },
      category: draft.category,
      lessons: draft.lessons,
    };
  });

  return {
    ...sorting,
    substitutions: items,
    findings: substitutedFindings(sorting, items),
  };
}

/** The findings with the substitutes of the kept items on their lessons. */
function substitutedFindings(
  sorting: DaySorting,
  items: readonly SortedSubstitution[],
): DaySorting['findings'] {
  const kept = new Map<DatedLesson, StoredSubstitution>();
  for (const item of items) {
    if (item.category !== 'kept') continue;
    for (const one of item.lessons) if (one.matched !== null) kept.set(one.matched, one.stored);
  }
  if (kept.size === 0) return sorting.findings;
  const { findings } = sorting;
  return {
    ...findings,
    dated: {
      ...findings.dated,
      lessons: findings.dated.lessons.map((lesson) => {
        const stored = kept.get(lesson);
        return stored === undefined
          ? lesson
          : {
              ...lesson,
              tutorFollowed: false,
              placement: {
                ...lesson.placement,
                teacherIds: [stored.substituteId],
                substitute: true,
                relaxed: stored.relaxed,
              },
            };
      }),
    },
  };
}

/** The part of the sorting's key the substitutions give, none when there are none. */
export function substitutionKeyPartOf(items: readonly SortedSubstitution[]): string | null {
  if (items.length === 0) return null;
  const shown = items.map((one) => JSON.stringify(one.answer)).sort(compare);
  return createHash('sha256').update(JSON.stringify(shown)).digest('hex');
}

/** The decisions sent for the substitutions of a sorting, by key, with the ones they name. */
export function substitutionDecisionsOf(
  items: readonly SortedSubstitution[],
  sent: DayDecisions | undefined,
): {
  readonly decided: ReadonlyMap<string, { choice: DayChangeChoice; reason: string | null }>;
  readonly named: ReadonlySet<DayDecisions[number]>;
} {
  const keys = new Set(items.map((one) => one.answer.key));
  const decided = new Map<string, { choice: DayChangeChoice; reason: string | null }>();
  const named = new Set<DayDecisions[number]>();
  for (const one of sent ?? []) {
    if (!keys.has(one.key) || one.blockId !== undefined) continue;
    named.add(one);
    decided.set(one.key, { choice: one.choice, reason: one.reason ?? null });
  }
  return { decided, named };
}

/**
 * What refuses a write over the substitutions of its sorting: an item that
 * needs a decision and has none (`day_change_undecided`), a choice for an
 * item that needs none (`day_decision_unknown`), and a choice it does not
 * offer (`day_choice_not_offered`): `keep`, `drop` where `dropOffered` is
 * false or with a reason, `cancel` without a reason.
 */
export function substitutionRefusalsOf(
  items: readonly SortedSubstitution[],
  sent: DayDecisions | undefined,
): PublishRefusal[] {
  const refusals: PublishRefusal[] = [];
  const { decided } = substitutionDecisionsOf(items, sent);
  const byKey = new Map(items.map((one) => [one.answer.key, one]));
  for (const item of [...items].sort((a, b) => compare(a.answer.key, b.answer.key))) {
    if (item.category === 'decide' && !decided.has(item.answer.key)) {
      refusals.push({ code: 'day_change_undecided', key: item.answer.key });
    }
  }
  for (const [key, decision] of [...decided].sort(([a], [b]) => compare(a, b))) {
    const item = byKey.get(key);
    if (item === undefined || item.category !== 'decide') {
      refusals.push({ code: 'day_decision_unknown', key });
      continue;
    }
    const offered =
      decision.choice === 'drop'
        ? item.answer.dropOffered && decision.reason === null
        : decision.choice === 'cancel'
          ? decision.reason !== null
          : false;
    if (!offered) refusals.push({ code: 'day_choice_not_offered', key });
  }
  return refusals;
}

/** A kept substitution's lesson as the write reads it (`DayWritePlan.substitutes`). */
export interface SubstituteWrite {
  readonly rowId: string;
  readonly substituteId: string;
  /** `false` when another item's `cancel` cancels the lesson: the write gives it the version's teacher. */
  readonly apply: boolean;
  /** The version's teacher, written when `apply` is false. */
  readonly versionTeacherId: string | null;
}

/** The keys of the items cancelled by a decision: day changes, exams and substitutions. */
const cancelledKeys = (sent: DayDecisions | undefined): Set<string> =>
  new Set(
    (sent ?? [])
      .filter((one) => one.blockId === undefined && one.choice === 'cancel')
      .map((one) => one.key),
  );

/**
 * What the write does with the substitutions and their decisions: the kept
 * lessons by `placeKeyOf`, and the places a `cancel` cancels with its reason.
 */
export function substitutionWritePlanOf(
  items: readonly SortedSubstitution[],
  sent: DayDecisions | undefined,
): {
  readonly substitutes: ReadonlyMap<string, SubstituteWrite>;
  readonly cancels: ReadonlyMap<string, string>;
} {
  const substitutes = new Map<string, SubstituteWrite>();
  const cancels = new Map<string, string>();
  const cancelled = cancelledKeys(sent);
  const { decided } = substitutionDecisionsOf(items, sent);
  for (const item of items) {
    for (const lesson of item.lessons) {
      const { matched } = lesson;
      if (matched === null) continue;
      const place = placeKeyOf(matched.entryId, patternDateOf(matched), matched.date);
      if (item.category === 'kept') {
        substitutes.set(place, {
          rowId: lesson.stored.rowId,
          substituteId: lesson.stored.substituteId,
          apply: !item.answer.dependsOn.some((key) => cancelled.has(key)),
          versionTeacherId: lesson.stored.replacedId,
        });
      }
      const decision = decided.get(item.answer.key);
      if (item.category === 'decide' && decision?.choice === 'cancel' && decision.reason !== null) {
        cancels.set(place, decision.reason);
      }
    }
  }
  return { substitutes, cancels };
}

/** What the settling did, for the audit entry. */
export interface SubstitutionsSettled {
  /** Rows of kept items whose lesson the write created again, with their new rows. */
  readonly recordedAgain: readonly { readonly from: string; readonly to: string }[];
  /** Rows ended `dropped` here (the write ends most of them itself). */
  readonly ended: readonly string[];
}

/**
 * After the write: a kept lesson whose stored id did not survive (created
 * again in another block, or at new times) is recorded again on the new
 * lesson, its old row ended `recorded_again` by id; every row of an item not
 * kept that is still live is ended `dropped`.
 */
export async function settleSubstitutions(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly items: readonly SortedSubstitution[];
    readonly sent: DayDecisions | undefined;
    /** The lesson each kept place has after the write (`DatedWrite.substitutesPlaced`). */
    readonly placed: ReadonlyMap<string, string>;
    readonly moment: Date;
    readonly accountId: string;
  },
): Promise<SubstitutionsSettled> {
  if (input.items.length === 0) return { recordedAgain: [], ended: [] };
  const plan = substitutionWritePlanOf(input.items, input.sent);
  const again: { stored: StoredSubstitution; lessonId: string }[] = [];
  const toEnd: string[] = [];
  for (const item of input.items) {
    for (const lesson of item.lessons) {
      const { matched } = lesson;
      const place =
        matched === null ? null : placeKeyOf(matched.entryId, patternDateOf(matched), matched.date);
      const write = place === null ? undefined : plan.substitutes.get(place);
      if (item.category === 'kept' && write?.apply === true && place !== null) {
        const now = input.placed.get(place);
        if (now === undefined) throw new Error(`No lesson was written at ${place}.`);
        if (now !== lesson.stored.lessonId) again.push({ stored: lesson.stored, lessonId: now });
      } else {
        toEnd.push(lesson.stored.rowId);
      }
    }
  }
  const ended: string[] = [];
  if (toEnd.length > 0) {
    const rows = await transaction
      .updateTable('substitution_lessons')
      .set({ ended_at: input.moment, end_cause: 'dropped', ended_by: input.accountId })
      .where('branch_id', '=', input.branchId)
      .where('id', 'in', toEnd)
      .where('ended_at', 'is', null)
      .returning('id')
      .execute();
    ended.push(...rows.map((one) => one.id));
  }
  const recordedAgain: { from: string; to: string }[] = [];
  if (again.length > 0) {
    await transaction
      .updateTable('substitution_lessons')
      .set({ ended_at: input.moment, end_cause: 'recorded_again', ended_by: input.accountId })
      .where('branch_id', '=', input.branchId)
      .where(
        'id',
        'in',
        again.map((one) => one.stored.rowId),
      )
      .where('ended_at', 'is', null)
      .execute();
    const places = await lessonPlacesOf(
      transaction,
      again.map((one) => one.lessonId),
    );
    for (const one of again) {
      const row = await transaction
        .insertInto('substitution_lessons')
        .values({
          substitution_id: one.stored.substitutionId,
          branch_id: input.branchId,
          lesson_id: one.lessonId,
          lesson_date: one.stored.lesson_date,
          relaxed: one.stored.relaxed,
          ...placeOf(places, one.lessonId),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      recordedAgain.push({ from: one.stored.rowId, to: row.id });
    }
  }
  return { recordedAgain, ended: ended.sort(compare) };
}

/** The outcome of every substitution of a run for the audit entry, by key. */
export type SubstitutionsAudit = {
  kept: string[];
  dropped: string[];
  decided: { key: string; choice: DayChangeChoice }[];
  recordedAgain: { from: string; to: string }[];
};

export function substitutionAuditOf(
  items: readonly SortedSubstitution[],
  sent: DayDecisions | undefined,
  settled: SubstitutionsSettled,
): SubstitutionsAudit | null {
  if (items.length === 0) return null;
  const { decided } = substitutionDecisionsOf(items, sent);
  const cancelled = cancelledKeys(sent);
  return {
    kept: items
      .filter(
        (one) => one.category === 'kept' && !one.answer.dependsOn.some((key) => cancelled.has(key)),
      )
      .map((one) => one.answer.key)
      .sort(compare),
    dropped: items
      .filter(
        (one) =>
          one.category === 'dropped' ||
          (one.category === 'kept' && one.answer.dependsOn.some((key) => cancelled.has(key))),
      )
      .map((one) => one.answer.key)
      .sort(compare),
    decided: [...decided]
      .map(([key, one]) => ({ key, choice: one.choice }))
      .sort((a, b) => compare(a.key, b.key)),
    recordedAgain: [...settled.recordedAgain],
  };
}
