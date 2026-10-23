import {
  planEventDecidedSchema,
  planRequestSchema,
  planRequestsSchema,
  planWindowsSchema,
  type PlanEventDecision,
  type PlanRequestCreate,
  type PlanRequestDecision,
  type PlanWindowExtend,
  type PlanWindowSave,
  planFileSchema,
  planItemSchema,
  planListSchema,
  planSchema,
  type PlanCopy,
  type PlanItemCreate,
  type PlanItemSave,
  type PlanShare,
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

/** Task 7.1c: another journal of the owner joins the plan of this journal. */
export const sharePlan = (journalId: string, body: PlanShare) =>
  answerOf(
    api.POST('/api/plans/journals/{journalId}/share', {
      params: { header: branchHeader(), path: { journalId } },
      body,
    }),
  ).then((answer) => planSchema.parse(answer));

/** Task 7.1c: this journal leaves its shared plan with a copy of the items. */
export const separatePlan = (journalId: string, quarterId: string) =>
  answerOf(
    api.POST('/api/plans/journals/{journalId}/separate', {
      params: { header: branchHeader(), path: { journalId } },
      body: { quarterId },
    }),
  ).then((answer) => planSchema.parse(answer));

/** Task 7.1c: the items of another plan copied into this empty plan. */
export const copyPlan = (journalId: string, body: PlanCopy) =>
  answerOf(
    api.POST('/api/plans/journals/{journalId}/copy', {
      params: { header: branchHeader(), path: { journalId } },
      body,
    }),
  ).then((answer) => planSchema.parse(answer));

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

/** Task 7.2: the plan windows of a year (the current one without `yearId`). */
export const planWindowsQuery = (branchId: string | null, yearId: string | null) =>
  queryOptions({
    queryKey: [...plansKey(branchId), 'windows', yearId],
    queryFn: async () =>
      planWindowsSchema.parse(
        await answerOf(
          api.GET('/api/plans/windows', {
            params: { header: branchHeader(), query: yearId === null ? {} : { yearId } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** Task 7.2: opens the window of a quarter or moves its dates. */
export const savePlanWindow = (quarterId: string, body: PlanWindowSave) =>
  answerOf(
    api.PUT('/api/plans/windows/{quarterId}', {
      params: { header: branchHeader(), path: { quarterId } },
      body,
    }),
  ).then((answer) => planWindowsSchema.parse(answer));

/** Task 7.2: extends the window of a quarter for one teacher. */
export const extendPlanWindow = (quarterId: string, body: PlanWindowExtend) =>
  answerOf(
    api.POST('/api/plans/windows/{quarterId}/extensions', {
      params: { header: branchHeader(), path: { quarterId } },
      body,
    }),
  ).then((answer) => planWindowsSchema.parse(answer));

/** Task 7.2: the requests of the reader's plans, or those the reader decides. */
export const planRequestsQuery = (branchId: string | null, view: 'mine' | 'deciding') =>
  queryOptions({
    queryKey: [...plansKey(branchId), 'requests', view],
    queryFn: async () =>
      planRequestsSchema.parse(
        await answerOf(
          api.GET('/api/plans/requests', {
            params: { header: branchHeader(), query: { view } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

/** Task 7.2: the owner asks to edit (Text or Re-plan). */
export const askPlanRequest = (journalId: string, body: PlanRequestCreate) =>
  answerOf(
    api.POST('/api/plans/journals/{journalId}/requests', {
      params: { header: branchHeader(), path: { journalId } },
      body,
    }),
  ).then((answer) => planRequestSchema.parse(answer));

/** Task 7.2: the owner sends a request the system prepared. */
export const sendPlanRequest = (requestId: string) =>
  answerOf(
    api.POST('/api/plans/requests/{requestId}/send', {
      params: { header: branchHeader(), path: { requestId } },
      body: {},
    }),
  ).then((answer) => planRequestSchema.parse(answer));

/** Task 7.2: the owner sends the request of the window's end. */
export const sendPreparedPlanRequest = (journalId: string, quarterId: string) =>
  answerOf(
    api.POST('/api/plans/journals/{journalId}/requests/prepared', {
      params: { header: branchHeader(), path: { journalId } },
      body: { quarterId },
    }),
  ).then((answer) => planRequestSchema.parse(answer));

/** Task 7.2: an approver decides the request of the window's end without waiting. */
export const decidePreparedPlanRequest = (
  journalId: string,
  quarterId: string,
  decision: PlanRequestDecision,
) =>
  answerOf(
    api.POST('/api/plans/journals/{journalId}/requests/prepared/decide', {
      params: { header: branchHeader(), path: { journalId } },
      body: { quarterId, decision },
    }),
  ).then((answer) => planRequestSchema.parse(answer));

/** Task 7.2: approve with a number of school days, or refuse with a reason. */
export const decidePlanRequest = (requestId: string, body: PlanRequestDecision) =>
  answerOf(
    api.POST('/api/plans/requests/{requestId}/decide', {
      params: { header: branchHeader(), path: { requestId } },
      body,
    }),
  ).then((answer) => planRequestSchema.parse(answer));

/** Task 7.2: approves every waiting request of one event. */
export const decidePlanEvent = (body: PlanEventDecision) =>
  answerOf(
    api.POST('/api/plans/requests/decide-event', {
      params: { header: branchHeader() },
      body,
    }),
  ).then((answer) => planEventDecidedSchema.parse(answer));

/** Task 7.2: the owner locks an open period early. */
export const finishPlanRequest = (requestId: string) =>
  answerOf(
    api.POST('/api/plans/requests/{requestId}/finish', {
      params: { header: branchHeader(), path: { requestId } },
    }),
  ).then((answer) => planRequestSchema.parse(answer));
