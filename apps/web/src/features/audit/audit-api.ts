import {
  auditEntrySchema,
  auditPageSchema,
  signInHistorySchema,
  type AuditEntryAnswer,
} from '@sodiq/shared';
import { infiniteQueryOptions } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import type { AuditFilters } from './audit-search';

export const AUDIT_KEY = ['audit'] as const;

/**
 * The pages of the log for a search in the branch of the switcher (task
 * 2.6a), the next one asked for with the cursor of the last. Reading the log
 * is not logged (decision 8); nothing here runs on a timer.
 */
export const auditEntriesQuery = (branchId: string | null, filters: AuditFilters) =>
  infiniteQueryOptions({
    queryKey: [...AUDIT_KEY, 'entries', branchId, filters],
    queryFn: async ({ pageParam }) =>
      auditPageSchema.parse(
        await answerOf(
          api.GET('/api/audit/entries', {
            params: {
              header: branchHeader(),
              query: pageParam === null ? filters : { ...filters, before: pageParam },
            },
          }),
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    enabled: branchId !== null,
  });

/** The hidden values of one entry, with a logged show (decision 6). */
export const showEntry = async (id: string): Promise<AuditEntryAnswer> =>
  auditEntrySchema.parse(
    await answerOf(
      api.POST('/api/audit/entries/{id}/show', {
        params: { header: branchHeader(), path: { id } },
      }),
    ),
  );

/** The own sign-in history of the account page (decision 10). */
export const signInHistoryQuery = infiniteQueryOptions({
  queryKey: ['account', 'sign-in-history'],
  queryFn: async ({ pageParam }) =>
    signInHistorySchema.parse(
      await answerOf(
        api.GET('/api/auth/sign-in-history', {
          params: { query: pageParam === null ? {} : { before: pageParam } },
        }),
      ),
    ),
  initialPageParam: null as string | null,
  getNextPageParam: (last) => last.next,
});
