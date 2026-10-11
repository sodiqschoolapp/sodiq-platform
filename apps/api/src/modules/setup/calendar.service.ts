import { Inject, Injectable } from '@nestjs/common';
import {
  GRADES,
  nextDay,
  schoolDateOf,
  type CalendarChange,
  type CalendarDate,
  type CalendarDay,
  type CalendarEntry,
  type CalendarEntryList,
  type CalendarEntryRecord,
  type CalendarPreview,
  type Clock,
  type ErrorCode,
  type ErrorDetail,
  type Weekday,
} from '@sodiq/shared';
import { dayOn, weekdayOf, type CalendarSettings, type DayResult } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import { Audit } from '../audit/audit.service.js';
import type { Access } from '../access/permission.guard.js';
import { calendarSettings, loadEntries, losesGoLive, type StoredEntry } from './calendar-state.js';
import { loadStore, type TemplateStore } from './day-template-state.js';
import { notFound, refusingConstraints } from './setup-refusals.js';

/** A refusal of 409 that names the fields to show it beside. */
function refused(
  code: ErrorCode,
  paths: readonly string[] = [],
  message: string = code,
): ApiException {
  const details: ErrorDetail[] = paths.map((path) => ({ path, code, message }));
  return new ApiException(code, 409, undefined, details.length === 0 ? undefined : details);
}

/** A field that does not fit the stored entry, as a validation failure names it. */
function invalid(path: string, message: string): ApiException {
  return new ApiException('validation_failed', 400, undefined, [
    { path, code: 'invalid', message },
  ]);
}

/** The refusal of the database when two requests race past the overlap check (answer 17). */
const REFUSALS: Readonly<Record<string, ErrorCode>> = {
  calendar_entries_no_overlap: 'calendar_overlap',
};

/** The same for a restore, which answers with codes of its own (`.claude/rules/web.md`: a text is true on every path). */
const RESTORE_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  calendar_entries_no_overlap: 'calendar_restore_overlap',
};

/** The codes of the rules of `checkEntry`, as a create or an edit answers them, and as a restore does. */
interface EntryCodes {
  readonly outsideYear: ErrorCode;
  readonly followsRequired: ErrorCode;
  readonly followsNotWorking: ErrorCode;
  readonly overlap: ErrorCode;
}

const SAVE_CODES: EntryCodes = {
  outsideYear: 'calendar_outside_year',
  followsRequired: 'follows_weekday_required',
  followsNotWorking: 'follows_weekday_not_working',
  overlap: 'calendar_overlap',
};

const RESTORE_CODES: EntryCodes = {
  outsideYear: 'calendar_restore_outside_year',
  followsRequired: 'calendar_restore_follows_weekday',
  followsNotWorking: 'calendar_restore_follows_weekday',
  overlap: 'calendar_restore_overlap',
};

/** What a write knows: its transaction, the branch, today in branch time and the state read under the lock. */
interface Context {
  readonly transaction: Transaction;
  readonly access: Access;
  readonly branchId: string;
  readonly requestId: string;
  /** Today in branch time, from the injected clock (`edge/00-definitions`, Branch time). */
  readonly today: string;
  readonly workingWeekdays: readonly number[];
  readonly goLiveDate: string | null;
  readonly store: TemplateStore;
  readonly entries: readonly StoredEntry[];
  /** The planned and current years of the branch (answer 16). */
  readonly years: readonly { startDate: string; endDate: string }[];
}

/** Carries the answer of a preview out of the transaction it rolls back. */
class PreviewDone extends Error {
  constructor(readonly preview: CalendarPreview) {
    super('preview');
  }
}

/** The fields of an entry an audit entry and an edit compare. */
const fieldsOf = (entry: StoredEntry | CalendarEntryRecord) => ({
  kind: entry.kind,
  name: entry.name,
  firstDate: entry.firstDate,
  lastDate: entry.lastDate,
  gradeFrom: entry.gradeFrom,
  gradeTo: entry.gradeTo,
  dayTemplateId: entry.dayTemplateId,
  followsWeekday: entry.followsWeekday,
  examWeek: entry.examWeek,
});

