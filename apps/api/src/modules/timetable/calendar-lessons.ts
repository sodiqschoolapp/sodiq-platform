import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  CALENDAR_CANCEL_CAUSES,
  type CalendarLesson,
  type CalendarLessons,
  type DayChangeChoice,
  type DayDecisionsBody,
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
import { runningUntil } from './chain.js';
import { datedCheck, type DatedFindings } from './dated-check.js';
import { writeDatedLessons, type DatedWrite } from './dated-lessons.js';
import {
  dayChangesKeyOf,
  settleDayChanges,
  sortDayChanges,
  type DaySorting,
  type DayWritePlan,
  type SortedDayChange,
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
  type DayAudit,
} from './publish.service.js';
import { storedDayCheck, storedLessonsOn, type StoredDayLesson } from './stored-day.js';
import { storedLessonRows, type StoredLesson } from './stored-lessons.js';
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
 * over the findings with the kept changes applied. A stored exam on a date
 * written, or a move between two stretches, still refuses the save (5.6b-1
 * decision 7; 5.6b-2a decision 3) until 5.6b-2c.
 */

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
  } | null;
}

/** The entry named in the notices. */
export interface CalendarEvent {
  readonly name: string;
  readonly firstDate: string;
  readonly lastDate: string;
}

const EMPTY_NAMES: CalendarLessons['names'] = { units: [], subjects: [], teachers: [], rooms: [] };

