import { Injectable } from '@nestjs/common';
import {
  PUBLISH_STEPS,
  timetableVersionSchema,
  type CancelledLesson,
  type DayKeep,
  type DayKeepBody,
  type ErrorDetail,
  type NeedsTeacherAnswer,
  type PublishBody,
  type PublishCheck,
  type PublishRefusal,
  type RuleResultAnswer,
  type ShortenedDay,
  type TimetableVersion,
} from '@sodiq/shared';
import {
  checkTimetable,
  checkedPlacements,
  publishRefusals,
  startChoices,
  type EngineYear,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { dailyWeightsFit, quarterWeightsFit } from '../setup/subject-weights.js';
import type { StoredLoadRow } from './load-facts.js';
import { datedCheck, datedLessonsOf } from './dated-check.js';
import { impactOf, type Impact } from './impact.js';
import { refusingPattern, TimetablePattern } from './pattern.service.js';
import { resultAnswerOf } from './rule-answers.js';
import { lockSubjects, Timetable, type VersionRow } from './timetable.service.js';
import { auditOf, followChanged, followVersion } from './tutor-lessons.js';

/**
 * The one lock of every publish of the school (decision 2): two publishes run
 * one after the other, and the second reads the first's published pattern as
 * busy elsewhere after the wait (`06`, Teachers who work in several branches,
 * Two drafts at once: "The first to publish stands").
 */
const PUBLISH_LOCK = 550_001;

/** The quarters of the year, dated or not, by number. */
interface QuarterRow {
  readonly number: number;
  readonly start_date: string | null;
  readonly end_date: string | null;
}

/** What a check found: the refusals and the warnings, on the date checked; the lists of the dates (task 5.5a-2a). */
interface Findings {
  readonly refusals: PublishRefusal[];
  readonly warnings: RuleResultAnswer[];
  readonly cancelledLessons: CancelledLesson[];
  readonly needsTeacher: NeedsTeacherAnswer[];
  /** Task 5.5a-2b-1; `null` when the start date itself is refused. */
  readonly impact: Impact | null;
  /** Task 5.5a-2b-2: the dates shortened for a class and the stored choices unused. */
  readonly shortenedDays: ShortenedDay[];
  readonly unusedKeeps: { date: string; classId: string }[];
}

/** A refusal as a detail of `publish_blocked` (decision 12). */
function detailOf(refusal: PublishRefusal): ErrorDetail {
  const path =
    refusal.step !== undefined
      ? `steps.${refusal.step}`
      : refusal.loadRowId !== undefined
        ? `loadRows.${refusal.loadRowId}`
        : refusal.subjectId !== undefined
          ? refusal.quarter === undefined
            ? `subjects.${refusal.subjectId}`
            : `subjects.${refusal.subjectId}.quarters.${String(refusal.quarter)}`
          : refusal.code === 'pattern_blocked' && refusal.result !== undefined
            ? `pattern.${refusal.result.rule}`
            : refusal.code === 'transition_unacknowledged'
              ? 'transition'
              : refusal.code === 'date_blocked' && refusal.result?.date !== undefined
                ? `dates.${refusal.result.date}.${refusal.result.rule}`
                : refusal.code.startsWith('version_start')
                  ? 'startsOn'
                  : '';
  return {
    path,
    code: refusal.code,
    message: 'A reason the publish is refused.',
    ...(refusal.subjectId === undefined ? {} : { subjectId: refusal.subjectId }),
    ...(refusal.result === undefined
      ? {}
      : { rule: { weekday: refusal.result.weekday, lessonIds: refusal.result.lessonIds } }),
    ...(refusal.result?.date === undefined ? {} : { day: refusal.result.date }),
  };
}

/**
 * Publish (task 5.5a-1, pull request #139): a draft becomes the published
 * version of its branch from its start date, after every check of the
 * pattern (`06`, Editing in the grid: "A draft with errors cannot be
 * published"; How surprises are prevented). One transaction: a refused
 * publish changes nothing (`edge/timetable`, Generator and editing: "A
 * publish either succeeds completely or changes nothing").
 *
 * Lock order (spec review of the plan, must-fix 1 and should-fix 9): the
 * school's publish lock; the branch row FOR KEY SHARE; the year FOR SHARE;
 * every version of the branch and year FOR UPDATE in the order of their id,
 * the order `followTutors` takes; then `lockDraft`, whose row lock is held.
 */
@Injectable()
export class TimetablePublish {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly requestKeys: RequestKeys,
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
  ) {}

  /** What a publish on the date would refuse and warn, written nowhere (decision 13). */
  check(access: Access, id: string, startsOn: string): Promise<PublishCheck> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const version = await this.timetable.findVersion(transaction, branchId, id);
      const today = await this.timetable.todayIn(transaction, branchId);
      const quarters = await this.quartersOf(transaction, version);
      const choices = startChoices(today, engineYearOf(version, quarters));
      const findings = await this.findingsOn(
        transaction,
        version,
        startsOn,
        choices.earliest,
        quarters,
        access.accountId,
      );
      return {
        startsOn,
        earliest: choices.earliest,
        defaultStart: choices.defaultStart,
        quarterStarts: [...choices.quarterStarts],
        refusals: findings.refusals,
        warnings: findings.warnings,
        cancelledLessons: findings.cancelledLessons,
        needsTeacher: findings.needsTeacher,
        impact: findings.impact?.answer ?? null,
        shortenedDays: findings.shortenedDays,
        unusedKeeps: findings.unusedKeeps,
        canPublish: version.status === 'draft' && findings.refusals.length === 0,
      };
    });
  }

  /**
   * The choice of the lessons a class keeps on a shortened day of a draft
   * (task 5.5a-2b-2, pull request #143; edge/time-dates-calendar, "A
   * shortened day": "The Academic Vice Principal can choose which lessons are
   * kept"), stored per version, date and class (decision 2) under the draft's
   * edit lock (decision 8). An empty list only removes the choice, whatever
   * the date and the day (spec review of the plan, must-fix 1); a choice is
   * refused for today or earlier (decision 10, review correction 2), on a date
   * that is not shortened for the class, with a position that is not a lesson
   * of the class, or with more lessons than the day's lesson slots (decision 6).
   */
  setDayKeep(access: Access, id: string, input: DayKeepBody, requestId: string): Promise<DayKeep> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      // Every id of the request is checked against the branch before any lock
      // or write (permission review, should-fix 3).
      await this.timetable.findVersion(transaction, branchId, id);
      const known = await transaction
        .selectFrom('classes')
        .select('id')
        .where('id', '=', input.classId)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (known === undefined) {
        throw new ApiException('not_found', 404);
      }
      const version = await this.timetable.lockDraft(transaction, access, id, requestId);
      const positions = [...input.slotPositions].sort((a, b) => a - b);
      if (positions.length > 0) {
        if (input.date <= (await this.timetable.todayIn(transaction, branchId))) {
          throw new ApiException('day_keep_date_passed', 409);
        }
        const state = await this.pattern.stateOf(transaction, version, access.accountId);
        const { dated } = await datedLessonsOf(transaction, state, input.date, input.date);
        const day = dated.shortened.find((one) => one.classId === input.classId);
        if (day === undefined) {
          throw new ApiException('day_keep_not_short', 409);
        }
        if (positions.some((one) => !day.lessons.some((lesson) => lesson.slotPosition === one))) {
          throw new ApiException('day_keep_lessons', 409);
        }
        if (positions.length > day.lessonSlots) {
          throw new ApiException('day_keep_over_slots', 409);
        }
      }
      const stored = await transaction
        .selectFrom('timetable_day_keeps')
        .select('slot_position')
        .where('version_id', '=', id)
        .where('class_id', '=', input.classId)
        .where('kept_on', '=', input.date)
        .orderBy('slot_position')
        .execute();
      const before = stored.map((row) => row.slot_position);
      const answer = { classId: input.classId, date: input.date, slotPositions: positions };
      if (before.join(',') === positions.join(',')) {
        return answer;
      }
      await transaction
        .deleteFrom('timetable_day_keeps')
        .where('version_id', '=', id)
        .where('class_id', '=', input.classId)
        .where('kept_on', '=', input.date)
        .execute();
      if (positions.length > 0) {
        await transaction
          .insertInto('timetable_day_keeps')
          .values(
            positions.map((slotPosition) => ({
              branch_id: branchId,
              version_id: id,
              class_id: input.classId,
              kept_on: input.date,
              slot_position: slotPosition,
            })),
          )
          .execute();
      }
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'timetable_version.day_keep',
        record: { type: 'timetable_version', id },
        oldValue: { classId: input.classId, date: input.date, slotPositions: before },
        newValue: answer,
        requestId,
      });
      return answer;
    });
  }

  /**
   * The publish. Permission and the version's branch are checked before the
   * request key (`.claude/rules/api.md`); a repeat waits on the publish lock
   * and gets the stored answer (review correction 2).
   */
  publish(
    access: Access,
    id: string,
    input: PublishBody,
    key: string,
    requestId: string,
  ): Promise<TimetableVersion> {
    const branchId = branchOf(access);
    return refusingPattern(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
        await this.timetable.findVersion(transaction, branchId, id);
        const once = await this.requestKeys.runOnce(
          transaction,
          {
            key,
            scope: 'timetable.publish',
            accountId: access.accountId,
            input: {
              versionId: id,
              startsOn: input.startsOn,
              transitionKey: input.transitionKey ?? null,
            },
          },
          async () =>
            (await this.publishLocked(
              transaction,
              access,
              id,
              input,
              requestId,
            )) as unknown as JsonValue,
        );
        return timetableVersionSchema.parse(once.result);
      }),
    );
  }

  private async publishLocked(
    transaction: Transaction,
    access: Access,
    id: string,
    input: PublishBody,
    requestId: string,
  ): Promise<TimetableVersion> {
    const { startsOn } = input;
    const branchId = branchOf(access);
    const named = await this.timetable.findVersion(transaction, branchId, id);
    await transaction
      .selectFrom('branches')
      .select('id')
      .where('id', '=', branchId)
      .forKeyShare()
      .execute();
    await transaction
      .selectFrom('academic_years')
      .select('id')
      .where('id', '=', named.academic_year_id)
      .forShare()
      .execute();
    await transaction
      .selectFrom('timetable_versions')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('academic_year_id', '=', named.academic_year_id)
      .orderBy('id')
      .forUpdate()
      .execute();
    let version = await this.timetable.lockDraft(transaction, access, id, requestId);
    const today = await this.timetable.todayIn(transaction, branchId);
    const quarters = await this.quartersOf(transaction, version);
    const { earliest } = startChoices(today, engineYearOf(version, quarters));
    const rows = await this.timetable.rowsOf(transaction, id);
    // The weights read below stay as read until the commit (a weights edit
    // locks its subject FOR UPDATE).
    await lockSubjects(
      transaction,
      rows.map((row) => row.subject_id),
    );
    const startBefore = version.starts_on;
    let follow: Awaited<ReturnType<typeof followVersion>> | null = null;
    if (startsOn !== version.starts_on && startProblems(version, startsOn, earliest).length === 0) {
      // Decision 7: the changed date is saved first, as a start date edit
      // saves it (the Tutor rows follow), and every check runs on it.
      await transaction
        .updateTable('timetable_versions')
        .set({ starts_on: startsOn })
        .where('id', '=', id)
        .execute();
      follow = await followVersion(transaction, id);
      version = await this.timetable.versionRow(transaction, id);
    }
    const findings = await this.findingsOn(
      transaction,
      version,
      startsOn,
      earliest,
      quarters,
      access.accountId,
    );
    // Decision 11 with review correction 1: a transition week that differs
    // from the load is published only with the key of what was shown.
    const transitionKey = findings.impact?.answer.transition?.key ?? null;
    if (transitionKey !== null && input.transitionKey !== transitionKey) {
      findings.refusals.push({ code: 'transition_unacknowledged' });
    }
    if (findings.refusals.length > 0) {
      throw new ApiException('publish_blocked', 409, undefined, findings.refusals.map(detailOf));
    }
    const moment = await transactionMoment(transaction);
    const versions = await transaction
      .selectFrom('timetable_versions')
      .select(['id', 'number', 'status', 'starts_on', 'from_version_id', 'out_of_date_at'])
      .where('branch_id', '=', branchId)
      .where('academic_year_id', '=', version.academic_year_id)
      .orderBy('id')
      .execute();
    const before =
      versions
        .filter((one) => one.status === 'published' && one.starts_on < startsOn)
        .sort((a, b) => b.starts_on.localeCompare(a.starts_on) || b.number - a.number)[0] ?? null;
    // The checks deferred to the commit (the pattern written by the Tutor
    // rows that followed, 0058) run now, while the version is still a draft.
    await sql`set constraints all immediate`.execute(transaction);
    await transaction
      .updateTable('timetable_versions')
      .set({ status: 'published', edit_holder_id: null, edit_seen_at: null })
      .where('id', '=', id)
      .execute();
    // Decision 4: every other draft of the branch and year is marked, unless
    // the published version is in its chain of sources.
    const sourceOf = new Map(versions.map((one) => [one.id, one.from_version_id]));
    const descends = (draftId: string): boolean => {
      const seen = new Set<string>();
      let at = sourceOf.get(draftId) ?? null;
      while (at !== null && !seen.has(at)) {
        if (at === id) return true;
        seen.add(at);
        at = sourceOf.get(at) ?? null;
      }
      return false;
    };
    const marked = versions.filter(
      (one) =>
        one.id !== id && one.status === 'draft' && one.out_of_date_at === null && !descends(one.id),
    );
    for (const draft of marked) {
      await transaction
        .updateTable('timetable_versions')
        .set({ out_of_date_at: moment })
        .where('id', '=', draft.id)
        .execute();
    }
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'timetable_version.publish',
      record: { type: 'timetable_version', id },
      oldValue: { status: 'draft', startsOn: startBefore },
      newValue: {
        status: 'published',
        number: version.number,
        startsOn,
        inForceBefore: before === null ? null : { id: before.id, number: before.number },
        markedOutOfDate: marked.map((one) => one.id),
        ...(follow !== null && followChanged(follow) ? { tutorLessons: auditOf(follow) } : {}),
        // Task 5.5a-2b-1, decision 11: the counts of the preview and the rows acknowledged.
        impact: findings.impact?.answer.counts ?? null,
        ...(transitionKey === null || findings.impact === null
          ? {}
          : {
              transition: {
                weekStart: findings.impact.answer.transition?.weekStart ?? null,
                acknowledged: findings.impact.acknowledged.map((row) => ({ ...row })),
              },
            }),
      },
      requestId,
    });
    for (const draft of marked) {
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'timetable_version.out_of_date',
        record: { type: 'timetable_version', id: draft.id },
        oldValue: { outOfDate: false },
        newValue: { outOfDate: true, publishedId: id, publishedNumber: version.number },
        requestId,
      });
    }
    return this.timetable.answerOf(transaction, id, access.accountId);
  }

  /**
   * Every refusal and warning of a publish of the version on `startsOn`. The
   * version is read as if it started then: its Tutor rows with the Tutor of
   * that date, as a saved date would make them (decision 7).
   */
  private async findingsOn(
    transaction: Transaction,
    stored: VersionRow,
    startsOn: string,
    earliest: string,
    quarters: readonly QuarterRow[],
    accountId: string,
  ): Promise<Findings> {
    const refusals: PublishRefusal[] = startProblems(stored, startsOn, earliest).map((code) => ({
      code,
    }));
    if (refusals.length > 0) {
      // Outside the year or before tomorrow, nothing else is read on that date.
      return {
        refusals,
        warnings: [],
        cancelledLessons: [],
        needsTeacher: [],
        impact: null,
        shortenedDays: [],
        unusedKeeps: [],
      };
    }
    const version: VersionRow = { ...stored, starts_on: startsOn };
    const context = await this.timetable.contextOf(transaction, version);
    const rows: StoredLoadRow[] =
      startsOn === stored.starts_on
        ? await this.timetable.rowsOf(transaction, version.id)
        : await this.timetable.withVersionTutors(
            transaction,
            context,
            await this.timetable.rowsOf(transaction, version.id),
          );

    // Decision 3: until 5.5a-3 asks its question.
    const later = await transaction
      .selectFrom('timetable_versions')
      .select('number')
      .where('branch_id', '=', version.branch_id)
      .where('academic_year_id', '=', version.academic_year_id)
      .where('status', '=', 'published')
      .where('starts_on', '>=', startsOn)
      .orderBy('starts_on')
      .orderBy('number')
      .executeTakeFirst();
    if (later !== undefined) {
      refusals.push({ code: 'version_later_published', versionNumber: later.number });
    }
    if (version.out_of_date_at !== null) {
      refusals.push({ code: 'draft_out_of_date' });
    }

    // Decision 5: steps 1 to 4; the rows and the conflicts by their own codes.
    const readiness = await this.timetable.readinessOf(
      transaction,
      version.branch_id,
      version,
      rows,
    );
    for (const step of PUBLISH_STEPS) {
      const ready =
        step === 'load'
          ? readiness.load.leftRows === 0 && readiness.load.classesOver.length === 0
          : readiness[step].ready;
      if (!ready) {
        refusals.push({ code: 'draft_not_ready', step });
      }
    }
    for (const row of readiness.load.problemRows) {
      for (const problem of row.problems) {
        refusals.push({ code: 'load_problem', loadRowId: row.id, problem });
      }
    }

    const state = await this.pattern.stateOf(transaction, version, accountId, rows);
    const sorted = publishRefusals(
      checkTimetable(
        checkedPlacements(state.pattern.model, state.blocks),
        state.pattern.model.facts,
      ),
    );
    for (const result of sorted.blocked) {
      refusals.push({ code: 'pattern_blocked', result: resultAnswerOf(result) });
    }
    for (const result of sorted.mismatched) {
      const rowId = result.detail?.['loadRowId'];
      refusals.push({
        code: 'load_mismatch',
        ...(typeof rowId === 'string' ? { loadRowId: rowId } : {}),
        result: resultAnswerOf(result),
      });
    }

    // Task 5.5a-2a: every date of the version (decisions 2 to 11).
    const dated = await datedCheck(transaction, state, startsOn, sorted.blocked);
    for (const result of dated.blocked) {
      refusals.push({ code: 'date_blocked', result });
    }

    refusals.push(...(await this.settingsRefusals(transaction, version, rows, quarters, startsOn)));
    // Task 5.5a-2b-1: the impact preview and the transition week.
    const impact = await impactOf(
      transaction,
      {
        versionRow: (versionId) => this.timetable.versionRow(transaction, versionId),
        stateOf: (other) => this.pattern.stateOf(transaction, other, accountId),
      },
      state,
      dated.dated,
      startsOn,
    );
    return {
      refusals,
      // Decision 6: the later entries by date, in place of the pattern's first dates.
      warnings: [
        ...sorted.warnings
          .filter((one) => one.rule !== 'teacher_unavailable_later')
          .map(resultAnswerOf),
        ...dated.warnings,
      ],
      cancelledLessons: dated.cancelled,
      needsTeacher: dated.needsTeacher,
      impact,
      shortenedDays: dated.dated.shortened.map((one) => ({
        date: one.date,
        classId: one.classId,
        lessonSlots: one.lessonSlots,
        lessons: one.lessons.map((lesson) => ({
          slotPosition: lesson.slotPosition,
          entryIds: [...lesson.entryIds],
        })),
        kept: [...one.kept],
        chosen: one.chosen,
        missingPositions: [...one.missingPositions],
      })),
      unusedKeeps: dated.dated.unusedKeeps.map((one) => ({ ...one })),
    };
  }

  /**
   * `edge/academic-year`: "Publishing is blocked unless the year has four
   * dated quarters and every subject in the load has its journal type and, if
   * it is graded, its daily distribution and its quarterly distribution for
   * each quarter the version touches. Attendance-only subjects need no
   * weights." The branch's distributions count as the subjects list counts
   * them (decision 10).
   */
  private async settingsRefusals(
    transaction: Transaction,
    version: VersionRow,
    rows: readonly StoredLoadRow[],
    quarters: readonly QuarterRow[],
    startsOn: string,
  ): Promise<PublishRefusal[]> {
    const refusals: PublishRefusal[] = [];
    const dated = quarters.filter((quarter) => quarter.start_date !== null);
    if (dated.length < 4) {
      refusals.push({ code: 'year_quarters' });
    }
    const subjectIds = [...new Set(rows.map((row) => row.subject_id))].sort();
    if (subjectIds.length === 0) {
      return refusals;
    }
    const [subjects, daily, weights] = await Promise.all([
      transaction
        .selectFrom('subjects')
        .select(['id', 'journal_type', 'weights_round', 'rating_round', 'rating_exam'])
        .where('id', 'in', subjectIds)
        .orderBy('id')
        .execute(),
      transaction
        .selectFrom('subject_daily_weights')
        .select(['subject_id', 'weights_round'])
        .where('branch_id', '=', version.branch_id)
        .where('subject_id', 'in', subjectIds)
        .execute(),
      transaction
        .selectFrom('subject_quarter_weights')
        .innerJoin('quarters', 'quarters.id', 'subject_quarter_weights.quarter_id')
        .select([
          'subject_quarter_weights.subject_id',
          'subject_quarter_weights.weights_round',
          'subject_quarter_weights.rating_round',
          'subject_quarter_weights.rating_exam',
          'quarters.number',
        ])
        .where('subject_quarter_weights.branch_id', '=', version.branch_id)
        .where('subject_quarter_weights.subject_id', 'in', subjectIds)
        .where('quarters.academic_year_id', '=', version.academic_year_id)
        .execute(),
    ]);
    // The quarters the version touches: from its start to the year's end.
    const touched = dated.filter(
      (quarter) => quarter.end_date !== null && quarter.end_date >= startsOn,
    );
    for (const subject of subjects) {
      if (subject.journal_type !== 'graded') continue;
      if (!daily.some((one) => one.subject_id === subject.id && dailyWeightsFit(subject, one))) {
        refusals.push({ code: 'subject_daily_weights', subjectId: subject.id });
      }
      for (const quarter of touched) {
        const fits = weights.some(
          (one) =>
            one.subject_id === subject.id &&
            one.number === quarter.number &&
            quarterWeightsFit(subject, one),
        );
        if (!fits) {
          refusals.push({
            code: 'subject_quarter_weights',
            subjectId: subject.id,
            quarter: quarter.number,
          });
        }
      }
    }
    return refusals;
  }

  private quartersOf(transaction: Transaction, version: VersionRow): Promise<QuarterRow[]> {
    return transaction
      .selectFrom('quarters')
      .select(['number', 'start_date', 'end_date'])
      .where('academic_year_id', '=', version.academic_year_id)
      .where('branch_id', '=', version.branch_id)
      .orderBy('number')
      .execute();
  }
}

/** The year as the start choices read it: its dates and its dated quarters. */
function engineYearOf(version: VersionRow, quarters: readonly QuarterRow[]): EngineYear {
  return {
    firstDate: version.start_date,
    lastDate: version.end_date,
    quarters: quarters.flatMap((quarter) =>
      quarter.start_date === null || quarter.end_date === null
        ? []
        : [{ firstDate: quarter.start_date, lastDate: quarter.end_date }],
    ),
  };
}

/** Decision 6: tomorrow at the earliest, and inside the year. */
function startProblems(
  version: VersionRow,
  startsOn: string,
  earliest: string,
): ('version_start_too_early' | 'version_start_outside_year')[] {
  if (startsOn < version.start_date || startsOn > version.end_date) {
    return ['version_start_outside_year'];
  }
  return startsOn < earliest ? ['version_start_too_early'] : [];
}
