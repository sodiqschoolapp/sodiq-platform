import { Injectable } from '@nestjs/common';
import {
  classDisplayName,
  examCheckSchema,
  examSaveAnswerSchema,
  examsAnswerSchema,
  listName,
  weekdaySchema,
  type ErrorCode,
  type ErrorDetail,
  type Exam,
  type ExamCancelBody,
  type ExamCheck,
  type ExamCheckInput,
  type ExamInput,
  type ExamSaveAnswer,
  type ExamsAnswer,
  type ExamsQuery,
} from '@sodiq/shared';
import {
  weekdayOf,
  type EngineDay,
  type EngineUnit,
  type RuleResult,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { Notifications } from '../notifications/notifications.service.js';
import { notFound } from '../setup/setup-refusals.js';
import {
  examLessonsOf,
  storedChoicesOf,
  storedExamLessonsOn,
  type ExamBlockChoice,
  type ExamChoiceOf,
  type ExamDayLesson,
  type StandingExam,
} from './calendar-exams.js';
import { classSlotsOn, dayLessonsOf } from './day-changes.service.js';
import { examCheck, examDayOf } from './exam-check.js';
import { versionOnDate } from './version-on-date.js';
import {
  ratingJournalsOf,
  ratingNamesOf,
  refuseRatingSubject,
  refuseRatingTaken,
  storedRating,
  writeRating,
  type RatingJournals,
} from './exam-rating.js';
import { TimetablePattern } from './pattern.service.js';
import {
  PUBLISH_LOCK,
  PUBLISH_REFUSALS,
  lockPublishChain,
  refusingPublish,
} from './publish.service.js';
import { pairOf, storedDayCheck, storedLessonsOn, type StoredDayLesson } from './stored-day.js';
import { Timetable } from './timetable.service.js';
import {
  sendWeekChanges,
  snapshotDates,
  snapshotWeek,
  type Invigilation,
  type WeekSnapshot,
} from './week-changes.js';

/**
 * Exams in the timetable (task 5.6c-1, pull request #181; docs/spec/
 * 06-timetable.md, Changes after publishing, Exam; edge-cases/timetable.md,
 * Exams): the exams of a range, and the create, change and cancel of one.
 *
 * A save takes the locks of a lesson writer (the publish lock, the branch,
 * the year `for share` and the people of the branch, then the blocks of its
 * date or dates), checks the exam whole with the rule engine against the
 * stored lessons, the branch's other exams and the other branches' claims,
 * and writes in one transaction (spec review of the plan, must-fix 4): the
 * exam and its rooms, classes, groups and invigilators first, then the
 * lessons it covers cancelled "exam" with a link to it (`lesson_exam_cancels`,
 * 0094), then the lessons it no longer covers given back by the rule for a
 * restored lesson (a lesson another standing exam keeps stays cancelled;
 * one that cannot be restored refuses the save unless kept cancelled with a
 * reason, decision 3). Then the notices (one per person, decision 2) and the
 * audit entry.
 */

/** The claims and checks of the database a save can meet, as refusals. */
export const EXAM_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  ...PUBLISH_REFUSALS,
  time_claims_teacher_excl: 'exam_blocked',
  time_claims_room_excl: 'exam_blocked',
  time_claims_class_excl: 'exam_blocked',
  room_shared_full: 'exam_blocked',
  room_shared_capacity: 'exam_blocked',
  lesson_block_student_twice: 'exam_blocked',
  lesson_block_class_out_exam: 'exam_blocked',
  exam_year: 'exam_year',
  exam_date: 'exam_year',
  exam_group_slots: 'exam_group_slots',
  exam_group_subject: 'exam_group_subject',
  exam_unit_year: 'exam_unit_year',
  exam_cancel_final: 'exam_cancelled',
  exam_rating_journal: 'exam_rating_journal',
};

const MINUTE = 60_000;

/** What a save stores with its request key: ids only. */
interface ExamSaved {
  readonly examId: string;
  readonly warnings: string[];
}

/** An exam as stored, with what it seats and who invigilates where. */
interface StoredExam {
  readonly id: string;
  readonly yearId: string;
  readonly date: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly firstSlot: number;
  readonly lastSlot: number;
  readonly title: string;
  readonly subjectId: string | null;
  readonly ratingExam: boolean;
  readonly cancelCause: string | null;
  readonly rooms: readonly {
    readonly roomId: string;
    readonly classIds: string[];
    readonly groupIds: string[];
    readonly invigilatorIds: string[];
  }[];
  readonly outs: readonly { readonly blockId: string; readonly classId: string }[];
}

/** The new state of the exam a save checks and writes. */
interface Planned {
  readonly standing: StandingExam;
  readonly time: { readonly start: number; readonly end: number };
  readonly firstSlot: number;
  readonly lastSlot: number;
  readonly begins: Date;
  readonly covered: ReadonlySet<string>;
  readonly outs: readonly { readonly blockId: string; readonly classId: string }[];
  readonly chosen: readonly {
    readonly classId: string;
    readonly start: number;
    readonly choice: ExamBlockChoice;
  }[];
  readonly warnings: readonly RuleResult[];
}

/**
 * What a check (task 5.6c-2, decision 3 of its plan) collects in place of
 * the refusals a person settles in the dialog: the lessons the exam covers,
 * every shared block with the choice it took, the blocked rules and the
 * warnings (`null` until worked out), and what a change gives back.
 */
interface CheckFound {
  cancels: string[];
  choices: {
    readonly classId: string;
    readonly blockId: string;
    readonly lessonIds: readonly string[];
    readonly otherClassIds: readonly string[];
    readonly choice: ExamBlockChoice | null;
    readonly stored: ExamBlockChoice | null;
  }[];
  blocked: ErrorDetail[] | null;
  warnings: ErrorDetail[] | null;
  givenBack:
    | { readonly lessonId: string; readonly state: GivenBackState; readonly rules: ErrorDetail[] }[]
    | null;
  freeRooms: string[];
  /** The journals a save would store (task 5.6c-3b); `null`: not a rating exam. */
  rating: RatingJournals | null;
}

type GivenBackState = 'restored' | 'blocked' | 'kept' | 'restorable' | 'otherExam';

/** Ends a check's run of the save at the point its answer is known. */
class CheckDone extends Error {
  constructor() {
    super('check');
  }
}

/** Carries the answer of a check out of the transaction it rolls back. */
class PreviewDone extends Error {
  constructor(readonly answer: ExamCheck) {
    super('preview');
  }
}

const ruleDetail = (result: RuleResult, message: string): ErrorDetail => ({
  path: `rules.${result.rule}`,
  code: result.rule,
  message,
  rule: { weekday: weekdaySchema.parse(weekdayOf(result.day)), lessonIds: [...result.lessonIds] },
  day: result.day,
});

const dayKeyOf = (day: EngineDay): string =>
  day.lessons
    ? day.day.slots
        .map((slot) => `${slot.kind}:${String(slot.start)}-${String(slot.end)}`)
        .join(',')
    : `none:${day.reason}`;

