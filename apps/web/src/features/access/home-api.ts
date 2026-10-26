import {
  attendanceTodaySchema,
  branchSummarySchema,
  conflictsSummarySchema,
  earlyWarningListSchema,
  lessonsTodaySchema,
} from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';

/**
 * The reads of the home pages (task 9.4b; `08`, Home pages by role). Every figure is the
 * server's, from `packages/calc`; the browser calculates nothing.
 */

const homeKey = (branchId: string | null) => ['home', branchId] as const;

/** The attendance of the classes the reader may read, today (`GET /api/journal/attendance-today`). */
export const attendanceTodayQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...homeKey(branchId), 'attendance-today'],
    queryFn: async () =>
      attendanceTodaySchema.parse(
        await answerOf(
          api.GET('/api/journal/attendance-today', {
            params: { header: branchHeader(), query: {} },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The lessons of today and their status (`GET /api/journal/lessons-today`). */
export const lessonsTodayQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...homeKey(branchId), 'lessons-today'],
    queryFn: async () =>
      lessonsTodaySchema.parse(
        await answerOf(
          api.GET('/api/journal/lessons-today', { params: { header: branchHeader(), query: {} } }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The branch summary (`GET /api/results/branch-summary`). */
export const branchSummaryQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...homeKey(branchId), 'branch-summary'],
    queryFn: async () =>
      branchSummarySchema.parse(
        await answerOf(
          api.GET('/api/results/branch-summary', { params: { header: branchHeader(), query: {} } }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The conflict counts of the drafts and of the version in force (`GET /api/timetable/conflicts-summary`). */
export const conflictsSummaryQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...homeKey(branchId), 'conflicts-summary'],
    queryFn: async () =>
      conflictsSummarySchema.parse(
        await answerOf(
          api.GET('/api/timetable/conflicts-summary', {
            params: { header: branchHeader(), query: {} },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** What an early-warning card reads: own journals, one own class, or the reader's whole list. */
export type EarlyWarningScope =
  | { readonly kind: 'own_journals' }
  | { readonly kind: 'class'; readonly classId: string }
  | { readonly kind: 'all' };

/** The early-warning list narrowed for a home card (`GET /api/results/early-warning`). */
export const earlyWarningHomeQuery = (branchId: string | null, scope: EarlyWarningScope) =>
  queryOptions({
    queryKey: [
      'results',
      branchId,
      'early-warning',
      'home',
      scope.kind,
      scope.kind === 'class' ? scope.classId : null,
    ],
    queryFn: async () =>
      earlyWarningListSchema.parse(
        await answerOf(
          api.GET('/api/results/early-warning', {
            params: {
              header: branchHeader(),
              query:
                scope.kind === 'own_journals'
                  ? { for: 'own_journals' }
                  : scope.kind === 'class'
                    ? { classId: scope.classId }
                    : {},
            },
          }),
        ),
      ),
    enabled: branchId !== null,
  });