/** Every date from the first to the last, both included. */
function datesFrom(first: string, last: string): string[] {
  const dates: string[] = [];
  for (let date = first; date <= last; date = nextDay(date)) {
    dates.push(date);
  }
  return dates;
}

/** Whether two closed ranges of grades overlap; no grades is the whole branch, 1 to 11. */
const gradesOverlap = (
  a: { gradeFrom: number | null; gradeTo: number | null },
  b: { gradeFrom: number | null; gradeTo: number | null },
) => (a.gradeFrom ?? 1) <= (b.gradeTo ?? 11) && (b.gradeFrom ?? 1) <= (a.gradeTo ?? 11);

/**
 * The academic calendar of a branch (docs/spec/03-school-setup.md, Academic
 * calendar, owner: Academic Vice Principal; docs/spec/edge-cases/time-dates-calendar.md;
 * task 1.4): days off and special days, what every grade has on a date, and
 * the preview of a save.
 *
 * Only dates from tomorrow on in branch time change (answer 16, decision 3 of
 * pull request #47); an entry lies inside one planned or current year
 * (answer 16, decision 5); two active entries of one kind never share a date
 * for overlapping grades (answer 17: the database constraint
 * `calendar_entries_no_overlap`, checked first here to name the field); a
 * special day on a non-working weekday names a working weekday it follows
 * (answer 15, decision 8); no save takes the school day away from the go-live
 * date (decision 7).
 *
 * Lock order: every write takes the branch row `for update` first, as the
 * writes of years, day templates and the go-live date do, so the years, the
 * templates, the working weekdays and the go-live date it reads do not change
 * meanwhile. Reads take no lock.
 *
 * The preview (decision 11) runs the same code as the save in a transaction
 * that is rolled back, the deferred checks made immediate first.
 */
@Injectable()
export class Calendar {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async context(
    transaction: Transaction,
    access: Access,
    branchId: string,
    requestId: string,
    lock: boolean,
  ): Promise<Context> {
    const query = transaction
      .selectFrom('branches')
      .select(['time_zone', 'working_weekdays', 'go_live_date'])
      .where('id', '=', branchId);
    const branch = await (lock ? query.forUpdate() : query).executeTakeFirst();
    if (branch === undefined) {
      throw notFound();
    }
    const [store, entries, years] = await Promise.all([
      loadStore(transaction),
      loadEntries(transaction),
      transaction
        .selectFrom('academic_years')
        .select(['start_date', 'end_date'])
        .where('status', 'in', ['planned', 'current'])
        .execute(),
    ]);
    return {
      transaction,
      access,
      branchId,
      requestId,
      today: schoolDateOf(this.clock.now(), branch.time_zone),
      workingWeekdays: branch.working_weekdays,
      goLiveDate: branch.go_live_date,
      store,
      entries,
      years: years.map((year) => ({ startDate: year.start_date, endDate: year.end_date })),
    };
  }

  private read<T>(access: Access, branchId: string, work: (context: Context) => T): Promise<T> {
    return this.transactions.run(access.branchIds, async (transaction) =>
      work(await this.context(transaction, access, branchId, '', false)),
    );
  }

