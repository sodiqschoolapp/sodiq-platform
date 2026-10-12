import {
  availabilitySchema,
  staffDetailSchema,
  staffListSchema,
  vacancyDetailSchema,
  vacancyListSchema,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { divisionsKey } from '@/features/setup/setup-api';

export const PEOPLE_KEY = ['people'] as const;

/**
 * The staff of the branch of the switcher (task 2.2a). A record is the same
 * in every branch its person works in, so a change marks the lists of every
 * branch stale.
 */
export const staffKey = (branchId?: string | null) =>
  branchId === undefined ? [...PEOPLE_KEY, 'staff'] : [...PEOPLE_KEY, 'staff', branchId];

export const staffQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: staffKey(branchId),
    queryFn: async () =>
      staffListSchema.parse(
        await answerOf(api.GET('/api/people/staff', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

/** One person with the status history and what the account may change. */
export const staffDetailQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...staffKey(branchId), 'detail', id],
    queryFn: async () =>
      staffDetailSchema.parse(
        await answerOf(
          api.GET('/api/people/staff/{id}', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** After a change of a record: every staff list and the staff counts of the divisions. */
export const invalidateStaff = (queryClient: QueryClient): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: staffKey() }),
    queryClient.invalidateQueries({ queryKey: divisionsKey() }),
  ]);

/** The hours of a record in the branch of the switcher, and the others read only (task 2.2b). */
export const availabilityQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...PEOPLE_KEY, 'availability', branchId, id],
    queryFn: async () =>
      availabilitySchema.parse(
        await answerOf(
          api.GET('/api/people/staff/{id}/availability', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The vacancies of the branch of the switcher (task 2.2b). */
export const vacanciesKey = (branchId?: string | null) =>
  branchId === undefined ? [...PEOPLE_KEY, 'vacancies'] : [...PEOPLE_KEY, 'vacancies', branchId];

export const vacanciesQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: vacanciesKey(branchId),
    queryFn: async () =>
      vacancyListSchema.parse(
        await answerOf(api.GET('/api/people/vacancies', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

export const vacancyDetailQuery = (branchId: string | null, id: string) =>
  queryOptions({
    queryKey: [...vacanciesKey(branchId), 'detail', id],
    queryFn: async () =>
      vacancyDetailSchema.parse(
        await answerOf(
          api.GET('/api/people/vacancies/{id}', {
            params: { header: branchHeader(), path: { id } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** After a change of a vacancy: the vacancy lists. */
export const invalidateVacancies = (queryClient: QueryClient): Promise<unknown> =>
  queryClient.invalidateQueries({ queryKey: vacanciesKey() });
