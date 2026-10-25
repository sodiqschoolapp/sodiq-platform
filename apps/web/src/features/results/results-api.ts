import {
  studentAttendanceSchema,
  studentResultLessonsSchema,
  studentResultsSchema,
  studentResultTabsSchema,
} from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';

/**
 * The Results and Attendance tabs of a student's profile and the lessons behind
 * a figure (task 9.1; `08`, Student results). Every figure is the server's,
 * from `packages/calc`; the browser calculates nothing.
 */

/** Which of the two tabs the reader has: the tabs follow the server, never the role. */
export const studentResultTabsQuery = (branchId: string | null, studentId: string) =>
  queryOptions({
    queryKey: ['results', branchId, 'tabs', studentId],
    queryFn: async () =>
      studentResultTabsSchema.parse(
        await answerOf(
          api.GET('/api/results/students/{id}/tabs', {
            params: { header: branchHeader(), path: { id: studentId } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

export const studentResultsQuery = (
  branchId: string | null,
  studentId: string,
  yearId: string | undefined,
) =>
  queryOptions({
    queryKey: ['results', branchId, 'results', studentId, yearId ?? null],
    queryFn: async () =>
      studentResultsSchema.parse(
        await answerOf(
          api.GET('/api/results/students/{id}', {
            params: {
              header: branchHeader(),
              path: { id: studentId },
              query: yearId === undefined ? {} : { yearId },
            },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

export const studentAttendanceQuery = (
  branchId: string | null,
  studentId: string,
  yearId: string | undefined,
) =>
  queryOptions({
    queryKey: ['results', branchId, 'attendance', studentId, yearId ?? null],
    queryFn: async () =>
      studentAttendanceSchema.parse(
        await answerOf(
          api.GET('/api/results/students/{id}/attendance', {
            params: {
              header: branchHeader(),
              path: { id: studentId },
              query: yearId === undefined ? {} : { yearId },
            },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

export const studentResultLessonsQuery = (
  branchId: string | null,
  studentId: string,
  subjectId: string,
  quarterId: string,
) =>
  queryOptions({
    queryKey: ['results', branchId, 'lessons', studentId, subjectId, quarterId],
    queryFn: async () =>
      studentResultLessonsSchema.parse(
        await answerOf(
          api.GET('/api/results/students/{id}/lessons', {
            params: {
              header: branchHeader(),
              path: { id: studentId },
              query: { subjectId, quarterId },
            },
          }),
        ),
      ),
    enabled: branchId !== null,
  });
