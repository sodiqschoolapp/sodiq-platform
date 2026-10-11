import {
  GRADES,
  slotKindSchema,
  templateLevelSchema,
  type Assignment,
  type SlotType,
  type TableCell,
  type TemplateTable,
  type TimedSlot,
  type Weekday,
} from '@sodiq/shared';
import {
  dayEndsAfterMidnight,
  dayTimes,
  isInForceOn,
  templateFor,
  type Day,
} from '@sodiq/timetable-rules';
import type { Transaction } from '../../database/transactions.js';
import { isWithdrawn } from './dated-rows.js';

/**
 * Everything a branch has of slot types, templates and their settings, read
 * once per request inside its transaction (the branch filter keeps it to the
 * branch). A branch has a few dozen rows here, so every rule works on the
 * whole state. A write reads it after taking the branch row (no other write
 * of the area runs meanwhile); a read takes no lock, so a write that commits
 * between its statements can show for one request as half done.
 */
export interface SlotTypeState {
  readonly id: string;
  readonly name: string;
  readonly kind: SlotType['kind'];
  readonly archivedAt: Date | null;
  /** Oldest first, withdrawn ones included (the rules skip them). */
  readonly lengths: readonly LengthRow[];
}

export interface LengthRow {
  readonly id: string;
  readonly lengthMinutes: number;
  readonly validFrom: string;
  readonly validUntil: string | null;
}

export interface VersionRow {
  readonly id: string;
  readonly startMinutes: number;
  readonly validFrom: string;
  readonly validUntil: string | null;
  /** In their order. */
  readonly slotTypeIds: readonly string[];
}

export interface TemplateState {
  readonly id: string;
  readonly name: string;
  readonly archivedAt: Date | null;
  /** Oldest first, withdrawn ones included (the rules skip them). */
  readonly versions: readonly VersionRow[];
}

export interface TemplateStore {
  readonly slotTypes: ReadonlyMap<string, SlotTypeState>;
  readonly templates: ReadonlyMap<string, TemplateState>;
  /** Withdrawn ones included (the rules skip them). */
  readonly assignments: readonly Assignment[];
}

export async function loadStore(transaction: Transaction): Promise<TemplateStore> {
  const [slotTypes, lengths, templates, versions, slots, assignments] = await Promise.all([
    transaction
      .selectFrom('slot_types')
      .select(['id', 'name', 'kind', 'archived_at'])
      .orderBy('id')
      .execute(),
    transaction
      .selectFrom('slot_type_lengths')
      .select(['id', 'slot_type_id', 'length_minutes', 'valid_from', 'valid_until'])
      .orderBy('valid_from')
      .orderBy('id')
      .execute(),
    transaction
      .selectFrom('day_templates')
      .select(['id', 'name', 'archived_at'])
      .orderBy('id')
      .execute(),
    transaction
      .selectFrom('day_template_versions')
      .select(['id', 'day_template_id', 'start_minutes', 'valid_from', 'valid_until'])
      .orderBy('valid_from')
      .orderBy('id')
      .execute(),
    transaction
      .selectFrom('day_template_slots')
      .select(['version_id', 'position', 'slot_type_id'])
      .orderBy('version_id')
      .orderBy('position')
      .execute(),
    transaction
      .selectFrom('day_template_assignments')
      .select([
        'id',
        'level',
        'weekday',
        'grade_from',
        'grade_to',
        'day_template_id',
        'valid_from',
        'valid_until',
      ])
      .orderBy('valid_from')
      .orderBy('id')
      .execute(),
  ]);

  return {
    slotTypes: new Map(
      slotTypes.map((row) => [
        row.id,
        {
          id: row.id,
          name: row.name,
          kind: slotKindSchema.parse(row.kind),
          archivedAt: row.archived_at,
          lengths: lengths
            .filter((length) => length.slot_type_id === row.id)
            .map((length) => ({
              id: length.id,
              lengthMinutes: length.length_minutes,
              validFrom: length.valid_from,
              validUntil: length.valid_until,
            })),
        },
      ]),
    ),
    templates: new Map(
      templates.map((row) => [
        row.id,
        {
          id: row.id,
          name: row.name,
          archivedAt: row.archived_at,
          versions: versions
            .filter((version) => version.day_template_id === row.id)
            .map((version) => ({
              id: version.id,
              startMinutes: version.start_minutes,
              validFrom: version.valid_from,
              validUntil: version.valid_until,
              slotTypeIds: slots
                .filter((slot) => slot.version_id === version.id)
                .map((slot) => slot.slot_type_id),
            })),
        },
      ]),
    ),
    assignments: assignments.map((row) => ({
      id: row.id,
      level: templateLevelSchema.parse(row.level),
      // The check of the table keeps it 1 to 7.
      weekday: row.weekday as Weekday | null,
      gradeFrom: row.grade_from,
      gradeTo: row.grade_to,
      dayTemplateId: row.day_template_id,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
    })),
  };
}

/** The row of a list in force on a date, withdrawn rows never. */
export function rowOn<Row extends { validFrom: string; validUntil: string | null }>(
  rows: readonly Row[],
  date: string,
): Row | undefined {
  return rows.find((row) => !isWithdrawn(row) && isInForceOn(row, date));
}

/** The length of a slot type on a date; `undefined` before its first length. */
export const lengthOn = (slotType: SlotTypeState, date: string): number | undefined =>
  rowOn(slotType.lengths, date)?.lengthMinutes;

/** Whether a dated row is in force on the date or on any later one. */
export const reachesFrom = (row: { validFrom: string; validUntil: string | null }, date: string) =>
  !isWithdrawn(row) && (row.validUntil === null || row.validUntil > date);

export interface TimedDay {
  readonly day: Day;
  readonly slots: readonly TimedSlot[];
}

