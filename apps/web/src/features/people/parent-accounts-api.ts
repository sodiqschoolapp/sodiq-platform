import {
  parentAccountSchema,
  parentSlipListSchema,
  parentsNeverUsedSchema,
  printedParentSlipsSchema,
  type Language,
  type PrintedParentSlips,
} from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';

/**
 * The calls of the Parent accounts (task 11.1). The printed slips are answered once by a
 * mutation (`gcTime: 0` where it is used) and kept in no query cache.
 */

export const parentSlipsKey = (branchId: string | null, classId: string) =>
  ['parent-slips', branchId, classId] as const;

export const parentSlipsQuery = (branchId: string | null, classId: string) =>
  queryOptions({
    queryKey: parentSlipsKey(branchId, classId),
    queryFn: async () =>
      parentSlipListSchema.parse(
        await answerOf(
          api.GET('/api/people/classes/{classId}/parent-slips', {
            params: { header: branchHeader(), path: { classId } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

export async function printParentSlips(
  classId: string,
  language: Language,
  printAgain: string[],
): Promise<PrintedParentSlips> {
  return printedParentSlipsSchema.parse(
    await answerOf(
      api.POST('/api/people/classes/{classId}/parent-slips', {
        params: { header: branchHeader(), path: { classId } },
        body: { language, printAgain },
      }),
    ),
  );
}

export async function resetParentPassword(
  relativeId: string,
  language: Language,
): Promise<PrintedParentSlips> {
  return printedParentSlipsSchema.parse(
    await answerOf(
      api.POST('/api/people/parents/{relativeId}/password-reset', {
        params: { header: branchHeader(), path: { relativeId } },
        body: { language },
      }),
    ),
  );
}

export const parentAccountKey = (branchId: string | null, relativeId: string) =>
  ['parent-account', branchId, relativeId] as const;

export const parentAccountQuery = (branchId: string | null, relativeId: string) =>
  queryOptions({
    queryKey: parentAccountKey(branchId, relativeId),
    queryFn: async () =>
      parentAccountSchema.parse(
        await answerOf(
          api.GET('/api/people/parents/{relativeId}/account', {
            params: { header: branchHeader(), path: { relativeId } },
          }),
        ),
      ),
    enabled: branchId !== null,
  });

export const parentsNeverUsedQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: ['parents-never-used', branchId] as const,
    queryFn: async () =>
      parentsNeverUsedSchema.parse(
        await answerOf(
          api.GET('/api/people/parent-accounts/never-used', {
            params: { header: branchHeader() },
          }),
        ),
      ),
    enabled: branchId !== null,
  });
