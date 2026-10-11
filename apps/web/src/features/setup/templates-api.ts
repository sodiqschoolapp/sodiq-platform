import {
  assignmentListSchema,
  dayTemplateListSchema,
  dayTemplateSchema,
  slotTypeListSchema,
  templatePreviewSchema,
  templateTableSchema,
  timeText,
  type SlotType,
  type TemplateChange,
  type TemplatePreview,
} from '@sodiq/shared';
import { inForceOn } from '@sodiq/timetable-rules';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { SETUP_KEY } from './setup-api';

/**
 * The queries of slot types, day templates and where they apply (task 1.5).
 * One key prefix for the four: a change of one changes what the others show
 * (a length moves the times of every template that uses the slot type), so
 * every write marks all of them stale.
 */
export const templatesKey = (branchId?: string | null) =>
  branchId === undefined ? [...SETUP_KEY, 'templates'] : [...SETUP_KEY, 'templates', branchId];

export const invalidateTemplates = (queryClient: QueryClient): Promise<void> =>
  queryClient.invalidateQueries({ queryKey: templatesKey() });

export const slotTypesQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...templatesKey(branchId), 'slot-types'],
    queryFn: async () =>
      slotTypeListSchema.parse(
        await answerOf(api.GET('/api/setup/slot-types', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

export const dayTemplatesQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...templatesKey(branchId), 'day-templates'],
    queryFn: async () =>
      dayTemplateListSchema.parse(
        await answerOf(api.GET('/api/setup/day-templates', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

/** One template with its versions, its slots timed on the date. */
export const dayTemplateQuery = (branchId: string | null, id: string, date: string | null) =>
  queryOptions({
    queryKey: [...templatesKey(branchId), 'day-template', id, date],
    queryFn: async () =>
      dayTemplateSchema.parse(
        await answerOf(
          api.GET('/api/setup/day-templates/{id}', {
            params: { path: { id }, query: { date: date ?? '' }, header: branchHeader() },
          }),
        ),
      ),
    enabled: branchId !== null && date !== null,
  });

export const assignmentsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...templatesKey(branchId), 'assignments'],
    queryFn: async () =>
      assignmentListSchema.parse(
        await answerOf(
          api.GET('/api/setup/day-template-assignments', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The resulting template of every working weekday and grade on a date (answer 13). */
export const templateTableQuery = (branchId: string | null, date: string | null) =>
  queryOptions({
    queryKey: [...templatesKey(branchId), 'table', date],
    queryFn: async () =>
      templateTableSchema.parse(
        await answerOf(
          api.GET('/api/setup/day-template-table', {
            params: { query: { date: date ?? '' }, header: branchHeader() },
          }),
        ),
      ),
    enabled: branchId !== null && date !== null,
  });

/** The table before and after a change, written nowhere (decision 13 of pull request #46). */
export async function previewOf(change: TemplateChange): Promise<TemplatePreview> {
  return templatePreviewSchema.parse(
    await answerOf(
      api.POST('/api/setup/day-template-table/preview', {
        params: { header: branchHeader() },
        body: change,
      }),
    ),
  );
}

/** The length of a slot type on a date, by the rule engine's reading of dated rows; `null` before its first. */
export function lengthOn(slotType: SlotType, date: string): number | null {
  return inForceOn(slotType.lengths, date)[0]?.lengthMinutes ?? null;
}

/** `08:30–09:15`. */
export const rangeText = (start: number, end: number): string =>
  `${timeText(start)}–${timeText(end)}`;
