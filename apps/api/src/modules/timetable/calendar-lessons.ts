import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  CALENDAR_CANCEL_CAUSES,
  type CalendarLesson,
  type CalendarDaysBody,
  type CalendarLessons,
  type DayChangeChoice,
  type DayKeepBody,
  type ErrorDetail,
  type RuleResultAnswer,
  weekdaySchema,
} from '@sodiq/shared';
import { addDays, patternIdOf, weekdayOf, type RuleResult } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { Notifications } from '../notifications/notifications.service.js';
import {
  bulkKeyPartOf,
  bulkRecordsOf,
  recordBulkBlocks,
  sortBulkOf,
  type SortedBulk,
} from './bulk-cancels-kept.js';
import {
  examBlocked,
  examLessonsOf,
  examPlacementsOn,
  examWeekLessonsOn,
  examWriteOf,
  findingsLessonsOn,
  examsChangedOf,
  sortExams,
  standingExamsOn,
  storedChoicesOf,
  storedExamLessonsOn,
  type ExamAudit,
  type ExamBlockChoice,
  type ExamChoiceOf,
  type ExamOutcome,
  type SortedExam,
} from './calendar-exams.js';
import { groupBlockLines, storeGroupChoices, type GroupBlockAudit } from './calendar-groups.js';
import { runningUntil } from './chain.js';
import { extraTeachersOf } from './exams-kept.js';
import { datedCheck, type DatedFindings } from './dated-check.js';
import { writeDatedLessons, type DatedWrite } from './dated-lessons.js';
import {
  settleSubstitutions,
  sortSubstitutionsKept,
  substitutionAuditOf,
  substitutionKeyPartOf,
} from './substitutions-kept.js';
import {
  dayChangesKeyOf,
  settleDayChanges,
  retimed,
  sortDayChanges,
  type DaySorting,
  type DayWritePlan,
  type SortedDayChange,
  type StoredRetime,
} from './day-changes-kept.js';
import { dayChangeIdsOf, namesOf } from './impact.js';
import { runsOf } from './journals.js';
import type { PatternState } from './pattern.service.js';
import { TimetablePattern } from './pattern.service.js';
import {
  bulkAuditOf,
  datedAuditOf,
  dayAuditOf,
  dayDecisionsOf,
  dayRefusalsOf,
  detailOf,
  planOfRun,
  refuseUnknownKeys,
  type DayAudit,
} from './publish.service.js';
import { storedDayCheck, storedLessonsOn, type StoredDayLesson } from './stored-day.js';
import { heldDataLinesOf, storedLessonRows, type StoredLesson } from './stored-lessons.js';
import { Timetable } from './timetable.service.js';
import {
  readDates,
  sendWeekChanges,
  snapshotDates,
  weekChanges,
  type WeekNotices,
} from './week-changes.js';

/**
 * The dated lessons of the dates a calendar entry changes (task 5.6b-1;
 * `edge/time-dates-calendar`: "A day off is announced for a future date. ...
 * The lessons of that date are removed ..., and the impact preview is shown
 * first"; "A day off is taken back, or a school day is added. Lessons are
 * created from the timetable version in force on that date and checked like
 * a publish"; `edge/timetable`, Versions and drafts: "Publish, a calendar
 * change and a template change each test every affected date with the full
 * rule set. A blocked conflict on any date stops the save and is listed by
 * date").
 *
 * The dates given are the lesson dates of the save, all after today: the
 * dates where the part of a grade's day that makes lessons differs before and
 * after it (decision 13). Each lies in the run of the published version in
 * force on it (`runsOf`), or in none, where nothing is written (decision 10).
 * A version writes each stretch of consecutive dates of its run on its own,
 * read as if it started on the stretch's first date (decision 4,
 * `.claude/rules/timetable.md`), checked by `datedCheck` over that stretch
 * only (decision 5) and written by `writeDatedLessons`; lessons of other
 * dates keep their identity.
 *
 * Task 5.6b-2a: the stored one-day changes and bulk cancels of each stretch
 * are sorted as a publish sorts them (`sortDayChanges`, `sortBulkOf`), kept,
 * needs a decision or dropped, with one key over the stretches; the save
 * takes the key and a choice for each "needs a decision" item, and writes
 * over the findings with the kept changes applied.
 *
 * Task 5.6b-2b (pull request #171): the choices of the lessons kept on the
 * shortened days of the dates written (`edge/time-dates-calendar`, "A
 * shortened day ...: The Academic Vice Principal can choose which lessons are
 * kept") are stored for the version in force on each date before its stretch
 * is checked, so the findings, the sorting and its key follow them; a choice
 * the day cannot take refuses the save with the draft's codes (decision 9),
 * and is a line of the preview, left out (decision 10).
 *
 * Task 5.6b-2c-1 (pull request #173): the exams standing on the dates
 * written follow the day after the save (`calendar-exams.ts`): cancelled for
 * a day off, the Academic Vice Principals told; moved with their slots and
 * checked again; refused, listed, when the day drops a slot or puts their
 * classes on two templates; the lessons under them cancelled "exam" over the
 * rewrite, and those no longer under one held again.
 *
 * Task 5.6b-2c-2: a stored move between two stretches is sorted once over
 * both (`across` of `sortDayChanges`): kept when its new place takes it,
 * else needs a decision in both halves; settled and audited once, in the
 * stretch of its old place.
 *
 * Task 5.6b-3: a day-off entry that leaves one grade of a two-grade group at
 * school takes a choice per block of the group (`calendar-groups.ts`),
 * stored per date for the dates written before each stretch is checked
 * again, as the shortened day's choice; a block of the entry with none
 * refuses the save, a detail of `calendar_blocked`.
 */

/** A stretch as read once: its version, dates, state and findings (task 5.6b-2c-2). */
interface StretchBase {
  readonly versionId: string;
  readonly part: { readonly first: string; readonly last: string };
  readonly state: PatternState;
  readonly findings: DatedFindings;
}

/** One stretch of consecutive lesson dates of one published version. */
interface Stretch {
  readonly versionId: string;
  readonly firstDate: string;
  readonly lastDate: string;
  readonly state: PatternState;
  readonly findings: DatedFindings;
  /** Task 5.6b-2a: its stored one-day changes and bulk cancels sorted, and their key. */
  readonly sorting: DaySorting;
  readonly bulk: readonly SortedBulk[];
  readonly key: string;
  /** Task 5.6b-2c-1: its exams as the save leaves them, and their recheck. */
  readonly exams: readonly SortedExam[];
  readonly examBlocked: readonly { readonly examId: string; readonly result: RuleResult }[];
  /** The sitting classes with a shared block newly under an exam: the block's lessons. */
  readonly examNeeds: readonly ExamNeed[];
}

/** A sitting class whose lesson a save newly puts in a block shared under an exam (decision 5). */
interface ExamNeed {
  readonly examId: string;
  readonly date: string;
  readonly classId: string;
  /** The block's first minute after the save, which names it in the save's choices. */
  readonly start: number;
  /** The dated lessons of the block, by placement id. */
  readonly lessonIds: readonly string[];
}

/** What the rewrite found and did; `audit` is `null` when no date lies in a published run. */
export interface CalendarRewrite {
  readonly lessons: CalendarLessons;
  readonly audit: {
    readonly dates: readonly string[];
    readonly datedLessons: ReturnType<typeof datedAuditOf>[];
    readonly notices: WeekNotices;
    /** Task 5.6b-2a: the outcome of the stored changes per stretch, and the moves put back. */
    readonly dayChanges: readonly StretchDays[];
    readonly movedBack: readonly string[];
    /** Task 5.6b-2b: each choice sent, per version, date and class, before and after. */
    readonly dayKeeps: readonly KeepAudit[];
    /** Task 5.6b-2c-1 (decision 7): what the save did to each exam of its dates. */
    readonly exams: readonly ExamAudit[];
    /** Task 5.6b-3: each choice of a split group's block written or removed. */
    readonly groupBlocks: readonly GroupBlockAudit[];
    /** Task 5.6b-4b: the stored blocks a template change kept and moved to their new times. */
    readonly storedBlocks: readonly StoredBlockTimes[];
  } | null;
}