export const NO_LESSONS: CalendarLessons = {
  removed: [],
  created: [],
  cancelled: [],
  needsTeacher: [],
  notified: [],
  blocked: [],
  stored: [],
  dayChanges: { key: calendarDaysKeyOf([]), kept: [], decide: [], dropped: [], bulk: [] },
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
      readonly event: CalendarEvent;
      readonly preview: boolean;
      /** Task 5.6b-2a: the key of the sorting shown and the choices, of the save. */
      readonly days: DayDecisionsBody;
    },
  ): Promise<CalendarRewrite> {
    const { branchId, today } = input;
    const dates = [...new Set(input.dates)].sort();
    if (dates.some((date) => date <= today)) {
      // The calendar refuses today and the past first (answer 16); a fault here.
      throw new Error('A calendar rewrite reached today or a past date.');
    }
    if (dates.length === 0) return { lessons: NO_LESSONS, audit: null };

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
    if (written.length === 0) return { lessons: NO_LESSONS, audit: null };

    // Each stretch of each version, read as if it started on its first date.
    const stretches: Stretch[] = [];
    for (const [versionId, own] of byVersion) {
      const stored = await this.timetable.versionRow(transaction, versionId);
      for (const part of stretchesOf(own)) {
        const row = { ...stored, starts_on: part.first };
        const rows = await this.timetable.withVersionTutors(
          transaction,
          await this.timetable.contextOf(transaction, row),
          await this.timetable.rowsOf(transaction, versionId),
        );
        const state = runningUntil(
          await this.pattern.stateOf(transaction, row, input.accountId, rows),
          part.last,
        );
        // A published version cannot be edited: a teacher out is "needs a
        // teacher" on each date, never a refusal (as for a withdraw).
        const findings = await datedCheck(transaction, state, part.first, [], {
          outOnStart: false,
        });
        // Task 5.6b-2a: the stored one-day changes and bulk cancels of the
        // stretch, sorted as a publish sorts them (decision 2), the bulk
        // cancels on the findings with the kept changes applied.
        const sorting = await sortDayChanges(transaction, {
          state,
          findings,
          firstDate: part.first,
          lastDate: part.last,
          carriedVersionId: null,
        });
        const bulk = sortBulkOf({
          lessons: sorting.findings.dated.lessons,
          movedAt: sorting.movedAt,
          begins: sorting.findings.begins,
          records: await bulkRecordsOf(transaction, branchId, part.first, part.last),
          carriedVersionId: null,
        });
        stretches.push({
          versionId,
          firstDate: part.first,
          lastDate: part.last,
          state,
          findings,
          sorting,
          bulk,
          key: dayChangesKeyOf(
            versionId,
            part.first,
            sorting.items,
            bulk.length === 0 ? null : bulkKeyPartOf(bulk),
          ),
        });
      }
    }
    const key = calendarDaysKeyOf(stretches);
    const items = stretches.flatMap((one) => one.sorting.items);
    const bulkAll = stretches.flatMap((one) => one.bulk);

    // What refuses the save as stored records (decision 7 of 5.6b-1): a move
    // between two stretches (5.6b-2a decision 3) and an exam (until 5.6b-2c).
    const stored: CalendarLessons['stored'] = [];
    const stretchOf = (date: string) =>
      stretches.findIndex((one) => one.firstDate <= date && date <= one.lastDate);
    for (const item of items) {
      if (item.answer.kind !== 'move') continue;
      const from = stretchOf(item.answer.from.date);
      const to = stretchOf(item.answer.to.date);
      if (from < 0 || to < 0 || from === to) continue;
      if (stored.some((one) => one.id === item.answer.key)) continue;
      stored.push({ kind: 'day_change', id: item.answer.key, date: item.answer.to.date });
    }
    const exams = await transaction
      .selectFrom('exams')
      .select(['id', sql<string>`exam_date::text`.as('exam_date')])
      .where('branch_id', '=', branchId)
      // Only the dates written (code review should-fix 3; decision 10).
      .where('exam_date', 'in', written)
      .where('cancel_cause', 'is', null)
      .orderBy('exam_date')
      .orderBy('id')
      .execute();
    for (const exam of exams) stored.push({ kind: 'exam', id: exam.id, date: exam.exam_date });
    if (!input.preview && stored.length > 0) {
      throw new ApiException(
        'calendar_stored_changes',
        409,
        undefined,
        stored.map((one) => ({
          path: `stored.${one.kind}.${one.id}`,
          code: 'calendar_stored_changes',
          message: 'A stored record on a date the calendar save changes.',
          day: one.date,
        })),
      );
    }

    // Task 5.6b-2a: the sorting as shown and a choice for each "needs a
    // decision" item, refused with the blocked dates in one answer
    // (decision 9). The preview takes no decisions (decision 7).
    const writtenSet = new Set(written);
    const { decisions, bulkDecisions } = dayDecisionsOf(
      input.preview ? undefined : input.days.dayDecisions,
    );
    const backs = input.preview
      ? []
      : await this.movesBack(transaction, {
          accountId: input.accountId,
          branchId,
          today,
          written: writtenSet,
          items,
          decisions,
        });
    const blocked = [
      ...stretches.flatMap((one) => one.findings.blocked),
      ...backs.flatMap((one) => one.blocked.map(datedAnswerOf)),
    ];
    if (!input.preview) {
      const details = [
        ...blocked.map(blockedDetail),
        ...dayRefusalsOf({ key, items, bulk: bulkAll }, input.days).map(detailOf),
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
    // withdraw writes. A preview with a stored record writes nothing (it
    // would be lost); one with a blocked conflict tries in a savepoint, as
    // the database may refuse it.
    const writes: DatedWrite[] = [];
    const days: StretchDays[] = [];
    const doWrite = async () => {
      const moment = await transactionMoment(transaction);
      for (const one of stretches) {
        const plan = withMovesBack(
          planOfRun(one.sorting, one.bulk, decisions, bulkDecisions),
          backs,
        );
        writes.push(
          await writeDatedLessons(
            transaction,
            one.state,
            one.sorting.findings,
            one.firstDate,
            one.lastDate,
            plan,
          ),
        );
      }
      await writeMovesBack(transaction, backs);
      if (input.preview) return;
      for (const one of stretches) {
        // The changes not applied ended in the name of the stretch's version
        // (decision 5), those kept on a lesson created again recorded again;
        // the bulk cancels' choices on the blocks written.
        const settled = await settleDayChanges(transaction, {
          branchId,
          versionId: one.versionId,
          moment,
          accountId: input.accountId,
          items: one.sorting.items,
          decisions,
        });
        const recorded = await recordBulkBlocks(transaction, {
          branchId,
          versionId: one.versionId,
          begins: one.sorting.findings.begins,
          items: one.bulk,
          decisions: bulkDecisions,
        });
        if (one.sorting.items.length > 0 || one.bulk.length > 0) {
          days.push({
            versionId: one.versionId,
            firstDate: one.firstDate,
            ...dayAuditOf(one.sorting.items, decisions, settled, bulkAuditOf(one.bulk, recorded)),
          });
        }
      }
    };
    let wrote = true;
    if (!input.preview) {
      await doWrite();
    } else if (stored.length > 0) {
      wrote = false;
    } else {
      await sql`savepoint calendar_rewrite`.execute(transaction);
      try {
        await doWrite();
        await sql`set constraints all immediate`.execute(transaction);
        await sql`release savepoint calendar_rewrite`.execute(transaction);
      } catch (error) {
        if (blocked.length === 0) throw error;
        await sql`rollback to savepoint calendar_rewrite`.execute(transaction);
        wrote = false;
      }
    }

    const dayChanges: CalendarLessons['dayChanges'] = {
      key,
      kept: uniqueItems(items.filter((one) => one.category === 'kept')),
      decide: uniqueItems(items.filter((one) => one.category === 'decide')),
      dropped: uniqueItems(items.filter((one) => one.category === 'dropped')),
      bulk: bulkAll.map((one) => one.answer),
    };
    const named = dayChangeIdsOf(items, bulkAll);
    let lessons: CalendarLessons = {
      ...NO_LESSONS,
      needsTeacher,
      blocked: blockedLines,
      stored,
      dayChanges,
    };
    let notices: WeekNotices = { notified: 0, marked: 0 };
    let shown: StoredLesson[] = [];
    let removed: StoredLesson[] = [];
    let created: StoredLesson[] = [];
    let cancelled: StoredLesson[] = [];
    let teacherIds: string[] = [];
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
          ...needsTeacher.map((one) => one.unitId),
          ...blockedLines.flatMap((one) => one.lessons.map((lesson) => lesson.unitId)),
          ...named.unitIds,
        ],
        subjectIds: [
          ...shown.map((one) => one.lesson.subjectId),
          ...needsTeacher.map((one) => one.subjectId),
          ...blockedLines.flatMap((one) => one.lessons.map((lesson) => lesson.subjectId)),
          ...named.subjectIds,
        ],
        teacherIds: [...shown.flatMap((one) => one.lesson.teacherIds), ...teacherIds],
        roomIds: [
          ...shown.flatMap((one) => (one.lesson.roomId === null ? [] : [one.lesson.roomId])),
          ...named.roomIds,
        ],
      },
      new Map(),
    );
    lessons = { ...lessons, names };
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
      notices = await sendWeekChanges(transaction, this.notifications, snapshot, {
        kind: 'timetable.calendar_changed',
        name: input.event.name,
        firstDate: input.event.firstDate,
        lastDate: input.event.lastDate,
      });
    }
    return {
      lessons,
      audit: {
        dates: written,
        datedLessons: writes.map(datedAuditOf),
        notices,
        dayChanges: days,
        movedBack: backs.map((one) => one.key).sort(),
      },
    };
  }

  /**
   * Task 5.6b-2a (review correction 1): the "needs a decision" moves onto a
   * written date from a date after today the save does not write. Their
   * choice puts the stored block back at its old place on that date, the
   * lesson the version has there: "drop the change" held, checked there with
   * the full rule set (`storedDayCheck`, a blocked result refuses the save
   * `calendar_blocked` by date); "cancel the lesson that day" cancelled with
   * the change's reason, which takes no check. A move from today or earlier
   * follows 5.6a-5a decision 7 (the write removes the block, or keeps it
   * cancelled where it is).
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
      if (date <= input.today || input.written.has(date)) continue;
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
      if (choice === 'drop' && held.length > 0) {
        const checked = await storedDayCheck(
          transaction,
          { timetable: this.timetable, pattern: this.pattern },
          {
            accountId: input.accountId,
            lessons: held,
            alongside: placed.filter((one) => one.cancelCause !== null),
          },
        );
        blocked = checked.blocked;
        teacherIds = checked.teacherIds;
      }
      backs.push({
        key: item.answer.key,
        date,
        choice,
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

/** A stored move put back at its old place by a calendar save (task 5.6b-2a, review correction 1). */
interface MoveBack {
  readonly key: string;
  /** The date it goes back to. */
  readonly date: string;
  readonly choice: 'drop' | 'cancel';
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
      keepStored.add(one.id);
      cancelStored.delete(one.id);
    }
  }
  return { ...plan, keepStored, cancelStored };
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