  /** A write: the branch row taken for update first; the overlap refusal of the database mapped. */
  private write<T>(
    access: Access,
    branchId: string,
    requestId: string,
    work: (context: Context) => Promise<T>,
    refusals: Readonly<Record<string, ErrorCode>> = REFUSALS,
  ): Promise<T> {
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) =>
          work(await this.context(transaction, access, branchId, requestId, true)),
        ),
      refusals,
    );
  }

  private record(
    context: Context,
    action: string,
    id: string,
    values: { oldValue?: JsonValue; newValue?: JsonValue },
  ): Promise<void> {
    return this.audit.record(context.transaction, {
      branchId: context.branchId,
      actorId: context.access.accountId,
      assignmentId: context.access.assignmentId,
      action,
      record: { type: 'calendar_entry', id },
      ...values,
      requestId: context.requestId,
    });
  }

  // Reads.

  list(access: Access, branchId: string): Promise<CalendarEntryList> {
    return this.read(access, branchId, (context) => ({
      today: context.today,
      entries: context.entries.map((entry) => toEntry(context.store, entry)),
    }));
  }

  /** What every grade has on one date ("Check a date", decision 15). */
  day(access: Access, branchId: string, date: string): Promise<CalendarDate> {
    return this.read(access, branchId, (context) => {
      const settings = calendarSettings(context.store, context.workingWeekdays, context.entries);
      return {
        date,
        grades: GRADES.map((grade) => ({
          grade,
          day: dayAnswer(context, context.entries, dayOn(grade, date, settings)),
        })),
      };
    });
  }

  // Writes.

  create(
    access: Access,
    branchId: string,
    record: CalendarEntryRecord,
    requestId: string,
  ): Promise<CalendarEntry> {
    return this.write(access, branchId, requestId, (context) => this.createIn(context, record));
  }

  edit(
    access: Access,
    branchId: string,
    id: string,
    record: CalendarEntryRecord,
    requestId: string,
  ): Promise<CalendarEntry> {
    return this.write(access, branchId, requestId, (context) => this.editIn(context, id, record));
  }

  archive(access: Access, branchId: string, id: string, requestId: string): Promise<CalendarEntry> {
    return this.write(access, branchId, requestId, (context) => this.archiveIn(context, id));
  }

  restore(access: Access, branchId: string, id: string, requestId: string): Promise<CalendarEntry> {
    return this.write(
      access,
      branchId,
      requestId,
      (context) => this.restoreIn(context, id),
      RESTORE_REFUSALS,
    );
  }

  /**
   * The dates and grades a save changes, before and after, written nowhere:
   * the code of the save, checked by the database at once (the deferred checks
   * too), and rolled back, no audit entry either (decision 11).
   */
  async preview(
    access: Access,
    branchId: string,
    change: CalendarChange,
    requestId: string,
  ): Promise<CalendarPreview> {
    try {
      await this.write(
        access,
        branchId,
        requestId,
        async (context) => {
          const before = calendarSettings(context.store, context.workingWeekdays, context.entries);
          const old = change.action === 'create' ? undefined : entryOf(context, change.id);
          let saved: CalendarEntry;
          switch (change.action) {
            case 'create':
              saved = await this.createIn(context, change.record);
              break;
            case 'edit':
              saved = await this.editIn(context, change.id, change.record);
              break;
            case 'archive':
              saved = await this.archiveIn(context, change.id);
              break;
            case 'restore':
              saved = await this.restoreIn(context, change.id);
              break;
          }
          await sql`set constraints all immediate`.execute(context.transaction);
          const entriesAfter = await loadEntries(context.transaction);
          const after = calendarSettings(context.store, context.workingWeekdays, entriesAfter);
          const dates = new Set([
            ...(old === undefined ? [] : datesFrom(old.firstDate, old.lastDate)),
            ...datesFrom(saved.firstDate, saved.lastDate),
          ]);
          throw new PreviewDone({
            changes: changesOn(context, [...dates].sort(), before, after, entriesAfter),
          });
        },
        change.action === 'restore' ? RESTORE_REFUSALS : REFUSALS,
      );
    } catch (error) {
      if (error instanceof PreviewDone) {
        return error.preview;
      }
      throw error;
    }
    // The work above always throws, the preview or a refusal; TypeScript cannot see that.
    throw new ApiException('internal_error', 500);
  }

  private async createIn(context: Context, record: CalendarEntryRecord): Promise<CalendarEntry> {
    if (record.firstDate <= context.today) {
      throw refused('calendar_date_not_in_future', ['firstDate']);
    }
    templateIn(context, record.dayTemplateId);
    checkEntry(context, record, null);
    const row = await context.transaction
      .insertInto('calendar_entries')
      .values({
        branch_id: context.branchId,
        kind: record.kind,
        name: record.name,
        first_date: record.firstDate,
        last_date: record.lastDate,
        grade_from: record.gradeFrom,
        grade_to: record.gradeTo,
        day_template_id: record.dayTemplateId,
        follows_weekday: record.followsWeekday,
        exam_week: record.examWeek,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.refuseGoLive(context);
    await this.record(context, 'calendar_entry.create', row.id, { newValue: fieldsOf(record) });
    return this.answer(context, row.id);
  }

  /**
   * An edit (decision 3): an entry wholly in the past is read-only; the name
   * changes while the last date is today or later; a change of any other
   * field touches every date, so the whole entry must lie after today; a
   * moved first or last date may only add or remove dates after today.
   */
  private async editIn(
    context: Context,
    id: string,
    record: CalendarEntryRecord,
  ): Promise<CalendarEntry> {
    const before = entryOf(context, id);
    if (before.archivedAt !== null) {
      throw refused('calendar_entry_archived');
    }
    if (record.kind !== before.kind) {
      throw invalid('kind', 'The kind of an entry is fixed at creation.');
    }
    const old = fieldsOf(before);
    const next = fieldsOf(record);
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (key) => old[key] !== next[key],
    );
    if (changed.length === 0) {
      return this.answer(context, id);
    }
    if (before.lastDate < context.today) {
      throw refused('calendar_entry_past', changed);
    }
    const today = context.today;
    const moving = changed.filter((key) => !['name', 'firstDate', 'lastDate'].includes(key));
    if (moving.length > 0 && (before.firstDate <= today || record.firstDate <= today)) {
      throw refused('calendar_date_not_in_future', moving);
    }
    if (
      before.firstDate !== record.firstDate &&
      (before.firstDate < record.firstDate ? before.firstDate : record.firstDate) <= today
    ) {
      throw refused('calendar_date_not_in_future', ['firstDate']);
    }
    if (
      before.lastDate !== record.lastDate &&
      (before.lastDate < record.lastDate ? before.lastDate : record.lastDate) < today
    ) {
      throw refused('calendar_date_not_in_future', ['lastDate']);
    }
    if (record.dayTemplateId !== before.dayTemplateId) {
      templateIn(context, record.dayTemplateId);
    }
    if (moving.length > 0) {
      checkEntry(context, record, id);
    } else if (changed.some((key) => key !== 'name')) {
      // Only the first or the last date moved: the dates kept are not judged again.
      const kept = new Set(datesFrom(before.firstDate, before.lastDate));
      checkEntry(
        context,
        record,
        id,
        SAVE_CODES,
        datesFrom(record.firstDate, record.lastDate).filter((date) => !kept.has(date)),
        false,
      );
    }
    await context.transaction
      .updateTable('calendar_entries')
      .set({
        name: record.name,
        first_date: record.firstDate,
        last_date: record.lastDate,
        grade_from: record.gradeFrom,
        grade_to: record.gradeTo,
        day_template_id: record.dayTemplateId,
        follows_weekday: record.followsWeekday,
        exam_week: record.examWeek,
      })
      .where('id', '=', id)
      .execute();
    await this.refuseGoLive(context);
    await this.record(context, 'calendar_entry.edit', id, {
      oldValue: Object.fromEntries(changed.map((key) => [key, old[key]])),
      newValue: Object.fromEntries(changed.map((key) => [key, next[key]])),
    });
    return this.answer(context, id);
  }

  /** Archived while every date of the entry lies after today; a started entry is shortened instead (decision 3). */
  private async archiveIn(context: Context, id: string): Promise<CalendarEntry> {
    const entry = entryOf(context, id);
    if (entry.archivedAt !== null) {
      throw refused('calendar_entry_archived');
    }
    if (entry.firstDate <= context.today) {
      throw refused(
        entry.lastDate < context.today ? 'calendar_entry_past' : 'calendar_archive_started',
      );
    }
    const now = this.clock.now();
    await context.transaction
      .updateTable('calendar_entries')
      .set({ archived_at: now })
      .where('id', '=', id)
      .execute();
    await this.refuseGoLive(context);
    await this.record(context, 'calendar_entry.archive', id, {
      oldValue: { archivedAt: null },
      newValue: { archivedAt: now.toISOString() },
    });
    return this.answer(context, id);
  }

  /** Brought back under the rules of a new entry; an active entry is answered as it is. */
  private async restoreIn(context: Context, id: string): Promise<CalendarEntry> {
    const entry = entryOf(context, id);
    if (entry.archivedAt === null) {
      return this.answer(context, id);
    }
    if (entry.firstDate <= context.today) {
      throw refused('calendar_restore_started');
    }
    templateIn(context, entry.dayTemplateId, 'calendar_restore_template_archived');
    checkEntry(context, entry, id, RESTORE_CODES);
    await context.transaction
      .updateTable('calendar_entries')
      .set({ archived_at: null })
      .where('id', '=', id)
      .execute();
    await this.refuseGoLive(context);
    await this.record(context, 'calendar_entry.restore', id, {
      oldValue: { archivedAt: entry.archivedAt.toISOString() },
      newValue: { archivedAt: null },
    });
    return this.answer(context, id);
  }

  /** Refused when the write took the school day away from the go-live date (decision 7). */
  private async refuseGoLive(context: Context): Promise<void> {
    if (context.goLiveDate === null) {
      return;
    }
    const before = calendarSettings(context.store, context.workingWeekdays, context.entries);
    const after = calendarSettings(
      context.store,
      context.workingWeekdays,
      await loadEntries(context.transaction),
    );
    if (losesGoLive(context.goLiveDate, before, after)) {
      throw refused('go_live_school_day_taken');
    }
  }

  private async answer(context: Context, id: string): Promise<CalendarEntry> {
    const entry = (await loadEntries(context.transaction)).find((one) => one.id === id);
    if (entry === undefined) {
      throw notFound();
    }
    return toEntry(context.store, entry);
  }
}