@Injectable()
export class TimetableExams {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly requestKeys: RequestKeys,
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
    private readonly notifications: Notifications,
  ) {}

  /** The branch's exams of a range of dates, standing and cancelled. */
  list(access: Access, query: ExamsQuery): Promise<ExamsAnswer> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const rows = await transaction
        .selectFrom('exams')
        .select('id')
        .where('branch_id', '=', branchId)
        .where('exam_date', '>=', query.from)
        .where('exam_date', '<=', query.to)
        .orderBy('exam_date')
        .orderBy('starts_at')
        .orderBy('id')
        .execute();
      return examsAnswerSchema.parse({
        exams: await examsOf(
          transaction,
          branchId,
          rows.map((one) => one.id),
        ),
      });
    });
  }

  /** One exam of the branch; another branch's or an unknown one is 404. */
  one(access: Access, id: string): Promise<Exam> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const [exam] = await examsOf(transaction, branchId, [id]);
      if (exam === undefined) throw notFound();
      return exam;
    });
  }

  /** A new exam, safe to repeat with its key. */
  create(
    access: Access,
    input: ExamInput,
    key: string,
    requestId: string,
  ): Promise<ExamSaveAnswer> {
    return this.keyed(access, null, input, key, 'timetable.exam_create', (transaction) =>
      this.save(transaction, access, null, input, requestId),
    );
  }

  /** A change of an exam: the whole exam checked again, safe to repeat with its key. */
  change(
    access: Access,
    id: string,
    input: ExamInput,
    key: string,
    requestId: string,
  ): Promise<ExamSaveAnswer> {
    return this.keyed(access, id, input, key, 'timetable.exam_change', (transaction) =>
      this.save(transaction, access, id, input, requestId),
    );
  }

  /** The cancel of an exam (final), safe to repeat with its key. */
  cancel(
    access: Access,
    id: string,
    input: ExamCancelBody,
    key: string,
    requestId: string,
  ): Promise<ExamSaveAnswer> {
    return this.keyed(access, id, input, key, 'timetable.exam_cancel', (transaction) =>
      this.cancelLocked(transaction, access, id, input, requestId),
    );
  }

  /**
   * What a save of the body would do (task 5.6c-2): the save itself run in
   * its transaction with the person's choices, its refusals of the dialog
   * collected (decision 3 of the plan), then rolled back (`PreviewDone`, the
   * pattern of the calendar preview). No request key, no notice, no audit
   * entry. The refusals of the exam's shape answer as the save's.
   */
  async check(access: Access, input: ExamCheckInput): Promise<ExamCheck> {
    const branchId = branchOf(access);
    try {
      await refusingPublish(
        () =>
          this.transactions.run(access.branchIds, async (transaction) => {
            await refuseForeignIds(transaction, branchId, input.examId ?? null, input);
            await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
            const stored =
              input.examId === undefined
                ? null
                : await readExam(transaction, branchId, input.examId);
            // The lessons as they stand, read before the save writes.
            const dates = [...new Set([stored?.date ?? input.date, input.date])];
            const before = (
              await Promise.all(dates.map((date) => storedLessonsOn(transaction, branchId, date)))
            ).flat();
            const moment = await transactionMoment(transaction);
            const found: CheckFound = {
              cancels: [],
              choices: [],
              blocked: null,
              warnings: null,
              givenBack: null,
              freeRooms: [],
              rating: null,
            };
            try {
              await this.save(
                transaction,
                access,
                input.examId ?? null,
                { ...input, confirm: true },
                '',
                found,
              );
            } catch (error) {
              if (!(error instanceof CheckDone)) throw error;
            }
            throw new PreviewDone(await checkAnswer(transaction, before, moment, found));
          }),
        EXAM_REFUSALS,
      );
    } catch (error) {
      if (error instanceof PreviewDone) return error.answer;
      throw error;
    }
    // The work above always throws, the answer or a refusal; TypeScript cannot see that.
    throw new ApiException('internal_error', 500);
  }

  /**
   * Every id of the path and the body against the branch before any lock
   * (`.claude/rules/api.md`), then the publish lock, then the work once.
   */
  private keyed(
    access: Access,
    id: string | null,
    input: Partial<ExamInput> & { keepCancelled?: string[] | undefined },
    key: string,
    scope: string,
    work: (transaction: Transaction) => Promise<ExamSaved>,
  ): Promise<ExamSaveAnswer> {
    const branchId = branchOf(access);
    return refusingPublish(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await refuseForeignIds(transaction, branchId, id, input);
          await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
          const once = await this.requestKeys.runOnce(
            transaction,
            {
              key,
              scope,
              accountId: access.accountId,
              input: { examId: id ?? '', body: JSON.stringify(input) },
            },
            async () => (await work(transaction)) as unknown as JsonValue,
          );
          // The stored answer holds ids only (`request-keys.ts`); the exam
          // with its names is read on every request, a repeat included.
          const stored = once.result as unknown as ExamSaved;
          const [exam] = await examsOf(transaction, branchId, [stored.examId]);
          if (exam === undefined) throw notFound();
          return examSaveAnswerSchema.parse({ exam, warnings: stored.warnings });
        }),
      EXAM_REFUSALS,
    );
  }

  /** A create (`id` null) or a change. */
  private async save(
    transaction: Transaction,
    access: Access,
    id: string | null,
    input: ExamInput,
    requestId: string,
    found: CheckFound | null = null,
  ): Promise<ExamSaved> {
    const branchId = branchOf(access);
    const yearId = await yearOfDate(transaction, branchId, input.date);
    if (yearId === null) throw new ApiException('exam_year', 409);
    const before = id === null ? null : await readExam(transaction, branchId, id);
    if (before !== null && before.yearId !== yearId) throw new ApiException('exam_year', 409);
    await lockPublishChain(transaction, branchId, yearId);
    const snapshot =
      before === null || before.date === input.date
        ? await snapshotWeek(transaction, branchId, input.date, input.date)
        : await snapshotDates(transaction, branchId, [before.date, input.date]);
    const stored = id === null ? null : await lockedExam(transaction, branchId, id);
    const moment = await transactionMoment(transaction);
    if (stored !== null && stored.startsAt.getTime() <= moment.getTime()) {
      throw new ApiException('exam_started', 409);
    }
    // A date before today is past whatever the version (`06`: "from today on").
    if (input.date < (await this.timetable.todayIn(transaction, branchId))) {
      throw new ApiException('exam_started', 409);
    }
    const versionId = (await versionOnDate(transaction, branchId, yearId, input.date))?.id ?? null;
    if (versionId === null) throw new ApiException('exam_no_timetable', 409);

    // Task 5.6c-3b: the journals of a rating exam, from the memberships on
    // its date (decisions 1, 4 and 9), refused for a subject without one or
    // a journal another rating exam of the quarter links (decisions 2, 5).
    const rating = await ratingFor(transaction, {
      branchId,
      yearId,
      examId: stored?.id ?? null,
      input,
    });
    if (found !== null) found.rating = rating;

    const planned = await this.plan(transaction, access, {
      branchId,
      versionId,
      examId: stored?.id ?? null,
      stored,
      input,
      moment,
      found,
    });

    // The write (must-fix 4): the exam and its rooms first, its claims
    // following through the triggers of 0060; the constraints deferred over
    // the span, so that the new claims meet the lessons they cancel.
    await sql`set constraints all deferred`.execute(transaction);
    const values = {
      exam_date: input.date,
      starts_at: new Date(planned.begins.getTime() + planned.time.start * MINUTE),
      ends_at: new Date(planned.begins.getTime() + planned.time.end * MINUTE),
      first_slot: planned.firstSlot,
      last_slot: planned.lastSlot,
      title: input.title,
      subject_id: input.subjectId,
      rating_exam: input.ratingExam,
    };
    const examId =
      stored === null
        ? (
            await transaction
              .insertInto('exams')
              .values({ branch_id: branchId, academic_year_id: yearId, ...values })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id
        : stored.id;
    if (stored !== null) {
      await transaction.updateTable('exams').set(values).where('id', '=', examId).execute();
      await transaction.deleteFrom('exam_rooms').where('exam_id', '=', examId).execute();
    }
    await writeRooms(transaction, branchId, examId, input.rooms);
    const outs = await writeOuts(transaction, branchId, examId, stored?.outs ?? [], planned.outs);
    await writeRating(transaction, branchId, examId, rating);
    const cancelled = await cancelCovered(
      transaction,
      branchId,
      examId,
      input.date,
      planned.covered,
    );
    const released = await this.release(transaction, access, {
      branchId,
      examId,
      dates: [...new Set([stored?.date ?? input.date, input.date])],
      keep: planned.covered,
      keepCancelled: input.keepCancelled ?? [],
      keepReason: input.keepReason ?? null,
      found,
    });
    // A lesson the save would refuse to give back keeps no link and no
    // restore: the save stops here, and so does its check, before the
    // constraints would refuse what the save never commits.
    if (found?.givenBack?.some((one) => one.state === 'blocked' || one.state === 'restorable')) {
      throw new CheckDone();
    }
    await sql`set constraints all immediate`.execute(transaction);
    // A check ends here, before the notices and the audit entry (task 5.6c-2).
    if (found !== null) throw new CheckDone();

    const after = await readExam(transaction, branchId, examId);
    const notices = await this.tell(transaction, snapshot, {
      action: stored === null ? 'created' : 'changed',
      before: stored,
      after,
    });
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: stored === null ? 'exam.create' : 'exam.change',
      record: { type: 'exam', id: examId },
      oldValue: stored === null ? null : auditOf(stored),
      newValue: {
        ...auditOf(after),
        lessonsCancelled: cancelled,
        ...released,
        outsAdded: outs.added,
        outsRemoved: outs.removed,
        choices: planned.chosen.map((one) => ({ ...one })),
        warnings: planned.warnings.map((one) => one.rule),
        rating:
          rating === null ? null : { linked: [...rating.linked], notLinked: [...rating.notLinked] },
        notices: { ...notices },
      },
      requestId,
    });
    return { examId, warnings: planned.warnings.map((one) => one.rule) };
  }

  /**
   * The new state of the exam on its date: its day and slots, the lessons it
   * covers with the choices for shared blocks, and the rule check; every
   * refusal before the write.
   */
  private async plan(
    transaction: Transaction,
    access: Access,
    input: {
      readonly branchId: string;
      readonly versionId: string;
      readonly examId: string | null;
      readonly stored: StoredExam | null;
      readonly input: ExamInput;
      readonly moment: Date;
      /** A check's collector (task 5.6c-2): the refusals of the dialog collected, not thrown. */
      readonly found: CheckFound | null;
    },
  ): Promise<Planned> {
    const { branchId, input: body, moment } = input;
    const services = { timetable: this.timetable, pattern: this.pattern };
    const standing = await standingOf(transaction, input.examId ?? 'new', body);
    const day = await examDayOf(transaction, services, {
      accountId: access.accountId,
      branchId,
      versionId: input.versionId,
      date: body.date,
    });
    const days = standing.grades.map((grade) => day.dayOf(grade));
    if (days.some((one) => !one.lessons)) {
      const dayOff: ErrorDetail = {
        path: 'date',
        code: 'day_off',
        message: 'The date has no lessons for a class of the exam.',
      };
      // Before any choice (plan review correction 2): no block is read.
      if (input.found !== null) {
        input.found.blocked = [dayOff];
        input.found.warnings = [];
        throw new CheckDone();
      }
      throw new ApiException('exam_blocked', 409, undefined, [dayOff]);
    }
    if (new Set(days.map(dayKeyOf)).size > 1) throw new ApiException('exam_templates', 409);
    const [first] = days;
    const slots = first?.lessons === true ? first.day.slots : [];
    const firstSlot = slots.find(
      (slot) => slot.kind === 'lesson' && slot.lessonNumber === body.firstLesson,
    );
    const lastSlot = slots.find(
      (slot) => slot.kind === 'lesson' && slot.lessonNumber === body.lastLesson,
    );
    if (firstSlot === undefined || lastSlot === undefined) {
      throw new ApiException('exam_slots', 409, undefined, [
        { path: 'firstLesson', code: 'exam_slots', message: 'Not a lesson slot of the day.' },
      ]);
    }
    const time = { start: firstSlot.start, end: lastSlot.end };
    if (day.begins.getTime() + time.start * MINUTE <= moment.getTime()) {
      throw new ApiException('exam_started', 409);
    }

    const lessons = await storedExamLessonsOn(transaction, branchId, body.date, day.begins);
    // The stored choices are read with the stored exam's own classes and
    // groups (code review round 1, change 1): a block shared only under the
    // new classes was never chosen for, and is asked for again.
    const storedStanding =
      input.stored === null
        ? null
        : await standingOf(transaction, input.stored.id, {
            ...body,
            rooms: input.stored.rooms.map((room) => ({ ...room })),
          });
    const { choiceOf, storedOf } = choicesOf(
      body,
      lessons,
      input.stored,
      storedStanding,
      day.begins,
    );
    const found = examLessonsOf({ ...standing, date: body.date }, time, lessons, choiceOf);
    const checking = input.found;
    if (checking !== null) {
      // Every shared block, chosen or not: the same walk with no choice
      // lists them all as needs (task 5.6c-2).
      const shared = examLessonsOf({ ...standing, date: body.date }, time, lessons, () => null);
      const sitting = new Set(standing.classIds);
      checking.cancels = [...found.covered].sort();
      checking.choices = shared.needs.map((need) => {
        const block = {
          patternBlockIds: [...new Set(need.lessons.map((one) => one.patternBlockId))].sort(),
          start: need.start,
        };
        return {
          classId: need.classId,
          blockId: need.lessons[0]?.blockId ?? NO_ID,
          lessonIds: need.lessons.map((one) => one.id),
          otherClassIds: [
            ...new Set(
              need.lessons.flatMap((one) => one.classIds.filter((id) => !sitting.has(id))),
            ),
          ].sort(),
          choice: choiceOf(need.classId, block),
          stored: storedOf(need.classId, block),
        };
      });
      // With a choice missing the rule check cannot run (plan review must-fix 1).
      if (found.needs.length > 0) throw new CheckDone();
    }
    if (found.needs.length > 0) {
      throw new ApiException(
        'exam_block_choice',
        409,
        undefined,
        found.needs.map((need) => ({
          path: 'blockChoices',
          code: 'exam_block_choice',
          message: 'A block shared with classes that do not sit needs a choice.',
          classId: need.classId,
          recordId: need.lessons[0]?.blockId,
          rule: { weekday: null, lessonIds: need.lessons.map((one) => one.id) },
        })),
      );
    }
    if (found.groupMisses) throw new ApiException('exam_group_slots', 409);

    // Started lessons are never rewritten, nor a double whose earlier half
    // has started (must-fix 9).
    const storedDay = await storedLessonsOn(transaction, branchId, body.date);
    const linked = input.examId === null ? [] : await linkedLessons(transaction, input.examId);
    const touched = storedDay.filter(
      (one) => (found.covered.has(one.id) && one.cancelCause === null) || linked.includes(one.id),
    );
    refuseStarted(storedDay, touched, moment);
    // A change of date gives back the lessons of the old date: none of them,
    // nor an earlier half of their double, may have started (must-fix 4).
    if (input.stored !== null && input.stored.date !== body.date) {
      const oldDay = await storedLessonsOn(transaction, branchId, input.stored.date);
      refuseStarted(
        oldDay,
        oldDay.filter((one) => linked.includes(one.id)),
        moment,
      );
    }

    const checked = await examCheck(transaction, services, {
      accountId: access.accountId,
      branchId,
      versionId: input.versionId,
      candidate: { exam: standing, time, subjectId: body.subjectId, rooms: body.rooms },
      skipped: found.covered,
      outs: found.outs,
    });
    if (checking !== null) {
      checking.blocked = checked.blocked.map((one) =>
        ruleDetail(one, 'A blocked rule of the exam on its date.'),
      );
      checking.warnings = checked.warnings.map((one) =>
        ruleDetail(one, 'A warning of the exam that needs a tick.'),
      );
      // The lessons given back are checked only against an exam that can be
      // written (plan review must-fix 2).
      if (checked.blocked.length > 0) throw new CheckDone();
    }
    if (checked.blocked.length > 0) {
      throw new ApiException(
        'exam_blocked',
        409,
        undefined,
        checked.blocked.map((one) => ruleDetail(one, 'A blocked rule of the exam on its date.')),
      );
    }
    if (checked.warnings.length > 0 && !body.confirm) {
      throw new ApiException(
        'exam_warnings',
        409,
        undefined,
        checked.warnings.map((one) => ruleDetail(one, 'A warning of the exam that needs a tick.')),
      );
    }
    return {
      standing,
      time,
      firstSlot: firstSlot.position,
      lastSlot: lastSlot.position,
      begins: day.begins,
      covered: found.covered,
      outs: found.outs,
      chosen: found.chosen,
      warnings: checked.warnings,
    };
  }

  private async cancelLocked(
    transaction: Transaction,
    access: Access,
    id: string,
    input: ExamCancelBody,
    requestId: string,
  ): Promise<ExamSaved> {
    const branchId = branchOf(access);
    const before = await readExam(transaction, branchId, id);
    await lockPublishChain(transaction, branchId, before.yearId);
    const snapshot = await snapshotWeek(transaction, branchId, before.date, before.date);
    const stored = await lockedExam(transaction, branchId, id);
    const moment = await transactionMoment(transaction);
    if (stored.startsAt.getTime() <= moment.getTime()) throw new ApiException('exam_started', 409);
    const storedDay = await storedLessonsOn(transaction, branchId, stored.date);
    const linked = await linkedLessons(transaction, id);
    refuseStarted(
      storedDay,
      storedDay.filter((one) => linked.includes(one.id)),
      moment,
    );
    await sql`set constraints all deferred`.execute(transaction);
    await transaction
      .updateTable('exams')
      .set({ cancel_cause: 'cancelled' })
      .where('id', '=', id)
      .execute();
    // Its out rows go (spec review of the plan, must-fix 5): the key would
    // refuse a later exam keeping the same class out of the same block.
    const outsRemoved = await transaction
      .deleteFrom('lesson_block_class_outs')
      .where('exam_id', '=', id)
      .returning(['block_id', 'class_id'])
      .execute();
    const released = await this.release(transaction, access, {
      branchId,
      examId: id,
      dates: [stored.date],
      keep: new Set(),
      keepCancelled: input.keepCancelled ?? [],
      keepReason: input.keepReason ?? null,
      found: null,
    });
    await sql`set constraints all immediate`.execute(transaction);
    const after = await readExam(transaction, branchId, id);
    const notices = await this.tell(transaction, snapshot, {
      action: 'cancelled',
      before: stored,
      after,
    });
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'exam.cancel',
      record: { type: 'exam', id },
      oldValue: auditOf(stored),
      newValue: {
        ...auditOf(after),
        ...released,
        outsRemoved: outsRemoved.map((one) => ({ blockId: one.block_id, classId: one.class_id })),
        notices: { ...notices },
      },
      requestId,
    });
    return { examId: id, warnings: [] };
  }

  /**
   * The lessons linked to the exam that it no longer covers (`keep`) lose
   * its link. A lesson another standing exam keeps stays cancelled (must-fix
   * 3); one in `keepCancelled` stays cancelled with the reason (decision 3);
   * the others are restored by the rule for a restored lesson, each block
   * with its double partner, and a blocked one refuses the save with the
   * free rooms of its time.
   */
  private async release(
    transaction: Transaction,
    access: Access,
    input: {
      readonly branchId: string;
      readonly examId: string;
      readonly dates: readonly string[];
      readonly keep: ReadonlySet<string>;
      readonly keepCancelled: readonly string[];
      readonly keepReason: string | null;
      /** A check's collector (task 5.6c-2): each lesson given back with what happens to it. */
      readonly found: CheckFound | null;
    },
  ) {
    const items: NonNullable<CheckFound['givenBack']> = [];
    const note = (
      lessons: readonly StoredDayLesson[],
      state: GivenBackState,
      rules: ErrorDetail[],
    ) => {
      for (const one of lessons) items.push({ lessonId: one.id, state, rules });
    };
    const unlinked = (
      await transaction
        .deleteFrom('lesson_exam_cancels')
        .where('exam_id', '=', input.examId)
        .where('lesson_id', 'not in', input.keep.size === 0 ? [NO_ID] : [...input.keep])
        .returning('lesson_id')
        .execute()
    ).map((one) => one.lesson_id);
    const empty = {
      lessonsRestored: [] as string[],
      lessonsKeptCancelled: [] as string[],
      lessonsUnderOtherExams: [] as string[],
    };
    // A lesson named to stay cancelled is one this save gives back
    // (permission review should-fix 4): another is refused, never dropped.
    for (const id of input.keepCancelled) if (!unlinked.includes(id)) throw notFound();
    if (unlinked.length === 0) {
      if (input.found !== null) input.found.givenBack = [];
      return empty;
    }
    const still = new Set(
      (
        await transaction
          .selectFrom('lesson_exam_cancels')
          .select('lesson_id')
          .where('lesson_id', 'in', unlinked)
          .execute()
      ).map((one) => one.lesson_id),
    );
    const services = { timetable: this.timetable, pattern: this.pattern };
    const kept = new Set(input.keepCancelled);
    const result = {
      ...empty,
      lessonsUnderOtherExams: unlinked.filter((one) => still.has(one)).sort(),
    };
    for (const lessonId of result.lessonsUnderOtherExams) {
      items.push({ lessonId, state: 'otherExam', rules: [] });
    }
    const blocked: ErrorDetail[] = [];
    const freeRooms = new Set<string>();
    for (const date of input.dates) {
      const day = await storedLessonsOn(transaction, input.branchId, date);
      const free = day.filter((one) => unlinked.includes(one.id) && !still.has(one.id));
      const units = new Map<string, StoredDayLesson[]>();
      for (const one of free) {
        const key = one.doublePairId ?? one.blockId;
        units.set(key, [...(units.get(key) ?? []), one]);
      }
      for (const lessons of units.values()) {
        const checked = await storedDayCheck(transaction, services, {
          accountId: access.accountId,
          lessons,
        });
        // Kept cancelled only when the check blocks it (spec review of the code,
        // must-fix 3), the halves of a double together, named by either.
        if (checked.blocked.length > 0 && lessons.some((one) => kept.has(one.id))) {
          await transaction
            .updateTable('lessons')
            // A check names lessons to keep before the reason is typed; its
            // write is rolled back, so a placeholder meets `lessons_reason_check`
            // (spec review of the code, must-fix 1).
            .set({
              cancel_cause: 'reason',
              cancel_reason: input.keepReason ?? (input.found === null ? null : 'check'),
            })
            .where(
              'id',
              'in',
              lessons.map((one) => one.id),
            )
            .execute();
          result.lessonsKeptCancelled.push(...lessons.map((one) => one.id));
          for (const one of lessons) kept.delete(one.id);
          note(
            lessons,
            'kept',
            checked.blocked.map((one) =>
              ruleDetail(one, 'A lesson the exam no longer covers cannot be restored.'),
            ),
          );
          continue;
        }
        if (checked.blocked.length > 0) {
          const rules = checked.blocked.map((one) =>
            ruleDetail(one, 'A lesson the exam no longer covers cannot be restored.'),
          );
          blocked.push(...rules);
          note(lessons, 'blocked', rules);
          for (const room of checked.freeRooms) freeRooms.add(room);
          continue;
        }
        for (const one of lessons) {
          await transaction
            .updateTable('lessons')
            .set({
              cancel_cause: null,
              cancel_reason: null,
              teacher_id: checked.teacherIds.get(one.id) ?? null,
            })
            .where('id', '=', one.id)
            .execute();
          result.lessonsRestored.push(one.id);
        }
        // Named to stay cancelled but restorable: the save refuses it, the
        // check lists it (plan review should-fix 4).
        const restorable = input.found !== null && lessons.some((one) => kept.has(one.id));
        note(lessons, restorable ? 'restorable' : 'restored', []);
        if (restorable) for (const one of lessons) kept.delete(one.id);
      }
    }
    if (input.found !== null) {
      // A lesson named to stay cancelled that another exam still holds is
      // refused as the save refuses it (spec review of the code, should-fix 6).
      if (kept.size > 0) throw notFound();
      input.found.givenBack = items;
      input.found.freeRooms = [...freeRooms].sort();
      return result;
    }
    // A lesson named to stay cancelled that can be restored is refused.
    if (kept.size > 0) throw notFound();
    if (blocked.length > 0) {
      const rooms =
        freeRooms.size === 0
          ? []
          : await transaction
              .selectFrom('rooms')
              .select(['id', 'name'])
              .where('id', 'in', [...freeRooms])
              .where('branch_id', '=', input.branchId)
              .orderBy('name')
              .execute();
      throw new ApiException('exam_restore_blocked', 409, undefined, [
        ...blocked,
        ...rooms.map((room) => ({
          path: 'rooms',
          code: 'room_free',
          message: 'A room free at the lesson’s time.',
          room: { id: room.id, name: room.name },
        })),
      ]);
    }
    result.lessonsRestored.sort();
    result.lessonsKeptCancelled.sort();
    return result;
  }

  /**
   * The notices of a save (decision 2): every teacher whose week changed,
   * and every invigilator added, removed, or whose date, time or room
   * changed, once.
   */
  private async tell(
    transaction: Transaction,
    snapshot: WeekSnapshot,
    input: {
      readonly action: 'created' | 'changed' | 'cancelled';
      readonly before: StoredExam | null;
      readonly after: StoredExam;
    },
  ) {
    const { before, after } = input;
    const timeZone = (
      await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', snapshot.branchId)
        .executeTakeFirstOrThrow()
    ).time_zone;
    const clock = async (moment: Date) =>
      (
        await sql<{
          clock: string;
        }>`select to_char(${moment}::timestamptz at time zone ${timeZone}, 'HH24:MI') as clock`.execute(
          transaction,
        )
      ).rows[0]?.clock ?? '00:00';
    const roomNames = new Map(
      (
        await transaction
          .selectFrom('rooms')
          .select(['id', 'name'])
          .where('branch_id', '=', snapshot.branchId)
          .execute()
      ).map((one) => [one.id, one.name]),
    );
    const placesOf = async (exam: StoredExam | null) => {
      const places = new Map<string, Invigilation>();
      if (exam === null || exam.cancelCause !== null) return places;
      const start = await clock(exam.startsAt);
      const end = await clock(exam.endsAt);
      for (const room of exam.rooms) {
        for (const staffId of room.invigilatorIds) {
          places.set(staffId, { start, end, room: roomNames.get(room.roomId) ?? '' });
        }
      }
      return places;
    };
    const was = await placesOf(before);
    const now = await placesOf(after);
    const dateMoved = before !== null && before.date !== after.date;
    const staffIds = [...new Set([...was.keys(), ...now.keys()])];
    const accounts =
      staffIds.length === 0
        ? []
        : await transaction
            .selectFrom('staff')
            .select(['id', 'account_id'])
            .where('id', 'in', staffIds)
            .where('kind', '=', 'person')
            .execute();
    const invigilations = new Map<string, Invigilation | null>();
    const told = new Set<string>();
    for (const one of accounts) {
      if (one.account_id === null) continue;
      const old = was.get(one.id);
      const place = now.get(one.id) ?? null;
      invigilations.set(one.account_id, place);
      const same =
        old !== undefined &&
        place !== null &&
        !dateMoved &&
        old.start === place.start &&
        old.end === place.end &&
        old.room === place.room;
      if (!same) told.add(one.account_id);
    }
    return sendWeekChanges(transaction, this.notifications, snapshot, {
      kind: 'timetable.exam_changed',
      action: input.action,
      title: after.title,
      date: after.date,
      invigilations,
      told,
    });
  }
}

