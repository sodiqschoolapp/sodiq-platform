import {
  calendarDateSchema,
  calendarEntryListSchema,
  calendarPreviewSchema,
  type CalendarChange,
  type CalendarEntry,
  type CalendarPreview,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { SETUP_KEY } from './setup-api';
import { invalidateTemplates } from './templates-api';

/** The queries of the calendar (task 1.4). */
export const calendarKey = (branchId?: string | null) =>
  branchId === undefined ? [...SETUP_KEY, 'calendar'] : [...SETUP_KEY, 'calendar', branchId];

/**
 * A save marks the calendar stale, and the day templates too: a special day
 * from today on keeps its template in use (from 1.5, pull request #46).
 */
export const invalidateCalendar = async (queryClient: QueryClient): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: calendarKey() }),
    invalidateTemplates(queryClient),
  ]);
};

export const calendarEntriesQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...calendarKey(branchId), 'entries'],
    queryFn: async () =>
      calendarEntryListSchema.parse(
        await answerOf(
          api.GET('/api/setup/calendar-entries', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

/** What every grade has on one date ("Check a date"). */
export const calendarDayQuery = (branchId: string | null, date: string | null) =>
  queryOptions({
    queryKey: [...calendarKey(branchId), 'day', date],
    queryFn: async () =>
      calendarDateSchema.parse(
        await answerOf(
          api.GET('/api/setup/calendar-day', {
            params: { query: { date: date ?? '' }, header: branchHeader() },
          }),
        ),
      ),
    enabled: branchId !== null && date !== null,
  });

/** The dates and grades a save changes, written nowhere (decision 11 of pull request #47). */
export async function calendarPreviewOf(change: CalendarChange): Promise<CalendarPreview> {
  return calendarPreviewSchema.parse(
    await answerOf(
      api.POST('/api/setup/calendar-entries/preview', {
        params: { header: branchHeader() },
        body: change,
      }),
    ),
  );
}

/** Whether every date of an entry lies before today: it is read-only (answer 16). */
export const isPast = (entry: CalendarEntry, today: string): boolean => entry.lastDate < today;

/** Whether an entry has begun: only its name and its future dates change (decision 3). */
export const hasStarted = (entry: CalendarEntry, today: string): boolean =>
  entry.firstDate <= today;