/** An entry of the branch; another branch's id or an unknown one is 404. */
function entryOf(context: Context, id: string): StoredEntry {
  const entry = context.entries.find((one) => one.id === id);
  if (entry === undefined) {
    throw notFound();
  }
  return entry;
}

/** A template named by a special day: of the branch (else 404) and active. */
function templateIn(
  context: Context,
  templateId: string | null,
  archivedCode: ErrorCode = 'template_archived',
): void {
  if (templateId === null) {
    return;
  }
  const template = context.store.templates.get(templateId);
  if (template === undefined) {
    throw notFound();
  }
  if (template.archivedAt !== null) {
    throw refused(archivedCode, ['dayTemplateId']);
  }
}

/**
 * The rules an entry keeps on every date it has: one planned or current year
 * holds it (answer 16); a special day with a date on a non-working weekday
 * follows a working weekday (answer 15); no other active entry of its kind
 * shares a date for overlapping grades (answer 17).
 */
function checkEntry(
  context: Context,
  entry: Pick<
    StoredEntry,
    'kind' | 'firstDate' | 'lastDate' | 'gradeFrom' | 'gradeTo' | 'followsWeekday'
  >,
  id: string | null,
  codes: EntryCodes = SAVE_CODES,
  /**
   * The dates whose day the save changes, for the followed weekday: every date
   * of the entry, or only the added ones when an edit moves its dates and
   * nothing else (decision 3: a date the save does not change is not judged
   * again, the working weekdays may have changed since).
   */
  followsDates: readonly string[] = datesFrom(entry.firstDate, entry.lastDate),
  /** Whether the followed weekday is checked against the working weekdays. */
  checkFollowed = true,
): void {
  const year = context.years.find(
    (one) => one.startDate <= entry.firstDate && entry.lastDate <= one.endDate,
  );
  if (year === undefined) {
    throw refused(codes.outsideYear, ['firstDate', 'lastDate']);
  }
  if (entry.kind === 'special_day') {
    if (
      entry.followsWeekday === null &&
      followsDates.some((date) => !context.workingWeekdays.includes(weekdayOf(date)))
    ) {
      throw refused(codes.followsRequired, ['followsWeekday']);
    }
    if (
      checkFollowed &&
      entry.followsWeekday !== null &&
      !context.workingWeekdays.includes(entry.followsWeekday)
    ) {
      throw refused(codes.followsNotWorking, ['followsWeekday']);
    }
  }
  const other = context.entries.find(
    (one) =>
      one.id !== id &&
      one.archivedAt === null &&
      one.kind === entry.kind &&
      one.firstDate <= entry.lastDate &&
      entry.firstDate <= one.lastDate &&
      gradesOverlap(one, entry),
  );
  if (other !== undefined) {
    throw refused(
      codes.overlap,
      ['firstDate', 'lastDate'],
      `Overlaps "${other.name}", ${other.firstDate} to ${other.lastDate}.`,
    );
  }
}

