import {
  pastMarkConfirmResultSchema,
  pastMarkPreviewSchema,
  pastMarkUploadListSchema,
  STUDENT_IMPORT_TYPES,
  type Language,
  type PastMarkConfirmResult,
  type PastMarkPreview,
  type PastMarkUploadList,
  type PastMarkWithdrawBody,
} from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { fileNameOf, save } from '@/components/list/use-export';
import { SETUP_KEY } from './setup-api';

/**
 * The import of past marks from before go-live (task 11.26; `10`, Past marks from before
 * go-live): the template, the upload with the first page of its preview, a page of the preview,
 * the confirm, the list of uploads and the withdrawal.
 */
export const pastMarkUploadsKey = (branchId: string | null) => [
  ...SETUP_KEY,
  'past-marks',
  branchId,
];

export const pastMarkUploadsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: pastMarkUploadsKey(branchId),
    queryFn: async (): Promise<PastMarkUploadList> =>
      pastMarkUploadListSchema.parse(
        await answerOf(
          api.GET('/api/setup/past-marks/imports', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

export const downloadPastMarkTemplate = async (language: Language): Promise<void> => {
  const answer = await api.GET('/api/setup/past-marks/import-template', {
    params: { header: branchHeader(), query: { language } },
    parseAs: 'blob',
  });
  const file: unknown = await answerOf(Promise.resolve(answer));
  if (!(file instanceof Blob)) throw new ApiFailure('no_answer');
  save(
    file,
    fileNameOf(answer.response.headers.get('Content-Disposition'), 'past-marks-import.xlsx'),
  );
};

export const uploadPastMarks = async (file: File): Promise<PastMarkPreview> =>
  pastMarkPreviewSchema.parse(
    await answerOf(
      api.PUT('/api/setup/past-marks/imports', {
        params: { header: branchHeader(), query: { name: file.name.slice(0, 200) || 'file.xlsx' } },
        body: file as unknown as string,
        bodySerializer: (body: unknown) => body as Blob,
        headers: { 'Content-Type': STUDENT_IMPORT_TYPES[0] ?? '' },
      }),
    ),
  );

export const previewPastMarks = async (id: string, page: number): Promise<PastMarkPreview> =>
  pastMarkPreviewSchema.parse(
    await answerOf(
      api.POST('/api/setup/past-marks/imports/{id}/preview', {
        params: { header: branchHeader(), path: { id } },
        body: { page },
      }),
    ),
  );

export const confirmPastMarks = async (id: string): Promise<PastMarkConfirmResult> =>
  pastMarkConfirmResultSchema.parse(
    await answerOf(
      api.POST('/api/setup/past-marks/imports/{id}/confirm', {
        params: { header: branchHeader(), path: { id } },
        body: {},
      }),
    ),
  );

export const withdrawPastMarks = async (
  id: string,
  body: PastMarkWithdrawBody,
): Promise<PastMarkUploadList> =>
  pastMarkUploadListSchema.parse(
    await answerOf(
      api.POST('/api/setup/past-marks/imports/{id}/withdraw', {
        params: { header: branchHeader(), path: { id } },
        body,
      }),
    ),
  );
