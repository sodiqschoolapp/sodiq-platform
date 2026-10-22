import { journalGridSchema, journalListSchema } from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';

/** The journals of a branch (task 6.2); `null` while no branch is chosen. */
export const journalKey = (branchId?: string | null) =>
  branchId === undefined ? ['journal'] : ['journal', branchId];

/** The Journals page: the journals the role may open in a year (the current one without `yearId`). */
export const journalsQuery = (branchId: string | null, yearId: string | null) =>
  queryOptions({
    queryKey: [...journalKey(branchId), 'list', yearId],
    queryFn: async () =>
      journalListSchema.parse(
        await answerOf(
          api.GET('/api/journal/journals', {
            params: { header: branchHeader(), query: yearId === null ? {} : { yearId } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** One journal for one quarter (the quarter of today without `quarterId`). */
export const journalGridQuery = (
  branchId: string | null,
  journalId: string,
  quarterId: string | null,
) =>
  queryOptions({
    queryKey: [...journalKey(branchId), 'grid', journalId, quarterId],
    queryFn: async () =>
      journalGridSchema.parse(
        await answerOf(
          api.GET('/api/journal/journals/{journalId}', {
            params: {
              header: branchHeader(),
              path: { journalId },
              query: quarterId === null ? {} : { quarterId },
            },
          }),
        ),
      ),
    enabled: branchId !== null,
  });