/** What an audit entry of a save (a calendar entry, task 5.6b-1, or a template change, task 5.6b-4a) records of its lessons (task 5.6b-1, decision 8). */
export const lessonsAuditOf = (rewrite: CalendarRewrite) =>
  rewrite.audit === null
    ? {}
    : {
        lessonDates: [...rewrite.audit.dates],
        datedLessons: rewrite.audit.datedLessons.map((one) => ({ ...one })),
        notices: { ...rewrite.audit.notices },
        // Task 5.6b-2a (decision 10): the stored changes per stretch, when any.
        ...(rewrite.audit.dayChanges.length === 0
          ? {}
          : { dayChanges: rewrite.audit.dayChanges.map((one) => structuredClone(one)) }),
        ...(rewrite.audit.movedBack.length === 0
          ? {}
          : { movedBack: [...rewrite.audit.movedBack] }),
        // Task 5.6b-2b (decision 6, review correction 2): each choice sent.
        ...(rewrite.audit.dayKeeps.length === 0
          ? {}
          : {
              dayKeeps: rewrite.audit.dayKeeps.map((one) => ({
                ...one,
                before: [...one.before],
                after: [...one.after],
              })),
            }),
        // Task 5.6b-2c-1 (decision 7): each exam of its dates, when any.
        ...(rewrite.audit.exams.length === 0
          ? {}
          : { exams: rewrite.audit.exams.map((one) => structuredClone(one)) }),
        // Task 5.6b-4b: each kept stored block moved, before and after.
        ...(rewrite.audit.storedBlocks.length === 0
          ? {}
          : { storedBlocks: rewrite.audit.storedBlocks.map((one) => structuredClone(one)) }),
        // Task 5.6b-3: each choice of a split group's block written or removed.
        ...(rewrite.audit.groupBlocks.length === 0
          ? {}
          : { groupBlocks: rewrite.audit.groupBlocks.map((one) => structuredClone(one)) }),
      };

/** Task 5.6b-4b: a kept stored block moved to the new times of a template change, as the audit entry keeps it. */
export type StoredBlockTimes = {
  readonly blockId: string;
  readonly date: string;
  readonly before: { readonly startsAt: string; readonly endsAt: string };
  readonly after: { readonly startsAt: string; readonly endsAt: string };
};

/** A choice of the lessons kept on a shortened day as the audit entry keeps it (task 5.6b-2b). */
export interface KeepAudit {
  readonly versionId: string;
  readonly date: string;
  readonly classId: string;
  readonly before: readonly number[];
  readonly after: readonly number[];
}

type KeepRefusal = CalendarLessons['keepRefusals'][number];

/** The entry named in the notices. */
export interface CalendarEvent {
  readonly name: string;
  readonly firstDate: string;
  readonly lastDate: string;
}

/** Task 5.6b-4a (decision 6): a change of the day templates from a date, named in the notices. */
export interface TemplateEvent {
  readonly templateFrom: string;
}

/** Task 5.6b-5a (decision 9): a save of a year's quarters, named in the notices by the dates it writes. */
export interface QuartersEvent {
  readonly quarterDates: { readonly firstDate: string; readonly lastDate: string };
}

/** What wrote the dates again: a calendar entry, a template change or a quarter change. */
export type RewriteEvent = CalendarEvent | TemplateEvent | QuartersEvent;

const EMPTY_NAMES: CalendarLessons['names'] = { units: [], subjects: [], teachers: [], rooms: [] };

export const NO_LESSONS: CalendarLessons = {
  removed: [],
  created: [],
  cancelled: [],
  keptWithData: [],
  givenBack: [],
  heldData: [],
  needsTeacher: [],
  notified: [],
  blocked: [],
  dayChanges: {
    key: calendarDaysKeyOf([]),
    kept: [],
    decide: [],
    dropped: [],
    bulk: [],
    exams: [],
    absences: [],
    closures: [],
    substitutions: [],
  },
  shortenedDays: [],
  keepRefusals: [],
  exams: [],
  groupBlocks: [],
  groupBlocksUnused: [],
  names: EMPTY_NAMES,
};

const lineOf = (one: StoredLesson): CalendarLesson => ({
  date: one.lesson.date,
  start: one.lesson.start,
  end: one.lesson.end,
  unitId: one.lesson.unitId,
  subjectId: one.lesson.subjectId,
  teacherIds: [...one.lesson.teacherIds],
  roomId: one.lesson.roomId,
});

const byPlace = (a: CalendarLesson, b: CalendarLesson): number =>
  a.date.localeCompare(b.date) ||
  a.start - b.start ||
  a.unitId.localeCompare(b.unitId) ||
  a.subjectId.localeCompare(b.subjectId);

/** The same lesson for the preview: its place, class or group, subject, teacher, room and cancel. */
const sameKey = (one: StoredLesson): string =>
  [
    one.lesson.date,
    one.lesson.start,
    one.lesson.end,
    one.lesson.unitId,
    one.lesson.subjectId,
    one.lesson.teacherIds.join(','),
    one.lesson.roomId ?? '',
    one.cancelCause ?? '',
  ].join('|');

/** The lessons of `after` with no equal in `before`, one to one. */
function unpaired(before: readonly StoredLesson[], after: readonly StoredLesson[]) {
  const waiting = new Map<string, number>();
  for (const one of before) waiting.set(sameKey(one), (waiting.get(sameKey(one)) ?? 0) + 1);
  return after.filter((one) => {
    const left = waiting.get(sameKey(one)) ?? 0;
    if (left === 0) return true;
    waiting.set(sameKey(one), left - 1);
    return false;
  });
}

/** Stretches of consecutive dates: a date one day after the one before joins it. */
function stretchesOf(dates: readonly string[]): { first: string; last: string; dates: string[] }[] {
  const runs: { first: string; last: string; dates: string[] }[] = [];
  for (const date of dates) {
    const last = runs.at(-1);
    if (last !== undefined && addDays(last.last, 1) === date) {
      last.last = date;
      last.dates.push(date);
    } else {
      runs.push({ first: date, last: date, dates: [date] });
    }
  }
  return runs;
}

/** A blocked result of a date as a detail of `calendar_blocked`, in the publish's shape. */
function blockedDetail(result: DatedFindings['blocked'][number]): ErrorDetail {
  return {
    path: `dates.${result.date ?? ''}.${result.rule}`,
    code: 'date_blocked',
    message: 'A blocked conflict on a date the calendar save changes.',
    rule: { weekday: result.weekday, lessonIds: result.lessonIds },
    ...(result.date === undefined ? {} : { day: result.date }),
  };
}

/**
 * Every id of the choices a save of dated lessons takes (a calendar save, a
 * template change of task 5.6b-4a) is the branch's: the keys and blocks of
 * the decisions, the classes of the shortened days' and the exam blocks'
 * choices, the exams and the groups; checked before any lock or write, a 404
 * otherwise (`.claude/rules/api.md`).
 */
export async function refuseForeignChoices(
  transaction: Transaction,
  branchId: string,
  days: CalendarDaysBody,
): Promise<void> {
  // Task 5.6b-2a (decision 11): every key and block of a decision is
  // the branch's, checked before any lock.
  await refuseUnknownKeys(
    transaction,
    branchId,
    (days.dayDecisions ?? []).map((one) => one.key),
    (days.dayDecisions ?? []).flatMap((one) => (one.blockId === undefined ? [] : [one.blockId])),
  );
  // Task 5.6b-2b: every class of a choice is the branch's, checked
  // before any lock or write (`.claude/rules/api.md`).
  // Task 5.6b-2c-1: so is every exam and class of a block's choice.
  const classIds = [
    ...new Set([
      // One spelling for both (spec review of the code, should-fix 6).
      ...(days.dayKeeps ?? []).map((one) => one.classId.toLowerCase()),
      ...(days.examBlocks ?? []).map((one) => one.classId.toLowerCase()),
    ]),
  ];
  // Task 5.6b-3: every group of a block's choice is the branch's.
  const groupIds = [
    ...new Set(
      (days.groupBlocks ?? []).flatMap((one) => one.groupIds.map((id) => id.toLowerCase())),
    ),
  ];
  if (groupIds.length > 0) {
    const known = await transaction
      .selectFrom('groups')
      .select('id')
      .where('id', 'in', groupIds)
      .where('branch_id', '=', branchId)
      .execute();
    if (known.length !== groupIds.length) {
      throw new ApiException('not_found', 404);
    }
  }
  const examIds = [...new Set((days.examBlocks ?? []).map((one) => one.examId.toLowerCase()))];
  if (examIds.length > 0) {
    const known = await transaction
      .selectFrom('exams')
      .select('id')
      .where('id', 'in', examIds)
      .where('branch_id', '=', branchId)
      .execute();
    if (known.length !== examIds.length) {
      throw new ApiException('not_found', 404);
    }
  }
  if (classIds.length > 0) {
    const known = await transaction
      .selectFrom('classes')
      .select('id')
      .where('id', 'in', classIds)
      .where('branch_id', '=', branchId)
      .execute();
    if (known.length !== classIds.length) {
      throw new ApiException('not_found', 404);
    }
  }
}