/** An id no row has, for an `in` over an empty list. */
const NO_ID = '00000000-0000-0000-0000-000000000000';

/** A lesson the save rewrites that has started, or whose double's earlier half has (must-fix 9). */
function refuseStarted(
  day: readonly StoredDayLesson[],
  touched: readonly StoredDayLesson[],
  moment: Date,
): void {
  for (const one of touched) {
    if (pairOf(day, one).some((half) => half.startsAt.getTime() <= moment.getTime())) {
      throw new ApiException('exam_started', 409);
    }
  }
}

/** The year of the branch whose dates hold `date`, or `null`. */
async function yearOfDate(
  transaction: Transaction,
  branchId: string,
  date: string,
): Promise<string | null> {
  const found = await transaction
    .selectFrom('academic_years')
    .select('id')
    .where('branch_id', '=', branchId)
    .where('start_date', '<=', date)
    .where('end_date', '>=', date)
    .executeTakeFirst();
  return found?.id ?? null;
}

/** The ids of a body and path that must be of the branch: 404 otherwise. */
async function refuseForeignIds(
  transaction: Transaction,
  branchId: string,
  id: string | null,
  input: Partial<ExamInput> & { keepCancelled?: string[] | undefined },
): Promise<void> {
  const all = async (
    table: 'exams' | 'rooms' | 'classes' | 'groups' | 'lesson_blocks' | 'lessons',
    ids: readonly string[],
  ) => {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return;
    const found = await transaction
      .selectFrom(table)
      .select('id')
      .where('id', 'in', wanted)
      .where('branch_id', '=', branchId)
      .execute();
    if (found.length !== wanted.length) throw notFound();
  };
  if (id !== null) await all('exams', [id]);
  const rooms = input.rooms ?? [];
  await all(
    'rooms',
    rooms.map((one) => one.roomId),
  );
  await all('classes', [
    ...rooms.flatMap((one) => one.classIds),
    ...(input.blockChoices ?? []).map((one) => one.classId),
  ]);
  await all(
    'groups',
    rooms.flatMap((one) => one.groupIds),
  );
  await all(
    'lesson_blocks',
    (input.blockChoices ?? []).map((one) => one.blockId),
  );
  await all('lessons', input.keepCancelled ?? []);
  const people = [...new Set(rooms.flatMap((one) => one.invigilatorIds))];
  if (people.length > 0) {
    const linked = await transaction
      .selectFrom('staff_branches')
      .select('staff_id')
      .where('staff_id', 'in', people)
      .where('branch_id', '=', branchId)
      .execute();
    if (new Set(linked.map((one) => one.staff_id)).size !== people.length) throw notFound();
  }
  if (input.subjectId !== undefined && input.subjectId !== null) {
    const subject = await transaction
      .selectFrom('subjects')
      .select('id')
      .where('id', '=', input.subjectId)
      .executeTakeFirst();
    if (subject === undefined) throw notFound();
  }
}

