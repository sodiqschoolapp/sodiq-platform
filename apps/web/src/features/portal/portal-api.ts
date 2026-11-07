import {
  portalAttendanceWeekSchema,
  portalChildrenSchema,
  portalGradesSchema,
  portalHomeworkWeekSchema,
  portalRatingSchema,
  portalWeekSchema,
} from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { fileNameOf, save } from '@/components/list/use-export';

/**
 * The calls of the parent portal (task 11.2, pull request #294). A portal route names no
 * branch: the server takes the child's branch from the child scope, never from the browser.
 */
export const PORTAL_KEY = ['portal'] as const;

export const portalChildrenQuery = queryOptions({
  queryKey: [...PORTAL_KEY, 'children'],
  queryFn: async () => portalChildrenSchema.parse(await answerOf(api.GET('/api/portal/children'))),
});

/** The week of a date of a child; today in the child's branch when no date is given. */
export const portalWeekQuery = (studentId: string, date: string | undefined) =>
  queryOptions({
    queryKey: [...PORTAL_KEY, 'week', studentId, date ?? null],
    queryFn: async () =>
      portalWeekSchema.parse(
        await answerOf(
          api.GET('/api/portal/children/{studentId}/timetable', {
            params: { path: { studentId }, query: date === undefined ? {} : { date } },
          }),
        ),
      ),
  });

export const portalHomeworkQuery = (studentId: string, date: string | undefined) =>
  queryOptions({
    queryKey: [...PORTAL_KEY, 'homework', studentId, date ?? null],
    queryFn: async () =>
      portalHomeworkWeekSchema.parse(
        await answerOf(
          api.GET('/api/portal/children/{studentId}/homework', {
            params: { path: { studentId }, query: date === undefined ? {} : { date } },
          }),
        ),
      ),
  });

/** The grades of a child in a quarter (task 11.3); the current quarter when none is given. */
export const portalGradesQuery = (studentId: string, quarter: string | undefined) =>
  queryOptions({
    queryKey: [...PORTAL_KEY, 'grades', studentId, quarter ?? null],
    queryFn: async () =>
      portalGradesSchema.parse(
        await answerOf(
          api.GET('/api/portal/children/{studentId}/grades', {
            params: { path: { studentId }, query: quarter === undefined ? {} : { quarter } },
          }),
        ),
      ),
  });

/** The marks of a child in the week of a date (task 11.3). */
export const portalAttendanceQuery = (studentId: string, date: string | undefined) =>
  queryOptions({
    queryKey: [...PORTAL_KEY, 'attendance', studentId, date ?? null],
    queryFn: async () =>
      portalAttendanceWeekSchema.parse(
        await answerOf(
          api.GET('/api/portal/children/{studentId}/attendance', {
            params: { path: { studentId }, query: date === undefined ? {} : { date } },
          }),
        ),
      ),
  });

/** The own position of a child in a quarter (task 11.6); the current quarter when none is given. */
export const portalRatingQuery = (studentId: string, quarter: string | undefined) =>
  queryOptions({
    queryKey: [...PORTAL_KEY, 'rating', studentId, quarter ?? null],
    queryFn: async () =>
      portalRatingSchema.parse(
        await answerOf(
          api.GET('/api/portal/children/{studentId}/rating', {
            params: { path: { studentId }, query: quarter === undefined ? {} : { quarter } },
          }),
        ),
      ),
  });

/** Downloads a file of a homework under its own name. */
export async function downloadPortalFile(
  studentId: string,
  fileId: string,
  name: string,
): Promise<void> {
  const result = await api.GET('/api/portal/children/{studentId}/files/{fileId}', {
    params: { path: { studentId, fileId } },
    parseAs: 'blob',
  });
  // The document calls the file a binary string; with `parseAs: 'blob'` it is a Blob.
  const file: unknown = await answerOf(Promise.resolve(result));
  if (!(file instanceof Blob)) throw new ApiFailure('no_answer');
  save(file, fileNameOf(result.response.headers.get('Content-Disposition'), name));
}

const DAY_MS = 86_400_000;

/** The date a number of days from a school date. */
export function datePlus(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The weekday of a school date, 1 for Monday to 7 for Sunday. */
export function weekdayOfDate(date: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const day = new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay();
  return (day === 0 ? 7 : day) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}
