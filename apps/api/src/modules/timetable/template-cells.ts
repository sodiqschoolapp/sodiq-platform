import { weekdaySchema, type DraftReadiness } from '@sodiq/shared';
import { firstOn, templateFor, type TemplateCell } from '@sodiq/timetable-rules';
import { z } from 'zod';
import type { Transaction } from '../../database/transactions.js';
import { isWithdrawn } from '../setup/dated-rows.js';
import { dayOf, lessonSlotsOf, loadStore } from '../setup/day-template-state.js';

/**
 * The table of step 1 of the draft builder (task 5.3a, pull request #127,
 * decisions 2 and 4): for each working weekday of the branch and each grade of
 * the year's active classes of the branch, the template in force on the
 * weekday's first date on or after `from` (the later of the start date and
 * today), with no special dates, as `weekDaysOf` reads the week for the
 * totals and the engine for a pattern.
 */
export interface DrawnCells {
  /** What the rule engine compares (`templatesReadiness`), and what a confirm stores. */
  cells: TemplateCell[];
  /** What the builder shows. */
  answer: DraftReadiness['templates']['cells'];
}

export async function templateCellsOf(
  transaction: Transaction,
  branchId: string,
  yearId: string,
  from: string,
): Promise<DrawnCells> {
  const [branch, grades, store] = await Promise.all([
    transaction
      .selectFrom('branches')
      .select('working_weekdays')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow(),
    transaction
      .selectFrom('classes')
      .select('grade')
      .distinct()
      .where('branch_id', '=', branchId)
      .where('academic_year_id', '=', yearId)
      .where('archived_at', 'is', null)
      .orderBy('grade')
      .execute(),
    loadStore(transaction),
  ]);
  const weekly = { assignments: store.assignments.filter((row) => !isWithdrawn(row)) };
  const cells: TemplateCell[] = [];
  const answer: DrawnCells['answer'] = [];
  const weekdays = z
    .array(weekdaySchema)
    .parse([...new Set(branch.working_weekdays)].sort((a, b) => a - b));
  for (const { grade } of grades) {
    for (const weekday of weekdays) {
      const date = firstOn(from, weekday);
      const templateId = templateFor(grade, date, weekly);
      const template = templateId === null ? undefined : store.templates.get(templateId);
      const timed = templateId === null ? null : dayOf(store, templateId, date);
      if (template === undefined || timed === null) {
        cells.push({ weekday, grade, date, template: null });
        answer.push({ weekday, grade, date, template: null });
        continue;
      }
      cells.push({
        weekday,
        grade,
        date,
        template: {
          id: template.id,
          slots: timed.day.slots.map((slot) => [slot.kind, slot.start, slot.end] as const),
        },
      });
      answer.push({
        weekday,
        grade,
        date,
        template: {
          id: template.id,
          name: template.name,
          start: timed.day.start,
          end: timed.day.end,
          lessonSlots: lessonSlotsOf(timed.day),
          // Task 5.3b-2: the slots, for the slot of a pin.
          slots: timed.day.slots.map((slot) => ({
            position: slot.position,
            kind: slot.kind,
            start: slot.start,
            end: slot.end,
          })),
        },
      });
    }
  }
  return { cells, answer };
}

/** The confirmed table as `timetable_versions.templates_confirmed` holds it (0068). */
const storedSchema = z.object({
  from: z.string(),
  cells: z.array(
    z.object({
      weekday: z.int(),
      grade: z.int(),
      date: z.string(),
      template: z
        .object({
          id: z.string(),
          slots: z.array(z.tuple([z.enum(['lesson', 'break']), z.int(), z.int()])),
        })
        .nullable(),
    }),
  ),
});

/** What a confirm writes. */
export interface StoredCells {
  readonly from: string;
  readonly cells: readonly TemplateCell[];
}

/** The confirmed cells, or `null` when the table was never confirmed. */
export const confirmedCellsOf = (stored: unknown): TemplateCell[] | null =>
  stored === null ? null : storedSchema.parse(stored).cells;