function toEntry(store: TemplateStore, entry: StoredEntry): CalendarEntry {
  return {
    ...fieldsOf(entry),
    id: entry.id,
    dayTemplateName:
      entry.dayTemplateId === null
        ? null
        : (store.templates.get(entry.dayTemplateId)?.name ?? null),
    // The check of the table keeps it 1 to 7.
    followsWeekday: entry.followsWeekday as Weekday | null,
    archivedAt: entry.archivedAt === null ? null : entry.archivedAt.toISOString(),
  };
}

/** A result of `dayOn` with the names to show. */
function dayAnswer(context: Context, entries: readonly StoredEntry[], day: DayResult): CalendarDay {
  const entryName =
    day.entryId === null ? null : (entries.find((one) => one.id === day.entryId)?.name ?? null);
  if (!day.lessons) {
    return { lessons: false, reason: day.reason, entryId: day.entryId, entryName };
  }
  return {
    lessons: true,
    dayTemplateId: day.dayTemplateId,
    dayTemplateName: context.store.templates.get(day.dayTemplateId)?.name ?? '',
    // An ISO weekday of a date or of an entry, 1 to 7.
    followsWeekday: day.followsWeekday as Weekday,
    examWeek: day.examWeek,
    entryId: day.entryId,
    entryName,
  };
}

