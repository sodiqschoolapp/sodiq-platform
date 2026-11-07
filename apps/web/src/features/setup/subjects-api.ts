import {
  STUDENT_IMPORT_TYPES,
  subjectImportConfirmResultSchema,
  subjectImportPreviewSchema,
  subjectListSchema,
  subjectQuarterWeightsSchema,
  type Language,
  type SubjectImportConfirmResult,
  type SubjectImportPreview,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { fileNameOf, save } from '@/components/list/use-export';
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

/**
 * The subject import (the owner's change of 7 November 2026, #316): the system's template, the
 * upload of a filled one with its preview, the preview again, and the confirm.
 */
export const downloadSubjectImportTemplate = async (language: Language): Promise<void> => {
  const answer = await api.GET('/api/setup/subjects/import-template', {
    params: { header: branchHeader(), query: { language } },
    parseAs: 'blob',
  });
  const file: unknown = await answerOf(Promise.resolve(answer));
  if (!(file instanceof Blob)) throw new ApiFailure('no_answer');
  save(file, fileNameOf(answer.response.headers.get('Content-Disposition'), 'subject-import.xlsx'));
};

export const uploadSubjectImport = async (file: File): Promise<SubjectImportPreview> =>
  subjectImportPreviewSchema.parse(
    await answerOf(
      api.PUT('/api/setup/subjects/imports', {
        params: { header: branchHeader() },
        body: file as unknown as string,
        bodySerializer: (body: unknown) => body as Blob,
        headers: { 'Content-Type': STUDENT_IMPORT_TYPES[0] ?? '' },
      }),
    ),
  );

export const confirmSubjectImport = async (id: string): Promise<SubjectImportConfirmResult> =>
  subjectImportConfirmResultSchema.parse(
    await answerOf(
      api.POST('/api/setup/subjects/imports/{id}/confirm', {
        params: { header: branchHeader(), path: { id } },
        body: {},
      }),
    ),
  );