/**
 * The day of a template on a date: the version in force on it, timed with the
 * lengths in force on it (decision 2). `null` before the first version, or
 * when a slot type has no length yet on that date.
 */
export function dayOf(store: TemplateStore, templateId: string, date: string): TimedDay | null {
  const version = rowOn(store.templates.get(templateId)?.versions ?? [], date);
  if (version === undefined) {
    return null;
  }
  const inputs: { slotTypeId: string; slotType: SlotTypeState; lengthMinutes: number }[] = [];
  for (const slotTypeId of version.slotTypeIds) {
    const slotType = store.slotTypes.get(slotTypeId);
    const lengthMinutes = slotType === undefined ? undefined : lengthOn(slotType, date);
    if (slotType === undefined || lengthMinutes === undefined) {
      return null;
    }
    inputs.push({ slotTypeId, slotType, lengthMinutes });
  }
  const day = dayTimes(
    version.startMinutes,
    inputs.map((input) => ({ kind: input.slotType.kind, lengthMinutes: input.lengthMinutes })),
  );
  return {
    day,
    slots: day.slots.map((slot, index): TimedSlot => {
      // One input per slot of the day, in the same order.
      const input = inputs[index] as (typeof inputs)[number];
      return {
        position: slot.position,
        slotTypeId: input.slotTypeId,
        name: input.slotType.name,
        kind: slot.kind,
        lengthMinutes: input.lengthMinutes,
        start: slot.start,
        end: slot.end,
        lessonNumber: slot.lessonNumber,
      };
    }),
  };
}

/** How many lesson slots a day has. */
export const lessonSlotsOf = (day: Day): number =>
  day.slots.filter((slot) => slot.lessonNumber !== null).length;

/**
 * The resulting template for every working weekday and grade 1 to 11 on the
 * date (`03`: "School setup shows the template that results for every weekday
 * and grade in one table"; answer 13). The settings in force on the date are
 * read for every weekday (`templateFor`).
 */
export function tableOn(
  store: TemplateStore,
  date: string,
  weekdays: readonly Weekday[],
): TemplateTable {
  const live = store.assignments.filter((row) => !isWithdrawn(row));
  const cells: TableCell[] = [];
  for (const grade of GRADES) {
    for (const weekday of weekdays) {
      const templateId = templateFor(grade, date, { assignments: live }, weekday);
      const template = templateId === null ? undefined : store.templates.get(templateId);
      const timed = templateId === null ? null : dayOf(store, templateId, date);
      cells.push({
        weekday,
        grade,
        template:
          template === undefined || timed === null
            ? null
            : {
                id: template.id,
                name: template.name,
                start: timed.day.start,
                end: timed.day.end,
                lessonSlots: lessonSlotsOf(timed.day),
              },
      });
    }
  }
  return { date, weekdays: [...weekdays], cells };
}

/** A table with the store it was drawn from, which holds the times of every slot. */
export interface DrawnTable {
  store: TemplateStore;
  table: TemplateTable;
}

/**
 * What a cell shows and what a change can move inside it: the template, and
 * the kind, start and end of every slot of its day. A summary of the day (its
 * start, end and number of lessons) misses a break moved one slot later, or two
 * slots of different lengths swapped.
 */
function cellDay({ store, table }: DrawnTable, cell: TableCell): string {
  if (cell.template === null) {
    return 'null';
  }
  const timed = dayOf(store, cell.template.id, table.date);
  return JSON.stringify({
    template: cell.template,
    slots: timed?.slots.map((slot) => [slot.kind, slot.start, slot.end]) ?? null,
  });
}

/**
 * The cells that differ between two tables of one date: another template, or
 * the same template with other times of any slot (a changed length or version).
 */
export function changedCells(
  before: DrawnTable,
  after: DrawnTable,
): { weekday: Weekday; grade: number }[] {
  return after.table.cells
    .filter((cell) => {
      const old = before.table.cells.find(
        (one) => one.weekday === cell.weekday && one.grade === cell.grade,
      );
      return (old === undefined ? 'null' : cellDay(before, old)) !== cellDay(after, cell);
    })
    .map((cell) => ({ weekday: cell.weekday, grade: cell.grade }));
}

/**
 * Whether a day of an active template ends after midnight on any date from
 * `from` on (decision 7): the date itself and every later date on which a
 * length or a version starts, the only dates on which a day can change.
 */
export function endsAfterMidnightFrom(store: TemplateStore, from: string): boolean {
  const dates = new Set([from]);
  for (const slotType of store.slotTypes.values()) {
    for (const length of slotType.lengths) {
      if (!isWithdrawn(length) && length.validFrom > from) dates.add(length.validFrom);
    }
  }
  for (const template of store.templates.values()) {
    for (const version of template.versions) {
      if (!isWithdrawn(version) && version.validFrom > from) dates.add(version.validFrom);
    }
  }
  for (const template of store.templates.values()) {
    if (template.archivedAt !== null) continue;
    for (const date of dates) {
      const timed = dayOf(store, template.id, date);
      if (timed !== null && dayEndsAfterMidnight(timed.day)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Whether a slot type is used from `today` on: a slot of a version of an
 * active template in force today or later names it (decision 11).
 */
export const slotTypeInUse = (store: TemplateStore, slotTypeId: string, today: string): boolean =>
  [...store.templates.values()].some(
    (template) =>
      template.archivedAt === null &&
      template.versions.some(
        (version) => reachesFrom(version, today) && version.slotTypeIds.includes(slotTypeId),
      ),
  );

/** Whether a template is set at a level from `today` on (decision 11). */
export const templateInUse = (store: TemplateStore, templateId: string, today: string): boolean =>
  store.assignments.some((row) => row.dayTemplateId === templateId && reachesFrom(row, today));