/** An exam of the branch, read without a lock; 404 otherwise. */
async function readExam(
  transaction: Transaction,
  branchId: string,
  id: string,
): Promise<StoredExam> {
  const row = await transaction
    .selectFrom('exams')
    .select([
      'id',
      'academic_year_id',
      sql<string>`exam_date::text`.as('exam_date'),
      'starts_at',
      'ends_at',
      'first_slot',
      'last_slot',
      'title',
      'subject_id',
      'rating_exam',
      'cancel_cause',
    ])
    .where('id', '=', id)
    .where('branch_id', '=', branchId)
    .executeTakeFirst();
  if (row === undefined) throw notFound();
  const rooms = await transaction
    .selectFrom('exam_rooms')
    .select(['id', 'room_id'])
    .where('exam_id', '=', id)
    .orderBy('room_id')
    .execute();
  const seats = await transaction
    .selectFrom('exam_room_classes')
    .select(['exam_room_id', 'class_id', 'group_id'])
    .where('exam_id', '=', id)
    .execute();
  const invigilators = await transaction
    .selectFrom('exam_invigilators')
    .select(['exam_room_id', 'staff_id'])
    .where('exam_id', '=', id)
    .execute();
  const outs = await transaction
    .selectFrom('lesson_block_class_outs')
    .select(['block_id', 'class_id'])
    .where('exam_id', '=', id)
    .orderBy('block_id')
    .orderBy('class_id')
    .execute();
  return {
    id: row.id,
    yearId: row.academic_year_id,
    date: row.exam_date,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    firstSlot: row.first_slot,
    lastSlot: row.last_slot,
    title: row.title,
    subjectId: row.subject_id,
    ratingExam: row.rating_exam,
    cancelCause: row.cancel_cause,
    rooms: rooms.map((room) => ({
      roomId: room.room_id,
      classIds: seats
        .filter((one) => one.exam_room_id === room.id && one.class_id !== null)
        .map((one) => one.class_id ?? '')
        .sort(),
      groupIds: seats
        .filter((one) => one.exam_room_id === room.id && one.group_id !== null)
        .map((one) => one.group_id ?? '')
        .sort(),
      invigilatorIds: invigilators
        .filter((one) => one.exam_room_id === room.id)
        .map((one) => one.staff_id)
        .sort(),
    })),
    outs: outs.map((one) => ({ blockId: one.block_id, classId: one.class_id })),
  };
}

