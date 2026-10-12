import {
  availabilitySchema,
  staffDetailSchema,
  staffListSchema,
  vacancyDetailSchema,
  vacancyListSchema,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
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

/** Reads a photo as a `data:` address the page can show and keep in memory. */
function dataUrlOf(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new ApiFailure('no_answer'));
      }
    };
    reader.onerror = () => {
      reject(new ApiFailure('no_answer'));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * The photo of a staff record (task 2.2c-2), kept in memory for the session
 * under its id: a new photo has a new id, and the API lets no browser cache
 * keep it (decision 6). `null` when the record has none.
 */
export const staffPhotoQuery = (branchId: string | null, id: string, photoId: string | null) =>
  queryOptions({
    queryKey: [...PEOPLE_KEY, 'photo', id, photoId],
    queryFn: async () => {
      // The document calls the photo a binary string; with `parseAs: 'blob'` it is a Blob.
      const file: unknown = await answerOf(
        api.GET('/api/people/staff/{id}/photo', {
          params: { header: branchHeader(), path: { id } },
          parseAs: 'blob',
        }),
      );
      if (!(file instanceof Blob)) {
        throw new ApiFailure('no_answer');
      }
      return dataUrlOf(file);
    },
    enabled: branchId !== null && photoId !== null,
    staleTime: Infinity,
    retry: false,
  });

/** Sends a photo the browser has shrunk (`shrinkPhoto`); the answer is the record as it now is. */
export const setStaffPhoto = (id: string, photo: Blob) =>
  answerOf(
    api.PUT('/api/people/staff/{id}/photo', {
      params: { header: branchHeader(), path: { id } },
      // The document types the body as a binary string; the browser sends the Blob as it is.
      body: photo as unknown as string,
      bodySerializer: (body: unknown) => body as Blob,
      headers: { 'Content-Type': photo.type },
    }),
  );

export const removeStaffPhoto = (id: string) =>
  answerOf(
    api.DELETE('/api/people/staff/{id}/photo', {
      params: { header: branchHeader(), path: { id } },
    }),
  );
