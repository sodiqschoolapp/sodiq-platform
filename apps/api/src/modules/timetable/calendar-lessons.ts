import { Injectable } from '@nestjs/common';
import {
  CALENDAR_CANCEL_CAUSES,
  type CalendarLesson,
  type CalendarLessons,
  type ErrorDetail,
} from '@sodiq/shared';
import { addDays, patternIdOf } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { Notifications } from '../notifications/notifications.service.js';
import { bulkRecordsOf } from './bulk-cancels-kept.js';
import { runningUntil } from './chain.js';
import { datedCheck, type DatedFindings } from './dated-check.js';
import { writeDatedLessons, type DatedWrite } from './dated-lessons.js';
import { sortDayChanges } from './day-changes-kept.js';
import { namesOf } from './impact.js';
import { runsOf } from './journals.js';
import type { PatternState } from './pattern.service.js';
import { TimetablePattern } from './pattern.service.js';
import { datedAuditOf } from './publish.service.js';
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
 * A stored one-day change, bulk cancel or exam on a date written refuses the
 * save until task 5.6b-2 sorts it as a publish does (decision 7).
 */

/** One stretch of consecutive lesson dates of one published version. */
interface Stretch {
  readonly versionId: string;
  readonly firstDate: string;
  readonly lastDate: string;
  readonly state: PatternState;
  readonly findings: DatedFindings;
}

/** What the rewrite found and did; `audit` is `null` when no date lies in a published run. */
export interface CalendarRewrite {
  readonly lessons: CalendarLessons;
  readonly audit: {
    readonly dates: readonly string[];
    readonly datedLessons: ReturnType<typeof datedAuditOf>[];
    readonly notices: WeekNotices;
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

    // The side before, the written dates locked as the writer locks them.
    const snapshot = await snapshotDates(transaction, branchId, written);
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
        stretches.push({ versionId, firstDate: part.first, lastDate: part.last, state, findings });
      }
    }

    // Decision 7: what 5.6b-2 sorts refuses the save meanwhile.
    const stored: CalendarLessons['stored'] = [];
    for (const one of stretches) {
      const sorting = await sortDayChanges(transaction, {
        state: one.state,
        findings: one.findings,
        firstDate: one.firstDate,
        lastDate: one.lastDate,
        carriedVersionId: null,
      });
      for (const item of sorting.items) {
        // The changed date it touches: where the lesson is now, else where it was.
        const { from, to } = item.answer;
        const date = one.firstDate <= to.date && to.date <= one.lastDate ? to.date : from.date;
        stored.push({ kind: 'day_change', id: item.answer.key, date });
      }
      for (const record of await bulkRecordsOf(
        transaction,
        branchId,
        one.firstDate,
        one.lastDate,
      )) {
        stored.push({ kind: 'bulk_cancel', id: record.id, date: record.date });
      }
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

    const blocked = stretches.flatMap((one) => one.findings.blocked);
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
    if (!input.preview && blocked.length > 0) {
      throw new ApiException('calendar_blocked', 409, undefined, blocked.map(blockedDetail));
    }

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
    const blockedLines = blocked.map((one) => ({
      date: one.date ?? '',
      rule: one.rule,
      lessons: one.lessonIds.flatMap((id) => {
        const found = entryUnits.get(patternIdOf(id)?.id ?? id);
        return found === undefined ? [] : [found];
      }),
    }));
    const needsTeacher = stretches.flatMap((one) =>
      one.findings.needsTeacher.flatMap((need) => {
        const found = entryUnits.get(need.entryId);
        return found === undefined ? [] : [{ date: need.date, reason: need.reason, ...found }];
      }),
    );

    // The write. A preview with a stored record writes nothing (it would be
    // lost); one with a blocked conflict tries in a savepoint, as the
    // database may refuse it.
    const writes: DatedWrite[] = [];
    const doWrite = async () => {
      for (const one of stretches) {
        writes.push(
          await writeDatedLessons(
            transaction,
            one.state,
            one.findings,
            one.firstDate,
            one.lastDate,
            null,
          ),
        );
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

    let lessons: CalendarLessons = {
      ...NO_LESSONS,
      needsTeacher,
      blocked: blockedLines,
      stored,
    };
    let notices: WeekNotices = { notified: 0, marked: 0 };
    if (wrote) {
      const after = await readDates(transaction, branchId, written);
      const changes = weekChanges(snapshot.before, after, snapshot.unwritten);
      const cancelledAfter = (
        await Promise.all(writtenStretches.map((one) => generated(one.first, one.last)))
      ).flat();
      const removed = snapshot.before.filter((one) => changes.beforeDiffers.has(one.id));
      const created = after.filter((one) => changes.afterDiffers.has(one.id));
      const cancelled = unpaired(cancelledBefore, cancelledAfter);
      const shown = [...removed, ...created, ...cancelled];
      const { names, staff } = await namesOf(
        transaction,
        {
          unitIds: [
            ...shown.map((one) => one.lesson.unitId),
            ...needsTeacher.map((one) => one.unitId),
            ...blockedLines.flatMap((one) => one.lessons.map((lesson) => lesson.unitId)),
          ],
          subjectIds: [
            ...shown.map((one) => one.lesson.subjectId),
            ...needsTeacher.map((one) => one.subjectId),
            ...blockedLines.flatMap((one) => one.lessons.map((lesson) => lesson.subjectId)),
          ],
          teacherIds: [
            ...shown.flatMap((one) => one.lesson.teacherIds),
            ...changes.teachers.keys(),
          ],
          roomIds: shown.flatMap((one) => (one.lesson.roomId === null ? [] : [one.lesson.roomId])),
        },
        new Map(),
      );
      const withAccount = new Set(
        staff
          .filter((one) => one.kind !== 'vacancy' && one.account_id !== null)
          .map((one) => one.id),
      );
      lessons = {
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
        needsTeacher,
        notified: [...changes.teachers.keys()].filter((id) => withAccount.has(id)).sort(),
        blocked: blockedLines,
        stored,
        names,
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
      audit: { dates: written, datedLessons: writes.map(datedAuditOf), notices },
    };
  }
}