/** The exam row locked as `exam_claims` locks it, read again after the lock. */
async function lockedExam(
  transaction: Transaction,
  branchId: string,
  id: string,
): Promise<StoredExam> {
  await transaction.selectFrom('exams').select('id').where('id', '=', id).forUpdate().execute();
  const exam = await readExam(transaction, branchId, id);
  if (exam.cancelCause !== null) throw new ApiException('exam_cancelled', 409);
  return exam;
}

/** The lessons an exam keeps cancelled. */
async function linkedLessons(transaction: Transaction, examId: string): Promise<string[]> {
  return (
    await transaction
      .selectFrom('lesson_exam_cancels')
      .select('lesson_id')
      .where('exam_id', '=', examId)
      .execute()
  ).map((one) => one.lesson_id);
}

/** The exam of the body in the shape the calendar's helpers read. */
async function standingOf(
  transaction: Transaction,
  id: string,
  body: ExamInput,
): Promise<StandingExam> {
  const classIds = [...new Set(body.rooms.flatMap((one) => one.classIds))].sort();
  const groupIds = [...new Set(body.rooms.flatMap((one) => one.groupIds))].sort();
  const groupClasses =
    groupIds.length === 0
      ? []
      : await transaction
          .selectFrom('group_classes')
          .select(['group_id', 'class_id'])
          .where('group_id', 'in', groupIds)
          .execute();
  const groups = new Map(
    groupIds.map((groupId) => [
      groupId,
      groupClasses
        .filter((one) => one.group_id === groupId)
        .map((one) => one.class_id)
        .sort(),
    ]),
  );
  const deciding = [...new Set([...classIds, ...[...groups.values()].flat()])];
  const classes =
    deciding.length === 0
      ? []
      : await transaction
          .selectFrom('classes')
          .select(['id', 'grade', 'language'])
          .where('id', 'in', deciding)
          .execute();
  return {
    id,
    title: body.title,
    date: body.date,
    startsAt: new Date(0),
    endsAt: new Date(0),
    firstSlot: body.firstLesson,
    lastSlot: body.lastLesson,
    classIds,
    groups,
    grades: [...new Set(classes.map((one) => one.grade))].sort((a, b) => a - b),
    classUnits: classes.map((one): EngineUnit => ({
      id: one.id,
      kind: 'class',
      grades: [one.grade],
      language: one.language,
      tutorOnStart: null,
    })),
    roomIds: body.rooms.map((one) => one.roomId),
    invigilatorIds: [...new Set(body.rooms.flatMap((one) => one.invigilatorIds))],
    outs: [],
  };
}

