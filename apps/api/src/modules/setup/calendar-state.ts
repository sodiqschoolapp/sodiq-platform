import { calendarEntryKindSchema, examWeekSchema, templateLevelSchema } from '@sodiq/shared';
import { isSchoolDay, type CalendarEntry, type CalendarSettings } from '@sodiq/timetable-rules';
import type { Transaction } from '../../database/transactions.js';
import type { TemplateStore } from './day-template-state.js';
import { isWithdrawn } from './dated-rows.js';

/** An entry as stored, archived ones included. */
export interface StoredEntry extends CalendarEntry {
  readonly name: string;
  readonly archivedAt: Date | null;
}

/** Every entry of the branch (the branch filter keeps it to the branch), by first date. */
export async function loadEntries(transaction: Transaction): Promise<StoredEntry[]> {
  const rows = await transaction
    .selectFrom('calendar_entries')
    .select([
      'id',
      'kind',
      'name',
      'first_date',
      'last_date',
      'grade_from',
      'grade_to',
      'day_template_id',
      'follows_weekday',
      'exam_week',
      'archived_at',
    ])
    .orderBy('first_date')
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    kind: calendarEntryKindSchema.parse(row.kind),
    name: row.name,
    firstDate: row.first_date,
    lastDate: row.last_date,
    gradeFrom: row.grade_from,
    gradeTo: row.grade_to,
    dayTemplateId: row.day_template_id,
    followsWeekday: row.follows_weekday,
    examWeek: row.exam_week === null ? null : examWeekSchema.parse(row.exam_week),
    archivedAt: row.archived_at,
  }));
}

/** What `dayOn` reads: the working weekdays, the settings that took effect, the active entries. */
export function calendarSettings(
  store: TemplateStore,
  workingWeekdays: readonly number[],
  entries: readonly StoredEntry[],
): CalendarSettings {
  return {
    workingWeekdays,
    assignments: store.assignments.filter((row) => !isWithdrawn(row)),
    entries: entries.filter((entry) => entry.archivedAt === null),
  };
}

/**
 * The settings of the branch for `dayOn`, read inside the transaction. Only
 * the template settings are read of the templates: `dayOn` names a template
 * and needs no times.
 */
export async function loadCalendarSettings(
  transaction: Transaction,
  workingWeekdays: readonly number[],
): Promise<CalendarSettings> {
  const [assignments, entries] = await Promise.all([
    transaction
      .selectFrom('day_template_assignments')
      .select([
        'level',
        'weekday',
        'grade_from',
        'grade_to',
        'day_template_id',
        'valid_from',
        'valid_until',
      ])
      .execute(),
    loadEntries(transaction),
  ]);
  return {
    workingWeekdays,
    assignments: assignments
      .map((row) => ({
        level: templateLevelSchema.parse(row.level),
        weekday: row.weekday,
        gradeFrom: row.grade_from,
        gradeTo: row.grade_to,
        dayTemplateId: row.day_template_id,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
      }))
      .filter((row) => !isWithdrawn(row)),
    entries: entries.filter((entry) => entry.archivedAt === null),
  };
}

/**
 * Whether a change takes the school day away from the go-live date
 * (`edge/academic-year`, "Go-live can be on any school day"; decision 7 of
 * task 1.4): it was a school day before the change and is none after it. A
 * go-live date that was no school day before is left to its own save.
 */
export const losesGoLive = (
  goLiveDate: string | null,
  before: CalendarSettings,
  after: CalendarSettings,
): boolean =>
  goLiveDate !== null && isSchoolDay(goLiveDate, before) && !isSchoolDay(goLiveDate, after);
