import { Injectable } from '@nestjs/common';
import {
  timetableVersionSchema,
  type ErrorCode,
  type ErrorDetail,
  type RuleResultAnswer,
  type TimetableVersion,
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
import { Transactions, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { laterVersionsOf, runningUntil } from './chain.js';
import { datedCheck } from './dated-check.js';
import { removeDatedLessons, writeDatedLessons } from './dated-lessons.js';
import { runsOf, syncJournals } from './journals.js';
import { markWithdrawn, outOfDateColumn } from './out-of-date.js';
import { TimetablePattern } from './pattern.service.js';
import {
  PUBLISH_LOCK,
  PUBLISH_REFUSALS,
  datedAuditOf,
  lockPublishChain,
  refusingPublish,
} from './publish.service.js';
import { resultAnswerOf } from './rule-answers.js';
import { Timetable } from './timetable.service.js';

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
  ) {}

  /** Permission and the version's branch before the request key (`.claude/rules/api.md`). */
  withdraw(access: Access, id: string, key: string, requestId: string): Promise<TimetableVersion> {
    const branchId = branchOf(access);
    return refusingPublish(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
          await this.timetable.findVersion(transaction, branchId, id);
          const once = await this.requestKeys.runOnce(
            transaction,
            {
              key,
              scope: 'timetable.withdraw',
              accountId: access.accountId,
              input: { versionId: id },
            },
            async () =>
              (await this.withdrawLocked(
                transaction,
                access,
                id,
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
    requestId: string,
  ): Promise<TimetableVersion> {
    const branchId = branchOf(access);
    const named = await this.timetable.findVersion(transaction, branchId, id);
    await lockPublishChain(transaction, branchId, named.academic_year_id);
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
    const earlier = chain.filter((one) => one.run.from < version.starts_on).at(-1) ?? null;
    const next = chain
      .map((one) => one.run.from)
      .filter((from) => from > version.starts_on)
      .sort()[0];
    const runEnd = next === undefined ? version.end_date : addDays(next, -1);

    await transaction
      .updateTable('timetable_versions')
      .set({ status: 'archived' })
      .where('id', '=', id)
      .execute();

    let earlierNumber: number | null = null;
    let lessons;
    if (earlier === null) {
      lessons = await removeDatedLessons(transaction, branchId, version.starts_on, runEnd);
    } else {
      const stored = await this.timetable.versionRow(transaction, earlier.id);
      earlierNumber = stored.number;
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
        await this.timetable.rowsOf(transaction, earlier.id),
      );
      const state = runningUntil(
        await this.pattern.stateOf(transaction, row, access.accountId, rows),
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
        ids.every((id) => tutorRows.has(rowOfLesson.get(patternIdOf(id)?.id ?? id) ?? ''));
      const patternBlocked = publishRefusals(
        checkTimetable(
          checkedPlacements(state.pattern.model, state.blocks),
          state.pattern.model.facts,
        ),
      ).blocked.filter((one) => one.rule !== 'teacher_inactive' && !ofTutorRows(one.lessonIds));
      const dated = await datedCheck(transaction, state, version.starts_on, patternBlocked, {
        outOnStart: false,
      });
      // Another branch's lessons are never named by their ids (5.5a-2a
      // decision 8; permission review S2): only this branch's are kept.
      const elsewhere = new Set(state.pattern.model.fixed.map((one) => one.id));
      const details = [
        ...patternBlocked.map((one) => {
          const answer = resultAnswerOf(one);
          return blockedDetail('pattern_blocked', {
            ...answer,
            lessonIds: answer.lessonIds.filter((id) => !elsewhere.has(id)),
          });
        }),
        ...dated.blocked.map((one) => blockedDetail('date_blocked', one)),
      ];
      if (details.length > 0) {
        throw new ApiException('withdraw_blocked', 409, undefined, details);
      }
      lessons = await writeDatedLessons(transaction, state, dated, version.starts_on, runEnd);
    }

    const actor = {
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      requestId,
    };
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
        runsAgain: earlier === null ? null : { id: earlier.id, number: earlierNumber },
        runsAgainUntil: earlier === null ? null : runEnd,
        datedLessons: datedAuditOf(lessons),
        journals: { ...journals },
        markedOutOfDate: drafts.map((one) => one.id),
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
}
