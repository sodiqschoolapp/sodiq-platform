import { subjectListSchema, subjectQuarterWeightsSchema } from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { SETUP_KEY } from './setup-api';

/**
 * The subjects with the weights of the branch of the switcher (task 2.1). The
 * subject is the same in every branch, its weights are the branch's (owner's
 * answer 3): a change of a subject marks the lists of every branch stale.
 */
export const subjectsKey = (branchId?: string | null) =>
  branchId === undefined ? [...SETUP_KEY, 'subjects'] : [...SETUP_KEY, 'subjects', branchId];

export const subjectsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: subjectsKey(branchId),
    queryFn: async () =>
      subjectListSchema.parse(
        await answerOf(api.GET('/api/setup/subjects', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

/** The four quarters of one year of the branch with a subject's distributions. */
export const quarterWeightsQuery = (
  branchId: string | null,
  subjectId: string,
  yearId: string | null,
) =>
  queryOptions({
    queryKey: [...subjectsKey(branchId), subjectId, 'quarters', yearId],
    queryFn: async () =>
      subjectQuarterWeightsSchema.parse(
        await answerOf(
          api.GET('/api/setup/subjects/{id}/quarter-weights', {
            params: {
              header: branchHeader(),
              path: { id: subjectId },
              query: { yearId: yearId ?? '' },
            },
          }),
        ),
      ),
    enabled: branchId !== null && yearId !== null,
  });

/** After a change of a subject or its weights: every subject list and the checklist. */
export const invalidateSubjects = (queryClient: QueryClient): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: subjectsKey() }),
    queryClient.invalidateQueries({ queryKey: [...SETUP_KEY, 'checklist'] }),
  ]);