/**
 * The choice for a class and a shared block (decision 7): the body's, named
 * by a dated block of the unit (either half of a double); else, for a change
 * on the same date, the stored one; else none.
 */
function choicesOf(
  body: ExamInput,
  lessons: readonly ExamDayLesson[],
  stored: StoredExam | null,
  storedStanding: StandingExam | null,
  begins: Date,
): { readonly choiceOf: ExamChoiceOf; readonly storedOf: ExamChoiceOf } {
  const patternOf = new Map(lessons.map((one) => [one.blockId, one.patternBlockId]));
  const given = new Map<string, ExamBlockChoice>();
  for (const one of body.blockChoices) {
    const block = lessons.find((lesson) => lesson.blockId === one.blockId);
    const pair = block?.doublePairId ?? null;
    const blocks =
      pair === null
        ? [one.blockId]
        : lessons.filter((lesson) => lesson.doublePairId === pair).map((lesson) => lesson.blockId);
    for (const blockId of blocks) {
      const pattern = patternOf.get(blockId);
      if (pattern !== undefined) given.set(`${one.classId}|${pattern}`, one.choice);
    }
  }
  const before =
    stored === null || storedStanding === null || stored.date !== body.date
      ? new Map<string, ExamBlockChoice>()
      : storedChoicesOf(
          { ...storedStanding, outs: stored.outs },
          {
            start: Math.round((stored.startsAt.getTime() - begins.getTime()) / MINUTE),
            end: Math.round((stored.endsAt.getTime() - begins.getTime()) / MINUTE),
          },
          lessons,
        );
  const from =
    (maps: readonly ReadonlyMap<string, ExamBlockChoice>[]): ExamChoiceOf =>
    (classId, block) => {
      for (const map of maps) {
        for (const pattern of block.patternBlockIds) {
          const choice = map.get(`${classId}|${pattern}`);
          if (choice !== undefined) return choice;
        }
      }
      return null;
    };
  return { choiceOf: from([given, before]), storedOf: from([before]) };
}