@Injectable()
export class TimetableCalendarLessons {
  constructor(
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
    private readonly notifications: Notifications,
  ) {}

  /**
   * The locks of a calendar save, taken before it writes its entry (decision
   * 12 as changed by review correction 1). The save already holds its branch
   * row `for no key update`, which orders the setup writes of the branch and
   * which the key of a row to the branch (an audit entry, a lesson) does not
   * wait for. Then, in the order `lockPublishChain` gives the people and the
   * classes: the people of the branch and the classes of the years touched
   * `for key share`, the keys its lessons take, so that a status change or a
   * class archive holding its row `for update` and waiting in
   * `followTutors` for the year is waited for first; then each year `for no
   * key update`, in the order of its start. A publish, a withdraw, a bulk
   * cancel, a one-day change and `followTutors` take the year `for share`,
   * so they wait for the save or it waits for them, at the year; a draft write
   * takes it `for share` too, and nothing of the save waits on a version
   * (5.5a-3b-1 decision 8). It never takes `PUBLISH_LOCK`, which a publish
   * takes before the branch row.
   */
  async lock(transaction: Transaction, branchId: string, yearIds: readonly string[]) {
    if (yearIds.length === 0) return;
    await transaction
      .selectFrom('staff')
      .select('staff.id')
      .where('staff.id', 'in', (eb) =>
        eb.selectFrom('staff_branches').select('staff_id').where('branch_id', '=', branchId),
      )
      .orderBy('staff.id')
      .forKeyShare()
      .execute();
    await transaction
      .selectFrom('classes')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('academic_year_id', 'in', yearIds)
      .orderBy('id')
      .forKeyShare()
      .execute();
    for (const yearId of yearIds) {
      await transaction
        .selectFrom('academic_years')
        .select('id')
        .where('id', '=', yearId)
        .forNoKeyUpdate()
        .execute();
    }
  }

