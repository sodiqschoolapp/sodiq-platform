import { reopenWithdrawn } from './vacancy-closes.js';
import { Injectable } from '@nestjs/common';
import {
  dayDecisionKeyOf,
  timetableVersionSchema,
  type ErrorCode,
  type ErrorDetail,
  type RuleResultAnswer,
  type TimetableVersion,
  type WithdrawBody,
  type WithdrawCheck,
} from '@sodiq/shared';
import {
  addDays,
  checkTimetable,
  checkedPlacements,
  patternIdOf,
  publishRefusals,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { Notifications } from '../notifications/notifications.service.js';
import { branchOf } from '../classes/classes.service.js';
import { laterVersionsOf, runningUntil } from './chain.js';
import {
  bulkKeyPartOf,
  bulkRecordsOf,
  recordBulkBlocks,
  sortBulkOf,
  type SortedBulk,
} from './bulk-cancels-kept.js';
import { runAbsences } from './absences-read.js';
import { runClosures } from './rooms-out-read.js';
import { datedCheck, type DatedFindings } from './dated-check.js';
import { removeDatedLessons, writeDatedLessons } from './dated-lessons.js';
import {
  dayChangesKeyOf,
  settleDayChanges,
  sortDayChanges,
  type DaySorting,
} from './day-changes-kept.js';
import type { ExamAudit } from './calendar-exams.js';
import {
  examAuditOf,
  examKeyPartOf,
  examsBeforeOf,
  examsCancelledOf,
  examsWriteOf,
  extraTeachersOf,
  sortExamsKept,
  type KeptExam,
} from './exams-kept.js';
import {
  settleSubstitutions,
  sortSubstitutionsKept,
  substitutionAuditOf,
  substitutionKeyPartOf,
} from './substitutions-kept.js';
import { dayChangeIdsOf, namesOf } from './impact.js';
import { runsOf, syncJournals } from './journals.js';
import { markWithdrawn, outOfDateColumn } from './out-of-date.js';
import { TimetablePattern, type PatternState } from './pattern.service.js';
import {
  PUBLISH_LOCK,
  PUBLISH_REFUSALS,
  bulkAuditOf,
  datedAuditOf,
  dayAuditOf,
  dayDecisionsOf,
  dayRefusalsOf,
  detailOf,
  lockPublishChain,
  planOfRun,
  refuseUnknownKeys,
  refusingPublish,
} from './publish.service.js';
import { resultAnswerOf } from './rule-answers.js';
import { Timetable, type VersionRow } from './timetable.service.js';
import { sendWeekChanges, snapshotWeek } from './week-changes.js';

/**
 * The refusals of a withdraw: the publish's, and the trigger of 0076 on the
 * start, which a request at the same moment as midnight in the branch can
 * meet after the route's own check (decision 5 of 5.5a-3a).
 */
const WITHDRAW_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  ...PUBLISH_REFUSALS,
  version_archive_started: 'withdraw_started',
};

/** A blocked result of the version that would run again, as a detail of `withdraw_blocked`. */
function blockedDetail(code: 'pattern_blocked' | 'date_blocked', result: RuleResultAnswer) {
  const detail: ErrorDetail = {
    path:
      code === 'date_blocked' && result.date !== undefined
        ? `dates.${result.date}.${result.rule}`
        : `pattern.${result.rule}`,
    code,
    message: 'A blocked conflict of the version that would run again.',
    rule: { weekday: result.weekday, lessonIds: result.lessonIds },
    ...(result.date === undefined ? {} : { day: result.date }),
  };
  return detail;
}

/**
 * What a withdraw finds before it writes (task 5.5c-2a; task 5.6a-5b-2): the
 * version that runs again and until when, its state and dated check over the
 * withdrawn dates, the blocked results, and the stored one-day changes and
 * bulk cancels of those dates sorted as a publish sorts them (decision 1).
 * The withdraw check route and the withdraw read the same, both with the
 * version still published (review correction 1), so their keys agree.
 */
interface WithdrawFindings {
  readonly version: VersionRow;
  readonly earlier: { readonly id: string; readonly number: number } | null;
  readonly runEnd: string;
  /** The version that runs again, read as if it started on the withdrawn start; with none, the withdrawn version's own. */
  readonly state: PatternState;
  /** Its dated check; with no version running again, with no lessons (decision 13). */
  readonly dated: DatedFindings;
  readonly blocked: ErrorDetail[];
  readonly sorting: DaySorting;
  readonly bulk: readonly SortedBulk[];
  /** Task 5.6c-3a: the standing exams of the withdrawn dates, sorted. */
  readonly exams: readonly KeptExam[];
  readonly key: string;
}