/** The rooms of the body with their classes, groups and invigilators. */
async function writeRooms(
  transaction: Transaction,
  branchId: string,
  examId: string,
  rooms: ExamInput['rooms'],
): Promise<void> {
  for (const room of rooms) {
    const row = await transaction
      .insertInto('exam_rooms')
      .values({ branch_id: branchId, exam_id: examId, room_id: room.roomId })
      .returning('id')
      .executeTakeFirstOrThrow();
    const seats = [
      ...room.classIds.map((classId) => ({ class_id: classId, group_id: null })),
      ...room.groupIds.map((groupId) => ({ class_id: null, group_id: groupId })),
    ];
    await transaction
      .insertInto('exam_room_classes')
      .values(
        seats.map((seat) => ({
          branch_id: branchId,
          exam_id: examId,
          exam_room_id: row.id,
          ...seat,
        })),
      )
      .execute();
    await transaction
      .insertInto('exam_invigilators')
      .values(
        room.invigilatorIds.map((staffId) => ({
          branch_id: branchId,
          exam_id: examId,
          exam_room_id: row.id,
          staff_id: staffId,
        })),
      )
      .execute();
  }
}

/** The out rows by difference. */
async function writeOuts(
  transaction: Transaction,
  branchId: string,
  examId: string,
  held: readonly { readonly blockId: string; readonly classId: string }[],
  wanted: readonly { readonly blockId: string; readonly classId: string }[],
) {
  const keyOf = (one: { blockId: string; classId: string }) => `${one.blockId}|${one.classId}`;
  const wantedKeys = new Set(wanted.map(keyOf));
  const heldKeys = new Set(held.map(keyOf));
  const removed = held.filter((one) => !wantedKeys.has(keyOf(one)));
  for (const out of removed) {
    await transaction
      .deleteFrom('lesson_block_class_outs')
      .where('exam_id', '=', examId)
      .where('block_id', '=', out.blockId)
      .where('class_id', '=', out.classId)
      .execute();
  }
  const added = wanted.filter((one) => !heldKeys.has(keyOf(one)));
  if (added.length > 0) {
    await transaction
      .insertInto('lesson_block_class_outs')
      .values(
        added.map((out) => ({
          branch_id: branchId,
          block_id: out.blockId,
          class_id: out.classId,
          exam_id: examId,
        })),
      )
      .execute();
  }
  return {
    added: added.map((one) => ({ ...one })),
    removed: removed.map((one) => ({ ...one })),
  };
}

/**
 * The lessons the exam covers: a link each (a lesson already cancelled by
 * another cause gets none), those not cancelled cancelled "exam".
 */
async function cancelCovered(
  transaction: Transaction,
  branchId: string,
  examId: string,
  date: string,
  covered: ReadonlySet<string>,
): Promise<string[]> {
  if (covered.size === 0) return [];
  const lessons = await storedLessonsOn(transaction, branchId, date, { lessonIds: [...covered] });
  const linked = lessons.filter((one) => one.cancelCause === null || one.cancelCause === 'exam');
  const cancel = lessons.filter((one) => one.cancelCause === null).map((one) => one.id);
  if (cancel.length > 0) {
    await transaction
      .updateTable('lessons')
      .set({ cancel_cause: 'exam', cancel_reason: null })
      .where('id', 'in', cancel)
      .execute();
  }
  if (linked.length > 0) {
    await transaction
      .insertInto('lesson_exam_cancels')
      .values(linked.map((one) => ({ branch_id: branchId, lesson_id: one.id, exam_id: examId })))
      .onConflict((conflict) => conflict.doNothing())
      .execute();
  }
  return cancel.sort();
}

/** What the audit entry keeps of an exam. */
function auditOf(exam: StoredExam) {
  return {
    date: exam.date,
    startsAt: exam.startsAt.toISOString(),
    endsAt: exam.endsAt.toISOString(),
    firstSlot: exam.firstSlot,
    lastSlot: exam.lastSlot,
    title: exam.title,
    subjectId: exam.subjectId,
    ratingExam: exam.ratingExam,
    cancelCause: exam.cancelCause,
    rooms: exam.rooms.map((one) => ({ ...one })),
  };
}

/**
 * The journals of the body when it is a rating exam (task 5.6c-3b), checked:
 * a subject with the rating exam, no journal linked to another standing
 * rating exam of the quarter.
 */
async function ratingFor(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly yearId: string;
    readonly examId: string | null;
    readonly input: ExamInput;
  },
): Promise<RatingJournals | null> {
  const body = input.input;
  // The schema refuses a rating exam with no subject.
  if (!body.ratingExam || body.subjectId === null) return null;
  await refuseRatingSubject(transaction, body.subjectId);
  const rating = await ratingJournalsOf(transaction, {
    branchId: input.branchId,
    yearId: input.yearId,
    subjectId: body.subjectId,
    date: body.date,
    classIds: body.rooms.flatMap((one) => one.classIds),
    groupIds: body.rooms.flatMap((one) => one.groupIds),
  });
  await refuseRatingTaken(transaction, {
    branchId: input.branchId,
    yearId: input.yearId,
    examId: input.examId,
    date: body.date,
    linked: rating.linked,
  });
  return rating;
}

