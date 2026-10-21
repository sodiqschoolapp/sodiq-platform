import { Injectable } from '@nestjs/common';
import {
  listName,
  substitutesAnswerSchema,
  type DayChangeAnswer,
  type ErrorCode,
  type LessonSubstituteBody,
  type SubstitutesAnswer,
  type SubstitutionWithdrawBody,
} from '@sodiq/shared';
import {
  RELAXED_WHEN_NO_TEACHER_FREE,
  type RuleCode,
  type RuleResult,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { Notifications } from '../notifications/notifications.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { awayAt, awaySpans } from './away-read.js';
import {
  CORRECTION_REFUSALS,
  TimetableDayChanges,
  blockedDetail,
  refuseBlocked,
  valuesOf,
} from './day-changes.service.js';
import { TimetablePattern } from './pattern.service.js';
import {
  pairOf,
  storedDayCheck,
  storedLessonsOn,
  type Services,
  type StoredDayLesson,
} from './stored-day.js';
import { endSubstitutionRows, substitutionsInForce, writeRecord } from './substitutions-read.js';
import { Timetable } from './timetable.service.js';
import { sendWeekChanges } from './week-changes.js';

/**
 * The claims and commit checks a substitution can meet after its rule check
 * (`set constraints all immediate`): the refusal its check would have given.
 */
export const SUBSTITUTION_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  ...CORRECTION_REFUSALS,
  time_claims_teacher_excl: 'substitution_blocked',
  time_claims_room_excl: 'substitution_blocked',
  time_claims_class_excl: 'substitution_blocked',
  room_shared_full: 'substitution_blocked',
  room_shared_capacity: 'substitution_blocked',
  lesson_block_student_twice: 'substitution_blocked',
};

/**
 * The same for the withdrawal. A closed vacancy is never returned: a vacancy
 * closes only when nothing from that day names it, and the fill or publish
 * that takes its rows away ends the substitutions of its lessons first
 * (`dropped`, decision 6), under the same publish lock.
 */
export const WITHDRAW_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  ...CORRECTION_REFUSALS,
  time_claims_teacher_excl: 'substitution_return_blocked',
  time_claims_room_excl: 'substitution_return_blocked',
  time_claims_class_excl: 'substitution_return_blocked',
};

/**
 * The warnings a substitution sends back for a tick (decision 2): the rules
 * relaxed when no teacher of the subject is free, and the language (`05`,
 * Substitution: "Choosing one needs a confirmation").
 */
const TICKED: readonly RuleCode[] = [...RELAXED_WHEN_NO_TEACHER_FREE, 'substitute_language'];

/** The rules a withdrawal is refused by (decision 12): a clash of time of the teacher returned. */
const RETURN_RULES: readonly RuleCode[] = ['teacher_double', 'travel_time', 'travel_time_not_set'];

/** The rules that tell a teacher without the subject or a grade of the lesson. */
const SUBJECT_RULES: readonly RuleCode[] = ['teacher_subject', 'teacher_grade'];

const GROUP_ORDER = ['subject', 'department', 'other'] as const;

interface Choices {
  readonly noSubjectTeacherFree: boolean;
  readonly teachers: SubstitutesAnswer['teachers'];
}

/**
 * The substitution of a lesson (task 5.7b-1, pull request #191; `06`,
 * Changes after publishing: "Substitution. The one way to put another
 * teacher on a lesson. It can be started from a single lesson (pick a
 * substitute for it) ... Either way one substitution record is kept: who
 * was replaced, by whom, for which lessons and why"; `edge/timetable`, After
 * publishing, "No teacher of the subject is free": "For a one-day change
 * only, 'subject in the teacher's profile' and 'outside availability' become
 * warnings that need a tick. Double booking stays blocked.").
 *
 * The substitute is written into `lessons.teacher_id` (decision 6), so the
 * teacher claim of 0058 guards them in every branch; the record and its rows
 * (0101) keep who was replaced. Both halves of a double are substituted
 * together; a part of a block alone (`edge/timetable`, Structure). A save
 * takes the locks of the one-day changes (`TimetableDayChanges.keyed` and
 * `lockedLesson`) and works on a lesson that has not started (decision 8).
 */
