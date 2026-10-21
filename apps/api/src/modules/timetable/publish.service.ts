import { Injectable } from '@nestjs/common';
import {
  PUBLISH_STEPS,
  dayDecisionKeyOf,
  timetableVersionSchema,
  type CancelledLesson,
  type DayChangeChoice,
  type DayDecisions,
  type DayKeep,
  type DayKeepBody,
  type ErrorCode,
  type ErrorDetail,
  type NeedsTeacherAnswer,
  type PublishBody,
  type PublishChain,
  type PublishChainAnswer,
  type PublishCheck,
  type PublishRefusal,
  type RuleResultAnswer,
  type ShortenedDay,
  type TimetableVersion,
  weekdaySchema,
} from '@sodiq/shared';
import {
  addDays,
  carryChanges,
  checkTimetable,
  type CarryOffer,
  checkedPlacements,
  publishRefusals,
  startChoices,
  type CarryChange,
  type EngineYear,
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
import { refusingConstraints } from '../setup/setup-refusals.js';
import { dailyWeightsFit, quarterWeightsFit } from '../setup/subject-weights.js';
import type { StoredLoadRow } from './load-facts.js';
import {
  carryResultOf,
  carryVersionOf,
  laterKeyOf,
  laterVersionsOf,
  runEndOf,
  runningUntil,
  type CarryReader,
  type CarryResult,
  type LaterVersion,
} from './chain.js';
import {
  bulkKeyPartOf,
  bulkRecordsOf,
  bulkWritePlanOf,
  openBulkBlocks,
  recordBulkBlocks,
  sortBulkOf,
  type BulkChoiceEntry,
  type SortedBulk,
} from './bulk-cancels-kept.js';
import { datedCheck, datedLessonsOf, type DatedFindings } from './dated-check.js';
import { writeDatedLessons, type DatedWrite } from './dated-lessons.js';
import {
  dayChangesKeyOf,
  settleDayChanges,
  sortDayChanges,
  writePlanOf,
  type DayWritePlan,
  type DaySorting,
  type SortedDayChange,
} from './day-changes-kept.js';
import {
  examAuditOf,
  examDecisionsOf,
  examKeyPartOf,
  examRefusalsOf,
  examsBeforeOf,
  examsCancelledOf,
  examsWriteOf,
  extraTeachersOf,
  sortExamsKept,
  type ExamsAudit,
  type KeptExam,
} from './exams-kept.js';
import {
  settleSubstitutions,
  sortSubstitutionsKept,
  substitutionAuditOf,
  substitutionDecisionsOf,
  substitutionKeyPartOf,
  substitutionRefusalsOf,
  substitutionWritePlanOf,
  type SortedSubstitution,
  type SubstitutionsAudit,
} from './substitutions-kept.js';
import type { ExamAudit } from './calendar-exams.js';
import { impactOf, type Impact } from './impact.js';
import { syncJournals } from './journals.js';
import { markFilled, markPublished, outOfDateColumn } from './out-of-date.js';
import { PATTERN_REFUSALS, TimetablePattern, type PatternState } from './pattern.service.js';
import { resultAnswerOf } from './rule-answers.js';
import { lockSubjects, Timetable, type VersionRow } from './timetable.service.js';
import { auditOf, followChanged, followVersion } from './tutor-lessons.js';
import { storeVersionDays } from './version-days.js';
import { sendWeekChanges, snapshotWeek } from './week-changes.js';

/**
 * The one lock of every publish of the school (decision 2): two publishes run
 * one after the other, and the second reads the first's published pattern as
 * busy elsewhere after the wait (`06`, Teachers who work in several branches,
 * Two drafts at once: "The first to publish stands").
 */
export const PUBLISH_LOCK = 550_001;

/** The quarters of the year, dated or not, by number. */
interface QuarterRow {
  readonly number: number;
  readonly start_date: string | null;
  readonly end_date: string | null;
}

/** What a check found: the refusals and the warnings, on the date checked; the lists of the dates (task 5.5a-2a). */
export interface Findings {
  readonly refusals: PublishRefusal[];
  readonly warnings: RuleResultAnswer[];
  readonly cancelledLessons: CancelledLesson[];
  readonly needsTeacher: NeedsTeacherAnswer[];
  /** Task 5.5a-2b-1; `null` when the start date itself is refused. */
  readonly impact: Impact | null;
  /** Task 5.5a-2b-2: the dates shortened for a class and the stored choices unused. */
  readonly shortenedDays: ShortenedDay[];
  readonly unusedKeeps: { date: string; classId: string }[];
  /** Task 5.5a-3a: the later published versions and what the answer does to them. */
  readonly chain: PublishChainAnswer | null;
  readonly later: readonly LaterVersion[];
  readonly carried: readonly CarryResult[];
  /** Task 5.5b-1: the version over its run and its dated check, what its lessons are written from; `null` when the start is refused. */
  readonly written: { readonly state: PatternState; readonly findings: DatedFindings } | null;
  /**
   * Task 5.6a-5a: the stored one-day changes sorted, by run (`null` for the
   * published version's, else the carried version's id), and the key of
   * the sorting; `null` when the start is refused.
   */
  readonly days: {
    readonly key: string;
    readonly items: readonly SortedDayChange[];
    readonly sortings: ReadonlyMap<string | null, DaySorting>;
    /** Task 5.6a-5b-1: the bulk cancels of each run, sorted. */
    readonly bulk: ReadonlyMap<string | null, readonly SortedBulk[]>;
    /** Task 5.6c-3a: the standing exams of each run, sorted. */
    readonly exams: ReadonlyMap<string | null, readonly KeptExam[]>;
  } | null;
}

/** Task 5.7a-3a: the vacancy fill a publish or a carry in place makes, for its audit entry. */
export interface VacancyFillOf {
  readonly vacancyId: string;
  readonly personId: string;
}

/**
 * Task 5.7a-3a: what a check or a write of the fill gives the publish's own
 * steps: the changes carried into the later versions (the rows of every
 * version, spec review of the plan, must-fix 4), and the fill for the audit.
 */
export interface FillOptions {
  readonly carry?: readonly CarryChange[];
  readonly vacancyFillOf?: VacancyFillOf;
}

/** The writes after the checks: of a publish, or of a fill carried in place (decision 4). */
interface RunWrite {
  readonly mode: 'publish' | 'fill';
  readonly version: VersionRow;
  readonly startsOn: string;
  readonly input: PublishBody;
  readonly findings: Findings;
  readonly requestId: string;
  readonly transitionKey: string | null;
  readonly startBefore: string;
  readonly follow: Awaited<ReturnType<typeof followVersion>> | null;
  readonly vacancyFillOf: VacancyFillOf | null;
  readonly changes?: readonly CarryChange[];
}

/**
 * Task 5.6a-5b-1: the write plan of a run, the one-day changes' and the
 * bulk cancels' together; a place cancelled by either is cancelled
 * (decision 13).
 */
export function planOfRun(
  sorting: DaySorting,
  bulk: readonly SortedBulk[],
  decisions: ReadonlyMap<string, DayChangeChoice>,
  bulkDecisions: ReadonlyMap<string, DayChangeChoice>,
  /** Task 5.7b-3: the decisions sent, which the substitutions read with their reasons. */
  sent?: DayDecisions,
): DayWritePlan {
  const day = writePlanOf(sorting.items, sorting.keptStoredIds, decisions);
  const fromBulk = bulkWritePlanOf(bulk, bulkDecisions);
  const fromSubstitutions = substitutionWritePlanOf(sorting.substitutions, sent);
  const cancels = new Map(day.cancels);
  for (const [key, reason] of [...fromBulk.cancels, ...fromSubstitutions.cancels]) {
    if (!cancels.has(key)) cancels.set(key, reason);
  }
  return {
    ...day,
    cancels,
    bulkCancels: fromBulk.bulkCancels,
    bulkHolds: fromBulk.holds,
    substitutes: fromSubstitutions.substitutes,
  };
}

/**
 * Task 5.6a-5a (review must-fix 1): every key of a decision names a stored
 * one-day change or a lesson of the branch; another branch's or an unknown
 * key is 404, before any lock or write.
 */
export async function refuseUnknownKeys(
  transaction: Transaction,
  branchId: string,
  keys: readonly string[],
  blockIds: readonly string[] = [],
): Promise<void> {
  // Task 5.6a-5b-1: a bulk cancel's block is a pattern block of the branch.
  // The 404 says only "an id of this branch": a key and a block of the branch
  // that name no item together are `day_decision_unknown` (permission review,
  // should-fix 3).
  if (blockIds.length > 0) {
    const blocks = await transaction
      .selectFrom('pattern_blocks')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('id', 'in', [...new Set(blockIds)])
      .execute();
    if (blocks.length !== new Set(blockIds).size) throw new ApiException('not_found', 404);
  }
  if (keys.length === 0) return;
  const [changes, lessons, bulks, exams, substitutions] = await Promise.all([
    transaction
      .selectFrom('lesson_day_changes')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('id', 'in', keys)
      .execute(),
    transaction
      .selectFrom('lessons')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('id', 'in', keys)
      .execute(),
    // Task 5.6a-5b-1: or a bulk cancel of the branch.
    transaction
      .selectFrom('bulk_cancels')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('id', 'in', keys)
      .execute(),
    // Task 5.6c-3a: or an exam of the branch.
    transaction
      .selectFrom('exams')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('id', 'in', keys)
      .execute(),
    // Task 5.7b-3: or a substitution row of the branch.
    transaction
      .selectFrom('substitution_lessons')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('id', 'in', keys)
      .execute(),
  ]);
  const known = new Set(
    [...changes, ...lessons, ...bulks, ...exams, ...substitutions].map((one) => one.id),
  );
  if (keys.some((key) => !known.has(key))) {
    throw new ApiException('not_found', 404);
  }
}

/** What the audit entry of a publish or a carry keeps of the one-day changes of its run. */
export type DayAudit = {
  kept: string[];
  decided: { key: string; choice: DayChangeChoice | null }[];
  dropped: string[];
  ended: string[];
  recordedAgain: string[];
  /** Task 5.6a-5b-1: the bulk cancels of the run by key, and the choices of their blocks. */
  bulk?: BulkAudit;
  /** Task 5.7b-3: the substitutions of the run by key. */
  substitutions?: SubstitutionsAudit;
};

type BulkChoiceAudit = BulkChoiceEntry;
type BulkAudit = { kept: string[]; decided: BulkChoiceAudit[]; carried: BulkChoiceAudit[] };

/** The choices sent: of one-day changes by key, of bulk cancels' blocks by `dayDecisionKeyOf`. */
export function dayDecisionsOf(sent: DayDecisions | undefined): {
  decisions: Map<string, DayChangeChoice>;
  bulkDecisions: Map<string, DayChangeChoice>;
} {
  const list = sent ?? [];
  return {
    decisions: new Map(
      list.filter((one) => one.blockId === undefined).map((one) => [one.key, one.choice]),
    ),
    // Task 5.6a-5b-1: the choices of bulk cancels' blocks, by `dayDecisionKeyOf`.
    bulkDecisions: new Map(
      list
        .filter((one) => one.blockId !== undefined)
        .map((one) => [dayDecisionKeyOf(one), one.choice]),
    ),
  };
}

/**
 * What refuses a write over a sorting (tasks 5.6a-5a and 5.6a-5b-1; a
 * withdraw too, task 5.6a-5b-2): a key other than the sorting's
 * (`day_changes_changed`), a "needs a decision" item with no choice, a
 * choice for no such item, and a choice of the other kind.
 */
export function dayRefusalsOf(
  days: {
    readonly key: string;
    readonly items: readonly SortedDayChange[];
    readonly bulk: readonly SortedBulk[];
    /** Task 5.6c-3a: the exams of the sorting. */
    readonly exams?: readonly KeptExam[];
    /** Task 5.7b-3: the substitutions of the sorting. */
    readonly substitutions?: readonly SortedSubstitution[];
  },
  input: {
    readonly dayChangesKey?: string | undefined;
    readonly dayDecisions?: DayDecisions | undefined;
  },
): PublishRefusal[] {
  const refusals: PublishRefusal[] = [];
  const exams = days.exams ?? [];
  // Task 5.6c-3a: a decision that names an exam of the sorting is the exams'.
  const { named } = examDecisionsOf(exams, input.dayDecisions);
  // Task 5.7b-3: and one that names a substitution, the substitutions'.
  const substitutions = days.substitutions ?? [];
  const forSubstitutions = substitutionDecisionsOf(substitutions, input.dayDecisions).named;
  const others = (input.dayDecisions ?? []).filter(
    (one) => !named.has(one) && !forSubstitutions.has(one),
  );
  const { decisions } = dayDecisionsOf(others);
  const bulkSent = others.filter((one) => one.blockId !== undefined);
  const bulkDecisions = new Set(bulkSent.map((one) => dayDecisionKeyOf(one)));
  const { key, items, bulk } = days;
  if (
    (items.length > 0 ||
      bulk.length > 0 ||
      exams.length > 0 ||
      substitutions.length > 0 ||
      input.dayChangesKey !== undefined) &&
    input.dayChangesKey !== key
  ) {
    refusals.push({ code: 'day_changes_changed' });
  }
  // A reason is only an exam's (decision 2, correction 1).
  for (const one of others) {
    if (one.reason !== undefined) {
      refusals.push({
        code: 'day_choice_not_offered',
        key: one.key,
        ...(one.blockId === undefined ? {} : { blockId: one.blockId, blockDate: one.blockDate }),
      });
    }
  }
  const open = new Set(
    items.filter((one) => one.category === 'decide').map((one) => one.answer.key),
  );
  for (const one of [...open].sort()) {
    if (!decisions.has(one)) refusals.push({ code: 'day_change_undecided', key: one });
  }
  for (const one of [...decisions.keys()].sort()) {
    if (!open.has(one)) refusals.push({ code: 'day_decision_unknown', key: one });
    else if (decisions.get(one) === 'keep') {
      refusals.push({ code: 'day_choice_not_offered', key: one });
    }
  }
  const openBulk = openBulkBlocks(bulk);
  for (const item of bulk) {
    for (const block of item.blocks) {
      if (block.carried === null && !bulkDecisions.has(block.decisionKey)) {
        refusals.push({
          code: 'day_change_undecided',
          key: item.answer.key,
          blockId: block.patternBlockId,
          blockDate: block.blockDate,
        });
      }
    }
  }
  for (const one of [...bulkSent].sort((a, b) =>
    dayDecisionKeyOf(a) < dayDecisionKeyOf(b) ? -1 : 1,
  )) {
    const at = { key: one.key, blockId: one.blockId, blockDate: one.blockDate };
    if (!openBulk.has(dayDecisionKeyOf(one))) {
      refusals.push({ code: 'day_decision_unknown', ...at });
    } else if (one.choice === 'drop') {
      refusals.push({ code: 'day_choice_not_offered', ...at });
    }
  }
  refusals.push(...examRefusalsOf(exams, input.dayDecisions));
  refusals.push(...substitutionRefusalsOf(substitutions, input.dayDecisions));
  return refusals;
}

/** Task 5.6c-3a: the exams of a carried version for its audit entry, none when it has none. */
function examsOfCarry(exams: ExamsAudit | undefined): {
  exams?: ExamsAudit;
} {
  return exams === undefined ? {} : { exams };
}

/** The one-day changes of a carried version for its audit entry, none when it wrote nothing. */
function dayOfCarry(days: DayAudit | undefined): { dayChanges?: DayAudit } {
  return days === undefined ? {} : { dayChanges: days };
}

/** The outcome of every stored one-day change of a run for the audit entry, by key (review should-fix 3). */
export function dayAuditOf(
  items: readonly SortedDayChange[],
  decisions: ReadonlyMap<string, DayChangeChoice>,
  settled: { readonly ended: readonly string[]; readonly recordedAgain: readonly string[] },
  bulk: BulkAudit | null = null,
  /** Task 5.7b-3: the substitutions of the run (`substitutionAuditOf`). */
  substitutions: SubstitutionsAudit | null = null,
): DayAudit {
  const keysOf = (category: string) =>
    items
      .filter((one) => one.category === category)
      .map((one) => one.answer.key)
      .sort();
  return {
    kept: keysOf('kept'),
    decided: items
      .filter((one) => one.category === 'decide')
      .map((one) => ({ key: one.answer.key, choice: decisions.get(one.answer.key) ?? null }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    dropped: keysOf('dropped'),
    ended: [...settled.ended],
    recordedAgain: [...settled.recordedAgain],
    ...(bulk === null ? {} : { bulk }),
    ...(substitutions === null ? {} : { substitutions }),
  };
}

/** The bulk cancels of a run for the audit entry (task 5.6a-5b-1). */
export function bulkAuditOf(
  items: readonly SortedBulk[],
  recorded: { readonly decided: BulkChoiceAudit[]; readonly carried: BulkChoiceAudit[] },
): BulkAudit | null {
  if (items.length === 0) return null;
  return {
    kept: items.map((one) => one.answer.key).sort(),
    decided: recorded.decided,
    carried: recorded.carried,
  };
}

/** A refusal as a detail of `publish_blocked` (decision 12). */
export function detailOf(refusal: PublishRefusal): ErrorDetail {
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
              : refusal.code.startsWith('day_')
                ? refusal.key === undefined
                  ? 'dayChanges'
                  : refusal.blockId === undefined
                    ? `dayChanges.${refusal.key}`
                    : `dayChanges.${refusal.key}.blocks.${refusal.blockId}.${refusal.blockDate ?? ''}`
                : refusal.code.startsWith('chain_') || refusal.code === 'version_later_published'
                  ? 'chain'
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
 * the people of the branch and the classes of the year FOR KEY SHARE in the
 * order of their id (task 5.5b-1); every version of the branch and year FOR
 * NO KEY UPDATE in the order of their id, the order `followTutors` takes;
 * then `lockDraft`, whose row lock is held.
 */
@Injectable()
export class TimetablePublish {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly requestKeys: RequestKeys,
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
    private readonly notifications: Notifications,
  ) {}

  /** What a publish on the date would refuse and warn, written nowhere (decision 13). */
  check(access: Access, id: string, startsOn: string, chain?: PublishChain): Promise<PublishCheck> {
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
        chain,
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
        chain: findings.chain,
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
    return refusingPublish(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        // Task 5.6a-5a (review must-fix 1): every key of a decision is a
        // change or a lesson of the branch, checked before any lock.
        await refuseUnknownKeys(
          transaction,
          branchId,
          (input.dayDecisions ?? []).map((one) => one.key),
          (input.dayDecisions ?? []).flatMap((one) =>
            one.blockId === undefined ? [] : [one.blockId],
          ),
        );
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
              chain: input.chain ?? null,
              laterKey: input.laterKey ?? null,
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
    options: FillOptions = {},
  ): Promise<TimetableVersion> {
    const { startsOn } = input;
    const branchId = branchOf(access);
    const named = await this.timetable.findVersion(transaction, branchId, id);
    await lockPublishChain(transaction, branchId, named.academic_year_id);
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
      input.chain,
      options,
    );
    const transitionKey = refuseUnshown(findings, input);

    await this.writeRuns(transaction, access, {
      mode: 'publish',
      version,
      startsOn,
      input,
      findings,
      requestId,
      transitionKey,
      startBefore,
      follow,
      vacancyFillOf: options.vacancyFillOf ?? null,
    });
    return this.timetable.answerOf(transaction, id, access.accountId);
  }

  /**
   * Task 5.7a-3a: the check of a fill's run, written nowhere: the version (a
   * draft the fill copied, or a published version that starts on the fill
   * date, its rows already changed in the transaction) checked on
   * `startsOn`, as the publish check answers it, with the findings the fill
   * reads its rows from.
   */
  async checkForFill(
    transaction: Transaction,
    access: Access,
    version: VersionRow,
    startsOn: string,
    chain: PublishChain | undefined,
    options: FillOptions,
  ): Promise<{ readonly check: PublishCheck; readonly findings: Findings }> {
    const today = await this.timetable.todayIn(transaction, version.branch_id);
    const quarters = await this.quartersOf(transaction, version);
    const choices = startChoices(today, engineYearOf(version, quarters));
    const findings = await this.findingsOn(
      transaction,
      version,
      startsOn,
      choices.earliest,
      quarters,
      access.accountId,
      chain,
      options,
    );
    return {
      findings,
      check: {
        startsOn,
        earliest: choices.earliest,
        defaultStart: choices.defaultStart,
        quarterStarts: [...choices.quarterStarts],
        refusals: [...findings.refusals],
        warnings: findings.warnings,
        cancelledLessons: findings.cancelledLessons,
        needsTeacher: findings.needsTeacher,
        impact: findings.impact?.answer ?? null,
        shortenedDays: findings.shortenedDays,
        unusedKeeps: findings.unusedKeeps,
        chain: findings.chain,
        canPublish: findings.refusals.length === 0,
      },
    };
  }

  /**
   * Task 5.7a-3a: the publish of the draft a fill copied, inside the fill's
   * transaction, which holds `PUBLISH_LOCK` and its request key.
   */
  publishForFill(
    transaction: Transaction,
    access: Access,
    id: string,
    input: PublishBody,
    options: FillOptions,
    requestId: string,
  ): Promise<TimetableVersion> {
    return this.publishLocked(transaction, access, id, input, requestId, options);
  }

  /**
   * Task 5.7a-3a (decision 4): a fill whose date is a published version's
   * start carries the change into that version in place, and into the later
   * ones; the version's rows are already changed in the transaction. The
   * same checks and writes as a publish (`refuseUnshown`, `writeRuns`).
   */
  async carryInPlace(
    transaction: Transaction,
    access: Access,
    version: VersionRow,
    input: PublishBody,
    options: FillOptions,
    requestId: string,
  ): Promise<void> {
    const { findings } = await this.checkForFill(
      transaction,
      access,
      version,
      version.starts_on,
      input.chain,
      options,
    );
    const transitionKey = refuseUnshown(findings, input);
    await this.writeRuns(transaction, access, {
      mode: 'fill',
      version,
      startsOn: version.starts_on,
      input,
      findings,
      requestId,
      transitionKey,
      startBefore: version.starts_on,
      follow: null,
      vacancyFillOf: options.vacancyFillOf ?? null,
      ...(options.carry === undefined ? {} : { changes: options.carry }),
    });
  }

  /**
   * The writes of a publish after its checks (task 5.5a-1 to 5.6c-3a), and of
   * a fill carried into a published version that starts on its date (task
   * 5.7a-3a, decision 4; spec review of the plan, must-fix 3: the publish's
   * code moved, not copied). `fill` changes only what that version has not:
   * no status, no weekly days, every draft of the year marked with the
   * fill's cause, the version's own entry a carry's, its notice the fill's.
   */
  private async writeRuns(transaction: Transaction, access: Access, run: RunWrite): Promise<void> {
    const { mode, version, startsOn, input, findings, requestId, transitionKey } = run;
    const id = version.id;
    const branchId = branchOf(access);
    const { decisions, bulkDecisions } = dayDecisionsOf(input.dayDecisions);
    const versions = await transaction
      .selectFrom('timetable_versions')
      .select(['id', 'number', 'status', 'starts_on', 'from_version_id', outOfDateColumn])
      .where('branch_id', '=', branchId)
      .where('academic_year_id', '=', version.academic_year_id)
      .orderBy('id')
      .execute();
    const before =
      versions
        .filter((one) => one.status === 'published' && one.starts_on < startsOn)
        .sort((a, b) => b.starts_on.localeCompare(a.starts_on) || b.number - a.number)[0] ?? null;
    // Task 5.6b-4a (decision 3): the weekly days the blocks were checked
    // against, written while the version is still a draft (0091).
    if (findings.written !== null && mode === 'publish') {
      await storeVersionDays(transaction, findings.written.state);
    }
    // The checks deferred to the commit (the pattern written by the Tutor
    // rows that followed, 0058) run now, while the version is still a draft.
    await sql`set constraints all immediate`.execute(transaction);
    if (mode === 'publish') {
      await transaction
        .updateTable('timetable_versions')
        .set({ status: 'published', edit_holder_id: null, edit_seen_at: null })
        .where('id', '=', id)
        .execute();
    }
    // Decision 4: every other draft of the branch and year is marked, unless
    // the published version is in its chain of sources; a draft already marked
    // gets the publish's cause too (task 5.5a-3b-1, spec review must-fix 2).
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
    // Task 5.7a-3a (decision 15): a fill in place marks every draft.
    const marked = versions.filter(
      (one) => one.id !== id && one.status === 'draft' && (mode === 'fill' || !descends(one.id)),
    );
    // Task 5.5a-3a: the answer to the later published versions.
    const replaced = mode === 'publish' && input.chain === 'replace' ? findings.later : [];
    for (const later of replaced) {
      await transaction
        .updateTable('timetable_versions')
        .set({ status: 'archived' })
        .where('id', '=', later.id)
        .execute();
    }
    // Task 5.5b-1: the dated lessons of the new version over its run; under
    // "replace" its run reaches the year's end, over the archived versions'.
    if (findings.written === null) {
      throw new Error('A publish with no refusal has its dated check.');
    }
    // Task 5.5c-3a: the lessons before the publish, its replace and carries,
    // read before the first write, to the year's end (decisions 5 and 6).
    const week = await snapshotWeek(transaction, branchId, startsOn, version.end_date);
    const ownSorting = findings.days?.sortings.get(null) ?? null;
    const ownBulk = findings.days?.bulk.get(null) ?? [];
    const ownExams = findings.days?.exams.get(null) ?? [];
    const ownExamAudit: ExamAudit[] = [];
    const lessons = await writeDatedLessons(
      transaction,
      findings.written.state,
      findings.written.findings,
      startsOn,
      findings.written.state.pattern.model.data.versionEnd,
      ownSorting === null
        ? null
        : planOfRun(ownSorting, ownBulk, decisions, bulkDecisions, input.dayDecisions),
      examsWriteOf({
        branchId,
        items: ownExams,
        begins: findings.written.findings.begins,
        sent: input.dayDecisions,
        audit: ownExamAudit,
      }),
    );
    const moment = await transactionMoment(transaction);
    const settled =
      ownSorting === null
        ? null
        : await settleDayChanges(transaction, {
            branchId,
            versionId: id,
            moment,
            accountId: access.accountId,
            items: ownSorting.items,
            decisions,
          });
    // Task 5.7b-3: the kept substitutions recorded again on lessons created again.
    const substitutionsSettled =
      ownSorting === null
        ? null
        : await settleSubstitutions(transaction, {
            branchId,
            items: ownSorting.substitutions,
            sent: input.dayDecisions,
            placed: lessons.substitutesPlaced,
            moment,
            accountId: access.accountId,
          });
    // Task 5.6a-5b-1: the choices of the bulk cancels' blocks recorded on the blocks written.
    const bulkRecorded = await recordBulkBlocks(transaction, {
      branchId,
      versionId: id,
      begins: findings.written.findings.begins,
      items: ownBulk,
      decisions: bulkDecisions,
    });
    const carried: CarryResult[] = [];
    const carryLeft: CarryResult[] = [];
    const carriedLessons = new Map<string, DatedWrite>();
    const carriedDays = new Map<string, DayAudit>();
    const carriedExams = new Map<string, ExamsAudit>();
    for (const result of input.chain === 'carry' ? findings.carried : []) {
      if (result.into.applied.length === 0) continue;
      const sorting = findings.days?.sortings.get(result.version.id) ?? null;
      const write = result.left
        ? null
        : await this.carryWrite(transaction, result, {
            sorting,
            bulk: findings.days?.bulk.get(result.version.id) ?? [],
            exams: findings.days?.exams.get(result.version.id) ?? [],
            sent: input.dayDecisions,
            decisions,
            bulkDecisions,
            branchId,
            versionId: id,
            moment,
            accountId: access.accountId,
          });
      if (write === null) {
        carryLeft.push(result);
      } else {
        carried.push(result);
        if (write.lessons !== true) carriedLessons.set(result.version.id, write.lessons);
        if (write.days !== null) carriedDays.set(result.version.id, write.days);
        if (write.exams !== null) carriedExams.set(result.version.id, write.exams);
      }
    }
    // Task 5.6c-3a: who is told of an exam the publish dropped, in its own
    // run and in each carried run written (decision 7).
    const examsCancelled = await examsCancelledOf(
      transaction,
      [...ownExams, ...carried.flatMap((one) => findings.days?.exams.get(one.version.id) ?? [])],
      input.dayDecisions,
    );
    // Task 5.5c-3a: one notice per affected teacher, and the changed lessons marked.
    const notices = await sendWeekChanges(transaction, this.notifications, week, {
      kind: mode === 'publish' ? 'timetable.published' : 'timetable.vacancy_filled',
      number: version.number,
      examsCancelled,
    });
    // Task 5.5c-1: the journals of the year follow the chain as it now stands.
    const journals = await syncJournals(transaction, this.audit, version, {
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      requestId,
    });
    // Task 5.7a-3a: the fill that made the change, on the version's own entry.
    const fillPart = run.vacancyFillOf === null ? {} : { vacancyFill: { ...run.vacancyFillOf } };
    const ownPart = {
      markedOutOfDate: marked.map((one) => one.id),
      chain: findings.chain === null ? null : (input.chain ?? null),
      replaced: replaced.map((one) => ({ id: one.id, number: one.number })),
      carried: carried.map((one) => ({ id: one.version.id, number: one.version.number })),
      carryLeft: carryLeft.map((one) => ({ id: one.version.id, number: one.version.number })),
      ...(run.follow !== null && followChanged(run.follow)
        ? { tutorLessons: auditOf(run.follow) }
        : {}),
      // Task 5.5a-2b-1, decision 11: the counts of the preview and the rows acknowledged.
      impact: findings.impact?.answer.counts ?? null,
      datedLessons: datedAuditOf(lessons),
      // Task 5.6a-5a: the outcome of every stored one-day change, by key.
      ...(ownSorting === null || settled === null
        ? {}
        : {
            dayChanges: dayAuditOf(
              ownSorting.items,
              decisions,
              settled,
              bulkAuditOf(ownBulk, bulkRecorded),
              substitutionsSettled === null
                ? null
                : substitutionAuditOf(
                    ownSorting.substitutions,
                    input.dayDecisions,
                    substitutionsSettled,
                  ),
            ),
          }),
      // Task 5.6c-3a: each standing exam of the run, kept or decided.
      ...(ownExams.length === 0
        ? {}
        : { exams: examAuditOf(ownExams, input.dayDecisions, ownExamAudit) }),
      journals: { ...journals },
      notices: { ...notices },
      ...(transitionKey === null || findings.impact === null
        ? {}
        : {
            transition: {
              weekStart: findings.impact.answer.transition?.weekStart ?? null,
              acknowledged: findings.impact.acknowledged.map((row) => ({ ...row })),
            },
          }),
    };
    if (mode === 'publish') {
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'timetable_version.publish',
        record: { type: 'timetable_version', id },
        oldValue: { status: 'draft', startsOn: run.startBefore },
        newValue: {
          status: 'published',
          number: version.number,
          startsOn,
          inForceBefore: before === null ? null : { id: before.id, number: before.number },
          ...ownPart,
          ...fillPart,
        },
        requestId,
      });
      await markPublished(transaction, this.audit, marked, {
        branchId,
        id,
        number: version.number,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        requestId,
      });
    } else {
      // Decision 4: the version that starts on the fill date takes the
      // change in place; its entry is a carry's, from no version.
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'timetable_version.carry',
        record: { type: 'timetable_version', id },
        oldValue: null,
        newValue: {
          fromVersionId: null,
          fromNumber: null,
          number: version.number,
          startsOn,
          changes: (run.changes ?? []).map((one) => ({ ...one })),
          ...ownPart,
          ...fillPart,
        },
        requestId,
      });
      await markFilled(transaction, this.audit, marked, {
        branchId,
        id,
        number: version.number,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        requestId,
      });
    }
    for (const later of replaced) {
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'timetable_version.replace',
        record: { type: 'timetable_version', id: later.id },
        oldValue: { status: 'published', number: later.number, startsOn: later.starts_on },
        newValue: { status: 'archived', replacedById: id, replacedByNumber: version.number },
        requestId,
      });
    }
    for (const result of carried) {
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'timetable_version.carry',
        record: { type: 'timetable_version', id: result.version.id },
        oldValue: null,
        newValue: {
          fromVersionId: id,
          fromNumber: version.number,
          changes: result.into.applied.map((one) => ({ ...one })),
          rows: result.into.rows.map((one) => ({ ...one })),
          entries: result.into.entries.map((one) => ({ ...one })),
          ...datedOfCarry(carriedLessons.get(result.version.id)),
          ...dayOfCarry(carriedDays.get(result.version.id)),
          ...examsOfCarry(carriedExams.get(result.version.id)),
        },
        requestId,
      });
    }
  }

  /**
   * The changes of a carry written into a later version (decision 3), under
   * a savepoint of its own: a refusal of the database that the engine did not
   * foresee leaves that version as it is (decision 8), its dated lessons
   * included (task 5.5b-1, spec review must-fix 4): they are written inside
   * the savepoint, from what the carry's check built. `null` when left; what
   * the lessons' write did, or `true` with no lesson to write. Task 5.6a-5a
   * (review should-fix 6): the stored one-day changes of its run are applied
   * and settled inside the savepoint too, with what that did for the audit.
   */
  private async carryWrite(
    transaction: Transaction,
    result: CarryResult,
    days: {
      readonly sorting: DaySorting | null;
      readonly bulk: readonly SortedBulk[];
      /** Task 5.6c-3a: the run's exams and the decisions sent. */
      readonly exams: readonly KeptExam[];
      readonly sent: DayDecisions | undefined;
      readonly decisions: ReadonlyMap<string, DayChangeChoice>;
      readonly bulkDecisions: ReadonlyMap<string, DayChangeChoice>;
      readonly branchId: string;
      readonly versionId: string;
      readonly moment: Date;
      readonly accountId: string;
    },
  ): Promise<{
    lessons: DatedWrite | true;
    days: DayAudit | null;
    exams: ExamsAudit | null;
  } | null> {
    const { sorting } = days;
    const examAudit: ExamAudit[] = [];
    await sql`savepoint carry_write`.execute(transaction);
    try {
      for (const row of result.into.rows) {
        await transaction
          .updateTable('teaching_load_rows')
          .set({ teacher_id: row.teacherId, room_id: row.roomId })
          .where('id', '=', row.id)
          .where('version_id', '=', result.version.id)
          .execute();
      }
      for (const entry of result.into.entries) {
        await transaction
          .updateTable('pattern_entries')
          .set({ room_id: entry.roomId })
          .where('id', '=', entry.id)
          .where('version_id', '=', result.version.id)
          .execute();
      }
      const written =
        result.written === null
          ? true
          : await writeDatedLessons(
              transaction,
              result.written.state,
              result.written.findings,
              result.version.starts_on,
              result.written.lastDate,
              sorting === null
                ? null
                : planOfRun(sorting, days.bulk, days.decisions, days.bulkDecisions, days.sent),
              examsWriteOf({
                branchId: days.branchId,
                items: days.exams,
                begins: result.written.findings.begins,
                sent: days.sent,
                audit: examAudit,
              }),
            );
      const settled =
        sorting === null
          ? null
          : await settleDayChanges(transaction, {
              branchId: days.branchId,
              versionId: days.versionId,
              moment: days.moment,
              accountId: days.accountId,
              items: sorting.items,
              decisions: days.decisions,
            });
      // Task 5.7b-3: inside the savepoint too.
      const substitutionsSettled =
        sorting === null || written === true
          ? null
          : await settleSubstitutions(transaction, {
              branchId: days.branchId,
              items: sorting.substitutions,
              sent: days.sent,
              placed: written.substitutesPlaced,
              moment: days.moment,
              accountId: days.accountId,
            });
      // Task 5.6a-5b-1: inside the savepoint too (decision 11).
      const bulkRecorded =
        result.written === null
          ? null
          : await recordBulkBlocks(transaction, {
              branchId: days.branchId,
              versionId: result.version.id,
              begins: result.written.findings.begins,
              items: days.bulk,
              decisions: days.bulkDecisions,
            });
      // Every constraint is immediate since the publish's own `set constraints
      // all immediate`, and again at the end of the lessons' write, so a
      // refusal comes here, inside the savepoint.
      await sql`release savepoint carry_write`.execute(transaction);
      return {
        lessons: written,
        exams: days.exams.length === 0 ? null : examAuditOf(days.exams, days.sent, examAudit),
        days:
          sorting === null || settled === null
            ? null
            : dayAuditOf(
                sorting.items,
                days.decisions,
                settled,
                bulkRecorded === null ? null : bulkAuditOf(days.bulk, bulkRecorded),
                substitutionsSettled === null
                  ? null
                  : substitutionAuditOf(sorting.substitutions, days.sent, substitutionsSettled),
              ),
      };
    } catch (error) {
      if (!isCheckRefusal(error)) throw error;
      await sql`rollback to savepoint carry_write`.execute(transaction);
      await sql`release savepoint carry_write`.execute(transaction);
      await sql`set constraints all immediate`.execute(transaction);
      return null;
    }
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
    chain?: PublishChain,
    options: FillOptions = {},
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
        chain: null,
        later: [],
        carried: [],
        written: null,
        days: null,
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

    // Task 5.5a-3a: a publish before a later published version asks its
    // question. "Run until" and "carry" end the new version the day before
    // the next start (decision 5: never on that start); "replace" runs it to
    // the year's end. With no answer yet, it is read as "run until".
    // Task 5.7a-3a (decision 4): a published version checked on its own
    // start is not its own later version.
    const later = (await laterVersionsOf(transaction, version, startsOn)).filter(
      (one) => one.id !== version.id,
    );
    const first = later[0];
    let runEnd = version.end_date;
    if (first !== undefined) {
      if (chain === undefined) {
        refusals.push({ code: 'version_later_published', versionNumber: first.number });
      } else if (chain !== 'replace' && first.starts_on === startsOn) {
        refusals.push({ code: 'chain_start_taken', versionNumber: first.number });
      }
      if (chain !== 'replace') {
        const end = addDays(first.starts_on, -1);
        runEnd = end < startsOn ? startsOn : end;
      }
    }
    if (version.out_of_date) {
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
    // Task 5.7a-3a (decision 8): a row naming a vacancy closed on a date of
    // the run, a close a fill planned (`lessons_vacancy_closed` refuses its
    // lessons anyway).
    const teacherIds = [...new Set(rows.map((row) => row.teacher_id))];
    if (teacherIds.length > 0) {
      const closed = await transaction
        .selectFrom('staff_statuses')
        .select('staff_id')
        .where('staff_id', 'in', teacherIds)
        .where('status', '=', 'closed')
        .where('valid_from', '<=', runEnd)
        .where((builder) =>
          builder.or([
            builder('valid_until', 'is', null),
            builder.and([
              builder('valid_until', '>', startsOn),
              builder('valid_until', '>', builder.ref('valid_from')),
            ]),
          ]),
        )
        .execute();
      const closedIds = new Set(closed.map((one) => one.staff_id));
      for (const row of rows) {
        if (closedIds.has(row.teacher_id)) {
          refusals.push({ code: 'load_vacancy_closed', loadRowId: row.id });
        }
      }
    }

    // Task 5.6c-3a: the invigilators of the standing exams to the year's
    // end are teachers of the facts, so the exams' check knows them.
    const invigilators = await extraTeachersOf(
      transaction,
      version.branch_id,
      startsOn,
      version.end_date,
    );
    const state = runningUntil(
      await this.pattern.stateOf(transaction, version, accountId, rows, invigilators),
      runEnd,
    );
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

    // Task 5.5a-3a: carry is offered by the difference from the source
    // (decision 4); under "carry" each later version is checked in memory
    // over its own run (decision 8).
    let chainAnswer: PublishChainAnswer | null = null;
    const carried: CarryResult[] = [];
    if (first !== undefined) {
      // Task 5.7a-3a: a fill names its changes, the rows of every version.
      const source =
        options.carry !== undefined || version.from_version_id === null
          ? null
          : carryVersionOf(
              await this.pattern.stateOf(
                transaction,
                await this.timetable.versionRow(transaction, version.from_version_id),
                accountId,
              ),
            );
      const offer: CarryOffer =
        options.carry === undefined
          ? carryChanges(source, carryVersionOf(state))
          : { offered: true, changes: options.carry };
      if (chain === 'carry' && !offer.offered) {
        refusals.push({ code: 'chain_carry_not_offered' });
      }
      if (chain === 'carry' && offer.offered) {
        const reader: CarryReader = {
          stateOf: (other, otherRows) =>
            this.pattern.stateOf(transaction, other, accountId, otherRows, invigilators),
          versionRow: (versionId) => this.timetable.versionRow(transaction, versionId),
          loadProblems: async (other, otherRows) =>
            (
              await this.timetable.readinessOf(transaction, other.branch_id, other, otherRows)
            ).load.problemRows.map((one) => ({ id: one.id, problems: one.problems })),
        };
        for (const [index, one] of later.entries()) {
          carried.push(
            await carryResultOf(
              transaction,
              reader,
              one,
              runEndOf(later, index + 1, version.end_date),
              offer.changes,
            ),
          );
        }
      }
      chainAnswer = {
        key: laterKeyOf(version.id, startsOn, later),
        later: later.map((one) => ({ id: one.id, number: one.number, startsOn: one.starts_on })),
        carryOffered: offer.offered,
        carryReason: offer.offered ? null : offer.reason,
        changes: offer.offered
          ? offer.changes.map((one) => ({
              kind: one.kind,
              classId: one.classId,
              groupId: one.groupId,
              subjectId: one.subjectId,
              ...(one.kind === 'entry_room'
                ? { weekday: weekdaySchema.parse(one.weekday), slotPosition: one.slotPosition }
                : {}),
              before: one.before,
              after: one.after,
            }))
          : [],
        carried: carried.map((one) => ({
          versionId: one.version.id,
          number: one.version.number,
          startsOn: one.version.starts_on,
          applied: one.into.applied.length,
          left: one.left,
          refusals: one.refusals,
        })),
      };
    }
    // Task 5.6a-5a: the stored one-day changes of every run written, sorted;
    // a carried version left as it is writes nothing, so its changes stay as
    // they are and are not sorted (review correction 1).
    const sortings = new Map<string | null, DaySorting>();
    // Task 5.6c-3a: the standing exams of each run, read before its one-day
    // changes are sorted (which leave out the lessons they cover), and
    // sorted after on the findings with the kept changes applied.
    const examSortings = new Map<string | null, KeptExam[]>();
    const branchId = version.branch_id;
    const ownExamsBefore = await examsBeforeOf(transaction, {
      branchId,
      findings: dated,
      firstDate: startsOn,
      lastDate: state.pattern.model.data.versionEnd,
    });
    const ownDays = await sortDayChanges(transaction, {
      state,
      findings: dated,
      firstDate: startsOn,
      lastDate: state.pattern.model.data.versionEnd,
      carriedVersionId: null,
      ...(ownExamsBefore.forSorting === undefined ? {} : { exams: ownExamsBefore.forSorting }),
    });
    const ownExamsKept = sortExamsKept({
      branchId,
      state,
      findings: ownDays.findings,
      before: ownExamsBefore,
      carriedVersionId: null,
      noTimetable: false,
    });
    examSortings.set(null, ownExamsKept);
    // Task 5.7b-3: the substitutions after the exams, on the same findings.
    sortings.set(
      null,
      await sortSubstitutionsKept(transaction, {
        branchId,
        sorting: ownDays,
        firstDate: startsOn,
        lastDate: state.pattern.model.data.versionEnd,
        carriedVersionId: null,
        exams: ownExamsKept,
        ...(ownExamsBefore.forSorting === undefined
          ? {}
          : { examCovered: ownExamsBefore.forSorting.covered }),
      }),
    );
    const carriedSorted: CarryResult[] = [];
    for (const one of carried) {
      if (one.left || one.written === null) {
        carriedSorted.push(one);
        continue;
      }
      const examsBefore = await examsBeforeOf(transaction, {
        branchId,
        findings: one.written.findings,
        firstDate: one.version.starts_on,
        lastDate: one.written.lastDate,
      });
      const sorting = await sortDayChanges(transaction, {
        state: one.written.state,
        findings: one.written.findings,
        firstDate: one.version.starts_on,
        lastDate: one.written.lastDate,
        carriedVersionId: one.version.id,
        ...(examsBefore.forSorting === undefined ? {} : { exams: examsBefore.forSorting }),
      });
      const examsKept = sortExamsKept({
        branchId,
        state: one.written.state,
        findings: sorting.findings,
        before: examsBefore,
        carriedVersionId: one.version.id,
        noTimetable: false,
      });
      examSortings.set(one.version.id, examsKept);
      // Task 5.7b-3: the carried run's substitutions, after its exams.
      const withSubstitutions = await sortSubstitutionsKept(transaction, {
        branchId,
        sorting,
        firstDate: one.version.starts_on,
        lastDate: one.written.lastDate,
        carriedVersionId: one.version.id,
        exams: examsKept,
        ...(examsBefore.forSorting === undefined
          ? {}
          : { examCovered: examsBefore.forSorting.covered }),
      });
      sortings.set(one.version.id, withSubstitutions);
      carriedSorted.push({
        ...one,
        written: { ...one.written, findings: withSubstitutions.findings },
      });
    }
    const items = [...sortings.values()].flatMap((one) => one.items);
    // Task 5.6a-5b-1: the bulk cancels of each run sorted, on its findings with
    // the kept one-day changes applied (decision 9).
    const bulk = new Map<string | null, SortedBulk[]>();
    for (const [carriedVersionId, sorting] of sortings) {
      const firstDate =
        carriedVersionId === null
          ? startsOn
          : (carried.find((one) => one.version.id === carriedVersionId)?.version.starts_on ??
            startsOn);
      const lastDate =
        carriedVersionId === null
          ? state.pattern.model.data.versionEnd
          : (carried.find((one) => one.version.id === carriedVersionId)?.written?.lastDate ??
            firstDate);
      bulk.set(
        carriedVersionId,
        sortBulkOf({
          lessons: sorting.findings.dated.lessons,
          movedAt: sorting.movedAt,
          begins: sorting.findings.begins,
          records: await bulkRecordsOf(transaction, version.branch_id, firstDate, lastDate),
          carriedVersionId,
        }),
      );
    }
    const bulkItems = [...bulk.values()].flat();
    const examItems = [...examSortings.values()].flat();
    const daysKey = dayChangesKeyOf(
      version.id,
      startsOn,
      items,
      bulkItems.length === 0 ? null : bulkKeyPartOf(bulkItems),
      examKeyPartOf(examItems),
      substitutionKeyPartOf([...sortings.values()].flatMap((one) => one.substitutions)),
    );
    const ownSorting = sortings.get(null);
    if (ownSorting === undefined) throw new Error('The run is always sorted.');

    // Task 5.5a-2b-1: the impact preview and the transition week.
    const impact = await impactOf(
      transaction,
      {
        versionRow: (versionId) => this.timetable.versionRow(transaction, versionId),
        stateOf: (other) => this.pattern.stateOf(transaction, other, accountId),
      },
      state,
      ownSorting.findings,
      startsOn,
      {
        key: daysKey,
        items,
        bulk: bulkItems,
        exams: examItems,
        substitutions: [...sortings.values()].flatMap((one) => one.substitutions),
        keptStored: new Map([...sortings].map(([id, one]) => [id, one.keptStoredIds])),
      },
      carriedSorted.flatMap((one) =>
        one.left || one.before === null || one.written === null
          ? []
          : [
              {
                versionId: one.version.id,
                number: one.version.number,
                firstDate: one.version.starts_on,
                lastDate: one.written.lastDate,
                before: one.before,
                state: one.written.state,
                after: one.written.findings,
              },
            ],
      ),
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
      chain: chainAnswer,
      later,
      carried: carriedSorted,
      written: { state, findings: ownSorting.findings },
      days: { key: daysKey, items, sortings, bulk, exams: examSortings },
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

/**
 * What refuses a write of what the check showed (tasks 5.5a-2b-1 to 5.6a-5a),
 * added to the findings' refusals, which refuse the write together
 * (`publish_blocked`); the transition week's key, or `null`.
 */
function refuseUnshown(findings: Findings, input: PublishBody): string | null {
  // Task 5.5a-3a (spec review of the plan, should-fix 2): the answer counts
  // only for the later versions that were shown.
  if (
    findings.chain !== null &&
    input.chain !== undefined &&
    input.laterKey !== findings.chain.key
  ) {
    findings.refusals.push({ code: 'chain_changed' });
  }
  // Decision 11 with review correction 1: a transition week that differs
  // from the load is published only with the key of what was shown.
  const transitionKey = findings.impact?.answer.transition?.key ?? null;
  if (transitionKey !== null && input.transitionKey !== transitionKey) {
    findings.refusals.push({ code: 'transition_unacknowledged' });
  }
  // Task 5.6a-5a: the one-day changes as shown, and a choice for each
  // "needs a decision" item (edge/timetable, Versions and drafts: "Publish
  // waits until every 'needs a decision' item is settled").
  if (findings.days !== null) {
    findings.refusals.push(
      ...dayRefusalsOf(
        {
          key: findings.days.key,
          items: findings.days.items,
          bulk: [...findings.days.bulk.values()].flat(),
          exams: [...findings.days.exams.values()].flat(),
          substitutions: [...findings.days.sortings.values()].flatMap((one) => one.substitutions),
        },
        input,
      ),
    );
  }
  if (findings.refusals.length > 0) {
    throw new ApiException('publish_blocked', 409, undefined, findings.refusals.map(detailOf));
  }
  return transitionKey;
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

/**
 * The locks a write of the published chain takes after `PUBLISH_LOCK`, in
 * this order (a publish, task 5.5a-1; a withdraw, task 5.5c-2a): the branch
 * row FOR KEY SHARE; the year FOR SHARE; the people of the branch and the
 * classes of the year FOR KEY SHARE in the order of their id (task 5.5b-1);
 * every version of the branch and year FOR NO KEY UPDATE in the order of
 * their id, the order `followTutors` takes.
 */
export async function lockPublishChain(
  transaction: Transaction,
  branchId: string,
  yearId: string,
): Promise<void> {
  await transaction
    .selectFrom('branches')
    .select('id')
    .where('id', '=', branchId)
    .forKeyShare()
    .execute();
  await transaction
    .selectFrom('academic_years')
    .select('id')
    .where('id', '=', yearId)
    .forShare()
    .execute();
  // Task 5.5b-1 (spec review must-fix 5): the people of the branch FOR KEY
  // SHARE before the versions, the lock the lessons' keys to them take. A
  // status change holds its person FOR UPDATE and then waits for the
  // versions inside `followTutors`; taking it here first, the publish waits
  // for such a change, or the change waits for the publish, never both.
  await transaction
    .selectFrom('staff')
    .select('staff.id')
    .where('staff.id', 'in', (eb) =>
      eb.selectFrom('staff_branches').select('staff_id').where('branch_id', '=', branchId),
    )
    .orderBy('staff.id')
    .forKeyShare()
    .execute();
  // Review of #152, finding 1: the classes of the year FOR KEY SHARE too,
  // the lock the lessons' keys to them take. An archive holds its class FOR
  // UPDATE and then waits for the versions inside `followTutors`. The other
  // parents a lesson names (groups, rooms, subjects, quarters) have no
  // holder FOR UPDATE that reaches `followTutors`.
  await transaction
    .selectFrom('classes')
    .select('id')
    .where('branch_id', '=', branchId)
    .where('academic_year_id', '=', yearId)
    .orderBy('id')
    .forKeyShare()
    .execute();
  await transaction
    .selectFrom('timetable_versions')
    .select('id')
    .where('branch_id', '=', branchId)
    .where('academic_year_id', '=', yearId)
    .orderBy('id')
    // Task 5.5a-3b-1, decision 8: a cause's foreign key is not blocked.
    .forNoKeyUpdate()
    .execute();
}

/**
 * A refusal of a check of the database (23514, 23P01), which a carry write
 * leaves its version for (decision 8); never one that only a fault of the
 * code raises (task 5.5b-1, decision 10).
 */
function isCheckRefusal(error: unknown): boolean {
  const failure = error as { code?: unknown; constraint?: unknown } | null;
  return (
    (failure?.code === '23514' || failure?.code === '23P01') &&
    !(typeof failure.constraint === 'string' && CODE_FAULTS.has(failure.constraint))
  );
}

/** The guards of 0079 that only a fault of the code can raise: errors of the server (decision 10). */
// `lesson_double_pair` too (review of #152): the writer makes the pair ids,
// and `PUBLISH_LOCK` serialises the publishes that could meet on one.
// The 0058/0066 guards of a lesson against its block, its unit and the rows
// of its version too (second opinion of round 2): a published version's rows
// are fixed, and a class's year and a group's subject are never updated.
// `lesson_block_quarter` stays a check refusal: a quarter's dates change.
const CODE_FAULTS = new Set([
  'lesson_delete_past',
  'lesson_repoint',
  'lesson_repoint_past',
  'lesson_double_pair',
  'lesson_block_date',
  'lesson_block_version',
  'lesson_unit_year',
  'lesson_group_subject',
  'lesson_load_row',
  'lesson_pattern_entry',
]);

/**
 * The refusals of a publish (task 5.5b-1, decision 10; 5.5b From 5.1a): the
 * pattern's, and the guards of the lessons that a change written at the same
 * moment can raise, as `timetable_busy` with the code only; the rule engine
 * checked every date first. A deadlock or a failed serialization is
 * `timetable_busy` too.
 */
export const PUBLISH_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  ...PATTERN_REFUSALS,
  time_claims_teacher_excl: 'timetable_busy',
  time_claims_room_excl: 'timetable_busy',
  time_claims_class_excl: 'timetable_busy',
  room_shared_full: 'timetable_busy',
  room_shared_capacity: 'timetable_busy',
  lesson_block_student_twice: 'timetable_busy',
  // Task 5.6c-3a (spec review of the code, must-fix 1): the guards of a
  // standing exam that a publish or a withdraw meets at the commit (0060),
  // which the sorting checks first; never a 500.
  exam_group_slots: 'timetable_busy',
  exam_incomplete: 'timetable_busy',
  lesson_block_class_out_exam: 'timetable_busy',
  // Task 5.8b (decision 2): a write that would remove a lesson holding data
  // (0105, `lessons_delete_data`); from 6.1 the writers keep and list it.
  lesson_holds_data: 'lesson_holds_data',
};

const BUSY_CODES = new Set(['40P01', '40001']);

export async function refusingPublish<T>(
  work: () => Promise<T>,
  refusals: Readonly<Record<string, ErrorCode>> = PUBLISH_REFUSALS,
): Promise<T> {
  try {
    return await refusingConstraints(work, refusals);
  } catch (error) {
    if (BUSY_CODES.has(String((error as { code?: unknown }).code))) {
      throw new ApiException('timetable_busy', 409);
    }
    throw error;
  }
}

/** The dated lessons of a carry entry, when the carry wrote any. */
const datedOfCarry = (write: DatedWrite | undefined) =>
  write === undefined ? {} : { datedLessons: datedAuditOf(write) };

/** The part of an audit entry that names what a write of dated lessons did (decision 12). */
export function datedAuditOf(write: DatedWrite) {
  return {
    firstDate: write.firstDate,
    lastDate: write.lastDate,
    created: write.created,
    kept: write.kept,
    cancelled: write.cancelled,
    removed: write.removed.map((one) => ({ ...one })),
    changed: write.changed.map((one) => ({
      id: one.id,
      teacherId: { ...one.teacherId },
      roomId: { ...one.roomId },
      ...(one.cancel === undefined ? {} : { cancel: { ...one.cancel } }),
    })),
    // Task 5.7b-1 (decision 6): the substitutions the write dropped.
    ...(write.substitutionsDropped.length === 0
      ? {}
      : { substitutionsDropped: write.substitutionsDropped.map((one) => ({ ...one })) }),
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