/** The exams of `ids` of the branch as the API answers them, in the order given. */
export async function examsOf(
  transaction: Transaction,
  branchId: string,
  ids: readonly string[],
): Promise<Exam[]> {
  if (ids.length === 0) return [];
  const timeZone = (
    await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow()
  ).time_zone;
  const moment = await transactionMoment(transaction);
  const answers: Exam[] = [];
  for (const id of ids) {
    const exam = await readExam(transaction, branchId, id).catch((error: unknown) => {
      if (error instanceof ApiException && error.code === 'not_found') return null;
      throw error;
    });
    if (exam === null) continue;
    const { rows } = await sql<{ start: number; end: number }>`
      select (extract(epoch from (${exam.startsAt}::timestamptz at time zone ${timeZone})
          - (${exam.startsAt}::timestamptz at time zone ${timeZone})::date::timestamp) / 60)::int as start,
        (extract(epoch from (${exam.endsAt}::timestamptz at time zone ${timeZone})
          - (${exam.startsAt}::timestamptz at time zone ${timeZone})::date::timestamp) / 60)::int as end
    `.execute(transaction);
    const minutes = rows[0] ?? { start: 0, end: 0 };
    const classIds = exam.rooms.flatMap((one) => one.classIds);
    const groupIds = exam.rooms.flatMap((one) => one.groupIds);
    const staffIds = exam.rooms.flatMap((one) => one.invigilatorIds);
    const [classes, groups, staff, rooms, subject, lessons] = await Promise.all([
      classIds.length === 0
        ? Promise.resolve([])
        : transaction
            .selectFrom('classes')
            .select(['id', 'grade', 'name'])
            .where('id', 'in', classIds)
            .execute(),
      groupIds.length === 0
        ? Promise.resolve([])
        : transaction
            .selectFrom('groups')
            .select(['id', 'name'])
            .where('id', 'in', groupIds)
            .execute(),
      staffIds.length === 0
        ? Promise.resolve([])
        : transaction
            .selectFrom('staff')
            .select(['id', 'first_name', 'last_name'])
            .where('id', 'in', staffIds)
            .execute(),
      transaction
        .selectFrom('rooms')
        .select(['id', 'name'])
        .where('id', 'in', exam.rooms.length === 0 ? [NO_ID] : exam.rooms.map((one) => one.roomId))
        .execute(),
      exam.subjectId === null
        ? Promise.resolve(undefined)
        : transaction
            .selectFrom('subjects')
            .select(['id', 'name_uz', 'name_ru', 'name_en'])
            .where('id', '=', exam.subjectId)
            .executeTakeFirst(),
      linkedLessons(transaction, exam.id),
    ]);
    const nameOf = <T extends { id: string }>(
      list: readonly T[],
      id: string,
      name: (one: T) => string,
    ) => {
      const found = list.find((one) => one.id === id);
      return { id, name: found === undefined ? '' : name(found) };
    };
    // The lesson numbers of its first and last slot in the day of a class
    // that sits, by their times; `null` when the day no longer has them.
    const classOfDay =
      classIds[0] ??
      (groupIds.length === 0
        ? undefined
        : (
            await transaction
              .selectFrom('group_classes')
              .select('class_id')
              .where('group_id', 'in', groupIds)
              .orderBy('class_id')
              .executeTakeFirst()
          )?.class_id);
    const slots =
      classOfDay === undefined
        ? []
        : await classSlotsOn(transaction, branchId, classOfDay, exam.date);
    answers.push({
      id: exam.id,
      date: exam.date,
      firstLesson: slots.find((slot) => slot.start === minutes.start)?.lessonNumber ?? null,
      lastLesson: slots.find((slot) => slot.end === minutes.end)?.lessonNumber ?? null,
      start: minutes.start,
      end: minutes.end,
      title: exam.title,
      subject:
        subject === undefined
          ? null
          : {
              id: subject.id,
              names: { uz: subject.name_uz, ru: subject.name_ru, en: subject.name_en },
            },
      rooms: exam.rooms.map((room) => ({
        room: nameOf(rooms, room.roomId, (one) => one.name),
        classes: room.classIds.map((id) =>
          nameOf(classes, id, (one) => classDisplayName(one.grade, one.name)),
        ),
        groups: room.groupIds.map((id) => nameOf(groups, id, (one) => one.name)),
        invigilators: room.invigilatorIds.map((id) =>
          nameOf(staff, id, (one) =>
            listName({ firstName: one.first_name ?? '', lastName: one.last_name ?? '' }),
          ),
        ),
      })),
      cancelled: exam.cancelCause !== null,
      started: exam.startsAt.getTime() <= moment.getTime(),
      lessonIds: [...lessons].sort(),
      // A cancelled exam keeps its rows as history but is no longer the
      // rating exam (decision 6): no list.
      rating:
        exam.ratingExam && exam.cancelCause === null
          ? await ratingNamesOf(transaction, await storedRating(transaction, exam.id))
          : null,
    });
  }
  return answers;
}

/**
 * The answer of a check (task 5.6c-2) from what it collected, the lessons
 * named as they stood before the save wrote, with their names.
 */
async function checkAnswer(
  transaction: Transaction,
  before: readonly StoredDayLesson[],
  moment: Date,
  found: CheckFound,
): Promise<ExamCheck> {
  const all = await dayLessonsOf(transaction, before, moment);
  const byId = new Map(all.map((one) => [one.id, one]));
  const named = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const lesson = byId.get(id);
      return lesson === undefined ? [] : [lesson];
    });
  const classIds = [
    ...new Set(found.choices.flatMap((one) => [one.classId, ...one.otherClassIds])),
  ];
  const classes =
    classIds.length === 0
      ? []
      : await transaction
          .selectFrom('classes')
          .select(['id', 'grade', 'name'])
          .where('id', 'in', classIds)
          .execute();
  const classOf = new Map(classes.map((one) => [one.id, classDisplayName(one.grade, one.name)]));
  const rooms =
    found.freeRooms.length === 0
      ? []
      : await transaction
          .selectFrom('rooms')
          .select(['id', 'name'])
          .where('id', 'in', found.freeRooms)
          .orderBy('name')
          .execute();
  const givenBack =
    found.givenBack === null
      ? null
      : found.givenBack.flatMap((item) => {
          const lesson = byId.get(item.lessonId);
          return lesson === undefined ? [] : [{ lesson, state: item.state, rules: item.rules }];
        });
  return examCheckSchema.parse({
    cancels: named(found.cancels),
    choices: found.choices.map((one) => ({
      classId: one.classId,
      className: classOf.get(one.classId) ?? '',
      blockId: one.blockId,
      lessons: named(one.lessonIds),
      otherClasses: one.otherClassIds.map((id) => classOf.get(id) ?? ''),
      choice: one.choice,
      stored: one.stored,
    })),
    blocked: found.blocked,
    warnings: found.warnings,
    givenBack,
    freeRooms: rooms.map((one) => ({ id: one.id, name: one.name })),
    rating: found.rating === null ? null : await ratingNamesOf(transaction, found.rating),
    canSave:
      found.choices.every((one) => one.choice !== null) &&
      found.blocked !== null &&
      found.blocked.length === 0 &&
      found.givenBack !== null &&
      found.givenBack.every((one) => one.state !== 'blocked' && one.state !== 'restorable'),
  });
}
