import {
  earlyWarningHandledSchema,
  earlyWarningListSchema,
  type EarlyWarningHandleInput,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';

/**
 * The early-warning list (task 9.4a; `08`, Early-warning list). Every figure and reason is the
 * server's, from `packages/calc`; the browser calculates nothing.
 */

export const earlyWarningKey = (branchId: string | null) =>
  ['results', branchId, 'early-warning'] as const;

export const earlyWarningQuery = (branchId: string | null, quarterId: string | undefined) =>
  queryOptions({
    queryKey: [...earlyWarningKey(branchId), quarterId ?? null],
    queryFn: async () =>
      earlyWarningListSchema.parse(
        await answerOf(
          api.GET('/api/results/early-warning', {
            params: {
              header: branchHeader(),
              query: quarterId === undefined ? {} : { quarterId },
            },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** A staff-only note and the mark "handled" on one reason (`08`, Handled). */
export async function markHandled(body: EarlyWarningHandleInput) {
  return earlyWarningHandledSchema.parse(
    await answerOf(
      api.POST('/api/results/early-warning/handled', {
        params: { header: branchHeader() },
        body,
      }),
    ),
  );
}

export const invalidateEarlyWarning = (queryClient: QueryClient, branchId: string | null) =>
  queryClient.invalidateQueries({ queryKey: earlyWarningKey(branchId) });
