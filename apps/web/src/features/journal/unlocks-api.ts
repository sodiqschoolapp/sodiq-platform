import {
  editExtensionSchema,
  editExtensionsSchema,
  journalUnlockSchema,
  journalUnlocksSchema,
  type EditExtensionCreate,
  type UnlockDecision,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { invalidateJournal, journalKey } from './journal-api';

/**
 * Unlock requests and the branch-wide extension of the edit period (task 8.4,
 * pull request #222). Who decides, nobody deciding their own and the lock
 * itself are the server's; the screens follow its answers.
 */
export const unlocksQuery = (branchId: string | null, view: 'deciding' | 'own' | 'branch') =>
  queryOptions({
    queryKey: [...journalKey(branchId), 'unlocks', view],
    queryFn: async () =>
      journalUnlocksSchema.parse(
        await answerOf(
          api.GET('/api/journal/unlocks', { params: { header: branchHeader(), query: { view } } }),
        ),
      ),
    enabled: branchId !== null,
  });

export const extensionsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...journalKey(branchId), 'extensions'],
    queryFn: async () =>
      editExtensionsSchema.parse(
        await answerOf(api.GET('/api/journal/extensions', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

export const requestLessonUnlock = (lessonId: string, reason: string) =>
  answerOf(
    api.POST('/api/journal/lessons/{lessonId}/unlocks', {
      params: { header: branchHeader(), path: { lessonId } },
      body: { reason },
    }),
  ).then((answer) => journalUnlockSchema.parse(answer));

export const requestRatingUnlock = (journalId: string, quarterId: string, reason: string) =>
  answerOf(
    api.POST('/api/journal/journals/{journalId}/rating/{quarterId}/unlocks', {
      params: { header: branchHeader(), path: { journalId, quarterId } },
      body: { reason },
    }),
  ).then((answer) => journalUnlockSchema.parse(answer));

export const decideUnlock = (unlockId: string, body: UnlockDecision) =>
  answerOf(
    api.POST('/api/journal/unlocks/{unlockId}/decide', {
      params: { header: branchHeader(), path: { unlockId } },
      body,
    }),
  ).then((answer) => journalUnlockSchema.parse(answer));

export const withdrawUnlock = (unlockId: string, version: number) =>
  answerOf(
    api.POST('/api/journal/unlocks/{unlockId}/withdraw', {
      params: { header: branchHeader(), path: { unlockId } },
      body: { version },
    }),
  ).then((answer) => journalUnlockSchema.parse(answer));

export const extendEditPeriod = (body: EditExtensionCreate) =>
  answerOf(api.POST('/api/journal/extensions', { params: { header: branchHeader() }, body })).then(
    (answer) => editExtensionSchema.parse(answer),
  );

/** Every journal query (the grids show the lock), the requests and the extensions with them. */
export const invalidateUnlocks = (queryClient: QueryClient): Promise<unknown> =>
  invalidateJournal(queryClient);
