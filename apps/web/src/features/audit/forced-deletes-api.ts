import { forcedDeleteListSchema, forcedDeleteSchema } from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';

export const FORCED_DELETES_KEY = ['forced-deletes'] as const;

/** The store of forced deletes of the branch, newest first (task 5.8b). */
export const forcedDeletesQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...FORCED_DELETES_KEY, branchId],
    queryFn: async () =>
      forcedDeleteListSchema.parse(
        await answerOf(api.GET('/api/forced-deletes', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

/** The restore of a forced delete within its 30 days; `key` makes a repeat harmless. */
export const restoreForcedDelete = (id: string, key: string) =>
  answerOf(
    api.POST('/api/forced-deletes/{id}/restore', {
      params: { header: { ...branchHeader(), 'Idempotency-Key': key }, path: { id } },
    }),
  ).then((answer) => forcedDeleteSchema.parse(answer));
