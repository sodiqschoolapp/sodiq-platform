import {
  planFileSchema,
  planItemSchema,
  planListSchema,
  planSchema,
  type PlanItemCreate,
  type PlanItemSave,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { fileNameOf, save } from '@/components/list/use-export';

/** The plans of a branch (task 7.1a); `null` while no branch is chosen. */
export const plansKey = (branchId?: string | null) =>
  branchId === undefined ? ['plans'] : ['plans', branchId];

/** The plans the role may read in a year (the current one without `yearId`). */
export const plansQuery = (branchId: string | null, yearId: string | null) =>
  queryOptions({
    queryKey: [...plansKey(branchId), 'list', yearId],
    queryFn: async () =>
      planListSchema.parse(
        await answerOf(
          api.GET('/api/plans', {
            params: { header: branchHeader(), query: yearId === null ? {} : { yearId } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The plan of a journal in a quarter (the quarter of today without `quarterId`). */
export const planQuery = (branchId: string | null, journalId: string, quarterId: string | null) =>
  queryOptions({
    queryKey: [...plansKey(branchId), 'plan', journalId, quarterId],
    queryFn: async () =>
      planSchema.parse(
        await answerOf(
          api.GET('/api/plans/journals/{journalId}', {
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

/** Every query of the plans, after a write. */
export const invalidatePlans = (queryClient: QueryClient): Promise<unknown> =>
  queryClient.invalidateQueries({ queryKey: plansKey() });

export const createPlanItem = (journalId: string, body: PlanItemCreate) =>
  answerOf(
    api.POST('/api/plans/journals/{journalId}/items', {
      params: { header: branchHeader(), path: { journalId } },
      body,
    }),
  ).then((answer) => planItemSchema.parse(answer));

export const savePlanItem = (itemId: string, body: PlanItemSave) =>
  answerOf(
    api.PUT('/api/plans/items/{itemId}', {
      params: { header: branchHeader(), path: { itemId } },
      body,
    }),
  ).then((answer) => planItemSchema.parse(answer));

export const clearPlanItem = (itemId: string) =>
  answerOf(
    api.POST('/api/plans/items/{itemId}/clear', {
      params: { header: branchHeader(), path: { itemId } },
    }),
  );

/** Sends a file as it is; its type is one of `PLAN_FILE_TYPES`. */
export const addPlanFile = (itemId: string, file: File) =>
  answerOf(
    api.PUT('/api/plans/items/{itemId}/files', {
      params: { header: branchHeader(), path: { itemId }, query: { name: file.name } },
      // The document types the body as a binary string; the browser sends the File as it is.
      body: file as unknown as string,
      bodySerializer: (body: unknown) => body as Blob,
      headers: { 'Content-Type': file.type },
    }),
  ).then((answer) => planFileSchema.parse(answer));

export const removePlanFile = (fileId: string) =>
  answerOf(
    api.DELETE('/api/plans/files/{fileId}', {
      params: { header: branchHeader(), path: { fileId } },
    }),
  );

/** Downloads a file of an item under its own name. */
export async function downloadPlanFile(fileId: string, name: string): Promise<void> {
  const result = await api.GET('/api/plans/files/{fileId}', {
    params: { header: branchHeader(), path: { fileId } },
    parseAs: 'blob',
  });
  // The document calls the file a binary string; with `parseAs: 'blob'` it is a Blob.
  const file: unknown = await answerOf(Promise.resolve(result));
  if (!(file instanceof Blob)) throw new ApiFailure('no_answer');
  save(file, fileNameOf(result.response.headers.get('Content-Disposition'), name));
}
