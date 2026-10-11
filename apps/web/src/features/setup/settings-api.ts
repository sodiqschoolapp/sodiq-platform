import {
  attendanceValuesListSchema,
  branchSettingsSchema,
  setupChecklistSchema,
  travelTimeListSchema,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { SETUP_KEY } from './setup-api';

/**
 * The queries of the settings, the travel time and the setup checklist (task
 * 1.6). Each key carries the branch of the switcher; `null` while no branch is
 * chosen, and such a query is not run.
 */
export const settingsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...SETUP_KEY, 'settings', branchId],
    queryFn: async () =>
      branchSettingsSchema.parse(
        await answerOf(api.GET('/api/setup/settings', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

export const attendanceValuesQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...SETUP_KEY, 'attendanceValues', branchId],
    queryFn: async () =>
      attendanceValuesListSchema.parse(
        await answerOf(
          api.GET('/api/setup/attendance-values', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

export const travelTimesQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...SETUP_KEY, 'travelTimes', branchId],
    queryFn: async () =>
      travelTimeListSchema.parse(
        await answerOf(api.GET('/api/setup/travel-times', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

export const checklistQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...SETUP_KEY, 'checklist', branchId],
    queryFn: async () =>
      setupChecklistSchema.parse(
        await answerOf(api.GET('/api/setup/checklist', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

/** After a change of settings or quarters: the checklist and the lists of every branch read again. */
export const invalidateSettings = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: SETUP_KEY });
