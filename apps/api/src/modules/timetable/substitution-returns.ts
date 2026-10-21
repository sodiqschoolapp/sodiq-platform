import type { RuleCode, RuleResult } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import {
  pairOf,
  storedDayCheck,
  storedLessonsOn,
  type Services,
  type StoredDayLesson,
  type StoredDayResult,
} from './stored-day.js';
import { endSubstitutionRows, substitutionsInForce } from './substitutions-read.js';

/** The rules a return is stopped by (task 5.7b-1, decision 12): a clash of time of the teacher returned. */
export const RETURN_RULES: readonly RuleCode[] = [
  'teacher_double',
  'travel_time',
  'travel_time_not_set',
];

/**
 * The return of substituted lessons (one lesson, or the halves of a double)
 * to the teacher replaced (task 5.7b-1, decision 12): each with its teacher
 * replaced, no substitute, a Tutor lesson following the class's Tutor in
 * the check; a teacher replaced who no longer works in the branch gives the
 * lesson to nobody ("needs a teacher"; permission review, note 9). Answers
 * the check and its clashes; nothing is written. The withdrawal refuses on a
 * clash, a shortened absence keeps the lesson with its substitute (task
 * 5.7b-2, decision 2 with review correction 2).
 */
export async function returnCheck(
  transaction: Transaction,
  services: Services,
  input: {
    readonly accountId: string;
    readonly branchId: string;
    readonly lessons: readonly StoredDayLesson[];
    readonly replacedOf: ReadonlyMap<string, string | null>;
  },
): Promise<{
  readonly returned: readonly StoredDayLesson[];
  readonly checked: StoredDayResult;
  readonly clashes: readonly RuleResult[];
}> {
  const replacedIds = [
    ...new Set(input.lessons.flatMap((one) => input.replacedOf.get(one.id) ?? [])),
  ];
  const linked = new Set(
    replacedIds.length === 0
      ? []
      : (
          await transaction
            .selectFrom('staff_branches')
            .select('staff_id')
            .where('staff_id', 'in', replacedIds)
            .where('branch_id', '=', input.branchId)
            .execute()
        ).map((one) => one.staff_id),
  );
  const returned = input.lessons.map((one) => {
    const replaced = input.replacedOf.get(one.id) ?? null;
    return { ...one, teacherId: replaced !== null && linked.has(replaced) ? replaced : null };
  });
  const checked = await storedDayCheck(transaction, services, {
    accountId: input.accountId,
    lessons: returned,
    substitutes: new Map(),
  });
  const ids = new Set(input.lessons.map((one) => one.id));
  const clashes = checked.blocked.filter(
    (one) => RETURN_RULES.includes(one.rule) && one.lessonIds.some((at) => ids.has(at)),
  );
  return { returned, checked, clashes };
}

/** What a return of an absence's lessons did in one branch (task 5.7b-2, decision 2). */
export interface Returned {
  readonly returned: readonly string[];
  readonly kept: readonly { lessonId: string; date: string; rules: string[] }[];
  readonly substitutionIds: readonly string[];
  readonly teacherIds: Readonly<Record<string, string | null>>;
}

/**
 * Returns the lessons named (each with a substitution in force) of one
 * branch to their teachers replaced, both halves of a double together, and
 * ends their rows with `returned`; a lesson whose return clashes keeps its
 * substitute and is listed (task 5.7b-2, decisions 1 and 2). The caller
 * holds the publish lock and the snapshot of the dates, and defers the
 * claims until its records are written.
 */
export async function returnLessons(
  transaction: Transaction,
  services: Services,
  input: {
    readonly accountId: string;
    readonly branchId: string;
    readonly moment: Date;
    readonly lessonIds: readonly string[];
  },
): Promise<Returned> {
  const wanted = new Set(input.lessonIds);
  const dates = (
    await transaction
      .selectFrom('lessons')
      .select(sql<string>`lesson_date::text`.as('date'))
      .distinct()
      .where('branch_id', '=', input.branchId)
      .where('id', 'in', [...wanted])
      .execute()
  )
    .map((one) => one.date)
    .sort();
  const returned: string[] = [];
  const kept: { lessonId: string; date: string; rules: string[] }[] = [];
  const teacherIds: Record<string, string | null> = {};
  for (const date of dates) {
    const lessons = await storedLessonsOn(transaction, input.branchId, date);
    const done = new Set<string>();
    for (const lesson of lessons) {
      if (!wanted.has(lesson.id) || done.has(lesson.id)) continue;
      const unit = pairOf(lessons, lesson).filter((one) => wanted.has(one.id));
      for (const one of unit) done.add(one.id);
      const inForce = await substitutionsInForce(transaction, unit);
      const inUnit = unit.filter((one) => inForce.has(one.id));
      if (inUnit.length === 0) continue;
      const { checked, clashes } = await returnCheck(transaction, services, {
        accountId: input.accountId,
        branchId: input.branchId,
        lessons: inUnit,
        replacedOf: new Map(inUnit.map((one) => [one.id, inForce.get(one.id)?.replacedId ?? null])),
      });
      if (clashes.length > 0) {
        const rules = [...new Set(clashes.map((one) => one.rule))].sort();
        for (const one of inUnit) kept.push({ lessonId: one.id, date, rules });
        continue;
      }
      for (const one of inUnit) {
        const teacherId = checked.teacherIds.get(one.id) ?? null;
        await transaction
          .updateTable('lessons')
          .set({ teacher_id: teacherId })
          .where('id', '=', one.id)
          .execute();
        teacherIds[one.id] = teacherId;
        returned.push(one.id);
      }
    }
  }
  const ended =
    returned.length === 0
      ? []
      : await endSubstitutionRows(transaction, {
          lessonIds: returned,
          cause: 'returned',
          accountId: input.accountId,
          moment: input.moment,
        });
  return {
    returned: returned.sort(),
    kept: kept.sort((a, b) => a.date.localeCompare(b.date) || a.lessonId.localeCompare(b.lessonId)),
    substitutionIds: [...new Set(ended.map((one) => one.substitutionId))].sort(),
    teacherIds,
  };
}
