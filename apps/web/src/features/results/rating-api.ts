import {
  ratingChoicesSchema,
  ratingClassesListSchema,
  ratingClassListSchema,
  ratingSubjectListSchema,
  type InstructionLanguage,
  type RatingExport,
} from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { fileNameOf, save } from '@/components/list/use-export';

/**
 * The rating (task 9.3a; `08`, Rating). Every place and figure is the server's, from
 * `packages/calc`; the browser calculates nothing.
 */

export const ratingChoicesQuery = (branchId: string | null, yearId: string | undefined) =>
  queryOptions({
    queryKey: ['results', branchId, 'rating', 'choices', yearId ?? null],
    queryFn: async () =>
      ratingChoicesSchema.parse(
        await answerOf(
          api.GET('/api/results/rating/choices', {
            params: { header: branchHeader(), query: yearId === undefined ? {} : { yearId } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

export const ratingSubjectQuery = (
  branchId: string | null,
  quarterId: string | undefined,
  journalId: string | undefined,
) =>
  queryOptions({
    queryKey: ['results', branchId, 'rating', 'subject', quarterId ?? null, journalId ?? null],
    queryFn: async () =>
      ratingSubjectListSchema.parse(
        await answerOf(
          api.GET('/api/results/rating/subject', {
            params: {
              header: branchHeader(),
              query: { quarterId: quarterId ?? '', journalId: journalId ?? '' },
            },
          }),
        ),
      ),
    enabled: branchId !== null && quarterId !== undefined && journalId !== undefined,
  });

export const ratingClassQuery = (
  branchId: string | null,
  quarterId: string | undefined,
  classId: string | undefined,
) =>
  queryOptions({
    queryKey: ['results', branchId, 'rating', 'class', quarterId ?? null, classId ?? null],
    queryFn: async () =>
      ratingClassListSchema.parse(
        await answerOf(
          api.GET('/api/results/rating/class', {
            params: {
              header: branchHeader(),
              query: { quarterId: quarterId ?? '', classId: classId ?? '' },
            },
          }),
        ),
      ),
    enabled: branchId !== null && quarterId !== undefined && classId !== undefined,
  });

export const ratingClassesQuery = (
  branchId: string | null,
  quarterId: string | undefined,
  filters: { grade?: number; language?: InstructionLanguage },
  enabled: boolean,
) =>
  queryOptions({
    queryKey: [
      'results',
      branchId,
      'rating',
      'classes',
      quarterId ?? null,
      filters.grade ?? null,
      filters.language ?? null,
    ],
    queryFn: async () =>
      ratingClassesListSchema.parse(
        await answerOf(
          api.GET('/api/results/rating/classes', {
            params: {
              header: branchHeader(),
              query: {
                quarterId: quarterId ?? '',
                ...(filters.grade === undefined ? {} : { grade: filters.grade }),
                ...(filters.language === undefined ? {} : { language: filters.language }),
              },
            },
          }),
        ),
      ),
    enabled: enabled && branchId !== null && quarterId !== undefined,
  });

/** One list in Excel, saved under the server's name. */
export async function exportRating(body: RatingExport): Promise<void> {
  const result = await api.POST('/api/results/rating/export', {
    params: { header: branchHeader() },
    body,
    parseAs: 'blob',
  });
  const file: unknown = await answerOf(Promise.resolve(result));
  if (!(file instanceof Blob)) throw new ApiFailure('no_answer');
  save(file, fileNameOf(result.response.headers.get('Content-Disposition'), 'rating.xlsx'));
}