@Injectable()
export class TimetableSubstitutions {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
    private readonly notifications: Notifications,
    private readonly dayChanges: TimetableDayChanges,
  ) {}

  private get services(): Services {
    return { timetable: this.timetable, pattern: this.pattern };
  }

  /** The suggested substitutes of a lesson of the branch and its double's other half (decision 3). */
  substitutes(access: Access, id: string): Promise<SubstitutesAnswer> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await transaction
        .selectFrom('lessons')
        .select(sql<string>`lesson_date::text`.as('date'))
        .where('id', '=', id)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (found === undefined) {
        throw notFound();
      }
      const lessons = await storedLessonsOn(transaction, branchId, found.date);
      const lesson = lessons.find((one) => one.id === id);
      if (lesson === undefined) {
        throw notFound();
      }
      const pair = pairOf(lessons, lesson).filter((one) => one.cancelCause === null);
      const inForce = await substitutionsInForce(transaction, pair);
      const choices = await this.choicesOf(transaction, access.accountId, branchId, pair, [
        ...pair.flatMap((one) => (one.teacherId === null ? [] : [one.teacherId])),
        ...[...inForce.values()].flatMap((one) =>
          one.replacedId === null ? [] : [one.replacedId],
        ),
      ]);
      return substitutesAnswerSchema.parse(choices);
    });
  }

  /** A substitution of one lesson (both halves of a double), safe to repeat with its key. */
  substitute(
    access: Access,
    id: string,
    input: LessonSubstituteBody,
    key: string,
    requestId: string,
  ): Promise<DayChangeAnswer> {
    return this.dayChanges.keyed(
      access,
      id,
      key,
      'timetable.lesson_substitute',
      {
        teacherId: input.teacherId,
        reason: input.reason,
        ...(input.confirm === true ? { confirm: 'true' } : {}),
      },
      (transaction) => this.substituteLocked(transaction, access, id, input, requestId),
      { teachers: [input.teacherId], refusals: SUBSTITUTION_REFUSALS },
    );
  }

  /** The withdrawal of a substitution in force, safe to repeat with its key. */
  withdraw(
    access: Access,
    id: string,
    input: SubstitutionWithdrawBody,
    key: string,
    requestId: string,
  ): Promise<DayChangeAnswer> {
    return this.dayChanges.keyed(
      access,
      id,
      key,
      'timetable.lesson_substitute_withdraw',
      { reason: input.reason },
      (transaction) => this.withdrawLocked(transaction, access, id, input, requestId),
      { refusals: WITHDRAW_REFUSALS },
    );
  }

  private async substituteLocked(
    transaction: Transaction,
    access: Access,
    id: string,
    input: LessonSubstituteBody,
    requestId: string,
  ): Promise<DayChangeAnswer> {
    const branchId = branchOf(access);
    const { lesson, pair, week, moment } = await this.dayChanges.lockedLesson(
      transaction,
      branchId,
      id,
    );
    await refuseClosedYear(transaction, lesson.blockId);
    if (lesson.cancelCause !== null) {
      throw new ApiException('lesson_cancelled', 409);
    }
    // Both halves of a double; a half cancelled by another cause keeps its teacher.
    const lessons = pair.filter((one) => one.cancelCause === null);
    const inForce = await substitutionsInForce(transaction, lessons);
    const replacedOf = (one: StoredDayLesson): string | null =>
      inForce.has(one.id) ? (inForce.get(one.id)?.replacedId ?? null) : one.teacherId;
    if (lessons.some((one) => one.teacherId === input.teacherId)) {
      throw new ApiException('teacher_unchanged', 409);
    }
    if (lessons.some((one) => replacedOf(one) === input.teacherId)) {
      throw new ApiException('substitute_is_replaced', 409);
    }
    // Decision 4: a substitute away at a lesson's start is refused.
    const starts = lessons.map((one) => one.startsAt.getTime());
    const spans = await awaySpans(
      transaction,
      [input.teacherId],
      new Date(Math.min(...starts)),
      new Date(Math.max(...starts) + 1),
    );
    if (lessons.some((one) => awayAt(spans, input.teacherId, one.startsAt) !== null)) {
      throw new ApiException('substitute_away', 409);
    }
    const substitute = await transaction
      .selectFrom('staff')
      .select('account_id')
      .where('id', '=', input.teacherId)
      .executeTakeFirstOrThrow();
    // Decision 2: relaxed only when no teacher of the subject is free.
    const { noSubjectTeacherFree } = await this.choicesOf(
      transaction,
      access.accountId,
      branchId,
      lessons,
      [
        ...lessons.flatMap((one) => (one.teacherId === null ? [] : [one.teacherId])),
        ...lessons.flatMap((one) => {
          const replaced = replacedOf(one);
          return replaced === null ? [] : [replaced];
        }),
      ],
    );
    const checked = await storedDayCheck(transaction, this.services, {
      accountId: access.accountId,
      lessons,
      substitutes: new Map(
        lessons.map((one) => [
          one.id,
          { teacherId: input.teacherId, relaxed: noSubjectTeacherFree },
        ]),
      ),
    });
    await refuseBlocked(transaction, branchId, 'substitution_blocked', {
      ...checked,
      freeRooms: [],
    });
    const ticked = checked.warnings.filter((one) => TICKED.includes(one.rule));
    if (ticked.length > 0 && input.confirm !== true) {
      throw new ApiException(
        'substitution_needs_confirm',
        409,
        undefined,
        ticked.map((one) => blockedDetail(one, 'A warning of the substitution that needs a tick.')),
      );
    }

    const lessonIds = lessons.map((one) => one.id);
    // The claims are checked at the end of the change (`set constraints all
    // immediate` below), after its records are written, so a race refuses the
    // whole change (code review must-fix 8).
    await sql`set constraints time_claims_teacher_excl, time_claims_room_excl, time_claims_class_excl deferred`.execute(
      transaction,
    );
    await transaction
      .updateTable('lessons')
      .set({ teacher_id: input.teacherId })
      .where('id', 'in', lessonIds)
      .execute();
    const replacedRows = await endSubstitutionRows(transaction, {
      lessonIds,
      cause: 'replaced',
      accountId: access.accountId,
      moment,
    });
    // One record per teacher replaced: the halves of a double have one.
    const byReplaced = new Map<string | null, StoredDayLesson[]>();
    for (const one of lessons) {
      const replaced = replacedOf(one);
      byReplaced.set(replaced, [...(byReplaced.get(replaced) ?? []), one]);
    }
    const substitutionIds: string[] = [];
    for (const [replaced, group] of byReplaced) {
      substitutionIds.push(
        await writeRecord(transaction, {
          branchId,
          source: 'lesson',
          replacedId: replaced,
          substituteId: input.teacherId,
          relaxed: noSubjectTeacherFree,
          reason: input.reason,
          moment,
          accountId: access.accountId,
          lessons: group,
        }),
      );
    }
    // The commit checks of 0058 now, so that a race meets the refusals here.
    await sql`set constraints all immediate`.execute(transaction);
    const notices = await sendWeekChanges(transaction, this.notifications, week, {
      kind: 'timetable.day_changed',
      ...(substitute.account_id === null
        ? {}
        : { substitute: { accountId: substitute.account_id, date: lesson.date } }),
    });
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'lesson.substitute',
      record: { type: 'lesson', id },
      oldValue: {
        ...valuesOf(lesson),
        lessonIds,
        teacherIds: Object.fromEntries(lessons.map((one) => [one.id, one.teacherId])),
        replacedSubstitutions: replacedRows.map((one) => one.substitutionId),
      },
      newValue: {
        ...valuesOf({ ...lesson, teacherId: input.teacherId }),
        lessonIds,
        substitutionIds,
        substituteId: input.teacherId,
        replacedIds: Object.fromEntries(lessons.map((one) => [one.id, replacedOf(one)])),
        relaxed: noSubjectTeacherFree,
        reason: input.reason,
        ...(input.confirm === true ? { confirmed: true } : {}),
        warnings: checked.warnings.map((one) => one.rule),
        notices: { ...notices },
      },
      requestId,
    });
    return this.dayChanges.answerOf(transaction, branchId, id, moment, checked.warnings);
  }

  /**
   * The withdrawal (decision 12): each half with a substitution in force goes
   * back to the teacher replaced, a Tutor lesson to the class's Tutor in
   * force at its start; refused only by a clash of time.
   */
  private async withdrawLocked(
    transaction: Transaction,
    access: Access,
    id: string,
    input: SubstitutionWithdrawBody,
    requestId: string,
  ): Promise<DayChangeAnswer> {
    const branchId = branchOf(access);
    const { lesson, pair, week, moment } = await this.dayChanges.lockedLesson(
      transaction,
      branchId,
      id,
    );
    await refuseClosedYear(transaction, lesson.blockId);
    if (lesson.cancelCause !== null) {
      throw new ApiException('lesson_cancelled', 409);
    }
    const inForce = await substitutionsInForce(
      transaction,
      pair.filter((one) => one.cancelCause === null),
    );
    if (!inForce.has(id)) {
      throw new ApiException('substitution_not_in_force', 409);
    }
    const lessons = pair.filter((one) => inForce.has(one.id));
    // A teacher replaced who no longer works in the branch is not put back:
    // the lesson goes to nobody and needs a teacher (decision 12; permission
    // review, note 9).
    const replacedIds = [
      ...new Set(lessons.flatMap((one) => inForce.get(one.id)?.replacedId ?? [])),
    ];
    const linked = new Set(
      replacedIds.length === 0
        ? []
        : (
            await transaction
              .selectFrom('staff_branches')
              .select('staff_id')
              .where('staff_id', 'in', replacedIds)
              .where('branch_id', '=', branchId)
              .execute()
          ).map((one) => one.staff_id),
    );
    // Each half with its teacher replaced, no substitute: a Tutor lesson
    // follows the class's Tutor in the check (decision 12).
    const returned = lessons.map((one) => {
      const replaced = inForce.get(one.id)?.replacedId ?? null;
      return { ...one, teacherId: replaced !== null && linked.has(replaced) ? replaced : null };
    });
    const checked = await storedDayCheck(transaction, this.services, {
      accountId: access.accountId,
      lessons: returned,
      substitutes: new Map(),
    });
    const lessonIds = new Set(lessons.map((one) => one.id));
    const clashes = checked.blocked.filter(
      (one) => RETURN_RULES.includes(one.rule) && one.lessonIds.some((at) => lessonIds.has(at)),
    );
    await refuseBlocked(transaction, branchId, 'substitution_return_blocked', {
      ...checked,
      blocked: clashes,
      freeRooms: [],
    });
    // The claims are checked at the end of the change (`set constraints all
    // immediate` below), after its records are written, so a race refuses the
    // whole change (code review must-fix 8).
    await sql`set constraints time_claims_teacher_excl, time_claims_room_excl, time_claims_class_excl deferred`.execute(
      transaction,
    );
    for (const one of returned) {
      await transaction
        .updateTable('lessons')
        .set({ teacher_id: checked.teacherIds.get(one.id) ?? null })
        .where('id', '=', one.id)
        .execute();
    }
    const ended = await endSubstitutionRows(transaction, {
      lessonIds: [...lessonIds],
      cause: 'withdrawn',
      accountId: access.accountId,
      moment,
    });
    await sql`set constraints all immediate`.execute(transaction);
    const notices = await sendWeekChanges(transaction, this.notifications, week, {
      kind: 'timetable.day_changed',
    });
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'lesson.substitute_withdraw',
      record: { type: 'lesson', id },
      oldValue: {
        ...valuesOf(lesson),
        lessonIds: [...lessonIds],
        substitutionIds: [...new Set(ended.map((one) => one.substitutionId))],
      },
      newValue: {
        ...valuesOf({ ...lesson, teacherId: checked.teacherIds.get(id) ?? null }),
        lessonIds: [...lessonIds],
        teacherIds: Object.fromEntries(checked.teacherIds),
        reason: input.reason,
        notices: { ...notices },
      },
      requestId,
    });
    return this.dayChanges.answerOf(transaction, branchId, id, moment, []);
  }

  /**
   * The suggested substitutes of `lessons` (one lesson or the halves of a
   * double) and whether a teacher of the subject is free (decisions 2 and
   * 3): the branch's persons with a subject in the profile, not away at a
   * lesson's start, `excluded` (the lessons' teachers and the teachers
   * replaced) left out, each checked with the engine as the substitute.
   */
  private async choicesOf(
    transaction: Transaction,
    accountId: string,
    branchId: string,
    lessons: readonly StoredDayLesson[],
    excluded: readonly string[],
  ): Promise<Choices> {
    const out = new Set(excluded);
    const people = (
      await transaction
        .selectFrom('staff')
        .innerJoin('staff_branches', 'staff_branches.staff_id', 'staff.id')
        .select(['staff.id', 'staff.first_name', 'staff.last_name'])
        .where('staff_branches.branch_id', '=', branchId)
        .where('staff.kind', '=', 'person')
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('staff_subjects')
              .select('staff_subjects.staff_id')
              .whereRef('staff_subjects.staff_id', '=', 'staff.id'),
          ),
        )
        .execute()
    ).filter((one) => !out.has(one.id));
    const starts = lessons.map((one) => one.startsAt.getTime());
    const spans = await awaySpans(
      transaction,
      people.map((one) => one.id),
      new Date(Math.min(...starts)),
      new Date(Math.max(...starts) + 1),
    );
    const pool = people.filter((one) =>
      lessons.every((lesson) => awayAt(spans, one.id, lesson.startsAt) === null),
    );
    const [first] = lessons;
    if (pool.length === 0 || first === undefined) {
      return { noSubjectTeacherFree: true, teachers: [] };
    }
    const checked = await storedDayCheck(transaction, this.services, {
      accountId,
      lessons,
      substitutes: new Map(),
      candidates: pool.map((one) => one.id),
    });
    // The subject's department, and the departments of the pool (the
    // record's own, as the department move writes it: 3.4c decision 2).
    const subject = await transaction
      .selectFrom('subjects')
      .select('department_id')
      .where('id', '=', first.subjectId)
      .executeTakeFirstOrThrow();
    const inDepartment = new Set(
      (
        await transaction
          .selectFrom('staff_divisions')
          .select('staff_id')
          .where(
            'staff_id',
            'in',
            pool.map((one) => one.id),
          )
          .where('department_id', '=', subject.department_id)
          .execute()
      ).map((one) => one.staff_id),
    );
    const rated = pool.flatMap((one) => {
      const result = checked.candidates.get(one.id);
      if (result === undefined) return [];
      const rules = (list: readonly RuleResult[]) => list.map((found) => found.rule);
      const warnings = rules(result.warnings);
      const ofSubject = ![...rules(result.blocked), ...warnings].some((rule) =>
        SUBJECT_RULES.includes(rule),
      );
      return [
        {
          id: one.id,
          name: listName({ firstName: one.first_name ?? '', lastName: one.last_name ?? '' }),
          choosable: result.blocked.length === 0,
          free:
            result.blocked.length === 0 &&
            !warnings.some((rule) => RELAXED_WHEN_NO_TEACHER_FREE.includes(rule)),
          group: ofSubject
            ? ('subject' as const)
            : inDepartment.has(one.id)
              ? ('department' as const)
              : ('other' as const),
          language: warnings.includes('substitute_language'),
          warnings: [...new Set(warnings)],
        },
      ];
    });
    const noSubjectTeacherFree = !rated.some((one) => one.free && one.group === 'subject');
    const teachers = rated
      .filter((one) => (noSubjectTeacherFree ? one.choosable : one.free && one.group === 'subject'))
      .sort(
        (a, b) =>
          Number(a.language) - Number(b.language) ||
          GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      )
      .map(({ id, name, group, language, warnings }) => ({ id, name, group, language, warnings }));
    return { noSubjectTeacherFree, teachers };
  }
}

/** A lesson of a closed year is not substituted (decision 8). */
async function refuseClosedYear(transaction: Transaction, blockId: string): Promise<void> {
  const year = await transaction
    .selectFrom('lesson_blocks')
    .innerJoin('academic_years', 'academic_years.id', 'lesson_blocks.academic_year_id')
    .select('academic_years.status')
    .where('lesson_blocks.id', '=', blockId)
    .executeTakeFirstOrThrow();
  if (year.status === 'closed') {
    throw new ApiException('timetable_year_closed', 409);
  }
}