/**
 * The days that differ before and after a save, for every date given and
 * grade 1 to 11, in runs: consecutive grades of one date with the same before
 * and after, then consecutive dates with the same runs of grades.
 */
function changesOn(
  context: Context,
  dates: readonly string[],
  before: CalendarSettings,
  after: CalendarSettings,
  entriesAfter: readonly StoredEntry[],
): CalendarPreview['changes'] {
  interface Run {
    gradeFrom: number;
    gradeTo: number;
    before: CalendarDay;
    after: CalendarDay;
    key: string;
  }
  const runsOf = (date: string): Run[] => {
    const runs: Run[] = [];
    for (const grade of GRADES) {
      const old = dayAnswer(context, context.entries, dayOn(grade, date, before));
      const next = dayAnswer(context, entriesAfter, dayOn(grade, date, after));
      const key = JSON.stringify([old, next]);
      if (JSON.stringify(old) === JSON.stringify(next)) {
        continue;
      }
      const last = runs.at(-1);
      if (last !== undefined && last.key === key && last.gradeTo === grade - 1) {
        last.gradeTo = grade;
      } else {
        runs.push({ gradeFrom: grade, gradeTo: grade, before: old, after: next, key });
      }
    }
    return runs;
  };

  const changes: CalendarPreview['changes'] = [];
  let open: { firstDate: string; lastDate: string; runs: Run[]; key: string } | null = null;
  const close = () => {
    if (open !== null) {
      for (const run of open.runs) {
        changes.push({
          firstDate: open.firstDate,
          lastDate: open.lastDate,
          gradeFrom: run.gradeFrom,
          gradeTo: run.gradeTo,
          before: run.before,
          after: run.after,
        });
      }
    }
    open = null;
  };
  for (const date of dates) {
    const runs = runsOf(date);
    const key = JSON.stringify(runs.map((run) => [run.gradeFrom, run.gradeTo, run.key]));
    if (runs.length === 0) {
      close();
    } else if (open !== null && open.key === key && nextDay(open.lastDate) === date) {
      open.lastDate = date;
    } else {
      close();
      open = { firstDate: date, lastDate: date, runs, key };
    }
  }
  close();
  return changes;
}
