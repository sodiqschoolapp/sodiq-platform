import {
  REQUEST_KEY_HEADER,
  exemptionAbsencesSchema,
  exemptionBatchChangedSchema,
  exemptionCreatedSchema,
  exemptionListSchema,
  exemptionMoveOffersSchema,
  exemptionPreviewSchema,
  exemptionReasonSchema,
  exemptionSchema,
  exemptionsTodaySchema,
  absenceReasonSchema,
  type ExemptionChoice,
  type ExemptionCreate,
  type ExemptionEdit,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { fileNameOf, save } from '@/components/list/use-export';
import { invalidateJournal, journalKey } from './journal-api';

/**
 * Exemptions (task 8.5, pull request #223). Who may enter them, the overlap,
 * the late-entry choices and what a change does to the cells are the
 * server's; the screens follow its answers.
 */
export const exemptionsKey = (branchId: string | null) => [...journalKey(branchId), 'exemptions'];

export const exemptionsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...exemptionsKey(branchId), 'list'],
    queryFn: async () =>
      exemptionListSchema.parse(
        await answerOf(api.GET('/api/exemptions', { params: { header: branchHeader() } })),
      ),
    enabled: branchId !== null,
  });

export const studentExemptionsQuery = (
  branchId: string | null,
  studentId: string,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: [...exemptionsKey(branchId), 'student', studentId],
    queryFn: async () =>
      exemptionListSchema.parse(
        await answerOf(
          api.GET('/api/exemptions', {
            params: { header: branchHeader(), query: { studentId } },
          }),
        ),
      ),
    enabled: branchId !== null && enabled,
  });