  /**
   * Writes the lesson dates again from the versions in force (see the file's
   * comment). `preview` answers what refuses the save as lines and does not
   * throw; the preview's transaction is rolled back by its caller.
   */
  async rewrite(
    transaction: Transaction,
    input: {
      readonly branchId: string;
      readonly accountId: string;
      readonly today: string;
      readonly dates: readonly string[];
      readonly event: RewriteEvent;
      readonly preview: boolean;
      /**
       * Task 5.6b-2a: the key of the sorting shown and the choices, of the
       * save; task 5.6b-2b: the shortened days' choices, of the save and the preview.
       */
      readonly days: CalendarDaysBody;
      /** Task 5.6b-3: the entry whose split groups' choices are stored; `null` for an archive. */
      readonly entryId: string | null;
      /** Task 5.6b-4b: a template change's new times of the stored lessons of its dates. */
      readonly retime?: StoredRetime;
    },
  ): Promise<CalendarRewrite> {
    const { branchId, today } = input;
    const dates = [...new Set(input.dates)].sort();
    if (dates.some((date) => date <= today)) {
      // The calendar refuses today and the past first (answer 16); a fault here.
      throw new Error('A calendar rewrite reached today or a past date.');
    }

    // Task 5.6b-2b: a choice is refused by the save (decision 9) and left out
    // by the preview, answered as a line (decision 10). Today is the
    // transaction's, as the database's guard reads it (`pattern_rows_draft`, 0089).
    const keepRefusals: KeepRefusal[] = [];
    const refuseKeep = (keep: DayKeepBody, code: KeepRefusal['code']) => {
      if (!input.preview) throw new ApiException(code, 409);
      keepRefusals.push({ date: keep.date, classId: keep.classId, code });
    };
    const keepToday = await this.timetable.todayIn(transaction, branchId);
    let keeps: DayKeepBody[] = [];
    for (const keep of input.days.dayKeeps ?? []) {
      if (keep.date <= keepToday) refuseKeep(keep, 'day_keep_date_passed');
      else keeps.push(keep);
    }
    const sentGroups = input.entryId === null ? [] : (input.days.groupBlocks ?? []);
    const noLessons = (): CalendarRewrite => {
      // No date written: no choice has a day to decide.
      for (const keep of keeps) refuseKeep(keep, 'day_keep_not_short');
      return {
        lessons: {
          ...NO_LESSONS,
          keepRefusals,
          groupBlocksUnused: groupBlockLines(input.entryId, [], sentGroups).unused,
        },
        audit: null,
      };
    };
    if (dates.length === 0) return noLessons();

    // The published version of each date (decision 10: none, nothing written).
    const years = await transaction
      .selectFrom('academic_years')
      .select([
        'id',
        sql<string>`start_date::text`.as('start_date'),
        sql<string>`end_date::text`.as('end_date'),
      ])
      .where('branch_id', '=', branchId)
      .where('start_date', '<=', dates[dates.length - 1] ?? today)
      .where('end_date', '>=', dates[0] ?? today)
      .orderBy('start_date')
      .execute();
    const runs = (
      await Promise.all(
        years.map(async (year) =>
          runsOf(
            await transaction
              .selectFrom('timetable_versions')
              .select(['id', 'number', sql<string>`starts_on::text`.as('starts_on')])
              .where('branch_id', '=', branchId)
              .where('academic_year_id', '=', year.id)
              .where('status', '=', 'published')
              .orderBy('starts_on')
              .orderBy('number')
              .execute(),
          ).map((one) => ({ ...one, yearEnd: year.end_date })),
        ),
      )
    ).flat();
    const versionOn = (date: string) =>
      runs.find(
        (one) =>
          one.run.from <= date &&
          (one.run.until === null ? date <= one.yearEnd : date < one.run.until),
      )?.id ?? null;
    const byVersion = new Map<string, string[]>();
    for (const date of dates) {
      const id = versionOn(date);
      if (id !== null) byVersion.set(id, [...(byVersion.get(id) ?? []), date]);
    }
    const written = [...byVersion.values()].flat().sort();
    if (written.length === 0) return noLessons();
    const writtenDates = new Set(written);
    keeps = keeps.filter((keep) => {
      if (writtenDates.has(keep.date)) return true;
      refuseKeep(keep, 'day_keep_not_short');
      return false;
    });
    const keepAudit: KeepAudit[] = [];
    const groupAudit: GroupBlockAudit[] = [];

    // Task 5.6b-2c-1: the exams standing on the dates written, locked, and
    // the choices for shared blocks, per block (spec review of the code,
    // must-fix 6): the stored one of an exam, class and pattern block first
    // (decision 5), else the save's, named by the block's first minute.
    const standing = await standingExamsOn(transaction, branchId, written);
    const sentKeyOf = (examId: string, classId: string, start: number) =>
      `${examId.toLowerCase()}|${classId.toLowerCase()}|${String(start)}`;
    const sentChoices = new Map(
      (input.days.examBlocks ?? []).map((one) => [
        sentKeyOf(one.examId, one.classId, one.start),
        one.choice,
      ]),
    );
    const storedChoices = new Map<string, ExamBlockChoice>();
    const storedChoiceOf =
      (examId: string): ExamChoiceOf =>
      (classId, block) => {
        for (const pattern of block.patternBlockIds) {
          const found = storedChoices.get(`${examId}|${classId}|${pattern}`);
          if (found !== undefined) return found;
        }
        return null;
      };
    const choiceOf =
      (examId: string): ExamChoiceOf =>
      (classId, block) =>
        storedChoiceOf(examId)(classId, block) ??
        sentChoices.get(sentKeyOf(examId, classId, block.start)) ??
        null;

    // Each stretch of each version, read as if it started on its first date.
    const bases: StretchBase[] = [];
    for (const [versionId, own] of byVersion) {
      const stored = await this.timetable.versionRow(transaction, versionId);
      for (const part of stretchesOf(own)) {
        const row = { ...stored, starts_on: part.first };
        const rows = await this.timetable.withVersionTutors(
          transaction,
          await this.timetable.contextOf(transaction, row),
          await this.timetable.rowsOf(transaction, versionId),
        );
        // Task 5.6c-3b (From line of 5.6c-3a): the standing exams'
        // invigilators are teachers of the facts, as for a publish, so that
        // an exam whose invigilator teaches no row is checked too.
        const invigilators = await extraTeachersOf(transaction, branchId, part.first, part.last);
        const state = runningUntil(
          await this.pattern.stateOf(transaction, row, input.accountId, rows, invigilators),
          part.last,
        );
        // Task 5.6b-2b: the choices of the stretch stored for its version
        // first, so the check reads them (`readDayKeeps`); one the day cannot
        // take is refused, or left out by the preview with the stored one back.
        const own = keeps.filter((keep) => part.first <= keep.date && keep.date <= part.last);
        const storedKeeps = await this.storeKeeps(transaction, branchId, versionId, own);
        // A published version cannot be edited: a teacher out is "needs a
        // teacher" on each date, never a refusal (as for a withdraw).
        const check = () =>
          datedCheck(transaction, state, part.first, [], {
            outOnStart: false,
          });
        let findings = await check();
        const refusedHere: DayKeepBody[] = [];
        for (const keep of own) {
          const code = keepRefusalOf(keep, findings.dated.shortened);
          if (code === null) continue;
          refuseKeep(keep, code);
          refusedHere.push(keep);
        }
        if (refusedHere.length > 0) {
          await this.storeKeeps(
            transaction,
            branchId,
            versionId,
            refusedHere.map((keep) => ({
              ...keep,
              slotPositions: [...(storedKeeps.get(`${keep.date}|${keep.classId}`) ?? [])],
            })),
          );
          findings = await check();
        }
        for (const keep of own) {
          if (refusedHere.includes(keep)) continue;
          keepAudit.push({
            versionId,
            date: keep.date,
            classId: keep.classId,
            before: storedKeeps.get(`${keep.date}|${keep.classId}`) ?? [],
            after: [...keep.slotPositions].sort((a, b) => a - b),
          });
        }
        // Task 5.6b-3: the entry's choices for its split groups' blocks
        // stored for the dates of the stretch, then the stretch checked again.
        if (input.entryId !== null) {
          const changedGroups = await storeGroupChoices(transaction, {
            branchId,
            entryId: input.entryId,
            dates: part.dates.filter((date) => date > keepToday),
            splits: findings.dated.splitGroups,
            sent: sentGroups,
          });
          if (changedGroups.length > 0) {
            groupAudit.push(...changedGroups);
            findings = await check();
          }
        }
        bases.push({ versionId, part, state, findings });
      }
    }

    // Task 5.6b-2c-2: the sorting of a stretch, run again while a move
    // between two stretches is "needs a decision" in one half that the
    // other kept (a move put back at its old place can take another move's
    // new place). A move put in `decided` stays there (decision 5), so each
    // pass that goes on adds a key and the loop ends.
    const writtenAll = new Set(written);
    const decided = new Map<string, readonly RuleResultAnswer[]>();
    const sortStretch = async ({ versionId, part, state, findings }: StretchBase) => {
      // Task 5.6b-2c-1: the exams of the stretch by the day after the save,
      // with their stored choices, and the lessons they cover on the
      // findings, which the sorting leaves out (should-fix 5).
      const ownExams = standing.filter((exam) => part.first <= exam.date && exam.date <= part.last);
      const examsSorted = sortExams(ownExams, findings, branchId);
      const groupOfRow = (loadRowId: string) =>
        state.rows.find((row) => row.id === loadRowId)?.group_id ?? null;
      for (const one of examsSorted) {
        const lessonsThere = await storedExamLessonsOn(
          transaction,
          branchId,
          one.exam.date,
          findings.begins(one.exam.date),
        );
        for (const [key, choice] of storedChoicesOf(one.exam, one.before, lessonsThere)) {
          storedChoices.set(`${one.exam.id}|${key}`, choice);
        }
      }
      const coveredOf = (on: DatedFindings) => {
        const covered = new Set<string>();
        for (const one of examsSorted) {
          if (one.after === null) continue;
          const found = examLessonsOf(
            one.exam,
            one.after,
            findingsLessonsOn(on, one.exam.date),
            (classId, block) => choiceOf(one.exam.id)(classId, block) ?? 'cancel',
          );
          for (const id of found.covered) covered.add(id);
        }
        return covered;
      };
      // Task 5.6b-2a: the stored one-day changes and bulk cancels of the
      // stretch, sorted as a publish sorts them (decision 2), the bulk
      // cancels on the findings with the kept changes applied.
      const sorting = await sortDayChanges(transaction, {
        state,
        findings,
        firstDate: part.first,
        lastDate: part.last,
        carriedVersionId: null,
        ...(input.retime === undefined ? {} : { retime: input.retime }),
        across: {
          written: (date: string) =>
            writtenAll.has(date) && (date < part.first || part.last < date),
          decided,
        },
        ...(examsSorted.length === 0
          ? {}
          : {
              exams: {
                on: (date: string) => examPlacementsOn(examsSorted, branchId, date),
                covered: coveredOf(findings),
              },
            }),
      });
      // Review correction 1: a sitting group whose own lessons are not one
      // block at the exam's time after the save refuses the exam. Then the
      // recheck of each exam that stands (decision 9) and the shared blocks
      // newly under one (decision 5), on the findings the save writes.
      const examBlockedHere: { examId: string; result: RuleResult }[] = [];
      const examNeeds: ExamNeed[] = [];
      for (const one of examsSorted) {
        if (one.after === null) continue;
        const there = [
          ...findingsLessonsOn(sorting.findings, one.exam.date),
          ...examWeekLessonsOn(sorting.findings, state.blocks, groupOfRow, one.exam.date),
        ];
        const fresh = examLessonsOf(one.exam, one.after, there, storedChoiceOf(one.exam.id));
        if (fresh.groupMisses) {
          one.outcome = 'refused';
          one.code = 'calendar_exam_slots';
          one.after = null;
          continue;
        }
        for (const need of fresh.needs) {
          examNeeds.push({
            examId: one.exam.id,
            date: one.exam.date,
            classId: need.classId,
            start: need.start,
            lessonIds: need.lessons.map((lesson) => lesson.id),
          });
        }
        // The recheck reads the choices sent: a block kept for the other
        // classes stays in it without the class (must-fix 4); one cancelled,
        // or still without a choice (refused below), is left out.
        const chosen = examLessonsOf(one.exam, one.after, there, choiceOf(one.exam.id));
        const skipped = new Set([
          ...chosen.covered,
          ...chosen.needs.flatMap((need) => need.lessons.map((lesson) => lesson.id)),
        ]);
        const others = examPlacementsOn(examsSorted, branchId, one.exam.date).filter(
          (placement) => placement.id !== `exam:${one.exam.id}`,
        );
        for (const result of examBlocked(
          one,
          branchId,
          sorting.findings,
          others,
          skipped,
          chosen.outs,
        )) {
          examBlockedHere.push({ examId: one.exam.id, result });
        }
      }
      // Task 5.7b-3: the stored substitutions of the stretch, sorted on the
      // findings with the kept changes applied; the lessons the exams cover
      // are cancelled by the write.
      const substituted = await sortSubstitutionsKept(transaction, {
        branchId,
        sorting,
        firstDate: part.first,
        lastDate: part.last,
        carriedVersionId: null,
        exams: [],
        examCovered: examsSorted.length === 0 ? new Set() : coveredOf(sorting.findings),
        ...(input.retime === undefined ? {} : { retime: input.retime }),
      });
      const bulk = sortBulkOf({
        lessons: substituted.findings.dated.lessons,
        movedAt: substituted.movedAt,
        begins: substituted.findings.begins,
        records: await bulkRecordsOf(transaction, branchId, part.first, part.last, input.retime),
        carriedVersionId: null,
      });
      return {
        versionId,
        firstDate: part.first,
        lastDate: part.last,
        state,
        findings,
        sorting: substituted,
        bulk,
        key: dayChangesKeyOf(
          versionId,
          part.first,
          substituted.items,
          bulk.length === 0 ? null : bulkKeyPartOf(bulk),
          null,
          substitutionKeyPartOf(substituted.substitutions),
        ),
        exams: examsSorted,
        examBlocked: examBlockedHere,
        examNeeds,
      } satisfies Stretch;
    };
    let stretches: Stretch[] = [];
    for (;;) {
      stretches = [];
      for (const base of bases) stretches.push(await sortStretch(base));
      let grew = false;
      for (const item of stretches.flatMap((one) => one.sorting.items)) {
        if (item.half === null || item.category !== 'decide') continue;
        if (decided.has(item.answer.key)) continue;
        decided.set(item.answer.key, item.answer.blocked);
        grew = true;
      }
      if (!grew) break;
    }
    // Correction 1: the key and the lists from the last pass only.
    const key = calendarDaysKeyOf(stretches);
    const items = stretches.flatMap((one) => one.sorting.items);
    const bulkAll = stretches.flatMap((one) => one.bulk);
    // Task 5.6b-2a: the sorting as shown and a choice for each "needs a
    // decision" item, refused with the blocked dates in one answer
    // (decision 9). The preview takes no decisions (decision 7).
    const { decisions, bulkDecisions } = dayDecisionsOf(
      input.preview ? undefined : input.days.dayDecisions,
    );
    const backs = input.preview
      ? []
      : await this.movesBack(transaction, {
          accountId: input.accountId,
          branchId,
          today,
          written: writtenAll,
          items,
          decisions,
        });
    const examsAll = stretches.flatMap((one) => one.exams);
    const examNeedsAll = stretches.flatMap((one) => one.examNeeds);
    const refusedExams = examsAll.filter((one) => one.outcome === 'refused');
    // Task 5.6b-3: the entry's split blocks, and those with no choice.
    const groupLines = groupBlockLines(
      input.entryId,
      stretches.flatMap((one) => one.findings.dated.splitGroups),
      sentGroups,
    );
    const blocked = [
      ...stretches.flatMap((one) => one.findings.blocked),
      ...backs.flatMap((one) => one.blocked.map(datedAnswerOf)),
      ...stretches.flatMap((one) => one.examBlocked.map((found) => datedAnswerOf(found.result))),
    ];
    if (!input.preview) {
      const details = [
        ...blocked.map(blockedDetail),
        ...dayRefusalsOf(
          {
            key,
            items,
            bulk: bulkAll,
            substitutions: stretches.flatMap((one) => one.sorting.substitutions),
          },
          input.days,
        ).map(detailOf),
        // Task 5.6b-2c-1 (decision 10): an exam refused, and a shared block
        // newly under an exam with no choice (decision 5).
        ...refusedExams.map((one): ErrorDetail => ({
          path: `exams.${one.exam.id}`,
          code: one.code ?? 'calendar_exam_slots',
          message:
            one.code === 'calendar_exam_templates'
              ? 'The classes of an exam are on two day templates after the save.'
              : 'The day after the save has no lesson slot of the exam, or its group no lesson at its time.',
          day: one.exam.date,
        })),
        ...examNeedsAll
          .filter((need) => !sentChoices.has(sentKeyOf(need.examId, need.classId, need.start)))
          .map((need): ErrorDetail => ({
            path: `exams.${need.examId}.${need.classId}.${String(need.start)}`,
            code: 'calendar_exam_block_choice',
            message: 'A shared block newly under an exam needs a choice.',
            day: need.date,
          })),
        // Task 5.6b-3 (decision 4): a split group's block with no choice.
        ...groupLines.missing.map((split): ErrorDetail => ({
          path: `groupBlocks.${String(split.weekday)}.${String(split.start)}.${split.groupIds.join(',')}`,
          code: 'calendar_group_block_choice',
          message: 'A block of a two-grade group left with one grade at school needs a choice.',
          day: split.date,
        })),
      ];
      if (details.length > 0) {
        throw new ApiException('calendar_blocked', 409, undefined, details);
      }
    }

    // The side before, the written dates and the dates a move goes back to
    // locked as the writer locks them.
    const touched = [...new Set([...written, ...backs.map((one) => one.date)])].sort();
    const snapshot = await snapshotDates(transaction, branchId, touched);
    const generated = (from: string, to: string) =>
      storedLessonRows(transaction, {
        branchId,
        firstDate: from,
        lastDate: to,
        classIdsOf: () => undefined,
        cancelled: 'generated',
        lock: false,
      });
    const writtenStretches = stretchesOf(written);
    const cancelledBefore = (
      await Promise.all(writtenStretches.map((one) => generated(one.first, one.last)))
    ).flat();

    // The entries of the lessons named, by pattern entry: their class or group and subject.
    const entryUnits = new Map<string, { unitId: string; subjectId: string }>();
    for (const one of stretches) {
      const rowById = new Map(one.state.rows.map((row) => [row.id, row]));
      for (const block of one.state.blocks) {
        for (const lesson of block.lessons) {
          const row = rowById.get(lesson.loadRowId);
          const unitId = row?.class_id ?? row?.group_id;
          if (row !== undefined && unitId != null) {
            entryUnits.set(lesson.id, { unitId, subjectId: row.subject_id });
          }
        }
      }
    }
    const blockedLines = [
      ...stretches.flatMap((one) =>
        one.findings.blocked.map((result) => ({
          date: result.date ?? '',
          rule: result.rule,
          lessons: result.lessonIds.flatMap((id) => {
            const found = entryUnits.get(patternIdOf(id)?.id ?? id);
            return found === undefined ? [] : [found];
          }),
        })),
      ),
      ...backs.flatMap((one) =>
        one.blocked.map((result) => ({
          date: one.date,
          rule: result.rule,
          lessons: [...one.lessons],
        })),
      ),
    ];
    const needsTeacher = stretches.flatMap((one) =>
      one.findings.needsTeacher.flatMap((need) => {
        const found = entryUnits.get(need.entryId);
        return found === undefined ? [] : [{ date: need.date, reason: need.reason, ...found }];
      }),
    );

    // The write, over the findings with the kept changes applied, as a
    // withdraw writes. A preview with a blocked conflict tries in a
    // savepoint, as the database may refuse it.
    const writes: DatedWrite[] = [];
    const days: StretchDays[] = [];
    const examAudit: ExamAudit[] = [];
    const storedBlocks: StoredBlockTimes[] = [];
    const doWrite = async () => {
      const moment = await transactionMoment(transaction);
      const keptStored = new Set<string>();
      for (const one of stretches) {
        const plan = withMovesBack(
          planOfRun(
            one.sorting,
            one.bulk,
            decisions,
            bulkDecisions,
            input.preview ? undefined : input.days.dayDecisions,
          ),
          backs,
        );
        for (const id of plan.keepStored) keptStored.add(id);
        writes.push(
          await writeDatedLessons(
            transaction,
            one.state,
            one.sorting.findings,
            one.firstDate,
            one.lastDate,
            plan,
            one.exams.length === 0
              ? null
              : examWriteOf({
                  branchId,
                  sorted: one.exams,
                  begins: one.sorting.findings.begins,
                  // The preview takes no choice it was not sent: "cancel" in its place.
                  choiceOf: (examId) => (classId, block) =>
                    choiceOf(examId)(classId, block) ?? (input.preview ? 'cancel' : null),
                  audit: examAudit,
                }),
          ),
        );
      }
      await writeMovesBack(transaction, backs);
      if (input.retime !== undefined) {
        storedBlocks.push(
          ...(await writeStoredTimes(transaction, branchId, [...keptStored], input.retime)),
        );
      }
      if (input.preview) return;
      for (const [index, one] of stretches.entries()) {
        // The changes not applied ended in the name of the stretch's version
        // (decision 5), those kept on a lesson created again recorded again;
        // the bulk cancels' choices on the blocks written. Task 5.6b-2c-2
        // (decision 4): a move between two stretches is settled and audited
        // once, in the stretch of its old place.
        const own = one.sorting.items.filter((item) => item.half !== 'new_place');
        const settled = await settleDayChanges(transaction, {
          branchId,
          versionId: one.versionId,
          moment,
          accountId: input.accountId,
          items: own,
          decisions,
        });
        const recorded = await recordBulkBlocks(transaction, {
          branchId,
          versionId: one.versionId,
          begins: one.sorting.findings.begins,
          items: one.bulk,
          decisions: bulkDecisions,
        });
        // Task 5.7b-3: the kept substitutions recorded again on lessons created again.
        const written = writes[index];
        if (written === undefined) throw new Error('Every stretch is written.');
        const substitutionsSettled = await settleSubstitutions(transaction, {
          branchId,
          items: one.sorting.substitutions,
          sent: input.days.dayDecisions,
          placed: written.substitutesPlaced,
          moment,
          accountId: input.accountId,
        });
        if (own.length > 0 || one.bulk.length > 0 || one.sorting.substitutions.length > 0) {
          days.push({
            versionId: one.versionId,
            firstDate: one.firstDate,
            ...dayAuditOf(
              own,
              decisions,
              settled,
              bulkAuditOf(one.bulk, recorded),
              substitutionAuditOf(
                one.sorting.substitutions,
                input.days.dayDecisions,
                substitutionsSettled,
              ),
            ),
          });
        }
      }
    };
    let wrote = true;
    // Task 6.1b-1 (decision 3, review correction 2): the lessons with data a
    // write would have to move, which the preview answers as lines.
    let heldIds: string[] = [];
    if (!input.preview) {
      await doWrite();
    } else if (refusedExams.length > 0) {
      // Task 5.6b-2c-1 (must-fix 4): a refused exam keeps its claims, which
      // the rewrite would meet; the preview writes nothing.
      wrote = false;
    } else {
      await sql`savepoint calendar_rewrite`.execute(transaction);
      try {
        await doWrite();
        await sql`set constraints all immediate`.execute(transaction);
        await sql`release savepoint calendar_rewrite`.execute(transaction);
      } catch (error) {
        const held =
          error instanceof ApiException && error.code === 'lessons_hold_data'
            ? (error.details ?? []).flatMap((one) =>
                one.recordId === undefined ? [] : [one.recordId],
              )
            : null;
        if (blocked.length === 0 && held === null) throw error;
        await sql`rollback to savepoint calendar_rewrite`.execute(transaction);
        wrote = false;
        heldIds = held ?? [];
      }
    }

    const dayChanges: CalendarLessons['dayChanges'] = {
      key,
      kept: uniqueItems(items.filter((one) => one.category === 'kept')),
      decide: uniqueItems(items.filter((one) => one.category === 'decide')),
      dropped: uniqueItems(items.filter((one) => one.category === 'dropped')),
      bulk: bulkAll.map((one) => one.answer),
      // The calendar's exams are its own list (`exams` below), not items of the sorting.
      exams: [],
      // Task 5.7a-1 (decision 7): the absences are listed by a publish and a
      // withdraw; a calendar save leaves them as they are and lists none.
      absences: [],
      // Task 5.7a-2b (decision 9): the room closures likewise.
      closures: [],
      // Task 5.7b-3: the stored substitutions of the dates, once each.
      substitutions: stretches.flatMap((one) =>
        one.sorting.substitutions.map((item) => item.answer),
      ),
    };
    const named = dayChangeIdsOf(
      items,
      bulkAll,
      [],
      stretches.flatMap((one) => one.sorting.substitutions),
    );
    // Task 5.6b-2b: the dates written that are shortened for a class.
    const shortenedDays: CalendarLessons['shortenedDays'] = stretches
      .flatMap((one) => one.findings.dated.shortened)
      .map((one) => ({
        date: one.date,
        classId: one.classId,
        lessonSlots: one.lessonSlots,
        lessons: one.lessons.map((lesson) => ({
          slotPosition: lesson.slotPosition,
          entryIds: [...lesson.entryIds],
          subjects: lesson.entryIds.flatMap((id) => {
            const found = entryUnits.get(id);
            return found === undefined ? [] : [found];
          }),
        })),
        kept: [...one.kept],
        chosen: one.chosen,
        missingPositions: [...one.missingPositions],
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.classId.localeCompare(b.classId));
    // Task 5.6b-2c-1: each exam as the save leaves it, with the rules its
    // recheck meets and the shared blocks newly under it.
    const unitOfDated = (id: string) => entryUnits.get(patternIdOf(id)?.id ?? id);
    const examLines: CalendarLessons['exams'] = examsAll.map((one) => ({
      id: one.exam.id,
      title: one.exam.title,
      date: one.exam.date,
      outcome: calendarOutcomeOf(one.outcome),
      before: { start: one.before.start, end: one.before.end },
      after: one.after === null ? null : { start: one.after.start, end: one.after.end },
      code: one.code,
      blockedRules: [
        ...new Set(
          stretches.flatMap((stretch) =>
            stretch.examBlocked
              .filter((found) => found.examId === one.exam.id)
              .map((found) => found.result.rule),
          ),
        ),
      ].sort(),
      blocks: examNeedsAll
        .filter((need) => need.examId === one.exam.id)
        .map((need) => ({
          classId: need.classId,
          start: need.start,
          lessons: need.lessonIds.flatMap((id) => {
            const found = unitOfDated(id);
            return found === undefined ? [] : [found];
          }),
          choice: sentChoices.get(sentKeyOf(need.examId, need.classId, need.start)) ?? null,
        })),
    }));
    let lessons: CalendarLessons = {
      ...NO_LESSONS,
      needsTeacher,
      blocked: blockedLines,
      dayChanges,
      shortenedDays,
      keepRefusals,
      exams: examLines,
      groupBlocks: groupLines.lines,
      groupBlocksUnused: groupLines.unused,
    };
    let notices: WeekNotices = { notified: 0, marked: 0 };
    let shown: StoredLesson[] = [];
    let removed: StoredLesson[] = [];
    let created: StoredLesson[] = [];
    let cancelled: StoredLesson[] = [];
    let teacherIds: string[] = [];
    // Task 6.1b-1 (decisions 2, 5 and 6): what the write kept with data or gave back.
    const keptWritten = writes.flatMap((one) => one.keptWithData);
    const backWritten = writes.flatMap((one) => one.givenBack);
    const places = await heldDataLinesOf(transaction, branchId, [
      ...(wrote ? [...keptWritten, ...backWritten].map((one) => one.id) : []),
      ...heldIds,
    ]);
    const placed = (id: string) => {
      const found = places.get(id);
      return found === undefined ? [] : [found];
    };
    const keptLines = wrote
      ? keptWritten.flatMap((one) =>
          placed(one.id).map((place) => ({ ...place, cancelCause: one.cancelCause, cause: one.cause })),
        )
      : [];
    const backLines = wrote
      ? backWritten.flatMap((one) =>
          placed(one.id).map((place) => ({ ...place, cancelCause: one.cancelCause })),
        )
      : [];
    const heldLines = heldIds.flatMap(placed);
    if (wrote) {
      const after = await readDates(transaction, branchId, touched);
      const changes = weekChanges(snapshot.before, after, snapshot.unwritten);
      const cancelledAfter = (
        await Promise.all(writtenStretches.map((one) => generated(one.first, one.last)))
      ).flat();
      removed = snapshot.before.filter((one) => changes.beforeDiffers.has(one.id));
      created = after.filter((one) => changes.afterDiffers.has(one.id));
      cancelled = unpaired(cancelledBefore, cancelledAfter);
      shown = [...removed, ...created, ...cancelled];
      teacherIds = [...changes.teachers.keys()];
    }
    const { names, staff } = await namesOf(
      transaction,
      {
        unitIds: [
          ...shown.map((one) => one.lesson.unitId),
          ...[...keptLines, ...backLines, ...heldLines].map((one) => one.unitId),
          ...needsTeacher.map((one) => one.unitId),
          ...blockedLines.flatMap((one) => one.lessons.map((lesson) => lesson.unitId)),
          ...shortenedDays.flatMap((one) =>
            one.lessons.flatMap((lesson) => lesson.subjects.map((s) => s.unitId)),
          ),
          ...named.unitIds,
          ...examLines.flatMap((one) =>
            one.blocks.flatMap((block) => block.lessons.map((lesson) => lesson.unitId)),
          ),
          ...groupLines.lines.flatMap((one) => one.groupIds),
        ],
        subjectIds: [
          ...shown.map((one) => one.lesson.subjectId),
          ...[...keptLines, ...backLines, ...heldLines].map((one) => one.subjectId),
          ...needsTeacher.map((one) => one.subjectId),
          ...blockedLines.flatMap((one) => one.lessons.map((lesson) => lesson.subjectId)),
          ...shortenedDays.flatMap((one) =>
            one.lessons.flatMap((lesson) => lesson.subjects.map((s) => s.subjectId)),
          ),
          ...named.subjectIds,
          ...examLines.flatMap((one) =>
            one.blocks.flatMap((block) => block.lessons.map((lesson) => lesson.subjectId)),
          ),
        ],
        teacherIds: [
          ...shown.flatMap((one) => one.lesson.teacherIds),
          ...teacherIds,
          ...named.teacherIds,
        ],
        roomIds: [
          ...shown.flatMap((one) => (one.lesson.roomId === null ? [] : [one.lesson.roomId])),
          ...named.roomIds,
        ],
      },
      new Map(),
    );
    lessons = {
      ...lessons,
      names,
      keptWithData: keptLines.sort(byPlace),
      givenBack: backLines.sort(byPlace),
      heldData: heldLines.sort(byPlace),
    };
    if (wrote) {
      const withAccount = new Set(
        staff
          .filter((one) => one.kind !== 'vacancy' && one.account_id !== null)
          .map((one) => one.id),
      );
      lessons = {
        ...lessons,
        removed: removed.map(lineOf).sort(byPlace),
        created: created.map(lineOf).sort(byPlace),
        cancelled: cancelled
          .flatMap((one) => {
            const cause = CALENDAR_CANCEL_CAUSES.find((known) => known === one.cancelCause);
            // Every generated cause is listed (`GENERATED_CAUSES`); one not
            // listed is a fault of the code, never a line with a cause unknown.
            if (cause === undefined) throw new Error(`Unknown cause ${String(one.cancelCause)}.`);
            return [{ ...lineOf(one), cause }];
          })
          .sort(byPlace),
        notified: teacherIds.filter((id) => withAccount.has(id)).sort(),
      };
      const { event } = input;
      // Task 5.6c-3b (decision 3): the invigilators of the exams moved or
      // cancelled for a day off, told in the event's own notice.
      const examsChanged = input.preview
        ? new Map<string, never[]>()
        : await examsChangedOf(transaction, examsAll);
      if ('quarterDates' in event) {
        // A quarter change gives no day off; an exam on a date it takes out
        // of every quarter refuses it first (decision 5).
        notices = await sendWeekChanges(transaction, this.notifications, snapshot, {
          kind: 'timetable.quarters_changed',
          firstDate: event.quarterDates.firstDate,
          lastDate: event.quarterDates.lastDate,
        });
      } else if ('templateFrom' in event) {
        // A template change gives no day off, so it cancels no exam "day off".
        notices = await sendWeekChanges(transaction, this.notifications, snapshot, {
          kind: 'timetable.template_changed',
          from: event.templateFrom,
          examsChanged,
        });
      } else {
        if (!input.preview) {
          await this.tellExamsCancelled(
            transaction,
            branchId,
            event,
            examsAll.filter((one) => one.outcome === 'cancelled_day_off'),
          );
        }
        notices = await sendWeekChanges(transaction, this.notifications, snapshot, {
          kind: 'timetable.calendar_changed',
          name: event.name,
          firstDate: event.firstDate,
          lastDate: event.lastDate,
          examsChanged,
        });
      }
    }
    return {
      lessons,
      audit: {
        dates: written,
        datedLessons: writes.map(datedAuditOf),
        notices,
        dayChanges: days,
        movedBack: backs.map((one) => one.key).sort(),
        dayKeeps: keepAudit,
        exams: examAudit,
        groupBlocks: groupAudit,
        storedBlocks,
      },
    };
  }

  /**
   * Task 5.6b-2c-1 (decision 4): each exam a day off cancelled told to every
   * Academic Vice Principal of the branch, in force at the moment of the
   * save; `assignments` has no row filter, so the branch is named here
   * (`.claude/rules/database.md`).
   */
  private async tellExamsCancelled(
    transaction: Transaction,
    branchId: string,
    event: CalendarEvent,
    cancelled: readonly SortedExam[],
  ): Promise<void> {
    if (cancelled.length === 0) return;
    const moment = await transactionMoment(transaction);
    const vices = await transaction
      .selectFrom('assignments')
      .select('account_id')
      .distinct()
      .where('role', '=', 'academic_vice_principal')
      .where('branch_id', '=', branchId)
      .where('valid_from', '<=', moment)
      .where((eb) => eb.or([eb('valid_until', 'is', null), eb('valid_until', '>', moment)]))
      .orderBy('account_id')
      .execute();
    if (vices.length === 0) return;
    for (const one of cancelled) {
      await this.notifications.send(transaction, {
        kind: 'timetable.exam_day_off',
        data: { name: event.name, title: one.exam.title, date: one.exam.date },
        branchId,
        accountIds: vices.map((vice) => vice.account_id),
      });
    }
  }

  /**
   * Task 5.6b-2b: the choices given stored for a version, each replacing the
   * stored one of its date and class (an empty list removes it), as the
   * draft's choice is stored (`setDayKeep`). Answers the positions stored
   * before, by date and class.
   */
  private async storeKeeps(
    transaction: Transaction,
    branchId: string,
    versionId: string,
    keeps: readonly DayKeepBody[],
  ): Promise<Map<string, number[]>> {
    const before = new Map<string, number[]>();
    for (const keep of keeps) {
      const rows = await transaction
        .deleteFrom('timetable_day_keeps')
        .where('version_id', '=', versionId)
        .where('class_id', '=', keep.classId)
        .where('kept_on', '=', keep.date)
        .returning('slot_position')
        .execute();
      before.set(
        `${keep.date}|${keep.classId}`,
        rows.map((row) => row.slot_position).sort((a, b) => a - b),
      );
      if (keep.slotPositions.length > 0) {
        await transaction
          .insertInto('timetable_day_keeps')
          .values(
            keep.slotPositions.map((slotPosition) => ({
              branch_id: branchId,
              version_id: versionId,
              class_id: keep.classId,
              kept_on: keep.date,
              slot_position: slotPosition,
            })),
          )
          .execute();
      }
    }
    return before;
  }

  /**
   * Task 5.6b-2a (review correction 1): the "needs a decision" moves onto a
   * written date from a date after today the save does not write. Their
   * choice puts the stored block back at its old place on that date, the
   * lesson the version has there: "drop the change" held, checked there with
   * the full rule set (`storedDayCheck`, a blocked result refuses the save
   * `calendar_blocked` by date); "cancel the lesson that day" cancelled with
   * the change's reason, which takes no check. An old place on a date with no
   * place for the lesson (a day off, an exam week) removes the block with
   * either choice. A move from today or earlier follows 5.6a-5a decision 7
   * (the write removes the block, or keeps it cancelled where it is), and is
   * removed with either choice onto a date with no place for it.
   */
  private async movesBack(
    transaction: Transaction,
    input: {
      readonly accountId: string;
      readonly branchId: string;
      readonly today: string;
      readonly written: ReadonlySet<string>;
      readonly items: readonly SortedDayChange[];
      readonly decisions: ReadonlyMap<string, DayChangeChoice>;
    },
  ): Promise<MoveBack[]> {
    const backs: MoveBack[] = [];
    for (const item of input.items) {
      if (item.category !== 'decide' || item.storedIds.length === 0) continue;
      const choice = input.decisions.get(item.answer.key);
      const date = item.answer.from.date;
      if (choice === undefined || choice === 'keep') continue;
      if (input.written.has(date)) continue;
      // A move from today or earlier stays under 5.6a-5a decision 7, except
      // onto a date that now has no place for it: removed whatever the choice
      // (spec review of the code, must-fix 2).
      const noPlace = item.answer.blocked.some((one) => NO_PLACE_RULES.has(one.rule));
      if (date <= input.today && !noPlace) continue;
      const chains = new Map(item.chains.map((chain) => [chain.lessonId, chain]));
      const there = (
        await storedLessonsOn(transaction, input.branchId, item.answer.to.date)
      ).filter((one) => chains.has(one.id));
      const placed = there.map((one): StoredDayLesson => {
        const chain = chains.get(one.id);
        if (chain === undefined) throw new Error('A part of the move has no chain.');
        return {
          ...one,
          date,
          startsAt: chain.first.from_starts_at,
          endsAt: chain.first.from_ends_at,
          roomId: chain.first.from_room_id,
        };
      });
      const held = placed.filter((one) => one.cancelCause === null);
      let blocked: readonly RuleResult[] = [];
      let teacherIds: ReadonlyMap<string, string | null> = new Map();
      let outcome: MoveBack['choice'] = date <= input.today ? 'remove' : choice;
      if (outcome !== 'remove' && held.length > 0) {
        const checked = await storedDayCheck(
          transaction,
          { timetable: this.timetable, pattern: this.pattern },
          {
            accountId: input.accountId,
            lessons: held,
            alongside: placed.filter((one) => one.cancelCause !== null),
          },
        );
        // Spec review of the code, must-fix 2: an old place on a date with no
        // lessons there (a day off of an earlier save, an exam week) holds no
        // lesson, not even a cancelled one ("The lessons of that date are
        // removed"): the block is removed whatever the choice, as for a move
        // from before the start (5.6a-5a decision 7). Otherwise "drop" is
        // checked with every rule; "cancel" claims nothing and needs no check.
        if (checked.blocked.some((one) => NO_PLACE_RULES.has(one.rule))) {
          outcome = 'remove';
        } else if (choice === 'drop') {
          blocked = checked.blocked;
          teacherIds = checked.teacherIds;
        }
      }
      backs.push({
        key: item.answer.key,
        date,
        choice: outcome,
        reason: item.answer.reason,
        lessons: placed.map((one) => ({
          unitId: one.classId ?? one.groupId ?? '',
          subjectId: one.subjectId,
        })),
        placed,
        blocked,
        teacherIds,
      });
    }
    return backs;
  }
}

/** A result of a date as a dated check names it (task 5.6b-2a: a move put back). */
const datedAnswerOf = (result: RuleResult): RuleResultAnswer => ({
  rule: result.rule,
  severity: result.severity,
  weekday: weekdaySchema.parse(weekdayOf(result.day)),
  lessonIds: [...result.lessonIds],
  ...(result.detail === undefined || Object.keys(result.detail).length === 0
    ? {}
    : { detail: { ...result.detail } }),
  date: result.day,
});

/** The rules of a day that has no place for the lesson at all (`movesBack`). */
const NO_PLACE_RULES: ReadonlySet<string> = new Set([
  'outside_year',
  'vacation',
  'day_off',
  'not_working_day',
  'no_template',
  'exam_week',
  'not_a_slot',
  'break_slot',
  'two_grade_slot',
]);

/** A stored move put back at its old place by a calendar save (task 5.6b-2a, review correction 1). */
interface MoveBack {
  readonly key: string;
  /** The date it goes back to. */
  readonly date: string;
  /** `remove`: its old place has no place for it, and the block is removed. */
  readonly choice: 'drop' | 'cancel' | 'remove';
  readonly reason: string;
  readonly lessons: readonly { unitId: string; subjectId: string }[];
  /** Every part of its blocks at the old place. */
  readonly placed: readonly StoredDayLesson[];
  readonly blocked: readonly RuleResult[];
  /** The teacher each held part is written with (a Tutor lesson's Tutor at its start). */
  readonly teacherIds: ReadonlyMap<string, string | null>;
}

/** The write plan with the stored blocks of the moves put back left where they are until `writeMovesBack`. */
function withMovesBack(plan: DayWritePlan, backs: readonly MoveBack[]): DayWritePlan {
  if (backs.length === 0) return plan;
  const keepStored = new Set(plan.keepStored);
  const cancelStored = new Map(plan.cancelStored);
  for (const back of backs) {
    for (const one of back.placed) {
      if (back.choice === 'remove') keepStored.delete(one.id);
      else keepStored.add(one.id);
      cancelStored.delete(one.id);
    }
  }
  return { ...plan, keepStored, cancelStored };
}

/**
 * Task 5.6b-4b: a stored block the write keeps where it is (a move from a
 * date the template change does not write) takes the new times of its lesson
 * number on the date it stands on, at which the sorting checked it.
 */
async function writeStoredTimes(
  transaction: Transaction,
  branchId: string,
  lessonIds: readonly string[],
  retime: StoredRetime,
): Promise<StoredBlockTimes[]> {
  if (lessonIds.length === 0) return [];
  const rows = await transaction
    .selectFrom('lessons')
    .select([
      'block_id',
      sql<string>`lesson_date::text`.as('lesson_date'),
      'class_id',
      'group_id',
      'starts_at',
      'ends_at',
    ])
    .where('branch_id', '=', branchId)
    .where('id', 'in', lessonIds)
    .orderBy('block_id')
    .execute();
  type Row = (typeof rows)[number];
  const moved = new Map<string, { before: Row; after: { starts_at: Date; ends_at: Date } }>();
  for (const row of rows) {
    const times = retimed(row, retime);
    if (times !== row && !moved.has(row.block_id)) {
      moved.set(row.block_id, { before: row, after: times });
    }
  }
  if (moved.size === 0) return [];
  // Two kept blocks may pass each other: the exclusions are checked on the end state.
  await sql`set constraints time_claims_teacher_excl, time_claims_room_excl, time_claims_class_excl deferred`.execute(
    transaction,
  );
  const audit: StoredBlockTimes[] = [];
  for (const [blockId, { before, after }] of moved) {
    await transaction
      .updateTable('lesson_blocks')
      .set({ starts_at: after.starts_at, ends_at: after.ends_at })
      .where('id', '=', blockId)
      .execute();
    audit.push({
      blockId,
      date: before.lesson_date,
      before: { startsAt: before.starts_at.toISOString(), endsAt: before.ends_at.toISOString() },
      after: { startsAt: after.starts_at.toISOString(), endsAt: after.ends_at.toISOString() },
    });
  }
  return audit;
}

/** Puts each stored block back at its old place (see `movesBack`). */
async function writeMovesBack(transaction: Transaction, backs: readonly MoveBack[]): Promise<void> {
  if (backs.length === 0) return;
  // A block put back may meet the other half of its double on the way: the
  // exclusions are checked on the end state, as a one-day move does.
  await sql`set constraints time_claims_teacher_excl, time_claims_room_excl, time_claims_class_excl deferred`.execute(
    transaction,
  );
  for (const back of backs) {
    if (back.choice === 'remove') continue;
    const blocks = new Map<string, StoredDayLesson>();
    for (const one of back.placed) if (!blocks.has(one.blockId)) blocks.set(one.blockId, one);
    for (const [blockId, one] of blocks) {
      await transaction
        .updateTable('lesson_blocks')
        .set({ lesson_date: one.date, starts_at: one.startsAt, ends_at: one.endsAt })
        .where('id', '=', blockId)
        .execute();
    }
    for (const one of back.placed) {
      if (one.cancelCause !== null) continue;
      await transaction
        .updateTable('lessons')
        .set(
          back.choice === 'drop'
            ? { teacher_id: back.teacherIds.get(one.id) ?? one.teacherId, room_id: one.roomId }
            : { room_id: one.roomId, cancel_cause: 'reason', cancel_reason: back.reason },
        )
        .where('id', '=', one.id)
        .execute();
    }
  }
  // Spec review of the code, should-fix 5: the clash shows at the write, as
  // the one-day move checks it.
  await sql`set constraints all immediate`.execute(transaction);
}

/** One stretch's outcome of the stored changes for the audit entry (decision 10). */
type StretchDays = DayAudit & { versionId: string; firstDate: string };

/** Each item once, by key: a move between two stretches is listed by both. */
function uniqueItems(items: readonly SortedDayChange[]) {
  const seen = new Set<string>();
  return items.flatMap((one) => {
    if (seen.has(one.answer.key)) return [];
    seen.add(one.answer.key);
    return [one.answer];
  });
}

/** The key of a save's sorting: the keys of its stretches in date order (decision 6). */
function calendarDaysKeyOf(
  stretches: readonly { versionId: string; firstDate: string; key: string }[],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        [...stretches]
          .sort((a, b) => a.firstDate.localeCompare(b.firstDate))
          .map((one) => [one.versionId, one.firstDate, one.key]),
      ),
    )
    .digest('hex');
}