/**
 * Withdraw (task 5.5c-2a, pull request #156; `06`, How surprises are
 * prevented: "Withdraw. A published version can be withdrawn only before its
 * start date."; `edge/timetable`, Versions and drafts: "'Withdraw' works only
 * before the version's start date. After that, the only way is a new
 * version.").
 *
 * The version is archived; the published version in force before it runs
 * again over its dates (decision 3), its dated lessons written there by the
 * publish's writer (decision 4) after the full rule set (decision 5); with
 * none, the dates are left with no lessons (decision 11). The journals follow
 * the chain (`syncJournals`), every draft of the branch and year is marked
 * (decision 6). A carry or a replace that the withdrawn version's publish
 * made stays (decision 13). One transaction, under the publish's locks.
 */
@Injectable()
export class TimetableWithdraw {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly requestKeys: RequestKeys,
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
    private readonly notifications: Notifications,
  ) {}

  /**
   * What a withdraw would do with the stored one-day changes and bulk cancels
   * of the withdrawn dates (task 5.6a-5b-2), written nowhere: a view, as the
   * publish check (decision 7). Refused as the withdraw is.
   */
  check(access: Access, id: string): Promise<WithdrawCheck> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      await this.timetable.findVersion(transaction, branchId, id);
      const found = await this.findingsOf(transaction, access, id);
      const named = dayChangeIdsOf(
        found.sorting.items,
        found.bulk,
        found.exams,
        found.sorting.substitutions,
      );
      const { names } = await namesOf(
        transaction,
        named,
        new Map(found.state.pattern.model.data.units.map((unit) => [unit.id, unit] as const)),
      );
      return {
        runsAgain: found.earlier,
        runsAgainUntil: found.earlier === null ? null : found.runEnd,
        dayChanges: {
          key: found.key,
          kept: found.sorting.items
            .filter((one) => one.category === 'kept')
            .map((one) => one.answer),
          decide: found.sorting.items
            .filter((one) => one.category === 'decide')
            .map((one) => one.answer),
          dropped: found.sorting.items
            .filter((one) => one.category === 'dropped')
            .map((one) => one.answer),
          bulk: found.bulk.map((one) => one.answer),
          exams: found.exams.map((one) => one.answer),
          substitutions: found.sorting.substitutions.map((one) => one.answer),
          // Task 5.7a-1 (decision 7): the absences over the lessons the
          // earlier version writes again.
          absences: await runAbsences(
            transaction,
            branchId,
            found.dated.dated.lessons.map((one) => ({
              date: one.date,
              start: one.placement.start,
              teacherIds: one.placement.teacherIds,
            })),
          ),
          // Task 5.7a-2b (decision 9): the room closures over the same lessons.
          closures: await runClosures(
            transaction,
            branchId,
            found.dated.dated.lessons.map((one) => ({
              date: one.date,
              start: one.placement.start,
              roomId: one.placement.roomId,
            })),
          ),
        },
        names,
      };
    });
  }

  /** Permission and the version's branch before the request key (`.claude/rules/api.md`). */
  withdraw(
    access: Access,
    id: string,
    input: WithdrawBody,
    key: string,
    requestId: string,
  ): Promise<TimetableVersion> {
    const branchId = branchOf(access);
    return refusingPublish(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          // Task 5.6a-5b-2 (decision 12 of the review): every key and block
          // of a decision is the branch's, checked before any lock.
          await refuseUnknownKeys(
            transaction,
            branchId,
            (input.dayDecisions ?? []).map((one) => one.key),
            (input.dayDecisions ?? []).flatMap((one) =>
              one.blockId === undefined ? [] : [one.blockId],
            ),
          );
          // Permission review should-fix 6: the path id before any lock.
          await this.timetable.findVersion(transaction, branchId, id);
          await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
          const once = await this.requestKeys.runOnce(
            transaction,
            {
              key,
              scope: 'timetable.withdraw',
              accountId: access.accountId,
              input: {
                versionId: id,
                dayChangesKey: input.dayChangesKey ?? null,
                dayDecisions: [...(input.dayDecisions ?? [])]
                  .map((one) => ({ at: dayDecisionKeyOf(one), one }))
                  .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
                  .map(({ one }) => ({
                    key: one.key,
                    ...(one.blockId === undefined
                      ? {}
                      : { blockId: one.blockId, blockDate: one.blockDate ?? null }),
                    choice: one.choice,
                    ...(one.reason === undefined ? {} : { reason: one.reason }),
                  })),
              },
            },
            async () =>
              (await this.withdrawLocked(
                transaction,
                access,
                id,
                input,
                requestId,
              )) as unknown as JsonValue,
          );
          return timetableVersionSchema.parse(once.result);
        }),
      WITHDRAW_REFUSALS,
    );
  }

  private async withdrawLocked(
    transaction: Transaction,
    access: Access,
    id: string,
    input: WithdrawBody,
    requestId: string,
  ): Promise<TimetableVersion> {
    const branchId = branchOf(access);
    const named = await this.timetable.findVersion(transaction, branchId, id);
    await lockPublishChain(transaction, branchId, named.academic_year_id);
    // Review correction 1: everything is read with the version still
    // published, as the check reads it, before the archive below.
    const found = await this.findingsOf(transaction, access, id);
    const { version, earlier, runEnd } = found;
    // Task 5.6a-5b-2 (decision 10): the sorting as shown and a choice for each
    // "needs a decision" item, refused with the blocked results in one answer.
    const details = [
      ...found.blocked,
      ...dayRefusalsOf(
        {
          key: found.key,
          items: found.sorting.items,
          bulk: found.bulk,
          exams: found.exams,
          substitutions: found.sorting.substitutions,
        },
        input,
      ).map(detailOf),
    ];
    if (details.length > 0) {
      throw new ApiException('withdraw_blocked', 409, undefined, details);
    }
    const { decisions, bulkDecisions } = dayDecisionsOf(input.dayDecisions);
    const plan = planOfRun(found.sorting, found.bulk, decisions, bulkDecisions, input.dayDecisions);

    // Task 5.5c-3a: the lessons before the withdraw, read before its write.
    const week = await snapshotWeek(transaction, branchId, version.starts_on, runEnd);
    // Task 5.7a-3a (decision 7): a vacancy the version that runs again names,
    // closed from a day of its run by a fill, is reopened before its lessons
    // are written.
    const reopened =
      earlier === null
        ? []
        : await reopenWithdrawn(transaction, this.audit, {
            branchId,
            teacherIds: found.state.rows.map((row) => row.teacher_id),
            firstDate: version.starts_on,
            lastDate: runEnd,
            today: await this.timetable.todayIn(transaction, branchId),
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            requestId,
          });
    await transaction
      .updateTable('timetable_versions')
      .set({ status: 'archived' })
      .where('id', '=', id)
      .execute();

    // Task 5.6c-3a: the standing exams of the dates, kept or as decided.
    const examAudit: ExamAudit[] = [];
    const examWrite = examsWriteOf({
      branchId,
      items: found.exams,
      begins: found.sorting.findings.begins,
      sent: input.dayDecisions,
      audit: examAudit,
    });
    const lessons =
      earlier === null
        ? await removeDatedLessons(
            transaction,
            branchId,
            access.accountId,
            version.starts_on,
            runEnd,
            plan,
            examWrite,
          )
        : await writeDatedLessons(
            transaction,
            found.state,
            found.sorting.findings,
            version.starts_on,
            runEnd,
            plan,
            examWrite,
          );
    // Task 5.6a-5b-2: the changes not applied ended in the withdrawn
    // version's name (decision 5), those kept on a lesson created again
    // recorded again; the bulk cancels' choices on the blocks written.
    const settled = await settleDayChanges(transaction, {
      branchId,
      versionId: id,
      moment: await transactionMoment(transaction),
      accountId: access.accountId,
      items: found.sorting.items,
      decisions,
    });
    // Task 5.7b-3: the kept substitutions recorded again on lessons created again.
    const substitutionsSettled = await settleSubstitutions(transaction, {
      branchId,
      items: found.sorting.substitutions,
      sent: input.dayDecisions,
      placed: lessons.substitutesPlaced,
      moment: await transactionMoment(transaction),
      accountId: access.accountId,
    });
    const bulkRecorded =
      earlier === null
        ? { decided: [], carried: [] }
        : await recordBulkBlocks(transaction, {
            branchId,
            versionId: earlier.id,
            begins: found.dated.begins,
            items: found.bulk,
            decisions: bulkDecisions,
          });

    const actor = {
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      requestId,
    };
    // Task 5.5c-3a: one notice per affected teacher (5.5c-2a decision 8), and the changed lessons marked.
    const notices = await sendWeekChanges(transaction, this.notifications, week, {
      kind: 'timetable.withdrawn',
      number: version.number,
      examsCancelled: await examsCancelledOf(transaction, found.exams, input.dayDecisions),
    });
    const journals = await syncJournals(transaction, this.audit, version, actor);
    const drafts = await transaction
      .selectFrom('timetable_versions')
      .select(['id', outOfDateColumn])
      .where('branch_id', '=', branchId)
      .where('academic_year_id', '=', version.academic_year_id)
      .where('status', '=', 'draft')
      .orderBy('id')
      .execute();
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'timetable_version.withdraw',
      record: { type: 'timetable_version', id },
      oldValue: { status: 'published', number: version.number, startsOn: version.starts_on },
      newValue: {
        status: 'archived',
        runsAgain: earlier,
        runsAgainUntil: earlier === null ? null : runEnd,
        datedLessons: datedAuditOf(lessons),
        dayChanges: dayAuditOf(
          found.sorting.items,
          decisions,
          settled,
          bulkAuditOf(found.bulk, bulkRecorded),
          substitutionAuditOf(
            found.sorting.substitutions,
            input.dayDecisions,
            substitutionsSettled,
          ),
        ),
        ...(found.exams.length === 0
          ? {}
          : { exams: examAuditOf(found.exams, input.dayDecisions, examAudit) }),
        journals: { ...journals },
        notices: { ...notices },
        markedOutOfDate: drafts.map((one) => one.id),
        ...(reopened.length === 0 ? {} : { vacanciesReopened: reopened }),
      },
      requestId,
    });
    await markWithdrawn(transaction, this.audit, drafts, {
      branchId,
      id,
      number: version.number,
      ...actor,
    });
    return this.timetable.answerOf(transaction, id, access.accountId);
  }

  /** What the withdraw of `id` finds before it writes (`WithdrawFindings`), refusing as the withdraw refuses. */
  private async findingsOf(
    transaction: Transaction,
    access: Access,
    id: string,
  ): Promise<WithdrawFindings> {
    const branchId = branchOf(access);
    const version = await this.timetable.versionRow(transaction, id);
    if (version.status !== 'published') {
      throw new ApiException('version_not_published', 409);
    }
    if (version.year_status === 'closed') {
      throw new ApiException('timetable_year_closed', 409);
    }
    const today = await this.timetable.todayIn(transaction, branchId);
    if (version.starts_on <= today) {
      throw new ApiException('withdraw_started', 409);
    }

    // Decision 3: the chain as it stands before the withdraw; the version in
    // force before it, a tie on a start to the higher number (`runsOf`), runs
    // again to the day before the next published start, else the year's end.
    const chain = runsOf(await laterVersionsOf(transaction, version, version.start_date));
    const before = chain.filter((one) => one.run.from < version.starts_on).at(-1) ?? null;
    const next = chain
      .map((one) => one.run.from)
      .filter((from) => from > version.starts_on)
      .sort()[0];
    const runEnd = next === undefined ? version.end_date : addDays(next, -1);

    // Task 5.6c-3a: the standing exams' invigilators are teachers of the facts.
    const invigilators = await extraTeachersOf(transaction, branchId, version.starts_on, runEnd);
    let earlier: WithdrawFindings['earlier'] = null;
    let state: PatternState;
    let dated: DatedFindings;
    const blocked: ErrorDetail[] = [];
    if (before === null) {
      // Task 5.6a-5b-2 (decision 13): no version runs again, the lessons are
      // removed; the stored changes are sorted over no lessons, with the
      // withdrawn version's own facts, the other branches' claims and the
      // exams of each date.
      state = runningUntil(
        await this.pattern.stateOf(transaction, version, access.accountId, undefined, invigilators),
        runEnd,
      );
      const own = await datedCheck(transaction, state, version.starts_on, [], {
        outOnStart: false,
      });
      dated = {
        ...own,
        blocked: [],
        warnings: [],
        needsTeacher: [],
        cancelled: [],
        dated: {
          lessons: [],
          cancelled: [],
          noTutor: [],
          shortened: [],
          unusedKeeps: [],
          splitGroups: [],
        },
      };
    } else {
      const stored = await this.timetable.versionRow(transaction, before.id);
      earlier = { id: before.id, number: stored.number };
      // Code review must-fix 1: the version is read as if it started on the
      // withdrawn start, the first day it runs again: its facts (busy
      // elsewhere, availability, statuses) on the later of that day and
      // today, as a publish reads a draft on its start.
      // A Tutor row takes the class's Tutor of that day, as a publish reads
      // its draft on a changed start; with none, no teacher.
      const row = { ...stored, starts_on: version.starts_on };
      const rows = await this.timetable.withVersionTutors(
        transaction,
        await this.timetable.contextOf(transaction, row),
        await this.timetable.rowsOf(transaction, before.id),
      );
      state = runningUntil(
        await this.pattern.stateOf(transaction, row, access.accountId, rows, invigilators),
        runEnd,
      );
      // Decision 5: the full rule set. A teacher out is "needs a teacher" on
      // each date (`teacher_inactive` of the pattern is decided by date), never
      // a refusal: the version cannot be edited (spec review must-fix 2). So is
      // a Tutor lesson: the dated check gives it the Tutor of each date, checked
      // by time and travel, or "needs a teacher" with none (3.6c-2 decision 11).
      const tutorSubjects = new Set(
        state.pattern.model.data.subjects.filter((one) => one.tutorSubject).map((one) => one.id),
      );
      const tutorRows = new Set(
        state.rows
          .filter((one) => one.class_id !== null && tutorSubjects.has(one.subject_id))
          .map((one) => one.id),
      );
      const rowOfLesson = new Map(
        state.blocks.flatMap((block) =>
          block.lessons.map((one) => [one.id, one.loadRowId] as const),
        ),
      );
      const ofTutorRows = (ids: readonly string[]) =>
        ids.length > 0 &&
        ids.every((one) => tutorRows.has(rowOfLesson.get(patternIdOf(one)?.id ?? one) ?? ''));
      const patternBlocked = publishRefusals(
        checkTimetable(
          checkedPlacements(state.pattern.model, state.blocks),
          state.pattern.model.facts,
        ),
      ).blocked.filter((one) => one.rule !== 'teacher_inactive' && !ofTutorRows(one.lessonIds));
      dated = await datedCheck(transaction, state, version.starts_on, patternBlocked, {
        outOnStart: false,
      });
      // Another branch's lessons are never named by their ids (5.5a-2a
      // decision 8; permission review S2): only this branch's are kept.
      const elsewhere = new Set(state.pattern.model.fixed.map((one) => one.id));
      blocked.push(
        ...patternBlocked.map((one) => {
          const answer = resultAnswerOf(one);
          return blockedDetail('pattern_blocked', {
            ...answer,
            lessonIds: answer.lessonIds.filter((lesson) => !elsewhere.has(lesson)),
          });
        }),
        ...dated.blocked.map((one) => blockedDetail('date_blocked', one)),
      );
    }

    // Task 5.6a-5b-2 (decision 1): the stored one-day changes and bulk
    // cancels of the withdrawn dates, sorted as a publish sorts them, the
    // bulk cancels on the findings with the kept changes applied.
    // Task 5.6c-3a: the standing exams of the dates, read before the
    // one-day changes are sorted and sorted after; with no version running
    // again, each has no timetable (decision 6).
    const examsBefore = await examsBeforeOf(transaction, {
      branchId,
      findings: dated,
      firstDate: version.starts_on,
      lastDate: runEnd,
    });
    const days = await sortDayChanges(transaction, {
      state,
      findings: dated,
      firstDate: version.starts_on,
      lastDate: runEnd,
      carriedVersionId: null,
      ...(examsBefore.forSorting === undefined ? {} : { exams: examsBefore.forSorting }),
    });
    const exams = sortExamsKept({
      branchId,
      state,
      findings: days.findings,
      before: examsBefore,
      carriedVersionId: null,
      noTimetable: before === null,
    });
    // Task 5.7b-3: the substitutions of the dates, after the exams; with no
    // version running again, every one is dropped.
    const sorting = await sortSubstitutionsKept(transaction, {
      branchId,
      sorting: days,
      firstDate: version.starts_on,
      lastDate: runEnd,
      carriedVersionId: null,
      exams,
      ...(examsBefore.forSorting === undefined
        ? {}
        : { examCovered: examsBefore.forSorting.covered }),
    });
    const bulk = sortBulkOf({
      lessons: sorting.findings.dated.lessons,
      movedAt: sorting.movedAt,
      begins: sorting.findings.begins,
      records: await bulkRecordsOf(transaction, branchId, version.starts_on, runEnd),
      carriedVersionId: null,
    });
    const key = dayChangesKeyOf(
      version.id,
      version.starts_on,
      sorting.items,
      bulk.length === 0 ? null : bulkKeyPartOf(bulk),
      examKeyPartOf(exams),
      substitutionKeyPartOf(sorting.substitutions),
    );
    return { version, earlier, runEnd, state, dated, blocked, sorting, bulk, exams, key };
  }
}