export const exemptionAbsencesQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...exemptionsKey(branchId), 'absences'],
    queryFn: async () =>
      exemptionAbsencesSchema.parse(
        await answerOf(
          api.GET('/api/exemptions/absences-without', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

export const exemptionOffersQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...exemptionsKey(branchId), 'offers'],
    queryFn: async () =>
      exemptionMoveOffersSchema.parse(
        await answerOf(
          api.GET('/api/exemptions/move-offers', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

export const exemptionsTodayQuery = (branchId: string | null, enabled: boolean) =>
  queryOptions({
    queryKey: [...exemptionsKey(branchId), 'today'],
    queryFn: async () =>
      exemptionsTodaySchema.parse(
        await answerOf(
          api.GET('/api/journal/exemptions-today', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null && enabled,
  });

/** The detail of the reason: every opening is logged on the server. */
export const openReason = (id: string) =>
  answerOf(
    api.GET('/api/exemptions/{id}/reason', { params: { header: branchHeader(), path: { id } } }),
  ).then((answer) => exemptionReasonSchema.parse(answer));

export const previewCreate = (body: ExemptionCreate) =>
  answerOf(api.POST('/api/exemptions/preview', { params: { header: branchHeader() }, body })).then(
    (answer) => exemptionPreviewSchema.parse(answer),
  );

export const createExemptions = (body: ExemptionCreate, key: string) =>
  answerOf(
    api.POST('/api/exemptions', {
      params: { header: { ...branchHeader(), [REQUEST_KEY_HEADER]: key } },
      body,
    }),
  ).then((answer) => exemptionCreatedSchema.parse(answer));

export const previewEdit = (id: string, body: ExemptionEdit) =>
  answerOf(
    api.POST('/api/exemptions/{id}/edit/preview', {
      params: { header: branchHeader(), path: { id } },
      body,
    }),
  ).then((answer) => exemptionPreviewSchema.parse(answer));

export const editExemption = (id: string, body: ExemptionEdit) =>
  answerOf(
    api.PATCH('/api/exemptions/{id}', { params: { header: branchHeader(), path: { id } }, body }),
  ).then((answer) => exemptionSchema.parse(answer));

export const previewEnd = (id: string, endDate: string, version: number) =>
  answerOf(
    api.POST('/api/exemptions/{id}/end/preview', {
      params: { header: branchHeader(), path: { id } },
      body: { endDate, version, choices: [] },
    }),
  ).then((answer) => exemptionPreviewSchema.parse(answer));

export const endExemption = (
  id: string,
  endDate: string,
  version: number,
  choices: ExemptionChoice[],
) =>
  answerOf(
    api.POST('/api/exemptions/{id}/end', {
      params: { header: branchHeader(), path: { id } },
      body: { endDate, version, choices },
    }),
  ).then((answer) => exemptionSchema.parse(answer));

export const previewVoid = (id: string, version: number) =>
  answerOf(
    api.POST('/api/exemptions/{id}/void/preview', {
      params: { header: branchHeader(), path: { id } },
      body: { version },
    }),
  ).then((answer) => exemptionPreviewSchema.parse(answer));

export const voidExemption = (id: string, reason: string, version: number) =>
  answerOf(
    api.POST('/api/exemptions/{id}/void', {
      params: { header: branchHeader(), path: { id } },
      body: { reason, version },
    }),
  ).then((answer) => exemptionSchema.parse(answer));

export const previewBatchVoid = (batchId: string) =>
  answerOf(
    api.POST('/api/exemptions/batches/{batchId}/void/preview', {
      params: { header: branchHeader(), path: { batchId } },
    }),
  ).then((answer) => exemptionPreviewSchema.parse(answer));

export const voidBatch = (batchId: string, reason: string) =>
  answerOf(
    api.POST('/api/exemptions/batches/{batchId}/void', {
      params: { header: branchHeader(), path: { batchId } },
      body: { reason },
    }),
  ).then((answer) => exemptionBatchChangedSchema.parse(answer));

export const confirmOffer = (id: string, choices: ExemptionChoice[]) =>
  answerOf(
    api.POST('/api/exemptions/move-offers/{id}/confirm', {
      params: { header: branchHeader(), path: { id } },
      body: { choices },
    }),
  ).then((answer) => exemptionSchema.parse(answer));

export const previewConfirm = (id: string) =>
  answerOf(
    api.POST('/api/exemptions/move-offers/{id}/confirm/preview', {
      params: { header: branchHeader(), path: { id } },
    }),
  ).then((answer) => exemptionPreviewSchema.parse(answer));

export const dropOffer = (id: string) =>
  answerOf(
    api.POST('/api/exemptions/move-offers/{id}/drop', {
      params: { header: branchHeader(), path: { id } },
    }),
  ).then((answer) => exemptionMoveOffersSchema.parse(answer));

/** Sends the document as it is; its type is one of `EXEMPTION_FILE_TYPES`. */
export const putDocument = (id: string, file: File) =>
  answerOf(
    api.PUT('/api/exemptions/{id}/document', {
      params: { header: branchHeader(), path: { id }, query: { name: file.name } },
      // The document types the body as a binary string; the browser sends the File as it is.
      body: file as unknown as string,
      bodySerializer: (body: unknown) => body as Blob,
      headers: { 'Content-Type': file.type },
    }),
  ).then((answer) => exemptionSchema.parse(answer));

export const removeDocument = (id: string) =>
  answerOf(
    api.DELETE('/api/exemptions/{id}/document', {
      params: { header: branchHeader(), path: { id } },
    }),
  ).then((answer) => exemptionSchema.parse(answer));

/** Downloads the document under its own name; the server logs every opening. */
export async function downloadDocument(id: string, name: string): Promise<void> {
  const result = await api.GET('/api/exemptions/{id}/document', {
    params: { header: branchHeader(), path: { id } },
    parseAs: 'blob',
  });
  // The document calls the file a binary string; with `parseAs: 'blob'` it is a Blob.
  const file: unknown = await answerOf(Promise.resolve(result));
  if (!(file instanceof Blob)) throw new ApiFailure('no_answer');
  save(file, fileNameOf(result.response.headers.get('Content-Disposition'), name));
}

/** The file of a reason of absence (From 6.3, decision 10): attach, remove, download. */
export const putAbsenceFile = (studentId: string, date: string, file: File) =>
  answerOf(
    api.PUT('/api/journal/student-absences/{studentId}/{date}/file', {
      params: { header: branchHeader(), path: { studentId, date }, query: { name: file.name } },
      body: file as unknown as string,
      bodySerializer: (body: unknown) => body as Blob,
      headers: { 'Content-Type': file.type },
    }),
  ).then((answer) => absenceReasonSchema.parse(answer));

export const removeAbsenceFile = (studentId: string, date: string) =>
  answerOf(
    api.DELETE('/api/journal/student-absences/{studentId}/{date}/file', {
      params: { header: branchHeader(), path: { studentId, date } },
    }),
  ).then((answer) => absenceReasonSchema.parse(answer));

export async function downloadAbsenceFile(
  studentId: string,
  date: string,
  name: string,
): Promise<void> {
  const result = await api.GET('/api/journal/student-absences/{studentId}/{date}/file', {
    params: { header: branchHeader(), path: { studentId, date } },
    parseAs: 'blob',
  });
  const file: unknown = await answerOf(Promise.resolve(result));
  if (!(file instanceof Blob)) throw new ApiFailure('no_answer');
  save(file, fileNameOf(result.response.headers.get('Content-Disposition'), name));
}

/** Every journal query (the grids show the exempt cells) and the exemptions with them. */
export const invalidateExemptions = (queryClient: QueryClient): Promise<unknown> =>
  invalidateJournal(queryClient);