/**
 * Why a choice cannot be taken on its date (task 5.6b-2b, decision 2; the
 * draft's refusals, 5.5a-2b-2 decision 6), or `null`: the date is not
 * shortened for the class, a position is not a lesson of the class, or more
 * lessons than the day's lesson slots. An empty list removes the stored
 * choice on any date written (review correction 1).
 */
function keepRefusalOf(
  keep: DayKeepBody,
  shortened: DatedFindings['dated']['shortened'],
): KeepRefusal['code'] | null {
  if (keep.slotPositions.length === 0) return null;
  const day = shortened.find((one) => one.date === keep.date && one.classId === keep.classId);
  if (day === undefined) return 'day_keep_not_short';
  if (
    keep.slotPositions.some((one) => !day.lessons.some((lesson) => lesson.slotPosition === one))
  ) {
    return 'day_keep_lessons';
  }
  if (keep.slotPositions.length > day.lessonSlots) return 'day_keep_over_slots';
  return null;
}

/** A calendar save never drops an exam: that is a publish's or a withdraw's choice (task 5.6c-3a). */
function calendarOutcomeOf(outcome: ExamOutcome): Exclude<ExamOutcome, 'dropped'> {
  if (outcome === 'dropped') throw new Error('A calendar save drops no exam.');
  return outcome;
}
